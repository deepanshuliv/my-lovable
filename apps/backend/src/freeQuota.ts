import { envInt } from '@repo/shared';
import { freeQuotaDayKey, freeQuotaMinuteKey, redis } from '@repo/redis';

export const FREE_MODEL_RPM = Math.max(1, envInt('FREE_MODEL_RPM', 18));
export const FREE_MODEL_DAILY_REQUESTS = Math.max(1, envInt('FREE_MODEL_DAILY_REQUESTS', 1000));
export const FREE_MODEL_DAILY_RESERVE = Math.max(0, envInt('FREE_MODEL_DAILY_RESERVE', 40));
const MAX_WAIT_MS = 180_000;

export const DAILY_LIMIT_MESSAGE = 'OpenRouter daily request limit reached for this key; it resets at 00:00 UTC.';

export type QuotaStore = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
};

export type Clock = { now(): number; sleep(ms: number): Promise<void> };

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) };

const minuteOf = (ms: number) => Math.floor(ms / 60_000);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createFreeLimiter(
  store: QuotaStore,
  limits = { rpm: FREE_MODEL_RPM, daily: FREE_MODEL_DAILY_REQUESTS },
  clock: Clock = realClock,
) {
  return async function acquire(): Promise<void> {
    const started = clock.now();
    while (true) {
      const now = clock.now();
      let used: number;
      try {
        const today = Number((await store.get(freeQuotaDayKey(dayOf(now)))) ?? 0);
        if (today >= limits.daily) throw new Error(DAILY_LIMIT_MESSAGE);
        const minuteKey = freeQuotaMinuteKey(minuteOf(now));
        used = await store.incr(minuteKey);
        if (used === 1) await store.expire(minuteKey, 120);
      } catch (error) {
        if (error instanceof Error && error.message === DAILY_LIMIT_MESSAGE) throw error;
        console.log('[FREE_QUOTA_UNAVAILABLE] , ', String(error).slice(0, 160));
        return;
      }
      if (used <= limits.rpm || now - started >= MAX_WAIT_MS) {
        const dayKey = freeQuotaDayKey(dayOf(now));
        const today = await store.incr(dayKey).catch(() => 0);
        if (today === 1) await store.expire(dayKey, 172_800).catch(() => {});
        return;
      }
      const nextMinute = (minuteOf(now) + 1) * 60_000;
      await clock.sleep(nextMinute - now + Math.floor(Math.random() * 1_500));
    }
  };
}

export const freeRequestLimiter = createFreeLimiter(redis as unknown as QuotaStore);

export async function freeRequestsToday(store: QuotaStore = redis as unknown as QuotaStore, now = Date.now()): Promise<number> {
  try {
    return Number((await store.get(freeQuotaDayKey(dayOf(now)))) ?? 0);
  } catch {
    return 0;
  }
}

export async function freeDailyQuotaExhausted(store?: QuotaStore, now?: number): Promise<boolean> {
  return (await freeRequestsToday(store, now)) >= FREE_MODEL_DAILY_REQUESTS - FREE_MODEL_DAILY_RESERVE;
}
