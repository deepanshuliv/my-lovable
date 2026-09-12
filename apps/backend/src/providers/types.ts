
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

export interface ModelProvider {
  readonly name: 'gemini' | 'openrouter';
  readonly model: string;
    readonly contextWindow: number;
  run(options: RunOptions): AsyncIterable<ProviderEvent>;
    complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
}

export function looksLikeError(result: string): boolean {
  return result.includes('ERROR');
}
