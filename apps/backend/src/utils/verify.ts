import { DEV_LOG_PATH, DEV_LOG_TAIL_LINES, PREVIEW_PORT } from '../config';
import { executeCommand } from '../sandbox';
import { devLogOffset } from '../sandbox/template';

export type VerificationResult = {
    typecheckPassed: boolean | null;
    typecheckOutput: string;
    runtimeErrors: string[];
    ok: boolean;
};

const MAX_OUTPUT_CHARS = 4000;

const TYPECHECK_COMMAND =
  'if [ -f package.json ] && grep -q \'"typecheck"\' package.json; then npm run typecheck --silent; ' +
  'elif [ -x ./node_modules/.bin/tsc ]; then ./node_modules/.bin/tsc --noEmit; ' +
  'else echo "__NO_TYPECHECK__"; fi';

const ERROR_PATTERNS = [
  ' error ', ' error:', ' error.', ' error,', ' error-', ' error=', ' error"', " error'",
  ' failed ', ' failed:', ' failed.', ' failed,', ' failed-', ' failed=', ' failed"', " failed'",
  'cannot find',
  'module not found',
  'unhandled',
  'exception',
  'ECONN',
  'TypeError',
  'ReferenceError',
  'SyntaxError'
];

const BENIGN = ['compiled successfully', 'ready in', 'no errors', 'fast refresh', 'full reload'];

function looksLikeError(line: string): boolean {
  if (!line.trim()) return false;
  const lowerLine = line.toLowerCase();

  if (BENIGN.some((pattern) => lowerLine.includes(pattern))) return false;

  const paddedLower = ' ' + lowerLine + ' ';

  if (ERROR_PATTERNS.some(pattern => {
    if (pattern.startsWith(' ')) return paddedLower.includes(pattern);
    if (pattern === 'ECONN') return line.includes(pattern);
    if (['TypeError', 'ReferenceError', 'SyntaxError'].includes(pattern)) return line.includes(pattern);
    return lowerLine.includes(pattern);
  })) {
    return true;
  }

  if (line.trim().startsWith('at ') && line.includes(':')) return true;

  return false;
}

async function typecheck(projectId: string): Promise<{ passed: boolean | null; output: string }> {
  const result = await executeCommand(projectId, TYPECHECK_COMMAND);

  if (result.output.includes('__NO_TYPECHECK__')) {
    return { passed: null, output: '' };
  }

  if (result.exitCode === 0) return { passed: true, output: '' };
  if (/^\.next\//m.test(result.output)) {
    await executeCommand(projectId, 'rm -rf .next/types');
    const retry = await executeCommand(projectId, TYPECHECK_COMMAND);
    if (retry.exitCode === 0) return { passed: true, output: '' };
    return { passed: false, output: retry.output.slice(-MAX_OUTPUT_CHARS).trim() };
  }
  return { passed: false, output: result.output.slice(-MAX_OUTPUT_CHARS).trim() };
}

async function readRuntimeErrors(projectId: string, fromByte: number): Promise<string[]> {
  const source =
    fromByte > 0
      ? `tail -c +${fromByte + 1} ${DEV_LOG_PATH} 2>/dev/null | tail -n ${DEV_LOG_TAIL_LINES}`
      : `tail -n ${DEV_LOG_TAIL_LINES} ${DEV_LOG_PATH} 2>/dev/null`;

  const result = await executeCommand(projectId, `${source} || true`);

  const seen = new Set<string>();
  const errors: string[] = [];

  for (const line of result.output.split('\n')) {
    if (!looksLikeError(line)) continue;
    const cleaned = line.trim().slice(0, 500);

    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    errors.push(cleaned);
  }

  return errors.slice(-20);
}

async function probeRoutes(projectId: string, routes: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const route of routes) {
    const script = `fetch('http://127.0.0.1:${PREVIEW_PORT}${route}', { signal: AbortSignal.timeout(60000) }).then((r) => console.log('ROUTE_STATUS:' + r.status)).catch(() => console.log('ROUTE_STATUS:0'))`;
    const result = await executeCommand(projectId, `node -e ${JSON.stringify(script)}`);
    const status = Number(/ROUTE_STATUS:(\d+)/.exec(result.output)?.[1] ?? 0);
    if (status >= 500) failures.push(`GET ${route} returned HTTP ${status} (the page or route crashes when requested)`);
    else if (status === 404) failures.push(`GET ${route} returned HTTP 404: this page or API route does not exist, but the request or this turn's files need it`);
  }
  return failures;
}

export async function verifyProject(projectId: string, fromByte = 0, routes: string[] = []): Promise<VerificationResult> {
  const logFrom = routes.length > 0 ? await devLogOffset(projectId).catch(() => fromByte) : fromByte;
  const routeFailures = routes.length > 0 ? await probeRoutes(projectId, routes) : [];
  const [types, logErrors] = await Promise.all([
    typecheck(projectId),
    readRuntimeErrors(projectId, logFrom),
  ]);
  const runtimeErrors = [...routeFailures, ...logErrors];

  return {
    typecheckPassed: types.passed,
    typecheckOutput: types.output,
    runtimeErrors,

    ok: types.passed !== false && runtimeErrors.length === 0,
  };
}
