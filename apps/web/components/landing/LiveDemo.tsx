'use client';

import { CaretLeft, Coins, GithubLogo, Pause, Play, ArrowCounterClockwise, Sliders } from '@phosphor-icons/react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ChatPanel from '@/components/ChatPanel';
import PreviewPanel from '@/components/PreviewPanel';
import { LogoMark } from '@/components/lime';
import { START_PROGRESS, type BuildProgress } from '@/lib/phase';
import type { ChatItem } from '@/lib/types';

const PROMPT = 'A booking page for my yoga classes with a weekly schedule';
const REPLY =
  'Your booking page is ready. It has a weekly class schedule, a booking form, and people pay when they arrive. Want me to add prices next?';
const TYPE_START = 500;
const TYPE_END = 2700;
const SEND = 3000;
const DONE = 18400;
const DURATION = 23500;

const TOOLS = [
  { id: 't1', name: 'read_file', args: 'app/page.tsx', at: 8400, end: 9000, result: 'ok' },
  { id: 't2', name: 'write_file', args: 'app/page.tsx', at: 9200, end: 10200, result: 'ok' },
  { id: 't3', name: 'write_file', args: 'components/Schedule.tsx', at: 10300, end: 11300, result: 'ok' },
  { id: 't4', name: 'write_file', args: 'components/BookingForm.tsx', at: 11400, end: 12400, result: 'ok' },
  { id: 't5', name: 'bash_tool', args: 'npm install date-fns', at: 12500, end: 13700, result: 'added 1 package in 2s' },
  { id: 't6', name: 'edit_file', args: 'app/layout.tsx', at: 13800, end: 14500, result: 'ok' },
];

const PROGRESS: [number, BuildProgress, string | null][] = [
  [SEND, { phase: 0, detail: 'Creating a private workspace for your app' }, 'Getting started'],
  [3900, { phase: 0, detail: 'Preparing the starter project' }, 'Preparing the starter project'],
  [4800, { phase: 0, detail: 'Starting your app' }, 'Starting your app'],
  [5600, { phase: 1, detail: 'Connecting to the AI' }, 'Connecting to the AI'],
  [6300, { phase: 1, detail: 'Waiting for your answer in the chat' }, 'Waiting for your answer in the chat'],
  [8000, { phase: 1, detail: 'Thinking about the next step' }, 'Thinking about the next step'],
  [8400, { phase: 1, detail: 'Reading page.tsx' }, 'Reading page.tsx'],
  [9200, { phase: 2, detail: 'Creating page.tsx' }, 'Creating page.tsx'],
  [10300, { phase: 2, detail: 'Creating Schedule.tsx' }, 'Creating Schedule.tsx'],
  [11400, { phase: 2, detail: 'Creating BookingForm.tsx' }, 'Creating BookingForm.tsx'],
  [12500, { phase: 2, detail: 'Installing what your app needs' }, 'Installing what your app needs'],
  [13800, { phase: 2, detail: 'Editing layout.tsx' }, 'Editing layout.tsx'],
  [14700, { phase: 3, detail: 'Checking every page loads' }, 'Checking every page loads'],
  [15900, { phase: 3, detail: 'Everything checks out' }, 'Everything checks out'],
  [16300, { phase: 4, detail: 'Refreshing your preview' }, 'Refreshing your preview'],
];

const PHASE_MARKS = [
  { label: 'Describe', at: 0 },
  { label: 'Ask', at: 6300 },
  { label: 'Build', at: 9200 },
  { label: 'Check', at: 14700 },
  { label: 'Live', at: 16600 },
];

type DemoState = {
  draft: string;
  items: ChatItem[];
  busy: boolean;
  status: string | null;
  progress: BuildProgress;
  appBuilt: boolean;
};

function stateAt(t: number): DemoState {
  const items: ChatItem[] = [];
  let draft = '';
  if (t >= TYPE_START && t < SEND) {
    const k = Math.min(1, (t - TYPE_START) / (TYPE_END - TYPE_START));
    draft = PROMPT.slice(0, Math.round(k * PROMPT.length));
  }
  if (t >= SEND) items.push({ kind: 'user', id: 'u1', text: PROMPT });
  if (t >= 6300) {
    items.push({
      kind: 'question',
      id: 'q1',
      questionId: 'q1',
      question: 'How should people pay for a class?',
      options: ['Pay when they arrive', 'Pay online with a card', 'Free, just reserve a spot'],
      ...(t >= 7700 ? { answer: 'Pay when they arrive' } : {}),
    });
  }
  for (const tool of TOOLS) {
    if (t >= tool.at) items.push({ kind: 'tool', id: tool.id, name: tool.name, args: tool.args, ...(t >= tool.end ? { result: tool.result } : {}) });
  }
  if (t >= 15900) items.push({ kind: 'verification', id: 'v1', ok: true, typecheckPassed: true, typecheckOutput: '', runtimeErrors: [] });
  if (t >= 16600) {
    const k = Math.min(1, (t - 16600) / 1600);
    items.push({ kind: 'assistant', id: 'a1', text: REPLY.slice(0, Math.max(1, Math.round(k * REPLY.length))), streaming: t < DONE });
  }

  let progress: BuildProgress = START_PROGRESS;
  let status: string | null = null;
  for (const [at, value, label] of PROGRESS) {
    if (t >= at) {
      progress = value;
      status = label;
    }
  }
  const busy = t >= SEND && t < DONE;
  return { draft, items, busy, status: busy ? status : null, progress, appBuilt: t >= 16600 };
}

