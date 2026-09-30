import { describe, expect, test } from 'bun:test';
import { SANDBOX_AUTO_ARCHIVE_MINUTES, SANDBOX_AUTO_DELETE_MINUTES, SANDBOX_AUTO_STOP_MINUTES } from '../config';
import { applyLifecycle, prepareForUse, type LifecycleSandbox } from './index';

function fakeSandbox(state: string, intervals: Partial<Pick<LifecycleSandbox, 'autoStopInterval' | 'autoArchiveInterval' | 'autoDeleteInterval'>> = {}) {
  const calls: string[] = [];
  const archivingPolls = { left: 2 };
  const sandbox: LifecycleSandbox = {
    id: 'sb',
    state,
    ...intervals,
    start: async (timeout) => {
      calls.push(`start:${timeout}`);
      sandbox.state = 'started';
    },
    waitUntilStarted: async () => {
      calls.push('waitStarted');
      sandbox.state = 'started';
    },
    waitUntilStopped: async () => {
      calls.push('waitStopped');
      sandbox.state = 'stopped';
    },
    refreshData: async () => {
      calls.push('refresh');
      if (sandbox.state === 'archiving' && --archivingPolls.left <= 0) sandbox.state = 'archived';
    },
    setAutostopInterval: async (v) => void calls.push(`autoStop:${v}`),
    setAutoArchiveInterval: async (v) => void calls.push(`autoArchive:${v}`),
    setAutoDeleteInterval: async (v) => void calls.push(`autoDelete:${v}`),
  };
  return { sandbox, calls, archivingPolls };
}

const noSleep = async () => {};

describe('prepareForUse', () => {
  test('started sandbox is used as is', async () => {
    const { sandbox, calls } = fakeSandbox('started');
    expect(await prepareForUse(sandbox, noSleep)).toBe(true);
    expect(calls).toEqual([]);
  });

  test('stopped sandbox is started', async () => {
    const { sandbox, calls } = fakeSandbox('stopped');
    expect(await prepareForUse(sandbox, noSleep)).toBe(true);
    expect(calls[0]).toBe('start:120');
  });

  test('archived sandbox is started with a longer timeout', async () => {
    const { sandbox, calls } = fakeSandbox('archived');
    expect(await prepareForUse(sandbox, noSleep)).toBe(true);
    expect(calls[0]).toBe('start:300');
  });

  test('stopping sandbox waits until stopped, then starts', async () => {
    const { sandbox, calls } = fakeSandbox('stopping');
    expect(await prepareForUse(sandbox, noSleep)).toBe(true);
    expect(calls.slice(0, 2)).toEqual(['waitStopped', 'start:120']);
  });

  test('archiving sandbox waits for the archive to finish, then starts', async () => {
    const { sandbox, calls } = fakeSandbox('archiving');
    expect(await prepareForUse(sandbox, noSleep)).toBe(true);
    expect(calls.filter((c) => c === 'refresh').length).toBe(2);
    expect(calls).toContain('start:300');
  });

  test('booting sandboxes are waited for, not started twice', async () => {
    for (const state of ['starting', 'restoring', 'creating', 'pulling_snapshot']) {
      const { sandbox, calls } = fakeSandbox(state);
      expect(await prepareForUse(sandbox, noSleep)).toBe(true);
      expect(calls).toEqual(['waitStarted']);
    }
  });

  test('broken sandboxes are reported unusable so a fresh one is built from R2', async () => {
    for (const state of ['error', 'build_failed', 'destroyed', 'destroying', 'unknown']) {
      const { sandbox, calls } = fakeSandbox(state);
      expect(await prepareForUse(sandbox, noSleep)).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  test('a sandbox with no state is treated as unusable', async () => {
    const { sandbox } = fakeSandbox('started');
    sandbox.state = undefined;
    expect(await prepareForUse(sandbox, noSleep)).toBe(false);
  });
});

describe('applyLifecycle', () => {
  test('old sandboxes are brought onto the current rules', async () => {
    const { sandbox, calls } = fakeSandbox('started', { autoStopInterval: 15, autoArchiveInterval: 10080, autoDeleteInterval: 120 });
    await applyLifecycle(sandbox);
    expect(calls).toEqual([
      `autoStop:${SANDBOX_AUTO_STOP_MINUTES}`,
      `autoArchive:${SANDBOX_AUTO_ARCHIVE_MINUTES}`,
      `autoDelete:${SANDBOX_AUTO_DELETE_MINUTES}`,
    ]);
  });

  test('sandboxes already on the rules are left alone', async () => {
    const { sandbox, calls } = fakeSandbox('started', {
      autoStopInterval: SANDBOX_AUTO_STOP_MINUTES,
      autoArchiveInterval: SANDBOX_AUTO_ARCHIVE_MINUTES,
      autoDeleteInterval: SANDBOX_AUTO_DELETE_MINUTES,
    });
    await applyLifecycle(sandbox);
    expect(calls).toEqual([]);
  });

  test('one failing update does not block the others', async () => {
    const { sandbox, calls } = fakeSandbox('started', { autoStopInterval: 1, autoArchiveInterval: 1, autoDeleteInterval: 1 });
    sandbox.setAutostopInterval = async () => {
      throw new Error('daytona 500');
    };
    await applyLifecycle(sandbox);
    expect(calls).toContain(`autoArchive:${SANDBOX_AUTO_ARCHIVE_MINUTES}`);
    expect(calls).toContain(`autoDelete:${SANDBOX_AUTO_DELETE_MINUTES}`);
  });

  test('auto-delete is off and archiving is on by default', () => {
    expect(SANDBOX_AUTO_DELETE_MINUTES).toBeLessThan(0);
    expect(SANDBOX_AUTO_ARCHIVE_MINUTES).toBeGreaterThan(0);
  });
});
