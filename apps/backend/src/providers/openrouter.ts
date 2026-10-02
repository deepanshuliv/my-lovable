import {
  createFileOps,
  estimateTokens,
  findCutPoint,
  isOverThreshold,
  summarize,
  trackFileOps,
  type ConversationPart,
  type FileOps,
} from '../compaction';
import { addUsage, createUsage, looksLikeError, type ModelProvider, type ProviderEvent, type RunOptions, type ToolSpec } from './types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

const MAX_OUTPUT_TOKENS = Math.max(1_024, Number(process.env.MAX_OUTPUT_TOKENS || '24000'));
const STREAM_REASONING = process.env.OPENROUTER_REASONING === 'on';
const STREAM_DEADLINE_MS = Math.max(30_000, Number(process.env.STREAM_DEADLINE_SECONDS || '240') * 1000);

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class OpenRouterStreamError extends Error {}

type StreamPass = {
  pending: Map<number, { id: string; name: string; args: string }>;
  assistantText: string;
  finishReason: string | null;
  overflowed: boolean;
};

function newStreamPass(): StreamPass {
  return { pending: new Map(), assistantText: '', finishReason: null, overflowed: false };
}

export function retryDelayMs(attempt: number, retryAfter?: string | null): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(30_000, seconds * 1000);
  return Math.min(20_000, 1_500 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

function fallbackModels(primary: string): string[] {
  const extra = (process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model && model !== primary);
  return extra.length > 0 ? [primary, ...extra] : [];
}

export type CompatFlavor = 'openrouter' | 'openai' | 'anthropic' | 'deepseek';

async function postWithRetry(url: string, init: RequestInit, label: string, onAttempt: () => void): Promise<Response> {
  const attempts = Math.max(1, Number(process.env.OPENROUTER_MAX_RETRIES || '4') + 1);
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const isLast = attempt === attempts - 1;
    let response: Response;
    onAttempt();
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = `${label} network error: ${String(error).slice(0, 200)}`;
      if (isLast) break;
      console.log(`[OPENROUTER_RETRY] ${label} network error, attempt ${attempt + 1}`);
      await Bun.sleep(retryDelayMs(attempt));
      continue;
    }
    if (response.ok && response.body) return response;
    const body = await response.text().catch(() => '');
    lastError = `${label} ${response.status}: ${body.slice(0, 400)}`;
    if (response.status === 429 && /per[- ]day|daily/i.test(body)) {
      lastError = `OpenRouter daily request limit reached for this key; it resets at 00:00 UTC. ${body.slice(0, 200)}`;
      break;
    }
    if (!RETRYABLE_STATUS.has(response.status) || isLast) break;
    console.log(`[OPENROUTER_RETRY] ${label} ${response.status}, attempt ${attempt + 1}`);
    await Bun.sleep(retryDelayMs(attempt, response.headers.get('retry-after')));
  }
  throw new Error(lastError);
}

type OpenRouterUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number };

