import { describe, expect, test } from 'bun:test';
import { friendlyError, sanitizeErrorPayload } from './userErrors';

const BUSY = /build servers are busy/;
const WORKSPACE = /could not start your project/;
const CONNECTION = /lost connection/;

describe('infrastructure errors become plain language', () => {
  test('Daytona memory limit', () => {
    expect(
      friendlyError(
        "Total memory limit exceeded. Maximum allowed: 10GiB. To increase concurrency limits, upgrade your organization's Tier by visiting https://app.daytona.io/dashboard/limits.",
      ),
    ).toMatch(BUSY);
  });

  test('Daytona CPU and disk limits', () => {
    expect(friendlyError('Total CPU limit exceeded. Maximum allowed: 10')).toMatch(BUSY);
    expect(friendlyError('Total disk limit exceeded. Maximum allowed: 30GiB')).toMatch(BUSY);
  });

  test('other Daytona failures', () => {
    expect(friendlyError('DaytonaConflictError: conflict: repository already exists')).toMatch(WORKSPACE);
    expect(friendlyError('DaytonaNotFoundError: Sandbox with ID x not found')).toMatch(WORKSPACE);
  });

  test('AI key spending limit is explained without exposing internal links', () => {
    const raw =
      'Error: openrouter stream 403: {"error":{"message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/338e641b","code":403}}';
    const out = friendlyError(raw);
    expect(out).toContain('usage limit');
    expect(out).not.toContain('openrouter.ai');
    expect(out).not.toContain('338e641b');
  });

  test('network failures', () => {
    expect(friendlyError('connect ECONNREFUSED 127.0.0.1:6379')).toMatch(CONNECTION);
    expect(friendlyError('getaddrinfo ENOTFOUND api.example.com')).toMatch(CONNECTION);
    expect(friendlyError('socket hang up')).toMatch(CONNECTION);
  });
});

describe('errors the user must see stay untouched', () => {
  const unchanged = [
    'OpenRouter 401: User not found',
    'API key is not set for gemini',
    'Invalid key provided',
    'You exceeded your current quota, please check your plan and billing details.',
    'Resource has been exhausted (e.g. check quota).',
    '429 Too Many Requests: rate limit exceeded',
    'Insufficient credits. Add more credits to continue.',
    'Stopped: this turn reached its cost limit of $1. The work so far is saved; send a follow-up to continue.',
    'The changes still fail verification after 2 repair attempt(s): TypeScript errors remain.',
    'lost ownership of this project',
    '',
  ];
  for (const message of unchanged) {
    test(JSON.stringify(message.slice(0, 50)), () => {
      expect(friendlyError(message)).toBe(message);
    });
  }
});

describe('sanitizeErrorPayload', () => {
  test('only touches error events', () => {
    const payload = { message: 'DaytonaError: boom' };
    expect(sanitizeErrorPayload('p', 'text', payload)).toBe(payload);
    expect(sanitizeErrorPayload('p', 'error', payload).message).toMatch(WORKSPACE);
  });

  test('keeps other fields and leaves non-string messages alone', () => {
    const out = sanitizeErrorPayload('p', 'error', { message: 'Total memory limit exceeded', code: 7 });
    expect(out.code).toBe(7);
    const odd = { message: 42 } as Record<string, unknown>;
    expect(sanitizeErrorPayload('p', 'error', odd)).toBe(odd);
  });

  test('returns the same object when nothing changed', () => {
    const payload = { message: 'OpenRouter 401: User not found' };
    expect(sanitizeErrorPayload('p', 'error', payload)).toBe(payload);
  });
});
