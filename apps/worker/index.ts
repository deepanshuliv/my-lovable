import { randomUUIDv7 } from 'bun';
import { prisma } from '@repo/db';
import { connectToRedis, duplicateClient, ensureConsumerGroup, EVENTS_GROUP, EVENTS_STREAM } from '@repo/redis';
import { envInt } from '@repo/shared';

const BATCH_SIZE = envInt('WORKER_BATCH_SIZE', 100);
const BLOCK_MS = envInt('WORKER_BLOCK_MS', 5000);
const CLAIM_IDLE_MS = envInt('WORKER_CLAIM_IDLE_MS', 60_000);

const CONSUMER = process.env.WORKER_ID || `worker-${randomUUIDv7()}`;

type StreamEntry = {
  id: string;
  message: Record<string, string | Buffer>;
};

type ParsedEvent = {
  streamId: string;
  projectId: string;
  seq: number;
  type: string;
  payload: unknown;
  createdAt: Date;
};

function parseEntry(entry: StreamEntry): ParsedEvent | null {
  const message = entry.message as Record<string, string>;
  const projectId = message.projectId;
  const type = message.type;

  if (!projectId || !type) {
    console.log('[WORKER_SKIP] malformed entry', entry.id);
    return null;
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(message.payload ?? '{}');
  } catch {
    payload = { raw: message.payload ?? '' };
  }

  const createdAt = message.createdAt ? new Date(message.createdAt) : new Date();

  return {
    streamId: entry.id,
    projectId,
    seq: Number.parseInt(message.seq ?? '0', 10) || 0,
    type,
    payload,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
  };
}

async function persistBatch(events: ParsedEvent[]): Promise<string[]> {
  if (events.length === 0) return [];

  const projectIds = [...new Set(events.map((e) => e.projectId))];
  const known = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true },
  });
  const knownIds = new Set(known.map((p) => p.id));

  const writable = events.filter((e) => knownIds.has(e.projectId));
  const orphaned = events.filter((e) => !knownIds.has(e.projectId));

  if (orphaned.length > 0) {
    console.log(`[WORKER_ORPHANED] dropping ${orphaned.length} events for unknown projects`);
  }

  if (writable.length > 0) {
    await prisma.event.createMany({
      data: writable.map((e) => ({
        projectId: e.projectId,
        seq: e.seq,
        type: e.type,
        payload: e.payload as never,
        streamId: e.streamId,
        createdAt: e.createdAt,
      })),
      skipDuplicates: true,
    });
  }

  return events.map((e) => e.streamId);
}

async function handleEntries(entries: StreamEntry[]): Promise<string[]> {
  const parsed: ParsedEvent[] = [];
  const unparseable: string[] = [];

  for (const entry of entries) {
    const event = parseEntry(entry);
    if (event) parsed.push(event);
    else unparseable.push(entry.id);
  }

  if (unparseable.length > 0) {
    console.log(`[WORKER_UNPARSEABLE] acking ${unparseable.length} malformed entries`);
  }

  const persisted = await persistBatch(parsed);
  return [...persisted, ...unparseable];
}

async function readBatch(client: Awaited<ReturnType<typeof duplicateClient>>, id: string) {
  return (await client.xReadGroup(
    EVENTS_GROUP,
    CONSUMER,
    { key: EVENTS_STREAM, id },
    { COUNT: BATCH_SIZE, BLOCK: id === '>' ? BLOCK_MS : undefined },
  )) as { name: string; messages: StreamEntry[] }[] | null;
}

async function reclaimStale(client: Awaited<ReturnType<typeof duplicateClient>>) {
  try {
    const result = (await client.xAutoClaim(
      EVENTS_STREAM,
      EVENTS_GROUP,
      CONSUMER,
      CLAIM_IDLE_MS,
      '0',
      { COUNT: BATCH_SIZE },
    )) as { nextId: string; messages: (StreamEntry | null)[] };

    const entries = (result.messages ?? []).filter((m): m is StreamEntry => m !== null);
    if (entries.length === 0) return;

    const acked = await handleEntries(entries);
    if (acked.length > 0) await client.xAck(EVENTS_STREAM, EVENTS_GROUP, acked);

    console.log(`[WORKER] reclaimed ${acked.length} stale entries`);
  } catch (error) {
    console.log('[WORKER_CLAIM_ERROR] , ', error);
  }
}

async function main() {
  await connectToRedis();
  await ensureConsumerGroup();

  const client = await duplicateClient();

  console.log(`[BOOT] worker ${CONSUMER} draining ${EVENTS_STREAM} -> postgres`);

  let running = true;
  const shutdown = async () => {
    running = false;
    console.log('[WORKER] shutting down');
    await client.quit().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await reclaimStale(client);

  while (running) {
    try {
      const response = await readBatch(client, '>');
      const entries = response?.[0]?.messages ?? [];

      if (entries.length === 0) {
        
        await reclaimStale(client);
        continue;
      }

      const acked = await handleEntries(entries);

      if (acked.length > 0) {
        await client.xAck(EVENTS_STREAM, EVENTS_GROUP, acked);
        console.log(`[WORKER] persisted ${acked.length} events`);
      }
    } catch (error) {
      console.log('[WORKER_ERROR] , ', error);
      
      await Bun.sleep(1000);
    }
  }
}

await main();
