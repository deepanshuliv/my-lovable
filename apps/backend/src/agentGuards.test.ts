import { describe, expect, test } from 'bun:test';
import { FailureTracker, parseQuestions, repairOpening, routesForFiles, routesFromRequest, sweepCredentials } from './agentGuards';

describe('FailureTracker', () => {
  test('asks for a full rewrite after repeated failed edits to one file', () => {
    const tracker = new FailureTracker();
    const args = { path: 'app/page.tsx' };
    expect(tracker.observe('edit_file', args, 'ERROR: target_content not found')).toBeNull();
    expect(tracker.observe('edit_file', args, 'ERROR: target_content not found')).toContain('rewrite the whole file');
  });

  test('a successful write resets the per-file count and the streak', () => {
    const tracker = new FailureTracker();
    const args = { path: 'app/page.tsx' };
    tracker.observe('edit_file', args, 'ERROR: nope');
    tracker.observe('write_file', args, 'Successfully wrote app/page.tsx');
    expect(tracker.observe('edit_file', args, 'ERROR: nope')).toBeNull();
  });

  test('asks the model to reassess after a streak of failures of any kind', () => {
    const tracker = new FailureTracker();
    const results = ['ERROR: a', 'ERROR: b', 'ERROR: c'].map((r) => tracker.observe('bash_tool', {}, r));
    expect(results.every((r) => r === null)).toBe(true);
    expect(tracker.observe('bash_tool', {}, 'ERROR: d')).toContain('reassess');
  });
});

describe('sweepCredentials', () => {
  test('finds credentials read by code and named in the reply', () => {
    const found = sweepCredentials(
      'You will need RESEND_API_KEY and a STRIPE_WEBHOOK_SECRET.',
      ["const key = process.env.OPENAI_API_KEY; const env = process.env.NODE_ENV; const u = process.env['DATABASE_URL'];"],
      [],
    );
    expect(found.map((s) => s.key).sort()).toEqual(['DATABASE_URL', 'OPENAI_API_KEY', 'RESEND_API_KEY', 'STRIPE_WEBHOOK_SECRET']);
  });

  test('skips declared keys, runtime vars and non-credential names', () => {
    const found = sweepCredentials(
      'Set BASE_URL and STRIPE_SECRET_KEY.',
      ['process.env.PORT; process.env.BASE_URL; process.env.FEATURE_FLAG'],
      [{ key: 'STRIPE_SECRET_KEY', reason: 'declared' }],
    );
    expect(found).toEqual([]);
  });
});

test('repairOpening carries the request, the errors and the files', () => {
  const text = repairOpening(
    'add a pricing page',
    { typecheckPassed: false, typecheckOutput: "app/pricing/page.tsx(3,5): error TS2322", runtimeErrors: ['TypeError: x is undefined'] },
    ['app/pricing/page.tsx'],
    1,
  );
  expect(text).toContain('<current-request>\nadd a pricing page\n</current-request>');
  expect(text).toContain('TS2322');
  expect(text).toContain('TypeError: x is undefined');
  expect(text).toContain('Files you changed this turn: app/pricing/page.tsx');
});

describe('repeated command failures', () => {
  test('the same failing command twice triggers a rewrite-or-read hint', () => {
    const tracker = new FailureTracker();
    expect(tracker.observe('bash_tool', { comand: 'npm run typecheck' }, 'ERROR: exit 2')).toBeNull();
    tracker.observe('read_file', { path: 'app/page.tsx' }, '1: x');
    expect(tracker.observe('bash_tool', { comand: 'npm  run typecheck' }, 'ERROR: exit 2')).toContain('failed 2 times');
  });
});

describe('routesForFiles', () => {
  test('maps written App Router files to requestable routes', () => {
    expect(
      routesForFiles([
        'app/page.tsx',
        'app/about/page.tsx',
        './app/(marketing)/pricing/page.tsx',
        'app/api/ping/route.ts',
        'app/blog/[slug]/page.tsx',
        'app/components/Button.tsx',
        'lib/total.ts',
      ]),
    ).toEqual(['/', '/about', '/pricing', '/api/ping']);
  });
});

