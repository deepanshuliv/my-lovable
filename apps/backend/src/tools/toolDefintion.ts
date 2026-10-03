import { findImages } from './images';
import { waitForAnswer } from '@repo/redis';
import { QUESTION_TIMEOUT_MS } from '../config';
import { executeCommand, getCachedSandbox } from '../sandbox';
import { isValidSecretKey } from '../utils/secrets';
import { routeNote } from '../agentGuards';

function isSecretProbe(command: string): boolean {
  if (!command) return false;
  const c = command.toLowerCase();

  if (c.includes('printenv')) return true;
  if (c.includes('env ') && (c.includes('|') || c.includes('>'))) return true;
  if (c.endsWith('env')) return true;
  if (c.includes('set ') && c.includes('|')) return true;
  if (c.includes('cat ') && c.includes('.env')) return true;
  if (c.includes('export ') && c.includes('-p')) return true;
  if (c.includes('/proc/') && c.includes('/environ')) return true;

  return false;
}

const DEV_SERVER_KILL = /\b(pkill|killall)\b[^;&|\n]*\b(node|next|npm)\b|\bkill\b[^;&|\n]*\$\(\s*(pgrep|lsof|pidof)\b|\bkill\s+-9\s+-1\b|\bfuser\s+-k\b/;
const DEV_SERVER_START = /(^|[;&|(\s])(npm\s+run\s+dev|npx\s+next\s+dev|next\s+dev|npm\s+start|next\s+start)\b/;

export function devServerCommandError(command: string): string | null {
  if (DEV_SERVER_KILL.test(command)) {
    return 'ERROR: do not stop node or the dev server. The platform runs it on port 3000 with hot reload and restarts it automatically when your work is verified. Fix the code instead; run `npm run typecheck` to check it.';
  }
  if (DEV_SERVER_START.test(command)) {
    return 'ERROR: the dev server is already running on port 3000 with hot reload, managed by the platform. Do not start another one. Check your code with `npm run typecheck`.';
  }
  return null;
}

function commandSegments(command: string): string[] {
  return command
    .split('\n')
    .flatMap(c => c.split(';'))
    .flatMap(c => c.split('||'))
    .flatMap(c => c.split('&&'))
    .flatMap(c => c.split('|'))
    .flatMap(c => c.split('&'))
    .map(c => c.trim())
    .map(c => {
      while (c.startsWith('(') || c.startsWith(' ')) c = c.slice(1);
      return c.trim();
    })
    .map(c => {
      while (c.includes('=') && !c.startsWith('=') && c.indexOf('=') < (c.indexOf(' ') === -1 ? c.length : c.indexOf(' '))) {
        const spaceIdx = c.indexOf(' ');
        if (spaceIdx === -1) return '';
        c = c.slice(spaceIdx + 1).trim();
      }
      return c;
    })
    .filter(Boolean);
}

function hasRedirect(command: string): boolean {
  return command.includes('>') && !command.includes('/dev/null');
}

function isMutatingCommand(command: string): boolean {
  if (hasRedirect(command)) return true;

  return commandSegments(command).some(segment => {
    const c = segment.toLowerCase();
    return c.startsWith('rm ') || c === 'rm' ||
           c.startsWith('rmdir') || c.startsWith('unlink') ||
           c.startsWith('mv ') || c.startsWith('cp ') ||
           c.startsWith('mkdir') || c.startsWith('touch') ||
           c.startsWith('chmod') || c.startsWith('chown') ||
           c.startsWith('sed ') || c.startsWith('perl ') ||
           c.startsWith('nano') || c.startsWith('vim') || c.startsWith('vi ') ||
           c.startsWith('npm i') || c.startsWith('npm remove') || c.startsWith('npm uninstall') ||
           c.startsWith('yarn add') || c.startsWith('yarn remove') ||
           c.startsWith('pnpm add') || c.startsWith('pnpm remove') ||
           c.startsWith('git commit') || c.startsWith('git push') ||
           c.startsWith('git reset') || c.startsWith('git checkout') ||
           c.startsWith('git clean') || c.startsWith('git add') ||
           c.startsWith('kill') || c.startsWith('drop table') || c.startsWith('alter table');
  });
}

async function runBashTool(
  projectId: string,
  command: string,
  mode: 'plan' | 'build' = 'build',
): Promise<string> {
  if (!command || !command.trim()) return 'ERROR: empty command';

  if (isSecretProbe(command)) {
    console.log('[SECRET_PROBE_BLOCKED] , ', projectId, command.slice(0, 200));
    return 'ERROR: refusing to run commands that dump the environment. Project secrets are injected at runtime and are not readable by you. Reference them by name in code (e.g. process.env.DATABASE_URL).';
  }

  const devServerError = devServerCommandError(command);
  if (devServerError) {
    console.log('[DEV_SERVER_COMMAND_BLOCKED] , ', projectId, command.slice(0, 200));
    return devServerError;
  }

  if (mode === 'plan' && isMutatingCommand(command)) {
    console.log('[PLAN_MODE_WRITE_BLOCKED] , ', projectId, command.slice(0, 200));
    return 'ERROR: this is plan mode, which is read-only — that command would change something. Investigate with read-only commands (read_file, list_dir, search_code, bash_tool) and describe the change in your plan instead. The user will switch to build mode to have it implemented.';
  }

  const result = await executeCommand(projectId, command);

  if (result.exitCode !== 0) {
    return `ERROR: exit ${result.exitCode}\n${result.output}`.trimEnd();
  }
  return result.output.trimEnd();
}

async function writeFile(
  projectId: string,
  filePath: string,
  content: string,
  mode: 'plan' | 'build' = 'build',
): Promise<string> {
  if (mode === 'plan') {
    return 'ERROR: plan mode is read-only. Cannot write files.';
  }
  const cleanPath = projectPath(projectId, filePath);
  if (!cleanPath) return 'ERROR: invalid file path';
  const blockedWrite = protectedPathError(cleanPath) ?? routeFileOutsideAppError(cleanPath) ?? (await doubledAppDirError(projectId, cleanPath));
  if (blockedWrite) return blockedWrite;

  const base64 = Buffer.from(content ?? '', 'utf-8').toString('base64');
  const cmd = `mkdir -p "$(dirname "${cleanPath}")" && echo "${base64}" | base64 -d > "${cleanPath}"`;
  const result = await executeCommand(projectId, cmd);
  if (result.exitCode !== 0) {
    return `ERROR writing ${cleanPath}: ${result.output}`;
  }
  const lineCount = (content ?? '').split('\n').length;
  const warning = clientDirectiveWarning(cleanPath, content ?? '') ?? serverFetchWarning(cleanPath, content ?? '') ?? helperLocationNote(cleanPath);
  const note = routeNote(cleanPath);
  return `Successfully wrote ${cleanPath} (${lineCount} lines)${note ? ` ${note}` : ''}${warning ? `\n${warning}` : ''}`;
}

export function normalizeProjectPath(raw: string, rootDir?: string): string {
  let path = String(raw ?? '').trim().replace(/\\/g, '/');
  const roots = rootDir ? [rootDir.replace(/\/$/, ''), rootDir.replace(/^\//, '').replace(/\/$/, '')] : [];
  for (const root of roots) {
    if (root && (path === root || path.startsWith(`${root}/`))) {
      path = path.slice(root.length);
      break;
    }
  }
  while (path.startsWith('./') || path.startsWith('/')) path = path.startsWith('./') ? path.slice(2) : path.slice(1);
  return path;
}

function projectPath(projectId: string, raw: string): string {
  return normalizeProjectPath(raw, getCachedSandbox(projectId)?.rootDir);
}

const NEXT_ROUTE_FILE = /(^|\/)(page|layout|route|loading|error|not-found|template|default)\.(tsx|ts|jsx|js)$/;

export function routeFileOutsideAppError(path: string): string | null {
  if (path.startsWith('app/') || !NEXT_ROUTE_FILE.test(path)) return null;
  if (/^(src\/app|pages)\//.test(path)) return null;
  return `ERROR: ${path} is a Next.js route file, but Next.js only serves route files inside app/. Write it as app/${path} instead.`;
}

async function doubledAppDirError(projectId: string, path: string): Promise<string | null> {
  if (!path.startsWith('app/app/')) return null;
  const exists = await executeCommand(projectId, 'test -d app/app && echo yes || echo no');
  if (exists.output.trim() === 'yes') return null;
  return `ERROR: ${path} would create pages under the URL /app/... . Paths are relative to the project root, and the Next.js app directory is "app/", so the home page is app/page.tsx and /menu is app/menu/page.tsx. Use ${path.slice(4)} instead.`;
}

const EDIT_CONTEXT_CHARS = 6_000;

const PROTECTED_PATHS = new Set(['app/error-reporter.tsx']);

const CLIENT_ONLY = /\b(useState|useEffect|useReducer|useRef|useContext|useLayoutEffect|useTransition|useRouter|usePathname|useSearchParams)\s*[<(]|\son[A-Z][A-Za-z]*=\{/;
const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/;

const RELATIVE_SERVER_FETCH = /fetch\(\s*[`'"]\/[^/]/;

export function helperLocationNote(path: string): string | null {
  const match = /^app\/(lib|components|utils|hooks|types)\/(.+)\.(tsx?|jsx?)$/.exec(path);
  if (!match) return null;
  return `NOTE: ${path} is inside app/. The @/ alias points at the project root, so '@/${match[1]}/${match[2]}' resolves to ${match[1]}/${match[2]}, not to this file. Put shared ${match[1]} at the project root (${match[1]}/${match[2]}.${match[3]}) or import it as '@/app/${match[1]}/${match[2]}'.`;
}

export function serverFetchWarning(path: string, content: string): string | null {
  if (!/\.(tsx|ts|jsx|js)$/.test(path) || !/^app\//.test(path)) return null;
  if (USE_CLIENT.test(content) || !RELATIVE_SERVER_FETCH.test(content)) return null;
  return `WARNING: ${path} runs on the server and calls fetch() with a relative URL such as '/api/...'. On the server there is no base URL, so this throws "Failed to parse URL". Import the data or helper directly from lib/ instead of calling your own API.`;
}

export function clientDirectiveWarning(path: string, content: string): string | null {
  if (!/\.(tsx|jsx)$/.test(path) || !/^(app|components|src)\//.test(path)) return null;
  if (!CLIENT_ONLY.test(content) || USE_CLIENT.test(content)) return null;
  return `WARNING: ${path} uses React hooks or event handlers (e.g. onClick) but does not start with 'use client'. In the Next.js App Router this crashes at runtime ("Event handlers cannot be passed to Client Component props" / hooks only work in Client Components). Add 'use client'; as the very first line, or move the interactive part into a separate client component.`;
}

const PLATFORM_ENV = new Set(['NODE_ENV', 'PORT', 'HOSTNAME', 'NEXT_RUNTIME', 'PREVIEW_HOST', 'CI', 'TZ', 'PATH', 'HOME']);

function protectedPathError(path: string): string | null {
  return PROTECTED_PATHS.has(path)
    ? `ERROR: ${path} is part of the builder's preview integration and must not be changed. Leave it as it is and fix the problem in the app's own files.`
    : null;
}

export function numberedExcerpt(content: string): string {
  const numbered = content
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
  return numbered.length > EDIT_CONTEXT_CHARS
    ? `${numbered.slice(0, EDIT_CONTEXT_CHARS)}\n... [truncated; use read_file with start_line/end_line for the rest]`
    : numbered;
}

async function editFile(
  projectId: string,
  filePath: string,
  targetContent: string,
  replacementContent: string,
  mode: 'plan' | 'build' = 'build',
): Promise<string> {
  if (mode === 'plan') {
    return 'ERROR: plan mode is read-only. Cannot edit files.';
  }
  const cleanPath = projectPath(projectId, filePath);
  if (!cleanPath) return 'ERROR: invalid file path';
  const blockedEdit = protectedPathError(cleanPath) ?? (await doubledAppDirError(projectId, cleanPath));
  if (blockedEdit) return blockedEdit;
  if (!targetContent) return 'ERROR: target_content cannot be empty';

  const readRes = await executeCommand(projectId, `cat "${cleanPath}" 2>/dev/null`);
  if (readRes.exitCode !== 0) {
    return `ERROR: file ${cleanPath} not found`;
  }
  const existing = readRes.output;
  if (!existing.includes(targetContent)) {
    return `ERROR: target_content not found in ${cleanPath}. It must match the file exactly. Current contents:\n${numberedExcerpt(existing)}`;
  }

  const occurrences = existing.split(targetContent).length - 1;
  if (occurrences > 1) {
    return `ERROR: target_content matched ${occurrences} locations in ${cleanPath}. Include more surrounding lines so it matches exactly one place. Current contents:\n${numberedExcerpt(existing)}`;
  }

  const updated = existing.replace(targetContent, replacementContent ?? '');
  const base64 = Buffer.from(updated, 'utf-8').toString('base64');
  const writeRes = await executeCommand(projectId, `echo "${base64}" | base64 -d > "${cleanPath}"`);
  if (writeRes.exitCode !== 0) {
    return `ERROR writing updated ${cleanPath}: ${writeRes.output}`;
  }
  const warning = clientDirectiveWarning(cleanPath, updated) ?? serverFetchWarning(cleanPath, updated);
  return `Successfully updated ${cleanPath} (replaced ${targetContent.split('\n').length} lines with ${(replacementContent ?? '').split('\n').length} lines)${warning ? `\n${warning}` : ''}`;
}

async function readFile(
  projectId: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
  const cleanPath = projectPath(projectId, filePath);
  if (!cleanPath) return 'ERROR: invalid file path';

  const readRes = await executeCommand(projectId, `cat "${cleanPath}" 2>/dev/null`);
  if (readRes.exitCode !== 0) {
    return `ERROR: file ${cleanPath} not found`;
  }
  const lines = readRes.output.split('\n');
  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? lines.length);

  if (start > lines.length) {
    return `ERROR: start_line (${start}) is beyond file length (${lines.length} lines)`;
  }

  const slice = lines.slice(start - 1, end);
  const formatted = slice
    .map((line, idx) => `${start + idx}: ${line}`)
    .join('\n');

  const MAX_CHARS = 12000;
  if (formatted.length > MAX_CHARS) {
    return (
      formatted.slice(0, MAX_CHARS) +
      `\n... [Truncated. File has ${lines.length} lines total. Use start_line/end_line to read specific sections]`
    );
  }
  return formatted;
}

async function listDir(
  projectId: string,
  dirPath: string = '.',
): Promise<string> {
  const cleanPath = projectPath(projectId, dirPath) || '.';
  const cmd = `find "${cleanPath}" -maxdepth 3 -not -path '*/.*' -not -path './node_modules*' -not -path './.next*' -not -path './.git*' -not -path './.turbo*' | sort | head -n 60`;
  const result = await executeCommand(projectId, cmd);
  if (result.exitCode !== 0) return `ERROR: ${result.output}`;
  return result.output.trim() || '(empty directory)';
}

async function searchCode(
  projectId: string,
  query: string,
  searchPath: string = '.',
  include?: string,
): Promise<string> {
  if (!query || !String(query).trim()) return 'ERROR: query cannot be empty';
  const cleanPath = projectPath(projectId, searchPath) || '.';
  const includeFlag = include ? `--include='${include}'` : '';
  const escapedQuery = String(query).split("'").join("'\\''");
  const cmd = `grep -rnI --exclude-dir={node_modules,.next,.git,dist,.turbo,.agents} ${includeFlag} '${escapedQuery}' "${cleanPath}" 2>/dev/null | head -n 40`;
  const result = await executeCommand(projectId, cmd);
  if (!result.output.trim()) {
    return `No matches found for "${query}"`;
  }
  return result.output.trim();
}

async function askQuestion(
  correlationId: string,
  onSubscribed?: () => Promise<void>,
  signal?: AbortSignal,
): Promise<string> {
  return await waitForAnswer(correlationId, QUESTION_TIMEOUT_MS, onSubscribed, signal);
}

export type RequiredSecret = { key: string; reason: string };

function parseKeyRequest(args: Record<string, unknown>): {
  service: string;
  accepted: RequiredSecret[];
  rejected: string[];
  malformed?: boolean;
} {
  const service = String(args.service ?? '').trim() || 'this feature';
  const raw = Array.isArray(args.keys) ? args.keys : Array.isArray(args.secrets) ? args.secrets : null;
  if (!raw) {
    return { service, accepted: [], rejected: [], malformed: true };
  }

  const accepted: RequiredSecret[] = [];
  const rejected: string[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { key, reason } = item as { key?: unknown; reason?: unknown };
    const name = String(key ?? '').trim().toUpperCase();

    if (!isValidSecretKey(name) || PLATFORM_ENV.has(name)) {
      rejected.push(String(key ?? ''));
      continue;
    }
    if (accepted.some((s) => s.key === name)) continue;

    accepted.push({ key: name, reason: String(reason ?? '').trim() || 'required by this project' });
  }

  return { service, accepted, rejected, malformed: false };
}

export const toolCall = {
  write_file: writeFile,
  edit_file: editFile,
  read_file: readFile,
  list_dir: listDir,
  search_code: searchCode,
  find_images: findImages,
  bash_tool: runBashTool,
  question_tool: askQuestion,
  request_api_keys: parseKeyRequest,
};
