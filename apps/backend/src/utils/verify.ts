import { DEV_LOG_PATH, DEV_LOG_TAIL_LINES } from '../config';
import { executeCommand } from '../sandbox';

export type VerificationResult = {
    typecheckPassed: boolean | null;
    typecheckOutput: string;
    runtimeErrors: string[];
    ok: boolean;
};

const MAX_OUTPUT_CHARS = 4000;

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

const BENIGN = ['compiled successfully', 'ready in', 'no errors'];

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
  const result = await executeCommand(
    projectId,
    'if [ -f package.json ] && grep -q \'"typecheck"\' package.json; then npm run typecheck --silent; ' +
      'elif [ -x ./node_modules/.bin/tsc ]; then ./node_modules/.bin/tsc --noEmit; ' +
      'else echo "__NO_TYPECHECK__"; fi',
  );

  if (result.output.includes('__NO_TYPECHECK__')) {
    return { passed: null, output: '' };
  }

  if (result.exitCode === 0) return { passed: true, output: '' };
  return { passed: false, output: result.output.slice(-MAX_OUTPUT_CHARS).trim() };
}

/**
 * Read the part of the dev server log this turn produced.
 *
 * `fromByte` is the log's size captured before the turn started. Reading from there is
 * what makes the result *this turn's* errors rather than every error since the dev server
 * booted — the log is only truncated on start, and the server outlives many turns, so a
 * plain `tail` would keep re-reporting a failure the agent already fixed and verification
 * would never go green again.
 *
 * `tail -c +N` is 1-indexed, hence the `+ 1`.
 */
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

export async function verifyProject(projectId: string, fromByte = 0): Promise<VerificationResult> {
  const [types, runtimeErrors] = await Promise.all([
    typecheck(projectId),
    readRuntimeErrors(projectId, fromByte),
  ]);

  return {
    typecheckPassed: types.passed,
    typecheckOutput: types.output,
    runtimeErrors,
    
    ok: types.passed !== false && runtimeErrors.length === 0,
  };
}
