import { redis } from './index';
import { seqKey } from './keys';
import { EVENTS_GROUP, EVENTS_STREAM, makeEvent, type EventType, type ProjectEvent } from '@repo/shared/events';

export async function nextSeq(projectId: string): Promise<number> {
  return await redis.incr(seqKey(projectId));
}

export async function ensureSeqAtLeast(projectId: string, seq: number) {
  const current = await redis.get(seqKey(projectId));
  if (!current || Number.parseInt(current, 10) < seq) {
    await redis.set(seqKey(projectId), String(seq));
  }
}

export async function writeEvent(event: ProjectEvent): Promise<string> {
  return await redis.xAdd(EVENTS_STREAM, '*', {
    projectId: event.projectId,
    seq: String(event.seq),
    type: event.type,
    payload: JSON.stringify(event.payload),
    createdAt: event.createdAt,
  });
}

export async function emitEvent(
  projectId: string,
  type: EventType,
  payload: Record<string, unknown>,
): Promise<ProjectEvent> {
  const seq = await nextSeq(projectId);
  const event = makeEvent(projectId, seq, type, payload);
  await writeEvent(event);
  return event;
}

export async function ensureConsumerGroup() {
  try {
    await redis.xGroupCreate(EVENTS_STREAM, EVENTS_GROUP, '0', { MKSTREAM: true });
  } catch (error) {
    const message = String(error);
    if (!message.includes('BUSYGROUP')) throw error;
  }
}

export { EVENTS_STREAM, EVENTS_GROUP };
