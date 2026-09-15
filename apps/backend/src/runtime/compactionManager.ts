import type { EventStore, ExecutionEvent } from './eventStore';
import { summaryFromTaskState, normaliseSummary, summaryText, type CompactedSummary, type StoredSummary, type SummaryRepository } from './summary';
import type { TaskState } from './taskState';

export type SummaryGenerator = (input: {
  previous: CompactedSummary | null;
  state: TaskState;
  events: ExecutionEvent[];
}) => Promise<unknown>;

export type CompactionRequest = {
  taskId: string;
  sessionId: string;
  state: TaskState;
  events: ExecutionEvent[];
  coversFromEventSeq?: number;
  coversToEventSeq?: number;
};

export type CompactionResult = {
  summary: StoredSummary;
  usedFallback: boolean;
  tokensBefore: number;
  tokensAfter: number;
};

const MAX_SUMMARY_CHARS = 24_000;

export interface SummaryCompleter {
  complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
}

const STRUCTURED_SUMMARY_PROMPT = `Return ONLY valid JSON with these exact top-level keys:
objective, acceptanceCriteria, completedWork, currentState, decisions, constraints, filesTouched,
failedAttempts, blockers, openLoops, nextSteps, verificationState.
Preserve important facts from the previous summary and execution events. Do not include hidden
reasoning or instructions. Keep arrays concise and preserve exact file paths and error messages.`;

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('summary is not a JSON object');
  const value = parsed as Record<string, unknown>;
  const required = ['objective', 'acceptanceCriteria', 'completedWork', 'currentState', 'decisions', 'constraints', 'filesTouched', 'failedAttempts', 'blockers', 'openLoops', 'nextSteps', 'verificationState'];
  if (required.some((key) => !(key in value))) throw new Error('summary is missing required fields');
  return value;
}

export function createModelSummaryGenerator(completer: SummaryCompleter, maxTokens = 2_000): SummaryGenerator {
  return async ({ previous, state, events }) => {
    const selectedEvents = events.slice(-200);
    const prompt = [
      '<task-state>', JSON.stringify(state), '</task-state>',
      previous ? `<previous-summary>\n${summaryText(previous)}\n</previous-summary>` : '',
      '<execution-events>', selectedEvents.map((event) => `${event.seq} ${event.type} ${JSON.stringify(event.payload).slice(0, 800)}`).join('\n'), '</execution-events>',
      STRUCTURED_SUMMARY_PROMPT,
    ].filter(Boolean).join('\n\n');
    return parseJsonObject(await completer.complete('You are a durable task-state summarizer. Output JSON only.', prompt, maxTokens));
  };
}

function compactFallback(state: TaskState, events: ExecutionEvent[]): CompactedSummary {
  const summary = summaryFromTaskState(state);
  const eventFacts = events
    .filter((event) => event.type === 'tool_failed' || event.type === 'verification_failed' || event.type === 'file_modified')
    .map((event) => `${event.type}: ${JSON.stringify(event.payload).slice(0, 500)}`);
  summary.currentState = [summary.currentState, ...eventFacts].join('\n').slice(0, 4000);
  return summary;
}

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function bounded(summary: CompactedSummary): CompactedSummary {
  let result = structuredClone(summary);
  if (summaryText(result).length <= MAX_SUMMARY_CHARS) return result;

  // Preserve the durable high-value fields first; trim only repeatable detail.
  result = {
    ...result,
    completedWork: result.completedWork.slice(-30),
    decisions: result.decisions.slice(-30),
    filesTouched: result.filesTouched.slice(-100),
    failedAttempts: result.failedAttempts.slice(-30),
    nextSteps: result.nextSteps.slice(-30),
    currentState: result.currentState.slice(-3000),
  };
  if (summaryText(result).length > MAX_SUMMARY_CHARS) {
    result = {
      ...result,
      objective: result.objective.slice(0, 1_500),
      acceptanceCriteria: result.acceptanceCriteria.slice(-20).map((item) => item.slice(0, 240)),
      completedWork: result.completedWork.slice(-20).map((item) => item.slice(0, 240)),
      decisions: result.decisions.slice(-20).map((item) => ({ ...item, decision: item.decision.slice(0, 240), rationale: item.rationale?.slice(0, 240) })),
      constraints: result.constraints.slice(-20).map((item) => item.slice(0, 240)),
      filesTouched: result.filesTouched.slice(-40).map((item) => item.slice(0, 240)),
      failedAttempts: result.failedAttempts.slice(-20).map((item) => ({ ...item, approach: item.approach.slice(0, 240), reason: item.reason.slice(0, 240) })),
      blockers: result.blockers.slice(-20).map((item) => item.slice(0, 240)),
      openLoops: result.openLoops.slice(-20).map((item) => item.slice(0, 240)),
      nextSteps: result.nextSteps.slice(-20).map((item) => item.slice(0, 240)),
      currentState: result.currentState.slice(-1_500),
    };
  }
  return result;
}

