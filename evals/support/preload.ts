import { mock } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { docker, EVAL_IMAGE, EVAL_LABEL, execIn, WORKSPACE } from './docker';

const BACKEND_DIR = resolve(import.meta.dir, '../../apps/backend');

if (process.env.EVAL_LOG_TIMESTAMPS === '1') {
  const original = console.log.bind(console);
  console.log = (...args: unknown[]) => original(`[${new Date().toISOString()}]`, ...args);
}

if (process.env.EVAL_MOCK_AUTH !== '0') mock.module(Bun.resolveSync('@clerk/backend', BACKEND_DIR), () => ({
  verifyToken: async (token: string) => {
    if (token.startsWith('eval_')) return { sub: token };
    throw new Error('invalid eval token');
  },
  createClerkClient: () => ({
    users: { getUserOauthAccessToken: async () => ({ data: [] }) },
  }),
}));

function quote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

class DockerSandbox {
  state = 'started';
  env: Record<string, string> = {};
  sessions = new Map<string, Record<string, string>>();

  constructor(public id: string) {}

  async waitUntilStarted() {}
  async start() {}
  async getUserRootDir() {
    return WORKSPACE;
  }
  async getPreviewLink(port: number) {
    if (process.env.EVAL_PUBLISH_PREVIEW === '1') {
      const mapped = await docker(['port', this.id, `${port}/tcp`]);
      const hostPort = /:(\d+)\s*$/m.exec(mapped.output.trim())?.[1];
      if (hostPort) return { url: `http://127.0.0.1:${hostPort}`, token: '' };
    }
    return { url: `http://${this.id}.eval.local:${port}`, token: '' };
  }
  async updateEnv(env: Record<string, string>, options?: { unset?: string[] }) {
    for (const key of options?.unset ?? []) delete this.env[key];
    Object.assign(this.env, env);
  }
  async delete() {
    await docker(['rm', '-f', this.id]);
  }

  process = {
    createSession: async (sessionId: string) => {
      if (this.sessions.has(sessionId)) throw new Error('session exists');
      this.sessions.set(sessionId, { ...this.env });
    },
    deleteSession: async (sessionId: string) => {
      this.sessions.delete(sessionId);
    },
    executeSessionCommand: async (sessionId: string, request: { command: string }, timeoutSeconds?: number) => {
      const env = this.sessions.get(sessionId);
      if (!env) throw new Error(`no session ${sessionId}`);
      const result = await execIn(this.id, request.command, {
        env,
        timeoutMs: (timeoutSeconds ?? 300) * 1000,
      });
      return { exitCode: result.exitCode, output: result.output };
    },
  };

  fs = {
    uploadFiles: async (files: { source: Buffer; destination: string }[]) => {
      for (const file of files) await this.fs.uploadFile(file.source, file.destination);
    },
    uploadFile: async (source: Buffer, destination: string) => {
      await execIn(this.id, `mkdir -p ${quote(dirname(destination))} && cat > ${quote(destination)}`, {
        input: new Uint8Array(source),
      });
    },
    createFolder: async (path: string) => {
      await execIn(this.id, `mkdir -p ${quote(path)}`);
    },
    downloadFile: async (path: string) => {
      const result = await execIn(this.id, `cat ${quote(path)}`);
      if (result.exitCode !== 0) throw new Error(`download failed: ${path}`);
      return Buffer.from(result.bytes);
    },
  };

  private async runGit(dir: string, args: string) {
    const result = await execIn(this.id, `git ${args}`, { cwd: dir });
    if (result.exitCode !== 0) throw new Error(result.output);
    return result.output;
  }

  git = {
    init: async (dir: string) => {
      await this.runGit(dir, 'init -q');
    },
    configureUser: async (name: string, email: string, _scope: string, dir: string) => {
      await this.runGit(dir, `config user.name ${quote(name)} && git config user.email ${quote(email)}`);
    },
    status: async (dir: string) => {
      const output = await this.runGit(dir, 'status --porcelain');
      return { fileStatus: output.split('\n').filter(Boolean).map((line) => ({ name: line.slice(3) })) };
    },
    add: async (dir: string) => {
      await this.runGit(dir, 'add -A');
    },
    commit: async (dir: string, message: string, _name: string, _email: string, allowEmpty?: boolean) => {
      await this.runGit(dir, `commit -q -m ${quote(message)}${allowEmpty ? ' --allow-empty' : ''}`);
      return { sha: (await this.runGit(dir, 'rev-parse HEAD')).trim() };
    },
    reset: async (dir: string) => {
      await this.runGit(dir, 'reset -q --hard HEAD');
    },
    clone: async () => {
      throw new Error('git templates are not supported in evals');
    },
  };
}

const sandboxes = new Map<string, DockerSandbox>();
let counter = 0;

mock.module(Bun.resolveSync('@daytona/sdk', BACKEND_DIR), () => ({
  Daytona: class {
    async create() {
      const id = `eval-sbx-${Date.now()}-${counter++}`;
      const run = await docker([
        'run', '-d', '--init', '--name', id, '--label', EVAL_LABEL,
        '--memory', '4g', '--cpus', '2',
        ...(process.env.EVAL_PUBLISH_PREVIEW === '1' ? ['-p', '127.0.0.1::3000'] : []),
        EVAL_IMAGE, 'sleep', 'infinity',
      ]);
      if (run.exitCode !== 0) throw new Error(`could not start eval sandbox: ${run.output}`);
      await execIn(id, `cp -a /prebuilt ${WORKSPACE}/app`);
      const sandbox = new DockerSandbox(id);
      sandboxes.set(id, sandbox);
      return sandbox;
    }
    async get(id: string) {
      const sandbox = sandboxes.get(id);
      if (!sandbox) throw new Error(`sandbox ${id} not found`);
      return sandbox;
    }
  },
}));
