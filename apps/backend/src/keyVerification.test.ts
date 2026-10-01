import { describe, expect, test } from 'bun:test';
import {
  describeKey,
  isInternalHostname,
  isPrivateAddress,
  verifyKey,
  verifyKeys,
  type VerifyDeps,
} from './keyVerification';

type Route = { status: number; body?: string; json?: boolean } | 'throw';

function fakeDeps(routes: Record<string, Route> = {}, extra: Partial<VerifyDeps> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const deps: VerifyDeps = {
    fetch: async (url, init) => {
      calls.push({ url, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)) });
      const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      const route = match ? routes[match]! : { status: 404 };
      if (route === 'throw') throw new Error('network down');
      return new Response(route.body ?? '', {
        status: route.status,
        headers: route.json === false ? {} : { 'content-type': 'application/json' },
      });
    },
    resolveHost: async () => ['93.184.216.34'],
    connectPostgres: async () => {},
    ...extra,
  };
  return { deps, calls };
}

describe('input hygiene', () => {
  test('empty values are invalid', async () => {
    const { deps } = fakeDeps();
    expect((await verifyKey('OPENAI_API_KEY', '   ', {}, deps)).status).toBe('invalid');
  });

  test('values with inner spaces are rejected before any network call', async () => {
    const { deps, calls } = fakeDeps();
    const result = await verifyKey('OPENAI_API_KEY', 'sk-abc def', {}, deps);
    expect(result.status).toBe('invalid');
    expect(calls.length).toBe(0);
  });

  test('absurdly long values are rejected before any network call', async () => {
    const { deps, calls } = fakeDeps();
    const result = await verifyKey('OPENAI_API_KEY', 'x'.repeat(5000), {}, deps);
    expect(result.status).toBe('invalid');
    expect(calls.length).toBe(0);
  });

  test('surrounding whitespace is trimmed before checking', async () => {
    const { deps, calls } = fakeDeps({ 'https://api.openai.com': { status: 200 } });
    expect((await verifyKeys({ OPENAI_API_KEY: '  sk-real-key-123  ' }, deps))[0]!.status).toBe('valid');
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk-real-key-123');
  });

  test('non-string values do not crash', async () => {
    const { deps } = fakeDeps();
    const results = await verifyKeys({ OPENAI_API_KEY: undefined as unknown as string }, deps);
    expect(results[0]!.status).toBe('invalid');
  });
});

describe('provider responses', () => {
  const cases: [string, string, string, Route, 'valid' | 'invalid' | 'unchecked'][] = [
    ['OPENAI_API_KEY', 'sk-123456789', 'https://api.openai.com', { status: 200 }, 'valid'],
    ['OPENAI_API_KEY', 'sk-123456789', 'https://api.openai.com', { status: 401 }, 'invalid'],
    ['ANTHROPIC_API_KEY', 'sk-ant-123456', 'https://api.anthropic.com', { status: 200 }, 'valid'],
    ['ANTHROPIC_API_KEY', 'sk-ant-123456', 'https://api.anthropic.com', { status: 401 }, 'invalid'],
    ['GEMINI_API_KEY', 'AIza123456789', 'https://generativelanguage.googleapis.com', { status: 400 }, 'invalid'],
    ['GEMINI_API_KEY', 'AIza123456789', 'https://generativelanguage.googleapis.com', { status: 200 }, 'valid'],
    ['OPENROUTER_API_KEY', 'sk-or-123456', 'https://openrouter.ai', { status: 401 }, 'invalid'],
    ['RESEND_API_KEY', 're_123456789', 'https://api.resend.com', { status: 400, body: '{"message":"API key is invalid"}' }, 'invalid'],
    ['RESEND_API_KEY', 're_123456789', 'https://api.resend.com', { status: 401, body: '{"name":"restricted_api_key"}' }, 'valid'],
    ['RESEND_API_KEY', 're_123456789', 'https://api.resend.com', { status: 200 }, 'valid'],
    ['SENDGRID_API_KEY', 'SG.123456789', 'https://api.sendgrid.com', { status: 403 }, 'invalid'],
    ['PEXELS_API_KEY', '123456789abc', 'https://api.pexels.com', { status: 200 }, 'valid'],
  ];

  for (const [key, value, prefix, route, expected] of cases) {
    test(`${key} with HTTP ${route === 'throw' ? 'error' : route.status} is ${expected}`, async () => {
      const { deps } = fakeDeps({ [prefix]: route });
      expect((await verifyKey(key, value, {}, deps)).status).toBe(expected);
    });
  }

  test('a provider that is down leaves the key unchecked instead of rejecting it', async () => {
    const { deps } = fakeDeps({ 'https://api.openai.com': 'throw' });
    expect((await verifyKey('OPENAI_API_KEY', 'sk-123456789', {}, deps)).status).toBe('unchecked');
  });

  test('a provider returning 500 leaves the key unchecked', async () => {
    const { deps } = fakeDeps({ 'https://api.openai.com': { status: 500 } });
    expect((await verifyKey('OPENAI_API_KEY', 'sk-123456789', {}, deps)).status).toBe('unchecked');
  });

  test('a redirect is not treated as success', async () => {
    const { deps } = fakeDeps({ 'https://api.openai.com': { status: 302 } });
    expect((await verifyKey('OPENAI_API_KEY', 'sk-123456789', {}, deps)).status).toBe('unchecked');
  });
});

