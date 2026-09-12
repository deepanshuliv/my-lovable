import { envInt, envOr } from '@repo/shared';
import { NAMING_MODEL_GEMINI, NAMING_MODEL_OPENROUTER } from '../config';
import { GeminiProvider } from './gemini';
import { OpenRouterProvider } from './openrouter';
import type { ModelProvider } from './types';

export * from './types';

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

type ProviderChoice = {
  provider: ModelProvider;
  reason: string;
};

let cached: ProviderChoice | null = null;

function build(): ProviderChoice {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  
  const forced = envOr('MODEL_PROVIDER', 'auto').toLowerCase();

  const openrouter = () => {
    if (!openrouterKey) throw new Error('MODEL_PROVIDER=openrouter but OPENROUTER_API_KEY is not set');
    return {
      provider: new OpenRouterProvider(
        envOr('OPENROUTER_MODEL', DEFAULT_OPENROUTER_MODEL),
        openrouterKey,
        envOr('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
        envInt('OPENROUTER_CONTEXT_WINDOW', 128_000),
      ),
      reason: 'OPENROUTER_API_KEY is set',
    };
  };

  const gemini = () => {
    if (!geminiKey) throw new Error('MODEL_PROVIDER=gemini but GEMINI_API_KEY is not set');
    return {
      provider: new GeminiProvider(
        
        process.env.GEMINI_MODEL || process.env.MODEL || DEFAULT_GEMINI_MODEL,
        envInt('GEMINI_CONTEXT_WINDOW', 1_000_000),
      ),
      reason: 'GEMINI_API_KEY is set',
    };
  };

  if (forced === 'openrouter') return { ...openrouter(), reason: 'MODEL_PROVIDER=openrouter' };
  if (forced === 'gemini') return { ...gemini(), reason: 'MODEL_PROVIDER=gemini' };

  if (openrouterKey) return openrouter();
  if (geminiKey) return gemini();

  throw new Error('no model key configured — set OPENROUTER_API_KEY or GEMINI_API_KEY');
}

export type ProviderOverride = {
  provider: 'openrouter' | 'gemini';
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

  if (!cached) {
    cached = build();
    console.log(`[MODEL] ${cached.provider.name} / ${cached.provider.model} (${cached.reason})`);
  }
  return cached.provider;
}

export const BYOK_MODELS: Record<'openrouter' | 'gemini', { id: string; recommended: boolean }[]> = {
  openrouter: [
    { id: DEFAULT_OPENROUTER_MODEL, recommended: true },
    { id: 'anthropic/claude-sonnet-5', recommended: false },
    { id: 'openai/gpt-5', recommended: false },
    { id: 'google/gemini-3.1-flash', recommended: false },
  ],
  gemini: [
    { id: DEFAULT_GEMINI_MODEL, recommended: true },
    { id: 'gemini-3.1-flash', recommended: false },
    { id: 'gemini-3.1-pro', recommended: false },
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

function namingModelFor(provider: 'openrouter' | 'gemini'): string {
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
      NAMING_MODEL_OPENROUTER,
      key,
      envOr('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      envInt('OPENROUTER_CONTEXT_WINDOW', 128_000),
    );
  }

  return new GeminiProvider(NAMING_MODEL_GEMINI, envInt('GEMINI_CONTEXT_WINDOW', 1_000_000));
}
