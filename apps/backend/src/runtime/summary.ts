import { randomUUIDv7 } from 'bun';
import { prisma } from '@repo/db';
import type { Decision, FailedAttempt, TaskState, VerificationState } from './taskState';

export type CompactedSummary = {
  objective: string;
  acceptanceCriteria: string[];
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
};

export type StoredSummary = CompactedSummary & {
  id: string;
  taskId: string;
  sessionId: string;
  version: number;
  coversFromEventSeq?: number;
  coversToEventSeq?: number;
  createdAt: string;
};

export interface SummaryRepository {
  latest(taskId: string): Promise<StoredSummary | null>;
  save(summary: StoredSummary): Promise<StoredSummary>;
}

export function summaryFromTaskState(state: TaskState): CompactedSummary {
  return {
    objective: state.objective,
    acceptanceCriteria: [...state.acceptanceCriteria],
    completedWork: [...state.completedWork],
    currentState: state.currentState,
    decisions: structuredClone(state.decisions),
    constraints: [...state.constraints],
    filesTouched: [...state.filesTouched],
    failedAttempts: structuredClone(state.failedAttempts),
    blockers: [...state.blockers],
    openLoops: [...state.openLoops],
    nextSteps: [...state.nextSteps],
    verificationState: structuredClone(state.verificationState),
  };
}

export function normaliseSummary(input: Partial<CompactedSummary>, fallback: CompactedSummary): CompactedSummary {
  const strings = (value: unknown, fallbackValue: string[]) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : fallbackValue;
  return {
    objective: typeof input.objective === 'string' && input.objective.trim() ? input.objective.trim() : fallback.objective,
    acceptanceCriteria: strings(input.acceptanceCriteria, fallback.acceptanceCriteria),
    completedWork: strings(input.completedWork, fallback.completedWork),
    currentState: typeof input.currentState === 'string' ? input.currentState.slice(0, 4000) : fallback.currentState,
    decisions: Array.isArray(input.decisions) ? input.decisions.slice(0, 100) as Decision[] : fallback.decisions,
    constraints: strings(input.constraints, fallback.constraints),
    filesTouched: strings(input.filesTouched, fallback.filesTouched),
    failedAttempts: Array.isArray(input.failedAttempts)
      ? input.failedAttempts.slice(0, 100) as FailedAttempt[]
      : fallback.failedAttempts,
    blockers: strings(input.blockers, fallback.blockers),
    openLoops: strings(input.openLoops, fallback.openLoops),
    nextSteps: strings(input.nextSteps, fallback.nextSteps),
    verificationState:
      input.verificationState && typeof input.verificationState === 'object'
        ? structuredClone(input.verificationState) as VerificationState
        : structuredClone(fallback.verificationState),
  };
}

export function summaryText(summary: CompactedSummary): string {
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- (none)');
  const decisions = summary.decisions.length
    ? summary.decisions.map((item) => `- **${item.decision}**${item.rationale ? `: ${item.rationale}` : ''}`).join('\n')
    : '- (none)';
  const failed = summary.failedAttempts.length
    ? summary.failedAttempts.map((item) => `- ${item.approach}: ${item.reason}`).join('\n')
    : '- (none)';
  return [
    '## Objective', summary.objective,
    '## Acceptance Criteria', list(summary.acceptanceCriteria),
    '## Completed Work', list(summary.completedWork),
    '## Current State', summary.currentState,
    '## Decisions', decisions,
    '## Constraints', list(summary.constraints),
    '## Files Touched', list(summary.filesTouched),
    '## Failed Attempts', failed,
    '## Blockers', list(summary.blockers),
    '## Open Loops', list(summary.openLoops),
    '## Next Steps', list(summary.nextSteps),
    '## Verification', `${summary.verificationState.status}; failures=${summary.verificationState.failureCount}`,
  ].join('\n');
}

export class InMemorySummaryRepository implements SummaryRepository {
  private readonly summaries = new Map<string, StoredSummary[]>();

  async latest(taskId: string): Promise<StoredSummary | null> {
    const rows = this.summaries.get(taskId) ?? [];
    const row = rows.at(-1);
    return row ? structuredClone(row) : null;
  }

  async save(summary: StoredSummary): Promise<StoredSummary> {
    const rows = this.summaries.get(summary.taskId) ?? [];
    if (rows.some((row) => row.version === summary.version)) {
      throw new Error(`summary version ${summary.version} already exists for ${summary.taskId}`);
    }
    rows.push(structuredClone(summary));
    this.summaries.set(summary.taskId, rows);
    return structuredClone(summary);
  }

  count(taskId: string): number {
    return this.summaries.get(taskId)?.length ?? 0;
  }
}

export class PrismaSummaryRepository implements SummaryRepository {
  async latest(taskId: string): Promise<StoredSummary | null> {
    const row = await prisma.sessionSummary.findFirst({ where: { taskId }, orderBy: { version: 'desc' } });
    if (!row) return null;
    return {
      ...(row.summary as unknown as CompactedSummary),
      id: row.id,
      taskId: row.taskId,
      sessionId: row.sessionId,
      version: row.version,
      coversFromEventSeq: row.coversFromEventSeq ?? undefined,
      coversToEventSeq: row.coversToEventSeq ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async save(summary: StoredSummary): Promise<StoredSummary> {
    const row = await prisma.sessionSummary.create({
      data: {
        id: summary.id || randomUUIDv7(),
        taskId: summary.taskId,
        sessionId: summary.sessionId,
        version: summary.version,
        summary: summary as never,
        coversFromEventSeq: summary.coversFromEventSeq,
        coversToEventSeq: summary.coversToEventSeq,
        createdAt: new Date(summary.createdAt),
      },
    });
    return { ...summary, id: row.id, createdAt: row.createdAt.toISOString() };
  }
}