describe('Stripe', () => {
  test('secret key with a wrong prefix is rejected without calling Stripe', async () => {
    const { deps, calls } = fakeDeps();
    expect((await verifyKey('STRIPE_SECRET_KEY', 'pk_test_123456789', {}, deps)).status).toBe('invalid');
    expect(calls.length).toBe(0);
  });

  test('restricted key without balance permission still counts as valid', async () => {
    const { deps } = fakeDeps({ 'https://api.stripe.com': { status: 403 } });
    expect((await verifyKey('STRIPE_SECRET_KEY', 'rk_test_123456789', {}, deps)).status).toBe('valid');
  });

  test('secret key rejected by Stripe is invalid', async () => {
    const { deps } = fakeDeps({ 'https://api.stripe.com': { status: 401 } });
    expect((await verifyKey('STRIPE_SECRET_KEY', 'sk_test_123456789', {}, deps)).status).toBe('invalid');
  });

  test('publishable and webhook keys are format-checked only', async () => {
    const { deps } = fakeDeps();
    expect((await verifyKey('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_abcdefghijkl', {}, deps)).status).toBe('unchecked');
    expect((await verifyKey('STRIPE_PUBLISHABLE_KEY', 'sk_live_abcdefghijkl', {}, deps)).status).toBe('invalid');
    expect((await verifyKey('STRIPE_WEBHOOK_SECRET', 'whsec_abcdefghijkl', {}, deps)).status).toBe('unchecked');
    expect((await verifyKey('STRIPE_WEBHOOK_SECRET', 'abcdefghijkl', {}, deps)).status).toBe('invalid');
  });
});

