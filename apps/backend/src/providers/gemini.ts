import { GoogleGenAI } from '@google/genai';
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

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {

  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

function toGeminiTools(tools: ToolSpec[]): any[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export class GeminiProvider implements ModelProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  readonly contextWindow: number;
    private readonly ownClient: GoogleGenAI | null;

  constructor(model: string, contextWindow = 1_000_000, apiKey?: string) {
    this.model = model;
    this.contextWindow = contextWindow;
    this.ownClient = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  private client(): GoogleGenAI {
    return this.ownClient ?? getClient();
  }

  private requestFits(transcript: ConversationPart[], tools: ToolSpec[], budget: RunOptions['contextBudget']): boolean {
    const inputTokens = transcript.reduce((total, part) => total + estimateTokens(part.content), 0);
    if (!budget) return !isOverThreshold(inputTokens, this.contextWindow);
    return !budget.shouldCompact(inputTokens, estimateTokens(JSON.stringify(tools)));
  }

    async complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {

    const stream = (await this.client().interactions.create({
      model: this.model,
      input: [{ type: 'user_input', content: [{ text: userPrompt, type: 'text' }] }],
      system_instruction: systemPrompt,
      stream: true,

      generation_config: { max_output_tokens: maxTokens },
    } as any)) as unknown as AsyncIterable<any>;

    let text = '';
    for await (const event of stream) {
      if (event.event_type === 'step.delta' && event.delta.type === 'text') {
        text += event.delta.text;
      }
    }
    return text;
  }

    private async *compact(
    state: { transcript: ConversationPart[]; fileOps: FileOps; previousSummary?: string },
    midStream: boolean,
    force: boolean,
  ): AsyncGenerator<ProviderEvent, string | null> {
    const tokensBefore = state.transcript.reduce((n, p) => n + estimateTokens(p.content), 0);
    if (state.transcript.length <= 1) return null;

    const cut = force ? state.transcript.length : findCutPoint(state.transcript);
    if (cut <= 0) return null;

    const summary = await summarize(
      this,
      state.transcript.slice(0, cut),
      state.fileOps,
      state.previousSummary,
    );
    state.previousSummary = summary;

    const retained = force ? [] : state.transcript.slice(cut);
    state.transcript = [{ role: 'user', content: `<context-summary>\n${summary}\n</context-summary>` }, ...retained];

    const tokensAfter = state.transcript.reduce((n, p) => n + estimateTokens(p.content), 0);

    yield force
      ? { type: 'summarization', tokensBefore, tokensAfter, contextWindow: this.contextWindow, summary }
      : { type: 'compaction', tokensBefore, tokensAfter, contextWindow: this.contextWindow, midStream, summary };

    const tail = retained.map((p) => `[${p.role}]: ${p.content}`).join('\n\n');
    return `<context-summary>\n${summary}\n</context-summary>${tail ? `\n\n${tail}` : ''}`;
  }

  private async *ensureRoom(
    state: { transcript: ConversationPart[]; fileOps: FileOps; previousSummary?: string },
    midStream: boolean,
    tools: ToolSpec[],
    budget: RunOptions['contextBudget'],
  ): AsyncGenerator<ProviderEvent, string | null> {
    const used = () => state.transcript.reduce((n, p) => n + estimateTokens(p.content), 0);
    const needsCompaction = budget
      ? budget.shouldCompact(used(), estimateTokens(JSON.stringify(tools)))
      : isOverThreshold(used(), this.contextWindow);
    if (!needsCompaction) return null;

    let restart = yield* this.compact(state, midStream, false);

    if (!this.requestFits(state.transcript, tools, budget)) {
      restart = (yield* this.compact(state, midStream, true)) ?? restart;
    }
    return restart;
  }

  async *run(options: RunOptions): AsyncIterable<ProviderEvent> {
    const { systemPrompt, tools, opening, clientErrors, maxTurns, isCancelled, executeTool, contextBudget } = options;

    const openingText = clientErrors ? `${opening}\n\n${clientErrors}` : opening;

    let nextInput: any[] = [
      { type: 'user_input', content: [{ text: openingText, type: 'text' }] },
    ];
    let previousInteractionId: string | undefined;
    let turns = 0;

        const state = {
      transcript: [{ role: 'user', content: openingText }] as ConversationPart[],
      fileOps: createFileOps(),
      previousSummary: undefined as string | undefined,
    };

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

      const restart = yield* this.ensureRoom(state, false, tools, contextBudget);
      if (!this.requestFits(state.transcript, tools, contextBudget)) {
        yield { type: 'error', message: 'context budget cannot fit mandatory provider request after compaction' };
        yield { type: 'finished', reason: 'context_budget_exceeded' };
        return;
      }
      if (restart) {
        
        previousInteractionId = undefined;
        nextInput = [{ type: 'user_input', content: [{ text: restart, type: 'text' }] }];
      }

      const stream = await this.client().interactions.create({
        model: this.model,
        input: nextInput,
        previous_interaction_id: previousInteractionId,
        stream: true,
        tools: toGeminiTools(tools),
        system_instruction: systemPrompt,
      });

      const toolResults: any[] = [];
      const pending = new Map<number, { name: string; id: string; args: string }>();
      let finished = false;
      let assistantText = '';
      let overflowedMidStream = false;

      for await (const event of stream) {
        if (event.event_type === 'step.start' && event.step.type === 'function_call') {
          pending.set(event.index, { name: event.step.name, id: event.step.id, args: '' });
        }

        if (event.event_type === 'step.delta' && event.delta.type === 'arguments_delta') {
          const call = pending.get(event.index);
          if (!call || !event.delta.arguments) continue;
          call.args += event.delta.arguments;
        }

        if (event.event_type === 'step.stop') {
          const call = pending.get(event.index);
          if (!call) continue;
          pending.delete(event.index);

          let args: Record<string, unknown>;
          try {
            args = call.args ? JSON.parse(call.args) : {};
          } catch (error) {

            toolResults.push({
              type: 'function_result',
              call_id: call.id,
              is_error: true,
              name: call.name,
              result: `ERROR: could not parse arguments as JSON: ${error}`,
            });
            continue;
          }

          if (typeof args.comand === 'string') trackFileOps(state.fileOps, args.comand);
          state.transcript.push({ role: 'assistant', content: `[tool_call ${call.name}] ${JSON.stringify(args)}` });

          yield { type: 'tool_call', id: call.id, name: call.name, args };

          const result = isCancelled()
            ? 'ERROR: cancelled — this session no longer owns the project'
            : await executeTool(call.name, args, call.id);
          const isError = looksLikeError(result);

          yield { type: 'tool_result', id: call.id, name: call.name, result, isError };
          state.transcript.push({ role: 'tool', content: `${call.name}: ${result}` });

          toolResults.push({
            type: 'function_result',
            call_id: call.id,
            is_error: isError,
            name: call.name,
            result,
          });
        }

        if (event.event_type === 'step.delta' && event.delta.type === 'text') {
          assistantText += event.delta.text;
          yield { type: 'text_delta', text: event.delta.text };

          const running =
            state.transcript.reduce((n, p) => n + estimateTokens(p.content), 0) + estimateTokens(assistantText);
          if (contextBudget
            ? contextBudget.shouldCompact(running, estimateTokens(JSON.stringify(tools)))
            : isOverThreshold(running, this.contextWindow)) {
            overflowedMidStream = true;
            break;
          }
        }

        if (event.event_type === 'interaction.completed') {
          previousInteractionId = event.interaction.id;

          if (event.interaction.status === 'requires_action') {
            yield { type: 'thinking' };
            break;
          }
          finished = true;
          yield { type: 'finished', reason: event.interaction.status };
          break;
        }
      }

      if (assistantText) state.transcript.push({ role: 'assistant', content: assistantText });

      if (overflowedMidStream) {
        const resumeFrom = yield* this.ensureRoom(state, true, tools, contextBudget);
        previousInteractionId = undefined;
        nextInput = [
          {
            type: 'user_input',
            content: [
              {
                text: `${resumeFrom ?? ''}\n\nContinue exactly where you left off. Do not repeat what you already said or redo work already completed.`,
                type: 'text',
              },
            ],
          },
        ];
        continue;
      }

      if (finished) return;
      if (toolResults.length === 0) {
        yield { type: 'finished', reason: 'no_tool_results' };
        return;
      }

      nextInput = toolResults;
    }
  }
}
