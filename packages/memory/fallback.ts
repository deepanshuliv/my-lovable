import { redis, sessionKey } from '@repo/redis';
import type { LongTermMemory, MemoryMessage, MemoryStore } from './types';

const MAX_HISTORY = 500;

export class RedisFallbackMemory implements MemoryStore {
  readonly kind = 'redis-fallback' as const;

  private ttlSeconds: number;

  constructor(ttlSeconds: number) {
    this.ttlSeconds = ttlSeconds;
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
    await redis.del(sessionKey(projectId));
  }
}
