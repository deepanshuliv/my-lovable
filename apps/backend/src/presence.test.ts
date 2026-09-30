import { describe, expect, test } from 'bun:test';
import { lockKey, projectLeftKey, seqKey } from '@repo/redis';
import { createPresence, type PresenceDeps, type PresenceSandbox } from './presence';

const PROJECT = 'p1';

function setup(options: { state?: string; seq?: number; snapshots?: { count: number; lastSeq: number }; sandboxId?: string | null } = {}) {
  const store = new Map<string, string>();
  const timers: (() => void)[] = [];
  const log = { stopped: 0, refreshed: 0, snapshots: [] as number[], detached: 0 };
  let clock = 1_000_000;
  const sandbox: PresenceSandbox & { state: string } = {
    id: 'sb1',
    state: options.state ?? 'started',
    refreshActivity: async () => void log.refreshed++,
    stop: async () => {
      log.stopped++;
      sandbox.state = 'stopped';
    },
  };
  if (options.seq !== undefined) store.set(seqKey(PROJECT), String(options.seq));

  const deps: PresenceDeps = {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => void store.set(key, value),
    del: async (key) => void store.delete(key),
    exists: async (key) => store.has(key),
    sandboxIdFor: async () => (options.sandboxId === undefined ? 'sb1' : options.sandboxId),
    peek: async () => sandbox,
    snapshotState: async () => options.snapshots ?? { count: 1, lastSeq: options.seq ?? 0 },
    saveSnapshot: async (_p, _s, seq) => {
      log.snapshots.push(seq);
      return true;
    },
    detach: () => void log.detached++,
    schedule: (run) => void timers.push(run),
    now: () => clock,
    graceMs: 90_000,
    secret: 'test-secret',
  };
  const presence = createPresence(deps);
  const fire = async () => {
    for (const run of timers.splice(0)) run();
    await Bun.sleep(5);
  };
  return { presence, store, log, sandbox, fire, deps, advance: (ms: number) => void (clock += ms) };
}

describe('leave tickets', () => {
  test('a fresh ticket is accepted for its own project only', () => {
    const { presence } = setup();
    const ticket = presence.leaveTicket(PROJECT);
    expect(presence.checkLeaveTicket(PROJECT, ticket)).toBe(true);
    expect(presence.checkLeaveTicket('other-project', ticket)).toBe(false);
  });

  test('expired, tampered and malformed tickets are rejected', () => {
    const { presence, advance } = setup();
    const ticket = presence.leaveTicket(PROJECT);
    const [expires, signature] = ticket.split('.');
    expect(presence.checkLeaveTicket(PROJECT, `${Number(expires) + 1}.${signature}`)).toBe(false);
    expect(presence.checkLeaveTicket(PROJECT, `${expires}.${signature}x`)).toBe(false);
    for (const bad of ['', 'nope', '.', `${expires}.`, `.${signature}`, `${ticket}.extra`, `abc.${signature}`]) {
      expect(presence.checkLeaveTicket(PROJECT, bad)).toBe(false);
    }
    advance(16 * 60_000);
    expect(presence.checkLeaveTicket(PROJECT, ticket)).toBe(false);
  });

  test('tickets signed with another secret are rejected', () => {
    const a = setup().presence;
    const other = createPresence({ ...setup().deps, secret: 'different' });
    expect(a.checkLeaveTicket(PROJECT, other.leaveTicket(PROJECT))).toBe(false);
  });
});

describe('heartbeat', () => {
  test('running sandbox refreshes activity, at most once a minute', async () => {
    const { presence, log, advance } = setup();
    expect(await presence.heartbeat(PROJECT)).toBe('running');
    expect(await presence.heartbeat(PROJECT)).toBe('running');
    expect(log.refreshed).toBe(1);
    advance(61_000);
    await presence.heartbeat(PROJECT);
    expect(log.refreshed).toBe(2);
  });

  test('stopped, archived and stopping sandboxes report stopped so the page wakes them', async () => {
    for (const state of ['stopped', 'archived', 'stopping', 'archiving', 'error']) {
      const { presence, log } = setup({ state });
      expect(await presence.heartbeat(PROJECT)).toBe('stopped');
      expect(log.refreshed).toBe(0);
    }
  });

  test('a sandbox that is already starting is not woken twice', async () => {
    const { presence } = setup({ state: 'starting' });
    expect(await presence.heartbeat(PROJECT)).toBe('running');
  });

  test('a project without a sandbox yet reports none', async () => {
    const { presence } = setup({ sandboxId: null });
    expect(await presence.heartbeat(PROJECT)).toBe('none');
  });

  test('a failed refresh is retried on the next heartbeat', async () => {
    const { presence, sandbox, log } = setup();
    let fail = true;
    sandbox.refreshActivity = async () => {
      log.refreshed++;
      if (fail) throw new Error('daytona hiccup');
    };
    await presence.heartbeat(PROJECT);
    fail = false;
    await presence.heartbeat(PROJECT);
    expect(log.refreshed).toBe(2);
  });

  test('heartbeat cancels a pending leave', async () => {
    const { presence, store } = setup();
    await presence.markLeft(PROJECT);
    expect(store.has(projectLeftKey(PROJECT))).toBe(true);
    await presence.heartbeat(PROJECT);
    expect(store.has(projectLeftKey(PROJECT))).toBe(false);
  });
});

