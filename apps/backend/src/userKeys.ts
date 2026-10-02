import { prisma } from '@repo/db';
import { redis, userKeyCacheKey } from '@repo/redis';
import { maskPreview } from '@repo/shared';
import { decrypt, encrypt, isSecretsConfigured } from './utils/secrets';
import type { ByokProviderName, ProviderOverride } from './providers';

export type UserKeySummary = {
  provider: ByokProviderName;
  maskedPreview: string;
  model: string | null;
  updatedAt: string;
};

const PROVIDERS = ['openrouter', 'openai', 'anthropic', 'gemini', 'deepseek'] as const;

export function isProvider(value: unknown): value is ByokProviderName {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

export function isUserKeyStorageConfigured(): boolean {
  return isSecretsConfigured();
}

export async function saveUserKey(
  userId: string,
  provider: ByokProviderName,
  apiKey: string,
  model?: string | null,
): Promise<UserKeySummary> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('the key is empty');

  const { ciphertext, iv, authTag } = encrypt(trimmed);
  const maskedPreview = maskPreview(trimmed);

  const row = await prisma.userProviderKey.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ciphertext, iv, authTag, maskedPreview, model: model ?? null },
    update: { ciphertext, iv, authTag, maskedPreview, model: model ?? null },
    select: { provider: true, maskedPreview: true, model: true, updatedAt: true },
  });

  await redis.del(userKeyCacheKey(userId)).catch(() => {});

  return {
    provider,
    maskedPreview: row.maskedPreview,
    model: row.model,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUserKeys(userId: string): Promise<UserKeySummary[]> {
  const rows = await prisma.userProviderKey.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { provider: true, maskedPreview: true, model: true, updatedAt: true },
  });

  return rows.filter((row) => isProvider(row.provider)).map((row) => ({
    provider: row.provider as ByokProviderName,
    maskedPreview: row.maskedPreview,
    model: row.model,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function loadUserKey(userId: string, provider?: ByokProviderName): Promise<ProviderOverride | null> {
  if (!isUserKeyStorageConfigured()) return null;

  type CachedKey = { provider: string; ciphertext: string; iv: string; authTag: string; model: string | null };
  let row: CachedKey | null;
  try {
    row = await prisma.userProviderKey.findFirst({
      where: provider ? { userId, provider } : { userId },
      orderBy: { updatedAt: 'desc' },
      select: { provider: true, ciphertext: true, iv: true, authTag: true, model: true },
    });
    if (!provider) {
      if (row) await redis.set(userKeyCacheKey(userId), JSON.stringify(row)).catch(() => {});
      else await redis.del(userKeyCacheKey(userId)).catch(() => {});
    }
  } catch (error) {
    const cached = await redis.get(userKeyCacheKey(userId)).catch(() => null);
    if (cached === null) throw error;
    console.log('[USER_KEY_POSTGRES_UNAVAILABLE] using cached ciphertext');
    row = JSON.parse(cached) as CachedKey;
    if (provider && row.provider !== provider) throw error;
  }

  if (!row || !isProvider(row.provider)) return null;

  try {
    return {
      provider: row.provider,
      apiKey: decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }),
      ...(row.model ? { model: row.model } : {}),
    };
  } catch (error) {
    console.log('[USER_KEY_DECRYPT_FAILED] , ', String((error as Error).message).slice(0, 200));
    return null;
  }
}

export async function deleteUserKey(userId: string, provider: ByokProviderName) {
  await redis.del(userKeyCacheKey(userId)).catch(() => {});
  await prisma.userProviderKey
    .delete({ where: { userId_provider: { userId, provider } } })
    .catch(() => {
    });
}

export type KeyCheckResult = { ok: true } | { ok: false; message: string };

const KEY_CHECKS: Partial<Record<ByokProviderName, (key: string) => Promise<Response>>> = {
  openrouter: (key) => fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } }),
  openai: (key) => fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } }),
  anthropic: (key) =>
    fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }),
  gemini: (key) => fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': key } }),
  deepseek: (key) => fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` } }),
};

export async function checkProviderKey(provider: ByokProviderName, apiKey: string): Promise<KeyCheckResult> {
  const check = KEY_CHECKS[provider];
  if (!check) return { ok: true };

  let response: Response;
  try {
    response = await check(apiKey.trim());
  } catch (error) {
    console.log('[USER_KEY_CHECK_UNREACHABLE] , ', provider, String(error).slice(0, 120));
    return { ok: true };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'That key was not accepted. Copy it again from your provider and paste the whole key.' };
  }
  return { ok: true };
}
