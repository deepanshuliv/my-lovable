import { SQL } from 'bun';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type KeyStatus = 'valid' | 'invalid' | 'unchecked' | 'unreachable';

export type KeyCheck = { key: string; status: KeyStatus; message: string };

export type KeyInfo = { service: string; helpUrl?: string };

type Values = Record<string, string>;

export type VerifyDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  resolveHost: (host: string) => Promise<string[]>;
  connectPostgres: (url: string) => Promise<void>;
};

type Rule = {
  match: RegExp;
  service: string;
  helpUrl?: string;
  check: (value: string, values: Values, deps: VerifyDeps) => Promise<KeyCheck['status'] | [KeyStatus, string]>;
};

const TIMEOUT_MS = 8_000;
const MAX_VALUE_LENGTH = 4_096;

async function connectPostgres(url: string): Promise<void> {
  const sql = new SQL(url, { max: 1, connectionTimeout: 8, idleTimeout: 1 });
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS + 2_000)),
    ]);
  } finally {
    await sql.close().catch(() => {});
  }
}

export const defaultVerifyDeps: VerifyDeps = {
  fetch: (url, init) => fetch(url, init),
  resolveHost: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
  connectPostgres,
};

async function probe(deps: VerifyDeps, url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
  } catch {
    return null;
  }
}

function judge(response: Response | null): KeyStatus | [KeyStatus, string] {
  if (!response) return ['unchecked', 'The service did not respond, so we could not confirm this key.'];
  if (response.ok) return 'valid';
  if (response.status === 401 || response.status === 403) return 'invalid';
  return ['unchecked', `The service answered with an unexpected status (${response.status}), so we could not confirm this key.`];
}

const bearer = (value: string) => ({ headers: { Authorization: `Bearer ${value}` } });

export function isPrivateAddress(address: string): boolean {
  const h = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(h) === 6) {
    if (h === '::' || h === '::1') return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(h);
  }
  if (isIP(h) !== 4) return false;
  const [a, b] = h.split('.').map(Number) as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  );
}

export function isInternalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (isIP(h)) return isPrivateAddress(h);
  if (!h.includes('.')) return true;
  return h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(h);
}

async function resolvesPrivately(host: string, deps: VerifyDeps): Promise<boolean> {
  if (isInternalHostname(host)) return true;
  if (isIP(host.replace(/^\[|\]$/g, ''))) return false;
  try {
    const addresses = await deps.resolveHost(host);
    return addresses.length === 0 || addresses.some(isPrivateAddress);
  } catch {
    return false;
  }
}

async function checkPostgres(value: string, deps: VerifyDeps): Promise<[KeyStatus, string] | KeyStatus> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return ['invalid', 'This does not look like a database address. It should start with postgres:// or postgresql://'];
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return ['invalid', 'This should be a Postgres address starting with postgres:// or postgresql://'];
  }
  if (await resolvesPrivately(url.hostname, deps)) {
    return ['invalid', 'This database is only reachable from your own computer or network. Use a hosted database that is reachable from the internet.'];
  }

  try {
    await deps.connectPostgres(value);
    return 'valid';
  } catch (error) {
    const text = String(error).toLowerCase();
    if (text.includes('password') || text.includes('authentication')) {
      return ['invalid', 'The database rejected the username or password.'];
    }
    if (text.includes('does not exist')) return ['invalid', 'The database name in this address does not exist.'];
    return ['invalid', 'We could not connect to this database. Check the address and that it accepts outside connections.'];
  }
}

