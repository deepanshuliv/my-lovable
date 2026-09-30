import { Prisma, prisma } from '@repo/db';
import { redis, taskStateDirtyKey, taskStateKey } from '@repo/redis';
import {
  PrismaTaskStateRepository,
  TaskStateConflictError,
  type TaskState,
  type TaskStateRepository,
} from './taskState';

const SET_IF_NEWER = `
local current = redis.call("GET", KEYS[1])
if current then
  local version = cjson.decode(current).version
  if version >= tonumber(ARGV[1]) then return 0 end
end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`;

const COMPARE_AND_SET = `
local current = redis.call("GET", KEYS[1])
if current then
  if cjson.decode(current).version ~= tonumber(ARGV[1]) then return 0 end
elseif ARGV[1] ~= "0" then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("SADD", KEYS[2], ARGV[3])
return 1
`;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function readCached(taskId: string): Promise<TaskState | null> {
  const raw = await redis.get(taskStateKey(taskId)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TaskState;
  } catch {
    return null;
  }
}

async function cacheIfNewer(state: TaskState) {
  await redis
    .eval(SET_IF_NEWER, { keys: [taskStateKey(state.taskId)], arguments: [String(state.version), JSON.stringify(state)] })
    .catch(() => {});
}

async function compareAndSet(taskId: string, expectedVersion: number, state: TaskState): Promise<boolean> {
  const result = await redis.eval(COMPARE_AND_SET, {
    keys: [taskStateKey(taskId), taskStateDirtyKey],
    arguments: [String(expectedVersion), JSON.stringify(state), taskId],
  });
  return result === 1;
}

export async function syncTaskStateToPostgres(state: TaskState): Promise<void> {
  const updated = await prisma.taskState.updateMany({
    where: { taskId: state.taskId, version: { lt: state.version } },
    data: { version: state.version, state: state as never },
  });
  if (updated.count > 0) return;

  const existing = await prisma.taskState.findUnique({ where: { taskId: state.taskId }, select: { version: true } });
  if (existing) return;

  await prisma.taskState.create({
    data: {
      taskId: state.taskId,
      projectId: state.sessionId,
      sessionId: state.sessionId,
      version: state.version,
      state: state as never,
    },
  });
}

export async function flushDirtyTaskStates(): Promise<number> {
  const dirty = await redis.sMembers(taskStateDirtyKey);
  let synced = 0;
  for (const taskId of dirty) {
    const cached = await readCached(taskId);
    if (cached) await syncTaskStateToPostgres(cached);
    await redis.sRem(taskStateDirtyKey, taskId);
    synced++;
  }
  return synced;
}

export class ResilientTaskStateRepository implements TaskStateRepository {
  private readonly durable = new PrismaTaskStateRepository();

  async load(taskId: string): Promise<TaskState | null> {
    const cached = await readCached(taskId);
    let stored: TaskState | null;
    try {
      stored = await this.durable.load(taskId);
    } catch (error) {
      if (cached) return cached;
      throw error;
    }

    if (cached && (!stored || cached.version > stored.version)) {
      await syncTaskStateToPostgres(cached).catch(() => {});
      return cached;
    }
    if (stored) await cacheIfNewer(stored);
    return stored;
  }

  async create(state: TaskState): Promise<TaskState> {
    try {
      const created = await this.durable.create(state);
      await cacheIfNewer(created);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw error;
      if (await compareAndSet(state.taskId, 0, state)) return state;
      throw error;
    }
  }

  async update(taskId: string, expectedVersion: number, state: TaskState): Promise<TaskState> {
    try {
      const updated = await this.durable.update(taskId, expectedVersion, state);
      await cacheIfNewer(updated);
      return updated;
    } catch (error) {
      if (await compareAndSet(taskId, expectedVersion, state).catch(() => false)) return state;
      if (error instanceof TaskStateConflictError) throw error;
      throw new TaskStateConflictError(taskId, expectedVersion);
    }
  }
}