test('re-running the same passing command without changes gets a finish-or-change hint', () => {
  const tracker = new FailureTracker();
  expect(tracker.observe('bash_tool', { comand: 'npm run typecheck' }, 'ok')).toBeNull();
  expect(tracker.observe('bash_tool', { comand: 'npm run typecheck' }, 'ok')).toBeNull();
  expect(tracker.observe('bash_tool', { comand: 'npm run typecheck' }, 'ok')).toContain('3 times with no file changes');
  tracker.observe('edit_file', { path: 'a.ts' }, 'Successfully updated a.ts');
  expect(tracker.observe('bash_tool', { comand: 'npm run typecheck' }, 'ok')).toBeNull();
});

describe('parseQuestions', () => {
  test('accepts 1 to 5 questions in one call', () => {
    const two = parseQuestions({ questions: [{ question: 'Backend?', options: ['Yes', 'No'] }, { question: 'Database?', options: ['Postgres', 'None'] }] });
    expect(Array.isArray(two) && two.map((q) => q.question)).toEqual(['Backend?', 'Database?']);
    expect(Array.isArray(parseQuestions({ questions: [{ question: 'One?' }] }))).toBe(true);
    expect(Array.isArray(parseQuestions({ questions: [1, 2, 3, 4, 5].map((n) => ({ question: `Q${n}?` })) }))).toBe(true);
  });

  test('enforces the 5-per-turn ceiling across calls and rejects the old shape', () => {
    expect(parseQuestions({ question: 'Backend?' })).toContain('1 to 5 items');
    expect(parseQuestions({ questions: [1, 2, 3, 4, 5, 6].map((n) => ({ question: `Q${n}?` })) })).toContain('sent 6');
    expect(parseQuestions({ questions: [{ question: 'a' }, { question: 'b' }] }, 4)).toContain('you can ask 1 more');
    expect(parseQuestions({ questions: [{ question: 'a' }] }, 5)).toContain('the maximum');
  });
});

describe('clientDirectiveWarning', () => {
  test('flags interactive components without use client and stays quiet otherwise', async () => {
    const { clientDirectiveWarning } = await import('./tools/toolDefintion');
    expect(clientDirectiveWarning('app/pricing/page.tsx', 'export default function P() { return <button onClick={() => 1}>Buy</button>; }')).toContain("'use client'");
    expect(clientDirectiveWarning('components/Todo.tsx', "import { useState } from 'react';\nexport function T() { const [a] = useState(1); return a; }")).toContain("'use client'");
    expect(clientDirectiveWarning('app/pricing/page.tsx', "'use client';\nexport default function P() { return <button onClick={() => 1}>Buy</button>; }")).toBeNull();
    expect(clientDirectiveWarning('app/about/page.tsx', 'export default function A() { return <h1>About</h1>; }')).toBeNull();
    expect(clientDirectiveWarning('app/api/x/route.ts', 'const x = useState(1);')).toBeNull();
  });
});

describe('routesFromRequest', () => {
  test('extracts concrete routes from real website briefs and skips placeholders and file paths', async () => {
    const { CASES } = await import('../../../evals/cases');
    const prompt = (id: string) => CASES.find((c) => c.id === id)!.prompt!;
    expect(routesFromRequest(prompt('l3-bakery-website')).sort()).toEqual(['/', '/about', '/api/contact', '/contact', '/menu']);
    expect(routesFromRequest(prompt('l3-task-manager-crud')).sort()).toEqual(['/api/tasks']);
    expect(routesFromRequest(prompt('l3-blog-with-feed')).sort()).toEqual(['/', '/feed.xml']);
    expect(routesFromRequest(prompt('l3-saas-landing')).sort()).toEqual(['/', '/privacy', '/terms']);
    expect(routesFromRequest(prompt('l3-admin-dashboard')).sort()).toEqual(['/api/settings', '/api/users', '/dashboard', '/dashboard/settings', '/dashboard/users']);
    expect(routesFromRequest('Fix the bug in lib/menu.ts and src/app/page.tsx; see https://example.com/docs')).toEqual([]);
  });
});

