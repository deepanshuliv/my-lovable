import { describe, expect, test } from 'bun:test';
import { CompactionManager } from './compactionManager';
import { ContextBudgetError, ContextBudgetManager } from './contextBudget';
import { ContextManager } from './contextManager';
import { InMemoryEventStore } from './eventStore';
import { HistoryRetriever } from './historyRetriever';
import { InMemorySummaryRepository, summaryFromTaskState } from './summary';
import { InMemoryTaskStateRepository, InvalidTaskStateTransitionError, TaskCompletionGuardError, TaskStateConflictError, TaskStateManager } from './taskState';
import { InMemoryToolOutputRepository, ToolOutputManager } from './toolOutput';
import { VerificationManager } from './verificationManager';
import { SubagentContextManager, SubagentManager } from './subagentContext';
import { OpenRouterProvider } from '../providers/openrouter';

function makeState() {
  return new TaskStateManager(new InMemoryTaskStateRepository());
}

async function makeRunningState(taskId = 'task-1') {
  const states = makeState();
  await states.loadOrCreate(taskId, 'session-1', 'Build a durable long-running agent harness', [
    'Keep the active context bounded',
    'Preserve task state after restart',
  ]);
  await states.start(taskId, 'architecture');
  return states;
}

describe('TaskStateManager', () => {
  test('creates, partially updates, reloads, and applies deterministic transitions', async () => {
    const repo = new InMemoryTaskStateRepository();
    const states = new TaskStateManager(repo);
    const created = await states.loadOrCreate('task', 'session', 'Ship the harness');
    expect(created.status).toBe('pending');
    const running = await states.start('task', 'phase-1');
    const updated = await states.update('task', { constraints: ['never expose secrets'], filesTouched: ['src/agent.ts'] });
    expect(updated.status).toBe('running');
    expect(updated.currentStep).toBe('phase-1');
    expect(updated.objective).toBe('Ship the harness');
    expect(updated.constraints).toEqual(['never expose secrets']);
    expect(updated.filesTouched).toEqual(['src/agent.ts']);
    expect(updated.version).toBeGreaterThan(running.version);
    const reloaded = new TaskStateManager(repo);
    expect((await reloaded.loadRequired('task')).filesTouched).toEqual(['src/agent.ts']);
  });

  test('rejects stale updates, invalid transitions, and completion without losing state', async () => {
    const repo = new InMemoryTaskStateRepository();
    const first = new TaskStateManager(repo);
    await first.loadOrCreate('task', 'session', 'Objective');
    const running = await first.start('task');
    await expect(repo.update('task', running.version - 1, running)).rejects.toBeInstanceOf(TaskStateConflictError);
    await expect(first.update('task', { status: 'completed' })).rejects.toBeInstanceOf(TaskCompletionGuardError);
    await first.update('task', { verificationState: { status: 'passed', checks: { typecheck: true }, failureCount: 0 } });
    await first.update('task', { status: 'completed' });
    await expect(first.update('task', { status: 'running' })).rejects.toBeInstanceOf(InvalidTaskStateTransitionError);
    const blockedRepo = new InMemoryTaskStateRepository();
    const blocked = new TaskStateManager(blockedRepo);
    await blocked.loadOrCreate('blocked', 'session', 'Objective');
    await blocked.update('blocked', { status: 'blocked', blockers: ['waiting for input'] });
    await blocked.update('blocked', { status: 'running' });
    await blocked.update('blocked', { status: 'failed', currentState: 'failed for test' });
    await expect(blocked.update('blocked', { status: 'running' })).rejects.toBeInstanceOf(InvalidTaskStateTransitionError);
  });
});

describe('ContextBudgetManager', () => {
  test('accounts for categories, exact limits, large schemas, and reserves', () => {
    const budget = new ContextBudgetManager({ modelContextCapacity: 1_000, responseReserve: 100, safetyReserve: 50 });
    expect(budget.report({ systemPrompt: 100, toolDefinitions: 100, taskState: 100, projectInstructions: 100, compactedSummary: 100, recentEvents: 100, retrievedHistory: 100, currentInput: 100 }).fits).toBe(true);
    expect(budget.report({ systemPrompt: 100, toolDefinitions: 100, taskState: 100, projectInstructions: 100, compactedSummary: 100, recentEvents: 100, retrievedHistory: 100, currentInput: 250 }).fits).toBe(false);
    expect(() => new ContextBudgetManager({ modelContextCapacity: 100, responseReserve: 90, safetyReserve: 20 })).toThrow(ContextBudgetError);
    expect(budget.shouldCompact(800, 100)).toBe(true);
    expect(budget.fitOptionalText('x'.repeat(10_000), 20).length).toBeLessThan(200);
  });
});

