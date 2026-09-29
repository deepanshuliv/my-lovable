const MARKER = /<(\/?)(think|assistant|tool_call)>/g;
const SENTINEL = /‹(\/?)(think|assistant|tool_call)›/g;

export function encodeMarkers(text: string): string {
  return text.replace(MARKER, '‹$1$2›');
}

export function decodeMarkers(text: string): string {
  return text.replace(SENTINEL, '<$1$2>');
}

export function decodeArgs(value: unknown): unknown {
  if (typeof value === 'string') return decodeMarkers(value);
  if (Array.isArray(value)) return value.map(decodeArgs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, decodeArgs(inner)]));
  }
  return value;
}

const ALIASES: Record<string, Record<string, string[]>> = {
  bash_tool: { comand: ['command', 'cmd', 'script'] },
  write_file: { path: ['file_path', 'filepath', 'filePath', 'file', 'filename'], content: ['contents', 'code', 'text', 'file_content'] },
  edit_file: {
    path: ['file_path', 'filepath', 'filePath', 'file', 'filename'],
    target_content: ['old_string', 'oldString', 'old_str', 'old', 'search', 'find'],
    replacement_content: ['new_string', 'newString', 'new_str', 'new', 'replace', 'replacement'],
  },
  read_file: { path: ['file_path', 'filepath', 'filePath', 'file', 'filename'] },
  list_dir: { path: ['dir', 'directory', 'folder'] },
  search_code: { query: ['pattern', 'search', 'q', 'term'] },
};

export function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const table = ALIASES[name];
  if (!table) return args;
  const out: Record<string, unknown> = { ...args };
  for (const [canonical, aliases] of Object.entries(table)) {
    for (const alias of aliases) {
      if (!(alias in out)) continue;
      if (out[canonical] === undefined) out[canonical] = out[alias];
      delete out[alias];
    }
  }
  return out;
}

export function looksLikeTextToolCall(text: string, toolNames: string[]): boolean {
  if (/<tool_call>\s*\{/.test(text) || /<function=\w+>/.test(text)) return true;
  const names = toolNames.map((name) => name.replace(/[^\w]/g, '')).join('|');
  return names.length > 0 && new RegExp(`\\{\\s*"name"\\s*:\\s*"(${names})"\\s*,\\s*"(arguments|parameters)"\\s*:`).test(text);
}

export function canonicalToolName(name: string, toolNames: string[]): string {
  if (toolNames.includes(name)) return name;
  const cleaned = name.trim().replace(/^(functions|tools?)\./, '').replace(/[^\w-]/g, '');
  if (toolNames.includes(cleaned)) return cleaned;
  const trailing = /<tool_call>\s*([\w-]+)\W*$/.exec(name)?.[1];
  return trailing && toolNames.includes(trailing) ? trailing : name;
}