describe('normalizeProjectPath', () => {
  test('turns absolute and stripped-absolute paths into project-relative ones', async () => {
    const { normalizeProjectPath } = await import('./tools/toolDefintion');
    expect(normalizeProjectPath('/workspace/app/app/page.tsx', '/workspace/app')).toBe('app/page.tsx');
    expect(normalizeProjectPath('workspace/app/components/Footer.tsx', '/workspace/app')).toBe('components/Footer.tsx');
    expect(normalizeProjectPath('./lib/menu.ts', '/workspace/app')).toBe('lib/menu.ts');
    expect(normalizeProjectPath('/home/daytona/app/app/menu/page.tsx', '/home/daytona/app')).toBe('app/menu/page.tsx');
    expect(normalizeProjectPath('app/about/page.tsx', '/workspace/app')).toBe('app/about/page.tsx');
  });
});

test('serverFetchWarning flags relative fetches in server files only', async () => {
  const { serverFetchWarning } = await import('./tools/toolDefintion');
  expect(serverFetchWarning('app/(dashboard)/dashboard/users/page.tsx', "export default async function P() { const r = await fetch('/api/users'); return null; }")).toContain('Failed to parse URL');
  expect(serverFetchWarning('app/page.tsx', "'use client';\nexport default function P() { fetch('/api/tasks'); return null; }")).toBeNull();
  expect(serverFetchWarning('app/page.tsx', "export default async function P() { await fetch('https://api.example.com/x'); return null; }")).toBeNull();
  expect(serverFetchWarning('components/List.tsx', "fetch('/api/x')")).toBeNull();
});

test('devServerCommandError blocks killing or restarting the dev server but not normal commands', async () => {
  const { devServerCommandError } = await import('./tools/toolDefintion');
  for (const bad of ['pkill -f "next dev"', 'pkill -9 -f node || true', 'killall node', 'kill $(lsof -t -i:3000)', 'kill -9 -1', 'fuser -k 3000/tcp', 'npm run dev', 'cd app && npx next dev -p 3001', '(nohup npm run dev > /tmp/x &)']) {
    expect(devServerCommandError(bad)).not.toBeNull();
  }
  for (const ok of ['npm run typecheck', 'npm install date-fns --no-audit --no-fund', 'tail -n 40 /tmp/dev-server.log', 'grep -rn "nodeName" app', 'npm run build', 'ls node_modules/next']) {
    expect(devServerCommandError(ok)).toBeNull();
  }
});

describe('route feedback', () => {
  test('urlForAppFile and routeNote expose what URL a file really serves', async () => {
    const { urlForAppFile, routeNote, routeMap } = await import('./agentGuards');
    expect(urlForAppFile('app/(dashboard)/users/page.tsx')).toBe('/users');
    expect(urlForAppFile('app/(dashboard)/dashboard/users/page.tsx')).toBe('/dashboard/users');
    expect(urlForAppFile('app/(dashboard)/page.tsx')).toBe('/');
    expect(urlForAppFile('app/feed.xml/route.ts')).toBe('/feed.xml');
    expect(urlForAppFile('app/menu/[slug]/page.tsx')).toBe('/menu/[slug]');
    expect(urlForAppFile('components/Header.tsx')).toBeNull();
    expect(routeNote('app/(dashboard)/users/page.tsx')).toBe('This file serves the URL /users. Route group folders like (name) are not part of the URL.');
    expect(routeMap(['app/page.tsx', 'app/(dashboard)/users/page.tsx'])).toBe('/  ←  app/page.tsx\n/users  ←  app/(dashboard)/users/page.tsx');
  });

  test('repairOpening shows the URL map only when pages are missing', () => {
    const failure = { typecheckPassed: true, typecheckOutput: '', runtimeErrors: ['GET /dashboard returned HTTP 404: this page or API route does not exist'] };
    const text = repairOpening('build a dashboard', failure, [], 1, ['app/(dashboard)/page.tsx', 'app/(dashboard)/users/page.tsx']);
    expect(text).toContain('/users  ←  app/(dashboard)/users/page.tsx');
    expect(repairOpening('x', { ...failure, runtimeErrors: ['TypeError: boom'] }, [], 1, ['app/page.tsx'])).not.toContain('URLs your app currently serves');
  });
});

