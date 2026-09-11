import { Daytona, type Sandbox } from '@daytona/sdk';
import { cachePreviewUrl } from '@repo/redis';
import { redact } from '@repo/shared';
import {
  COMMAND_TIMEOUT_SECONDS,
  PREVIEW_PORT,
  PROJECT_DIR,
  PUBLIC_PREVIEW,
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
    
    if (sandbox.state !== 'started') {
      await sandbox.start();
      await sandbox.waitUntilStarted();
    }
    return sandbox;
  } catch (error) {

    console.log('[SANDBOX_MISS] , ', sandboxId, String(error).split('\n')[0]?.slice(0, 160));
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

/**
 * Run a command inside the project's shell, strictly after every command already queued
 * for that project. Failures are returned, not thrown: the agent needs to read the error
 * text and decide what to do, exactly as a developer would.
 */
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

  // Keep the chain alive even when a command fails, or the project wedges permanently.
  entry.queue = run.catch(() => undefined);
  return await run;
}

/** Resolve (and cache) the public URL Daytona serves the project's dev server on. */
export async function getPreviewUrl(projectId: string): Promise<string | null> {
  const entry = sandboxes.get(projectId);
  if (!entry) return null;
  if (entry.previewUrl) return entry.previewUrl;

  try {
    const link = await entry.sandbox.getPreviewLink(PREVIEW_PORT);
    entry.previewUrl = link.url;

    await cachePreviewUrl(projectId, link.url).catch(() => {});
    return link.url;
  } catch (error) {
    console.log('[PREVIEW_ERROR] , ', error);
    return null;
  }
}

export async function injectSecrets(projectId: string, secrets: Record<string, string>) {
  const entry = sandboxes.get(projectId);
  if (!entry || Object.keys(secrets).length === 0) return;

  try {
    await entry.sandbox.updateEnv(secrets);
  } catch (error) {

    console.log('[SECRETS_INJECT_ERROR] , ', redact(projectId, String(error)).slice(0, 300));
  }
}

export async function deleteSandbox(projectId: string) {
  const entry = sandboxes.get(projectId);
  if (!entry) return;
  await entry.sandbox.delete();
  sandboxes.delete(projectId);
}

export async function deleteDaytonaSandbox(sandboxId: string): Promise<void> {
  try {
    
    await (getDaytona() as any).remove(sandboxId);
    console.log('[SANDBOX_DELETED] , ', sandboxId);
  } catch (error) {
    console.log(
      '[SANDBOX_DELETE_FAILED] , ',
      sandboxId,
      String(error).split('\n')[0]?.slice(0, 160),
    );
  }
}
