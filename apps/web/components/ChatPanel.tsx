'use client';

import {
  ArrowRight,
  CaretDown,
  Check,
  CheckCircle,
  Coins,
  FilePlus,
  FileText,
  FolderOpen,
  ImageSquare,
  Key,
  MagnifyingGlass,
  PencilSimple,
  Question,
  Sparkle,
  TerminalWindow,
  Warning,
  WarningCircle,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { freeModelIssue, isAuthError, PROVIDERS, type ByokProvider, type FreeModelIssue, type ProviderPreference } from '@/lib/byok';
import { showsOutput, summarize, toolKind, toolVerb, type ToolKind } from '@/lib/tools';
import type { AgentMode, ChatItem } from '@/lib/types';
import Composer from './Composer';
import { RequestCredits } from './Credits';
import { useCredits } from '@/lib/useCredits';
import KeysCard from './KeysCard';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

type Row = { type: 'item'; item: ChatItem } | { type: 'tools'; id: string; tools: ToolItem[] };

function groupRows(items: ChatItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.kind === 'tool') {
      if (last && last.type === 'tools') last.tools.push(item);
      else rows.push({ type: 'tools', id: `g-${item.id}`, tools: [item] });
    } else {
      rows.push({ type: 'item', item });
    }
  }
  return rows;
}

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
  platformCreditsLeft,
  savedKeyProviders,
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
  platformCreditsLeft?: number | null;
  savedKeyProviders?: string[];
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const firstIdRef = useRef<string | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const firstId = items[0]?.id ?? null;

    const prepended = firstIdRef.current !== null && firstId !== firstIdRef.current;
    firstIdRef.current = firstId;

    if (prepended) return;
    if (items[items.length - 1]?.kind === 'user') stickRef.current = true;
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [items, status]);

  const rows = groupRows(items);
  const lastRow = rows[rows.length - 1];
  const liveGroup = busy && lastRow?.type === 'tools';
  const streamingText = lastRow?.type === 'item' && lastRow.item.kind === 'assistant' && lastRow.item.streaming;
  const showStatus = (busy || Boolean(status)) && !liveGroup && !streamingText;

  return (
    <>
      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5"
      >
        {hasEarlier && (
          <div className="flex justify-center">
            <button onClick={onLoadEarlier} disabled={loadingEarlier} className="btn-ghost btn-sm">
              {loadingEarlier ? 'Loading…' : 'Show earlier messages'}
            </button>
          </div>
        )}

        {rows.length === 0 && !busy && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <Sparkle size={22} weight="duotone" className="text-[var(--accent-text)]" />
            <p className="mt-3 text-[15px] font-semibold">What should we make?</p>
            <p className="mt-1 max-w-[30ch] text-[13px] leading-relaxed text-[var(--muted)]">
              Describe it below in your own words. You can change anything later.
            </p>
          </div>
        )}

        {rows.map((row, index) =>
          row.type === 'tools' ? (
            <ToolGroup
              key={row.id}
              tools={row.tools}
              live={(busy && index === rows.length - 1) || row.tools.some((tool) => tool.result === undefined && busy)}
            />
          ) : (
            <ChatRow
              key={row.item.id}
              item={row.item}
              onAnswer={onAnswer}
              onOpenSecrets={onOpenSecrets}
              onOpenByok={onOpenByok}
              usingFreeModel={!providerPref || providerPref.usePlatform}
            />
          ),
        )}

        {showStatus && <WorkingLine text={friendlyStatus(status)} />}

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
        platformCreditsLeft={platformCreditsLeft}
        savedKeyProviders={savedKeyProviders}
      />
    </>
  );
}

function friendlyStatus(status: string | null): string {
  if (!status || status === 'connecting') return 'Getting started';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-[var(--edge)] border-t-[var(--lime)]"
      style={{ width: size, height: size }}
    />
  );
}

