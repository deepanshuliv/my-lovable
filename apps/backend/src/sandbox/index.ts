import { Daytona, type Sandbox } from '@daytona/sdk';
import { cachePreviewToken, cachePreviewUrl } from '@repo/redis';
import { proxiedPreviewUrl } from '../previewProxy';
import { redact } from '@repo/shared';
import {
  COMMAND_TIMEOUT_SECONDS,
  PREVIEW_PORT,
  PROJECT_DIR,
  PUBLIC_PREVIEW,
  SANDBOX_AUTO_ARCHIVE_MINUTES,
  SANDBOX_AUTO_DELETE_MINUTES,
  SANDBOX_AUTO_STOP_MINUTES,
  SANDBOX_CPU,
  SANDBOX_DISK_GIB,
  SANDBOX_IMAGE,
  SANDBOX_MEMORY_GIB,
  TEMPLATE_SNAPSHOT,
  TEMPLATE_SOURCE,
} from '../config';

export type ProjectSandbox = {
  projectId: string;
  sandbox: Sandbox;
  sessionId: string;
    rootDir: string;
  previewUrl: string | null;
  previewToken?: string | null;
    queue: Promise<unknown>;
};

export type CommandResult = {
  output: string;
  exitCode: number;
};

let daytonaClient: Daytona | null = null;

export function isSandboxConfigured(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY || process.env.DAYTON_API_KEY);
}

function getDaytona(): Daytona {
  if (daytonaClient) return daytonaClient;

  if (!isSandboxConfigured()) {
    throw new Error('DAYTONA_API_KEY is not set — cannot create or attach a sandbox');
  }

  daytonaClient = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY || process.env.DAYTON_API_KEY,
  });
  return daytonaClient;
}

const sandboxes = new Map<string, ProjectSandbox>();

export function getCachedSandbox(projectId: string): ProjectSandbox | undefined {
  return sandboxes.get(projectId);
}

export function forgetSandbox(projectId: string) {
  sandboxes.delete(projectId);
}

export async function createSandbox(projectId: string): Promise<Sandbox> {
  const base = {
    labels: { env: 'dev', projectId },
    envVars: { NODE_ENV: 'development' },
    public: PUBLIC_PREVIEW,
    autoStopInterval: SANDBOX_AUTO_STOP_MINUTES,
    autoArchiveInterval: SANDBOX_AUTO_ARCHIVE_MINUTES,
    autoDeleteInterval: SANDBOX_AUTO_DELETE_MINUTES,
  };

  const sandbox =
    TEMPLATE_SOURCE === 'snapshot' && TEMPLATE_SNAPSHOT
      ? await getDaytona().create({ ...base, snapshot: TEMPLATE_SNAPSHOT })
      :         await getDaytona().create({
          ...base,
          image: SANDBOX_IMAGE,
          resources: { cpu: SANDBOX_CPU, memory: SANDBOX_MEMORY_GIB, disk: SANDBOX_DISK_GIB },
        });

  await sandbox.waitUntilStarted();
  return sandbox;
}

export async function findSandbox(sandboxId: string): Promise<Sandbox | null> {
  try {
    const sandbox = await getDaytona().get(sandboxId);
    if (!(await prepareForUse(sandbox))) {
      console.log('[SANDBOX_UNUSABLE] , ', sandboxId, sandbox.state);
      return null;
    }
    await applyLifecycle(sandbox);
    return sandbox;
  } catch (error) {
    console.log('[SANDBOX_MISS] , ', sandboxId, String(error).split('\n')[0]?.slice(0, 160));
    return null;
  }
}

const ARCHIVED_START_TIMEOUT_SECONDS = 300;
const TRANSITION_TIMEOUT_SECONDS = 120;

export type LifecycleSandbox = {
  id: string;
  state?: string;
  autoStopInterval?: number;
  autoArchiveInterval?: number;
  autoDeleteInterval?: number;
  start: (timeout?: number) => Promise<void>;
  waitUntilStarted: (timeout?: number) => Promise<void>;
  waitUntilStopped: (timeout?: number) => Promise<void>;
  refreshData: () => Promise<void>;
  setAutostopInterval: (minutes: number) => Promise<void>;
  setAutoArchiveInterval: (minutes: number) => Promise<void>;
  setAutoDeleteInterval: (minutes: number) => Promise<void>;
};

const UNUSABLE_STATES = new Set(['destroyed', 'destroying', 'error', 'build_failed', 'unknown']);
const BOOTING_STATES = new Set(['starting', 'restoring', 'creating', 'pulling_snapshot', 'resuming', 'pending_build', 'building_snapshot']);

export async function prepareForUse(
  sandbox: LifecycleSandbox,
  sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
): Promise<boolean> {
  if (sandbox.state === 'started') return true;
  if (UNUSABLE_STATES.has(sandbox.state ?? 'unknown')) return false;

  if (BOOTING_STATES.has(sandbox.state ?? '')) {
    await sandbox.waitUntilStarted(ARCHIVED_START_TIMEOUT_SECONDS);
    return true;
  }

  if (sandbox.state === 'stopping') {
    await sandbox.waitUntilStopped(TRANSITION_TIMEOUT_SECONDS);
  }

  if (sandbox.state === 'archiving') {
    const deadline = Date.now() + TRANSITION_TIMEOUT_SECONDS * 1000;
    while (sandbox.state === 'archiving' && Date.now() < deadline) {
      await sleep(2_000);
      await sandbox.refreshData();
    }
    if (sandbox.state === 'archiving') return false;
  }

  const timeout = sandbox.state === 'archived' ? ARCHIVED_START_TIMEOUT_SECONDS : TRANSITION_TIMEOUT_SECONDS;
  await sandbox.start(timeout);
  await sandbox.waitUntilStarted(timeout);
  return true;
}

