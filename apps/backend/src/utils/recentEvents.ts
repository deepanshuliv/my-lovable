import { createMemoryStore, RECENT_EVENTS_LIMIT, type RecentEvent } from '@repo/memory';
import { envInt } from '@repo/shared';

const FLUSH_MS = envInt('RECENT_EVENTS_FLUSH_MS', 50);

const pending = new Map<string, RecentEvent[]>();
const flushing = new Map<string, Promise<void>>();

function schedule(projectId: string) {
  if (flushing.has(projectId)) return;

  const run = (async () => {
    await Bun.sleep(FLUSH_MS);
    while ((pending.get(projectId)?.length ?? 0) > 0) {
      const batch = pending.get(projectId)!;
      pending.set(projectId, []);
      try {
        await createMemoryStore().appendEvents(projectId, batch);
      } catch (error) {
        console.log('[RECENT_EVENTS_WRITE_FAILED] , ', String(error).slice(0, 200));
      }
    }
  })().finally(() => {
    flushing.delete(projectId);
    if ((pending.get(projectId)?.length ?? 0) > 0) schedule(projectId);
    else pending.delete(projectId);
  });

  flushing.set(projectId, run);
}

export function rememberEvent(projectId: string, event: RecentEvent) {
  const list = pending.get(projectId) ?? [];
  list.push(event);
  pending.set(projectId, list);
  schedule(projectId);
}

export async function flushRecentEvents(projectId: string) {
  while (flushing.has(projectId)) await flushing.get(projectId);
}

export async function loadRecentEvents(projectId: string, limit = RECENT_EVENTS_LIMIT): Promise<RecentEvent[]> {
  try {
    return await createMemoryStore().recentEvents(projectId, limit);
  } catch (error) {
    console.log('[RECENT_EVENTS_READ_FAILED] , ', String(error).slice(0, 200));
    return [];
  }
}

export function unpersistedTail<T extends { seq: number }>(persisted: T[], recent: RecentEvent[]): RecentEvent[] {
  const highest = persisted.reduce((max, event) => Math.max(max, event.seq), 0);
  return recent.filter((event) => event.seq > highest);
}
