import { randomUUIDv7 } from 'bun';
import type { EventType } from '@repo/shared/events';
import type { Emitter } from '../utils/events';

export type EventCorrelation = {
  taskId?: string;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  parentAgentId?: string;
  parentEventId?: string;
};

export type ExecutionEvent = {
  id: string;
  seq: number;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
  correlation: EventCorrelation;
};

export type EventAppend = {
  type: EventType;
  payload?: Record<string, unknown>;
  correlation?: EventCorrelation;
};

export interface EventReader {
  recent(sessionId: string, limit: number): Promise<ExecutionEvent[]>;
  all(sessionId: string): Promise<ExecutionEvent[]>;
}

export type EventSink = (event: ExecutionEvent) => Promise<number>;

function withCorrelation(
  payload: Record<string, unknown>,
  correlation: EventCorrelation,
): Record<string, unknown> {
  return Object.keys(correlation).length > 0
    ? { ...payload, _execution: { ...correlation } }
    : { ...payload };
}

function correlationFromPayload(payload: Record<string, unknown>): EventCorrelation {
  const metadata = payload._execution;
  if (!metadata || typeof metadata !== 'object') return {};
  const value = metadata as Record<string, unknown>;
  const fields: EventCorrelation = {};
  for (const key of ['taskId', 'sessionId', 'runId', 'agentId', 'parentAgentId', 'parentEventId'] as const) {
    if (typeof value[key] === 'string') fields[key] = value[key];
  }
  return fields;
}

/**
 * Structured execution-event boundary. Production writes still go through the existing
 * Redis stream/worker path; tests can inject an in-memory sink without changing callers.
 */
export class EventStore {
  constructor(
    private readonly sink: EventSink,
    private readonly reader?: EventReader,
  ) {}

  async append(input: EventAppend): Promise<ExecutionEvent> {
    const correlation = input.correlation ?? {};
    const event: ExecutionEvent = {
      id: randomUUIDv7(),
      seq: 0,
      type: input.type,
      payload: withCorrelation(input.payload ?? {}, correlation),
      createdAt: new Date().toISOString(),
      correlation,
    };
    event.seq = await this.sink(event);
    return event;
  }

  async recent(sessionId: string, limit: number): Promise<ExecutionEvent[]> {
    if (!this.reader) return [];
    return await this.reader.recent(sessionId, Math.max(0, Math.min(limit, 200)));
  }

  async all(sessionId: string): Promise<ExecutionEvent[]> {
    if (!this.reader) return [];
    return await this.reader.all(sessionId);
  }
}

export class InMemoryEventStore extends EventStore implements EventReader {
  private readonly events: ExecutionEvent[] = [];
  private nextSequence = 1;

  constructor() {
    super(async (event) => {
      event.seq = this.nextSequence++;
      this.events.push(structuredClone(event));
      return event.seq;
    });
    // EventStore delegates reads through this instance's methods in the override below.
  }

  override async recent(sessionId: string, limit: number): Promise<ExecutionEvent[]> {
    return this.events
      .filter((event) => event.correlation.sessionId === sessionId || event.correlation.taskId === sessionId)
      .slice(-limit)
      .map((event) => structuredClone(event));
  }

  override async all(sessionId: string): Promise<ExecutionEvent[]> {
    return this.events
      .filter((event) => event.correlation.sessionId === sessionId || event.correlation.taskId === sessionId)
      .map((event) => structuredClone(event));
  }

  count(): number {
    return this.events.length;
  }

  eventsFor(sessionId: string): ExecutionEvent[] {
    return this.events
      .filter((event) => event.correlation.sessionId === sessionId || event.correlation.taskId === sessionId)
      .map((event) => structuredClone(event));
  }
}

/** Adapter used by the current SSE emitter and Redis-stream event pipeline. */
export function createEmitterEventStore(
  emitter: Emitter,
  reader?: EventReader,
): EventStore {
  return new EventStore(
    async (event) => await emitter.emit(event.type, event.payload),
    reader,
  );
}

export function eventFromPersistedRow(row: {
  id: string;
  seq: number;
  type: string;
  payload: unknown;
  createdAt: Date;
}): ExecutionEvent | null {
  const payload = row.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  const correlation = correlationFromPayload(data);
  return {
    id: row.id,
    seq: row.seq,
    type: row.type as EventType,
    payload: data,
    createdAt: row.createdAt.toISOString(),
    correlation,
  };
}
