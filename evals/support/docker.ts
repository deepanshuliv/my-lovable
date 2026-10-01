export const EVAL_IMAGE = process.env.EVAL_SANDBOX_IMAGE || 'my-lovable-eval-sandbox';
export const EVAL_LABEL = 'my-lovable-eval=1';
export const WORKSPACE = '/workspace';

export type DockerResult = { exitCode: number; output: string; bytes: Uint8Array };

export async function docker(
  args: string[],
  options: { input?: Uint8Array; timeoutMs?: number } = {},
): Promise<DockerResult> {
  const proc = Bun.spawn(['docker', ...args], {
    stdin: options.input ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (options.input) {
    proc.stdin!.write(options.input);
    await proc.stdin!.end();
  }
  const timer = options.timeoutMs ? setTimeout(() => proc.kill(), options.timeoutMs) : null;
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  const bytes = new Uint8Array(stdout);
  return { exitCode, output: `${new TextDecoder().decode(bytes)}${stderr}`, bytes };
}

export async function execIn(
  container: string,
  command: string,
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; input?: Uint8Array } = {},
): Promise<DockerResult> {
  const envArgs = Object.entries(options.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return await docker(
    ['exec', ...(options.input ? ['-i'] : []), ...envArgs, '-w', options.cwd ?? WORKSPACE, container, 'bash', '-c', command],
    { input: options.input, timeoutMs: options.timeoutMs },
  );
}

export async function removeEvalContainers(): Promise<number> {
  const listed = await docker(['ps', '-aq', '--filter', `label=${EVAL_LABEL}`]);
  const ids = listed.output.split('\n').map((line) => line.trim()).filter(Boolean);
  if (ids.length > 0) await docker(['rm', '-f', ...ids]);
  return ids.length;
}
