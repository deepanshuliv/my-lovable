import { describe, expect, test } from 'bun:test';
import type { KeyCheck } from './keyVerification';
import {
  DESIGN_ONLY_ANSWER,
  deferredService,
  STOP_ANSWER,
  requestKeys,
  submitKeyRequest,
  type RequestKeysDeps,
  type SubmitDeps,
} from './keyRequest';

const KEYS = [
  { key: 'OPENAI_API_KEY', reason: 'powers the AI chat' },
  { key: 'ANTHROPIC_API_KEY', reason: 'writes the replies' },
];

function agentSide(outcome: string | Error, overrides: Partial<RequestKeysDeps> = {}) {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const questions: { question: string; options: string[] }[] = [];
  const remembered: string[][] = [];
  let answer = DESIGN_ONLY_ANSWER;
  const deps: RequestKeysDeps = {
    storageReady: () => true,
    savedKeys: async () => [],
    newId: () => 'req-1',
    remember: async (_id, keys) => void remembered.push(keys),
    waitForOutcome: async (_id, onReady) => {
      await onReady();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    emit: async (type, payload) => void events.push({ type, payload }),
    ask: async (question, options) => {
      questions.push({ question, options });
      return answer;
    },
    describe: (key) => ({ service: key.startsWith('OPENAI') ? 'OpenAI' : 'Anthropic' }),
    ...overrides,
  };
  return { deps, events, questions, remembered, setAnswer: (a: string) => void (answer = a) };
}

describe('requestKeys (agent side)', () => {
  test('verified keys let the build continue', async () => {
    const { deps, events } = agentSide('verified');
    const result = await requestKeys(deps, 'the AI chat', KEYS);
    expect(result).toStartWith('VERIFIED');
    expect(events.map((e) => e.type)).toEqual(['keys_request', 'keys_status']);
    expect(events[1]!.payload.status).toBe('verified');
    const shown = events[0]!.payload.keys as { key: string; service: string }[];
    expect(shown.map((k) => k.service)).toEqual(['OpenAI', 'Anthropic']);
  });

  test('only keys that are not saved yet are requested', async () => {
    const { deps, remembered } = agentSide('verified', { savedKeys: async () => ['OPENAI_API_KEY'] });
    await requestKeys(deps, 'the AI chat', KEYS);
    expect(remembered).toEqual([['ANTHROPIC_API_KEY']]);
  });

  test('all keys already saved: no card, build straight away', async () => {
    const { deps, events } = agentSide('verified', { savedKeys: async () => ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] });
    expect(await requestKeys(deps, 'x', KEYS)).toStartWith('VERIFIED');
    expect(events.length).toBe(0);
  });

  test('declined then "design only" builds the frontend without the keys', async () => {
    const { deps, events, questions } = agentSide('declined');
    const result = await requestKeys(deps, 'the AI chat', KEYS);
    expect(result).toStartWith('DESIGN_ONLY');
    expect(result).toContain('OPENAI_API_KEY, ANTHROPIC_API_KEY');
    expect(events[1]!.payload.status).toBe('declined');
    expect(questions[0]!.options).toEqual([DESIGN_ONLY_ANSWER, STOP_ANSWER]);
    expect(questions[0]!.question).toContain('the AI chat');
  });

  test('declined then "come back later" builds nothing', async () => {
    const { deps, setAnswer } = agentSide('declined');
    setAnswer(STOP_ANSWER);
    expect(await requestKeys(deps, 'x', KEYS)).toStartWith('STOP');
  });

  test('a typed "yes please" counts as design only, a "yesterday" does not', async () => {
    const yes = agentSide('declined');
    yes.setAnswer('Yes please, go ahead');
    expect(await requestKeys(yes.deps, 'x', KEYS)).toStartWith('DESIGN_ONLY');
    const no = agentSide('declined');
    no.setAnswer('yesterday I had them');
    expect(await requestKeys(no.deps, 'x', KEYS)).toStartWith('STOP');
  });

  test('timed out request stops without asking another question nobody will answer', async () => {
    const { deps, questions, events } = agentSide(new Error('timeOut error'));
    expect(await requestKeys(deps, 'x', KEYS)).toStartWith('STOP');
    expect(questions.length).toBe(0);
    expect(events[1]!.payload.status).toBe('expired');
  });

  test('user left before answering stops quietly', async () => {
    const { deps, questions } = agentSide(new Error('cancelled: the user left before answering'));
    expect(await requestKeys(deps, 'x', KEYS)).toStartWith('STOP');
    expect(questions.length).toBe(0);
  });

  test('server without key storage skips the card and offers the design', async () => {
    const { deps, events, questions } = agentSide('verified', { storageReady: () => false });
    const result = await requestKeys(deps, 'the AI chat', KEYS);
    expect(result).toStartWith('DESIGN_ONLY');
    expect(events.length).toBe(0);
    expect(questions[0]!.question).toContain('not available on this server');
  });

  test('failing to open the request is reported as an error, not a hang', async () => {
    const { deps } = agentSide('verified', {
      remember: async () => {
        throw new Error('redis down');
      },
    });
    expect(await requestKeys(deps, 'x', KEYS)).toStartWith('ERROR');
  });

  test('an empty key list is an error the model can fix', async () => {
    const { deps } = agentSide('verified');
    expect(await requestKeys(deps, 'x', [])).toStartWith('ERROR');
  });
});

