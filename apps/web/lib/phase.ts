import { toolKind } from './tools';

export const PHASES = [
  'Setting up your workspace',
  'Understanding your request',
  'Building your app',
  'Checking everything works',
  'Opening your preview',
];

export type BuildProgress = { phase: number; detail: string };

export const START_PROGRESS: BuildProgress = { phase: 0, detail: 'Getting started' };

const STAGES: [RegExp, number | null, string][] = [
  [/creating sandbox/i, 0, 'Creating a private workspace for your app'],
  [/restoring snapshot/i, 0, 'Restoring your saved files'],
  [/scaffolding/i, 0, 'Preparing the starter project'],
  [/restoring dependencies/i, 0, 'Installing the building blocks'],
  [/attaching sandbox/i, 0, 'Opening your workspace'],
  [/starting dev server/i, 0, 'Starting your app'],
  [/discarded uncommitted/i, 0, 'Tidying up an unfinished change'],
  [/waking/i, 0, 'Waking up your workspace'],
  [/connecting to ai/i, 1, 'Connecting to the AI'],
  [/waiting for your answer/i, null, 'Waiting for your answer in the chat'],
  [/waiting for your keys/i, null, 'Waiting for your keys in the chat'],
  [/reading|listing|searching/i, 1, 'Looking through your project'],
  [/thinking|analy/i, null, 'Thinking about the next step'],
  [/finding photos/i, 2, 'Finding photos for your app'],
  [/writing|updating|executing|creating|editing|running/i, 2, 'Writing the code'],
  [/verif|review/i, 3, 'Checking every page loads'],
  [/fixing|repair/i, 3, 'Fixing a problem it found'],
  [/refreshing live preview/i, 4, 'Refreshing your preview'],
];

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function fromStage(stage: string): { phase: number | null; detail: string } {
  const match = STAGES.find(([pattern]) => pattern.test(stage));
  if (!match) return { phase: null, detail: stage };
  return { phase: match[1], detail: match[2] };
}

export function fromTool(name: string, target: string): { phase: number; detail: string } {
  const kind = toolKind(name);
  if (kind === 'write') return { phase: 2, detail: `Creating ${basename(target)}` };
  if (kind === 'edit') return { phase: 2, detail: `Editing ${basename(target)}` };
  if (kind === 'run') {
    if (/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b/.test(target)) return { phase: 2, detail: 'Installing what your app needs' };
    if (/\b(tsc|typecheck|lint|build)\b/.test(target)) return { phase: 3, detail: 'Checking the code' };
    return { phase: 2, detail: 'Running a command' };
  }
  if (kind === 'images') return { phase: 2, detail: `Finding photos of ${target}` };
  if (kind === 'read') return { phase: 1, detail: `Reading ${basename(target)}` };
  return { phase: 1, detail: 'Looking through your project' };
}

export function advance(current: BuildProgress, next: { phase: number | null; detail: string }): BuildProgress {
  return { phase: next.phase === null ? current.phase : Math.max(current.phase, next.phase), detail: next.detail };
}
