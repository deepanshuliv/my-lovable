import { prisma } from '@repo/db';
import { getProjectOwner, setProjectOwner } from '@repo/redis';
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
  registerSandbox,
  executeCommand,
  type ProjectSandbox,
} from './sandbox';
import { commitBaseline, prepareWorkingTree } from './sandbox/git';
import { ensureDevServer, provisionTemplate } from './sandbox/template';
import { applySecretsToSandbox } from './utils/secrets';
import { restoreSnapshot } from './utils/snapshot';

export type AttachResult = {
  entry: ProjectSandbox;
  previewUrl: string | null;
    replayFromSeq: number;
  origin: 'cached' | 'reattached' | 'restored' | 'created';
};

export async function ensureProjectRow(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) throw new Error(`project ${projectId} does not exist`);
  return project;
}

export async function createProject(ownerId: string, name: string) {
  return await prisma.project.create({
    data: { ownerId, name, template: TEMPLATE_NAME },
  });
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

export async function attachProject(projectId: string, emitter: Emitter): Promise<AttachResult> {
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

  const owner = await getProjectOwner(projectId);
  const known =
    owner?.sandboxId ?? (await prisma.project.findUnique({ where: { id: projectId } }))?.sandboxId;

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

    await prisma.project.update({ where: { id: projectId }, data: { sandboxId: sandbox.id } });
  }

  const treeState = await prepareWorkingTree(entry);
  if (treeState === 'reset') {
    emitter.stream('running', { stage: 'discarded uncommitted changes from an interrupted turn' });
  }

  const injected = await applySecretsToSandbox(projectId);
  if (injected.length > 0) console.log(`[SECRETS] injected ${injected.length} into ${projectId}`);

  const previewUrl = await getPreviewUrl(projectId);

  emitter.stream('running', { stage: 'starting dev server' });
  const up = await ensureDevServer(entry);

  if (previewUrl && up) emitter.stream('preview_ready', { url: previewUrl });

  await setProjectOwner(projectId, { sandboxId: entry.sandbox.id, ownerId: BACKEND_ID });

  return { entry, previewUrl, replayFromSeq: await watermarkFor(projectId), origin };
}

async function watermarkFor(projectId: string): Promise<number> {
  const snapshot = await prisma.snapshot.findFirst({
    where: { projectId },
    orderBy: { upToSeq: 'desc' },
    select: { upToSeq: true },
  });
  return snapshot?.upToSeq ?? 0;
}

export async function loadEventsSince(projectId: string, fromSeq: number, limit = 200) {
  return await prisma.event.findMany({
    where: { projectId, seq: { gt: fromSeq } },
    orderBy: { seq: 'asc' },
    take: limit,
  });
}

export async function loadHistory(projectId: string, limit = HISTORY_PAGE_SIZE, before?: number) {

  const rows = await prisma.event.findMany({
    where: {
      projectId,
      ...(before ? { seq: { lt: before } } : {}),
      type: {
        in: [
          'user_query',
          'text',
          'tool_call',
          'tool_result',
          'question',
          'answer',
          'compaction',
          'summarization',
          'secrets_required',
          'verification',
          'client_errors',
        ],
      },
    },

    orderBy: { seq: 'desc' },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const events = (hasMore ? rows.slice(0, limit) : rows).reverse();

  return { events, hasMore };
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
  console.log('[PROJECT_DELETED] , ', projectId);
}