describe('payments, email and SMS are deferred to the next version', () => {
  test('known payment, email and SMS keys are recognised', () => {
    expect(deferredService('STRIPE_SECRET_KEY')).toBe('payments');
    expect(deferredService('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')).toBe('payments');
    expect(deferredService('RESEND_API_KEY')).toBe('email');
    expect(deferredService('SENDGRID_API_KEY')).toBe('email');
    expect(deferredService('TWILIO_AUTH_TOKEN')).toBe('SMS');
    expect(deferredService('OPENAI_API_KEY')).toBeNull();
    expect(deferredService('DATABASE_URL')).toBeNull();
  });

  test('a payments-only request never shows a key card', async () => {
    const { deps, events, questions } = agentSide('verified');
    const result = await requestKeys(deps, 'card payments', [{ key: 'STRIPE_SECRET_KEY', reason: 'payments' }]);
    expect(result).toStartWith('DEFERRED');
    expect(result).toContain('future version');
    expect(events.length).toBe(0);
    expect(questions.length).toBe(0);
  });

  test('a mixed request asks only for the supported key and explains the rest', async () => {
    const { deps, remembered } = agentSide('verified');
    const result = await requestKeys(deps, 'AI chat with payments and email', [
      { key: 'OPENAI_API_KEY', reason: 'chat' },
      { key: 'STRIPE_SECRET_KEY', reason: 'payments' },
      { key: 'RESEND_API_KEY', reason: 'email' },
    ]);
    expect(remembered).toEqual([['OPENAI_API_KEY']]);
    expect(result).toContain('DEFERRED: payments and email');
    expect(result).toContain('VERIFIED');
  });
});

function serverSide(overrides: Partial<SubmitDeps> = {}) {
  const published: string[] = [];
  const saved: Record<string, string>[] = [];
  const deps: SubmitDeps = {
    projectFor: async () => 'proj-1',
    keysFor: async () => ['OPENAI_API_KEY', 'STRIPE_SECRET_KEY'],
    ownerOf: async () => 'user-1',
    publish: async (_id, outcome) => {
      published.push(outcome);
      return 1;
    },
    storageReady: () => true,
    verify: async (values) =>
      Object.entries(values).map(([key, value]): KeyCheck => ({
        key,
        status: value.startsWith('good') ? 'valid' : 'invalid',
        message: '',
      })),
    reachable: async () => [],
    save: async (_p, values) => void saved.push(values),
    ...overrides,
  };
  return { deps, published, saved };
}

const input = (values: unknown, extra: Partial<{ decline: boolean; userId: string; requestId: string }> = {}) => ({
  requestId: 'req-1',
  userId: 'user-1',
  decline: false,
  values,
  ...extra,
});