export async function applyLifecycle(sandbox: LifecycleSandbox): Promise<void> {
  const updates: [string, number | undefined, number, (value: number) => Promise<void>][] = [
    ['autoStop', sandbox.autoStopInterval, SANDBOX_AUTO_STOP_MINUTES, (v) => sandbox.setAutostopInterval(v)],
    ['autoArchive', sandbox.autoArchiveInterval, SANDBOX_AUTO_ARCHIVE_MINUTES, (v) => sandbox.setAutoArchiveInterval(v)],
    ['autoDelete', sandbox.autoDeleteInterval, SANDBOX_AUTO_DELETE_MINUTES, (v) => sandbox.setAutoDeleteInterval(v)],
  ];
  for (const [name, current, wanted, set] of updates) {
    if (current === wanted) continue;
    await set(wanted).catch((error) => {
      console.log('[SANDBOX_LIFECYCLE_UPDATE_FAILED] , ', name, sandbox.id, String(error).slice(0, 160));
    });
  }
}

export async function peekSandbox(sandboxId: string): Promise<Sandbox | null> {
  try {
    return await getDaytona().get(sandboxId);
  } catch (error) {
    console.log('[SANDBOX_PEEK_MISS] , ', sandboxId, String(error).split('\n')[0]?.slice(0, 160));
    return null;
  }
}

export async function registerSandbox(
  projectId: string,
  sandbox: Sandbox,
): Promise<ProjectSandbox> {
  const userRoot = (await sandbox.getUserRootDir()) || '/home/daytona';
  const rootDir = `${userRoot.replace(/\/$/, '')}/${PROJECT_DIR}`;

  const sessionId = `project-${projectId}`;
  try {
    await sandbox.process.createSession(sessionId);
  } catch (error) {
    console.log('[SANDBOX_SESSION] reusing session for', projectId, String(error).slice(0, 120));
  }

  const entry: ProjectSandbox = {
    projectId,
    sandbox,
    sessionId,
    rootDir,
    previewUrl: null,
    queue: Promise.resolve(),
  };

  sandboxes.set(projectId, entry);
  return entry;
}

function cleanOutput(raw: string): string {
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export async function executeCommand(projectId: string, command: string): Promise<CommandResult> {
  const entry = sandboxes.get(projectId);
  if (!entry) throw new Error(`no sandbox attached for project ${projectId}`);

  const run = entry.queue.then(async (): Promise<CommandResult> => {
    try {
      const response = await entry.sandbox.process.executeSessionCommand(
        entry.sessionId,
        { command: `mkdir -p ${entry.rootDir} && cd ${entry.rootDir} && { ${command}\n}` },
        COMMAND_TIMEOUT_SECONDS,
      );

      const output =
        response.output ?? [response.stdout, response.stderr].filter(Boolean).join('\n');
      return { output: cleanOutput(output ?? ''), exitCode: response.exitCode ?? 0 };
    } catch (error) {
      return { output: `ERROR: ${error}`, exitCode: 1 };
    }
  });

  entry.queue = run.catch(() => undefined);
  return await run;
}

export async function getPreviewUrl(projectId: string): Promise<string | null> {
  const entry = sandboxes.get(projectId);
  if (!entry) return null;

  if (!entry.previewUrl) {
    try {
      const link = await entry.sandbox.getPreviewLink(PREVIEW_PORT);
      entry.previewUrl = link.url;
      entry.previewToken = link.token || null;
    } catch (error) {
      console.log('[PREVIEW_ERROR] , ', error);
      return null;
    }
  }

  await cachePreviewUrl(projectId, entry.previewUrl).catch(() => {});
  if (entry.previewToken) await cachePreviewToken(projectId, entry.previewToken).catch(() => {});
  return proxiedPreviewUrl(projectId) ?? entry.previewUrl;
}

export async function injectSecrets(
  projectId: string,
  secrets: Record<string, string>,
  unset: string[] = [],
) {
  const entry = sandboxes.get(projectId);
  if (!entry || (Object.keys(secrets).length === 0 && unset.length === 0)) return;

  try {
    await entry.sandbox.updateEnv(secrets, unset.length > 0 ? { unset } : undefined);
  } catch (error) {
    console.log('[SECRETS_INJECT_ERROR] , ', redact(projectId, String(error)).slice(0, 300));
    return;
  }

  const recreate = entry.queue.then(async () => {
    await entry.sandbox.process.deleteSession(entry.sessionId).catch(() => {});
    await entry.sandbox.process.createSession(entry.sessionId);
  });
  entry.queue = recreate.catch((error) => {
    console.log('[SANDBOX_SESSION_RECREATE] , ', String(error).slice(0, 200));
  });
  await entry.queue;
}

export async function deleteDaytonaSandbox(sandboxId: string): Promise<void> {
  try {
    const sandbox = await getDaytona().get(sandboxId);
    await sandbox.delete();
    console.log('[SANDBOX_DELETED] , ', sandboxId);
  } catch (error) {
    console.log(
      '[SANDBOX_DELETE_FAILED] , ',
      sandboxId,
      String(error).split('\n')[0]?.slice(0, 160),
    );
  }
}
