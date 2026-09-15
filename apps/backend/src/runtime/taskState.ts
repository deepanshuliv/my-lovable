import { randomUUIDv7 } from 'bun';
import { prisma } from '@repo/db';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
export type VerificationStatus = 'unknown' | 'pending' | 'passed' | 'failed';

export type PlanStep = {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  dependencies: string[];
};

export type Decision = {
  id: string;
  decision: string;
  rationale?: string;
  createdAt: string;
  supersedes?: string;
};

export type FailedAttempt = {
  approach: string;
  reason: string;
  createdAt: string;
};

export type VerificationState = {
  status: VerificationStatus;
  checks: Record<string, boolean | null>;
  lastOutput?: string;
  lastRunAt?: string;
  failureCount: number;
};

export type TaskState = {
  taskId: string;
  sessionId: string;
  objective: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
  plan: PlanStep[];
  currentStep: string | null;
  completedWork: string[];
  currentState: string;
  decisions: Decision[];
  constraints: string[];
  filesTouched: string[];
  failedAttempts: FailedAttempt[];
  blockers: string[];
  openLoops: string[];
  nextSteps: string[];
  verificationState: VerificationState;
  timestamps: { createdAt: string; updatedAt: string };
  version: number;
};

export type TaskStatePatch = Partial<Omit<TaskState, 'taskId' | 'sessionId' | 'version' | 'timestamps'>> & {
  version?: never;
};

export interface TaskStateRepository {
  load(taskId: string): Promise<TaskState | null>;
  create(state: TaskState): Promise<TaskState>;
  update(taskId: string, expectedVersion: number, state: TaskState): Promise<TaskState>;
}

export class TaskStateConflictError extends Error {
  constructor(taskId: string, expectedVersion: number) {
    super(`task ${taskId} changed while updating (expected version ${expectedVersion})`);
    this.name = 'TaskStateConflictError';
  }
}

export class InvalidTaskStateTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`invalid task state transition: ${from} -> ${to}`);
    this.name = 'InvalidTaskStateTransitionError';
  }
}

export class TaskCompletionGuardError extends Error {
  constructor() {
    super('cannot complete a task before verification passes');
    this.name = 'TaskCompletionGuardError';
  }
}

const terminalStatuses = new Set<TaskStatus>(['completed', 'failed']);

function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  if (terminalStatuses.has(from)) return false;
  if (from === 'pending') return to === 'running' || to === 'blocked' || to === 'failed';
  if (from === 'blocked') return to === 'running' || to === 'failed';
  return to === 'completed' || to === 'failed' || to === 'blocked' || to === 'running';
}

function now(): string {
  return new Date().toISOString();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(-100);
}

function normaliseState(state: TaskState): TaskState {
  return {
    ...state,
    objective: state.objective.slice(0, 10_000),
    currentState: state.currentState.slice(0, 6_000),
    acceptanceCriteria: uniqueStrings(state.acceptanceCriteria),
    completedWork: uniqueStrings(state.completedWork),
    constraints: uniqueStrings(state.constraints),
    filesTouched: uniqueStrings(state.filesTouched),
    blockers: uniqueStrings(state.blockers),
    openLoops: uniqueStrings(state.openLoops),
    nextSteps: uniqueStrings(state.nextSteps),
    plan: state.plan.slice(-100).map((step) => ({ ...step, description: step.description.slice(0, 2_000), dependencies: uniqueStrings(step.dependencies) })),
    decisions: state.decisions.slice(-100).map((decision) => ({ ...decision, decision: decision.decision.slice(0, 2_000), rationale: decision.rationale?.slice(0, 2_000) })),
    failedAttempts: state.failedAttempts.slice(-100).map((attempt) => ({ ...attempt, approach: attempt.approach.slice(0, 2_000), reason: attempt.reason.slice(0, 2_000) })),
    version: state.version,
  };
}

function isStatus(value: unknown): value is TaskStatus {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'failed' || value === 'blocked';
}

/** Runtime validation at the persistence boundary prevents malformed JSON from becoming active state. */
export function validateTaskState(input: unknown): TaskState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('persisted task state is not an object');
  const state = input as Partial<TaskState>;
  const requiredArrays: (keyof TaskState)[] = ['acceptanceCriteria', 'plan', 'completedWork', 'decisions', 'constraints', 'filesTouched', 'failedAttempts', 'blockers', 'openLoops', 'nextSteps'];
  if (typeof state.taskId !== 'string' || typeof state.sessionId !== 'string' || typeof state.objective !== 'string' || !isStatus(state.status) || typeof state.currentState !== 'string' || typeof state.version !== 'number' || !state.timestamps || typeof state.timestamps.createdAt !== 'string' || typeof state.timestamps.updatedAt !== 'string') {
    throw new Error('persisted task state is missing required fields');
  }
  if (requiredArrays.some((key) => !Array.isArray(state[key]))) throw new Error('persisted task state has invalid array fields');
  if (!state.verificationState || typeof state.verificationState !== 'object' || !['unknown', 'pending', 'passed', 'failed'].includes(state.verificationState.status) || typeof state.verificationState.failureCount !== 'number') {
    throw new Error('persisted task state has invalid verification state');
  }
  return normaliseState(state as TaskState);
}