function WorkingLine({ text }: { text: string }) {
  return (
    <div className="rise-in flex items-center gap-2.5 px-1 text-[13px]">
      <Spinner />
      <span className="demo-shimmer-text truncate font-medium">{text}</span>
    </div>
  );
}

const TOOL_ICONS: Record<ToolKind, Icon> = {
  read: FileText,
  write: FilePlus,
  edit: PencilSimple,
  list: FolderOpen,
  search: MagnifyingGlass,
  run: TerminalWindow,
  images: ImageSquare,
  other: Sparkle,
};

function ToolGroup({ tools, live }: { tools: ToolItem[]; live: boolean }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const open = manual ?? live;
  const failed = tools.filter((tool) => tool.isError).length;
  const count = tools.length;

  useEffect(() => {
    if (!live) setManual(null);
  }, [live]);

  useEffect(() => {
    if (open && live && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, live, count]);

  return (
    <div className="overflow-hidden rounded-[12px] border-2 border-[var(--edge)] bg-[var(--panel)]">
      <button
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--tint)]"
      >
        {live ? (
          <Spinner />
        ) : failed > 0 ? (
          <WarningCircle size={15} weight="fill" className="shrink-0 text-[var(--warning)]" />
        ) : (
          <CheckCircle size={15} weight="fill" className="shrink-0 text-[var(--accent-text)]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">
            {live ? 'Working' : `${count} ${count === 1 ? 'step' : 'steps'}`}
            {live && <span className="text-[var(--muted)]"> · {count} so far</span>}
          </span>
          {!live && (
            <span className="block truncate text-[12px] text-[var(--muted)]">
              {summarize(tools.map((tool) => tool.name))}
              {failed > 0 && <span className="text-[var(--warning)]">, {failed} needed a retry</span>}
            </span>
          )}
        </span>
        <CaretDown
          size={13}
          weight="bold"
          className={`shrink-0 text-[var(--muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div ref={listRef} className="max-h-[320px] overflow-y-auto border-t border-[var(--line)] py-1.5">
          {tools.map((tool) => (
            <ToolLine key={tool.id} item={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolLine({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const pending = item.result === undefined;
  const kind = toolKind(item.name);
  const ToolIcon = TOOL_ICONS[kind];
  const canExpand = !pending && showsOutput(item.name, item.isError) && Boolean(item.result?.trim());

  return (
    <div className="rise-in">
      <div className="flex items-center gap-2.5 px-3.5 py-1.5 text-[12.5px]">
        <ToolIcon size={14} className={`shrink-0 ${item.isError ? 'text-[var(--warning)]' : 'text-[var(--muted)]'}`} />
        <span className="shrink-0 text-[var(--muted)]">{toolVerb(kind, pending)}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--text)]/85" title={item.args}>
          {item.args}
        </code>
        {pending ? (
          <Spinner size={10} />
        ) : canExpand ? (
          <button
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 rounded-md px-2 py-2 text-[11px] text-[var(--muted)] sm:px-1.5 sm:py-0.5 transition-colors hover:bg-[var(--tint)] hover:text-[var(--text)]"
          >
            {open ? 'Hide' : item.isError ? 'Why' : 'Output'}
          </button>
        ) : item.isError ? (
          <X size={12} weight="bold" className="shrink-0 text-[var(--warning)]" />
        ) : (
          <Check size={12} weight="bold" className="shrink-0 text-[var(--faint)]" />
        )}
      </div>
      {open && (
        <pre className="mx-3.5 mb-2 max-h-56 overflow-auto rounded-[8px] bg-[var(--ink)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#d7f7a1]">
          {item.result}
        </pre>
      )}
    </div>
  );
}

function AuthCard({ message, onOpenByok }: { message: string; onOpenByok?: () => void }) {
  const [details, setDetails] = useState(false);

  return (
    <div className="rounded-[12px] border-2 border-[var(--edge)] bg-[var(--error-card)] p-4 shadow-[var(--hard)]">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--error)]">
        <Key size={15} weight="bold" />
        The AI could not start
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--text)]/85">
        The AI service did not accept the key it was given. Add your own key and the build starts again right away.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {onOpenByok && (
          <button onClick={onOpenByok} className="btn-primary btn-sm">
            Use my own key
            <ArrowRight size={13} weight="bold" />
          </button>
        )}
        <button onClick={() => setDetails((value) => !value)} className="btn-ghost btn-sm">
          {details ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {details && (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] bg-[var(--ink)] p-3 font-mono text-[11px] leading-relaxed text-[#d7f7a1]">
          {message}
        </pre>
      )}
    </div>
  );
}

function CreditsCard({ onOpenByok }: { onOpenByok?: () => void }) {
  const { credits } = useCredits();

  return (
    <div className="rounded-[12px] border-2 border-[var(--edge)] bg-[var(--warn-card)] p-4 shadow-[var(--hard)]">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--warning)]">
        <Coins size={16} weight="fill" />
        You are out of free credits
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--text)]/85">
        Your work so far is saved. To keep building, ask for more credits or use your own AI key.
      </p>
      <div className="mt-4 grid gap-2">
        <RequestCredits credits={credits} compact />
        {onOpenByok && (
          <button onClick={onOpenByok} className="btn-ghost btn-sm w-full">
            Use my own AI key instead
          </button>
        )}
      </div>
    </div>
  );
}

function freeResetTime(): string {
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

const FREE_ISSUE_COPY: Record<FreeModelIssue, { title: string; body: () => string }> = {
  daily: {
    title: 'The free AI is done for today',
    body: () => `The free AI can only do a set amount of work each day, and today's share is used up. Your project is saved. It comes back at ${freeResetTime()} your time.`,
  },
  busy: {
    title: 'The free AI is busy right now',
    body: () => 'Lots of people are building at the same time, so the free AI asked us to slow down. Your project is saved. Wait a minute, then send your message again.',
  },
  unavailable: {
    title: 'The free AI is taking a break',
    body: () => 'The free AI is not available at the moment. Your project is saved. Please try again a little later.',
  },
  other: {
    title: 'The free AI could not finish this step',
    body: () => 'Something went wrong on the free AI side, not in your app. Your project is saved. Send your message again to retry.',
  },
};

function FreeModelCard({ message, onOpenByok }: { message: string; onOpenByok?: () => void }) {
  const [details, setDetails] = useState(false);
  const issue = freeModelIssue(message);
  const copy = FREE_ISSUE_COPY[issue];

  return (
    <div className="overflow-hidden rounded-[12px] border-2 border-[var(--edge)] bg-[var(--panel)] shadow-[var(--hard)]">
      <div className="bg-[var(--warn-card)] p-4">
        <div className="flex items-center gap-2 text-[13.5px] font-bold">
          <WarningCircle size={16} weight="fill" className="shrink-0 text-[var(--warning)]" />
          {copy.title}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text)]/85">{copy.body()}</p>
        {issue === 'other' && (
          <button onClick={() => setDetails((value) => !value)} className="mt-2 text-[12px] font-bold text-[var(--muted)] underline underline-offset-2">
            {details ? 'Hide details' : 'Show details'}
          </button>
        )}
        {details && (
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-[8px] bg-[var(--ink)] p-3 font-mono text-[11px] leading-relaxed text-[#d7f7a1]">
            {message}
          </pre>
        )}
      </div>
      {onOpenByok && (
        <div className="border-t-2 border-[var(--edge)] p-4">
          <p className="text-[13px] font-bold">Don&rsquo;t want to wait?</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">
            Use your own AI key and keep building right away, with better designs too. It works with{' '}
            {PROVIDERS.map((provider) => provider.label).join(', ').replace(/, ([^,]*)$/, ' or $1')}.
          </p>
          <button onClick={onOpenByok} className="btn-primary btn-sm mt-3">
            <Key size={14} weight="bold" />
            Use my own AI key
          </button>
        </div>
      )}
    </div>
  );
}

function isCreditsMessage(text: string): boolean {
  return /free credits/i.test(text);
}

const markdownComponents = {
  strong: (props: React.ComponentProps<'strong'>) => <strong className="font-semibold text-[var(--text)]" {...props} />,
  p: (props: React.ComponentProps<'p'>) => <p className="mb-2.5 last:mb-0" {...props} />,
  ul: (props: React.ComponentProps<'ul'>) => <ul className="mb-2.5 list-disc space-y-1 pl-5 last:mb-0" {...props} />,
  ol: (props: React.ComponentProps<'ol'>) => <ol className="mb-2.5 list-decimal space-y-1 pl-5 last:mb-0" {...props} />,
  li: (props: React.ComponentProps<'li'>) => <li className="leading-relaxed" {...props} />,
  a: (props: React.ComponentProps<'a'>) => (
    <a className="text-[var(--accent-text)] underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
  ),
  code: ({ className, ...props }: React.ComponentProps<'code'>) => {
    const isBlock = className?.includes('language-') || String(props.children ?? '').includes('\n');
    return isBlock ? (
      <code
        className={`my-3 block overflow-x-auto rounded-[8px] bg-[var(--ink)] p-3 font-mono text-[12px] text-[#d7f7a1] ${className ?? ''}`}
        {...props}
      />
    ) : (
      <code className="rounded bg-[var(--tint)] px-1 py-0.5 font-mono text-[12px]" {...props} />
    );
  },
  pre: (props: React.ComponentProps<'pre'>) => <pre className="m-0 bg-transparent p-0" {...props} />,
};

function ChatRow({
  item,
  onAnswer,
  onOpenSecrets,
  onOpenByok,
  usingFreeModel = false,
}: {
  item: ChatItem;
  onAnswer: (id: string, a: string) => void;
  onOpenSecrets: () => void;
  onOpenByok?: () => void;
  usingFreeModel?: boolean;
}) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-[14px] rounded-br-[4px] border-2 border-[var(--edge)] bg-[var(--lime)] px-4 py-2.5 text-[14px] font-medium leading-relaxed shadow-[var(--hard-sm)]">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === 'assistant') {
    if (isCreditsMessage(item.text) && /used all/i.test(item.text)) return <CreditsCard onOpenByok={onOpenByok} />;
    if (isAuthError(item.text) && /\b401\b|unauthor|api[_ ]key|not found/i.test(item.text) && item.text.length < 600)
      return <AuthCard message={item.text} onOpenByok={onOpenByok} />;

    return (
      <div className="min-w-0 break-words text-[13.5px] leading-relaxed text-[var(--text)]/90 [overflow-wrap:anywhere]">
        <ReactMarkdown components={markdownComponents}>{item.text}</ReactMarkdown>
        {item.streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-[var(--accent)] align-middle" />
        )}
      </div>
    );
  }

  if (item.kind === 'tool') return null;

  if (item.kind === 'question') return <QuestionCard item={item} onAnswer={onAnswer} />;

  if (item.kind === 'compaction') return <CompactionRow item={item} />;

  if (item.kind === 'secrets') return <SecretsCard item={item} onOpenSecrets={onOpenSecrets} />;

  if (item.kind === 'keys') return <KeysCard item={item} />;

  if (item.kind === 'verification') return <VerificationRow item={item} />;

  if (item.kind === 'clientErrors') return <ClientErrorsRow item={item} />;

  if (item.kind === 'error') {
    if (isCreditsMessage(item.message)) return <CreditsCard onOpenByok={onOpenByok} />;
    if (usingFreeModel) return <FreeModelCard message={item.message} onOpenByok={onOpenByok} />;
    if (/usage limit/i.test(item.message)) {
      return (
        <div className="rounded-[12px] border-2 border-[var(--edge)] bg-[var(--warn-card)] p-4 shadow-[var(--hard)]">
          <div className="flex items-center gap-2 text-[13.5px] font-bold">
            <WarningCircle size={16} weight="fill" className="text-[var(--warning)]" />
            The free AI is busy right now
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text)]/85">{item.message}</p>
          {onOpenByok && (
            <button onClick={onOpenByok} className="btn-primary btn-sm mt-4">
              Use my own AI key
              <ArrowRight size={13} weight="bold" />
            </button>
          )}
        </div>
      );
    }
    if (isAuthError(item.message)) return <AuthCard message={item.message} onOpenByok={onOpenByok} />;

    return (
      <div className="flex items-start gap-2.5 rounded-[12px] border-2 border-[var(--edge)] bg-[var(--error-card)] px-3.5 py-3 text-[13px] leading-relaxed">
        <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-[var(--error)]" />
        <span className="min-w-0 break-words text-[var(--text)]/85">{item.message}</span>
      </div>
    );
  }

  return <p className="px-1 text-[12px] text-[var(--muted)]">{item.stage}</p>;
}

