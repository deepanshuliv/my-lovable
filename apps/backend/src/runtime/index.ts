import { randomUUIDv7 } from 'bun';
import type { ModelProvider, ToolSpec } from '../providers/types';
import type { Emitter } from '../utils/events';
import { envInt } from '@repo/shared';
import { CompactionManager, createModelSummaryGenerator } from './compactionManager';
import { ContextBudgetManager, type ContextBudgetReport } from './contextBudget';
import { ContextManager, type ActiveContext } from './contextManager';
import { createEmitterEventStore, EventStore } from './eventStore';
import { HistoryRetriever, PrismaEventReader } from './historyRetriever';
import { PrismaSummaryRepository } from './summary';
import { PrismaTaskStateRepository, TaskStateManager } from './taskState';
import { PrismaToolOutputRepository, ToolOutputManager } from './toolOutput';
import { VerificationManager } from './verificationManager';

export type AgentRuntimeOptions = {
  projectId: string;
  emitter: Emitter;
  provider: ModelProvider;
};

/** Composition root for durable long-running execution for one project/session. */
export class AgentRuntime {
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly states: TaskStateManager;
  readonly events: EventStore;
  readonly summaries: PrismaSummaryRepository;
  readonly outputs: ToolOutputManager;
  readonly budget: ContextBudgetManager;
  readonly context: ContextManager;
  readonly compactor: CompactionManager;
  readonly verification: VerificationManager;

  constructor(options: AgentRuntimeOptions) {
    this.taskId = options.projectId;
    this.sessionId = options.projectId;
    this.runId = randomUUIDv7();
    this.states = new TaskStateManager(new PrismaTaskStateRepository());
    this.summaries = new PrismaSummaryRepository();
    const reader = new PrismaEventReader();
    this.events = createEmitterEventStore(options.emitter, reader);
    this.compactor = new CompactionManager(
      this.summaries,
      this.events,
      createModelSummaryGenerator(options.provider, envInt('SUMMARY_MAX_TOKENS', 2_000)),
    );
    this.outputs = new ToolOutputManager(new PrismaToolOutputRepository(), envInt('TOOL_OUTPUT_INLINE_CHARS', 12_000));
    this.budget = new ContextBudgetManager({
      modelContextCapacity: options.provider.contextWindow,
      responseReserve: envInt('AGENT_RESPONSE_RESERVE', 4_096),
      safetyReserve: envInt('AGENT_SAFETY_RESERVE', Math.ceil(options.provider.contextWindow * 0.05)),
    });
    this.context = new ContextManager(this.states, this.events, this.budget, this.compactor, new HistoryRetriever(reader));
    this.verification = new VerificationManager(this.states, this.events);
  }

  async start(objective: string): Promise<void> {
    const before = await this.states.load(this.taskId);
    await this.states.loadOrCreate(this.taskId, this.sessionId, objective);
    const state = await this.states.loadRequired(this.taskId);
    if (state.status === 'pending') await this.states.start(this.taskId, 'current-request');
    if (state.status === 'blocked') await this.states.start(this.taskId, 'current-request');
    if (!before) await this.record('task_created', { objective: state.objective });
    await this.record('agent_started', { objective: state.objective });
  }

  async buildContext(systemPrompt: string, tools: ToolSpec[], query: string, projectInstructions?: string, additionalContext?: string): Promise<ActiveContext> {
    const active = await this.context.build({
      taskId: this.taskId,
      sessionId: this.sessionId,
      systemPrompt,
      toolDefinitions: tools,
      query,
      projectInstructions,
      additionalContext,
    });
    return active;
  }

  async record(type: Parameters<EventStore['append']>[0]['type'], payload: Record<string, unknown>): Promise<void> {
    await this.events.append({
      type,
      payload,
      correlation: { taskId: this.taskId, sessionId: this.sessionId, runId: this.runId },
    });
  }

  async compactIfUseful(active: ActiveContext): Promise<boolean> {
    const minimumEvents = envInt('AGENT_COMPACTION_MIN_EVENTS', 12);
    const threshold = Number(process.env.AGENT_COMPACTION_FRACTION ?? '0.72');
    if (active.budget.utilization < threshold) return false;
    const events = await this.events.all(this.sessionId);
    if (events.length < minimumEvents) return false;
    await this.compactor.compact({
      taskId: this.taskId,
      sessionId: this.sessionId,
      state: await this.states.loadRequired(this.taskId),
      events,
      coversFromEventSeq: events[0]?.seq,
      coversToEventSeq: events.at(-1)?.seq,
    });
    return true;
  }

  async persistProviderCompaction(providerSummary: string): Promise<void> {
    const events = await this.events.all(this.sessionId);
    await this.compactor.persistProviderObservation({
      taskId: this.taskId,
      sessionId: this.sessionId,
      state: await this.states.loadRequired(this.taskId),
      events,
      coversFromEventSeq: events[0]?.seq,
      coversToEventSeq: events.at(-1)?.seq,
    }, providerSummary);
  }

  async captureToolOutput(command: string | undefined, result: string): Promise<string> {
    try {
      const bounded = await this.outputs.capture(this.taskId, this.sessionId, command, result);
      if (bounded.truncated) {
        await this.record('tool_finished', {
          outputId: bounded.outputId,
          outputTruncated: true,
          outputBytes: bounded.byteLength,
        }).catch(() => {});
      }
      return bounded.text;
    } catch (error) {
      // A storage outage must not make a tool result disappear. Keep an explicitly marked
      // bounded observation and leave the original failure visible to diagnostics.
      await this.record('tool_failed', { message: `tool output storage failed: ${String(error).slice(0, 300)}` }).catch(() => {});
      return `${result.slice(0, 8_000)}\n… [tool output shortened because durable output storage failed]`;
    }
  }

  budgetReport(active: ActiveContext): ContextBudgetReport {
    return active.budget;
  }
}

export * from './compactionManager';
export * from './contextBudget';
export * from './contextManager';
export * from './eventStore';
export * from './historyRetriever';
export * from './subagentContext';
export * from './summary';
export * from './taskState';
export * from './toolOutput';
export * from './verificationManager';
