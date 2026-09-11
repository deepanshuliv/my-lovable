import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { prisma } from '@repo/db';
import {
  acquireProjectLock,
  clearLiveness,
  connectToRedis,
  projectForQuestion,
  publishAnswer,
  releaseProjectLock,
  startHeartbeat,
  touchLiveness,
} from '@repo/redis';
import { createMemoryStore } from '@repo/memory';
import { isStorageConfigured } from '@repo/storage';
import { runAgent } from './src/agent';
import { isAuthConfigured, requireAuth, requireProjectAccess } from './src/auth';
import {
  BACKEND_ID,
  HISTORY_PAGE_SIZE,
  PORT,
  STRICT_OWNERSHIP,
  TEMPLATE_SOURCE,
} from './src/config';
import { createEmitter, emitDetached } from './src/utils/events';
import { BYOK_MODELS, describeProvider, type ProviderOverride } from './src/providers';
import { deriveTitle, generateProjectTitle } from './src/utils/naming';
import {
  deleteUserKey,
  isProvider,
  isUserKeyStorageConfigured,
  listUserKeys,
  loadUserKey,
  saveUserKey,
} from './src/userKeys';
import type { AgentMode } from './src/sytemPrompt';
import { param } from './src/utils/http';
import {
  attachProject,
  createProject,
  deleteProject,
  detachProject,
  ensureProjectRow,
  listProjectsForOwner,
  loadEventsSince,
  loadHistory,
  renameProject,
} from './src/project';
import { getCachedSandbox, isSandboxConfigured } from './src/sandbox';
import { restartDevServer } from './src/sandbox/template';
import {
  applySecretsToSandbox,
  deleteSecret,
  isSecretsConfigured,
  isValidSecretKey,
  listSecrets,
  registerSecretsForRedaction,
  upsertSecret,
  type SecretSummary,
} from './src/utils/secrets';

const app = express();
app.use(express.json({ limit: '1mb' }));
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const CORS_ANY = ALLOWED_ORIGINS.includes('*');

app.use(cors({ origin: CORS_ANY ? '*' : ALLOWED_ORIGINS }));

await connectToRedis();
const memory = createMemoryStore();

console.log(`[BOOT] backend ${BACKEND_ID}`);

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    backendId: BACKEND_ID,
    model: describeProvider(),
    memory: memory.kind,
    storage: isStorageConfigured() ? 'r2' : 'disabled',
    secrets: isSecretsConfigured() ? 'enabled' : 'disabled',

    auth: isAuthConfigured() ? 'clerk' : 'unconfigured',
    userKeys: isUserKeyStorageConfigured() ? 'enabled' : 'disabled',
    sandbox: isSandboxConfigured() ? 'daytona' : 'unconfigured',
    template: TEMPLATE_SOURCE,

    byokModels: BYOK_MODELS,
  });
});

app.get('/whoami', (_req: Request, res: Response) => {
  res.json({ backendId: BACKEND_ID });
});

app.post('/projects', requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';

  const project = await createProject(userId, deriveTitle(prompt));
  res.status(201).json({ projectId: project.id, name: project.name });

  if (!prompt.trim()) return;

  // Billed to the user's own key when they have one — their project, their call. Detached
  
  void (async () => {
    try {
      const override = await loadUserKey(userId);
      const title = await generateProjectTitle(prompt, override ?? undefined);
      if (title) await renameProject(project.id, title);
    } catch (error) {
      console.log('[TITLE_BACKGROUND_FAILED] , ', String((error as Error).message).slice(0, 200));
    }
  })();
});

app.get('/projects', requireAuth, async (req: Request, res: Response) => {
  const projects = await listProjectsForOwner(req.userId!);
  res.json({ projects });
});

app.patch('/projects/:projectId', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });
  if (!name) return res.status(400).json({ msg: 'name must not be empty' });
  
  if (name.length > 120)
    return res.status(400).json({ msg: 'name must be 120 characters or fewer' });

  const project = await renameProject(projectId, name);
  res.json({ project });
});

