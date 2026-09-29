import { describe, expect, test } from 'bun:test';
import { getNamingProvider, getProvider } from './index';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('the platform key can only reach free models', () => {
  test('a paid OPENROUTER_MODEL is refused instead of silently spending', () => {
    withEnv({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'deepseek/deepseek-v4-flash' }, () => {
      expect(() => getProvider(undefined, 'openrouter')).toThrow(/free/);
    });
  });

  test('the default platform model is the free Laguna', () => {
    withEnv({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: undefined }, () => {
      expect(getProvider(undefined, 'openrouter').model).toBe('poolside/laguna-s-2.1:free');
    });
  });

  test('a paid naming model falls back to the free platform model', () => {
    withEnv({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'poolside/laguna-s-2.1:free', MODEL_PROVIDER: 'openrouter' }, () => {
      expect(getNamingProvider().model.endsWith(':free')).toBe(true);
    });
  });

  test('a Gemini platform key is never used for free credits', () => {
    withEnv({ OPENROUTER_API_KEY: undefined, GEMINI_API_KEY: 'g', MODEL_PROVIDER: 'gemini' }, () => {
      expect(() => getProvider()).toThrow(/free/);
    });
  });

  test('Gemini cannot be forced as the platform model even with an OpenRouter key present', () => {
    withEnv({ OPENROUTER_API_KEY: 'k', GEMINI_API_KEY: 'g', MODEL_PROVIDER: 'gemini' }, () => {
      expect(() => getProvider()).toThrow(/free/);
    });
  });

  test('the free-only rule cannot be switched off from the environment', () => {
    withEnv({ OPENROUTER_API_KEY: 'k', PLATFORM_FREE_ONLY: 'off', OPENROUTER_MODEL: 'deepseek/deepseek-v4-flash' }, () => {
      expect(() => getProvider(undefined, 'openrouter')).toThrow(/free/);
    });
  });

  test('the naming model on platform credits is always free', () => {
    withEnv({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: undefined, MODEL_PROVIDER: undefined }, () => {
      expect(getNamingProvider().model.endsWith(':free')).toBe(true);
    });
  });

  test('a user-supplied key is not restricted', () => {
    expect(getProvider({ provider: 'openrouter', apiKey: 'user-key', model: 'anthropic/claude-sonnet-5.5' }).model).toBe('anthropic/claude-sonnet-5.5');
  });
});
