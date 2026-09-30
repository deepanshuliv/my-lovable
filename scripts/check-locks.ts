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
} from '../packages/redis';

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

  const first = await acquireProjectLock(PROJECT, A);
  check('A acquires a free lock', first.ok && first.how === 'acquired');

  await touchLiveness(PROJECT);

  const contested = await acquireProjectLock(PROJECT, B);
  check('B is refused while A is live', !contested.ok && contested.ownerId === A);

  const again = await acquireProjectLock(PROJECT, A);
  check('A re-acquiring its own lock renews it', again.ok && again.how === 'renewed');

  const foreignRelease = await releaseProjectLock(PROJECT, B);
  check('B cannot release a lock it does not own', foreignRelease === false);
  check('the lock survives the foreign release', (await redis.get(lockKey(PROJECT))) === A);

  const foreignRenew = await renewProjectLock(PROJECT, B);
  check('B cannot renew a lock it does not own', foreignRenew === false);

  await clearLiveness(PROJECT);
  const stolen = await acquireProjectLock(PROJECT, B, true);
  check('B takes over once A is provably gone', stolen.ok && stolen.how === 'stolen');
  check('the lock now names B', (await redis.get(lockKey(PROJECT))) === B);

  await redis.set(lockKey(PROJECT), A);
  const strict = await acquireProjectLock(PROJECT, B, false);
  check('strict ownership refuses the takeover', !strict.ok && strict.ownerId === A);

  await redis.del([lockKey(PROJECT), liveKey(PROJECT)]);
  await redis.quit();

  console.log(failures === 0 ? '\nall lock checks passed' : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
