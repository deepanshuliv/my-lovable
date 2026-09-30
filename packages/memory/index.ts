import { envInt, envOr } from '@repo/shared';
import { RedisFallbackMemory } from './fallback';
import { IrisMemory } from './iris';
import type { MemoryStore } from './types';

export * from './types';
export { IrisMemory } from './iris';
export { RedisFallbackMemory } from './fallback';

export const RECENT_EVENTS_LIMIT = envInt('RECENT_EVENTS_LIMIT', 300);

let store: MemoryStore | null = null;

export function createMemoryStore(): MemoryStore {
  if (store) return store;

  const apiKey = process.env.REDIS_IRIS_API_KEY;
  const baseUrl = process.env.REDIS_IRIS_URL;

  if (apiKey && baseUrl) {
    console.log('[MEMORY] using Redis Iris at', baseUrl);
    store = new IrisMemory(baseUrl, apiKey, envOr('REDIS_IRIS_NAMESPACE', 'my-lovable'), RECENT_EVENTS_LIMIT);
  } else {
    console.log('[MEMORY] REDIS_IRIS_API_KEY/REDIS_IRIS_URL not set — using Redis session fallback');
    store = new RedisFallbackMemory(envInt('SESSION_TTL_SECONDS', 60 * 60 * 24 * 7), RECENT_EVENTS_LIMIT);
  }

  return store;
}