function CardHeader({ icon: HeaderIcon, label, active }: { icon: Icon; label: string; active: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5 text-[12.5px] font-medium ${
        active ? 'bg-[var(--lime)] font-bold text-[var(--ink)]' : 'text-[var(--muted)]'
      }`}
    >
      <HeaderIcon size={15} weight={active ? 'fill' : 'regular'} />
      {label}
    </div>
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
      className={`overflow-hidden rounded-[12px] border-2 bg-[var(--panel)] ${
        answered ? 'border-[var(--line-strong)]' : 'border-[var(--edge)] shadow-[var(--hard)]'
      }`}
    >
      <CardHeader icon={answered ? CheckCircle : Question} label={answered ? 'Answered' : 'Quick question'} active={!answered} />

      <div className="p-4">
        <p className="text-[14px] font-medium leading-relaxed">{item.question}</p>

        {answered ? (
          <p className="mt-3 flex items-start gap-2 rounded-[10px] border-2 border-[var(--edge)] bg-[var(--lime)] px-3 py-2.5 text-[13.5px] font-medium leading-relaxed">
            <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-[var(--accent-text)]" />
            {item.answer}
          </p>
        ) : (
          <div className="mt-3 grid gap-1.5">
            {item.options.map((option) => (
              <button
                key={option}
                onClick={() => onAnswer(item.questionId, option)}
                className="group flex w-full items-center gap-3 rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] px-3.5 py-2.5 text-left text-[13.5px] font-medium leading-relaxed transition-[background-color,transform] hover:-translate-y-px hover:bg-[var(--lime)] active:translate-y-px"
              >
                <span className="flex-1">{option}</span>
                <ArrowRight
                  size={13}
                  className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon: RowIcon,
  tone,
  label,
  children,
}: {
  icon: Icon;
  tone: 'ok' | 'warn' | 'bad' | 'quiet';
  label: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const color =
    tone === 'ok' ? 'var(--accent-text)' : tone === 'warn' ? 'var(--warning)' : tone === 'bad' ? 'var(--error)' : 'var(--muted)';

  return (
    <div className="overflow-hidden rounded-[12px] border-2 border-[var(--edge)] bg-[var(--panel)]">
      <button
        onClick={() => children && setOpen((value) => !value)}
        aria-expanded={children ? open : undefined}
        className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] ${children ? 'hover:bg-[var(--tint)]' : 'cursor-default'}`}
      >
        <RowIcon size={15} weight="fill" className="shrink-0" style={{ color }} />
        <span className="min-w-0 flex-1 text-[var(--text)]/85">{label}</span>
        {children && (
          <span className="shrink-0 text-[12px] text-[var(--muted)]">{open ? 'Hide details' : 'Details'}</span>
        )}
      </button>
      {open && children && <div className="border-t border-[var(--line)]">{children}</div>}
    </div>
  );
}

