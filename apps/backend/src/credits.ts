import { Prisma, prisma } from '@repo/db';
import { envInt } from '@repo/shared';
import { inflightCreditsKey, pendingChargesKey, redis } from '@repo/redis';
import type { ModelProvider } from './providers';

export type ChargeableRun = Pick<ModelProvider, 'name' | 'model' | 'usage'>;

export const PLATFORM_CREDIT_MICROS = Math.max(0, envInt('PLATFORM_CREDIT_MICROS', 50_000));
export const PLATFORM_CREDIT_UNITS = Math.max(1, envInt('PLATFORM_CREDIT_UNITS', 100));

const PRICES_PER_MILLION: Record<ModelProvider['name'], { input: number; output: number }> = {
  openrouter: {
    input: Number(process.env.OPENROUTER_INPUT_PRICE_PER_M || '0.042'),
    output: Number(process.env.OPENROUTER_OUTPUT_PRICE_PER_M || '0.084'),
  },
  gemini: {
    input: Number(process.env.GEMINI_INPUT_PRICE_PER_M || '0.25'),
    output: Number(process.env.GEMINI_OUTPUT_PRICE_PER_M || '1.50'),
  },
  openai: {
    input: Number(process.env.OPENAI_INPUT_PRICE_PER_M || '1.25'),
    output: Number(process.env.OPENAI_OUTPUT_PRICE_PER_M || '10'),
  },
  anthropic: {
    input: Number(process.env.ANTHROPIC_INPUT_PRICE_PER_M || '3'),
    output: Number(process.env.ANTHROPIC_OUTPUT_PRICE_PER_M || '15'),
  },
  deepseek: {
    input: Number(process.env.DEEPSEEK_INPUT_PRICE_PER_M || '0.14'),
    output: Number(process.env.DEEPSEEK_OUTPUT_PRICE_PER_M || '0.28'),
  },
};

export const MICROS_PER_CREDIT = Math.max(1, Math.floor(PLATFORM_CREDIT_MICROS / PLATFORM_CREDIT_UNITS));

export type CreditBalance = {
  grantedMicros: number;
  consumedMicros: number;
  remainingMicros: number;
  totalUnits: number;
  remainingUnits: number;
  usedUnits: number;
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function topUpToBaseline<T extends { userId: string; grantedMicros: number }>(account: T) {
  if (account.grantedMicros >= PLATFORM_CREDIT_MICROS) return account;
  const amountMicros = PLATFORM_CREDIT_MICROS - account.grantedMicros;
  try {
    const [, updated] = await prisma.$transaction([
      prisma.creditLedger.create({
        data: { userId: account.userId, requestId: `baseline-${PLATFORM_CREDIT_MICROS}`, kind: 'grant', amountMicros },
      }),
      prisma.creditAccount.update({
        where: { userId: account.userId },
        data: { grantedMicros: { increment: amountMicros } },
      }),
    ]);
    return updated;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return await prisma.creditAccount.findUniqueOrThrow({ where: { userId: account.userId } });
  }
}

async function ensureAccount(userId: string) {
  const existing = await prisma.creditAccount.findUnique({ where: { userId } });
  if (existing) return await topUpToBaseline(existing);

  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.create({
        data: { userId, grantedMicros: PLATFORM_CREDIT_MICROS },
      });
      await tx.creditLedger.create({
        data: { userId, requestId: 'initial-grant', kind: 'grant', amountMicros: PLATFORM_CREDIT_MICROS },
      });
      return account;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return await prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
  }
}

async function inflightMicros(userId: string): Promise<number> {
  const values = await redis.hVals(inflightCreditsKey(userId)).catch(() => [] as string[]);
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export async function trackInflightUsage(userId: string, runId: string, provider: ChargeableRun) {
  const key = inflightCreditsKey(userId);
  await redis.hSet(key, runId, String(usageCostMicros(provider)));
  await redis.expire(key, 300);
}

export async function clearInflightUsage(userId: string, runId: string) {
  await redis.hDel(inflightCreditsKey(userId), runId);
}

export async function getCreditBalance(userId: string, includeInflight = false): Promise<CreditBalance> {
  const account = await ensureAccount(userId);
  const pending = includeInflight ? await inflightMicros(userId) : 0;
  const remainingMicros = Math.max(0, account.grantedMicros - account.consumedMicros - pending);
  const totalUnits = Math.round(account.grantedMicros / MICROS_PER_CREDIT);
  const remainingUnits = Math.floor(remainingMicros / MICROS_PER_CREDIT);

  return {
    grantedMicros: account.grantedMicros,
    consumedMicros: account.consumedMicros,
    remainingMicros,
    totalUnits,
    remainingUnits,
    usedUnits: Math.max(0, totalUnits - remainingUnits),
  };
}

export function usageCostMicros(provider: ChargeableRun): number {
  const prices = PRICES_PER_MILLION[provider.name];
  const estimatedUsd =
    (provider.usage.unreportedInputTokens * prices.input + provider.usage.unreportedOutputTokens * prices.output) / 1_000_000;
  return Math.ceil((provider.usage.reportedCostUsd + estimatedUsd) * 1_000_000);
}

export async function chargePlatformUsage(
  userId: string,
  requestId: string,
  provider: ChargeableRun,
): Promise<number> {
  const amountMicros = usageCostMicros(provider);
  if (amountMicros <= 0) return 0;

  await ensureAccount(userId);
  try {
    await prisma.$transaction([
      prisma.creditLedger.create({
        data: {
          userId,
          requestId,
          kind: 'charge',
          amountMicros,
          provider: provider.name,
          model: provider.model,
          metadata: { ...provider.usage },
        },
      }),
      prisma.creditAccount.update({
        where: { userId },
        data: { consumedMicros: { increment: amountMicros } },
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) return 0;
    throw error;
  }
  return amountMicros;
}

export async function queuePendingCharge(userId: string, requestId: string, provider: ChargeableRun) {
  await redis.rPush(
    pendingChargesKey,
    JSON.stringify({ userId, requestId, name: provider.name, model: provider.model, usage: provider.usage }),
  );
}

export async function flushPendingCharges(): Promise<number> {
  let flushed = 0;
  while (true) {
    const raw = await redis.lIndex(pendingChargesKey, 0);
    if (!raw) return flushed;
    const pending = JSON.parse(raw) as ChargeableRun & { userId: string; requestId: string };
    await chargePlatformUsage(pending.userId, pending.requestId, pending);
    await redis.lPop(pendingChargesKey);
    flushed++;
  }
}
