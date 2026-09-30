import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '@repo/db';
import { lockKey, projectLeftKey, redis, seqKey } from '@repo/redis';
import { SANDBOX_LEAVE_GRACE_SECONDS } from './config';
import { detachProject, knownSandboxId } from './project';
import { getCachedSandbox, peekSandbox, registerSandbox, type ProjectSandbox } from './sandbox';
import { isClean } from './sandbox/git';
import { lastSnapshotSeq, writeSnapshot } from './utils/snapshot';

export type SandboxPresence = 'running' | 'stopped' | 'none';

export type PresenceSandbox = {
  id: string;
  state?: string;
  refreshActivity: () => Promise<void>;
  stop: () => Promise<void>;
};

export type PresenceDeps = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlMs: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
  sandboxIdFor: (projectId: string) => Promise<string | null>;
  peek: (sandboxId: string) => Promise<PresenceSandbox | null>;
  snapshotState: (projectId: string) => Promise<{ count: number; lastSeq: number }>;
  saveSnapshot: (projectId: string, sandbox: PresenceSandbox, seq: number) => Promise<boolean>;
  detach: (projectId: string) => void;
  schedule: (run: () => void, ms: number) => void;
  now: () => number;
  graceMs: number;
  secret: string;
};

const REFRESH_EVERY_MS = 60_000;
const TICKET_TTL_MS = 15 * 60_000;
const ACTIVE_STATES = new Set(['started', 'starting', 'restoring', 'pulling_snapshot', 'creating']);

export function createPresence(deps: PresenceDeps) {
  const lastRefresh = new Map<string, number>();

  const sign = (payload: string) => createHmac('sha256', deps.secret).update(payload).digest('base64url');

  function leaveTicket(projectId: string): string {
    const expires = deps.now() + TICKET_TTL_MS;
    return `${expires}.${sign(`${projectId}.${expires}`)}`;
  }

  function checkLeaveTicket(projectId: string, ticket: string): boolean {
    const [expires, signature, extra] = String(ticket ?? '').split('.');
    if (!expires || !signature || extra !== undefined || !/^\d+$/.test(expires) || Number(expires) < deps.now()) return false;
    const expected = Buffer.from(sign(`${projectId}.${expires}`));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async function markPresent(projectId: string): Promise<void> {
    await deps.del(projectLeftKey(projectId)).catch(() => {});
  }

  async function heartbeat(projectId: string): Promise<SandboxPresence> {
    await markPresent(projectId);

    const sandboxId = await deps.sandboxIdFor(projectId);
    if (!sandboxId) return 'none';
    const sandbox = await deps.peek(sandboxId);
    if (!sandbox) return 'none';
    if (sandbox.state !== 'started') return ACTIVE_STATES.has(sandbox.state ?? '') ? 'running' : 'stopped';

    const now = deps.now();
    if (now - (lastRefresh.get(projectId) ?? 0) >= REFRESH_EVERY_MS) {
      lastRefresh.set(projectId, now);
      await sandbox.refreshActivity().catch((error) => {
        lastRefresh.delete(projectId);
        console.log('[SANDBOX_REFRESH_FAILED] , ', projectId, String(error).slice(0, 160));
      });
    }
    return 'running';
  }

  async function markLeft(projectId: string): Promise<void> {
    const token = randomUUID();
    await deps.set(projectLeftKey(projectId), token, deps.graceMs + 120_000);
    deps.schedule(() => {
      void stopIfStillGone(projectId, token);
    }, deps.graceMs);
  }

  async function stillGone(projectId: string, token: string): Promise<boolean> {
    if ((await deps.get(projectLeftKey(projectId))) !== token) return false;
    return !(await deps.exists(lockKey(projectId)));
  }

  async function snapshotIfChanged(projectId: string, sandbox: PresenceSandbox) {
    try {
      const current = Number((await deps.get(seqKey(projectId))) ?? 0) || 0;
      const { count, lastSeq } = await deps.snapshotState(projectId);
      if (count > 0 && lastSeq >= current) return;
      if (await deps.saveSnapshot(projectId, sandbox, current)) {
        console.log('▸ snapshot saved before stopping', projectId);
      }
    } catch (error) {
      console.log('[LEAVE_SNAPSHOT_FAILED] , ', projectId, String(error).slice(0, 200));
    }
  }

  async function stopIfStillGone(projectId: string, token: string): Promise<'stopped' | 'skipped'> {
    try {
      if (!(await stillGone(projectId, token))) return 'skipped';

      const sandboxId = await deps.sandboxIdFor(projectId);
      const sandbox = sandboxId ? await deps.peek(sandboxId) : null;
      if (!sandbox || sandbox.state !== 'started') {
        await deps.del(projectLeftKey(projectId));
        return 'skipped';
      }

      await snapshotIfChanged(projectId, sandbox);
      if (!(await stillGone(projectId, token))) return 'skipped';

      await deps.del(projectLeftKey(projectId));
      await sandbox.stop();
      deps.detach(projectId);
      lastRefresh.delete(projectId);
      console.log('▸ sandbox stopped after user left', projectId);
      return 'stopped';
    } catch (error) {
      console.log('[SANDBOX_LEAVE_STOP_FAILED] , ', projectId, String(error).slice(0, 200));
      return 'skipped';
    }
  }

  return { leaveTicket, checkLeaveTicket, markPresent, heartbeat, markLeft, stopIfStillGone };
}

const presence = createPresence({
  get: (key) => redis.get(key),
  set: async (key, value, ttlMs) => {
    await redis.set(key, value, { PX: ttlMs });
  },
  del: async (key) => {
    await redis.del(key);
  },
  exists: async (key) => (await redis.exists(key)) > 0,
  sandboxIdFor: knownSandboxId,
  peek: peekSandbox,
  snapshotState: async (projectId) => ({
    count: await prisma.snapshot.count({ where: { projectId } }),
    lastSeq: await lastSnapshotSeq(projectId),
  }),
  saveSnapshot: async (projectId, sandbox, seq) => {
    const entry =
      getCachedSandbox(projectId) ??
      (await registerSandbox(projectId, sandbox as unknown as ProjectSandbox['sandbox']));
    if (!(await isClean(entry))) {
      console.log('▸ leave snapshot skipped: uncommitted changes from an interrupted turn', projectId);
      return false;
    }
    return Boolean(await writeSnapshot(entry, seq));
  },
  detach: detachProject,
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
  },
  now: () => Date.now(),
  graceMs: SANDBOX_LEAVE_GRACE_SECONDS * 1000,
  secret:
    process.env.PRESENCE_SECRET ||
    process.env.SECRETS_MASTER_KEY ||
    process.env.CLERK_SECRET_KEY ||
    randomBytes(32).toString('hex'),
});

export const { leaveTicket, checkLeaveTicket, markPresent, heartbeat, markLeft } = presence;