type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCallPayload[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type ToolCallPayload = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

function toOpenAITools(tools: ToolSpec[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export class OpenRouterProvider implements ModelProvider {
  readonly name: CompatFlavor;
  readonly model: string;
  readonly contextWindow: number;
  readonly usage = createUsage();

  private apiKey: string;
  private baseUrl: string;

  constructor(model: string, apiKey: string, baseUrl = DEFAULT_BASE_URL, contextWindow = 128_000, flavor: CompatFlavor = 'openrouter') {
    this.name = flavor;
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.contextWindow = contextWindow;
  }

  private get isOpenRouter(): boolean {
    return this.name === 'openrouter';
  }

  async complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    const models = this.isOpenRouter ? fallbackModels(this.model) : [];
    const response = await postWithRetry(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Title': 'Inkling',
      },
      body: JSON.stringify({
        model: this.model,
        ...(models.length > 0 ? { models } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...(this.name === 'openai' ? { max_completion_tokens: Math.max(maxTokens, 256) } : { max_tokens: maxTokens }),
        stream: false,
        ...(this.isOpenRouter ? { usage: { include: true }, reasoning: { enabled: false } } : {}),
      }),
    }, `${this.name} complete`, () => this.usage.requests++);

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: OpenRouterUsage;
    };
    this.recordUsage(data.usage);
    return data.choices?.[0]?.message?.content ?? '';
  }

  private recordUsage(usage?: OpenRouterUsage) {
    if (!usage) return;
    addUsage(this.usage, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, usage.cost);
  }

  private async openStream(messages: ChatMessage[], tools: ToolSpec[]): Promise<Response> {
    const models = this.isOpenRouter ? fallbackModels(this.model) : [];
    return await postWithRetry(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,

        'HTTP-Referer': process.env.PUBLIC_API_URL || 'http://localhost:8080',
        'X-Title': 'Inkling',
      },
      body: JSON.stringify({
        model: this.model,
        ...(models.length > 0 ? { models } : {}),
        messages,
        tools: toOpenAITools(tools),
        tool_choice: 'auto',
        stream: true,
        ...(this.isOpenRouter
          ? {
              usage: { include: true },
              reasoning: { enabled: STREAM_REASONING },
              provider: {
                require_parameters: true,
                sort: 'throughput',
                allow_fallbacks: true,
              },
            }
          : { stream_options: { include_usage: true } }),
        ...(this.name === 'openai' ? { max_completion_tokens: MAX_OUTPUT_TOKENS } : { max_tokens: MAX_OUTPUT_TOKENS }),
      }),
      signal: AbortSignal.timeout(STREAM_DEADLINE_MS),
    }, `${this.name} stream`, () => this.usage.requests++);
  }

  private async *readChunks(response: Response): AsyncGenerator<any> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          if (chunk?.error) {
            throw new OpenRouterStreamError(`openrouter stream error: ${JSON.stringify(chunk.error).slice(0, 300)}`);
          }
          yield chunk;
        }
      }
    }
  }

  private estimate(messages: ChatMessage[]): number {
    let total = 0;
    for (const message of messages) {
      total += estimateTokens(typeof message.content === 'string' ? message.content : '');
      if ('tool_calls' in message && message.tool_calls) {
        for (const call of message.tool_calls) total += estimateTokens(call.function.arguments);
      }
    }
    return total;
  }

  private requestFits(messages: ChatMessage[], tools: ToolSpec[], budget: RunOptions['contextBudget']): boolean {
    if (!budget) return !isOverThreshold(this.estimate(messages), this.contextWindow);
    return !budget.shouldCompact(this.estimate(messages), estimateTokens(JSON.stringify(tools)));
  }

  private async *compact(
    state: { messages: ChatMessage[]; fileOps: FileOps; previousSummary?: string },
    midStream: boolean,
    force: boolean,
  ): AsyncGenerator<ProviderEvent, void> {
    const { messages } = state;
    const tokensBefore = this.estimate(messages);

    const body = messages.slice(1);
    if (body.length <= 1) return;

    const parts: ConversationPart[] = body.map((message) => ({
      role: message.role === 'tool' ? 'tool' : message.role === 'assistant' ? 'assistant' : 'user',
      content: typeof message.content === 'string' ? message.content : '',
    }));

    let cut = force ? body.length : findCutPoint(parts);
    while (!force && cut < body.length && body[cut]?.role === 'tool') cut++;
    if (cut <= 0) return;

    const summary = await summarize(this, parts.slice(0, cut), state.fileOps, state.previousSummary);
    state.previousSummary = summary;

    const retained = force ? [] : body.slice(cut);
    state.messages.length = 0;
    state.messages.push(
      messages[0] as ChatMessage,
      {
        role: 'user',
        content: `<context-summary>\n${summary}\n</context-summary>\n\nThe conversation above was compacted to free context. Continue from this summary.`,
      },
      ...retained,
    );

    const tokensAfter = this.estimate(state.messages);

    yield force
      ? { type: 'summarization', tokensBefore, tokensAfter, contextWindow: this.contextWindow, summary }
      : { type: 'compaction', tokensBefore, tokensAfter, contextWindow: this.contextWindow, midStream, summary };
  }

  private async *ensureRoom(
    state: { messages: ChatMessage[]; fileOps: FileOps; previousSummary?: string },
    midStream: boolean,
    tools: ToolSpec[],
    budget: RunOptions['contextBudget'],
  ): AsyncGenerator<ProviderEvent, void> {
    const needsCompaction = budget
      ? budget.shouldCompact(this.estimate(state.messages), estimateTokens(JSON.stringify(tools)))
      : isOverThreshold(this.estimate(state.messages), this.contextWindow);
    if (!needsCompaction) return;

    yield* this.compact(state, midStream, false);

    if (!this.requestFits(state.messages, tools, budget)) {
      yield* this.compact(state, midStream, true);
    }
  }

  private async *consumeStream(
    response: Response,
    baseTokens: number,
    tools: ToolSpec[],
    contextBudget: RunOptions['contextBudget'],
    pass: StreamPass,
  ): AsyncGenerator<ProviderEvent, void> {
    for await (const chunk of this.readChunks(response)) {
      if (chunk?.usage) this.recordUsage(chunk.usage);
      const choice = chunk?.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta ?? {};

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        pass.assistantText += delta.content;
        yield { type: 'text_delta', text: delta.content };

        if (contextBudget
          ? contextBudget.shouldCompact(baseTokens + estimateTokens(pass.assistantText), estimateTokens(JSON.stringify(tools)))
          : isOverThreshold(baseTokens + estimateTokens(pass.assistantText), this.contextWindow)) {
          pass.overflowed = true;
          return;
        }
      }

      for (const fragment of delta.tool_calls ?? []) {
        const index: number = fragment.index ?? 0;
        const existing = pass.pending.get(index) ?? { id: '', name: '', args: '' };

        if (fragment.id) existing.id = fragment.id;
        if (fragment.function?.name) existing.name = fragment.function.name;
        if (fragment.function?.arguments) existing.args += fragment.function.arguments;

        pass.pending.set(index, existing);
      }

      if (choice.finish_reason) pass.finishReason = choice.finish_reason;
    }
  }

  async *run(options: RunOptions): AsyncIterable<ProviderEvent> {
    const { systemPrompt, tools, opening, clientErrors, maxTurns, isCancelled, executeTool, contextBudget } = options;

    const initialMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: opening },
    ];
    if (clientErrors) {
      initialMessages.push({ role: 'user', content: clientErrors });
    }

    const state = {
      messages: initialMessages,
      fileOps: createFileOps(),
      previousSummary: undefined as string | undefined,
    };

    let turns = 0;
    let resumeAfterCompaction = false;

    while (true) {
      if (isCancelled()) {
        yield { type: 'finished', reason: 'cancelled' };
        return;
      }
      if (turns >= maxTurns) {
        yield { type: 'error', message: `stopped after ${maxTurns} turns` };
        yield { type: 'finished', reason: 'max_turns' };
        return;
      }
      turns++;

      yield* this.ensureRoom(state, false, tools, contextBudget);

      if (!this.requestFits(state.messages, tools, contextBudget)) {
        yield { type: 'error', message: 'context budget cannot fit mandatory provider request after compaction' };
        yield { type: 'finished', reason: 'context_budget_exceeded' };
        return;
      }

      if (resumeAfterCompaction) {
        resumeAfterCompaction = false;
        state.messages.push({
          role: 'user',
          content:
            'Continue exactly where you left off. Do not repeat what you already said or redo work already completed.',
        });
      }

      if (!this.requestFits(state.messages, tools, contextBudget)) {
        yield { type: 'error', message: 'context budget cannot fit continuation request after compaction' };
        yield { type: 'finished', reason: 'context_budget_exceeded' };
        return;
      }

      const baseTokens = this.estimate(state.messages);
      let response!: Response;
      let pass = newStreamPass();
      let streamFailure: string | null = null;

      for (let streamAttempt = 0; ; streamAttempt++) {
        pass = newStreamPass();
        try {
          response = await this.openStream(state.messages, tools);
        } catch (error) {
          streamFailure = String(error);
          break;
        }
        try {
          yield* this.consumeStream(response, baseTokens, tools, contextBudget, pass);
          streamFailure = null;
          break;
        } catch (error) {
          if (!(error instanceof OpenRouterStreamError)) throw error;
          if (pass.assistantText === '' && pass.pending.size === 0 && streamAttempt < 3) {
            console.log(`[OPENROUTER_RETRY] stream error before any output, attempt ${streamAttempt + 1}`);
            await Bun.sleep(retryDelayMs(streamAttempt));
            continue;
          }
          streamFailure = error.message;
          break;
        }
      }

      if (streamFailure) {
        yield { type: 'error', message: streamFailure };
        yield { type: 'finished', reason: 'error' };
        return;
      }

      const { pending, assistantText, finishReason } = pass;
      const overflowedMidStream = pass.overflowed;

      if (overflowedMidStream) {
        response.body?.cancel().catch(() => {});
        if (assistantText) state.messages.push({ role: 'assistant', content: assistantText });

        yield* this.ensureRoom(state, true, tools, contextBudget);
        resumeAfterCompaction = true;
        continue;
      }

      if (pending.size === 0) {
        yield { type: 'finished', reason: finishReason ?? 'stop' };
        return;
      }

      const calls: ToolCallPayload[] = [...pending.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([index, call]) => ({
          id: call.id || `call_${index}`,
          type: 'function' as const,
          function: { name: call.name, arguments: call.args || '{}' },
        }));

      state.messages.push({ role: 'assistant', content: assistantText || null, tool_calls: calls });

      yield { type: 'thinking' };

      for (const call of calls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch (error) {
          const message = `ERROR: could not parse arguments as JSON: ${error}`;
          yield { type: 'tool_result', id: call.id, name: call.function.name, result: message, isError: true };
          state.messages.push({ role: 'tool', tool_call_id: call.id, content: message });
          continue;
        }

        if (typeof args.comand === 'string') trackFileOps(state.fileOps, args.comand);

        yield { type: 'tool_call', id: call.id, name: call.function.name, args };

        const result = isCancelled()
          ? 'ERROR: cancelled — this turn was stopped (the user left, ownership was lost, or the turn hit its cost limit)'
          : await executeTool(call.function.name, args, call.id);
        const isError = looksLikeError(result);

        yield { type: 'tool_result', id: call.id, name: call.function.name, result, isError };
        state.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }
  }
}
