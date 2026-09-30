import { recentEventsKey, redis, sessionKey } from '@repo/redis';
import type { LongTermMemory, MemoryMessage, MemoryStore, RecentEvent } from './types';

const MAX_HISTORY = 500;

function parseEvents(raw: string[]): RecentEvent[] {
  const out: RecentEvent[] = [];
  for (const entry of raw) {
    try {
      out.push(JSON.parse(entry) as RecentEvent);
    } catch {}
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export class RedisFallbackMemory implements MemoryStore {
  readonly kind = 'redis-fallback' as const;

  private ttlSeconds: number;
  private maxEvents: number;

  constructor(ttlSeconds: number, maxEvents: number) {
    this.ttlSeconds = ttlSeconds;
    this.maxEvents = maxEvents;
  }

  async appendMessages(projectId: string, messages: MemoryMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const key = sessionKey(projectId);
    const encoded = messages.map((m) =>
      JSON.stringify({ ...m, createdAt: m.createdAt ?? new Date().toISOString() }),
    );

    await redis.rPush(key, encoded);

    await redis.lTrim(key, -MAX_HISTORY, -1);
    await redis.expire(key, this.ttlSeconds);
  }

  async getSessionHistory(projectId: string, limit: number): Promise<MemoryMessage[]> {
    const raw = await redis.lRange(sessionKey(projectId), -limit, -1);
    const out: MemoryMessage[] = [];
    for (const entry of raw) {
      try {
        out.push(JSON.parse(entry) as MemoryMessage);
      } catch {
      }
    }
    return out;
  }

    async searchLongTerm(): Promise<LongTermMemory[]> {
    return [];
  }

    async rememberFact(projectId: string, text: string): Promise<void> {
    console.log('[MEMORY_FALLBACK] long-term memory unavailable, dropping fact for', projectId, text.slice(0, 80));
  }

  async clearSession(projectId: string): Promise<void> {
    await redis.del([sessionKey(projectId), recentEventsKey(projectId)]);
  }

  async appendEvents(projectId: string, events: RecentEvent[]): Promise<void> {
    if (events.length === 0) return;

    const key = recentEventsKey(projectId);
    await redis.rPush(key, events.map((event) => JSON.stringify(event)));
    await redis.lTrim(key, -this.maxEvents, -1);
    await redis.expire(key, this.ttlSeconds);
  }

  async recentEvents(projectId: string, limit: number): Promise<RecentEvent[]> {
    return parseEvents(await redis.lRange(recentEventsKey(projectId), -limit, -1));
  }
}
