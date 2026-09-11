import { prisma } from '@repo/db';
import { maskPreview } from '@repo/shared';
import { decrypt, encrypt, isSecretsConfigured } from './utils/secrets';
import type { ProviderOverride } from './providers';

export type UserKeySummary = {
  provider: 'openrouter' | 'gemini';
  maskedPreview: string;
  model: string | null;
  updatedAt: string;
};

const PROVIDERS = ['openrouter', 'gemini'] as const;

export function isProvider(value: unknown): value is 'openrouter' | 'gemini' {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

export function isUserKeyStorageConfigured(): boolean {
  return isSecretsConfigured();
}

export async function saveUserKey(
  userId: string,
  provider: 'openrouter' | 'gemini',
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
    provider: row.provider as 'openrouter' | 'gemini',
    maskedPreview: row.maskedPreview,
    model: row.model,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function loadUserKey(userId: string): Promise<ProviderOverride | null> {
  if (!isUserKeyStorageConfigured()) return null;

  const row = await prisma.userProviderKey.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

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

export async function deleteUserKey(userId: string, provider: 'openrouter' | 'gemini') {
  await prisma.userProviderKey
    .delete({ where: { userId_provider: { userId, provider } } })
    .catch(() => {
      
    });
}
