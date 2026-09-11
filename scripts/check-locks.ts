/**
 * Exercise the ownership primitives against a real Redis.
 *
 * There is no test runner in this repo, and the lock scripts are the one place where a
 * silent bug is both easy to write and expensive to find in production — a foreign
 * release looks like nothing at all until two agents are writing into one sandbox. So
 * this is a script you can run:
 *
 *   docker compose up -d redis
 *   REDIS_URL=redis://localhost:6379 bun scripts/check-locks.ts
 */

import {
  acquireProjectLock,
  clearLiveness,
  connectToRedis,
  redis,
  releaseProjectLock,
  renewProjectLock,
  touchLiveness,
  lockKey,
  liveKey,
} from '@repo/redis';

const PROJECT = `check-${Date.now()}`;
const A = 'backend-A';
const B = 'backend-B';

let failures = 0;

function check(label: string, condition: boolean) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

async function main() {
  await connectToRedis();
  await redis.del([lockKey(PROJECT), liveKey(PROJECT)]);

  // A takes the lock; B is told who has it.
  const first = await acquireProjectLock(PROJECT, A);
  check('A acquires a free lock', first.ok && first.how === 'acquired');

  await touchLiveness(PROJECT);

  const contested = await acquireProjectLock(PROJECT, B);
  check('B is refused while A is live', !contested.ok && contested.ownerId === A);

  // Re-acquiring your own lock is a renew, not a conflict.
  const again = await acquireProjectLock(PROJECT, A);
  check('A re-acquiring its own lock renews it', again.ok && again.how === 'renewed');

  // The bug the design calls out: B must not be able to delete A's lock.
  const foreignRelease = await releaseProjectLock(PROJECT, B);
  check('B cannot release a lock it does not own', foreignRelease === false);
  check('the lock survives the foreign release', (await redis.get(lockKey(PROJECT))) === A);

  const foreignRenew = await renewProjectLock(PROJECT, B);
  check('B cannot renew a lock it does not own', foreignRenew === false);

  // Takeover: only once A's liveness is gone.
  await clearLiveness(PROJECT);
  const stolen = await acquireProjectLock(PROJECT, B, true);
  check('B takes over once A is provably gone', stolen.ok && stolen.how === 'stolen');
  check('the lock now names B', (await redis.get(lockKey(PROJECT))) === B);

  // Strict mode refuses the same takeover.
  await redis.set(lockKey(PROJECT), A);
  const strict = await acquireProjectLock(PROJECT, B, false);
  check('strict ownership refuses the takeover', !strict.ok && strict.ownerId === A);

  await redis.del([lockKey(PROJECT), liveKey(PROJECT)]);
  await redis.quit();

  console.log(failures === 0 ? '\nall lock checks passed' : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
