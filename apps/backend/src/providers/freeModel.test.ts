import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { OpenRouterProvider, setRetrySleep } from './openrouter';
import { canonicalToolName, decodeMarkers, encodeMarkers, normalizeToolArgs } from './wire';
import type { ProviderEvent } from './types';

type Responder = (body: any) => Response | Promise<Response>;

const encoder = new TextEncoder();

function frame(chunk: unknown): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function sse(chunks: unknown[], options: { done?: boolean; dropAfter?: boolean } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(frame(chunk)));
      if (options.dropAfter) {
        controller.error(new TypeError('socket connection was closed unexpectedly'));
        return;
      }
      if (options.done !== false) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const text = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });
const call = (index: number, id: string, name: string, args: string) => ({
  choices: [{ index: 0, delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: args } }] } }],
});
const finish = (reason: string) => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const usage = (cost: number) => ({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, cost } });
const midStreamError = (code: number, message: string) => ({
  error: { code, message },
  choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
});

let queue: Responder[] = [];
let requests: any[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  queue = [];
  requests = [];
  setRetrySleep(async () => {});
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request #${requests.length}`);
    return await next(body);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setRetrySleep((ms) => Bun.sleep(ms));
});

const TOOLS = [
  { name: 'bash_tool', description: 'run', parameters: { type: 'object', properties: { comand: { type: 'string' } } } },
  { name: 'write_file', description: 'write', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
  { name: 'edit_file', description: 'edit', parameters: { type: 'object', properties: { path: { type: 'string' }, target_content: { type: 'string' }, replacement_content: { type: 'string' } } } },
];

async function drive(provider: OpenRouterProvider, maxTurns = 6) {
  const events: ProviderEvent[] = [];
  const executed: { name: string; args: Record<string, unknown> }[] = [];
  for await (const event of provider.run({
    systemPrompt: 'system',
    tools: TOOLS,
    opening: 'build it',
    maxTurns,
    isCancelled: () => false,
    executeTool: async (name, args) => {
      executed.push({ name, args });
      return name === 'bash_tool' ? 'TOOL OUTPUT </think> and <tool_call>' : 'ok';
    },
  })) events.push(event);
  return { events, executed };
}

const free = (options: ConstructorParameters<typeof OpenRouterProvider>[5] = {}) =>
  new OpenRouterProvider('poolside/laguna-s-2.1:free', 'key', 'https://openrouter.ai/api/v1', 262_144, 'openrouter', { freeOnly: true, ...options });

const errorsOf = (events: ProviderEvent[]) => events.filter((e) => e.type === 'error').map((e) => (e as { message: string }).message);
const finishedReason = (events: ProviderEvent[]) => (events.find((e) => e.type === 'finished') as { reason: string } | undefined)?.reason;

describe('free model rate limits', () => {
  test('a per-minute 429 is retried after Retry-After and the turn completes', async () => {
    queue.push(
      () => new Response('{"error":{"message":"Rate limit exceeded: free-models-per-min","code":429}}', { status: 429, headers: { 'retry-after': '3' } }),
      () => sse([text('done'), finish('stop'), usage(0)]),
    );
    const { events } = await drive(free());
    expect(requests).toHaveLength(2);
    expect(errorsOf(events)).toEqual([]);
    expect(finishedReason(events)).toBe('stop');
  });

  test('the daily free-model cap stops at once without burning more requests', async () => {
    queue.push(() => new Response('{"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429}}', { status: 429 }));
    const { events } = await drive(free());
    expect(requests).toHaveLength(1);
    expect(errorsOf(events)[0]).toMatch(/daily request limit/);
  });

  test('a 429 delivered inside the stream before any output is retried', async () => {
    queue.push(
      () => sse([midStreamError(429, 'Rate limit exceeded: free-models-per-min')]),
      () => sse([text('ok'), finish('stop')]),
    );
    const { events } = await drive(free());
    expect(requests).toHaveLength(2);
    expect(errorsOf(events)).toEqual([]);
  });

  test('every request waits for the shared limiter first', async () => {
    let waited = 0;
    queue.push(() => sse([text('ok'), finish('stop')]));
    await drive(free({ limiter: async () => { waited++; } }));
    expect(waited).toBe(1);
  });
});

describe('broken streams', () => {
  test('a connection dropped before any output is retried instead of crashing the run', async () => {
    queue.push(
      () => sse([], { dropAfter: true }),
      () => sse([text('ok'), finish('stop')]),
    );
    const { events } = await drive(free());
    expect(requests).toHaveLength(2);
    expect(errorsOf(events)).toEqual([]);
  });

  test('a connection dropped in the middle of a tool call never executes the half-written call', async () => {
    queue.push(
      () => sse([call(0, 'c1', 'write_file', '{"path":"app/page.tsx","content":"export default fun')], { dropAfter: true }),
      () => sse([call(0, 'c2', 'write_file', '{"path":"app/page.tsx","content":"export default function Page() { return null; }"}'), finish('tool_calls')]),
      () => sse([text('written'), finish('stop')]),
    );
    const { events, executed } = await drive(free());
    expect(executed).toHaveLength(1);
    expect(String(executed[0]!.args.content)).toContain('return null');
    expect(errorsOf(events)).toEqual([]);
  });

  test('an empty completion is retried rather than ending the turn silently', async () => {
    queue.push(
      () => sse([finish('stop')]),
      () => sse([text('real answer'), finish('stop')]),
    );
    const { events } = await drive(free());
    expect(requests).toHaveLength(2);
    expect(events.some((e) => e.type === 'text_delta' && e.text === 'real answer')).toBe(true);
  });

  test('a model that is gone (404 no endpoints) fails fast with one request', async () => {
    queue.push(() => new Response('{"error":{"message":"No endpoints found for poolside/laguna-s-2.1:free.","code":404}}', { status: 404 }));
    const { events } = await drive(free());
    expect(requests).toHaveLength(1);
    expect(errorsOf(events)[0]).toMatch(/404/);
  });
});

describe('malformed tool calls', () => {
  test('tool-call JSON cut off by a chat marker is rejected with a precise hint and retried', async () => {
    queue.push(
      () => sse([call(0, 'c1', 'write_file', '{"path":"lib/parse.ts","content":"const close = text.indexOf(\\"'), finish('stop')]),
      () => sse([call(0, 'c2', 'write_file', '{"path":"lib/parse.ts","content":"export const ok = 1;"}'), finish('tool_calls')]),
      () => sse([text('fixed'), finish('stop')]),
    );
    const { events, executed } = await drive(free());
    expect(executed.map((e) => e.args.content)).toEqual(['export const ok = 1;']);
    const hint = events.find((e) => e.type === 'tool_result' && e.isError) as { result: string } | undefined;
    expect(hint?.result).toMatch(/cut off/i);
    expect(requests[1].messages.at(-1).content).toMatch(/cut off/i);
  });

  test('tool calls truncated by the output length limit tell the model to write smaller files', async () => {
    queue.push(
      () => sse([call(0, 'c1', 'write_file', '{"path":"app/page.tsx","content":"aaaa'), finish('length')]),
      () => sse([text('ok'), finish('stop')]),
    );
    const { events, executed } = await drive(free());
    expect(executed).toHaveLength(0);
    const result = events.find((e) => e.type === 'tool_result') as { result: string } | undefined;
    expect(result?.result).toMatch(/length limit/i);
  });

  test('common argument spellings are mapped onto the schema names', async () => {
    queue.push(
      () => sse([
        call(0, 'c1', 'bash_tool', '{"command":"npm run typecheck"}'),
        call(1, 'c2', 'write_file', '{"file_path":"a.ts","contents":"x"}'),
        call(2, 'c3', 'edit_file', '{"path":"a.ts","old_string":"x","new_string":"y"}'),
        finish('tool_calls'),
      ]),
      () => sse([text('ok'), finish('stop')]),
    );
    const { executed } = await drive(free());
    expect(executed[0]!.args).toMatchObject({ comand: 'npm run typecheck' });
    expect(executed[1]!.args).toMatchObject({ path: 'a.ts', content: 'x' });
    expect(executed[2]!.args).toMatchObject({ target_content: 'x', replacement_content: 'y' });
  });

  test('a tool name with leaked markup (bash_tool>) still reaches the right tool', async () => {
    queue.push(
      () => sse([call(0, 'c1', 'bash_tool>', '{"command":"npm run typecheck"}'), call(1, 'c2', 'functions.write_file', '{"path":"a.ts","content":"x"}'), finish('tool_calls')]),
      () => sse([text('ok'), finish('stop')]),
    );
    const { executed } = await drive(free());
    expect(executed.map((e) => e.name)).toEqual(['bash_tool', 'write_file']);
  });

  test('a tool call written as plain text is caught and the model is told to use the tool API', async () => {
    queue.push(
      () => sse([text('<tool_call>\n{"name": "bash_tool", "arguments": {"comand": "ls"}}\n</tool_call>'), finish('stop')]),
      () => sse([call(0, 'c1', 'bash_tool', '{"comand":"ls"}'), finish('tool_calls')]),
      () => sse([text('done'), finish('stop')]),
    );
    const { executed } = await drive(free());
    expect(executed).toHaveLength(1);
    expect(JSON.stringify(requests[1].messages)).toMatch(/tool-calling API/);
  });
});

describe('chat-protocol markers in code', () => {
  test('markers are encoded in everything sent to the model and decoded in tool arguments', async () => {
    queue.push(
      () => sse([call(0, 'c1', 'bash_tool', '{"comand":"grep -n \\"‹/think›\\" lib/parse.ts"}'), finish('tool_calls')]),
      () => sse([text('saw ‹tool_call›'), finish('stop')]),
    );
    const { events, executed } = await drive(free());
    expect(executed[0]!.args.comand).toBe('grep -n "</think>" lib/parse.ts');
    const sent = JSON.stringify(requests[1].messages);
    expect(sent).not.toContain('</think>');
    expect(sent).not.toContain('<tool_call>');
    expect(events.some((e) => e.type === 'text_delta' && e.text.includes('<tool_call>'))).toBe(true);
  });

  test('the codec round-trips all six markers and leaves other tags alone', () => {
    const source = '<think></think><assistant></assistant><tool_call></tool_call><div></div>';
    expect(encodeMarkers(source)).not.toMatch(/<\/?(think|assistant|tool_call)>/);
    expect(encodeMarkers(source)).toContain('<div></div>');
    expect(decodeMarkers(encodeMarkers(source))).toBe(source);
  });

  test('canonicalToolName recovers the tool from a name with leaked reasoning and markup', () => {
    const tools = ['bash_tool', 'write_file', 'edit_file'];
    expect(canonicalToolName('` content contains JSON with quotes, so I need to ensure it renders verbatim.<tool_call>write_file', tools)).toBe('write_file');
    expect(canonicalToolName('bash_tool>', tools)).toBe('bash_tool');
    expect(canonicalToolName('grep', tools)).toBe('grep');
    expect(canonicalToolName('write_file or edit_file', tools)).toBe('write_file or edit_file');
  });

  test('normalizeToolArgs keeps canonical names when both spellings are present', () => {
    expect(normalizeToolArgs('bash_tool', { comand: 'a', command: 'b' })).toEqual({ comand: 'a' });
  });
});

describe('platform spend guard', () => {
  test('free-only requests ask OpenRouter to refuse any priced endpoint and drop paid fallbacks', async () => {
    const previous = process.env.OPENROUTER_FALLBACK_MODELS;
    process.env.OPENROUTER_FALLBACK_MODELS = 'deepseek/deepseek-v4-flash,poolside/laguna-xs-2.1:free';
    try {
      queue.push(() => sse([text('ok'), finish('stop')]));
      await drive(free());
      expect(requests[0].provider.max_price).toEqual({ prompt: 0, completion: 0 });
      expect(requests[0].models).toEqual(['poolside/laguna-s-2.1:free', 'poolside/laguna-xs-2.1:free']);
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_FALLBACK_MODELS;
      else process.env.OPENROUTER_FALLBACK_MODELS = previous;
    }
  });

  test('a response that reports any cost stops the run before another request is made', async () => {
    queue.push(() => sse([call(0, 'c1', 'bash_tool', '{"comand":"ls"}'), finish('tool_calls'), usage(0.0004)]));
    const { events, executed } = await drive(free());
    expect(requests).toHaveLength(1);
    expect(executed).toHaveLength(0);
    expect(errorsOf(events)[0]).toMatch(/paid usage/);
  });

  test('a free-only provider refuses to be built for a paid model', () => {
    expect(() => new OpenRouterProvider('deepseek/deepseek-v4-flash', 'key', undefined, 128_000, 'openrouter', { freeOnly: true })).toThrow(/free/);
  });
});
