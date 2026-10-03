import { randomUUIDv7 } from 'bun';
import { prisma } from '@repo/db';
import {
  cacheProjectUser,
  cachedProjectUser,
  ensureSeqAtLeast,
  forgetProjectUser,
  getProjectOwner,
  projectSandboxDirtyKey,
  projectSandboxKey,
  redis,
  secretsCacheKey,
  setProjectOwner,
} from '@repo/redis';
import { createMemoryStore } from '@repo/memory';
import { forgetSecrets } from '@repo/shared';
import { BACKEND_ID, HISTORY_PAGE_SIZE, TEMPLATE_NAME } from './config';
import type { Emitter } from './utils/events';
import {
  createSandbox,
  deleteDaytonaSandbox,
  findSandbox,
  forgetSandbox,
  getCachedSandbox,
  getPreviewUrl,
  peekSandbox,
  registerSandbox,
  executeCommand,
  type ProjectSandbox,
} from './sandbox';
import { commitBaseline, prepareWorkingTree } from './sandbox/git';
import { ensureDevServer, provisionTemplate } from './sandbox/template';
import { applySecretsToSandbox } from './utils/secrets';
import { restoreSnapshot } from './utils/snapshot';
import { loadRecentEvents } from './utils/recentEvents';
import type { RecentEvent } from '@repo/memory';

export type AttachResult = {
  entry: ProjectSandbox;
  previewUrl: string | null;
    replayFromSeq: number;
  origin: 'cached' | 'reattached' | 'restored' | 'created';
};

export async function ensureProjectRow(projectId: string): Promise<void> {
  let project: { id: string } | null;
  try {
    project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  } catch (error) {
    if (await cachedProjectUser(projectId).catch(() => null)) return;
    throw error;
  }
  if (!project) throw new Error(`project ${projectId} does not exist`);
}

export async function knownSandboxId(projectId: string): Promise<string | null> {
  const owner = await getProjectOwner(projectId).catch(() => null);
  if (owner?.sandboxId) return owner.sandboxId;
  try {
    const row = await prisma.project.findUnique({ where: { id: projectId }, select: { sandboxId: true } });
    if (row?.sandboxId) await redis.set(projectSandboxKey(projectId), row.sandboxId).catch(() => {});
    return row?.sandboxId ?? null;
  } catch (error) {
    console.log('[SANDBOX_ID_POSTGRES_UNAVAILABLE] using cached id , ', String(error).slice(0, 160));
    return await redis.get(projectSandboxKey(projectId)).catch(() => null);
  }
}

async function rememberSandboxId(projectId: string, sandboxId: string) {
  await redis.set(projectSandboxKey(projectId), sandboxId).catch(() => {});
  try {
    await prisma.project.update({ where: { id: projectId }, data: { sandboxId } });
  } catch (error) {
    console.log('[SANDBOX_ID_DEFERRED] , ', String(error).slice(0, 160));
    await redis.sAdd(projectSandboxDirtyKey, projectId).catch(() => {});
  }
}

export async function flushDirtySandboxIds(): Promise<number> {
  const dirty = await redis.sMembers(projectSandboxDirtyKey);
  for (const projectId of dirty) {
    const sandboxId = await redis.get(projectSandboxKey(projectId));
    if (sandboxId) await prisma.project.updateMany({ where: { id: projectId }, data: { sandboxId } });
    await redis.sRem(projectSandboxDirtyKey, projectId);
  }
  return dirty.length;
}

export async function createProject(ownerId: string, name: string) {
  const project = await prisma.project.create({
    data: { ownerId, name, template: TEMPLATE_NAME },
  });
  await cacheProjectUser(project.id, ownerId).catch(() => {});
  return project;
}

export async function listProjectsForOwner(ownerId: string, limit = 100) {
  return await prisma.project.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
}

export async function renameProject(projectId: string, name: string) {
  return await prisma.project.update({
    where: { id: projectId },
    data: { name },
    select: { id: true, name: true, updatedAt: true },
  });
}

