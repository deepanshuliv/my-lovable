
export type EventType =
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

export type ProjectEvent = {
  projectId: string;
    seq: number;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const EVENTS_STREAM = 'events:stream';
export const EVENTS_GROUP = 'cg:persist';

export function makeEvent(
  projectId: string,
  seq: number,
  type: EventType,
  payload: Record<string, unknown>,
): ProjectEvent {
  return { projectId, seq, type, payload, createdAt: new Date().toISOString() };
}