function CompactionRow({ item }: { item: Extract<ChatItem, { kind: 'compaction' }> }) {
  return (
    <DetailRow icon={Sparkle} tone="quiet" label="Tidied up the conversation so it can keep going">
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3.5 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
        {item.summary}
      </pre>
    </DetailRow>
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
      className={`overflow-hidden rounded-[12px] border-2 bg-[var(--panel)] ${
        allDone ? 'border-[var(--line-strong)]' : 'border-[var(--edge)] shadow-[var(--hard)]'
      }`}
    >
      <CardHeader
        icon={allDone ? CheckCircle : Key}
        label={allDone ? 'All settings added' : `${outstanding.length} ${outstanding.length === 1 ? 'setting' : 'settings'} needed`}
        active={!allDone}
      />

      <div className="space-y-3 p-4">
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {allDone
            ? 'Everything this project needs has been added.'
            : 'Some features need these values to work. Until you add them, those features stay switched off.'}
        </p>

        <ul className="space-y-2">
          {item.secrets.map((secret) => {
            const done = provided.has(secret.key);
            return (
              <li key={secret.key} className="flex items-start gap-2.5">
                {done ? (
                  <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-[var(--accent-text)]" />
                ) : (
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                )}
                <span className="min-w-0 text-[12.5px] leading-relaxed">
                  <code className={`font-mono text-[12px] ${done ? 'text-[var(--muted)] line-through' : 'text-[var(--text)]'}`}>
                    {secret.key}
                  </code>
                  {!done && secret.reason && <span className="text-[var(--muted)]">: {secret.reason}</span>}
                </span>
              </li>
            );
          })}
        </ul>

        {!allDone && (
          <button onClick={onOpenSecrets} className="btn-primary btn-sm w-full">
            Add {outstanding.length === 1 ? 'it' : 'them'} now
          </button>
        )}
      </div>
    </div>
  );
}

