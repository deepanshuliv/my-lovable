
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
  | 'client_errors'
  | 'task_created'
  | 'task_state_updated'
  | 'llm_request'
  | 'llm_response'
  | 'agent_started'
  | 'agent_finished'
  | 'agent_failed'
  | 'subagent_spawned'
  | 'subagent_finished'
  | 'subagent_failed'
  | 'tool_requested'
  | 'tool_started'
  | 'tool_finished'
  | 'tool_failed'
  | 'file_modified'
  | 'file_created'
  | 'file_deleted'
  | 'verification_started'
  | 'verification_passed'
  | 'verification_failed'
  | 'compaction_started'
  | 'compaction_completed'
  | 'compaction_failed'
  | 'history_retrieved'
  | 'checkpoint_created'
  | 'checkpoint_restored';

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
