import type { EventStore } from './eventStore';
import type { TaskStateManager, VerificationState } from './taskState';

export type VerificationResultLike = {
  typecheckPassed: boolean | null;
  typecheckOutput: string;
  runtimeErrors: string[];
  ok: boolean;
};

export type VerificationRunner = () => Promise<VerificationResultLike>;

/** Converts verification evidence into durable task state and observable events. */
export class VerificationManager {
  constructor(
    private readonly states: TaskStateManager,
    private readonly events: EventStore,
  ) {}

  async verify(taskId: string, sessionId: string, runner: VerificationRunner): Promise<VerificationResultLike> {
    await this.events.append({
      type: 'verification_started',
      payload: { taskId },
      correlation: { taskId, sessionId },
    });
    await this.states.update(taskId, {
      verificationState: { status: 'pending', checks: {}, failureCount: 0 },
    });

    try {
      const result = await runner();
      const previous = await this.states.loadRequired(taskId);
      const verificationState: VerificationState = {
        status: result.ok ? 'passed' : 'failed',
        checks: {
          typecheck: result.typecheckPassed,
          runtime: result.runtimeErrors.length === 0,
        },
        lastOutput: result.typecheckOutput.slice(-4_000),
        lastRunAt: new Date().toISOString(),
        failureCount: result.ok ? previous.verificationState.failureCount : previous.verificationState.failureCount + 1,
      };
      await this.states.update(taskId, {
        verificationState,
        currentState: result.ok ? 'Verification passed.' : 'Verification failed; repair is required.',
      });
      await this.events.append({
        type: result.ok ? 'verification_passed' : 'verification_failed',
        payload: {
          taskId,
          typecheckPassed: result.typecheckPassed,
          typecheckOutput: result.typecheckOutput.slice(-4_000),
          runtimeErrors: result.runtimeErrors.slice(-20),
          ok: result.ok,
        },
        correlation: { taskId, sessionId },
      });
      return result;
    } catch (error) {
      await this.states.update(taskId, {
        verificationState: {
          status: 'failed',
          checks: { runner: false },
          lastOutput: String(error).slice(0, 4_000),
          lastRunAt: new Date().toISOString(),
          failureCount: (await this.states.loadRequired(taskId)).verificationState.failureCount + 1,
        },
        currentState: 'Verification runner failed; repair or retry is required.',
      });
      await this.events.append({
        type: 'verification_failed',
        payload: { taskId, message: String(error).slice(0, 500), runnerFailure: true },
        correlation: { taskId, sessionId },
      }).catch(() => {});
      throw error;
    }
  }

  async complete(taskId: string): Promise<void> {
    const state = await this.states.loadRequired(taskId);
    if (state.verificationState.status !== 'passed') {
      throw new Error('cannot complete a task before verification passes');
    }
    await this.states.update(taskId, { status: 'completed', currentState: 'Task completed after verification.' });
  }
}