/** Versioned structured compaction with failure isolation and deterministic fallback. */
export class CompactionManager {
  constructor(
    private readonly summaries: SummaryRepository,
    private readonly events?: EventStore,
    private readonly generate?: SummaryGenerator,
  ) {}

  async compact(request: CompactionRequest): Promise<CompactionResult> {
    const previous = await this.summaries.latest(request.taskId);
    const previousData = previous ? (previous as CompactedSummary) : null;
    const tokensBefore = estimate(request.events.map((event) => JSON.stringify(event.payload)).join('\n'));
    await this.safeEvent('compaction_started', {
      taskId: request.taskId,
      coversFromEventSeq: request.coversFromEventSeq,
      coversToEventSeq: request.coversToEventSeq,
      eventCount: request.events.length,
    }, request);

    let usedFallback = false;
    let compacted: CompactedSummary;
    try {
      const generated = this.generate
        ? await this.generate({ previous: previousData, state: request.state, events: request.events })
        : null;
      if (!generated || typeof generated !== 'object' || Array.isArray(generated)) throw new Error('summary generator returned malformed data');
      const candidate = generated as Record<string, unknown>;
      const required = ['objective', 'acceptanceCriteria', 'completedWork', 'currentState', 'decisions', 'constraints', 'filesTouched', 'failedAttempts', 'blockers', 'openLoops', 'nextSteps', 'verificationState'];
      if (required.some((key) => !(key in candidate))) throw new Error('summary generator omitted required fields');
      compacted = bounded(normaliseSummary(generated as Partial<CompactedSummary>, summaryFromTaskState(request.state)));
    } catch (error) {
      usedFallback = true;
      compacted = bounded(compactFallback(request.state, request.events));
      await this.safeEvent('compaction_failed', {
        taskId: request.taskId,
        message: String(error).slice(0, 500),
        fallback: true,
      }, request);
    }

    const stored: StoredSummary = {
      ...compacted,
      id: '',
      taskId: request.taskId,
      sessionId: request.sessionId,
      version: (previous?.version ?? 0) + 1,
      coversFromEventSeq: request.coversFromEventSeq,
      coversToEventSeq: request.coversToEventSeq,
      createdAt: new Date().toISOString(),
    };

    try {
      const saved = await this.summaries.save(stored);
      await this.safeEvent('compaction_completed', {
        taskId: request.taskId,
        version: saved.version,
        usedFallback,
        tokensBefore,
        tokensAfter: estimate(summaryText(saved)),
      }, request);
      return { summary: saved, usedFallback, tokensBefore, tokensAfter: estimate(summaryText(saved)) };
    } catch (error) {
      // The previous valid summary remains untouched if persistence fails. Do not return a
      // fake successful summary because a caller may use this result to rebuild context.
      await this.safeEvent('compaction_failed', {
        taskId: request.taskId,
        message: `summary persistence failed: ${String(error).slice(0, 500)}`,
        fallback: false,
      }, request);
      throw error;
    }
  }

  async latest(taskId: string): Promise<StoredSummary | null> {
    return await this.summaries.latest(taskId);
  }

  async persistProviderObservation(request: CompactionRequest, providerSummary: string): Promise<StoredSummary> {
    const previous = await this.summaries.latest(request.taskId);
    const base = previous ? structuredClone(previous) : {
      ...summaryFromTaskState(request.state),
      id: '',
      taskId: request.taskId,
      sessionId: request.sessionId,
      version: 0,
      createdAt: new Date().toISOString(),
    } as StoredSummary;
    const summary: StoredSummary = {
      ...base,
      id: '',
      version: (previous?.version ?? 0) + 1,
      coversFromEventSeq: request.coversFromEventSeq,
      coversToEventSeq: request.coversToEventSeq,
      currentState: `${request.state.currentState}\nProvider compaction checkpoint:\n${providerSummary.slice(0, 4_000)}`.slice(0, 6_000),
      createdAt: new Date().toISOString(),
    };
    const saved = await this.summaries.save(summary);
    await this.safeEvent('compaction_completed', {
      taskId: request.taskId,
      version: saved.version,
      providerObservation: true,
    }, request);
    return saved;
  }

  private async safeEvent(type: Parameters<NonNullable<EventStore['append']>>[0]['type'], payload: Record<string, unknown>, request: CompactionRequest) {
    if (!this.events) return;
    await this.events.append({ type, payload, correlation: { taskId: request.taskId, sessionId: request.sessionId } }).catch(() => {});
  }
}
