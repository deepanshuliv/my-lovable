import { describe, expect, test } from 'bun:test';
import { createFreeLimiter, DAILY_LIMIT_MESSAGE, freeDailyQuotaExhausted, type QuotaStore } from './freeQuota';

function memoryStore(): QuotaStore & { data: Map<string, number> } {
  const data = new Map<string, number>();
  return {
    data,
    incr: async (key) => {
      const next = (data.get(key) ?? 0) + 1;
      data.set(key, next);
      return next;
    },
    expire: async () => 1,
    get: async (key) => (data.has(key) ? String(data.get(key)) : null),
  };
}

function fakeClock(start = Date.UTC(2026, 9, 3, 12, 0, 5)) {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
  };
}

const failing: QuotaStore = {
  incr: async () => { throw new Error('ECONNREFUSED'); },
  expire: async () => { throw new Error('ECONNREFUSED'); },
  get: async () => { throw new Error('ECONNREFUSED'); },
};

describe('shared free-model request limiter', () => {
  test('requests within the per-minute budget go straight through', async () => {
    const clock = fakeClock();
    const acquire = createFreeLimiter(memoryStore(), { rpm: 3, daily: 100 }, clock);
    for (let i = 0; i < 3; i++) await acquire();
    expect(clock.slept).toEqual([]);
  });

  test('the request over budget waits for the next minute instead of earning a 429', async () => {
    const clock = fakeClock();
    const acquire = createFreeLimiter(memoryStore(), { rpm: 2, daily: 100 }, clock);
    await acquire();
    await acquire();
    await acquire();
    expect(clock.slept).toHaveLength(1);
    expect(clock.slept[0]).toBeGreaterThanOrEqual(55_000);
  });

  test('the budget is shared by every run using the same store', async () => {
    const store = memoryStore();
    const clock = fakeClock();
    const a = createFreeLimiter(store, { rpm: 2, daily: 100 }, clock);
    const b = createFreeLimiter(store, { rpm: 2, daily: 100 }, clock);
    await a();
    await b();
    await a();
    expect(clock.slept).toHaveLength(1);
  });

  test('the daily cap refuses further requests with the daily message', async () => {
    const acquire = createFreeLimiter(memoryStore(), { rpm: 100, daily: 2 }, fakeClock());
    await acquire();
    await acquire();
    await expect(acquire()).rejects.toThrow(DAILY_LIMIT_MESSAGE);
  });

  test('a Redis outage never blocks a build', async () => {
    const acquire = createFreeLimiter(failing, { rpm: 1, daily: 1 }, fakeClock());
    await acquire();
    await acquire();
  });

  test('new runs are refused once the day is nearly used up, so builds do not die halfway', async () => {
    const store = memoryStore();
    const day = new Date(Date.UTC(2026, 9, 3)).toISOString().slice(0, 10);
    store.data.set(`freequota:day:${day}`, 965);
    expect(await freeDailyQuotaExhausted(store, Date.UTC(2026, 9, 3, 9))).toBe(true);
    store.data.set(`freequota:day:${day}`, 100);
    expect(await freeDailyQuotaExhausted(store, Date.UTC(2026, 9, 3, 9))).toBe(false);
  });
});
