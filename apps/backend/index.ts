import { randomUUIDv7 } from 'bun';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { prisma } from '@repo/db';
import {
  acquireProjectLock,
  clearLiveness,
  connectToRedis,
  keysForRequest,
  projectForQuestion,
  publishAnswer,
  releaseProjectLock,
  startHeartbeat,
  touchLiveness,
} from '@repo/redis';
import { createMemoryStore } from '@repo/memory';
import { isStorageConfigured } from '@repo/storage';
import { runAgent } from './src/agent';
import { verifyKeys } from './src/keyVerification';
import { submitKeyRequest } from './src/keyRequest';
import { checkReachability } from './src/sandboxReach';
import { friendlyError } from './src/utils/userErrors';
import { checkLeaveTicket, heartbeat, leaveTicket, markLeft, markPresent } from './src/presence';
import { chargePlatformUsage, clearInflightUsage, getCreditBalance, queuePendingCharge, trackInflightUsage } from './src/credits';
import { startReconciler } from './src/reconciler';
import { startPreviewProxy } from './src/previewProxy';
import { flushRecentEvents } from './src/utils/recentEvents';
import { isAuthConfigured, requireAuth, requireProjectAccess } from './src/auth';
import {
  BACKEND_ID,
  HISTORY_PAGE_SIZE,
  PORT,
  STRICT_OWNERSHIP,
  TEMPLATE_SOURCE,
} from './src/config';
import { createEmitter, emitDetached } from './src/utils/events';
import { BYOK_MODELS, describeProvider, PLATFORM_FREE_ONLY, type ProviderOverride } from './src/providers';
import { DAILY_LIMIT_MESSAGE, freeDailyQuotaExhausted } from './src/freeQuota';
import { deriveTitle, fallbackTitle, generateProjectTitle, looksLikePrompt } from './src/utils/naming';
import {
  deleteUserKey,
  isProvider,
  checkProviderKey,
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
  runScriptInProject,
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

function lockHolder(): string {
  return `${BACKEND_ID}:${randomUUIDv7()}`;
}

const activeRuns = new Map<string, () => void>();

function onClientGone(req: Request, res: Response, callback: () => void) {
  let fired = false;
  const fire = () => {
    if (fired || res.writableEnded) return;
    fired = true;
    callback();
  };
  res.on('close', fire);
  req.on('aborted', fire);
  req.socket?.on('close', fire);
}

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
startReconciler();
startPreviewProxy();

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
  const tidied = await Promise.all(
    projects.map(async (project) => {
      if (!looksLikePrompt(project.name)) return project;
      const better = fallbackTitle(project.name);
      if (!better || better === project.name) return project;
      try {
        await prisma.project.update({ where: { id: project.id }, data: { name: better, updatedAt: project.updatedAt } });
        return { ...project, name: better };
      } catch {
        return project;
      }
    }),
  );
  res.json({ projects: tidied });
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

  const holder = lockHolder();
  const lock = await acquireProjectLock(projectId, holder, !STRICT_OWNERSHIP);
  if (!lock.ok) {
    return res.status(409).json({ msg: 'this project is currently running' });
  }

  await touchLiveness(projectId);
  const stopHeartbeat = startHeartbeat(projectId, holder, () => {});

  try {
    await deleteProject(projectId);
    res.status(204).end();
  } finally {
    stopHeartbeat();
    await clearLiveness(projectId).catch(() => {});
    await releaseProjectLock(projectId, holder);
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

    const before = Number.isFinite(parsedBefore) && parsedBefore > 0 ? parsedBefore : undefined;

    const page = await loadHistory(projectId, HISTORY_PAGE_SIZE, before);

    res.json({ events: page.events, hasMore: page.hasMore, source: page.source });
  },
);

