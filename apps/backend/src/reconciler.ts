import { envInt } from '@repo/shared';
import { flushPendingCharges } from './credits';
import { flushDirtySandboxIds } from './project';
import { flushDirtyTaskStates } from './runtime';

const INTERVAL_MS = envInt('RECONCILE_INTERVAL_MS', 5_000);

const jobs: [string, () => Promise<number>][] = [
  ['task states', flushDirtyTaskStates],
  ['sandbox ids', flushDirtySandboxIds],
  ['credit charges', flushPendingCharges],
];

const failing = new Set<string>();
let running = false;

export async function reconcileOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const [name, job] of jobs) {
      try {
        const count = await job();
        if (count > 0) console.log(`[RECONCILE] synced ${count} ${name} to postgres`);
        if (failing.delete(name)) console.log(`[RECONCILE] ${name} sync recovered`);
      } catch (error) {
        if (!failing.has(name)) console.log(`[RECONCILE] ${name} waiting for postgres , `, String(error).slice(0, 160));
        failing.add(name);
      }
    }
  } finally {
    running = false;
  }
}

export function startReconciler(): () => void {
  const timer = setInterval(() => void reconcileOnce(), INTERVAL_MS);
  return () => clearInterval(timer);
}
