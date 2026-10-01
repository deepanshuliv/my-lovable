import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { prisma } from '../packages/db';
import { CASES, type EvalCase } from './cases';
import type { GradeResult, StreamEvent, Trial } from './graders';
import { docker, EVAL_IMAGE, execIn, removeEvalContainers, WORKSPACE } from './support/docker';

const ROOT = resolve(import.meta.dir, '..');
const { values } = parseArgs({
  options: {
    cases: { type: 'string' },
    level: { type: 'string' },
    model: { type: 'string' },
    fallbacks: { type: 'string' },
    'allow-paid': { type: 'boolean', default: false },
    'keep-failed': { type: 'boolean', default: false },
    'daily-requests': { type: 'string', default: '950' },
    'max-total': { type: 'string', default: '0.6' },
    'min-remaining': { type: 'string', default: '0.15' },
    'turn-timeout': { type: 'string', default: '600' },
    trials: { type: 'string', default: '2' },
    budget: { type: 'string', default: '1' },
    port: { type: 'string', default: '8790' },
    'rebuild-image': { type: 'boolean', default: false },
  },
});

const API = `http://127.0.0.1:${values.port}`;
const TRIALS = Math.max(1, Number(values.trials));
const BUDGET_MICROS = Math.round(Number(values.budget) * 1_000_000);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const EVAL_MODEL = values.model || process.env.OPENROUTER_MODEL || '';
const EVAL_FALLBACKS = (values.fallbacks ?? process.env.OPENROUTER_FALLBACK_MODELS ?? '')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
if (!/^https:\/\/openrouter\.ai\//.test(BASE_URL) && process.env.EVAL_ALLOW_CUSTOM_BASE_URL !== '1') {
  console.error(`refusing to run: OPENROUTER_BASE_URL is ${BASE_URL}, not OpenRouter (a test harness setting leaked into this shell?). Unset it or set EVAL_ALLOW_CUSTOM_BASE_URL=1.`);
  process.exit(1);
}
const paidModels = [EVAL_MODEL, ...EVAL_FALLBACKS].filter((model) => !model.endsWith(':free'));
if (!values['allow-paid'] && paidModels.length > 0) {
  console.error(`refusing to run with paid model(s) ${paidModels.join(', ') || '(none set)'}; use :free models or pass --allow-paid.`);
  process.exit(1);
}

const MAX_TOTAL_MICROS = Math.round(Number(values['max-total']) * 1_000_000);
const MIN_REMAINING_USD = Number(values['min-remaining']);
const TURN_TIMEOUT_MS = Number(values['turn-timeout']) * 1000;
const selected = CASES.filter(
  (c) =>
    (!values.cases || values.cases.split(',').includes(c.id)) &&
    (!values.level || values.level.split(',').map(Number).includes(c.level)),
);

const DAILY_REQUEST_CAP = Number(values['daily-requests']);
const requestLedgerPath = () => resolve(ROOT, `evals/results/requests-${new Date().toISOString().slice(0, 10)}.json`);

function requestsToday(): number {
  try {
    return Number(JSON.parse(readFileSync(requestLedgerPath(), 'utf8')).requests ?? 0);
  } catch {
    return 0;
  }
}

function addRequestsToday(count: number) {
  mkdirSync(resolve(ROOT, 'evals/results'), { recursive: true });
  writeFileSync(requestLedgerPath(), JSON.stringify({ requests: requestsToday() + count, updatedAt: new Date().toISOString() }));
}

function requestsFor(projectId: string): number {
  try {
    const log = readFileSync(resolve(ROOT, `evals/results/${RUN_ID}.backend.log`), 'utf8');
    let total = 0;
    for (const match of log.matchAll(new RegExp(`\\[TURN_REQUESTS\\] ${projectId} (\\d+)`, 'g'))) total += Number(match[1]);
    return total;
  } catch {
    return 0;
  }
}

const ESTIMATED_REQUESTS_PER_TRIAL: Record<number, number> = { 1: 25, 2: 45, 3: 100 };