app.get(
  '/projects/:projectId/runtime',
  requireProjectAccess,
  async (req: Request, res: Response) => {
    const projectId = param(req, 'projectId');
    if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });

    const [taskState, latestSummary, eventCount, toolOutputCount, latestRequest] = await Promise.all([
      prisma.taskState.findUnique({ where: { taskId: projectId }, select: { state: true, version: true, updatedAt: true } }),
      prisma.sessionSummary.findFirst({ where: { taskId: projectId }, orderBy: { version: 'desc' }, select: { version: true, coversFromEventSeq: true, coversToEventSeq: true, createdAt: true } }),
      prisma.event.count({ where: { projectId } }),
      prisma.toolOutput.count({ where: { sessionId: projectId } }),
      prisma.event.findFirst({ where: { projectId, type: 'llm_request' }, orderBy: { seq: 'desc' }, select: { payload: true, createdAt: true } }),
    ]);

    res.json({
      taskState: taskState ? { ...(taskState.state as object), version: taskState.version, updatedAt: taskState.updatedAt } : null,
      latestSummary,
      eventCount,
      externalizedToolOutputs: toolOutputCount,
      latestContext: latestRequest ? { payload: latestRequest.payload, createdAt: latestRequest.createdAt } : null,
    });
  },
);

async function byokForUser(userId: string, provider?: unknown): Promise<ProviderOverride | undefined> {
  try {
    return (await loadUserKey(userId, isProvider(provider) ? provider : undefined)) ?? undefined;
  } catch (error) {
    console.log('[BYOK_LOAD_FAILED] , ', String((error as Error).message).slice(0, 200));
    return undefined;
  }
}

app.post('/chat/:projectId', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const { query, provider: requestedProvider, usePlatform } = req.body ?? {};

  if (projectId) await markPresent(projectId);

  if (!projectId || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({
      msg: 'please provide valid projectId and query',
    });
  }

  const mode: AgentMode = req.body?.mode === 'plan' ? 'plan' : 'build';

  const byok = usePlatform ? undefined : await byokForUser(req.userId!, requestedProvider);

  let budgetMicros: number | undefined;
  if (!byok) {
    try {
      const balance = await getCreditBalance(req.userId!);
      if (balance.remainingMicros <= 0) {
        return res.status(402).json({
          msg: 'You have used all your free credits. Ask for more credits, or add your own AI key to keep building.',
          code: 'credits_exhausted',
          credits: balance,
        });
      }
      budgetMicros = balance.remainingMicros;
    } catch (error) {
      console.log('[CREDITS_CHECK_FAILED] , ', String(error).slice(0, 200));
    }
  }

  if (!byok && PLATFORM_FREE_ONLY && (await freeDailyQuotaExhausted())) {
    return res.status(503).json({
      msg: friendlyError(DAILY_LIMIT_MESSAGE),
      code: 'free_daily_limit',
    });
  }

  const forcePlatformProvider = byok || !process.env.OPENROUTER_API_KEY ? undefined : 'openrouter';

  const holder = lockHolder();
  const lock = await acquireProjectLock(projectId, holder, !STRICT_OWNERSHIP);
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

  const stopHeartbeat = startHeartbeat(projectId, holder, () => {
    console.log('[LOCK_LOST] , ', projectId);
    cancelled = true;
    ownsProject = false;
    emitter.stream('error', { message: 'lost ownership of this project' });
    detachProject(projectId);
    emitter.close();
  });

  const cancelRun = () => {
    console.log('[CLIENT_GONE] , ', projectId);
    cancelled = true;
    emitter.close();
  };
  onClientGone(req, res, cancelRun);
  activeRuns.set(projectId, cancelRun);

  let completed = false;
  let usageTimer: ReturnType<typeof setInterval> | undefined;
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

    const run = await runAgent(
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
        budgetMicros,
        onProvider: (provider) => {
          if (byok) return;
          usageTimer = setInterval(() => {
            void trackInflightUsage(req.userId!, holder, provider).catch(() => {});
          }, 2_000);
        },
      },
      query,
    );
    clearInterval(usageTimer);

    if (!byok) {
      try {
        const charged = await chargePlatformUsage(req.userId!, holder, run.provider);
        if (charged > 0) console.log('[CREDITS] charged', req.userId, charged, 'micros');
      } catch (error) {
        console.log('[CREDITS_CHARGE_DEFERRED] , ', String(error).slice(0, 200));
        await queuePendingCharge(req.userId!, holder, run.provider).catch((queueError) => {
          console.log('[CREDITS_CHARGE_LOST] , ', String(queueError).slice(0, 200));
        });
      }
    }
    completed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('[CHAT_ERROR] , ', message);
    emitter.stream('error', { message });
    emitter.close();
  } finally {
    clearInterval(usageTimer);
    if (!byok) await clearInflightUsage(req.userId!, holder).catch(() => {});
    stopHeartbeat();
    if (activeRuns.get(projectId) === cancelRun) activeRuns.delete(projectId);

    if (ownsProject) {
      await clearLiveness(projectId).catch(() => {});
      await releaseProjectLock(projectId, holder).catch(() => {});
    }
    await flushRecentEvents(projectId).catch(() => {});
    if (completed) await emitter.emit('done', {});
    emitter.close();
  }
});

