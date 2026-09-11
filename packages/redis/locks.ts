import { redis } from './index';
import { liveKey, lockKey, ownerKey, previewKey } from './keys';

export const LOCK_TTL_MS = 30_000;
export const HEARTBEAT_MS = 10_000;
export const LIVE_TTL_MS = 15_000;

const ACQUIRE = `
local current = redis.call("GET", KEYS[1])
if current == false then
  redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
  return "acquired"
end
if current == ARGV[1] then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  return "renewed"
end
if ARGV[3] == "1" and redis.call("EXISTS", KEYS[2]) == 0 then
  redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
  return "stolen"
end
return current
`;

const RENEW = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  redis.call("PEXPIRE", KEYS[2], ARGV[2])
  return 1
end
return 0
`;

const RELEASE = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("DEL", KEYS[1])
  redis.call("DEL", KEYS[2])
  return 1
end
return 0
`;

export type AcquireResult =
  | { ok: true; how: 'acquired' | 'renewed' | 'stolen' }
  | { ok: false; ownerId: string };

export async function acquireProjectLock(
  projectId: string,
  backendId: string,
  allowSteal = true,
): Promise<AcquireResult> {
  const result = (await redis.eval(ACQUIRE, {
    keys: [lockKey(projectId), liveKey(projectId)],
    arguments: [backendId, String(LOCK_TTL_MS), allowSteal ? '1' : '0'],
  })) as string;

  if (result === 'acquired' || result === 'renewed' || result === 'stolen') {
    return { ok: true, how: result };
  }
  return { ok: false, ownerId: result };
}

export async function renewProjectLock(projectId: string, backendId: string): Promise<boolean> {
  const result = (await redis.eval(RENEW, {
    keys: [lockKey(projectId), ownerKey(projectId)],
    arguments: [backendId, String(LOCK_TTL_MS)],
  })) as number;
  return result === 1;
}

export async function releaseProjectLock(projectId: string, backendId: string): Promise<boolean> {
  const result = (await redis.eval(RELEASE, {
    keys: [lockKey(projectId), ownerKey(projectId)],
    arguments: [backendId],
  })) as number;
  return result === 1;
}

export type ProjectOwner = { sandboxId: string; ownerId: string };

export async function setProjectOwner(projectId: string, owner: ProjectOwner) {
  await redis.set(ownerKey(projectId), JSON.stringify(owner), { PX: LOCK_TTL_MS });
}

export async function getProjectOwner(projectId: string): Promise<ProjectOwner | null> {
  const raw = await redis.get(ownerKey(projectId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProjectOwner;
  } catch {
    return null;
  }
}

export async function cachePreviewUrl(projectId: string, url: string) {
  await redis.set(previewKey(projectId), url, { EX: 60 * 60 * 12 });
}

export async function getCachedPreviewUrl(projectId: string): Promise<string | null> {
  return await redis.get(previewKey(projectId));
}

export async function clearPreviewUrl(projectId: string) {
  await redis.del(previewKey(projectId));
}

export async function touchLiveness(projectId: string) {
  await redis.set(liveKey(projectId), '1', { PX: LIVE_TTL_MS });
}

export async function clearLiveness(projectId: string) {
  await redis.del(liveKey(projectId));
}

export function startHeartbeat(
  projectId: string,
  backendId: string,
  onLost: () => void,
): () => void {
  const timer = setInterval(async () => {
    try {
      const held = await renewProjectLock(projectId, backendId);
      if (!held) {
        clearInterval(timer);
        onLost();
        return;
      }
      await touchLiveness(projectId);
    } catch (error) {
      console.log('[HEARTBEAT_ERROR] , ', error);
    }
  }, HEARTBEAT_MS);

  return () => clearInterval(timer);
}
