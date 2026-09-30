import type { KeyCheck } from './keyVerification';

export type ReachTarget = { key: string; host: string; port: number; kind: 'tcp' | 'tls'; service: string };

const API_HOSTS: [RegExp, string, string][] = [
  [/^OPENAI_API_KEY$/, 'api.openai.com', 'OpenAI'],
  [/^(ANTHROPIC_API_KEY|CLAUDE_API_KEY)$/, 'api.anthropic.com', 'Anthropic'],
  [/^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY)$/, 'generativelanguage.googleapis.com', 'Google Gemini'],
  [/^OPENROUTER_API_KEY$/, 'openrouter.ai', 'OpenRouter'],
  [/^GROQ_API_KEY$/, 'api.groq.com', 'Groq'],
  [/^MISTRAL_API_KEY$/, 'api.mistral.ai', 'Mistral'],
  [/^REPLICATE_API_TOKEN$/, 'api.replicate.com', 'Replicate'],
  [/^ELEVENLABS_API_KEY$/, 'api.elevenlabs.io', 'ElevenLabs'],
  [/^STRIPE_SECRET_KEY$/, 'api.stripe.com', 'Stripe'],
  [/^RESEND_API_KEY$/, 'api.resend.com', 'Resend'],
  [/^SENDGRID_API_KEY$/, 'api.sendgrid.com', 'SendGrid'],
  [/^POSTMARK_(SERVER_)?(API_)?TOKEN$/, 'api.postmarkapp.com', 'Postmark'],
  [/^MAILGUN_API_KEY$/, 'api.mailgun.net', 'Mailgun'],
  [/^TWILIO_(AUTH_TOKEN|ACCOUNT_SID)$/, 'api.twilio.com', 'Twilio'],
  [/^PEXELS_API_KEY$/, 'api.pexels.com', 'Pexels'],
  [/^UNSPLASH_ACCESS_KEY$/, 'api.unsplash.com', 'Unsplash'],
  [/^(GITHUB_TOKEN|GITHUB_PAT)$/, 'api.github.com', 'GitHub'],
  [/^CLERK_SECRET_KEY$/, 'api.clerk.com', 'Clerk'],
];

const DATABASE_KEYS = /^(DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|DIRECT_URL)$/;

export function isNeonHost(host: string): boolean {
  return /\.neon\.tech$/i.test(host);
}

export function reachTargets(values: Record<string, string>): ReachTarget[] {
  const targets: ReachTarget[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const value = String(raw ?? '').trim();
    if (!value) continue;

    if (DATABASE_KEYS.test(key)) {
      try {
        const url = new URL(value);
        if (isNeonHost(url.hostname)) targets.push({ key, host: url.hostname, port: 443, kind: 'tls', service: 'your database' });
        else targets.push({ key, host: url.hostname, port: Number(url.port) || 5432, kind: 'tcp', service: 'your database' });
      } catch {}
      continue;
    }

    if (/^(NEXT_PUBLIC_)?SUPABASE_URL$/.test(key)) {
      try {
        targets.push({ key, host: new URL(value).hostname, port: 443, kind: 'tls', service: 'Supabase' });
      } catch {}
      continue;
    }

    const api = API_HOSTS.find(([pattern]) => pattern.test(key));
    if (api) targets.push({ key, host: api[1], port: 443, kind: 'tls', service: api[2] });
  }
  return targets;
}

export function probeScript(targets: ReachTarget[]): string {
  return `
const net = require('net'), tls = require('tls');
const targets = ${JSON.stringify(targets.map(({ host, port, kind }) => ({ host, port, kind })))};
Promise.all(targets.map(({ host, port, kind }) => new Promise((resolve) => {
  const socket = kind === 'tcp' ? net.connect(port, host) : tls.connect({ host, port, servername: host });
  const done = (ok) => { socket.destroy(); resolve(ok); };
  socket.setTimeout(6000, () => done(false));
  socket.on(kind === 'tcp' ? 'connect' : 'secureConnect', () => done(true));
  socket.on('error', () => done(false));
}))).then((results) => console.log('REACH ' + JSON.stringify(results)));
`;
}

export function parseProbe(output: string, count: number): boolean[] | null {
  const line = output.split('\n').find((l) => l.startsWith('REACH '));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(6));
    return Array.isArray(parsed) && parsed.length === count ? parsed.map(Boolean) : null;
  } catch {
    return null;
  }
}

export function unreachableMessage(target: ReachTarget): string {
  if (target.service === 'your database') {
    return 'This database works, but our build servers cannot connect to it. A free Neon database works: create one at neon.tech and paste its connection link here.';
  }
  return `Your ${target.service} key works, but our build servers cannot reach ${target.service} yet, so this part cannot be built and tested here. You can continue with just the design for now.`;
}

export async function checkReachability(
  values: Record<string, string>,
  run: (script: string) => Promise<string | null>,
): Promise<KeyCheck[]> {
  const targets = reachTargets(values);
  if (targets.length === 0) return [];

  const output = await run(probeScript(targets)).catch(() => null);
  if (output === null) return [];
  const results = parseProbe(output, targets.length);
  if (!results) return [];

  return targets
    .map((target, index) => ({ target, ok: results[index] }))
    .filter(({ ok }) => !ok)
    .map(({ target }) => ({ key: target.key, status: 'unreachable' as const, message: unreachableMessage(target) }));
}
