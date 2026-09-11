import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  DEV_LOG_PATH,
  PREVIEW_PORT,
  TEMPLATE_GIT_REF,
  TEMPLATE_GIT_URL,
  TEMPLATE_NAME,
  TEMPLATE_SOURCE,
} from '../config';
import { executeCommand, type ProjectSandbox } from './index';

const TEMPLATE_ROOT = resolve(import.meta.dir, '../../../../templates');

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', '.turbo']);

async function collectFiles(dir: string, base: string, out: { path: string; body: Buffer }[]) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      await collectFiles(full, base, out);
    } else if (entry.isFile()) {
      out.push({ path: relative(base, full), body: await readFile(full) });
    }
  }
}

async function uploadBuiltinTemplate(entry: ProjectSandbox) {
  const source = join(TEMPLATE_ROOT, TEMPLATE_NAME);

  const exists = await stat(source).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!exists) throw new Error(`template not found on disk: ${source}`);

  const files: { path: string; body: Buffer }[] = [];
  await collectFiles(source, source, files);

  const dirs = new Set<string>();
  for (const file of files) {
    const parent = dirname(file.path);
    if (parent && parent !== '.') dirs.add(`${entry.rootDir}/${parent}`);
  }
  if (dirs.size > 0) {
    await executeCommand(entry.projectId, `mkdir -p ${[...dirs].map((d) => `'${d}'`).join(' ')}`);
  }

  await entry.sandbox.fs.uploadFiles(
    files.map((file) => ({
      source: file.body,
      destination: `${entry.rootDir}/${file.path}`,
    })),
  );

  console.log(`[TEMPLATE] uploaded ${files.length} files to ${entry.rootDir}`);
}

async function cloneGitTemplate(entry: ProjectSandbox) {
  if (!TEMPLATE_GIT_URL) throw new Error('TEMPLATE_SOURCE=git but TEMPLATE_GIT_URL is not set');

  await entry.sandbox.git.clone(
    TEMPLATE_GIT_URL,
    entry.rootDir,
    TEMPLATE_GIT_REF,
    undefined,
    undefined,
    undefined,
    undefined,
    1,
  );

  await executeCommand(entry.projectId, 'rm -rf .git');

  console.log(`[TEMPLATE] cloned ${TEMPLATE_GIT_URL}@${TEMPLATE_GIT_REF}`);
}

export async function provisionTemplate(entry: ProjectSandbox) {
  await entry.sandbox.fs.createFolder(entry.rootDir, '755').catch(() => undefined);

  if (TEMPLATE_SOURCE === 'snapshot') {
    console.log('[TEMPLATE] sandbox created from baked snapshot, nothing to upload');
    return;
  }

  if (TEMPLATE_SOURCE === 'git') {
    await cloneGitTemplate(entry);
  } else {
    await uploadBuiltinTemplate(entry);
  }

  const install = await executeCommand(entry.projectId, 'npm install -g pnpm && pnpm install');
  if (install.exitCode !== 0) {
    console.log('[TEMPLATE_INSTALL_FAILED] , ', install.output.slice(-2000));
  }
}

const PROBE = `node -e "fetch('http://127.0.0.1:${PREVIEW_PORT}').then(r=>console.log('HTTP'+r.status)).catch(()=>console.log('HTTP000'))"`;

async function probeDevServer(entry: ProjectSandbox): Promise<boolean> {
  const probe = await executeCommand(entry.projectId, PROBE);
  return probe.output.includes('HTTP2') || probe.output.includes('HTTP3');
}

async function startDevServer(entry: ProjectSandbox): Promise<boolean> {
    const previewHost = entry.previewUrl ? new URL(entry.previewUrl).host : '';

  await executeCommand(
    entry.projectId,
    `(PREVIEW_HOST='${previewHost}' nohup npm run dev > ${DEV_LOG_PATH} 2>&1 &) ; sleep 1`,
  );

  for (let attempt = 0; attempt < 35; attempt++) {
    if (await probeDevServer(entry)) return true;
    await Bun.sleep(400);
  }

  const log = await executeCommand(entry.projectId, `tail -n 40 ${DEV_LOG_PATH}`);
  console.log('[DEV_SERVER_TIMEOUT] , ', log.output);
  return false;
}

/**
 * How many bytes the dev server log currently holds.
 *
 * Read at the start of a turn so verification can look at only what that turn appended.
 * Without it the log is cumulative — it is truncated when the dev server starts and the
 * server survives many turns — so an error from the first turn would keep matching on
 * every later one, and verification would report failure forever on turns that were fine.
 *
 * Returns 0 when the file does not exist yet, which reads the whole log. That is the right
 * default: on the first turn there is no earlier noise to exclude.
 */
export async function devLogOffset(projectId: string): Promise<number> {
  const result = await executeCommand(projectId, `wc -c < ${DEV_LOG_PATH} 2>/dev/null || echo 0`);
  const bytes = Number.parseInt(result.output.trim(), 10);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

/** Is the dev server still up? Used before showing a preview and after a crash-y turn. */
async function isDevServerUp(entry: ProjectSandbox): Promise<boolean> {
  return await probeDevServer(entry);
}

/** Bring the dev server back if a turn killed it — otherwise the iframe goes blank. */
export async function ensureDevServer(entry: ProjectSandbox): Promise<boolean> {
  if (await isDevServerUp(entry)) return true;
  return await startDevServer(entry);
}

/**
 * Stop and restart the dev server.
 *
 * Needed when a project's secrets change: Daytona applies new environment variables to
 * newly spawned processes only, so a dev server that was already running keeps the old
 * environment and the user's freshly saved DATABASE_URL is invisible to their app.
 */
export async function restartDevServer(entry: ProjectSandbox): Promise<boolean> {
  await executeCommand(entry.projectId, `pkill -f "next dev" || true; sleep 1`);
  return await startDevServer(entry);
}