const RULES: Rule[] = [
  {
    match: /^(DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|DIRECT_URL)$/,
    service: 'Postgres database',
    helpUrl: 'https://neon.tech/docs/connect/connect-from-any-app',
    check: (v, _values, deps) => checkPostgres(v, deps),
  },
  {
    match: /^OPENAI_API_KEY$/,
    service: 'OpenAI',
    helpUrl: 'https://platform.openai.com/api-keys',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.openai.com/v1/models', bearer(v))),
  },
  {
    match: /^(ANTHROPIC_API_KEY|CLAUDE_API_KEY)$/,
    service: 'Anthropic (Claude)',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    check: async (v, _values, deps) =>
      judge(await probe(deps, 'https://api.anthropic.com/v1/models', { headers: { 'x-api-key': v, 'anthropic-version': '2023-06-01' } })),
  },
  {
    match: /^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY)$/,
    service: 'Google Gemini',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    check: async (v, _values, deps) => {
      const response = await probe(deps, `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(v)}`);
      if (response?.status === 400) return 'invalid';
      return judge(response);
    },
  },
  {
    match: /^OPENROUTER_API_KEY$/,
    service: 'OpenRouter',
    helpUrl: 'https://openrouter.ai/keys',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://openrouter.ai/api/v1/key', bearer(v))),
  },
  {
    match: /^GROQ_API_KEY$/,
    service: 'Groq',
    helpUrl: 'https://console.groq.com/keys',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.groq.com/openai/v1/models', bearer(v))),
  },
  {
    match: /^MISTRAL_API_KEY$/,
    service: 'Mistral',
    helpUrl: 'https://console.mistral.ai/api-keys',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.mistral.ai/v1/models', bearer(v))),
  },
  {
    match: /^REPLICATE_API_TOKEN$/,
    service: 'Replicate',
    helpUrl: 'https://replicate.com/account/api-tokens',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.replicate.com/v1/account', bearer(v))),
  },
  {
    match: /^ELEVENLABS_API_KEY$/,
    service: 'ElevenLabs',
    helpUrl: 'https://elevenlabs.io/app/settings/api-keys',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.elevenlabs.io/v1/models', { headers: { 'xi-api-key': v } })),
  },
  {
    match: /^STRIPE_SECRET_KEY$/,
    service: 'Stripe',
    helpUrl: 'https://dashboard.stripe.com/apikeys',
    check: async (v, _values, deps) => {
      if (!/^(sk|rk)_(test|live)_/.test(v)) return ['invalid', 'A Stripe secret key starts with sk_test_ or sk_live_.'];
      const response = await probe(deps, 'https://api.stripe.com/v1/balance', bearer(v));
      if (response?.status === 403 && v.startsWith('rk_')) return 'valid';
      return judge(response);
    },
  },
  {
    match: /^(NEXT_PUBLIC_)?STRIPE_PUBLISHABLE_KEY$/,
    service: 'Stripe',
    helpUrl: 'https://dashboard.stripe.com/apikeys',
    check: async (v, _values, deps) =>
      /^pk_(test|live)_\w{10,}$/.test(v)
        ? ['unchecked', 'This looks like a Stripe publishable key. Stripe does not let us test these on their own.']
        : ['invalid', 'A Stripe publishable key starts with pk_test_ or pk_live_.'],
  },
  {
    match: /^STRIPE_WEBHOOK_SECRET$/,
    service: 'Stripe webhooks',
    helpUrl: 'https://dashboard.stripe.com/webhooks',
    check: async (v, _values, deps) =>
      /^whsec_\w{10,}$/.test(v)
        ? ['unchecked', 'This looks like a Stripe webhook secret. It can only be confirmed when Stripe sends an event.']
        : ['invalid', 'A Stripe webhook secret starts with whsec_.'],
  },
  {
    match: /^RESEND_API_KEY$/,
    service: 'Resend (email)',
    helpUrl: 'https://resend.com/api-keys',
    check: async (v, _values, deps) => {
      const response = await probe(deps, 'https://api.resend.com/domains', bearer(v));
      if (response && (response.status === 400 || response.status === 401)) {
        const body = await response.text().catch(() => '');
        if (body.includes('restricted_api_key')) return 'valid';
        if (/api key is invalid|invalid_api_key|missing_api_key/i.test(body)) return 'invalid';
        return response.status === 401 ? 'invalid' : judge(response);
      }
      return judge(response);
    },
  },
  {
    match: /^SENDGRID_API_KEY$/,
    service: 'SendGrid (email)',
    helpUrl: 'https://app.sendgrid.com/settings/api_keys',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.sendgrid.com/v3/scopes', bearer(v))),
  },
  {
    match: /^POSTMARK_(SERVER_)?(API_)?TOKEN$/,
    service: 'Postmark (email)',
    helpUrl: 'https://account.postmarkapp.com/servers',
    check: async (v, _values, deps) =>
      judge(await probe(deps, 'https://api.postmarkapp.com/server', { headers: { 'X-Postmark-Server-Token': v, Accept: 'application/json' } })),
  },
  {
    match: /^TWILIO_AUTH_TOKEN$/,
    service: 'Twilio (SMS)',
    helpUrl: 'https://console.twilio.com',
    check: async (v, values, deps) => {
      const sid = values.TWILIO_ACCOUNT_SID;
      if (!sid) return ['unchecked', 'Add TWILIO_ACCOUNT_SID as well so we can check this token.'];
      const auth = Buffer.from(`${sid}:${v}`).toString('base64');
      return judge(await probe(deps, `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, { headers: { Authorization: `Basic ${auth}` } }));
    },
  },
  {
    match: /^TWILIO_ACCOUNT_SID$/,
    service: 'Twilio (SMS)',
    helpUrl: 'https://console.twilio.com',
    check: async (v, _values, deps) =>
      /^AC[0-9a-f]{32}$/i.test(v) ? 'valid' : ['invalid', 'A Twilio Account SID starts with AC followed by 32 characters.'],
  },
  {
    match: /^PEXELS_API_KEY$/,
    service: 'Pexels (photos)',
    helpUrl: 'https://www.pexels.com/api/',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.pexels.com/v1/curated?per_page=1', { headers: { Authorization: v } })),
  },
  {
    match: /^(NEXT_PUBLIC_)?UNSPLASH_ACCESS_KEY$/,
    service: 'Unsplash (photos)',
    helpUrl: 'https://unsplash.com/oauth/applications',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.unsplash.com/photos?per_page=1', { headers: { Authorization: `Client-ID ${v}` } })),
  },
  {
    match: /^(GITHUB_TOKEN|GITHUB_PAT)$/,
    service: 'GitHub',
    helpUrl: 'https://github.com/settings/tokens',
    check: async (v, _values, deps) =>
      judge(await probe(deps, 'https://api.github.com/user', { headers: { Authorization: `Bearer ${v}`, 'User-Agent': 'inkling-key-check' } })),
  },
  {
    match: /^CLERK_SECRET_KEY$/,
    service: 'Clerk (sign-in)',
    helpUrl: 'https://dashboard.clerk.com',
    check: async (v, _values, deps) => judge(await probe(deps, 'https://api.clerk.com/v1/users?limit=1', bearer(v))),
  },
  {
    match: /^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY$/,
    service: 'Clerk (sign-in)',
    helpUrl: 'https://dashboard.clerk.com',
    check: async (v, _values, deps) =>
      /^pk_(test|live)_\w{10,}$/.test(v)
        ? ['unchecked', 'This looks like a Clerk publishable key.']
        : ['invalid', 'A Clerk publishable key starts with pk_test_ or pk_live_.'],
  },
  {
    match: /^(NEXT_PUBLIC_)?SUPABASE_URL$/,
    service: 'Supabase',
    helpUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    check: async (v, _values, deps) => {
      try {
        const url = new URL(v);
        return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co')
          ? 'valid'
          : ['invalid', 'A Supabase project address looks like https://your-project.supabase.co'];
      } catch {
        return ['invalid', 'A Supabase project address looks like https://your-project.supabase.co'];
      }
    },
  },
  {
    match: /^(NEXT_PUBLIC_)?SUPABASE_(ANON_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|SECRET_KEY)$/,
    service: 'Supabase',
    helpUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    check: async (v, values, deps) => {
      const base = values.NEXT_PUBLIC_SUPABASE_URL ?? values.SUPABASE_URL;
      if (!base) return ['unchecked', 'Add the Supabase project address as well so we can check this key.'];
      let url: URL;
      try {
        url = new URL('/rest/v1/', base);
      } catch {
        return ['unchecked', 'The Supabase project address is not valid, so we could not check this key.'];
      }
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
        return ['unchecked', 'The Supabase project address is not valid, so we could not check this key.'];
      }
      return judge(await probe(deps, url.toString(), { headers: { apikey: v, Authorization: `Bearer ${v}` } }));
    },
  },
];

export function describeKey(key: string): KeyInfo {
  const rule = RULES.find((r) => r.match.test(key));
  return rule ? { service: rule.service, helpUrl: rule.helpUrl } : { service: 'Service key' };
}

const MESSAGES: Record<KeyStatus, string> = {
  valid: 'Checked and working.',
  invalid: 'This key was rejected. Please check it and paste it again.',
  unchecked: 'We could not check this one automatically, so we will trust it.',
  unreachable: 'Our build servers cannot reach this service yet.',
};

export async function verifyKey(key: string, value: string, values: Values, deps: VerifyDeps = defaultVerifyDeps): Promise<KeyCheck> {
  const trimmed = value.trim();
  if (!trimmed) return { key, status: 'invalid', message: 'This one is empty.' };
  if (trimmed.length > MAX_VALUE_LENGTH) return { key, status: 'invalid', message: 'This is far too long to be a key. Copy just the key itself.' };
  if (/\s/.test(trimmed)) return { key, status: 'invalid', message: 'This contains spaces. Copy the key again without extra characters.' };

  const rule = RULES.find((r) => r.match.test(key));
  if (!rule) {
    return trimmed.length >= 8
      ? { key, status: 'unchecked', message: MESSAGES.unchecked }
      : { key, status: 'invalid', message: 'This looks too short to be a real key.' };
  }

  try {
    const outcome = await rule.check(trimmed, values, deps);
    const [status, message] = Array.isArray(outcome) ? outcome : [outcome, MESSAGES[outcome]];
    return { key, status, message };
  } catch {
    return { key, status: 'unchecked', message: MESSAGES.unchecked };
  }
}

export async function verifyKeys(values: Values, deps: VerifyDeps = defaultVerifyDeps): Promise<KeyCheck[]> {
  const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v ?? '').trim()]));
  return await Promise.all(Object.entries(trimmed).map(([key, value]) => verifyKey(key, value, trimmed, deps)));
}
