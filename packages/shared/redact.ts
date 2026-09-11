
const MASK = '[redacted]';

const registry = new Map<string, Set<string>>();

const MIN_REDACTABLE_LENGTH = 6;

export function registerSecrets(projectId: string, values: string[]) {
  const set = new Set<string>();
  for (const value of values) {
    if (value && value.length >= MIN_REDACTABLE_LENGTH) set.add(value);
  }
  registry.set(projectId, set);
}

export function forgetSecrets(projectId: string) {
  registry.delete(projectId);
}

export function redact(projectId: string, text: string): string {
  const values = registry.get(projectId);
  if (!values || values.size === 0 || !text) return text;

  let out = text;
  for (const value of values) {
    if (out.includes(value)) out = out.split(value).join(MASK);
  }
  return out;
}

export function redactDeep<T>(projectId: string, value: T): T {
  if (typeof value === 'string') return redact(projectId, value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(projectId, v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(projectId, v);
    }
    return out as unknown as T;
  }
  return value;
}

export function maskPreview(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}