describe('leaving', () => {
  test('user leaves and does not come back: snapshot then stop', async () => {
    const { presence, fire, log, store } = setup({ seq: 12, snapshots: { count: 1, lastSeq: 5 } });
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.snapshots).toEqual([12]);
    expect(log.stopped).toBe(1);
    expect(log.detached).toBe(1);
    expect(store.has(projectLeftKey(PROJECT))).toBe(false);
  });

  test('nothing changed since the last snapshot: stop without a new snapshot', async () => {
    const { presence, fire, log } = setup({ seq: 12, snapshots: { count: 1, lastSeq: 12 } });
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.snapshots).toEqual([]);
    expect(log.stopped).toBe(1);
  });

  test('a project that never had a snapshot gets one even at sequence 0', async () => {
    const { presence, fire, log } = setup({ snapshots: { count: 0, lastSeq: 0 } });
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.snapshots).toEqual([0]);
    expect(log.stopped).toBe(1);
  });

  test('page refresh: leave followed by a return within the grace keeps it running', async () => {
    const { presence, fire, log } = setup();
    await presence.markLeft(PROJECT);
    await presence.markPresent(PROJECT);
    await fire();
    expect(log.stopped).toBe(0);
  });

  test('two tabs: one closes, the other keeps beating, sandbox stays up', async () => {
    const { presence, fire, log } = setup();
    await presence.markLeft(PROJECT);
    await presence.heartbeat(PROJECT);
    await fire();
    expect(log.stopped).toBe(0);
  });

  test('leave, return, leave again: only the latest leave can stop it', async () => {
    const { presence, fire, log } = setup();
    await presence.markLeft(PROJECT);
    await presence.markPresent(PROJECT);
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.stopped).toBe(1);
  });

  test('never stops while the agent is building', async () => {
    const { presence, fire, log, store } = setup();
    store.set(lockKey(PROJECT), 'backend-1');
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.stopped).toBe(0);
  });

  test('user comes back while the snapshot is being written: no stop', async () => {
    const { presence, fire, log, deps } = setup({ seq: 3, snapshots: { count: 0, lastSeq: 0 } });
    deps.saveSnapshot = async (_p, _s, seq) => {
      log.snapshots.push(seq);
      await presence.markPresent(PROJECT);
      return true;
    };
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.snapshots).toEqual([3]);
    expect(log.stopped).toBe(0);
  });

  test('agent starts while the snapshot is being written: no stop', async () => {
    const { presence, fire, log, deps, store } = setup({ seq: 3, snapshots: { count: 0, lastSeq: 0 } });
    deps.saveSnapshot = async () => {
      store.set(lockKey(PROJECT), 'backend-2');
      return true;
    };
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.stopped).toBe(0);
  });

  test('a failed snapshot still stops the sandbox so memory is freed', async () => {
    const { presence, fire, log, deps } = setup({ seq: 9, snapshots: { count: 1, lastSeq: 1 } });
    deps.saveSnapshot = async () => {
      throw new Error('R2 down');
    };
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.stopped).toBe(1);
  });

  test('already stopped sandbox: nothing to do, marker cleaned up', async () => {
    const { presence, fire, log, store } = setup({ state: 'stopped' });
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.stopped).toBe(0);
    expect(store.has(projectLeftKey(PROJECT))).toBe(false);
  });

  test('a stop failure is swallowed and reported as skipped', async () => {
    const { presence, sandbox, store, log } = setup();
    sandbox.stop = async () => {
      throw new Error('daytona 500');
    };
    await presence.markLeft(PROJECT);
    const token = store.get(projectLeftKey(PROJECT))!;
    expect(await presence.stopIfStillGone(PROJECT, token)).toBe('skipped');
    expect(log.detached).toBe(0);
  });

  test('a stale timer from an older leave cannot stop the sandbox', async () => {
    const { presence, log } = setup();
    await presence.markLeft(PROJECT);
    expect(await presence.stopIfStillGone(PROJECT, 'token-from-an-older-leave')).toBe('skipped');
    expect(log.stopped).toBe(0);
  });

  test('garbage in the sequence key does not break the snapshot decision', async () => {
    const { presence, fire, log, store } = setup({ snapshots: { count: 1, lastSeq: 4 } });
    store.set(seqKey(PROJECT), 'not-a-number');
    await presence.markLeft(PROJECT);
    await fire();
    expect(log.stopped).toBe(1);
    expect(log.snapshots).toEqual([]);
  });
});
