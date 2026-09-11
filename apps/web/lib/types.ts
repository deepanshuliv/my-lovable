export type StreamEvent = {
  type:
    | 'user_query'
    | 'text'
    | 'tool_call'
    | 'tool_result'
    | 'question'
    | 'answer'
    | 'running'
    | 'done'
    | 'error'
    | 'preview_ready'
    | 'preview_reload'
    | 'snapshot'
    | 'compaction'
    | 'summarization'
    | 'secrets_required'
    | 'verification'
    | 'client_errors';
  [key: string]: unknown;
};

export type AgentMode = 'plan' | 'build';

export type RequiredSecret = { key: string; reason: string };

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; args: string; result?: string; isError?: boolean }
  | { kind: 'question'; id: string; questionId: string; question: string; options: string[]; answer?: string }
  | { kind: 'status'; id: string; stage: string }
  | { kind: 'error'; id: string; message: string }
  | {
      kind: 'compaction';
      id: string;
            full: boolean;
      midStream: boolean;
      tokensBefore: number;
      tokensAfter: number;
      contextWindow: number;
      summary: string;
    }
    | { kind: 'secrets'; id: string; secrets: RequiredSecret[]; provided: string[] }
    | {
      kind: 'verification';
      id: string;
      ok: boolean;
            typecheckPassed: boolean | null;
      typecheckOutput: string;
      runtimeErrors: string[];
    }
    | {
      kind: 'clientErrors';
      id: string;
      errors: { level: 'error' | 'warn'; message: string; source: string }[];
    };

export type SecretSummary = {
  key: string;
  maskedPreview: string;
  updatedAt: string;
};