app.delete('/projects/:projectId', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });

  const lock = await acquireProjectLock(projectId, BACKEND_ID, !STRICT_OWNERSHIP);
  if (!lock.ok) {
    return res.status(409).json({ msg: 'this project is currently running' });
  }

  try {
    await deleteProject(projectId);
    res.status(204).end();
  } finally {
    await releaseProjectLock(projectId, BACKEND_ID);
  }
});

app.get(
  '/projects/:projectId/history',
  requireProjectAccess,
  async (req: Request, res: Response) => {
    const projectId = param(req, 'projectId');
    if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });

    const rawBefore = req.query.before;
    const parsedBefore = Number.parseInt(String(rawBefore ?? ''), 10);
    // Only a positive integer means anything as a cursor; anything else is treated as "no
    // cursor" rather than rejected, so a stray query string cannot 400 someone's project.
    const before = Number.isFinite(parsedBefore) && parsedBefore > 0 ? parsedBefore : undefined;

    const page = await loadHistory(projectId, HISTORY_PAGE_SIZE, before);

    res.json({ events: page.events, hasMore: page.hasMore });
  },
);

async function byokForUser(userId: string): Promise<ProviderOverride | undefined> {
  try {
    return (await loadUserKey(userId)) ?? undefined;
  } catch (error) {
    
    console.log('[BYOK_LOAD_FAILED] , ', String((error as Error).message).slice(0, 200));
    return undefined;
  }
}

app.post('/chat/:projectId', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const { query, provider: requestedProvider, usePlatform } = req.body;

  const mode: AgentMode = req.body?.mode === 'plan' ? 'plan' : 'build';

  const byok = usePlatform ? undefined : await byokForUser(req.userId!);
  
  const forcePlatformProvider =
    usePlatform && (requestedProvider === 'openrouter' || requestedProvider === 'gemini')
      ? requestedProvider
      : undefined;

  if (!projectId || !query) {
    return res.status(400).json({
      msg: 'please provide valid projectId and query',
    });
  }

  const lock = await acquireProjectLock(projectId, BACKEND_ID, !STRICT_OWNERSHIP);
  if (!lock.ok) {
    return res.status(409).json({
      msg: 'this project is being worked on by another session',
      ownerId: lock.ownerId,
    });
  }

  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream');

  const requestOrigin = req.headers.origin;
  if (CORS_ANY) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Connection', 'keep-alive');

  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders(); 

  await touchLiveness(projectId);

  const emitter = createEmitter(projectId, res);

    let cancelled = false;
  let ownsProject = true;

  const stopHeartbeat = startHeartbeat(projectId, BACKEND_ID, () => {

    console.log('[LOCK_LOST] , ', projectId);
    cancelled = true;
    ownsProject = false;
    emitter.stream('error', { message: 'lost ownership of this project' });
    detachProject(projectId);
    emitter.close();
  });

  res.on('close', () => {
    console.log('client dropped me');
    cancelled = true;
    emitter.close();
  });

  try {
    await ensureProjectRow(projectId);
    const attached = await attachProject(projectId, emitter);

    if (cancelled) return;

        const replayed =
      attached.origin === 'cached'
        ? []
        : (await loadEventsSince(projectId, attached.replayFromSeq)).map(
            (event) => `${event.type}: ${JSON.stringify(event.payload).slice(0, 400)}`,
          );

    await runAgent(
      {
        projectId,
        entry: attached.entry,
        emitter,
        replayed,
        isCancelled: () => cancelled,
        ownsProject: () => ownsProject,
        mode,
        byok,
        forcePlatformProvider,
      },
      query,
    );
  } catch (error) {

    const message = error instanceof Error ? error.message : String(error);
    console.log('[CHAT_ERROR] , ', message);
    emitter.stream('error', { message });
    emitter.close();
  } finally {
    stopHeartbeat();

    if (ownsProject) {
      await clearLiveness(projectId).catch(() => {});
      await releaseProjectLock(projectId, BACKEND_ID).catch(() => {});
    }
  }
});

