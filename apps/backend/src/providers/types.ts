export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: string; isError: boolean }
  | { type: 'thinking' }
    | {
      type: 'compaction';
      tokensBefore: number;
      tokensAfter: number;
      contextWindow: number;
      midStream: boolean;
      summary: string;
    }
    | {
      type: 'summarization';
      tokensBefore: number;
      tokensAfter: number;
      contextWindow: number;
      summary: string;
    }
  | { type: 'finished'; reason: string }
  | { type: 'error'; message: string };

export type RunOptions = {
  systemPrompt: string;
  tools: ToolSpec[];
    opening: string;
  maxTurns: number;
    isCancelled: () => boolean;
    executeTool: (name: string, args: Record<string, unknown>, callId: string) => Promise<string>;
    clientErrors?: string;
    contextBudget?: {
      capacity: number;
      responseReserve: number;
      safetyReserve: number;
      shouldCompact: (inputTokens: number, toolDefinitionTokens?: number) => boolean;
    };
};

export type UsageTotals = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reportedCostUsd: number;
  unreportedInputTokens: number;
  unreportedOutputTokens: number;
};

export function createUsage(): UsageTotals {
  return { requests: 0, inputTokens: 0, outputTokens: 0, reportedCostUsd: 0, unreportedInputTokens: 0, unreportedOutputTokens: 0 };
}

export function addUsage(usage: UsageTotals, inputTokens: number, outputTokens: number, costUsd?: number) {
  const input = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const output = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  usage.inputTokens += input;
  usage.outputTokens += output;
  if (typeof costUsd === 'number' && Number.isFinite(costUsd)) {
    usage.reportedCostUsd += Math.max(0, costUsd);
  } else {
    usage.unreportedInputTokens += input;
    usage.unreportedOutputTokens += output;
  }
}

export type ProviderName = 'gemini' | 'openrouter' | 'openai' | 'anthropic' | 'deepseek';

export type ByokProviderName = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'deepseek';

export interface ModelProvider {
  readonly name: ProviderName;
  readonly model: string;
    readonly contextWindow: number;
  readonly usage: UsageTotals;
  run(options: RunOptions): AsyncIterable<ProviderEvent>;
    complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
}

export function looksLikeError(result: string): boolean {
  return result.includes('ERROR');
}
