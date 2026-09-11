/**
 * Bake a Daytona snapshot from the project template.
 *
 * This is the answer to "should the starter live in GitHub or be initialised fresh every
 * time?" — neither, in the end. Both of those pay a full `npm install` on every new
 * project, which is the expensive part: a few hundred packages resolved over the network
 * while the user watches a spinner.
 *
 * Instead the install happens exactly once, here, and the result is frozen into a
 * snapshot. Creating a sandbox from it starts with `node_modules` already on disk, so a
 * new project goes from a minute or two to seconds.
 *
 * The template in git stays the source of truth — this reads from it. Rebake whenever the
 * template's dependencies change:
 *
 *   bun scripts/bake-snapshot.ts
 *   # then set in .env:
 *   TEMPLATE_SOURCE=snapshot
 *   TEMPLATE_SNAPSHOT=<the name printed below>
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Daytona } from '@daytona/sdk';

const TEMPLATE_NAME = process.env.TEMPLATE_NAME || 'nextjs-fullstack';
const PROJECT_DIR = process.env.PROJECT_DIR || 'app';
const SNAPSHOT_NAME = process.env.TEMPLATE_SNAPSHOT || `${TEMPLATE_NAME}-${new Date().toISOString().slice(0, 10)}`;

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist']);

async function collect(dir: string, base: string, out: { path: string; body: Buffer }[]) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, base, out);
    else if (entry.isFile()) out.push({ path: relative(base, full), body: await readFile(full) });
  }
}

async function main() {
  const source = resolve(import.meta.dir, '..', 'templates', TEMPLATE_NAME);
  const exists = await stat(source).then((s) => s.isDirectory(), () => false);
  if (!exists) throw new Error(`template not found: ${source}`);

  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY || process.env.DAYTON_API_KEY });

  console.log('▸ creating a sandbox to bake in');
  const sandbox = await daytona.create({ language: 'typescript', labels: { env: 'bake' } });
  await sandbox.waitUntilStarted();

  const userRoot = (await sandbox.getUserRootDir()) || '/home/daytona';
  const rootDir = `${userRoot.replace(/\/$/, '')}/${PROJECT_DIR}`;

  const files: { path: string; body: Buffer }[] = [];
  await collect(source, source, files);

  console.log(`▸ uploading ${files.length} template files to ${rootDir}`);
  await sandbox.fs.createFolder(rootDir, '755').catch(() => undefined);
  await sandbox.fs.uploadFiles(
    files.map((f) => ({ source: f.body, destination: `${rootDir}/${f.path}` })),
  );

  console.log('▸ installing dependencies (this is the part we are caching)');
  const install = await sandbox.process.executeCommand(
    'npm install --no-audit --no-fund',
    rootDir,
    undefined,
    900,
  );
  if (install.exitCode !== 0) {
    console.error(install.result);
    throw new Error('npm install failed — not baking a broken snapshot');
  }

  // Warm the Next build cache too: the first `next dev` otherwise spends time compiling
  // that the user would sit through.
  console.log('▸ warming the build cache');
  await sandbox.process.executeCommand('npm run build || true', rootDir, undefined, 900);

  console.log(`▸ creating snapshot ${SNAPSHOT_NAME}`);
  await sandbox.createSnapshot(SNAPSHOT_NAME);

  console.log('▸ cleaning up the bake sandbox');
  await sandbox.delete();

  console.log(`\n✓ done. Set these in .env:\n  TEMPLATE_SOURCE=snapshot\n  TEMPLATE_SNAPSHOT=${SNAPSHOT_NAME}\n`);
}

await main();
