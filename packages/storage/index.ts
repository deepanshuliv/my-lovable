import { S3Client } from 'bun';

let client: S3Client | null = null;

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

function getClient(): S3Client {
  if (client) return client;

  if (!isStorageConfigured()) {
    throw new Error('R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
  }

  client = new S3Client({
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    endpoint:
      process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });

  return client;
}

export function snapshotKey(projectId: string, seq: number): string {
  return `projects/${projectId}/${String(seq).padStart(12, '0')}.tar.gz`;
}

export async function putObject(key: string, body: Uint8Array | Buffer): Promise<number> {
  const file = getClient().file(key);
  await file.write(body);
  return body.byteLength;
}

export async function getObject(key: string): Promise<Buffer> {
  const bytes = await getClient().file(key).arrayBuffer();
  return Buffer.from(bytes);
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    return await getClient().file(key).exists();
  } catch {
    return false;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().file(key).delete();
}
