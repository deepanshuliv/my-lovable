import { prisma } from '@repo/db';
import type { RecentEvent } from '@repo/memory';
import { eventFromPersistedRow, type EventReader, type EventStore, type ExecutionEvent } from './eventStore';

export type RetrievalFilters = {
  sessionId: string;
  taskId?: string;
  runId?: string;
  eventTypes?: string[];
  fromSeq?: number;
  toSeq?: number;
  file?: string;
  limit?: number;
  maxTokens?: number;
};

export type RetrievalResult = {
  eventId: string;
  seq: number;
  type: string;
  excerpt: string;
  score: number;
  provenance: { sessionId?: string; taskId?: string; runId?: string; createdAt: string };
};

function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9_./-]+/).filter((term) => term.length >= 2))];
}

function eventText(event: ExecutionEvent): string {
  return `${event.type} ${JSON.stringify(event.payload)}`;
}

function excerpt(text: string): string {
  return text.length > 1_600 ? `${text.slice(0, 800)}\n… [event excerpt truncated] …\n${text.slice(-800)}` : text;
}

export class HistoryRetriever {
  constructor(private readonly source: EventReader | EventStore) {}

  async search(query: string, filters: RetrievalFilters): Promise<RetrievalResult[]> {
    const wanted = terms(query);
    if (wanted.length === 0) return [];
    const all = await this.source.all(filters.sessionId);
    const filtered = all.filter((event) => {
      if (filters.taskId && event.correlation.taskId && event.correlation.taskId !== filters.taskId) return false;
      if (filters.runId && event.correlation.runId && event.correlation.runId !== filters.runId) return false;
      if (filters.eventTypes && !filters.eventTypes.includes(event.type)) return false;
      if (filters.fromSeq !== undefined && event.seq < filters.fromSeq) return false;
      if (filters.toSeq !== undefined && event.seq > filters.toSeq) return false;
      if (filters.file && !eventText(event).toLowerCase().includes(filters.file.toLowerCase())) return false;
      return true;
    });

    const seen = new Set<string>();
    const maxResults = Math.max(1, Math.min(filters.limit ?? 8, 25));
    const maxTokens = Math.max(100, Math.min(filters.maxTokens ?? 2_000, 8_000));
    let usedTokens = 0;
    return filtered
      .map((event) => {
        const text = eventText(event);
        const lower = text.toLowerCase();
        const matchCount = wanted.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
        const exactBoost = lower.includes(query.toLowerCase()) ? 4 : 0;
        const typeBoost = ['verification_failed', 'tool_failed', 'file_modified'].includes(event.type) ? 1 : 0;
        return { event, score: matchCount * 2 + exactBoost + typeBoost };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.event.seq - a.event.seq)
      .flatMap(({ event, score }) => {
        const text = eventText(event);
        const key = text.replace(/\s+/g, ' ').slice(0, 500).toLowerCase();
        if (seen.has(key)) return [];
        const itemTokens = Math.ceil(text.length / 4);
        if (usedTokens + itemTokens > maxTokens) return [];
        usedTokens += itemTokens;
        seen.add(key);
        return [{
          eventId: event.id,
          seq: event.seq,
          type: event.type,
          excerpt: excerpt(text),
          score,
          provenance: { ...event.correlation, createdAt: event.createdAt },
        }];
      })
      .slice(0, maxResults);
  }
}

export type RecentEventSource = (sessionId: string) => Promise<RecentEvent[]>;

function fromRecent(event: RecentEvent): ExecutionEvent | null {
  return eventFromPersistedRow({
    id: event.streamId ?? `recent-${event.seq}`,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    createdAt: new Date(event.createdAt),
  });
}

function toEvents(rows: Parameters<typeof eventFromPersistedRow>[0][]): ExecutionEvent[] {
  return rows.flatMap((row) => {
    const event = eventFromPersistedRow(row);
    return event ? [event] : [];
  });
}

export class PrismaEventReader implements EventReader {
  constructor(private readonly recentSource?: RecentEventSource) {}

  private async withRecent(
    sessionId: string,
    persisted: () => Promise<ExecutionEvent[]>,
  ): Promise<ExecutionEvent[]> {
    const recent = this.recentSource ? await this.recentSource(sessionId).catch(() => []) : [];
    let durable: ExecutionEvent[];
    try {
      durable = await persisted();
    } catch (error) {
      if (recent.length === 0) throw error;
      console.log('[EVENTS_POSTGRES_UNAVAILABLE] serving recent events from memory , ', String(error).slice(0, 160));
      return recent.flatMap((event) => fromRecent(event) ?? []);
    }
    const highest = durable.reduce((max, event) => Math.max(max, event.seq), 0);
    const tail = recent.filter((event) => event.seq > highest).flatMap((event) => fromRecent(event) ?? []);
    return [...durable, ...tail];
  }

  async all(sessionId: string): Promise<ExecutionEvent[]> {
    return await this.withRecent(sessionId, async () =>
      toEvents(await prisma.event.findMany({
        where: { projectId: sessionId },
        orderBy: { seq: 'asc' },
        take: 2_000,
      })),
    );
  }

  async recent(sessionId: string, limit: number): Promise<ExecutionEvent[]> {
    const bounded = Math.max(1, Math.min(limit, 200));
    const events = await this.withRecent(sessionId, async () =>
      toEvents(await prisma.event.findMany({
        where: { projectId: sessionId },
        orderBy: { seq: 'desc' },
        take: bounded,
      })).reverse(),
    );
    return events.slice(-bounded);
  }
}