describe('submitKeyRequest (endpoint)', () => {
  test('all keys valid: saved, then the agent is released', async () => {
    const { deps, published, saved } = serverSide();
    const result = await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: ' good-2 ' }), deps);
    expect(result.status).toBe(201);
    expect(saved).toEqual([{ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'good-2' }]);
    expect(published).toEqual(['verified']);
  });

  test('one bad key: nothing saved, agent still waiting, results returned', async () => {
    const { deps, published, saved } = serverSide();
    const result = await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'bad' }), deps);
    expect(result.status).toBe(422);
    expect(saved.length).toBe(0);
    expect(published.length).toBe(0);
    expect((result.body.results as KeyCheck[]).find((r) => r.key === 'STRIPE_SECRET_KEY')!.status).toBe('invalid');
  });

  test('a missing key counts as invalid', async () => {
    const { deps, saved } = serverSide();
    expect((await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1' }), deps)).status).toBe(422);
    expect(saved.length).toBe(0);
  });

  test('extra keys the agent did not ask for are ignored', async () => {
    const { deps, saved } = serverSide();
    await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'good-2', EVIL_KEY: 'good-x' }), deps);
    expect(Object.keys(saved[0]!)).toEqual(['OPENAI_API_KEY', 'STRIPE_SECRET_KEY']);
  });

  test('malformed bodies are handled', async () => {
    for (const values of [null, 'string', 42, ['OPENAI_API_KEY'], { OPENAI_API_KEY: 123 }]) {
      const { deps, saved } = serverSide();
      expect((await submitKeyRequest(input(values), deps)).status).toBe(422);
      expect(saved.length).toBe(0);
    }
  });

  test('someone else cannot answer your key request', async () => {
    const { deps, saved, published } = serverSide();
    const result = await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'good-2' }, { userId: 'intruder' }), deps);
    expect(result.status).toBe(404);
    expect(saved.length + published.length).toBe(0);
  });

  test('expired or unknown request', async () => {
    expect((await submitKeyRequest(input({}), serverSide({ keysFor: async () => null }).deps)).status).toBe(410);
    expect((await submitKeyRequest(input({}), serverSide({ projectFor: async () => null }).deps)).status).toBe(410);
    expect((await submitKeyRequest(input({}, { requestId: '' }), serverSide().deps)).status).toBe(400);
  });

  test('decline releases the agent without touching keys', async () => {
    const { deps, published, saved } = serverSide();
    const result = await submitKeyRequest(input(undefined, { decline: true }), deps);
    expect(result.status).toBe(201);
    expect(published).toEqual(['declined']);
    expect(saved.length).toBe(0);
  });

  test('decline after the agent stopped waiting reports expiry', async () => {
    const { deps } = serverSide({ publish: async () => 0 });
    expect((await submitKeyRequest(input(undefined, { decline: true }), deps)).status).toBe(410);
  });

  test('keys saved but the build already gave up: told plainly', async () => {
    const { deps, saved } = serverSide({ publish: async () => 0 });
    const result = await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'good-2' }), deps);
    expect(result.status).toBe(410);
    expect(saved.length).toBe(1);
    expect(String(result.body.msg)).toContain('saved');
  });

  test('saving fails: agent is not released', async () => {
    const { deps, published } = serverSide({
      save: async () => {
        throw new Error('db down');
      },
    });
    expect((await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'good-2' }), deps)).status).toBe(500);
    expect(published.length).toBe(0);
  });

  test('storage not configured: 503 and nothing verified', async () => {
    let verified = false;
    const { deps } = serverSide({
      storageReady: () => false,
      verify: async () => {
        verified = true;
        return [];
      },
    });
    expect((await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1' }), deps)).status).toBe(503);
    expect(verified).toBe(false);
  });

  test('a valid key the sandbox cannot reach is not saved and the agent keeps waiting', async () => {
    const { deps, saved, published } = serverSide({
      reachable: async () => [{ key: 'STRIPE_SECRET_KEY', status: 'unreachable', message: 'cannot reach Stripe' }],
    });
    const result = await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'good-2' }), deps);
    expect(result.status).toBe(422);
    expect(result.body.status).toBe('unreachable');
    const results = result.body.results as KeyCheck[];
    expect(results.find((r) => r.key === 'STRIPE_SECRET_KEY')!.status).toBe('unreachable');
    expect(results.find((r) => r.key === 'OPENAI_API_KEY')!.status).toBe('valid');
    expect(saved.length + published.length).toBe(0);
  });

  test('a failing reachability probe does not block valid keys', async () => {
    const { deps, published } = serverSide({
      reachable: async () => {
        throw new Error('sandbox gone');
      },
    });
    expect((await submitKeyRequest(input({ OPENAI_API_KEY: 'good-1', STRIPE_SECRET_KEY: 'good-2' }), deps)).status).toBe(201);
    expect(published).toEqual(['verified']);
  });

  test('unchecked keys are accepted', async () => {
    const { deps, published } = serverSide({
      verify: async (values) => Object.keys(values).map((key) => ({ key, status: 'unchecked' as const, message: '' })),
    });
    expect((await submitKeyRequest(input({ OPENAI_API_KEY: 'a', STRIPE_SECRET_KEY: 'b' }), deps)).status).toBe(201);
    expect(published).toEqual(['verified']);
  });
});
