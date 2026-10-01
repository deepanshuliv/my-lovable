import { execIn, WORKSPACE } from './support/docker';

export type StreamEvent = { type: string; [key: string]: any };

export type Trial = {
  caseId: string;
  projectId: string;
  userId: string;
  sandboxId: string | null;
  events: StreamEvent[];
  finalText: string;
  toolCalls: { name: string; args: Record<string, any> }[];
  toolResults: { name: string; result: string; isError: boolean }[];
  questions: { question: string; options?: unknown }[];
  secretsRequired: { key: string; reason: string }[];
  verification: { ok: boolean; typecheckPassed: boolean | null } | null;
  errors: string[];
  costMicros: number;
  durationMs: number;
  seeded: Record<string, string>;
  turns: { events: StreamEvent[]; toolResults: { name: string; result: string; isError: boolean }[] }[];
};

export type GradeResult = { pass: boolean; detail?: string };

export type Grader = {
  name: string;
  required?: boolean;
  check: (trial: Trial) => Promise<GradeResult> | GradeResult;
};

const APP = `${WORKSPACE}/app`;

export async function sandboxExec(trial: Trial, command: string, timeoutMs = 120_000) {
  if (!trial.sandboxId) return { exitCode: 1, output: 'no sandbox' };
  const result = await execIn(trial.sandboxId, command, { cwd: APP, timeoutMs });
  return { exitCode: result.exitCode, output: result.output };
}

export async function readSandboxFile(trial: Trial, path: string): Promise<string | null> {
  const result = await sandboxExec(trial, `cat ${JSON.stringify(path)}`);
  return result.exitCode === 0 ? result.output : null;
}

export async function httpGet(trial: Trial, path: string): Promise<{ status: number; body: string }> {
  const script = `fetch('http://127.0.0.1:3000${path}').then(async (r) => { console.log('STATUS:' + r.status); console.log(await r.text()); }).catch(() => console.log('STATUS:0'))`;
  let last = { status: 0, body: '' };
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await sandboxExec(trial, `node -e ${JSON.stringify(script)}`, 90_000);
    const match = /STATUS:(\d+)/.exec(result.output);
    last = { status: match ? Number(match[1]) : 0, body: result.output };
    if (last.status >= 200 && last.status < 500 && last.status !== 0) return last;
    await Bun.sleep(5_000);
  }
  return last;
}

export type HttpResult = { status: number; contentType: string; body: string };