app.post('/answer/:questionId', requireAuth, async (req: Request, res: Response) => {
  const questionId = param(req, 'questionId');
  const { answer } = req.body;

  if (!questionId) {
    return res.status(400).json({
      msg: 'please provide valid questionId',
    });
  }

  const projectId = await projectForQuestion(questionId);
  if (!projectId) {
    return res.status(400).json({ msg: 'your time period to answer expire' });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  if (!project || project.ownerId !== req.userId) {
    return res.status(404).json({ msg: 'unknown question' });
  }

  console.log('▸ answer', questionId);

  const delivered = await publishAnswer(questionId, String(answer ?? ''));

  if (delivered === 0) {
    return res.status(400).json({
      msg: 'your time period to answer expire',
    });
  }

  res.status(201).json({ msg: 'your response recorded succefully' });
});

app.get(
  '/projects/:projectId/secrets',
  requireProjectAccess,
  async (req: Request, res: Response) => {
    const projectId = param(req, 'projectId');
    if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });

    res.json({ secrets: await listSecrets(projectId), enabled: isSecretsConfigured() });
  },
);

app.put(
  '/projects/:projectId/secrets',
  requireProjectAccess,
  async (req: Request, res: Response) => {
    const projectId = param(req, 'projectId');
    const { key, value } = req.body;

    if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });
    if (!isSecretsConfigured()) {
      return res.status(503).json({ msg: 'secrets storage is not configured on this server' });
    }
    if (typeof key !== 'string' || !isValidSecretKey(key)) {
      return res.status(400).json({ msg: 'key must be an env var name like DATABASE_URL' });
    }
    if (typeof value !== 'string' || value.length === 0) {
      return res.status(400).json({ msg: 'value must be a non-empty string' });
    }

    await ensureProjectRow(projectId);
    const summary = await upsertSecret(projectId, key, value);

    try {
      await applySecretsToSandbox(projectId);
      const attached = getCachedSandbox(projectId);
      if (attached) await restartDevServer(attached);
    } catch (error) {
      console.log('[SECRETS_REAPPLY] , ', String(error).slice(0, 200));
    }

    res.status(201).json({ secret: summary });
  },
);

app.post(
  '/projects/:projectId/secrets/batch',
  requireProjectAccess,
  async (req: Request, res: Response) => {
    const projectId = param(req, 'projectId');
    const entries = req.body?.secrets;

    if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });
    if (!isSecretsConfigured()) {
      return res.status(503).json({ msg: 'secrets storage is not configured on this server' });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ msg: 'please provide a non-empty secrets array' });
    }

    await ensureProjectRow(projectId);

    const saved: SecretSummary[] = [];
    const rejected: { key: string; msg: string }[] = [];

    for (const entry of entries) {
      const key = typeof entry?.key === 'string' ? entry.key.trim().toUpperCase() : '';
      const value = typeof entry?.value === 'string' ? entry.value : '';

      if (!isValidSecretKey(key)) {
        rejected.push({ key, msg: 'key must be an env var name like DATABASE_URL' });
        continue;
      }
      
      if (value.length === 0) continue;

      try {
        saved.push(await upsertSecret(projectId, key, value));
      } catch (error) {
        rejected.push({ key, msg: String(error).slice(0, 200) });
      }
    }

    if (saved.length > 0) {
      try {
        await applySecretsToSandbox(projectId);
        const attached = getCachedSandbox(projectId);
        if (attached) await restartDevServer(attached);
      } catch (error) {
        console.log('[SECRETS_BATCH_REAPPLY] , ', String(error).slice(0, 200));
      }
    }

    res.status(201).json({ secrets: saved, rejected });
  },
);

