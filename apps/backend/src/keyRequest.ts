import type { KeyCheck, KeyInfo } from './keyVerification';
import type { RequiredSecret } from './tools/toolDefintion';

export const DESIGN_ONLY_ANSWER = 'Yes, design my website';

export const DEFERRED_SERVICES: { name: string; keys: RegExp }[] = [
  { name: 'payments', keys: /^(NEXT_PUBLIC_)?STRIPE_|^(PAYPAL|RAZORPAY|LEMONSQUEEZY|PADDLE)_/ },
  { name: 'email', keys: /^(RESEND|SENDGRID|POSTMARK|MAILGUN|SMTP|BREVO|MAILCHIMP)_/ },
  { name: 'SMS', keys: /^(TWILIO|VONAGE|MESSAGEBIRD|PLIVO)_/ },
];

export function deferredService(key: string): string | null {
  return DEFERRED_SERVICES.find((service) => service.keys.test(key))?.name ?? null;
}

function deferredNote(deferred: RequiredSecret[]): string {
  const names = [...new Set(deferred.map((secret) => deferredService(secret.key)!))];
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `DEFERRED: ${list} (${deferred.map((s) => s.key).join(', ')}) are not part of this version. Do not ask for these keys again and do not reference them in code. Build that part as a realistic design-only flow on the client (for example a pretend checkout or a confirmation instead of a sent email or text) with a small, friendly "Preview" note, and tell the user in one plain sentence that real ${list} are coming in a future version.`;
}
export const STOP_ANSWER = "No, I'll come back with my keys";

export type RequestKeysDeps = {
  storageReady: () => boolean;
  savedKeys: () => Promise<string[]>;
  newId: () => string;
  remember: (requestId: string, keys: string[]) => Promise<void>;
  waitForOutcome: (requestId: string, onReady: () => Promise<void>) => Promise<string>;
  emit: (type: 'keys_request' | 'keys_status', payload: Record<string, unknown>) => Promise<unknown>;
  ask: (question: string, options: string[]) => Promise<string>;
  describe: (key: string) => KeyInfo;
};

function designQuestion(service: string, reason: 'declined' | 'unavailable') {
  const opener =
    reason === 'unavailable'
      ? 'Connecting outside services is not available on this server yet, but we can still create how your website will look.'
      : 'No problem! We can still create how your website will look.';
  return `${opener} We will design every page and screen with sample content so you can see it and click around. The parts that need your keys (${service}) will look real but will not actually work yet, and you can add the keys any time later. Shall we go ahead with just the design?`;
}

async function designOrStop(deps: RequestKeysDeps, service: string, names: string, reason: 'declined' | 'unavailable') {
  const answer = await deps.ask(designQuestion(service, reason), [DESIGN_ONLY_ANSWER, STOP_ANSWER]);

  if (answer === DESIGN_ONLY_ANSWER || /^\s*yes\b/i.test(answer)) {
    return `DESIGN_ONLY: the user has no keys for ${names} and chose to continue with the design only. Build the frontend only, following the design brief: every page, screen and state with realistic sample content. Simulate the parts that need these keys on the client (sample responses, a pretend checkout, a confirmation instead of a sent email), and mark them in the UI with a small, friendly "Preview" note. Do not install their SDKs, do not create API routes for them, and do not reference ${names} anywhere in the code.`;
  }
  return 'STOP: the user will come back with their keys. Do not write any code. Reply in one or two short, friendly sentences that you are ready to build as soon as they have the keys.';
}