app.post('/chat/:projectId/cancel', requireProjectAccess, (req: Request, res: Response) => {
  const cancel = activeRuns.get(param(req, 'projectId'));
  cancel?.();
  res.status(cancel ? 202 : 204).end();
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
  if (await keysForRequest(questionId)) {
    return res.status(400).json({ msg: 'answer key requests through /keys/:requestId' });
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

app.post('/keys/:requestId', requireAuth, async (req: Request, res: Response) => {
  const result = await submitKeyRequest(
    {
      requestId: param(req, 'requestId') ?? '',
      userId: req.userId!,
      decline: req.body?.decline === true,
      values: req.body?.values,
    },
    {
      projectFor: projectForQuestion,
      keysFor: keysForRequest,
      ownerOf: async (projectId) =>
        (await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } }))?.ownerId ?? null,
      publish: publishAnswer,
      storageReady: isSecretsConfigured,
      verify: (values) => verifyKeys(values),
      reachable: (projectId, values) => checkReachability(values, (script) => runScriptInProject(projectId, script)),
      save: async (projectId, values) => {
        await ensureProjectRow(projectId);
        for (const [key, value] of Object.entries(values)) await upsertSecret(projectId, key, value);
        await applySecretsToSandbox(projectId);
        const attached = getCachedSandbox(projectId);
        if (attached) await restartDevServer(attached);
      },
    },
  );
  if (result.status === 201 && result.body.status === 'verified') console.log('▸ keys verified', param(req, 'requestId'));
  res.status(result.status).json(result.body);
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
    if (!projectId || !isValidSecretKey(key))
      return res.status(400).json({ msg: 'please provide valid projectId and key' });

    await deleteSecret(projectId, key);

    try {
      await applySecretsToSandbox(projectId, [key]);
      const attached = getCachedSandbox(projectId);
      if (attached) await restartDevServer(attached);
    } catch (error) {
      console.log('[SECRETS_DELETE_REAPPLY] , ', String(error).slice(0, 200));
    }
    res.status(204).end();
  },
);

app.get('/me/credits', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json({ credits: await getCreditBalance(req.userId!, true) });
  } catch (error) {
    console.log('[CREDITS_READ_FAILED] , ', String(error).slice(0, 200));
    res.status(503).json({ msg: 'credits are unavailable right now' });
  }
});

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
    return res.status(400).json({ msg: 'Choose OpenRouter, OpenAI or Anthropic.' });
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ msg: 'Paste your API key first.' });
  }

  const keyCheck = await checkProviderKey(provider, apiKey);
  if (!keyCheck.ok) {
    return res.status(400).json({ msg: keyCheck.message });
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
    res.status(500).json({ msg: 'We could not save that key. Please try again.' });
  }
});

app.delete('/me/keys/:provider', requireAuth, async (req: Request, res: Response) => {
  const provider = param(req, 'provider');
  if (!isProvider(provider)) {
    return res.status(400).json({ msg: 'unknown provider' });
  }

  await deleteUserKey(req.userId!, provider);
  res.status(204).end();
});

app.post('/projects/:projectId/heartbeat', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });

  try {
    res.json({ sandbox: await heartbeat(projectId), ticket: leaveTicket(projectId) });
  } catch (error) {
    console.log('[HEARTBEAT_FAILED] , ', projectId, String(error).slice(0, 200));
    res.json({ sandbox: 'none', ticket: leaveTicket(projectId) });
  }
});

