import { describe, expect, test } from 'bun:test';
import { acceptsUpgrade, mentionsDatabase, storesUserData, UPGRADE_OPTIONS, UPGRADE_QUESTION, upgradeOpening } from './agentGuards';

describe('storesUserData', () => {
  test('API routes mean the app stores data', () => {
    expect(storesUserData(['app/api/tasks/route.ts'], [])).toBe(true);
    expect(storesUserData(['./app/api/signup/route.ts'], [])).toBe(true);
  });

  test('a globalThis store means the app stores data', () => {
    expect(storesUserData(['lib/tasks.ts'], ['const store = globalThis as unknown as { __tasks?: Map<string, Task> };'])).toBe(true);
    expect(storesUserData([], ['(globalThis as any).__items ??= []'])).toBe(true);
  });

  test('a static page does not', () => {
    expect(storesUserData(['app/page.tsx', 'components/Hero.tsx'], ['export default function Page() {}'])).toBe(false);
    expect(storesUserData(['app/apiary/page.tsx'], [])).toBe(false);
  });
});

describe('mentionsDatabase', () => {
  test('detects an upgrade question the model already asked', () => {
    expect(mentionsDatabase({ questions: [{ question: 'Would you like to connect a real database?' }] })).toBe(true);
  });

  test('ignores unrelated questions and malformed input', () => {
    expect(mentionsDatabase({ questions: [{ question: 'What colour scheme do you like?' }] })).toBe(false);
    expect(mentionsDatabase({})).toBe(false);
    expect(mentionsDatabase({ questions: 'database?' })).toBe(false);
    expect(mentionsDatabase({ questions: [null, 42] })).toBe(false);
  });
});

describe('upgradeOpening', () => {
  const text = upgradeOpening('Build a todo app');
  test('keeps the original request and records that the user accepted', () => {
    expect(text).toContain('Build a todo app');
    expect(text).toContain('Yes, connect a database');
  });

  test('only touches files after a verified database key', () => {
    expect(text).toContain('request_api_keys');
    expect(text).toContain('Only when it returns VERIFIED');
    expect(text).toContain('do not change any files');
  });
});

describe('server-side upgrade question', () => {
  test('offers exactly two plain-language options', () => {
    expect(UPGRADE_OPTIONS).toEqual(['Yes, connect a database', 'Not now, keep it as it is']);
    expect(UPGRADE_QUESTION).toContain('database');
  });

  test('only a yes answer starts the upgrade round', () => {
    expect(acceptsUpgrade('Yes, connect a database')).toBe(true);
    expect(acceptsUpgrade('Not now, keep it as it is')).toBe(false);
    expect(acceptsUpgrade('ERROR: timed out')).toBe(false);
  });
});