function VerificationRow({ item }: { item: Extract<ChatItem, { kind: 'verification' }> }) {
  const hasDetail = Boolean(item.typecheckOutput) || item.runtimeErrors.length > 0;
  const problems = item.runtimeErrors.length + (item.typecheckPassed === false ? 1 : 0);

  const label = item.ok
    ? 'Checked your app: every page loads without errors'
    : `Found ${problems === 1 ? 'a problem' : `${problems} problems`} while checking, working on a fix`;

  return (
    <DetailRow icon={item.ok ? CheckCircle : WarningCircle} tone={item.ok ? 'ok' : 'warn'} label={label}>
      {hasDetail ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3.5 py-3 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
          {[item.typecheckOutput, ...item.runtimeErrors].filter(Boolean).join('\n\n')}
        </pre>
      ) : undefined}
    </DetailRow>
  );
}

function ClientErrorsRow({ item }: { item: Extract<ChatItem, { kind: 'clientErrors' }> }) {
  const count = item.errors.length;

  return (
    <DetailRow
      icon={Warning}
      tone="warn"
      label={`The preview reported ${count === 1 ? 'a problem' : `${count} problems`}. They were passed on to be fixed.`}
    >
      <div className="max-h-56 space-y-2 overflow-auto px-3.5 py-3">
        {item.errors.map((error, index) => (
          <p key={index} className="font-mono text-[11px] leading-relaxed text-[var(--muted)]">
            <span className={error.level === 'error' ? 'text-[var(--error)]' : 'text-[var(--warning)]'}>
              {error.level === 'error' ? 'error' : 'warning'}
            </span>{' '}
            {error.message}
            {error.source && <span className="text-[var(--faint)]"> ({error.source})</span>}
          </p>
        ))}
      </div>
    </DetailRow>
  );
}
