import { redis } from '@repo/redis';
let producer: any = {};
export async function connectToRedis() {
  if (producer.isOpen) return producer;
  producer = redis.duplicate();
  producer.on('error', (err: any) => {
    console.log('[REDIS_ERROR] , ', err);
  });
  await producer.connect();
  return producer;
}

export async function writeToStream(data: any) {
  const client = producer;
  if (!client) throw new Error('redis not connect');
  await client.xAdd("hello" as string, '*', { data: JSON.stringify(data) });
}
