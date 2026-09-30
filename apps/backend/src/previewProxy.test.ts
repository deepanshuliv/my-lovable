import { describe, expect, test } from 'bun:test';
import { isSandboxAsleep } from './previewProxy';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('isSandboxAsleep', () => {
  test("Daytona's real stopped-sandbox response", async () => {
    const response = json(400, {
      statusCode: 400,
      message: 'bad request: failed to resolve container IP after 3 attempts: no IP address found. Is the Sandbox started?',
      code: 'SANDBOX_NOT_RUNNING',
    });
    expect(await isSandboxAsleep(response)).toBe(true);
  });

  test('other stopped or archived wordings', async () => {
    expect(await isSandboxAsleep(json(409, { message: 'Sandbox is archived' }))).toBe(true);
    expect(await isSandboxAsleep(json(503, { code: 'SANDBOX_STOPPED' }))).toBe(true);
  });

  test("the app's own errors are passed through untouched", async () => {
    expect(await isSandboxAsleep(json(400, { error: 'email is required' }))).toBe(false);
    expect(await isSandboxAsleep(json(500, { error: 'database exploded' }))).toBe(false);
    expect(await isSandboxAsleep(new Response('<h1>Internal error</h1>', { status: 500, headers: { 'content-type': 'text/html' } }))).toBe(false);
  });

  test('successful and auth responses are never touched', async () => {
    expect(await isSandboxAsleep(json(200, { code: 'SANDBOX_NOT_RUNNING' }))).toBe(false);
    expect(await isSandboxAsleep(json(401, { code: 'SANDBOX_NOT_RUNNING' }))).toBe(false);
    expect(await isSandboxAsleep(json(404, { code: 'SANDBOX_NOT_RUNNING' }))).toBe(false);
  });

  test('the response body is still readable afterwards', async () => {
    const response = json(400, { error: 'email is required' });
    await isSandboxAsleep(response);
    expect(await response.json()).toEqual({ error: 'email is required' });
  });
});
