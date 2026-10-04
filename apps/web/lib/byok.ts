import type { AgentMode } from './types';

export type ByokProvider = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'deepseek';

export type ByokModel = { id: string; label: string; note: string; recommended: boolean };

const SKIP_KEY = 'my-lovable.byok.skipped';

export const PROVIDERS: { id: ByokProvider; label: string; blurb: string; keyUrl: string; placeholder: string }[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    blurb: 'One key for many models',
    keyUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'GPT models',
    keyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-…',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude models',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-…',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    blurb: 'Google models',
    keyUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza…',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    blurb: 'Cheap, fast models',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    placeholder: 'sk-…',
  },
];

export function providerLabel(provider: string): string {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
}

export const FALLBACK_MODELS: Record<ByokProvider, ByokModel[]> = {
  openrouter: [
    { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', note: 'Most reliable at multi-step builds. Best overall.', recommended: true },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: 'Very cheap and fast. Good for simple apps.', recommended: false },
    { id: 'openai/gpt-5.5', label: 'GPT-5.5', note: 'Strong all-rounder for complex apps.', recommended: false },
  ],
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5', note: 'Best quality for building apps.', recommended: true },
    { id: 'gpt-5.4', label: 'GPT-5.4', note: 'Cheaper, still great at most apps.', recommended: false },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', note: 'Fastest and cheapest. Simple apps.', recommended: false },
  ],
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Best balance of quality, speed and cost.', recommended: true },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable. Slower and pricier.', recommended: false },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'Fastest and cheapest. Simple apps.', recommended: false },
  ],
  gemini: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', note: 'Fast with strong quality. Best overall.', recommended: true },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', note: 'Most capable Gemini. Slower and pricier.', recommended: false },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', note: 'Fastest and cheapest. Simple apps.', recommended: false },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: 'Very cheap and fast. Best value.', recommended: true },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', note: 'Stronger at multi-step builds. Slower.', recommended: false },
  ],
};

export function isByokProvider(value: unknown): value is ByokProvider {
  return PROVIDERS.some((item) => item.id === value);
}

export function markByokSkipped() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SKIP_KEY, '1');
}

export function hasSkippedByok(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(SKIP_KEY) === '1';
}

const PREFERENCE_KEY = 'my-lovable.provider.preference';

export type ProviderPreference = {
  provider: ByokProvider;
  usePlatform: boolean;
};

export function setProviderPreference(pref: ProviderPreference) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PREFERENCE_KEY, JSON.stringify(pref));
}

export const DEFAULT_PREFERENCE: ProviderPreference = { provider: 'openrouter', usePlatform: true };

export function getProviderPreference(): ProviderPreference {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCE;
  try {
    const data = localStorage.getItem(PREFERENCE_KEY);
    if (!data) return DEFAULT_PREFERENCE;
    const parsed = JSON.parse(data) as Partial<ProviderPreference>;
    if (!isByokProvider(parsed.provider)) return DEFAULT_PREFERENCE;
    return { provider: parsed.provider, usePlatform: parsed.provider === 'openrouter' ? Boolean(parsed.usePlatform) : false };
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: 'build', label: 'Build', hint: 'Make the changes and run the app' },
  { id: 'plan', label: 'Plan', hint: 'Suggest a plan first, without changing anything' },
];

export function isAuthError(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('401') ||
    lower.includes('user not found') ||
    lower.includes('unauthorized') ||
    lower.includes('api_key') ||
    lower.includes('credit') ||
    lower.includes('key is not set') ||
    lower.includes('invalid key') ||
    lower.includes('authentication')
  );
}

export function freeModelLabel(model?: string | null): string {
  if (!model) return 'a free AI model';
  const [vendor, name] = model.replace(/:free$/, '').split('/');
  const words = (value: string) =>
    value
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => (/^\d/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ');
  return name ? `${words(vendor!)} ${words(name)}` : words(vendor!);
}

export type FreeModelIssue = 'daily' | 'busy' | 'unavailable' | 'other';

export function freeModelIssue(message: string): FreeModelIssue {
  if (/daily|00:00 UTC/i.test(message)) return 'daily';
  if (/usage limit|busy|rate.?limit|\b429\b|too many/i.test(message)) return 'busy';
  if (/not available|no endpoints|unavailable/i.test(message)) return 'unavailable';
  return 'other';
}

const FREE_NOTICE_KEY = 'inkling.free-model-notice.v1';

export function hasSeenFreeModelNotice(): boolean {
  try {
    return localStorage.getItem(FREE_NOTICE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markFreeModelNoticeSeen() {
  try {
    localStorage.setItem(FREE_NOTICE_KEY, '1');
  } catch {}
}