const clientErrorLimits = new Map<string, { count: number; resetAt: number }>();
function checkClientErrorRateLimit(projectId: string): boolean {
  const now = Date.now();
  const windowMs = 30_000;
  const maxRequests = 20;
  const current = clientErrorLimits.get(projectId);
  if (!current || now > current.resetAt) {
    clientErrorLimits.set(projectId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= maxRequests) {
    return false;
  }
  current.count += 1;
  return true;
}

app.post(
  '/projects/:projectId/client-errors',
  requireProjectAccess,
  async (req: Request, res: Response) => {
    const projectId = param(req, 'projectId');
    const errors = req.body?.errors;

    if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });
    if (!Array.isArray(errors) || errors.length === 0) {
      return res.status(400).json({ msg: 'please provide a non-empty errors array' });
    }

    const capped = errors.slice(0, 20).map((error: unknown) => {
      const item = (error ?? {}) as Record<string, unknown>;
      return {
        level: item.level === 'warn' ? 'warn' : 'error',
        message: String(item.message ?? '').slice(0, 1000),
        source: String(item.source ?? '').slice(0, 300),
      };
    });

    // Server-side rate limit: max 20 batches per 30 seconds per project to prevent
    // runaway render loops from exhausting backend streams or database storage.
    if (!checkClientErrorRateLimit(projectId)) {
      return res.status(429).json({ msg: 'client error rate limit exceeded, throttling' });
    }

        await registerSecretsForRedaction(projectId).catch((error) => {
      console.log('[CLIENT_ERRORS_REDACT_ARM_FAILED] , ', String(error).slice(0, 200));
    });

    await emitDetached(projectId, 'client_errors', { errors: capped });
    console.log('▸ client errors', projectId, capped.length);

    res.status(202).json({ recorded: capped.length });
  },
);

app.delete(
  '/projects/:projectId/secrets/:key',
  requireProjectAccess,
  async (req: Request, res: Response) => {
    const projectId = param(req, 'projectId');
    const key = param(req, 'key');
    if (!projectId || !key)
      return res.status(400).json({ msg: 'please provide valid projectId and key' });

    await deleteSecret(projectId, key);
    await applySecretsToSandbox(projectId).catch(() => {});
    res.status(204).end();
  },
);

app.get('/me/keys', requireAuth, async (req: Request, res: Response) => {
  res.json({
    keys: await listUserKeys(req.userId!),
    enabled: isUserKeyStorageConfigured(),
  });
});

app.put('/me/keys', requireAuth, async (req: Request, res: Response) => {
  const { provider, apiKey, model } = req.body ?? {};

  if (!isUserKeyStorageConfigured()) {
    return res.status(503).json({ msg: 'key storage is not configured on this server' });
  }
  if (!isProvider(provider)) {
    return res.status(400).json({ msg: 'provider must be openrouter or gemini' });
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ msg: 'apiKey must be a non-empty string' });
  }

  try {
    const key = await saveUserKey(
      req.userId!,
      provider,
      apiKey,
      typeof model === 'string' && model.trim() ? model.trim() : null,
    );
    res.status(201).json({ key });
  } catch (error) {

    console.log('[USER_KEY_SAVE_FAILED] , ', String((error as Error).message).slice(0, 200));
    res.status(500).json({ msg: 'could not save that key' });
  }
});

app.delete('/me/keys/:provider', requireAuth, async (req: Request, res: Response) => {
  const provider = param(req, 'provider');
  if (!isProvider(provider)) {
    return res.status(400).json({ msg: 'provider must be openrouter or gemini' });
  }

  await deleteUserKey(req.userId!, provider);
  res.status(204).end();
});

app.post('/projects/:projectId/wake', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });

  const lock = await acquireProjectLock(projectId, BACKEND_ID, !STRICT_OWNERSHIP);
  if (!lock.ok) {
    return res.status(409).json({
      msg: 'this project is being worked on by another session',
      ownerId: lock.ownerId,
    });
  }

  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream');
  const requestOrigin = req.headers.origin;
  if (CORS_ANY) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  await touchLiveness(projectId);
  const emitter = createEmitter(projectId, res);

  let ownsProject = true;
  const stopHeartbeat = startHeartbeat(projectId, BACKEND_ID, () => {
    ownsProject = false;
    emitter.stream('error', { message: 'lost ownership of this project' });
    detachProject(projectId);
    emitter.close();
  });

  try {
    const attach = await attachProject(projectId, emitter);
    if (attach.previewUrl) {
      emitter.stream('preview_ready', { url: attach.previewUrl });
    }
  } catch (error) {
    console.log('[WAKE_FAILED] , ', String(error).slice(0, 200));
  } finally {
    if (ownsProject) {
      stopHeartbeat();
      clearLiveness(projectId).catch(() => {});
      await releaseProjectLock(projectId, BACKEND_ID);
      detachProject(projectId);
    }
    emitter.close();
  }
});

