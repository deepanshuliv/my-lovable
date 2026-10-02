export type ToolKind = 'read' | 'write' | 'edit' | 'list' | 'search' | 'run' | 'images' | 'other';

const KINDS: Record<string, ToolKind> = {
  read_file: 'read',
  read_tool_output: 'read',
  write_file: 'write',
  edit_file: 'edit',
  list_dir: 'list',
  search_code: 'search',
  bash_tool: 'run',
  find_images: 'images',
};

export function toolKind(name: string): ToolKind {
  return KINDS[name] ?? 'other';
}

export function toolTarget(name: string, args: Record<string, unknown> | undefined): string {
  const kind = toolKind(name);
  if (kind === 'read' && name === 'read_tool_output') return 'earlier output';
  if (kind === 'read' || kind === 'write' || kind === 'edit') return String(args?.path ?? 'a file');
  if (kind === 'list') return String(args?.path ?? '.');
  if (kind === 'images' && Array.isArray(args?.queries)) return args.queries.map(String).join(', ');
  if (kind === 'search' || kind === 'images') return String(args?.query ?? '');
  if (kind === 'run') {
    const command = String(args?.comand ?? args?.command ?? '').trim();
    return command.split('\n')[0] ?? command;
  }
  return args ? JSON.stringify(args).slice(0, 80) : name;
}

const VERBS: Record<ToolKind, [string, string]> = {
  read: ['Reading', 'Read'],
  write: ['Creating', 'Created'],
  edit: ['Editing', 'Edited'],
  list: ['Looking in', 'Looked in'],
  search: ['Searching for', 'Searched for'],
  run: ['Running', 'Ran'],
  images: ['Finding photos of', 'Found photos of'],
  other: ['Using', 'Used'],
};

export function toolVerb(kind: ToolKind, pending: boolean): string {
  return VERBS[kind][pending ? 0 : 1];
}

export function toolStatus(name: string, target: string): string {
  return `${toolVerb(toolKind(name), true)} ${target}`;
}

export function showsOutput(name: string, isError: boolean | undefined): boolean {
  return Boolean(isError) || toolKind(name) === 'run';
}

export function summarize(names: string[]): string {
  const counts = { files: 0, changed: 0, commands: 0, looked: 0 };
  for (const name of names) {
    const kind = toolKind(name);
    if (kind === 'read') counts.files += 1;
    else if (kind === 'write' || kind === 'edit') counts.changed += 1;
    else if (kind === 'run') counts.commands += 1;
    else if (kind === 'images') counts.looked += 1;
    else counts.looked += 1;
  }

  const parts: string[] = [];
  if (counts.changed) parts.push(`changed ${counts.changed} ${counts.changed === 1 ? 'file' : 'files'}`);
  if (counts.files) parts.push(`read ${counts.files} ${counts.files === 1 ? 'file' : 'files'}`);
  if (counts.commands) parts.push(`ran ${counts.commands} ${counts.commands === 1 ? 'command' : 'commands'}`);
  if (counts.looked) parts.push(`${counts.looked} ${counts.looked === 1 ? 'search' : 'searches'}`);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
