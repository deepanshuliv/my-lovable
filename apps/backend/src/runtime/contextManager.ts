import type { EventStore, ExecutionEvent } from './eventStore';
import type { HistoryRetriever, RetrievalResult } from './historyRetriever';
import { summaryText, type StoredSummary } from './summary';
import type { TaskState, TaskStateManager } from './taskState';
import { ContextBudgetManager, type ContextBudgetReport } from './contextBudget';

export type ContextBuildRequest = {
  taskId: string;
  sessionId: string;
  systemPrompt: string;
  toolDefinitions: unknown;
  query: string;
  projectInstructions?: string;
  additionalContext?: string;
  retrievedQuery?: string;
  recentEventLimit?: number;
};

export type ActiveContext = {
  opening: string;
  state: TaskState;
  summary: StoredSummary | null;
  recentEvents: ExecutionEvent[];
  retrieved: RetrievalResult[];
  budget: ContextBudgetReport;
};

function eventExcerpt(event: ExecutionEvent): string {
  const raw = JSON.stringify(event.payload);
  return `- #${event.seq} ${event.type}: ${raw.length > 700 ? `${raw.slice(0, 700)}…` : raw}`;
}

/** Builds a bounded active view instead of replaying a complete conversation. */
export class ContextManager {
  constructor(
    private readonly states: TaskStateManager,
    private readonly events: EventStore,
    private readonly budgetManager: ContextBudgetManager,
    private readonly summaries?: { latest(taskId: string): Promise<StoredSummary | null> },
    private readonly retriever?: HistoryRetriever,
  ) {}

  async build(request: ContextBuildRequest): Promise<ActiveContext> {
    const state = await this.states.loadRequired(request.taskId);
    const summary = this.summaries ? await this.summaries.latest(request.taskId) : null;
    const recentEvents = await this.events.recent(request.sessionId, request.recentEventLimit ?? 12);
    const retrieved = this.retriever && (request.retrievedQuery ?? request.query).trim()
      ? await this.retriever.search(request.retrievedQuery ?? request.query, {
          sessionId: request.sessionId,
          taskId: request.taskId,
          limit: 6,
          maxTokens: 1_200,
        })
      : [];

    const stateText = `<task-state>\n${JSON.stringify(state)}\n</task-state>`;
    const projectText = request.projectInstructions?.trim()
      ? `<project-instructions>\n${request.projectInstructions.trim()}\n</project-instructions>`
      : '';
    const additionalText = request.additionalContext?.trim()
      ? `<additional-context>\n${request.additionalContext.trim()}\n</additional-context>`
      : '';
    const currentText = `<current-request>\n${request.query}\n</current-request>`;
    const mandatoryText = [stateText, projectText, currentText].filter(Boolean).join('\n\n');
    const systemTokens = this.budgetManager.estimate(request.systemPrompt);
    const toolTokens = this.budgetManager.estimateJson(request.toolDefinitions);
    const mandatoryCategories = {
      systemPrompt: systemTokens,
      toolDefinitions: toolTokens,
      taskState: this.budgetManager.estimate(stateText),
      projectInstructions: this.budgetManager.estimate(projectText),
      compactedSummary: 0,
      recentEvents: 0,
      retrievedHistory: 0,
      currentInput: this.budgetManager.estimate(currentText),
    };
    const mandatoryReport = this.budgetManager.report(mandatoryCategories);
    if (!mandatoryReport.fits) {
      throw new Error(
        `mandatory active context exceeds safe budget (${mandatoryReport.totalReserved}/${mandatoryReport.capacity}); ` +
          'increase the model context or reduce mandatory instructions',
      );
    }

    const optionalBudget = this.budgetManager.inputCapacity() -
      (mandatoryReport.inputTokens - mandatoryReport.toolDefinitions);
    let remaining = Math.max(0, optionalBudget);
    const optionalParts: string[] = [];
    let summaryTokens = 0;
    let additionalTokens = 0;
    let recentTokens = 0;
    let retrievedTokens = 0;

    if (summary) {
      const text = `<latest-summary version="${summary.version}">\n${summaryText(summary)}\n</latest-summary>`;
      const allowed = Math.min(remaining, this.budgetManager.estimate(text));
      if (allowed > 0) {
        const fitted = this.budgetManager.fitOptionalText(text, allowed);
        summaryTokens = this.budgetManager.estimate(fitted);
        optionalParts.push(fitted);
        remaining -= summaryTokens;
      }
    }

    if (additionalText && remaining > 0) {
      const fitted = this.budgetManager.fitOptionalText(additionalText, remaining);
      additionalTokens = this.budgetManager.estimate(fitted);
      optionalParts.push(fitted);
      remaining -= additionalTokens;
    }

    if (recentEvents.length > 0 && remaining > 0) {
      const text = `<recent-execution-events>\n${recentEvents.map(eventExcerpt).join('\n')}\n</recent-execution-events>`;
      const fitted = this.budgetManager.fitOptionalText(text, remaining);
      recentTokens = this.budgetManager.estimate(fitted);
      optionalParts.push(fitted);
      remaining -= recentTokens;
    }

    if (retrieved.length > 0 && remaining > 0) {
      const text = `<retrieved-history>\n${retrieved.map((item) => `- [${item.type} #${item.seq}] ${item.excerpt}`).join('\n')}\n</retrieved-history>`;
      const fitted = this.budgetManager.fitOptionalText(text, remaining);
      retrievedTokens = this.budgetManager.estimate(fitted);
      optionalParts.push(fitted);
    }

    const opening = [mandatoryText, ...optionalParts].filter(Boolean).join('\n\n');
    let budget = this.budgetManager.report({
      ...mandatoryCategories,
      compactedSummary: summaryTokens,
      recentEvents: additionalTokens + recentTokens,
      retrievedHistory: retrievedTokens,
    });
    // Category estimates intentionally round each section independently. If that rounding
    // leaves a few tokens over the hard invariant, discard the lowest-priority optional
    // section before returning; mandatory task information is never dropped.
    while (!budget.fits && optionalParts.length > 0) {
      const removed = optionalParts.pop() ?? '';
      if (removed.startsWith('<retrieved-history>')) retrievedTokens = 0;
      else if (removed.startsWith('<recent-execution-events>')) recentTokens = 0;
      else if (removed.startsWith('<additional-context>')) additionalTokens = 0;
      else summaryTokens = 0;
      budget = this.budgetManager.report({
        ...mandatoryCategories,
        compactedSummary: summaryTokens,
        recentEvents: additionalTokens + recentTokens,
        retrievedHistory: retrievedTokens,
      });
    }
    this.budgetManager.assertFits(budget);
    return { opening, state, summary, recentEvents, retrieved, budget };
  }
}