async function seedSequence(projectId: string) {
  try {
    const latest = await prisma.event.aggregate({ where: { projectId }, _max: { seq: true } });
    if (latest._max.seq) await ensureSeqAtLeast(projectId, latest._max.seq);
  } catch (error) {
    console.log('[SEQ_SEED_SKIPPED] , ', String(error).slice(0, 160));
  }
}

export async function attachProject(projectId: string, emitter: Emitter): Promise<AttachResult> {
  await seedSequence(projectId);
  const cached = getCachedSandbox(projectId);
  if (cached) {
    if (await ensureDevServer(cached)) {
      const previewUrl = await getPreviewUrl(projectId);
      if (previewUrl) emitter.stream('preview_ready', { url: previewUrl });
      return {
        entry: cached,
        previewUrl,
        replayFromSeq: await watermarkFor(projectId),
        origin: 'cached',
      };
    }

    console.log('[SANDBOX_STALE] cached handle is unusable, reattaching', projectId);
    forgetSandbox(projectId);
  }

  await ensureProjectRow(projectId);
  emitter.stream('running', { stage: 'attaching sandbox' });

  const known = await knownSandboxId(projectId);

  let origin: AttachResult['origin'] = 'created';
  let entry: ProjectSandbox | null = null;

  if (known) {
    const existing = await findSandbox(known);
    if (existing) {
      entry = await registerSandbox(projectId, existing);
      origin = 'reattached';

      const nmCheck = await executeCommand(
        entry.projectId,
        `test -d node_modules && echo "exists" || echo "missing"`,
      );
      if (nmCheck.output.trim() !== 'exists') {
        console.log('[REATTACH] node_modules missing, restoring snapshot into existing sandbox');
        emitter.stream('running', { stage: 'restoring dependencies' });
        const restoredAt = await restoreSnapshot(entry);
        if (restoredAt === null) {
          await provisionTemplate(entry);
        }
      }
    }
  }

  if (!entry) {
    emitter.stream('running', { stage: 'creating sandbox' });
    const sandbox = await createSandbox(projectId);
    entry = await registerSandbox(projectId, sandbox);

    emitter.stream('running', { stage: 'restoring snapshot' });
    const restoredAt = await restoreSnapshot(entry);

    if (restoredAt === null) {
      emitter.stream('running', { stage: 'scaffolding project' });
      await provisionTemplate(entry);
    } else {
      origin = 'restored';
    }

    await commitBaseline(entry);

    await rememberSandboxId(projectId, sandbox.id);
  }

  const treeState = await prepareWorkingTree(entry);
  if (treeState === 'reset') {
    emitter.stream('running', { stage: 'discarded uncommitted changes from an interrupted turn' });
  }

  const injected = await applySecretsToSandbox(projectId).catch((error) => {
    console.log('[SECRETS_APPLY_FAILED] , ', String(error).slice(0, 160));
    return [] as string[];
  });
  if (injected.length > 0) console.log(`[SECRETS] injected ${injected.length} into ${projectId}`);

  const previewUrl = await getPreviewUrl(projectId);

  emitter.stream('running', { stage: 'starting dev server' });
  const up = await ensureDevServer(entry);

  if (previewUrl && up) emitter.stream('preview_ready', { url: previewUrl });

  await setProjectOwner(projectId, { sandboxId: entry.sandbox.id, ownerId: BACKEND_ID });

  return { entry, previewUrl, replayFromSeq: await watermarkFor(projectId), origin };
}

