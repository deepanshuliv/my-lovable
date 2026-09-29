import { envInt, envOr } from '@repo/shared';
import { NAMING_MODEL_GEMINI, NAMING_MODEL_OPENROUTER } from '../config';
import { GeminiProvider } from './gemini';
import { freeRequestLimiter } from '../freeQuota';
import { OpenRouterProvider, type OpenRouterOptions } from './openrouter';
import type { ByokProviderName, ModelProvider } from './types';

export * from './types';

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';
export const DEFAULT_PLATFORM_MODEL = 'poolside/laguna-s-2.1:free';

export const PLATFORM_FREE_ONLY = true;

export function platformOptions(): OpenRouterOptions {
  return { freeOnly: true, limiter: freeRequestLimiter };
}
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_OPENAI_MODEL = envOr('OPENAI_DEFAULT_MODEL', 'gpt-5.5');
export const DEFAULT_ANTHROPIC_MODEL = envOr('ANTHROPIC_DEFAULT_MODEL', 'claude-sonnet-5-5');
export const DEFAULT_DEEPSEEK_MODEL = envOr('DEEPSEEK_DEFAULT_MODEL', 'deepseek-v4-flash');

const OPENAI_BASE_URL = envOr('OPENAI_BASE_URL', 'https://api.openai.com/v1');
const ANTHROPIC_BASE_URL = envOr('ANTHROPIC_BASE_URL', 'https://api.anthropic.com/v1');
const DEEPSEEK_BASE_URL = envOr('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1');

type ProviderChoice = {
  provider: ModelProvider;
  reason: string;
};

let cached: ProviderChoice | null = null;

function build(): ProviderChoice {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const forced = envOr('MODEL_PROVIDER', 'auto').toLowerCase();

  if (forced !== 'auto' && forced !== 'openrouter') {
    throw new Error(`platform credits only run on free OpenRouter models; MODEL_PROVIDER=${forced} is not allowed`);
  }
  if (!openrouterKey) throw new Error('platform credits only run on free OpenRouter models; set OPENROUTER_API_KEY');

  return {
    provider: new OpenRouterProvider(
      envOr('OPENROUTER_MODEL', DEFAULT_PLATFORM_MODEL),
      openrouterKey,
      envOr('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      envInt('OPENROUTER_CONTEXT_WINDOW', 262_144),
      'openrouter',
      platformOptions(),
    ),
    reason: forced === 'openrouter' ? 'MODEL_PROVIDER=openrouter' : 'OPENROUTER_API_KEY is set',
  };
}

export type ProviderOverride = {
  provider: ByokProviderName;
  apiKey: string;
  model?: string;
};

function buildFromOverride(override: ProviderOverride): ModelProvider {
  const key = override.apiKey.trim();
  if (!key) throw new Error('a bring-your-own key was supplied but is empty');

  if (override.provider === 'openrouter') {
    return new OpenRouterProvider(
      override.model || DEFAULT_OPENROUTER_MODEL,
      key,
      envOr('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      envInt('OPENROUTER_CONTEXT_WINDOW', 128_000),
    );
  }

  if (override.provider === 'openai') {
    return new OpenRouterProvider(
      override.model || DEFAULT_OPENAI_MODEL,
      key,
      OPENAI_BASE_URL,
      envInt('OPENAI_CONTEXT_WINDOW', 128_000),
      'openai',
    );
  }

  if (override.provider === 'anthropic') {
    return new OpenRouterProvider(
      override.model || DEFAULT_ANTHROPIC_MODEL,
      key,
      ANTHROPIC_BASE_URL,
      envInt('ANTHROPIC_CONTEXT_WINDOW', 200_000),
      'anthropic',
    );
  }

  if (override.provider === 'deepseek') {
    return new OpenRouterProvider(
      override.model || DEFAULT_DEEPSEEK_MODEL,
      key,
      DEEPSEEK_BASE_URL,
      envInt('DEEPSEEK_CONTEXT_WINDOW', 128_000),
      'deepseek',
    );
  }

  return new GeminiProvider(
    override.model || DEFAULT_GEMINI_MODEL,
    envInt('GEMINI_CONTEXT_WINDOW', 1_000_000),
    key,
  );
}

export function getProvider(override?: ProviderOverride, forcePlatformProvider?: 'openrouter' | 'gemini'): ModelProvider {
  if (override?.apiKey) {
    const provider = buildFromOverride(override);

    console.log(`[MODEL] ${provider.name} / ${provider.model} (user-supplied key)`);
    return provider;
  }

  if (forcePlatformProvider) {
    const originalEnv = process.env.MODEL_PROVIDER;
    process.env.MODEL_PROVIDER = forcePlatformProvider;
    try {
      const choice = build();
      console.log(`[MODEL] ${choice.provider.name} / ${choice.provider.model} (forced platform ${forcePlatformProvider})`);
      return choice.provider;
    } finally {
      process.env.MODEL_PROVIDER = originalEnv;
    }
  }

  const choice = build();
  if (!cached) console.log(`[MODEL] ${choice.provider.name} / ${choice.provider.model} (${choice.reason})`);
  cached = choice;
  return choice.provider;
}

export type ByokModel = { id: string; label: string; note: string; recommended: boolean };

export const BYOK_MODELS: Record<ByokProviderName, ByokModel[]> = {
  openrouter: [
    { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', note: 'Most reliable at multi-step builds. Best overall.', recommended: true },
    { id: DEFAULT_OPENROUTER_MODEL, label: 'DeepSeek V4 Flash', note: 'Very cheap and fast. Good for simple apps.', recommended: false },
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
    { id: DEFAULT_GEMINI_MODEL, label: 'Gemini 3.1 Flash Lite', note: 'Fastest and cheapest. Simple apps.', recommended: false },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: 'Very cheap and fast. Best value.', recommended: true },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', note: 'Stronger at multi-step builds. Slower.', recommended: false },
  ],
};

export function describeProvider(): { provider: string; model: string; reason: string } {
  try {
    const choice = cached ?? build();
    return { provider: choice.provider.name, model: choice.provider.model, reason: choice.reason };
  } catch (error) {
    return { provider: 'unconfigured', model: '-', reason: String(error) };
  }
}

function namingModelFor(provider: ByokProviderName): string {
  if (provider === 'openai') return envOr('NAMING_MODEL_OPENAI', 'gpt-5-mini');
  if (provider === 'anthropic') return envOr('NAMING_MODEL_ANTHROPIC', 'claude-haiku-4-5-20251001');
  if (provider === 'deepseek') return envOr('NAMING_MODEL_DEEPSEEK', 'deepseek-v4-flash');
  return provider === 'openrouter' ? NAMING_MODEL_OPENROUTER : NAMING_MODEL_GEMINI;
}

export function getNamingProvider(override?: ProviderOverride): ModelProvider {
  if (override?.apiKey) {
    return buildFromOverride({
      provider: override.provider,
      apiKey: override.apiKey,

      model: namingModelFor(override.provider),
    });
  }

  const platform = getProvider();

  if (platform.name === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY is not set');
    return new OpenRouterProvider(
      NAMING_MODEL_OPENROUTER.endsWith(':free') ? NAMING_MODEL_OPENROUTER : platform.model,
      key,
      envOr('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      envInt('OPENROUTER_CONTEXT_WINDOW', 128_000),
      'openrouter',
      platformOptions(),
    );
  }

  throw new Error('platform credits only run on free OpenRouter models; set OPENROUTER_API_KEY');
}