export async function requestKeys(deps: RequestKeysDeps, service: string, keys: RequiredSecret[]): Promise<string> {
  if (keys.length === 0) {
    return 'ERROR: no valid keys were listed. Call request_api_keys again with every key this build needs.';
  }

  const deferred = keys.filter((secret) => deferredService(secret.key));
  if (deferred.length > 0) {
    const rest = keys.filter((secret) => !deferredService(secret.key));
    if (rest.length === 0) return deferredNote(deferred);
    return `${deferredNote(deferred)}\n\n${await requestKeys(deps, service, rest)}`;
  }

  const existing = new Set(await deps.savedKeys().catch(() => [] as string[]));
  const missing = keys.filter((secret) => !existing.has(secret.key));
  const names = missing.map((s) => s.key).join(', ');

  if (missing.length === 0) {
    return `VERIFIED: ${keys.map((s) => s.key).join(', ')} already saved for this project. Build the full feature, reading each value with process.env.NAME inside the request handler.`;
  }

  if (!deps.storageReady()) return await designOrStop(deps, service, names, 'unavailable');

  const requestId = deps.newId();
  try {
    await deps.remember(requestId, missing.map((s) => s.key));
  } catch (error) {
    return `ERROR: could not open the key request: ${String(error).slice(0, 200)}. Do not build the feature; tell the user to try again.`;
  }

  let outcome: string;
  try {
    outcome = await deps.waitForOutcome(requestId, async () => {
      await deps.emit('keys_request', {
        requestId,
        service,
        keys: missing.map((secret) => ({ ...secret, ...deps.describe(secret.key) })),
      });
    });
  } catch (error) {
    outcome = String(error).includes('cancelled') ? 'cancelled' : 'expired';
  }

  if (outcome === 'verified') {
    await deps.emit('keys_status', { requestId, status: 'verified' });
    return `VERIFIED: the user provided ${names} and the platform confirmed them with each provider. They are set as environment variables in the sandbox and the dev server was restarted. Build the full feature now, reading each value with process.env.NAME inside the request handler. Never print or hardcode them.`;
  }

  await deps.emit('keys_status', { requestId, status: outcome === 'declined' ? 'declined' : 'expired' });
  if (outcome === 'cancelled') return 'STOP: the user left before answering. Do not build anything.';
  if (outcome !== 'declined') {
    return 'STOP: the user did not answer the key request in time. Do not write any code. Reply in one short sentence that you can continue whenever they are ready.';
  }

  return await designOrStop(deps, service, names, 'declined');
}

export type SubmitInput = {
  requestId: string;
  userId: string;
  decline: boolean;
  values: unknown;
};

export type SubmitDeps = {
  projectFor: (requestId: string) => Promise<string | null>;
  keysFor: (requestId: string) => Promise<string[] | null>;
  ownerOf: (projectId: string) => Promise<string | null>;
  publish: (requestId: string, outcome: 'verified' | 'declined') => Promise<number>;
  storageReady: () => boolean;
  verify: (values: Record<string, string>) => Promise<KeyCheck[]>;
  reachable: (projectId: string, values: Record<string, string>) => Promise<KeyCheck[]>;
  save: (projectId: string, values: Record<string, string>) => Promise<void>;
};

export type SubmitResult = { status: number; body: Record<string, unknown> };

const EXPIRED = 'This request has expired. Send your message again to continue.';
const MAX_KEYS = 20;

export async function submitKeyRequest(input: SubmitInput, deps: SubmitDeps): Promise<SubmitResult> {
  if (!input.requestId) return { status: 400, body: { msg: 'please provide a valid requestId' } };

  const projectId = await deps.projectFor(input.requestId);
  const requested = await deps.keysFor(input.requestId);
  if (!projectId || !requested) return { status: 410, body: { msg: EXPIRED } };

  if ((await deps.ownerOf(projectId)) !== input.userId) return { status: 404, body: { msg: 'unknown request' } };

  if (input.decline) {
    const delivered = await deps.publish(input.requestId, 'declined');
    return delivered === 0 ? { status: 410, body: { msg: EXPIRED } } : { status: 201, body: { status: 'declined' } };
  }

  if (!deps.storageReady()) return { status: 503, body: { msg: 'Saving keys is not configured on this server.' } };

  const body = input.values && typeof input.values === 'object' && !Array.isArray(input.values)
    ? (input.values as Record<string, unknown>)
    : {};
  const values: Record<string, string> = {};
  for (const key of requested.slice(0, MAX_KEYS)) values[key] = typeof body[key] === 'string' ? (body[key] as string).trim() : '';

  let results = await deps.verify(values);
  if (results.length !== Object.keys(values).length || results.some((result) => result.status === 'invalid')) {
    return { status: 422, body: { status: 'invalid', results } };
  }

  const blocked = await deps.reachable(projectId, values).catch(() => [] as KeyCheck[]);
  if (blocked.length > 0) {
    results = results.map((result) => blocked.find((b) => b.key === result.key) ?? result);
    return { status: 422, body: { status: 'unreachable', results } };
  }

  try {
    await deps.save(projectId, values);
  } catch (error) {
    console.log('[KEYS_SAVE_FAILED] , ', String(error).slice(0, 200));
    return { status: 500, body: { msg: 'Your keys are valid but could not be saved. Please try again.' } };
  }

  const delivered = await deps.publish(input.requestId, 'verified');
  if (delivered === 0) {
    return { status: 410, body: { msg: 'Your keys were saved, but the build had already stopped. Send your message again to continue.', results } };
  }
  return { status: 201, body: { status: 'verified', results } };
}
