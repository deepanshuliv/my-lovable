import { describe, expect, test } from 'bun:test';
import { createUsage, addUsage } from './providers/types';
import { PLATFORM_CREDIT_MICROS, usageCostMicros } from './credits';

function run(model: string, input: number, output: number, cost?: number) {
  const usage = createUsage();
  addUsage(usage, input, output, cost);
  return { name: 'openrouter' as const, model, usage };
}

describe('credits on the free platform model', () => {
  test('a free model still draws down credits even though OpenRouter reports $0', () => {
    expect(usageCostMicros(run('poolside/laguna-s-2.1:free', 300_000, 20_000, 0))).toBeGreaterThan(0);
  });

  test('a typical first build uses a fair share of the 100 credits, not all or none of them', () => {
    const build = usageCostMicros(run('poolside/laguna-s-2.1:free', 400_000, 30_000, 0));
    const share = build / PLATFORM_CREDIT_MICROS;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.6);
  });

  test('paid models are still charged their reported cost', () => {
    expect(usageCostMicros(run('deepseek/deepseek-v4-flash', 1000, 100, 0.002))).toBe(2000);
  });
});