function useDemoClock(reduced: boolean | null) {
  const [t, setT] = useState(reduced ? DONE + 1000 : 0);
  const [playing, setPlaying] = useState(!reduced);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) {
      last.current = null;
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last.current === null) last.current = now;
      const delta = now - last.current;
      if (delta < 60) return;
      last.current = now;
      setT((value) => (value + delta >= DURATION ? 0 : value + delta));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, visible]);

  return { t, setT, playing, setPlaying, rootRef };
}

function FakeHeader({ state }: { state: DemoState }) {
  return (
    <div className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b-2 border-[var(--edge)] bg-[var(--paper)] px-3 md:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] shadow-[var(--hard-sm)]">
          <CaretLeft size={15} weight="bold" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-bold leading-tight tracking-[-0.02em]">{state.items.length ? 'Yoga Class Booking' : 'New project'}</p>
          <p className="hidden truncate text-[12px] font-medium text-[var(--muted)] sm:flex sm:items-center sm:gap-1.5">
            {state.busy && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full border border-[var(--edge)] bg-[var(--lime)]" />}
            {state.busy ? state.progress.detail : state.appBuilt ? 'Ask for changes in the chat' : 'Describe what you want in the chat'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="btn-ghost btn-sm hidden lg:inline-flex">
          <Sliders size={15} />
          App settings
        </span>
        <span className="btn-ghost btn-sm hidden md:inline-flex">
          <GithubLogo size={15} weight="fill" />
          GitHub
        </span>
        <span className="flex h-9 items-center gap-2 rounded-[10px] bg-[var(--ink)] py-1.5 pl-3 pr-1.5 text-[12px] font-bold uppercase text-white">
          <Coins size={15} weight="fill" className="text-[var(--lime)]" />
          <span className="hidden sm:inline">Credits</span>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-[5px] bg-[var(--lime)] px-1 font-mono text-[12px] text-[var(--ink)]">
            {state.appBuilt ? 96 : 100}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function LiveDemo() {
  const reduced = useReducedMotion();
  const { t, setT, playing, setPlaying, rootRef } = useDemoClock(reduced);
  const state = useMemo(() => stateAt(t), [t]);
  const noop = () => {};

  return (
    <div ref={rootRef} role="region" aria-label="Demo: a real Inkling build of a yoga booking page">
      <p className="sr-only">
        A recording of Inkling building a yoga booking page: the request is typed, Inkling asks how people should pay, writes four
        files, checks every page, and the finished site appears in the preview.
      </p>
      <div
        aria-hidden="true"
        className="pointer-events-none flex h-[760px] select-none flex-col overflow-hidden rounded-[16px] border-2 border-[var(--edge)] bg-[var(--cream)] shadow-[var(--hard-lg)] lg:h-[660px]"
      >
        <FakeHeader state={state} />
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex h-[360px] shrink-0 flex-col border-b-2 border-[var(--edge)] bg-[var(--paper)] lg:h-auto lg:w-[380px] lg:border-b-0 lg:border-r-2">
            <ChatPanel
              items={state.items}
              busy={state.busy}
              status={state.status}
              queued={[]}
              stopping={false}
              paused={false}
              mode="build"
              onModeChange={noop}
              onSend={noop}
              onAnswer={noop}
              onCancelQueued={noop}
              onStop={noop}
              onResumeQueue={noop}
              onOpenSecrets={noop}
              draft={state.draft}
              setDraft={noop}
              providerPref={{ provider: 'openrouter', usePlatform: true }}
              onProviderChange={noop}
              platformCreditsLeft={state.appBuilt ? 96 : 100}
            />
          </div>
          <div className="min-h-0 min-w-0 flex-1 p-2 md:p-3">
            <PreviewPanel
              url={null}
              reloadToken={state.appBuilt ? 1 : 0}
              onManualReload={noop}
              building={state.busy}
              appBuilt={state.appBuilt}
              progress={state.progress}
              previewImage={state.appBuilt ? '/sites/yoga.jpg' : undefined}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause demo' : 'Play demo'}
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-white/80 bg-white text-[#1c1d1a] transition-transform hover:bg-[var(--lime)] active:translate-y-px"
          >
            {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setT(0);
              setPlaying(true);
            }}
            aria-label="Replay demo"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-white/80 bg-white text-[#1c1d1a] transition-transform hover:bg-[var(--lime)] active:translate-y-px"
          >
            <ArrowCounterClockwise size={14} weight="bold" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 gap-2">
          {PHASE_MARKS.map((mark, index) => {
            const end = PHASE_MARKS[index + 1]?.at ?? DONE;
            const fill = Math.max(0, Math.min(1, (t - mark.at) / (end - mark.at)));
            const current = t >= mark.at && t < end;
            return (
              <button
                key={mark.label}
                type="button"
                onClick={() => setT(mark.at)}
                className="group flex min-w-0 flex-1 flex-col gap-1.5 text-left"
                aria-label={`Jump to ${mark.label}`}
              >
                <span className={`truncate text-[11.5px] font-bold uppercase ${current ? 'text-white' : 'text-white/45 group-hover:text-white'}`}>
                  {mark.label}
                </span>
                <span className="relative h-2 overflow-hidden rounded-[3px] bg-white/15">
                  <span className="absolute inset-y-0 left-0 bg-[var(--lime)]" style={{ width: `${fill * 100}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
