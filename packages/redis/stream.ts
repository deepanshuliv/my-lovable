import { redis } from './index';
import { seqKey } from './keys';
import { EVENTS_GROUP, EVENTS_STREAM, makeEvent, type EventType, type ProjectEvent } from '@repo/shared/events';

export async function nextSeq(projectId: string): Promise<number> {
  return await redis.incr(seqKey(projectId));
}

const RAISE_SEQ = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current < tonumber(ARGV[1]) then
  redis.call("SET", KEYS[1], ARGV[1])
end
return 1
`;

export async function ensureSeqAtLeast(projectId: string, seq: number) {
  await redis.eval(RAISE_SEQ, { keys: [seqKey(projectId)], arguments: [String(seq)] });
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
): Promise<ProjectEvent & { streamId: string }> {
  const seq = await nextSeq(projectId);
  const event = makeEvent(projectId, seq, type, payload);
  const streamId = await writeEvent(event);
  return { ...event, streamId };
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