import { getGithubToken, listRepositories, createRepository, pushToGitHub, createOrUpdatePullRequest } from './src/github';

app.get('/github/status', requireAuth, async (req: Request, res: Response) => {
  const token = await getGithubToken(req.userId!);
  res.json({ connected: !!token });
});

app.get('/github/repositories', requireAuth, async (req: Request, res: Response) => {
  const token = await getGithubToken(req.userId!);
  if (!token) return res.status(401).json({ msg: 'GitHub not connected' });

  try {
    const repos = await listRepositories(token);
    res.json({ repositories: repos });
  } catch (error: any) {
    res.status(500).json({ msg: error.message });
  }
});

app.post('/github/repositories', requireAuth, async (req: Request, res: Response) => {
  const token = await getGithubToken(req.userId!);
  if (!token) return res.status(401).json({ msg: 'GitHub not connected' });

  const { name, isPrivate } = req.body;
  if (!name) return res.status(400).json({ msg: 'Repository name is required' });

  try {
    const repo = await createRepository(token, name, isPrivate);
    res.status(201).json({ repository: repo });
  } catch (error: any) {
    res.status(500).json({ msg: error.message });
  }
});

app.get('/projects/:projectId/github', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId')!;
  const conn = await prisma.githubConnection.findUnique({ where: { projectId } });
  res.json({ connection: conn });
});

app.post('/projects/:projectId/github/push', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId')!;
  const token = await getGithubToken(req.userId!);
  if (!token) return res.status(401).json({ msg: 'GitHub not connected' });

  const { repository, title, body } = req.body;
  if (!repository) return res.status(400).json({ msg: 'repository (owner/repo) is required' });

  const lock = await acquireProjectLock(projectId, BACKEND_ID, !STRICT_OWNERSHIP);
  if (!lock.ok) {
    return res.status(409).json({ msg: 'this project is currently running', ownerId: lock.ownerId });
  }

  try {
    let conn = await prisma.githubConnection.findUnique({ where: { projectId } });
    const branch = conn?.branch || `lovable/${projectId}`;
    
    if (!conn) {
      conn = await prisma.githubConnection.create({
        data: { projectId, repository, branch }
      });
    }

    await ensureProjectRow(projectId);
    
    const dummyEmitter = {
      projectId,
      emit: async () => 0,
      stream: () => {},
      lastSeq: () => 0,
      close: () => {},
    };

    const stopHeartbeat = startHeartbeat(projectId, BACKEND_ID, () => {
      detachProject(projectId);
    });

    let attach;
    try {
      attach = await attachProject(projectId, dummyEmitter);
      
      const { commitSha } = await pushToGitHub(attach.entry, repository, branch, token);
      
      const { prNumber, prUrl } = await createOrUpdatePullRequest(token, repository, branch, title || 'Update from Lovable AI', body || 'Automated update from Lovable AI.');

      conn = await prisma.githubConnection.update({
        where: { projectId },
        data: { prNumber, prUrl, lastSyncedCommit: commitSha }
      });

      res.json({ success: true, connection: conn });
    } catch (e: any) {
      console.log('[GITHUB_PUSH_ERROR]', String(e));
      res.status(500).json({ msg: e.message || 'Failed to push to GitHub' });
    } finally {
      stopHeartbeat();
    }
  } finally {
    await releaseProjectLock(projectId, BACKEND_ID);
  }
});

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