export async function httpFull(trial: Trial, method: string, path: string, body?: unknown): Promise<HttpResult> {
  const init = JSON.stringify({ method, redirect: 'manual', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const script = `fetch('http://127.0.0.1:3000${path}', ${init}).then(async (r) => { console.log('STATUS:' + r.status); console.log('CTYPE:' + (r.headers.get('content-type') || '')); console.log(await r.text()); }).catch(() => console.log('STATUS:0'))`;
  let last: HttpResult = { status: 0, contentType: '', body: '' };
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await sandboxExec(trial, `node -e ${JSON.stringify(script)}`, 120_000);
    const status = Number(/STATUS:(\d+)/.exec(result.output)?.[1] ?? 0);
    const contentType = /CTYPE:(.*)/.exec(result.output)?.[1]?.trim() ?? '';
    last = { status, contentType, body: result.output.replace(/^STATUS:\d+\n(CTYPE:.*\n)?/, '') };
    if (status !== 0 && status < 500) return last;
    await Bun.sleep(5_000);
  }
  return last;
}

export async function httpRequest(trial: Trial, method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
  const result = await httpFull(trial, method, path, body);
  return { status: result.status, body: result.body };
}

export function jsonOf(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function hrefsMatching(html: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href="([^"#?]+)"/g)) {
    if (pattern.test(match[1]!)) found.add(match[1]!);
  }
  return [...found];
}

export function everyPageContains(paths: string[], patterns: { label: string; pattern: RegExp }[], name: string): Grader {
  return {
    name,
    check: async (t) => {
      for (const path of paths) {
        const page = await httpFull(t, 'GET', path);
        if (page.status !== 200) return fail(`GET ${path} → ${page.status}`);
        const missing = patterns.filter((p) => !p.pattern.test(page.body)).map((p) => p.label);
        if (missing.length > 0) return fail(`${path} is missing ${missing.join(', ')}`);
      }
      return { pass: true };
    },
  };
}

export function custom(name: string, check: (t: Trial) => Promise<GradeResult>): Grader {
  return {
    name,
    check: async (t) => {
      try {
        return await check(t);
      } catch (error) {
        return fail(`check threw: ${String(error).slice(0, 200)}`);
      }
    },
  };
}

export function httpExchange(
  name: string,
  steps: { method: string; path: string; body?: unknown; status: number | number[]; bodyMatches?: RegExp }[],
): Grader {
  return {
    name,
    check: async (t) => {
      for (const step of steps) {
        const response = await httpRequest(t, step.method, step.path, step.body);
        const allowed = Array.isArray(step.status) ? step.status : [step.status];
        if (!allowed.includes(response.status)) {
          return fail(`${step.method} ${step.path} → ${response.status}, expected ${allowed.join('/')}: ${response.body.slice(0, 200)}`);
        }
        if (step.bodyMatches && !step.bodyMatches.test(response.body)) {
          return fail(`${step.method} ${step.path} body did not match ${step.bodyMatches}: ${response.body.slice(0, 200)}`);
        }
      }
      return { pass: true };
    },
  };
}

export function noWritesInTurn(index: number): Grader {
  return {
    name: `turn ${index + 1} makes no successful writes`,
    check: (t) => {
      const turn = t.turns[index];
      if (!turn) return fail('turn missing');
      const writes = turn.toolResults.filter((r) => ['write_file', 'edit_file'].includes(r.name) && !r.isError);
      return writes.length === 0 ? { pass: true } : fail(writes.map((w) => w.result.slice(0, 80)).join(' | '));
    },
  };
}

export function fail(detail: string): GradeResult {
  return { pass: false, detail };
}

export const completes: Grader = {
  name: 'turn completes without errors',
  check: (t) =>
    t.events.at(-1)?.type === 'done' && t.errors.length === 0
      ? { pass: true }
      : fail(`last=${t.events.at(-1)?.type} errors=${t.errors.join(' | ').slice(0, 300)}`),
};

export function maxToolCalls(limit: number): Grader {
  return {
    name: `uses at most ${limit} tool calls`,
    required: false,
    check: (t) => (t.toolCalls.length <= limit ? { pass: true } : fail(`${t.toolCalls.length} tool calls`)),
  };
}

export function maxCostUsd(limit: number): Grader {
  return {
    name: `costs at most $${limit}`,
    required: false,
    check: (t) => (t.costMicros <= limit * 1_000_000 ? { pass: true } : fail(`$${(t.costMicros / 1e6).toFixed(4)}`)),
  };
}

export const verificationPasses: Grader = {
  name: 'post-turn verification passes',
  check: (t) => (t.verification?.ok ? { pass: true } : fail(JSON.stringify(t.verification))),
};

export const typecheckPasses: Grader = {
  name: 'tsc --noEmit passes in the sandbox',
  check: async (t) => {
    const result = await sandboxExec(t, 'rm -rf .next/types && ./node_modules/.bin/tsc --noEmit');
    return result.exitCode === 0 ? { pass: true } : fail(result.output.slice(-600));
  },
};

export function fileExists(path: string): Grader {
  return {
    name: `${path} exists`,
    check: async (t) => ((await readSandboxFile(t, path)) !== null ? { pass: true } : fail('missing')),
  };
}

export function anyFileMatches(glob: string, pattern: RegExp, name: string): Grader {
  return {
    name,
    check: async (t) => {
      const result = await sandboxExec(t, `grep -rlE ${JSON.stringify(pattern.source)} ${glob} 2>/dev/null | grep -v node_modules | head -5`);
      return result.output.trim() ? { pass: true, detail: result.output.trim() } : fail(`no file under ${glob} matches ${pattern}`);
    },
  };
}

export function noFileMatches(glob: string, pattern: RegExp, name: string): Grader {
  return {
    name,
    check: async (t) => {
      const result = await sandboxExec(t, `grep -rlE ${JSON.stringify(pattern.source)} ${glob} 2>/dev/null | grep -v node_modules | head -5`);
      return result.output.trim() ? fail(result.output.trim()) : { pass: true };
    },
  };
}

export function fileContains(path: string, pattern: RegExp): Grader {
  return {
    name: `${path} matches ${pattern}`,
    check: async (t) => {
      const content = await readSandboxFile(t, path);
      if (content === null) return fail('missing');
      return pattern.test(content) ? { pass: true } : fail(content.slice(0, 300));
    },
  };
}

export function httpResponds(path: string, expect: { status?: number; body?: RegExp }): Grader {
  return {
    name: `GET ${path} → ${expect.status ?? 200}${expect.body ? ` containing ${expect.body}` : ''}`,
    check: async (t) => {
      const response = await httpGet(t, path);
      if (response.status !== (expect.status ?? 200)) return fail(`status ${response.status}: ${response.body.slice(0, 200)}`);
      if (expect.body && !expect.body.test(response.body)) return fail(response.body.slice(0, 300));
      return { pass: true };
    },
  };
}

export const workingTreeUnchanged: Grader = {
  name: 'no files changed in the sandbox',
  check: async (t) => {
    const result = await sandboxExec(t, 'git status --porcelain');
    return result.output.trim() === '' ? { pass: true } : fail(result.output.slice(0, 300));
  },
};

export const noSuccessfulWrites: Grader = {
  name: 'no write_file / edit_file succeeded',
  check: (t) => {
    const writes = t.toolResults.filter((r) => ['write_file', 'edit_file'].includes(r.name) && !r.isError);
    return writes.length === 0 ? { pass: true } : fail(writes.map((w) => w.result.slice(0, 80)).join(' | '));
  },
};

export function finalTextMatches(pattern: RegExp, name?: string): Grader {
  return {
    name: name ?? `final reply matches ${pattern}`,
    check: (t) => (pattern.test(t.finalText) ? { pass: true } : fail(t.finalText.slice(0, 300) || '(empty reply)')),
  };
}

export function declaresSecret(pattern: RegExp): Grader {
  return {
    name: `declares a secret matching ${pattern}`,
    check: (t) =>
      t.secretsRequired.some((s) => pattern.test(s.key))
        ? { pass: true }
        : fail(`declared: ${t.secretsRequired.map((s) => s.key).join(', ') || 'none'}`),
  };
}

export function asksQuestionsBetween(min: number, max: number): Grader {
  return {
    name: `asks ${min}–${max} clarifying questions via question_tool`,
    check: (t) =>
      t.questions.length >= min && t.questions.length <= max
        ? { pass: true, detail: `${t.questions.length} asked` }
        : fail(`asked ${t.questions.length}: ${t.questions.map((q) => q.question).join(' | ')}`),
  };
}

export function asksExactlyQuestions(count: number): Grader {
  return {
    name: `asks exactly ${count} clarifying questions via question_tool`,
    check: (t) =>
      t.questions.length === count ? { pass: true } : fail(`asked ${t.questions.length}: ${t.questions.map((q) => q.question).join(' | ')}`),
  };
}

export const asksBeforeWriting: Grader = {
  name: 'asks before writing any file',
  check: (t) => {
    const firstQuestion = t.toolCalls.findIndex((c) => c.name === 'question_tool');
    const firstWrite = t.toolCalls.findIndex((c) => c.name === 'write_file' || c.name === 'edit_file');
    if (firstQuestion === -1) return fail('never asked');
    return firstWrite === -1 || firstQuestion < firstWrite ? { pass: true } : fail('wrote before asking');
  },
};

export function seededValueNeverShown(seedKey: string): Grader {
  return {
    name: `seeded secret ${seedKey} never appears in the stream`,
    check: (t) => {
      const value = t.seeded[seedKey];
      if (!value) return fail('nothing seeded');
      return JSON.stringify(t.events).includes(value) ? fail('secret value leaked into the event stream') : { pass: true };
    },
  };
}

export function noCommandMatches(pattern: RegExp, name: string): Grader {
  return {
    name,
    check: (t) => {
      const hits = t.toolCalls.filter((c) => c.name === 'bash_tool' && pattern.test(String(c.args.comand ?? c.args.command ?? '')));
      return hits.length === 0 ? { pass: true } : fail(hits.map((h) => String(h.args.comand)).join(' | ').slice(0, 300));
    },
  };
}

export function llmJudge(rubric: string, name: string): Grader {
  return {
    name: `judge: ${name}`,
    required: false,
    check: async (t) => {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key || process.env.EVAL_JUDGE !== '1') return { pass: true, detail: 'skipped (set EVAL_JUDGE=1)' };
      const response = await fetch(`${process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.EVAL_JUDGE_MODEL || 'deepseek/deepseek-v4-flash',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You grade an AI coding agent. Reply with JSON {"pass": boolean, "reason": string}. Be strict and literal about the rubric.',
            },
            { role: 'user', content: `Rubric:\n${rubric}\n\nAgent reply:\n${t.finalText.slice(0, 12_000)}` },
          ],
        }),
      });
      if (!response.ok) return fail(`judge http ${response.status}`);
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      try {
        const verdict = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as { pass?: boolean; reason?: string };
        return { pass: Boolean(verdict.pass), detail: verdict.reason };
      } catch {
        return fail('judge returned invalid JSON');
      }
    },
  };
}

export function maxDurationSeconds(limit: number, required = true): Grader {
  return {
    name: `finishes within ${limit}s`,
    required,
    check: (t) => (t.durationMs <= limit * 1000 ? { pass: true, detail: `${(t.durationMs / 1000).toFixed(1)}s` } : fail(`${(t.durationMs / 1000).toFixed(1)}s`)),
  };
}

export function maxCallsOf(tool: string, limit: number, required = false): Grader {
  return {
    name: `calls ${tool} at most ${limit}x`,
    required,
    check: (t) => {
      const count = t.toolCalls.filter((c) => c.name === tool).length;
      return count <= limit ? { pass: true } : fail(`${count} calls`);
    },
  };
}

export const noQuestionsAsked: Grader = {
  name: 'builds a clear brief without clarifying questions',
  required: false,
  check: (t) => {
    const early = t.questions.filter((q) => !/database/i.test(q.question));
    return early.length === 0 ? { pass: true } : fail(early.map((q) => q.question).join(' | ').slice(0, 300));
  },
};

export function showsRealPhotos(min: number): Grader {
  return {
    name: `home page shows at least ${min} real photos`,
    check: async (t) => {
      const page = await httpFull(t, 'GET', '/');
      const srcs = [...page.body.matchAll(/<img[^>]+src="(https:\/\/[^"]+)"/g)].map((m) => m[1]!);
      const unique = new Set(srcs);
      return unique.size >= min ? { pass: true, detail: `${unique.size} photos` } : fail(`${unique.size} photos: ${[...unique].join(', ').slice(0, 200)}`);
    },
  };
}

export const usesMotion: Grader = {
  name: 'ships animation with motion/react',
  check: async (t) => {
    const result = await sandboxExec(t, `grep -rlE "from ['\\"]motion/react['\\"]" app components 2>/dev/null | head -3`);
    return result.output.trim() ? { pass: true, detail: result.output.trim() } : fail('no component imports motion/react');
  },
};

export const avoidsDefaultPalette: Grader = {
  name: 'avoids the banned cream + brass default palette',
  required: false,
  check: async (t) => {
    const banned = '#(f5f1ea|f7f5f1|fbf8f1|efeae0|ece6db|faf7f1|e8dfcb|f7f4ef|b08947|b6553a|9a2436|9c6e2a|bc7c3a|7d5621|1a1714|1a1814|1b1814)\\b';
    const result = await sandboxExec(t, `grep -rliE ${JSON.stringify(banned)} app components lib 2>/dev/null | head -5`);
    return result.output.trim() ? fail(result.output.trim()) : { pass: true };
  },
};
