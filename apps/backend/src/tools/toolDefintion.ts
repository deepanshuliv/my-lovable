import { waitForAnswer } from '@repo/redis';
import { QUESTION_TIMEOUT_MS } from '../config';
import { executeCommand } from '../sandbox';
import { isValidSecretKey } from '../utils/secrets';

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
  let cleanPath = String(filePath ?? '').trim();
  while (cleanPath.startsWith('./') || cleanPath.startsWith('/')) {
    cleanPath = cleanPath.startsWith('./') ? cleanPath.slice(2) : cleanPath.slice(1);
  }
  if (!cleanPath) return 'ERROR: invalid file path';

  const base64 = Buffer.from(content ?? '', 'utf-8').toString('base64');
  const cmd = `mkdir -p "$(dirname "${cleanPath}")" && echo "${base64}" | base64 -d > "${cleanPath}"`;
  const result = await executeCommand(projectId, cmd);
  if (result.exitCode !== 0) {
    return `ERROR writing ${cleanPath}: ${result.output}`;
  }
  const lineCount = (content ?? '').split('\n').length;
  return `Successfully wrote ${cleanPath} (${lineCount} lines)`;
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
  let cleanPath = String(filePath ?? '').trim();
  while (cleanPath.startsWith('./') || cleanPath.startsWith('/')) {
    cleanPath = cleanPath.startsWith('./') ? cleanPath.slice(2) : cleanPath.slice(1);
  }
  if (!cleanPath) return 'ERROR: invalid file path';
  if (!targetContent) return 'ERROR: target_content cannot be empty';

  const readRes = await executeCommand(projectId, `cat "${cleanPath}" 2>/dev/null`);
  if (readRes.exitCode !== 0) {
    return `ERROR: file ${cleanPath} not found`;
  }
  const existing = readRes.output;
  if (!existing.includes(targetContent)) {
    return `ERROR: target_content not found in ${cleanPath}. Ensure target_content matches exact lines in the file.`;
  }

  const occurrences = existing.split(targetContent).length - 1;
  if (occurrences > 1) {
    return `ERROR: target_content matched ${occurrences} locations in ${cleanPath}. Provide more surrounding lines to make target_content unique.`;
  }

  const updated = existing.replace(targetContent, replacementContent ?? '');
  const base64 = Buffer.from(updated, 'utf-8').toString('base64');
  const writeRes = await executeCommand(projectId, `echo "${base64}" | base64 -d > "${cleanPath}"`);
  if (writeRes.exitCode !== 0) {
    return `ERROR writing updated ${cleanPath}: ${writeRes.output}`;
  }
  return `Successfully updated ${cleanPath} (replaced ${targetContent.split('\n').length} lines with ${(replacementContent ?? '').split('\n').length} lines)`;
}

async function readFile(
  projectId: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
  let cleanPath = String(filePath ?? '').trim();
  while (cleanPath.startsWith('./') || cleanPath.startsWith('/')) {
    cleanPath = cleanPath.startsWith('./') ? cleanPath.slice(2) : cleanPath.slice(1);
  }
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
  const cleanPath = String(dirPath ?? '').trim() || '.';
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
  const cleanPath = String(searchPath ?? '').trim() || '.';
  const includeFlag = include ? `--include='${include}'` : '';
  const escapedQuery = String(query).split("'").join("'\\''");
  const cmd = `grep -rnI --exclude-dir={node_modules,.next,.git,dist,.turbo} ${includeFlag} '${escapedQuery}' "${cleanPath}" 2>/dev/null | head -n 40`;
  const result = await executeCommand(projectId, cmd);
  if (!result.output.trim()) {
    return `No matches found for "${query}"`;
  }
  return result.output.trim();
}

async function askQuestion(correlationId: string): Promise<string> {
  return await waitForAnswer(correlationId, QUESTION_TIMEOUT_MS);
}

export type RequiredSecret = { key: string; reason: string };

function declareRequiredSecrets(args: Record<string, unknown>): {
  accepted: RequiredSecret[];
  rejected: string[];
    malformed?: boolean;
} {

  if (!Array.isArray(args.secrets)) {
    return { accepted: [], rejected: [], malformed: true };
  }

  const raw = args.secrets;
  const accepted: RequiredSecret[] = [];
  const rejected: string[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { key, reason } = item as { key?: unknown; reason?: unknown };
    const name = String(key ?? '').trim().toUpperCase();

    if (!isValidSecretKey(name)) {
      rejected.push(String(key ?? ''));
      continue;
    }
    if (accepted.some((s) => s.key === name)) continue;

    accepted.push({ key: name, reason: String(reason ?? '').trim() || 'required by this project' });
  }

  return { accepted, rejected, malformed: false };
}

export const toolCall = {
  write_file: writeFile,
  edit_file: editFile,
  read_file: readFile,
  list_dir: listDir,
  search_code: searchCode,
  bash_tool: runBashTool,
  question_tool: askQuestion,
  declare_required_secrets: declareRequiredSecrets,
};
