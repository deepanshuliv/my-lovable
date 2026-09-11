import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { prisma } from '@repo/db';
import { maskPreview, registerSecrets } from '@repo/shared';
import { injectSecrets } from '../sandbox';

const ALGORITHM = 'aes-256-gcm';

function getMasterKey(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      'SECRETS_MASTER_KEY is not set — generate one with: openssl rand -base64 32',
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`SECRETS_MASTER_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

export function isSecretsConfigured(): boolean {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}

export type Encrypted = { ciphertext: string; iv: string; authTag: string };

export function encrypt(plaintext: string): Encrypted {
  
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decrypt(record: Encrypted): string {
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function isValidSecretKey(key: string): boolean {
  if (!key || key.length < 1 || key.length > 64) return false;
  
  const firstCode = key.charCodeAt(0);
  if (firstCode < 65 || firstCode > 90) return false;
  
  for (let i = 1; i < key.length; i++) {
    const code = key.charCodeAt(i);
    const isUpper = code >= 65 && code <= 90;
    const isNum = code >= 48 && code <= 57;
    const isUnderscore = code === 95;
    
    if (!isUpper && !isNum && !isUnderscore) return false;
  }
  
  return true;
}

export type SecretSummary = {
  key: string;
  maskedPreview: string;
  updatedAt: string;
};

export async function upsertSecret(
  projectId: string,
  key: string,
  value: string,
): Promise<SecretSummary> {
  const encrypted = encrypt(value);
  const preview = maskPreview(value);

  const record = await prisma.secret.upsert({
    where: { projectId_key: { projectId, key } },
    create: { projectId, key, ...encrypted, maskedPreview: preview },
    update: { ...encrypted, maskedPreview: preview },
  });

  return { key: record.key, maskedPreview: record.maskedPreview, updatedAt: record.updatedAt.toISOString() };
}

export async function listSecrets(projectId: string): Promise<SecretSummary[]> {
  const records = await prisma.secret.findMany({
    where: { projectId },
    orderBy: { key: 'asc' },

    select: { key: true, maskedPreview: true, updatedAt: true },
  });

  return records.map((r) => ({
    key: r.key,
    maskedPreview: r.maskedPreview,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function deleteSecret(projectId: string, key: string): Promise<void> {
  await prisma.secret.deleteMany({ where: { projectId, key } });
}

async function resolveSecrets(projectId: string): Promise<Record<string, string>> {
  const records = await prisma.secret.findMany({ where: { projectId } });
  const out: Record<string, string> = {};

  for (const record of records) {
    try {
      out[record.key] = decrypt(record);
    } catch (error) {

      console.log('[SECRET_DECRYPT_FAILED] , ', record.key, String(error).slice(0, 120));
    }
  }

  return out;
}

export async function registerSecretsForRedaction(projectId: string): Promise<void> {
  if (!isSecretsConfigured()) return;

  const secrets = await resolveSecrets(projectId);
  registerSecrets(projectId, Object.values(secrets));
}

export async function applySecretsToSandbox(projectId: string): Promise<string[]> {
  if (!isSecretsConfigured()) return [];

  const secrets = await resolveSecrets(projectId);
  registerSecrets(projectId, Object.values(secrets));
  await injectSecrets(projectId, secrets);

  return Object.keys(secrets);
}
