'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { isAuthError, type ByokProvider, type ProviderPreference } from '@/lib/byok';
import type { AgentMode, ChatItem } from '@/lib/types';
import Composer from './Composer';

export default function ChatPanel({
  items,
  busy,
  status,
  queued,
  stopping,
  paused,
  mode,
  onModeChange,
  onSend,
  onAnswer,
  onCancelQueued,
  onStop,
  onResumeQueue,
  onOpenSecrets,
  onOpenByok,
  hasEarlier,
  loadingEarlier,
  onLoadEarlier,
  draft,
  setDraft,
  providerPref,
  onProviderChange,
}: {
  items: ChatItem[];
  busy: boolean;
  status: string | null;
    queued: { id: string; text: string }[];
  stopping: boolean;
  paused: boolean;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  onSend: (query: string) => void;
  onAnswer: (questionId: string, answer: string) => void;
  onCancelQueued: (id: string) => void;
  onStop: () => void;
  onResumeQueue: () => void;
  onOpenSecrets: () => void;
  onOpenByok?: () => void;
    hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  draft: string;
  setDraft: (value: string) => void;
  providerPref: ProviderPreference | null;
  onProviderChange: (provider: ByokProvider, usePlatform: boolean) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const firstIdRef = useRef<string | null>(null);

  useEffect(() => {
    const firstId = items[0]?.id ?? null;

    const prepended = firstIdRef.current !== null && firstId !== firstIdRef.current;
    firstIdRef.current = firstId;

    if (prepended) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items, status]);

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {}
        {hasEarlier && (
          <div className="flex justify-center pb-1">
            <button
              onClick={onLoadEarlier}
              disabled={loadingEarlier}
              className="rounded-md border px-3 py-1 text-[11px] transition hover:opacity-80 disabled:opacity-40"
              style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
            >
              {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}

        {items.map((item) => (
          <ChatRow
            key={item.id}
            item={item}
            onAnswer={onAnswer}
            onOpenSecrets={onOpenSecrets}
            onOpenByok={onOpenByok}
          />
        ))}

        {(status || busy) && (
          <div
            className="flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] shadow-sm transition-all"
            style={{
              borderColor: 'var(--accent)',
              background: 'var(--accent-soft)',
            }}
          >
            <div className="relative flex h-2 w-2 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--accent)' }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
            </div>
            <span className="font-medium text-zinc-200">
              {status || 'Agent is working…'}
            </span>
            <div className="ml-auto flex items-center gap-1 opacity-60">
              <span className="inline-block h-1 w-1 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="inline-block h-1 w-1 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="inline-block h-1 w-1 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <Composer
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        stopping={stopping}
        paused={paused}
        queued={queued}
        mode={mode}
        onModeChange={onModeChange}
        onSend={onSend}
        onStop={onStop}
        onCancelQueued={onCancelQueued}
        onResumeQueue={onResumeQueue}
        providerPref={providerPref}
        onProviderChange={onProviderChange}
      />
    </>
  );
}

function ChatRow({
  item,
  onAnswer,
  onOpenSecrets,
  onOpenByok,
}: {
  item: ChatItem;
  onAnswer: (id: string, a: string) => void;
  onOpenSecrets: () => void;
  onOpenByok?: () => void;
}) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-3 text-[13px] shadow-lg"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--line-strong)' }}
        >
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === 'assistant') {
    if (isAuthError(item.text)) {
      return (
        <div className="relative overflow-hidden rounded-xl border border-red-900/40 bg-[#1a0a0a]/80 p-4 shadow-lg backdrop-blur-sm">
          <div className="absolute top-0 left-0 h-full w-1 bg-red-500/50" />
          <div className="pl-2">
            <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-red-400">
              <span>Authentication Required</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">
              {item.text}
            </p>
            <div className="mt-4 flex items-center gap-4">
              {onOpenByok && (
                <button
                  onClick={onOpenByok}
                  className="group flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-[12px] font-bold text-red-300 transition-all hover:bg-red-500/20 hover:text-white"
                >
                  <span>Configure API Key</span>
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              )}
              <span className="text-[11px] font-medium text-red-300/40 uppercase tracking-widest">
                OpenRouter or Gemini
              </span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="text-sm leading-relaxed text-zinc-200">
        <ReactMarkdown
          components={{
            strong: ({ node, ...props }) => <strong className="font-bold text-white" {...props} />,
            p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
            ul: ({ node, ...props }) => <ul className="mb-2 list-disc pl-5 last:mb-0" {...props} />,
            ol: ({ node, ...props }) => <ol className="mb-2 list-decimal pl-5 last:mb-0" {...props} />,
            li: ({ node, ...props }) => <li className="leading-snug" {...props} />,
            code: ({ node, className, ...props }) => {
              const isBlock = className?.includes('language-') || (props.children && String(props.children).includes('\n'));
              return !isBlock ? (
                <code className="rounded bg-white/10 px-1 py-0.5 text-xs text-white" {...props} />
              ) : (
                <code className={`block rounded-lg bg-black/50 p-3 text-xs overflow-x-auto my-4 text-white ${className || ''}`} {...props} />
              );
            },
            pre: ({ node, ...props }) => <pre className="!m-0 !p-0 bg-transparent" {...props} />,
          }}
        >
          {item.text}
        </ReactMarkdown>
        {item.streaming && (
          <span
            className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm align-middle"
            style={{ background: 'var(--accent)' }}
          />
        )}
      </div>
    );
  }

  if (item.kind === 'tool') return <ToolRow item={item} />;

  if (item.kind === 'question') return <QuestionCard item={item} onAnswer={onAnswer} />;

  if (item.kind === 'compaction') return <CompactionRow item={item} />;

  if (item.kind === 'secrets') return <SecretsCard item={item} onOpenSecrets={onOpenSecrets} />;

  if (item.kind === 'verification') return <VerificationRow item={item} />;

  if (item.kind === 'clientErrors') return <ClientErrorsRow item={item} />;

  if (item.kind === 'error') {
    if (isAuthError(item.message)) {
      return (
        <div className="relative overflow-hidden rounded-xl border border-red-900/40 bg-[#1a0a0a]/80 p-4 shadow-lg backdrop-blur-sm">
          <div className="absolute top-0 left-0 h-full w-1 bg-red-500/50" />
          <div className="pl-2">
            <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-red-400">
              <span>Authentication Required</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">
              {item.message}
            </p>
            {onOpenByok && (
              <div className="mt-4 flex items-center gap-4">
                <button
                  onClick={onOpenByok}
                  className="group flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-[12px] font-bold text-red-300 transition-all hover:bg-red-500/20 hover:text-white"
                >
                  <span>Configure API Key</span>
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
                <span className="text-[11px] font-medium text-red-300/40 uppercase tracking-widest">
                  OpenRouter or Gemini
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-3.5 py-2.5 text-xs text-red-300">
        {item.message}
      </div>
    );
  }

  return (
    <p className="text-xs" style={{ color: 'var(--muted)' }}>
      {item.stage}
    </p>
  );
}

function QuestionCard({
  item,
  onAnswer,
}: {
  item: Extract<ChatItem, { kind: 'question' }>;
  onAnswer: (questionId: string, answer: string) => void;
}) {
  const answered = Boolean(item.answer);

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: answered ? 'var(--line)' : 'var(--accent)', background: 'var(--panel-2)' }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2"
        style={{
          background: answered ? 'transparent' : 'var(--accent-soft)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-black"
          style={{ background: answered ? 'var(--muted)' : 'var(--accent)' }}
        >
          {answered ? '✓' : '?'}
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: answered ? 'var(--muted)' : 'var(--accent)' }}
        >
          {answered ? 'Answered' : 'Needs your input'}
        </span>
      </div>

      <div className="p-3.5">
        <p className="mb-3 text-sm font-medium leading-relaxed">{item.question}</p>

        {answered ? (
          <div
            className="flex items-start gap-2.5 rounded-lg border px-3 py-2"
            style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
          >
            <span className="mt-px shrink-0 text-xs" style={{ color: 'var(--accent)' }}>
              ✓
            </span>
            <span className="text-xs leading-relaxed">{item.answer}</span>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {item.options.map((option, index) => (
              <button
                key={option}
                onClick={() => onAnswer(item.questionId, option)}
                className="group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition"
                style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.background = 'var(--accent-soft)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.background = 'var(--panel)';
                }}
              >
                <span
                  className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold"
                  style={{ background: 'var(--line)', color: 'var(--muted)' }}
                >
                  {index + 1}
                </span>
                <span className="flex-1 text-xs leading-relaxed">{option}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CompactionRow({ item }: { item: Extract<ChatItem, { kind: 'compaction' }> }) {
  const [open, setOpen] = useState(false);
  const pct = item.contextWindow > 0 ? Math.round((item.tokensBefore / item.contextWindow) * 100) : 0;
  const saved = Math.max(0, item.tokensBefore - item.tokensAfter);

  return (
    <div
      className="overflow-hidden rounded-lg border text-xs"
      style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}
    >
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <span style={{ color: 'var(--accent)' }}>{item.full ? '⇊' : '⇡'}</span>
        <span className="min-w-0 flex-1">
          {item.full ? 'Conversation fully summarized' : 'Context compacted'}
          {item.midStream && ' mid-response'}
          <span style={{ color: 'var(--muted)' }}>
            {' '}
            · {pct}% full · freed {saved.toLocaleString()} tokens
          </span>
        </span>
        <span style={{ color: 'var(--muted)' }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <pre
          className="max-h-72 overflow-auto whitespace-pre-wrap border-t px-2.5 py-2 text-[11px] leading-relaxed opacity-80"
          style={{ borderColor: 'var(--line)' }}
        >
          {item.summary}
        </pre>
      )}
    </div>
  );
}

function SecretsCard({
  item,
  onOpenSecrets,
}: {
  item: Extract<ChatItem, { kind: 'secrets' }>;
  onOpenSecrets: () => void;
}) {
  const provided = new Set(item.provided);
  const outstanding = item.secrets.filter((secret) => !provided.has(secret.key));
  const allDone = outstanding.length === 0;

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: allDone ? 'var(--line)' : 'var(--accent)',
        background: 'var(--panel-2)',
      }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2"
        style={{
          background: allDone ? 'transparent' : 'var(--accent-soft)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-black"
          style={{ background: allDone ? 'var(--muted)' : 'var(--accent)' }}
        >
          {allDone ? '✓' : '!'}
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: allDone ? 'var(--muted)' : 'var(--accent)' }}
        >
          {allDone ? 'All keys provided' : `${outstanding.length} key${outstanding.length === 1 ? '' : 's'} needed`}
        </span>
      </div>

      <div className="space-y-2.5 p-3.5">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          {allDone
            ? 'Everything this project needs has been provided.'
            : 'This project needs these values before those features will work. Without them nothing errors — the feature just does nothing.'}
        </p>

        <div className="space-y-1.5">
          {item.secrets.map((secret) => {
            const done = provided.has(secret.key);
            return (
              <div key={secret.key} className="flex items-start gap-2">
                <code
                  className="shrink-0 rounded-md border px-2 py-1 font-mono text-[11px] font-semibold"
                  style={{
                    borderColor: done ? 'var(--line)' : 'var(--accent)',
                    background: done ? 'transparent' : 'var(--accent-soft)',
                    color: done ? 'var(--muted)' : 'var(--accent)',
                    textDecoration: done ? 'line-through' : 'none',
                  }}
                >
                  {secret.key}
                </code>
                <span className="min-w-0 flex-1 pt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {done ? 'provided' : secret.reason}
                </span>
              </div>
            );
          })}
        </div>

        {!allDone && (
          <button
            onClick={onOpenSecrets}
            className="w-full rounded-lg px-3 py-2 text-xs font-medium text-black transition"
            style={{ background: 'var(--accent)' }}
          >
            Add {outstanding.length === 1 ? 'this key' : 'these keys'}
          </button>
        )}
      </div>
    </div>
  );
}

function VerificationRow({ item }: { item: Extract<ChatItem, { kind: 'verification' }> }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(item.typecheckOutput) || item.runtimeErrors.length > 0;

  const label = item.ok
    ? item.typecheckPassed === null
      ? 'No type errors to check · dev server clean'
      : 'Typecheck passed · dev server clean'
    : item.typecheckPassed === false
      ? 'Typecheck failed'
      : `${item.runtimeErrors.length} runtime error${item.runtimeErrors.length === 1 ? '' : 's'}`;

  return (
    <div
      className="overflow-hidden rounded-lg border text-xs"
      style={{
        borderColor: item.ok ? 'var(--line)' : 'rgba(248,113,113,0.35)',
        background: item.ok ? 'var(--panel-2)' : 'rgba(127,29,29,0.18)',
      }}
    >
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span style={{ color: item.ok ? 'var(--accent)' : '#f87171' }}>{item.ok ? '✓' : '✕'}</span>
        <span className="min-w-0 flex-1" style={{ color: item.ok ? 'var(--muted)' : '#fca5a5' }}>
          {label}
        </span>
        {hasDetail && <span style={{ color: 'var(--muted)' }}>{open ? '−' : '+'}</span>}
      </button>

      {open && hasDetail && (
        <div className="border-t" style={{ borderColor: 'var(--line)' }}>
          {item.typecheckOutput && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-relaxed opacity-80">
              {item.typecheckOutput}
            </pre>
          )}
          {item.runtimeErrors.length > 0 && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t px-2.5 py-2 font-mono text-[11px] leading-relaxed opacity-80" style={{ borderColor: 'var(--line)' }}>
              {item.runtimeErrors.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ClientErrorsRow({ item }: { item: Extract<ChatItem, { kind: 'clientErrors' }> }) {
  const [open, setOpen] = useState(false);
  const errorCount = item.errors.filter((e) => e.level === 'error').length;

  return (
    <div
      className="overflow-hidden rounded-lg border text-xs"
      style={{ borderColor: 'rgba(251,191,36,0.35)', background: 'rgba(120,53,15,0.18)' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="text-amber-400 font-bold">!</span>
        <span className="min-w-0 flex-1 text-amber-200">
          {item.errors.length} browser {item.errors.length === 1 ? 'issue' : 'issues'} in the preview
          {errorCount > 0 && ` · ${errorCount} error${errorCount === 1 ? '' : 's'}`}
        </span>
        <span style={{ color: 'var(--muted)' }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="max-h-56 space-y-1.5 overflow-auto border-t px-2.5 py-2" style={{ borderColor: 'var(--line)' }}>
          {item.errors.map((error, index) => (
            <div key={index} className="font-mono text-[11px] leading-relaxed">
              <span className={error.level === 'error' ? 'text-red-300' : 'text-amber-300'}>
                <span className="text-xs font-bold">{error.level === 'error' ? '✕' : '!'}</span>
              </span>{' '}
              <span className="opacity-80">{error.message}</span>
              {error.source && (
                <span className="opacity-40"> · {error.source}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const pending = item.result === undefined;

  return (
    <div
      className="overflow-hidden rounded-lg border text-xs transition-all"
      style={{
        borderColor: pending
          ? 'rgba(255, 94, 54, 0.35)'
          : item.isError
            ? 'rgba(248,113,113,0.35)'
            : 'var(--line)',
        background: pending ? 'rgba(255, 94, 54, 0.04)' : 'var(--panel-2)',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="flex items-center justify-center" style={{ color: item.isError ? '#f87171' : 'var(--accent)' }}>
          {pending ? (
            <span
              className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2"
              style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
            />
          ) : item.isError ? (
            '✕'
          ) : (
            '✓'
          )}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono opacity-80">{item.args}</code>
        {pending && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            Running…
          </span>
        )}
        {!pending && <span style={{ color: 'var(--muted)' }}>{open ? '−' : '+'}</span>}
      </button>

      {open && !pending && (
        <pre
          className="max-h-64 overflow-auto border-t px-2.5 py-2 font-mono text-[11px] leading-relaxed opacity-70"
          style={{ borderColor: 'var(--line)' }}
        >
          {item.result}
        </pre>
      )}
    </div>
  );
}
