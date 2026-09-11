import type { ProjectSandbox } from './index';

const AUTHOR_NAME = 'my-lovable agent';
const AUTHOR_EMAIL = 'agent@my-lovable.local';

async function initRepo(entry: ProjectSandbox) {
  try {
    await entry.sandbox.git.init(entry.rootDir);
  } catch (error) {
    
    console.log('[GIT_INIT] , ', String(error).slice(0, 120));
  }

  try {
    await entry.sandbox.git.configureUser(AUTHOR_NAME, AUTHOR_EMAIL, 'local', entry.rootDir);
  } catch (error) {
    console.log('[GIT_CONFIG] , ', String(error).slice(0, 120));
  }
}

async function isClean(entry: ProjectSandbox): Promise<boolean> {
  try {
    const status = await entry.sandbox.git.status(entry.rootDir);
    return (status.fileStatus?.length ?? 0) === 0;
  } catch (error) {
    console.log('[GIT_STATUS] , ', String(error).slice(0, 120));
    
    return false;
  }
}

async function resetToLastCommit(entry: ProjectSandbox): Promise<boolean> {
  const hasCommit = await entry.sandbox.process
    .executeSessionCommand(entry.sessionId, {
      command: `cd ${entry.rootDir} && git rev-parse --verify HEAD`,
    })
    .then((r) => (r.exitCode ?? 1) === 0)
    .catch(() => false);

  if (!hasCommit) return false;

  try {
    await entry.sandbox.git.reset(entry.rootDir, 'hard', 'HEAD');

    await entry.sandbox.process.executeSessionCommand(entry.sessionId, {
      command: `cd ${entry.rootDir} && git clean -fd`,
    });
    return true;
  } catch (error) {
    console.log('[GIT_RESET] , ', String(error).slice(0, 200));
    return false;
  }
}

export async function commitAll(entry: ProjectSandbox, message: string): Promise<string | null> {
  try {
    await entry.sandbox.git.add(entry.rootDir, ['.']);
    const result = await entry.sandbox.git.commit(
      entry.rootDir,
      message,
      AUTHOR_NAME,
      AUTHOR_EMAIL,

      true,
    );
    return result.sha ?? null;
  } catch (error) {
    console.log('[GIT_COMMIT] , ', String(error).slice(0, 200));
    return null;
  }
}

export async function prepareWorkingTree(entry: ProjectSandbox): Promise<'clean' | 'reset' | 'fresh'> {
  await initRepo(entry);

  if (await isClean(entry)) return 'clean';

  const didReset = await resetToLastCommit(entry);
  return didReset ? 'reset' : 'fresh';
}

export async function commitBaseline(entry: ProjectSandbox): Promise<void> {
  await initRepo(entry);

  const hasCommit = await entry.sandbox.process
    .executeSessionCommand(entry.sessionId, {
      command: `cd ${entry.rootDir} && git rev-parse --verify HEAD`,
    })
    .then((r) => (r.exitCode ?? 1) === 0)
    .catch(() => false);

  if (hasCommit) return;

  const sha = await commitAll(entry, 'scaffold project template');
  if (sha) console.log('[GIT] baseline commit', sha.slice(0, 8));
}