app.post('/projects/:projectId/leave', async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  if (!projectId || !checkLeaveTicket(projectId, ticket)) return res.status(204).end();

  await markLeft(projectId).catch((error) => {
    console.log('[LEAVE_FAILED] , ', projectId, String(error).slice(0, 200));
  });
  res.status(204).end();
});

app.post('/projects/:projectId/wake', requireProjectAccess, async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });
  await markPresent(projectId);

  const holder = lockHolder();
  const lock = await acquireProjectLock(projectId, holder, !STRICT_OWNERSHIP);
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
  const stopHeartbeat = startHeartbeat(projectId, holder, () => {
    ownsProject = false;
    emitter.stream('error', { message: 'lost ownership of this project' });
    detachProject(projectId);
    emitter.close();
  });

  let attached = false;
  try {
    const attach = await attachProject(projectId, emitter);
    attached = true;
    if (attach.previewUrl) {
      emitter.stream('preview_ready', { url: attach.previewUrl });
    }
  } catch (error) {
    console.log('[WAKE_FAILED] , ', String(error).slice(0, 200));
  } finally {
    stopHeartbeat();
    if (ownsProject) {
      await clearLiveness(projectId).catch(() => {});
      await releaseProjectLock(projectId, holder);
      if (!attached) detachProject(projectId);
    }
    emitter.close();
  }
});

import { getGithubToken, getGithubIdentity, isRepositoryEmpty, listRepositories, createRepository, pushToGitHub, createOrUpdatePullRequest } from './src/github';

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
    res.status(500).json({ msg: friendlyError(String(error?.message ?? 'GitHub request failed')) });
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
    res.status(500).json({ msg: friendlyError(String(error?.message ?? 'GitHub request failed')) });
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
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return res.status(400).json({ msg: 'repository (owner/repo) is required' });
  }

  const holder = lockHolder();
  const lock = await acquireProjectLock(projectId, holder, !STRICT_OWNERSHIP);
  if (!lock.ok) {
    return res.status(409).json({ msg: 'this project is currently running', ownerId: lock.ownerId });
  }

  await touchLiveness(projectId);

  try {
    let conn = await prisma.githubConnection.findUnique({ where: { projectId } });
    const switching = !conn || conn.repository !== repository;
    const emptyRepo = switching ? await isRepositoryEmpty(token, repository).catch(() => false) : false;
    const branch = switching ? (emptyRepo ? 'main' : `inkling/${projectId}`) : conn!.branch;

    if (!conn) {
      conn = await prisma.githubConnection.create({
        data: { projectId, repository, branch }
      });
    } else if (conn.repository !== repository) {
      conn = await prisma.githubConnection.update({
        where: { projectId },
        data: { repository, branch, prNumber: null, prUrl: null, lastSyncedCommit: null },
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

    const stopHeartbeat = startHeartbeat(projectId, holder, () => {
      detachProject(projectId);
    });

    let attach;
    try {
      attach = await attachProject(projectId, dummyEmitter);

      const author = await getGithubIdentity(token);
      const { commitSha } = await pushToGitHub(attach.entry, repository, branch, token, author, branch !== 'main');

      const { prNumber, prUrl } = await createOrUpdatePullRequest(token, repository, branch, title || 'Update from Inkling', body || 'Changes made with Inkling.');

      conn = await prisma.githubConnection.update({
        where: { projectId },
        data: { prNumber, prUrl, lastSyncedCommit: commitSha }
      });

      res.json({ success: true, connection: conn });
    } catch (e: any) {
      const message = String(e?.message || 'Failed to push to GitHub').split(token).join('***');
      console.log('[GITHUB_PUSH_ERROR]', message);
      res.status(500).json({ msg: friendlyError(message) });
    } finally {
      stopHeartbeat();
    }
  } finally {
    await clearLiveness(projectId).catch(() => {});
    await releaseProjectLock(projectId, holder);
  }
});

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