export function createInitialTaskState(
  taskId: string,
  sessionId: string,
  objective: string,
  acceptanceCriteria: string[] = [],
): TaskState {
  const createdAt = now();
  return {
    taskId,
    sessionId,
    objective: objective.trim(),
    acceptanceCriteria: uniqueStrings(acceptanceCriteria),
    status: 'pending',
    plan: [],
    currentStep: null,
    completedWork: [],
    currentState: 'Task created; execution has not started.',
    decisions: [],
    constraints: [],
    filesTouched: [],
    failedAttempts: [],
    blockers: [],
    openLoops: [],
    nextSteps: [],
    verificationState: {
      status: 'unknown',
      checks: {},
      failureCount: 0,
    },
    timestamps: { createdAt, updatedAt: createdAt },
    version: 1,
  };
}

/** Durable, optimistic-concurrency-protected owner of the current task state. */
export class TaskStateManager {
  constructor(private readonly repository: TaskStateRepository) {}

  async load(taskId: string): Promise<TaskState | null> {
    const state = await this.repository.load(taskId);
    return state ? validateTaskState(state) : null;
  }

  async loadOrCreate(
    taskId: string,
    sessionId: string,
    objective: string,
    acceptanceCriteria: string[] = [],
  ): Promise<TaskState> {
    const existing = await this.load(taskId);
    if (existing) return existing;
    const initial = createInitialTaskState(taskId, sessionId, objective, acceptanceCriteria);
    try {
      return await this.repository.create(initial);
    } catch (error) {
      // Another request may have created the task between load and create. Reloading is
      // safe and makes this operation idempotent without hiding unrelated failures.
      const raced = await this.load(taskId);
      if (raced) return raced;
      throw error;
    }
  }

  async update(taskId: string, patch: TaskStatePatch): Promise<TaskState> {
    const current = await this.load(taskId);
    if (!current) throw new Error(`task state ${taskId} does not exist`);

    if (patch.status && !canTransition(current.status, patch.status)) {
      throw new InvalidTaskStateTransitionError(current.status, patch.status);
    }
    if (patch.status === 'completed' && current.verificationState.status !== 'passed') {
      throw new TaskCompletionGuardError();
    }

    const merged: TaskState = normaliseState({
      ...current,
      ...patch,
      timestamps: { ...current.timestamps, updatedAt: now() },
      version: current.version + 1,
    });

    return await this.repository.update(taskId, current.version, merged);
  }

  async start(taskId: string, currentStep?: string): Promise<TaskState> {
    return await this.update(taskId, {
      status: 'running',
      currentStep: currentStep ?? null,
      currentState: 'Agent execution is active.',
    });
  }

  async recordDecision(taskId: string, decision: Omit<Decision, 'id' | 'createdAt'>): Promise<TaskState> {
    const current = await this.loadRequired(taskId);
    const next = current.decisions.filter((item) => item.id !== decision.supersedes);
    next.push({ ...decision, id: randomUUIDv7(), createdAt: now() });
    return await this.update(taskId, { decisions: next });
  }

  async loadRequired(taskId: string): Promise<TaskState> {
    const state = await this.load(taskId);
    if (!state) throw new Error(`task state ${taskId} does not exist`);
    return state;
  }
}

export class InMemoryTaskStateRepository implements TaskStateRepository {
  private readonly states = new Map<string, TaskState>();

  async load(taskId: string): Promise<TaskState | null> {
    const state = this.states.get(taskId);
    return state ? structuredClone(state) : null;
  }

  async create(state: TaskState): Promise<TaskState> {
    if (this.states.has(state.taskId)) throw new Error(`task state ${state.taskId} already exists`);
    this.states.set(state.taskId, structuredClone(state));
    return structuredClone(state);
  }

  async update(taskId: string, expectedVersion: number, state: TaskState): Promise<TaskState> {
    const current = this.states.get(taskId);
    if (!current || current.version !== expectedVersion) {
      throw new TaskStateConflictError(taskId, expectedVersion);
    }
    this.states.set(taskId, structuredClone(state));
    return structuredClone(state);
  }
}

export class PrismaTaskStateRepository implements TaskStateRepository {
  async load(taskId: string): Promise<TaskState | null> {
    const row = await prisma.taskState.findUnique({ where: { taskId } });
    return row ? (row.state as unknown as TaskState) : null;
  }

  async create(state: TaskState): Promise<TaskState> {
    const row = await prisma.taskState.create({
      data: {
        taskId: state.taskId,
        projectId: state.sessionId,
        sessionId: state.sessionId,
        version: state.version,
        state: state as never,
      },
    });
    return row.state as unknown as TaskState;
  }

  async update(taskId: string, expectedVersion: number, state: TaskState): Promise<TaskState> {
    const result = await prisma.taskState.updateMany({
      where: { taskId, version: expectedVersion },
      data: { version: state.version, state: state as never },
    });
    if (result.count !== 1) throw new TaskStateConflictError(taskId, expectedVersion);
    return state;
  }
}
