import { duplicateClient, redis } from './index';
import { answerChannel, questionOwnerKey } from './keys';

let subscriber: Awaited<ReturnType<typeof duplicateClient>> | null = null;

async function getSubscriber() {
  if (!subscriber) subscriber = await duplicateClient();
  return subscriber;
}

export async function waitForAnswer(questionId: string, timeoutMs: number): Promise<string> {
  const channel = answerChannel(questionId);
  const client = await getSubscriber();

  return await new Promise<string>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await client.unsubscribe(channel).catch(() => {});
      reject(new Error('timeOut error'));
    }, timeoutMs);

    client
      .subscribe(channel, async (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await client.unsubscribe(channel).catch(() => {});
        resolve(message);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function publishAnswer(questionId: string, answer: string): Promise<number> {
  return await redis.publish(answerChannel(questionId), answer);
}

export async function rememberQuestionProject(questionId: string, projectId: string, ttlMs: number) {
  await redis.set(questionOwnerKey(questionId), projectId, { PX: ttlMs });
}

export async function projectForQuestion(questionId: string): Promise<string | null> {
  return await redis.get(questionOwnerKey(questionId));
}