test('routeFileOutsideAppError catches route files written outside app/', async () => {
  const { routeFileOutsideAppError } = await import('./tools/toolDefintion');
  expect(routeFileOutsideAppError('(dashboard)/layout.tsx')).toContain('app/(dashboard)/layout.tsx');
  expect(routeFileOutsideAppError('api/settings/route.ts')).toContain('app/api/settings/route.ts');
  expect(routeFileOutsideAppError('dashboard/page.tsx')).toContain('app/dashboard/page.tsx');
  expect(routeFileOutsideAppError('app/(dashboard)/dashboard/page.tsx')).toBeNull();
  expect(routeFileOutsideAppError('components/Sidebar.tsx')).toBeNull();
  expect(routeFileOutsideAppError('lib/route-utils.ts')).toBeNull();
});

test('alias import hints point at the misplaced file', async () => {
  const { unresolvedAliasImports, aliasHints } = await import('./agentGuards');
  const { helperLocationNote } = await import('./tools/toolDefintion');
  const output = "app/(dashboard)/dashboard/page.tsx(1,39): error TS2307: Cannot find module '@/lib/data' or its corresponding type declarations.";
  const missing = unresolvedAliasImports(output);
  expect(missing).toEqual(['lib/data']);
  const hint = aliasHints(missing, ['./app/lib/data.ts', './app/page.tsx'])[0]!;
  expect(hint).toContain('app/lib/data.ts');
  expect(hint).toContain('move it to lib/data.ts(x) at the project root');
  expect(aliasHints(['lib/none'], ['./app/page.tsx'])[0]).toContain('Create that file');
  expect(helperLocationNote('app/lib/data.ts')).toContain("'@/lib/data' resolves to lib/data");
  expect(helperLocationNote('lib/data.ts')).toBeNull();
  expect(helperLocationNote('app/dashboard/page.tsx')).toBeNull();
});

test('needsReview: every complex brief gets a review, short requests do not', async () => {
  const { needsReview } = await import('./agentGuards');
  const { CASES } = await import('../../../evals/cases');
  for (const c of CASES.filter((c) => c.level === 3 && !c.id.startsWith('speed-'))) expect(needsReview(c.prompt!)).toBe(true);
  expect(needsReview('Build a todo app on the home page: a text input and an "Add" button that adds the typed text to a list. Each todo has a checkbox to mark it done and a "Delete" button that removes it. Show how many todos are left.')).toBe(false);
  expect(needsReview('Change the main heading on the home page so it reads exactly "Hello Evals".')).toBe(false);
});

describe('plain-text clarifying questions', () => {
  test('the real free-model reply becomes 5 tool questions', async () => {
    const { parsePlainTextQuestions } = await import('./agentGuards');
    const reply = "The request \"Build me an app\" is too broad to build correctly without knowing what you want. Here are a few options to pin down your intent:\n\n**1. What kind of app?**\n- A) Landing/marketing page for a product or service\n- B) Interactive tool (task manager, notes, calculator, etc.)\n- C) Dashboard (analytics, admin panel, settings)\n- D) Content site (blog, portfolio, documentation)\n- E) Something else \u2014 describe it\n\n**2. Should it have a backend / database?**\n- A) Frontend only, static data\n- B) Needs a database for storing user data\n- C) Needs API integrations (Stripe, email, AI, etc.)\n- D) Doesn't matter / not sure\n\n**3. Who is it for?**\n- A) You personally / a specific business\n- B) Public / general audience\n- C) Internal team use\n\n**4. Any must-have features?** (e.g. authentication, payments, real-time updates)\n\n**5. Design preferences?**\n- A) Modern, minimal, clean\n- B) Bold, colorful, eye-catching\n- C) I'll pick from templates / you decide\n- D) I have a specific style/mockup\n\nGive me your answers and I'll build the MVP.";
    const questions = parsePlainTextQuestions(reply);
    expect(questions.map((q) => [q.question, q.options.length])).toEqual([
      ['What kind of app?', 5],
      ['Should it have a backend / database?', 4],
      ['Who is it for?', 3],
      ['Any must-have features?', 0],
      ['Design preferences?', 4],
    ]);
    expect(questions[0]!.options[0]).toBe('Landing/marketing page for a product or service');
  });

  test('rhetorical questions and ordinary answers do not trigger it', async () => {
    const { parsePlainTextQuestions } = await import('./agentGuards');
    expect(parsePlainTextQuestions('Done! The page is live at /about. Want me to add dark mode next?')).toEqual([]);
    expect(parsePlainTextQuestions('Why does it fail?\nBecause the import path was wrong.\n- fixed lib/menu.ts')).toEqual([]);
  });
});
