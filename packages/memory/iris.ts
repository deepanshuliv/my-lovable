import type { LongTermMemory, MemoryMessage, MemoryStore } from './types';

type IrisMessage = { role: string; content: string; created_at?: string };

type WorkingMemoryResponse = {
  messages?: IrisMessage[];
};

type SearchResponse = {
  memories?: Array<{ text?: string; dist?: number; score?: number; topics?: string[] }>;
};

export class IrisMemory implements MemoryStore {
  readonly kind = 'iris' as const;

  private baseUrl: string;
  private apiKey: string;
  private namespace: string;

  constructor(baseUrl: string, apiKey: string, namespace: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.namespace = namespace;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`iris ${init.method ?? 'GET'} ${path} -> ${response.status} ${body}`);
    }

    if (response.status === 204) return {} as T;
    return (await response.json()) as T;
  }

  private async readWorkingMemory(projectId: string): Promise<IrisMessage[]> {
    try {
      const data = await this.request<WorkingMemoryResponse>(
        `/v1/working-memory/${encodeURIComponent(projectId)}?namespace=${encodeURIComponent(this.namespace)}`,
        { method: 'GET' },
      );
      return data.messages ?? [];
    } catch (error) {
      // A session that does not exist yet reads as empty, not as a failure.
      console.log('[IRIS_READ] , ', error);
      return [];
    }
  }

  /**
   * The working-memory endpoint replaces the whole session, so appending is
   * read-modify-write. Turns are appended one batch per agent turn, not per token, which
   * keeps that round trip off the hot path.
   */
  async appendMessages(projectId: string, messages: MemoryMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const existing = await this.readWorkingMemory(projectId);
    const merged = [
      ...existing,
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
        created_at: m.createdAt ?? new Date().toISOString(),
      })),
    ];

    await this.request(`/v1/working-memory/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        session_id: projectId,
        namespace: this.namespace,
        messages: merged,
      }),
    });
  }

  async getSessionHistory(projectId: string, limit: number): Promise<MemoryMessage[]> {
    const messages = await this.readWorkingMemory(projectId);
    return messages.slice(-limit).map((m) => ({
      role: (m.role as MemoryMessage['role']) ?? 'user',
      content: m.content,
      createdAt: m.created_at,
    }));
  }

  async searchLongTerm(projectId: string, query: string, limit: number): Promise<LongTermMemory[]> {
    try {
      const data = await this.request<SearchResponse>('/v1/long-term-memory/search', {
        method: 'POST',
        body: JSON.stringify({
          text: query,
          limit,
          namespace: { eq: this.namespace },
          session_id: { eq: projectId },
        }),
      });

      return (data.memories ?? []).map((m) => ({
        text: m.text ?? '',
        score: m.score ?? (typeof m.dist === 'number' ? 1 - m.dist : undefined),
        topics: m.topics,
      }));
    } catch (error) {
      // Recall is an enhancement. Losing it must not lose the turn.
      console.log('[IRIS_SEARCH] , ', error);
      return [];
    }
  }

  async rememberFact(projectId: string, text: string, topics: string[] = []): Promise<void> {
    await this.request('/v1/long-term-memory/', {
      method: 'POST',
      body: JSON.stringify({
        memories: [
          {
            text,
            session_id: projectId,
            namespace: this.namespace,
            memory_type: 'semantic',
            topics,
          },
        ],
      }),
    });
  }

  async clearSession(projectId: string): Promise<void> {
    await this.request(`/v1/working-memory/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  }
}
