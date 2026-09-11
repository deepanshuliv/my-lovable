import { createClient, type RedisClientType } from 'redis';

const url = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis: RedisClientType = createClient({ url });

redis.on('error', (err) => {
  console.log('[REDIS_ERROR] , ', err);
});

let connecting: Promise<unknown> | null = null;

export async function connectToRedis() {
  if (redis.isOpen) return redis;
  if (!connecting) connecting = redis.connect();
  await connecting;
  return redis;
}

export async function duplicateClient(): Promise<RedisClientType> {
  const client = redis.duplicate() as RedisClientType;
  client.on('error', (err) => {
    console.log('[REDIS_ERROR] , ', err);
  });
  await client.connect();
  return client;
}

export * from './keys';
export * from './locks';
export * from './stream';
export * from './pubsub';