function ledgerMicros(): number {
  const dir = resolve(ROOT, 'evals/results');
  let total = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      total += Number(JSON.parse(readFileSync(resolve(dir, file), 'utf8')).spentMicros ?? 0);
    } catch {}
  }
  return total;
}

async function openRouterRemaining(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
    const data = (await response.json()) as { data?: { limit_remaining?: number | null } };
    return data.data?.limit_remaining ?? null;
  } catch {
    return null;
  }
}

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  console.error('DATABASE_URL and REDIS_URL must point at a running Postgres and Redis.');
  process.exit(1);
}
if (selected.length === 0) {
  console.error(`no cases matched; available: ${CASES.map((c) => c.id).join(', ')}`);
  process.exit(1);
}

async function ensureImage() {
  const inspect = await docker(['image', 'inspect', EVAL_IMAGE]);
  if (inspect.exitCode === 0 && !values['rebuild-image']) return;
  console.log(`building ${EVAL_IMAGE} (one-time, installs the template's dependencies)…`);
  const build = Bun.spawn(['docker', 'build', '-f', 'evals/sandbox.Dockerfile', '-t', EVAL_IMAGE, '.'], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await build.exited) !== 0) throw new Error('eval image build failed');
}

const serviceEnv = {
  ...process.env,
  MODEL_PROVIDER: 'openrouter',
  OPENROUTER_MODEL: EVAL_MODEL,
  OPENROUTER_FALLBACK_MODELS: EVAL_FALLBACKS.join(','),
  EVAL_JUDGE_MODEL: process.env.EVAL_JUDGE_MODEL || EVAL_MODEL,
  PREVIEW_PROXY_URL: 'off',
  PORT: values.port!,
  BACKEND_ID: 'eval-backend',
  WORKER_ID: 'eval-worker',
  CLERK_SECRET_KEY: 'eval-mock',
  DAYTONA_API_KEY: 'eval-docker',
  TEMPLATE_SOURCE: 'snapshot',
  TEMPLATE_SNAPSHOT: 'eval',
  PLATFORM_CREDIT_MICROS: String(BUDGET_MICROS * 10),
  R2_ACCOUNT_ID: '',
  R2_BUCKET: '',
  QUESTION_TIMEOUT_MS: '120000',
  SNAPSHOT_EVERY_N_EVENTS: '1000000',
};

function startServices() {
  const logs = resolve(ROOT, 'evals/results');
  mkdirSync(logs, { recursive: true });
  const backend = Bun.spawn(['bun', '--preload', './evals/support/preload.ts', 'apps/backend/index.ts'], {
    cwd: ROOT,
    env: serviceEnv,
    stdout: Bun.file(`${logs}/${RUN_ID}.backend.log`),
    stderr: Bun.file(`${logs}/${RUN_ID}.backend.err.log`),
  });
  const worker = Bun.spawn(['bun', 'apps/worker/index.ts'], {
    cwd: ROOT,
    env: serviceEnv,
    stdout: Bun.file(`${logs}/${RUN_ID}.worker.log`),
    stderr: 'ignore',
  });
  return () => {
    backend.kill();
    worker.kill();
  };
}

async function waitForBackend() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) return (await response.json()) as { model: { provider: string; model: string } };
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error('backend did not start; see evals/results/*.backend.err.log');
}

async function api(user: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, json };
}

