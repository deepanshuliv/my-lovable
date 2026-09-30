import { describe, expect, test } from 'bun:test';
import { checkReachability, isNeonHost, parseProbe, probeScript, reachTargets } from './sandboxReach';

describe('reachTargets', () => {
  test('a Neon database is checked over HTTPS, where the sandbox can reach it', () => {
    const [t] = reachTargets({ DATABASE_URL: 'postgresql://u:p@ep-x-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require' });
    expect(t).toMatchObject({ key: 'DATABASE_URL', port: 443, kind: 'tls' });
    expect(isNeonHost(t!.host)).toBe(true);
  });

  test('any other Postgres is checked on its real port', () => {
    expect(reachTargets({ DATABASE_URL: 'postgresql://u:p@db.railway.app:6543/x' })[0]).toMatchObject({ port: 6543, kind: 'tcp' });
    expect(reachTargets({ POSTGRES_URL: 'postgres://u:p@db.example.com/x' })[0]).toMatchObject({ port: 5432, kind: 'tcp' });
  });

  test('API keys map to their provider host', () => {
    const hosts = reachTargets({ STRIPE_SECRET_KEY: 'sk', RESEND_API_KEY: 're', OPENAI_API_KEY: 'sk' }).map((t) => t.host);
    expect(hosts).toEqual(['api.stripe.com', 'api.resend.com', 'api.openai.com']);
  });

  test('browser-only keys, unknown keys, empty values and broken URLs are skipped', () => {
    expect(
      reachTargets({
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        ACME_TOKEN: 'abc',
        OPENAI_API_KEY: '   ',
        DATABASE_URL: 'not a url',
      }),
    ).toEqual([]);
  });
});

describe('probe protocol', () => {
  test('the probe script embeds only hosts, ports and kinds, never key values', () => {
    const script = probeScript(reachTargets({ STRIPE_SECRET_KEY: 'sk_live_SUPERSECRET' }));
    expect(script).toContain('api.stripe.com');
    expect(script).not.toContain('SUPERSECRET');
  });

  test('parseProbe reads the result line and rejects garbage', () => {
    expect(parseProbe('noise\nREACH [true,false]\n', 2)).toEqual([true, false]);
    expect(parseProbe('REACH [true]', 2)).toBeNull();
    expect(parseProbe('REACH not-json', 1)).toBeNull();
    expect(parseProbe('', 1)).toBeNull();
  });
});

describe('checkReachability', () => {
  const values = { DATABASE_URL: 'postgresql://u:p@db.example.com/x', STRIPE_SECRET_KEY: 'sk_test_x' };

  test('blocked services come back as unreachable with a plain explanation', async () => {
    const blocked = await checkReachability(values, async () => 'REACH [false,false]');
    expect(blocked.map((b) => [b.key, b.status])).toEqual([
      ['DATABASE_URL', 'unreachable'],
      ['STRIPE_SECRET_KEY', 'unreachable'],
    ]);
    expect(blocked[0]!.message).toContain('neon.tech');
    expect(blocked[1]!.message).toContain('Stripe');
  });

  test('reachable services pass', async () => {
    expect(await checkReachability(values, async () => 'REACH [true,true]')).toEqual([]);
  });

  test('no running sandbox or a broken probe never blocks the user', async () => {
    expect(await checkReachability(values, async () => null)).toEqual([]);
    expect(await checkReachability(values, async () => 'garbage')).toEqual([]);
    expect(
      await checkReachability(values, async () => {
        throw new Error('daytona down');
      }),
    ).toEqual([]);
  });

  test('nothing to check means no sandbox call at all', async () => {
    let called = false;
    await checkReachability({ ACME_TOKEN: 'abc' }, async () => {
      called = true;
      return 'REACH []';
    });
    expect(called).toBe(false);
  });
});