async function watermarkFor(projectId: string): Promise<number> {
  try {
    const snapshot = await prisma.snapshot.findFirst({
      where: { projectId },
      orderBy: { upToSeq: 'desc' },
      select: { upToSeq: true },
    });
    return snapshot?.upToSeq ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function loadEventsSince(
  projectId: string,
  fromSeq: number,
  limit = 200,
): Promise<{ seq: number; type: string; payload: unknown }[]> {
  if (fromSeq >= Number.MAX_SAFE_INTEGER) return [];
  try {
    return await prisma.event.findMany({
      where: { projectId, seq: { gt: fromSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
  } catch (error) {
    console.log('[REPLAY_POSTGRES_UNAVAILABLE] , ', String(error).slice(0, 160));
    return (await loadRecentEvents(projectId)).filter((event) => event.seq > fromSeq).slice(0, limit);
  }
}

const HISTORY_TYPES = [
  'user_query',
  'text',
  'tool_call',
  'tool_result',
  'question',
  'answer',
  'compaction',
  'summarization',
  'secrets_required',
  'keys_request',
  'keys_status',
  'verification',
  'client_errors',
];

type HistoryEvent = { seq: number; type: string; payload: unknown; createdAt: Date };

function recentAsHistory(events: RecentEvent[], before?: number): HistoryEvent[] {
  return events
    .filter((event) => HISTORY_TYPES.includes(event.type) && (!before || event.seq < before))
    .map((event) => ({ seq: event.seq, type: event.type, payload: event.payload, createdAt: new Date(event.createdAt) }));
}

export async function loadHistory(projectId: string, limit = HISTORY_PAGE_SIZE, before?: number) {
  const recent = await loadRecentEvents(projectId);

  let rows: HistoryEvent[];
  try {
    rows = await prisma.event.findMany({
      where: {
        projectId,
        ...(before ? { seq: { lt: before } } : {}),
        type: { in: HISTORY_TYPES },
      },
      orderBy: { seq: 'desc' },
      take: limit + 1,
    });
  } catch (error) {
    if (recent.length === 0) throw error;
    console.log('[HISTORY_POSTGRES_UNAVAILABLE] serving recent events from memory , ', String(error).slice(0, 160));
    const fallback = recentAsHistory(recent, before).reverse();
    const hasMore = fallback.length > limit;
    return { events: (hasMore ? fallback.slice(0, limit) : fallback).reverse(), hasMore, source: 'memory' as const };
  }

  if (!before) {
    const highest = rows.reduce((max, row) => Math.max(max, row.seq), 0);
    const tail = recentAsHistory(recent).filter((event) => event.seq > highest).reverse();
    rows = [...tail, ...rows];
  }

  const hasMore = rows.length > limit;
  const events = (hasMore ? rows.slice(0, limit) : rows).reverse();

  return { events, hasMore, source: 'postgres' as const };
}

export async function loadClientErrorsSinceLastTurn(projectId: string, limit = 10) {
  const lastQuery = await prisma.event.findFirst({
    where: { projectId, type: 'user_query' },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });

  return await prisma.event.findMany({
    where: {
      projectId,
      type: 'client_errors',
      ...(lastQuery ? { seq: { gt: lastQuery.seq } } : {}),
    },
    orderBy: { seq: 'desc' },
    take: limit,
  });
}

export function detachProject(projectId: string) {
  forgetSandbox(projectId);

  forgetSecrets(projectId);
}

export async function deleteProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return;

  forgetSandbox(projectId);
  forgetSecrets(projectId);

  if (project.sandboxId) {
    await deleteDaytonaSandbox(project.sandboxId);
  }

  await prisma.project.delete({ where: { id: projectId } });
  await forgetProjectUser(projectId).catch(() => {});
  await redis.del([projectSandboxKey(projectId), secretsCacheKey(projectId)]).catch(() => {});
  await createMemoryStore().clearSession(projectId).catch(() => {});
  console.log('[PROJECT_DELETED] , ', projectId);
}

export async function runScriptInProject(projectId: string, script: string): Promise<string | null> {
  let entry = getCachedSandbox(projectId);
  if (!entry) {
    const sandboxId = await knownSandboxId(projectId);
    const sandbox = sandboxId ? await peekSandbox(sandboxId) : null;
    if (!sandbox || sandbox.state !== 'started') return null;
    entry = await registerSandbox(projectId, sandbox);
  }
  const path = `/tmp/probe-${randomUUIDv7()}.cjs`;
  await entry.sandbox.fs.uploadFile(Buffer.from(script), path);
  const result = await executeCommand(projectId, `node ${path}; rm -f ${path}`);
  return result.output;
}