async function stream(
  user: string,
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => Promise<void>,
  timeoutMs = TURN_TIMEOUT_MS,
): Promise<StreamEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events: StreamEvent[] = [];
  try {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user}` },
      body: JSON.stringify(body),
      signal: controller.signal,
      timeout: false,
    } as RequestInit);
    if (!response.ok || !response.body) {
      return [{ type: 'error', message: `HTTP ${response.status}: ${await response.text()}` }];
    }
    await readEvents(response.body, events, onEvent);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    events.push({ type: 'error', message: `eval turn exceeded ${Math.round(timeoutMs / 1000)}s` });
    await fetch(`${API}${path.replace(/^\/chat\/([^/]+)$/, '/chat/$1/cancel')}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user}` },
    }).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
  return events;
}

async function readEvents(
  body: ReadableStream<Uint8Array>,
  events: StreamEvent[],
  onEvent: (event: StreamEvent) => Promise<void>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!frame.startsWith('data: ')) continue;
      const event = JSON.parse(frame.slice(6)) as StreamEvent;
      events.push(event);
      await onEvent(event);
    }
  }
}

async function sandboxIdFor(projectId: string): Promise<string | null> {
  const row = await prisma.project.findUnique({ where: { id: projectId }, select: { sandboxId: true } });
  return row?.sandboxId ?? null;
}

async function consumed(user: string): Promise<number> {
  const response = await api(user, 'GET', '/me/credits');
  return response.json?.credits?.consumedMicros ?? 0;
}

function toolResultsOf(events: StreamEvent[]) {
  return events.filter((e) => e.type === 'tool_result').map((e) => ({ name: e.name, result: String(e.result ?? ''), isError: Boolean(e.isError) }));
}

function summarise(turnEvents: StreamEvent[][], base: Omit<Trial, 'events' | 'finalText' | 'toolCalls' | 'toolResults' | 'questions' | 'secretsRequired' | 'verification' | 'errors' | 'turns'>): Trial {
  const events = turnEvents.flat();
  const lastTurn = turnEvents.at(-1) ?? [];
  const finals = lastTurn.filter((e) => e.type === 'text' && e.final).map((e) => String(e.text));
  const deltas = lastTurn.filter((e) => e.type === 'text' && !e.final).map((e) => String(e.text));
  const verification = events.filter((e) => e.type === 'verification').at(-1);
  return {
    ...base,
    events,
    finalText: (finals.length > 0 ? finals.join('\n') : deltas.join('')).trim(),
    toolCalls: events.filter((e) => e.type === 'tool_call').map((e) => ({ name: e.name, args: e.args ?? {} })),
    toolResults: toolResultsOf(events),
    turns: turnEvents.map((turn) => ({ events: turn, toolResults: toolResultsOf(turn) })),
    questions: events.filter((e) => e.type === 'question').map((e) => ({ question: String(e.question ?? ''), options: e.options })),
    secretsRequired: events.filter((e) => e.type === 'secrets_required').flatMap((e) => e.secrets ?? []),
    verification: verification ? { ok: Boolean(verification.ok), typecheckPassed: verification.typecheckPassed ?? null } : null,
    errors: events.filter((e) => e.type === 'error').map((e) => String(e.message)),
  };
}

type TrialReport = {
  caseId: string;
  trial: number;
  pass: boolean;
  grades: (GradeResult & { name: string; required: boolean })[];
  costMicros: number;
  durationMs: number;
  toolCalls: number;
  questions: number;
  requests: number;
  finalText: string;
  verificationProblems: string[];
};

async function runTrial(evalCase: EvalCase, trialIndex: number): Promise<TrialReport> {
  const user = `eval_${RUN_ID}_${evalCase.id}_${trialIndex}`;
  const started = Date.now();
  const created = await api(user, 'POST', '/projects', {});
  const projectId = created.json.projectId as string;
  const seeded: Record<string, string> = {};

  const answers = [...(evalCase.answers ?? ['Use your best judgement and keep it simple.'])];
  const ctx = {
    api: (method: string, path: string, body?: unknown) => api(user, method, `/projects/${projectId}${path}`, body),
    wake: async () => {
      await stream(user, `/projects/${projectId}/wake`, {}, async () => {});
    },
    exec: async (command: string) => {
      const sandboxId = await sandboxIdFor(projectId);
      if (!sandboxId) throw new Error('setup needs a sandbox; call wake() first');
      const result = await execIn(sandboxId, command, { cwd: `${WORKSPACE}/app` });
      return { exitCode: result.exitCode, output: result.output };
    },
    seed: (key: string, value: string) => {
      seeded[key] = value;
    },
  };

  const before = await consumed(user);
  let keep = false;
  try {
    if (evalCase.setup) await evalCase.setup(ctx);

    const turns = evalCase.turns ?? [{ prompt: evalCase.prompt ?? '', mode: evalCase.mode }];
    const turnEvents: StreamEvent[][] = [];
    for (const turn of turns) {
      const events = await stream(user, `/chat/${projectId}`, { query: turn.prompt, mode: turn.mode ?? 'build' }, async (event) => {
        if (event.type !== 'question') return;
        const answer = answers.shift() ?? 'Use your best judgement and keep it simple.';
        await api(user, 'POST', `/answer/${event.questionId}`, { answer });
      });
      turnEvents.push(events);
      if (events.at(-1)?.type !== 'done') break;
    }

    const trial = summarise(turnEvents, {
      caseId: evalCase.id,
      projectId,
      userId: user,
      sandboxId: await sandboxIdFor(projectId),
      costMicros: 0,
      durationMs: Date.now() - started,
      seeded,
    });
    trial.costMicros = (await consumed(user)) - before;

    const grades: TrialReport['grades'] = [];
    for (const grader of evalCase.graders) {
      let result: GradeResult;
      try {
        result = await grader.check(trial);
      } catch (error) {
        result = { pass: false, detail: `grader crashed: ${String(error).slice(0, 200)}` };
      }
      grades.push({ name: grader.name, required: grader.required !== false, ...result });
    }

    const passed = grades.every((g) => g.pass || !g.required);
    if (!passed && values['keep-failed'] && trial.sandboxId) {
      keep = true;
      await docker(['update', '--restart', 'no', trial.sandboxId]).catch(() => {});
      console.log(`    kept for inspection: docker exec -it ${trial.sandboxId} bash  (app in ${WORKSPACE}/app)`);
    }
    return {
      caseId: evalCase.id,
      trial: trialIndex,
      pass: passed,
      grades,
      costMicros: trial.costMicros,
      durationMs: Date.now() - started,
      toolCalls: trial.toolCalls.length,
      questions: trial.questions.length,
      requests: requestsFor(projectId),
      finalText: trial.finalText.slice(0, 2_000),
      verificationProblems: (() => {
        const last = trial.events.filter((e) => e.type === 'verification').at(-1);
        if (!last || last.ok) return [];
        return [
          ...(last.typecheckPassed === false ? [String(last.typecheckOutput ?? '').slice(0, 600)] : []),
          ...((last.runtimeErrors ?? []) as string[]).slice(0, 10),
        ];
      })(),
    };
  } finally {
    if (!keep) await api(user, 'DELETE', `/projects/${projectId}`).catch(() => {});
  }
}

function printTrial(report: TrialReport) {
  console.log(`  trial ${report.trial + 1}: ${report.pass ? 'PASS' : 'FAIL'}  $${(report.costMicros / 1e6).toFixed(4)}  ${(report.durationMs / 1000).toFixed(0)}s  ${report.requests} requests  ${report.toolCalls} tools  ${report.questions} questions`);
  for (const problem of report.verificationProblems.slice(0, 4)) console.log(`    ↳ verification: ${problem.replace(/\s+/g, ' ').slice(0, 200)}`);
  for (const grade of report.grades) {
    if (grade.pass && !grade.detail?.startsWith('skipped')) continue;
    const tag = grade.pass ? 'skip' : grade.required ? 'FAIL' : 'warn';
    console.log(`    [${tag}] ${grade.name}${grade.detail ? ` — ${grade.detail.replace(/\s+/g, ' ').slice(0, 220)}` : ''}`);
  }
}

const priorSpend = ledgerMicros();
const allFree = paidModels.length === 0;
if (!allFree && priorSpend >= MAX_TOTAL_MICROS) {
  console.error(`eval ledger already at $${(priorSpend / 1e6).toFixed(4)}, at or above --max-total $${(MAX_TOTAL_MICROS / 1e6).toFixed(2)}; refusing to run.`);
  process.exit(1);
}
const remaining = await openRouterRemaining();
if (remaining !== null && remaining < MIN_REMAINING_USD) {
  console.error(`OpenRouter key has only $${remaining.toFixed(4)} left (< --min-remaining $${MIN_REMAINING_USD}); refusing to run.`);
  process.exit(1);
}
const runBudget = allFree ? BUDGET_MICROS : Math.min(BUDGET_MICROS, MAX_TOTAL_MICROS - priorSpend);

await ensureImage();
if (!values['keep-failed']) await removeEvalContainers();
const stop = startServices();
const reports: TrialReport[] = [];
let spent = 0;

try {
  const health = await waitForBackend();
  console.log(`evals: ${selected.length} cases × ${TRIALS} trials · model ${health.model.provider}/${health.model.model} · this run ≤ $${(runBudget / 1e6).toFixed(3)} · ledger $${(priorSpend / 1e6).toFixed(4)} of $${(MAX_TOTAL_MICROS / 1e6).toFixed(2)} · key remaining ${remaining === null ? 'unknown' : `$${remaining.toFixed(4)}`}\n`);

  outer: for (const evalCase of selected) {
    console.log(`▸ [L${evalCase.level}] ${evalCase.id} (${evalCase.category}) — ${evalCase.checks}`);
    for (let trial = 0; trial < TRIALS; trial++) {
      const estimate = ESTIMATED_REQUESTS_PER_TRIAL[evalCase.level] ?? 50;
      if (requestsToday() + estimate > DAILY_REQUEST_CAP) {
        console.log(`daily request cap: ${requestsToday()} used today (UTC) + ~${estimate} for this trial would pass ${DAILY_REQUEST_CAP}; stopping.`);
        break outer;
      }
      if (spent >= runBudget) {
        console.log(`budget of $${(runBudget / 1e6).toFixed(3)} reached; stopping.`);
        break outer;
      }
      const report = await runTrial(evalCase, trial).catch((error): TrialReport => ({
        caseId: evalCase.id,
        trial,
        pass: false,
        grades: [{ name: 'trial ran', required: true, pass: false, detail: String(error).slice(0, 300) }],
        costMicros: 0,
        durationMs: 0,
        toolCalls: 0,
        questions: 0,
        requests: 0,
        finalText: '',
        verificationProblems: [],
      }));
      spent += report.costMicros;
      addRequestsToday(report.requests);
      reports.push(report);
      printTrial(report);
    }
  }
} finally {
  stop();
  if (!values['keep-failed']) await removeEvalContainers();
}

const byCase = selected
  .map((evalCase) => {
    const runs = reports.filter((r) => r.caseId === evalCase.id);
    if (runs.length === 0) return null;
    const passed = runs.filter((r) => r.pass).length;
    return {
      case: evalCase.id,
      level: evalCase.level,
      category: evalCase.category,
      passRate: `${passed}/${runs.length}`,
      avgCost: `$${(runs.reduce((s, r) => s + r.costMicros, 0) / runs.length / 1e6).toFixed(4)}`,
      avgTime: `${(runs.reduce((s, r) => s + r.durationMs, 0) / runs.length / 1000).toFixed(0)}s`,
      avgTools: (runs.reduce((s, r) => s + r.toolCalls, 0) / runs.length).toFixed(1),
      avgRequests: (runs.reduce((s, r) => s + r.requests, 0) / runs.length).toFixed(0),
    };
  })
  .filter(Boolean);

console.log('\nsummary');
console.table(byCase);
const totalPassed = reports.filter((r) => r.pass).length;
console.log(`overall ${totalPassed}/${reports.length} trials passed · spent $${(spent / 1e6).toFixed(4)} · ${reports.reduce((s, r) => s + r.requests, 0)} requests · ${requestsToday()} requests today (UTC) · ledger now $${((priorSpend + spent) / 1e6).toFixed(4)}`);

const outFile = resolve(ROOT, `evals/results/${RUN_ID}.json`);
writeFileSync(outFile, JSON.stringify({ runId: RUN_ID, trials: TRIALS, reports, summary: byCase, spentMicros: spent }, null, 2));
console.log(`report: ${outFile}`);
await prisma.$disconnect();
process.exit(totalPassed === reports.length ? 0 : 1);