describe('paired keys', () => {
  test('Twilio token is checked together with its account SID', async () => {
    const { deps, calls } = fakeDeps({ 'https://api.twilio.com': { status: 200 } });
    const results = await verifyKeys(
      { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'token123456' },
      deps,
    );
    expect(results.every((r) => r.status === 'valid')).toBe(true);
    expect(calls[0]!.url).toContain('AC' + 'a'.repeat(32));
  });

  test('Twilio token without a SID is unchecked, not rejected', async () => {
    const { deps } = fakeDeps();
    expect((await verifyKeys({ TWILIO_AUTH_TOKEN: 'token123456' }, deps))[0]!.status).toBe('unchecked');
  });

  test('Supabase key is only sent to a real supabase.co project', async () => {
    const { deps, calls } = fakeDeps({ 'https://abc.supabase.co': { status: 200 } });
    const ok = await verifyKeys({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOi' }, deps);
    expect(ok.every((r) => r.status === 'valid')).toBe(true);

    calls.length = 0;
    const evil = await verifyKeys({ SUPABASE_URL: 'https://attacker.example.com', SUPABASE_ANON_KEY: 'eyJhbGciOi' }, deps);
    expect(evil.find((r) => r.key === 'SUPABASE_URL')!.status).toBe('invalid');
    expect(evil.find((r) => r.key === 'SUPABASE_ANON_KEY')!.status).toBe('unchecked');
    expect(calls.length).toBe(0);
  });
});

describe('Postgres DATABASE_URL', () => {
  test('a reachable public database is valid', async () => {
    const { deps } = fakeDeps();
    expect((await verifyKey('DATABASE_URL', 'postgresql://u:p@db.example.com:5432/app', {}, deps)).status).toBe('valid');
  });

  test('wrong scheme or garbage is invalid without connecting', async () => {
    let connected = false;
    const { deps } = fakeDeps({}, { connectPostgres: async () => void (connected = true) });
    expect((await verifyKey('DATABASE_URL', 'mysql://u:p@db.example.com/app', {}, deps)).status).toBe('invalid');
    expect((await verifyKey('DATABASE_URL', 'not a url at all', {}, deps)).status).toBe('invalid');
    expect(connected).toBe(false);
  });

  const internal = [
    'postgresql://u:p@localhost:5432/app',
    'postgresql://u:p@127.0.0.1/app',
    'postgresql://u:p@10.1.2.3/app',
    'postgresql://u:p@192.168.1.10/app',
    'postgresql://u:p@172.20.0.5/app',
    'postgresql://u:p@169.254.169.254/app',
    'postgresql://u:p@[::1]/app',
    'postgresql://u:p@postgres:5432/lovable',
    'postgresql://u:p@my-lovable-postgres-1/lovable',
    'postgresql://u:p@db.internal/app',
  ];
  for (const url of internal) {
    test(`internal address is refused: ${url.split('@')[1]}`, async () => {
      let connected = false;
      const { deps } = fakeDeps({}, { connectPostgres: async () => void (connected = true) });
      expect((await verifyKey('DATABASE_URL', url, {}, deps)).status).toBe('invalid');
      expect(connected).toBe(false);
    });
  }

  test('a public hostname that resolves to a private address is refused', async () => {
    let connected = false;
    const { deps } = fakeDeps({}, {
      resolveHost: async () => ['10.0.0.7'],
      connectPostgres: async () => void (connected = true),
    });
    expect((await verifyKey('DATABASE_URL', 'postgresql://u:p@sneaky.example.com/app', {}, deps)).status).toBe('invalid');
    expect(connected).toBe(false);
  });

  test('wrong password is reported in plain words', async () => {
    const { deps } = fakeDeps({}, {
      connectPostgres: async () => {
        throw new Error('password authentication failed for user "u"');
      },
    });
    const result = await verifyKey('DATABASE_URL', 'postgresql://u:p@db.example.com/app', {}, deps);
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('username or password');
  });

  test('connection timeout is invalid', async () => {
    const { deps } = fakeDeps({}, {
      connectPostgres: async () => {
        throw new Error('timed out');
      },
    });
    expect((await verifyKey('DATABASE_URL', 'postgresql://u:p@db.example.com/app', {}, deps)).status).toBe('invalid');
  });
});

describe('unknown services', () => {
  test('long enough values are accepted as unchecked', async () => {
    const { deps, calls } = fakeDeps();
    expect((await verifyKey('ACME_TOKEN', 'abcdefghijkl', {}, deps)).status).toBe('unchecked');
    expect(calls.length).toBe(0);
  });

  test('very short values are rejected', async () => {
    const { deps } = fakeDeps();
    expect((await verifyKey('ACME_TOKEN', 'abc', {}, deps)).status).toBe('invalid');
  });

  test('describeKey labels known and unknown keys', () => {
    expect(describeKey('OPENAI_API_KEY').service).toBe('OpenAI');
    expect(describeKey('OPENAI_API_KEY').helpUrl).toContain('openai.com');
    expect(describeKey('ACME_TOKEN')).toEqual({ service: 'Service key' });
  });
});

describe('address classification', () => {
  test('private and special addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  test('public addresses', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  test('hostnames', () => {
    expect(isInternalHostname('postgres')).toBe(true);
    expect(isInternalHostname('localhost')).toBe(true);
    expect(isInternalHostname('db.local')).toBe(true);
    expect(isInternalHostname('db.example.com')).toBe(false);
  });
});
