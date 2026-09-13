
import type { AgentMode } from './types';

export type ByokProvider = 'openrouter' | 'gemini';

const SKIP_KEY = 'my-lovable.byok.skipped';

export const PROVIDERS: { id: ByokProvider; label: string; keyUrl: string; placeholder: string }[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-…',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza…',
  },
];

export const FALLBACK_MODELS: Record<ByokProvider, { id: string; recommended: boolean }[]> = {
  openrouter: [{ id: 'deepseek/deepseek-v4-flash', recommended: true }],
  gemini: [{ id: 'gemini-3.1-flash-lite', recommended: true }],
};

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

export function getProviderPreference(): ProviderPreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const data = localStorage.getItem(PREFERENCE_KEY);
    if (!data) return null;
    return JSON.parse(data) as ProviderPreference;
  } catch {
    return null;
  }
}

export const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: 'build', label: 'Build', hint: 'Write the code and run it' },
  { id: 'plan', label: 'Plan', hint: 'Investigate and propose — changes nothing' },
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