describe('ToolOutputManager', () => {
  test('keeps small output inline and externalizes huge stdout/stderr with retrieval', async () => {
    const repository = new InMemoryToolOutputRepository();
    const manager = new ToolOutputManager(repository, 100);
    const small = await manager.capture('task', 'session', 'echo ok', 'ok');
    expect(small.truncated).toBe(false);
    const huge = `${'normal output\n'.repeat(70_000)}ERROR: important failure\n${'stderr\n'.repeat(20_000)}`;
    const result = await manager.capture('task', 'session', 'npm run build', { stdout: huge, stderr: 'TypeError: broken', exitCode: 1 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(9_000);
    expect(result.text).toContain('output_id=');
    expect(result.text).toContain('important failure');
    expect(repository.size()).toBe(1);
    expect((await manager.retrieve(result.outputId!)).length).toBeGreaterThan(1_000_000);
    const tenMegabytes = await manager.capture('task', 'session', 'large command', 'y'.repeat(10_000_000));
    expect(tenMegabytes.truncated).toBe(true);
    expect(tenMegabytes.text.length).toBeLessThan(9_000);
    expect(repository.size()).toBe(2);
  });
});

describe('HistoryRetriever and ContextManager', () => {
  test('retrieves an old decision with provenance and keeps the active view bounded', async () => {
    const states = await makeRunningState();
    const events = new InMemoryEventStore();
    await events.append({ type: 'tool_finished', payload: { decision: 'Do not modify middleware.ts because authentication is generated elsewhere.' }, correlation: { taskId: 'task-1', sessionId: 'session-1' } });
    for (let index = 0; index < 100; index++) {
      await events.append({ type: 'tool_finished', payload: { output: `unrelated iteration ${index} ${'noise '.repeat(40)}` }, correlation: { taskId: 'task-1', sessionId: 'session-1' } });
    }
    const retriever = new HistoryRetriever(events);
    const found = await retriever.search('middleware authentication generated', { sessionId: 'session-1', taskId: 'task-1', maxTokens: 400, limit: 3 });
    expect(found).toHaveLength(1);
    expect(found[0]?.excerpt).toContain('middleware.ts');
    expect(found[0]?.provenance.sessionId).toBe('session-1');

    const summaries = new InMemorySummaryRepository();
    const compactor = new CompactionManager(summaries, events, async ({ state }) => summaryFromTaskState(state));
    await compactor.compact({ taskId: 'task-1', sessionId: 'session-1', state: await states.loadRequired('task-1'), events: await events.all('session-1'), coversFromEventSeq: 1, coversToEventSeq: 101 });
    const manager = new ContextManager(
      states,
      events,
      new ContextBudgetManager({ modelContextCapacity: 3_000, responseReserve: 200, safetyReserve: 100 }),
      compactor,
      retriever,
    );
    const active = await manager.build({ taskId: 'task-1', sessionId: 'session-1', systemPrompt: 'You are an agent.', toolDefinitions: [{ name: 'read_file', parameters: {} }], query: 'continue with middleware authentication', additionalContext: `diagnostics ${'x '.repeat(20_000)}` });
    expect(active.opening).toContain('Build a durable long-running agent harness');
    expect(active.opening).toContain('current-request');
    expect(active.budget.fits).toBe(true);
    expect(active.budget.totalReserved).toBeLessThanOrEqual(3_000);
  });
});

describe('CompactionManager and VerificationManager', () => {
  test('preserves previous summaries on malformed generation and survives repeated cycles', async () => {
    const states = await makeRunningState('compact-task');
    const events = new InMemoryEventStore();
    const summaries = new InMemorySummaryRepository();
    let calls = 0;
    const compactor = new CompactionManager(summaries, events, async ({ state }) => {
      calls++;
      if (calls === 2) throw new Error('provider timeout');
      if (calls === 3) return { malformed: true };
      if (calls === 4) return { ...summaryFromTaskState(state), completedWork: Array.from({ length: 100 }, (_, index) => `${index} ${'very detailed '.repeat(100)}`) };
      return summaryFromTaskState(state);
    });
    const state = await states.update('compact-task', { decisions: [{ id: 'decision-1', decision: 'Keep SQLite truth in the existing persistence layer', createdAt: new Date().toISOString() }], failedAttempts: [{ approach: 'unbounded history', reason: 'exceeded budget', createdAt: new Date().toISOString() }] });
    await events.append({ type: 'tool_failed', payload: { message: 'failed approach' }, correlation: { taskId: 'compact-task', sessionId: 'session-1' } });
    const first = await compactor.compact({ taskId: 'compact-task', sessionId: 'session-1', state, events: await events.all('session-1'), coversFromEventSeq: 1, coversToEventSeq: 1 });
    const second = await compactor.compact({ taskId: 'compact-task', sessionId: 'session-1', state: await states.loadRequired('compact-task'), events: await events.all('session-1'), coversFromEventSeq: 1, coversToEventSeq: 4 });
    expect(first.summary.version).toBe(1);
    expect(second.usedFallback).toBe(true);
    expect(second.summary.version).toBe(2);
    expect(second.summary.decisions[0]?.decision).toContain('SQLite');
    expect(summaries.count('compact-task')).toBe(2);
    const third = await compactor.compact({ taskId: 'compact-task', sessionId: 'session-1', state: await states.loadRequired('compact-task'), events: await events.all('session-1'), coversFromEventSeq: 1, coversToEventSeq: 7 });
    expect(third.usedFallback).toBe(true);
    expect(third.summary.version).toBe(3);
    expect(JSON.stringify(third.summary).length).toBeLessThan(30_000);
    expect(summaries.count('compact-task')).toBe(3);
    const fourth = await compactor.compact({ taskId: 'compact-task', sessionId: 'session-1', state: await states.loadRequired('compact-task'), events: await events.all('session-1'), coversFromEventSeq: 1, coversToEventSeq: 8 });
    expect(JSON.stringify(fourth.summary).length).toBeLessThan(30_000);
    expect(events.count()).toBeGreaterThan(0);
  });

  test('verification failure remains visible and completion requires a passing run', async () => {
    const states = await makeRunningState('verify-task');
    const events = new InMemoryEventStore();
    const verification = new VerificationManager(states, events);
    await verification.verify('verify-task', 'session-1', async () => ({ typecheckPassed: false, typecheckOutput: 'TypeScript error', runtimeErrors: [], ok: false }));
    expect((await states.loadRequired('verify-task')).verificationState.status).toBe('failed');
    await expect(verification.complete('verify-task')).rejects.toThrow('before verification passes');
    await verification.verify('verify-task', 'session-1', async () => ({ typecheckPassed: true, typecheckOutput: '', runtimeErrors: [], ok: true }));
    await verification.complete('verify-task');
    expect((await states.loadRequired('verify-task')).status).toBe('completed');
    expect(events.eventsFor('session-1').some((event) => event.type === 'verification_failed')).toBe(true);
    expect(events.eventsFor('session-1').some((event) => event.type === 'verification_passed')).toBe(true);
  });
});

describe('provider request invariant', () => {
  test('does not call the provider when mandatory context cannot fit after compaction', async () => {
    const provider = new OpenRouterProvider('test-model', 'test-key', 'http://unused', 500);
    const budget = new ContextBudgetManager({ modelContextCapacity: 500, responseReserve: 100, safetyReserve: 50 });
    let requests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests++;
      throw new Error('network must not be called');
    }) as unknown as typeof fetch;
    try {
      const events = [];
      for await (const event of provider.run({ systemPrompt: 'system', tools: [{ name: 'tool', description: 'tool', parameters: {} }], opening: 'x'.repeat(20_000), maxTurns: 1, isCancelled: () => false, contextBudget: budget, executeTool: async () => '' })) events.push(event);
      expect(requests).toBe(0);
      expect(events.some((event) => event.type === 'error' && event.message.includes('context budget'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('SubagentContextManager', () => {
  test('passes selected state and returns bounded structured results without a transcript', async () => {
    const states = await makeRunningState('subagent-task');
    const state = await states.loadRequired('subagent-task');
    const manager = new SubagentContextManager(new ContextBudgetManager({ modelContextCapacity: 2_000, responseReserve: 200, safetyReserve: 100 }));
    const context = manager.build(state, { objective: 'Inspect auth flow', relevantFiles: ['src/auth.ts'], expectedOutput: 'findings and next step' });
    expect(context.prompt).toContain('src/auth.ts');
    expect('transcript' in context).toBe(false);
    const result = manager.result({ findings: ['auth is generated'], files: ['src/auth.ts'], recommendedNextStep: 'do not edit middleware' });
    expect(result.findings).toHaveLength(1);
  });

  test('many subagents produce bounded parent results with parent/child event correlation', async () => {
    const states = await makeRunningState('many-subagents');
    const state = await states.loadRequired('many-subagents');
    const events = new InMemoryEventStore();
    const contexts = new SubagentContextManager(new ContextBudgetManager({ modelContextCapacity: 2_000, responseReserve: 200, safetyReserve: 100 }));
    const manager = new SubagentManager(contexts, events);
    for (let index = 0; index < 24; index++) {
      await manager.run(state, { objective: `research ${index}`, relevantFiles: ['src/auth.ts'], expectedOutput: 'short structured findings' }, async () => ({ findings: [`finding ${index}`], files: ['src/auth.ts'], recommendedNextStep: 'continue' }), { taskId: 'many-subagents', sessionId: 'session-1', runId: 'parent-run', parentAgentId: 'coordinator' });
    }
    const childEvents = events.eventsFor('session-1').filter((event) => event.type === 'subagent_finished');
    expect(childEvents).toHaveLength(24);
    expect(childEvents.every((event) => event.correlation.parentAgentId === 'coordinator')).toBe(true);
    expect(JSON.stringify(childEvents)).not.toContain('transcript');
  });
});

describe('forced small-context long-running integration', () => {
  test('keeps hundreds of events outside the active view, compacts repeatedly, retrieves history, and resumes after runtime replacement', async () => {
    const stateRepository = new InMemoryTaskStateRepository();
    const summaryRepository = new InMemorySummaryRepository();
    const durableEvents = new InMemoryEventStore();
    const firstRuntimeStates = new TaskStateManager(stateRepository);
    await firstRuntimeStates.loadOrCreate('long-task', 'long-session', 'Complete a long coding task without losing the objective');
    await firstRuntimeStates.start('long-task', 'planning');
    await firstRuntimeStates.update('long-task', {
      constraints: ['never send complete history to the model', 'preserve failed attempts'],
      decisions: [{ id: 'early-decision', decision: 'Do not modify middleware.ts because authentication is generated elsewhere.', createdAt: new Date().toISOString() }],
      nextSteps: ['implement', 'verify', 'resume'],
    });
    const generator = async ({ state }: { state: Awaited<ReturnType<TaskStateManager['loadRequired']>> }) => summaryFromTaskState(state);
    const budget = new ContextBudgetManager({ modelContextCapacity: 1_800, responseReserve: 120, safetyReserve: 80 });
    let compactions = 0;

    for (let index = 0; index < 300; index++) {
      await durableEvents.append({
        type: index % 17 === 0 ? 'tool_failed' : 'tool_finished',
        payload: { iteration: index, output: `${index % 17 === 0 ? 'ERROR failed approach' : 'completed'} ${'detail '.repeat(30)}` },
        correlation: { taskId: 'long-task', sessionId: 'long-session', runId: 'run-1' },
      });
      if (index % 20 === 19) {
        const compactor = new CompactionManager(summaryRepository, durableEvents, generator);
        await compactor.compact({ taskId: 'long-task', sessionId: 'long-session', state: await firstRuntimeStates.loadRequired('long-task'), events: await durableEvents.all('long-session'), coversFromEventSeq: 1, coversToEventSeq: index + 1 });
        compactions++;
      }
    }
    await firstRuntimeStates.update('long-task', { filesTouched: ['src/agent.ts', 'src/runtime.ts'], currentState: 'Repairing after a verification failure.', verificationState: { status: 'failed', checks: { typecheck: false }, lastOutput: 'type error', failureCount: 1 } });

    // Process death: only the durable repositories survive; every runtime-facing manager is new.
    const resumedStates = new TaskStateManager(stateRepository);
    const resumedEvents = new InMemoryEventStore();
    for (const event of durableEvents.eventsFor('long-session')) await resumedEvents.append({ type: event.type, payload: event.payload, correlation: event.correlation });
    const resumedSummaries = new InMemorySummaryRepository();
    const latestSummary = await summaryRepository.latest('long-task');
    if (latestSummary) await resumedSummaries.save(latestSummary);
    const resumedCompactor = new CompactionManager(resumedSummaries, resumedEvents, generator);
    const resumedRetriever = new HistoryRetriever(resumedEvents);
    const resumedContext = new ContextManager(resumedStates, resumedEvents, budget, resumedCompactor, resumedRetriever);
    const active = await resumedContext.build({ taskId: 'long-task', sessionId: 'long-session', systemPrompt: 'small context agent', toolDefinitions: [{ name: 'bash_tool', description: 'run', parameters: {} }], query: 'continue with middleware authentication' });
    const found = await resumedRetriever.search('middleware authentication generated elsewhere', { sessionId: 'long-session', taskId: 'long-task', limit: 2 });
    expect(compactions).toBe(15);
    expect(summaryRepository.count('long-task')).toBe(15);
    expect(durableEvents.count()).toBeGreaterThan(300);
    expect(active.budget.fits).toBe(true);
    expect(active.budget.totalReserved).toBeLessThanOrEqual(1_800);
    expect(active.opening).toContain('Complete a long coding task');
    expect(found.length).toBeGreaterThan(0);
    expect((await resumedStates.loadRequired('long-task')).verificationState.status).toBe('failed');
    console.log(`[stress] workEvents=300 compactions=${compactions} durableEvents=${durableEvents.count()} maxContextTokens=${active.budget.totalReserved} contextCapacity=1800`);
  });
});
