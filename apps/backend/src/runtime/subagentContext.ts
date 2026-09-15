import type { ContextBudgetManager } from './contextBudget';
import type { EventStore } from './eventStore';
import type { TaskState } from './taskState';

export type SubagentAssignment = {
  objective: string;
  constraints?: string[];
  relevantFiles?: string[];
  expectedOutput: string;
};

export type SubagentContext = {
  assignment: SubagentAssignment;
  taskState: Pick<TaskState, 'objective' | 'constraints' | 'filesTouched' | 'currentState' | 'verificationState'>;
  prompt: string;
};

export type SubagentResult = {
  findings: string[];
  files: string[];
  decisions: string[];
  unresolved: string[];
  recommendedNextStep: string;
};

export type SubagentExecutor = (context: SubagentContext) => Promise<Partial<SubagentResult>>;

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- (none)';
}

/** Purpose-specific subagent input/output. It deliberately has no transcript field. */
export class SubagentContextManager {
  constructor(private readonly budget: ContextBudgetManager) {}

  build(state: TaskState, assignment: SubagentAssignment): SubagentContext {
    const prompt = [
      '<subagent-assignment>',
      `Objective: ${assignment.objective}`,
      `Constraints:\n${list(assignment.constraints ?? state.constraints)}`,
      `Relevant files:\n${list(assignment.relevantFiles ?? state.filesTouched)}`,
      `Expected output: ${assignment.expectedOutput}`,
      '</subagent-assignment>',
      '<selected-task-state>',
      `Objective: ${state.objective}`,
      `Current state: ${state.currentState}`,
      `Verification: ${state.verificationState.status}`,
      '</selected-task-state>',
    ].join('\n');
    if (this.budget.estimate(prompt) + this.budget.responseReserve + this.budget.safetyReserve > this.budget.capacity) {
      throw new Error('subagent assignment exceeds the configured context budget');
    }
    return {
      assignment,
      taskState: {
        objective: state.objective,
        constraints: [...state.constraints],
        filesTouched: [...state.filesTouched],
        currentState: state.currentState,
        verificationState: structuredClone(state.verificationState),
      },
      prompt,
    };
  }

  result(input: Partial<SubagentResult>): SubagentResult {
    return {
      findings: Array.isArray(input.findings) ? input.findings.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
      files: Array.isArray(input.files) ? input.files.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
      decisions: Array.isArray(input.decisions) ? input.decisions.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
      unresolved: Array.isArray(input.unresolved) ? input.unresolved.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
      recommendedNextStep: typeof input.recommendedNextStep === 'string' ? input.recommendedNextStep.slice(0, 2_000) : '',
    };
  }
}

/** Runs isolated exploratory work and returns only a structured, bounded result to the parent. */
export class SubagentManager {
  constructor(
    private readonly contexts: SubagentContextManager,
    private readonly events: EventStore,
  ) {}

  async run(
    state: TaskState,
    assignment: SubagentAssignment,
    executor: SubagentExecutor,
    correlation: { taskId: string; sessionId: string; runId?: string; parentAgentId?: string },
  ): Promise<SubagentResult> {
    const agentId = `agent-${crypto.randomUUID()}`;
    const context = this.contexts.build(state, assignment);
    await this.events.append({
      type: 'subagent_spawned',
      payload: { agentId, objective: assignment.objective, expectedOutput: assignment.expectedOutput },
      correlation: { ...correlation, agentId, parentAgentId: correlation.parentAgentId },
    });
    try {
      const result = this.contexts.result(await executor(context));
      await this.events.append({
        type: 'subagent_finished',
        payload: { agentId, findings: result.findings, files: result.files, decisions: result.decisions, unresolved: result.unresolved, recommendedNextStep: result.recommendedNextStep },
        correlation: { ...correlation, agentId, parentAgentId: correlation.parentAgentId },
      });
      return result;
    } catch (error) {
      await this.events.append({
        type: 'subagent_failed',
        payload: { agentId, message: String(error).slice(0, 500) },
        correlation: { ...correlation, agentId, parentAgentId: correlation.parentAgentId },
      }).catch(() => {});
      throw error;
    }
  }
}
