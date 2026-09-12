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
import { looksLikeError, type ModelProvider, type ProviderEvent, type RunOptions, type ToolSpec } from './types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

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
  readonly name = 'openrouter' as const;
  readonly model: string;
  readonly contextWindow: number;

  private apiKey: string;
  private baseUrl: string;

  constructor(model: string, apiKey: string, baseUrl = DEFAULT_BASE_URL, contextWindow = 128_000) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.contextWindow = contextWindow;
  }

  /** One-shot completion for compaction summaries. No tools, no streaming. */
  async complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Title': 'my-lovable',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`openrouter summarize ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async openStream(messages: ChatMessage[], tools: ToolSpec[]): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        
        'HTTP-Referer': process.env.PUBLIC_API_URL || 'http://localhost:8080',
        'X-Title': 'my-lovable',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: toOpenAITools(tools),
        tool_choice: 'auto',
        stream: true,
        provider: {
          require_parameters: true,
          sort: 'throughput',
          allow_fallbacks: true,
        },
      }),
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      throw new Error(`openrouter ${response.status}: ${body.slice(0, 400)}`);
    }
    return response;
  }

  /** Split an SSE body into `data:` payloads, tolerating chunk boundaries mid-frame. */
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
          try {
            yield JSON.parse(payload);
          } catch {

          }
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

      let response: Response;
      try {
        response = await this.openStream(state.messages, tools);
      } catch (error) {
        yield { type: 'error', message: String(error) };
        yield { type: 'finished', reason: 'error' };
        return;
      }

            const pending = new Map<number, { id: string; name: string; args: string }>();
      let assistantText = '';
      let finishReason: string | null = null;

      const baseTokens = this.estimate(state.messages);
      /** Set when the response itself pushes us over the limit while it is still arriving. */
      let overflowedMidStream = false;

      for await (const chunk of this.readChunks(response)) {
        const choice = chunk?.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta ?? {};

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          assistantText += delta.content;
          yield { type: 'text_delta', text: delta.content };

          if (contextBudget
            ? contextBudget.shouldCompact(baseTokens + estimateTokens(assistantText), estimateTokens(JSON.stringify(tools)))
            : isOverThreshold(baseTokens + estimateTokens(assistantText), this.contextWindow)) {
            overflowedMidStream = true;
            break;
          }
        }

        for (const fragment of delta.tool_calls ?? []) {
          const index: number = fragment.index ?? 0;
          const existing = pending.get(index) ?? { id: '', name: '', args: '' };

          // Each field can arrive in any chunk, so merge rather than overwrite.
          if (fragment.id) existing.id = fragment.id;
          if (fragment.function?.name) existing.name = fragment.function.name;
          if (fragment.function?.arguments) existing.args += fragment.function.arguments;

          pending.set(index, existing);
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }

      // Overflowed mid-response: keep what arrived, compact, and loop round to resume.
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
          ? 'ERROR: cancelled — this session no longer owns the project'
          : await executeTool(call.function.name, args, call.id);
        const isError = looksLikeError(result);

        yield { type: 'tool_result', id: call.id, name: call.function.name, result, isError };
        state.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }
  }
}
