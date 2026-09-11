import { prisma } from '@repo/db';
import { ensureSeqAtLeast } from '@repo/redis';
import { getObject, isStorageConfigured, putObject, snapshotKey } from '@repo/storage';
import { executeCommand, type ProjectSandbox } from '../sandbox';

const ARCHIVE_PATH = '/tmp/project-snapshot.tar.gz';

export type SnapshotInfo = {
  r2Key: string;
  upToSeq: number;
  sizeBytes: number;
};

async function latestSnapshot(projectId: string) {
  return await prisma.snapshot.findFirst({
    where: { projectId },
    orderBy: { upToSeq: 'desc' },
  });
}

export async function writeSnapshot(
  entry: ProjectSandbox,
  upToSeq: number,
): Promise<SnapshotInfo | null> {
  if (!isStorageConfigured()) {
    console.log('[SNAPSHOT] R2 not configured, skipping');
    return null;
  }

  const tar = await executeCommand(
    entry.projectId,
    `tar -czf ${ARCHIVE_PATH} --exclude=node_modules --exclude=.next -C ${entry.rootDir} .`,
  );
  if (tar.exitCode !== 0) {
    console.log('[SNAPSHOT_TAR_FAILED] , ', tar.output.slice(-1000));
    return null;
  }

  const bytes = await entry.sandbox.fs.downloadFile(ARCHIVE_PATH);
  const key = snapshotKey(entry.projectId, upToSeq);
  const sizeBytes = await putObject(key, bytes);

  await prisma.snapshot.create({
    data: { projectId: entry.projectId, r2Key: key, upToSeq, sizeBytes },
  });

  console.log(`[SNAPSHOT] wrote ${key} (${sizeBytes} bytes) at seq ${upToSeq}`);
  return { r2Key: key, upToSeq, sizeBytes };
}

export async function restoreSnapshot(entry: ProjectSandbox): Promise<number | null> {
  if (!isStorageConfigured()) return null;

  const snapshot = await latestSnapshot(entry.projectId);
  if (!snapshot) return null;

  let bytes: Buffer;
  try {
    bytes = await getObject(snapshot.r2Key);
  } catch (error) {
    
    console.log('[SNAPSHOT_FETCH_FAILED] , ', snapshot.r2Key, String(error).slice(0, 200));
    return null;
  }

  await entry.sandbox.fs.createFolder(entry.rootDir, '755').catch(() => undefined);
  await entry.sandbox.fs.uploadFile(bytes, ARCHIVE_PATH);

  const untar = await executeCommand(
    entry.projectId,
    `tar -xzf ${ARCHIVE_PATH} -C ${entry.rootDir}`,
  );
  if (untar.exitCode !== 0) {
    console.log('[SNAPSHOT_UNTAR_FAILED] , ', untar.output.slice(-1000));
    return null;
  }

  const install = await executeCommand(entry.projectId, 'npm install -g pnpm && pnpm install');
  if (install.exitCode !== 0) {
    console.log('[SNAPSHOT_INSTALL_FAILED] , ', install.output.slice(-1000));
  }

  await ensureSeqAtLeast(entry.projectId, snapshot.upToSeq);

  console.log(`[SNAPSHOT] restored ${snapshot.r2Key}, replaying from seq > ${snapshot.upToSeq}`);
  return snapshot.upToSeq;
}

