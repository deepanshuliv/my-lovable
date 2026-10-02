'use client';

import { ArrowUp, CaretUp, Check, Hammer, ListChecks, Stop, X } from '@phosphor-icons/react';
import { useRef, useEffect } from 'react';
import type { AgentMode } from '@/lib/types';
import { MODES, PROVIDERS, providerLabel, type ByokProvider, type ProviderPreference } from '@/lib/byok';
import Dropdown, { type DropdownGroup } from './Dropdown';

export default function Composer({
  draft,
  setDraft,
  busy,
  stopping,
  paused,
  queued,
  mode,
  onModeChange,
  onSend,
  onStop,
  onCancelQueued,
  onResumeQueue,
  providerPref,
  onProviderChange,
  platformCreditsLeft,
  savedKeyProviders,
}: {
  draft: string;
  setDraft: (value: string) => void;
  busy: boolean;
  stopping: boolean;
  paused: boolean;
  queued: { id: string; text: string }[];
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  onSend: (query: string) => void;
  onStop: () => void;
  onCancelQueued: (id: string) => void;
  onResumeQueue: () => void;
  providerPref: ProviderPreference | null;
  onProviderChange: (provider: ByokProvider, usePlatform: boolean) => void;
  platformCreditsLeft?: number | null;
  savedKeyProviders?: string[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';

      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [draft]);

  const submit = () => {
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  };

  const currentModeOption = MODES.find((m) => m.id === mode) || MODES[0]!;
  const selectedMark = (on: boolean) => (on ? <Check size={13} weight="bold" className="text-[var(--accent-text)]" /> : <span className="w-[13px]" />);

  const modeGroups: DropdownGroup[] = [
    {
      items: MODES.map((option) => ({
        id: option.id,
        label: option.label,
        secondary: option.hint,
        icon: selectedMark(mode === option.id),
        onClick: () => onModeChange(option.id),
      })),
    },
  ];

  const creditsLabel =
    typeof platformCreditsLeft === 'number' ? `${platformCreditsLeft} free credits left` : 'Uses your free credits';
  const savedProviders = new Set(savedKeyProviders ?? []);

  const providerGroups: DropdownGroup[] = [
    {
      title: 'Included',
      items: [
        {
          id: 'platform',
          label: 'Free credits',
          secondary: creditsLabel,
          icon: selectedMark(Boolean(providerPref?.usePlatform)),
          onClick: () => onProviderChange('openrouter', true),
        },
      ],
    },
    {
      title: 'Your own key',
      items: PROVIDERS.map((p) => ({
        id: `byok-${p.id}`,
        label: p.label,
        secondary: savedProviders.has(p.id) ? 'Key saved' : 'Add your key',
        icon: selectedMark(!providerPref?.usePlatform && providerPref?.provider === p.id),
        onClick: () => onProviderChange(p.id, false),
      })),
    },
  ];

  const activeLabel = providerPref?.usePlatform
    ? 'Free credits'
    : `${providerLabel(providerPref?.provider ?? 'openrouter')} key`;
  const ModeIcon = mode === 'plan' ? ListChecks : Hammer;

  return (
    <div className="shrink-0 border-t border-[var(--line)] bg-[var(--bg)] p-3">
      {queued.length > 0 && (
        <div className="mb-2.5 space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] text-[var(--muted)]">
              {paused ? `Paused. ${queued.length} waiting.` : `Up next (${queued.length})`}
            </span>
            {paused && (
              <button onClick={onResumeQueue} className="text-[12px] font-medium text-[var(--accent-text)] hover:underline">
                Continue
              </button>
            )}
          </div>
          {queued.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-[10px] border-2 border-[var(--edge)] bg-[var(--cream)] py-1.5 pl-3 pr-1.5 text-[12.5px] font-medium"
            >
              <span className="min-w-0 flex-1 truncate" title={item.text}>
                {item.text}
              </span>
              <button
                onClick={() => onCancelQueued(item.id)}
                aria-label="Remove from queue"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-[var(--tint)] hover:text-[var(--text)]"
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] shadow-[var(--hard)] transition-shadow focus-within:shadow-[var(--hard),0_0_0_5px_var(--accent-ring)]">
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <textarea
          id="composer-input"
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={
            busy
              ? 'Add another request. It runs after this one.'
              : mode === 'plan'
                ? 'Describe what you want planned first'
                : 'Ask for a change, like "make the header blue"'
          }
          className="w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[13.5px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--faint)]"
        />

        <div className="flex items-center justify-between gap-2 p-2 pt-0">
          <div className="flex min-w-0 items-center gap-0.5">
            <Dropdown
              groups={modeGroups}
              align="left"
              direction="up"
              width={240}
              trigger={
                <button className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-bold text-[var(--muted)] transition-colors hover:bg-[var(--tint)] hover:text-[var(--text)]" title="Build changes the app. Plan only suggests.">
                  <ModeIcon size={13} weight="bold" className={mode === 'build' ? 'text-[var(--accent-text)]' : ''} />
                  {currentModeOption.label}
                  <CaretUp size={10} weight="bold" className="opacity-60" />
                </button>
              }
            />

            <Dropdown
              groups={providerGroups}
              align="left"
              direction="up"
              width={240}
              trigger={
                <button className="flex min-w-0 items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-bold text-[var(--muted)] transition-colors hover:bg-[var(--tint)] hover:text-[var(--text)]" title="Which AI model to use">
                  <span className="truncate font-medium text-[var(--text)]/80">{activeLabel}</span>
                  <CaretUp size={10} weight="bold" className="shrink-0 opacity-60" />
                </button>
              }
            />
          </div>

          {busy ? (
            <button
              onClick={onStop}
              disabled={stopping}
              className="btn-secondary btn-sm shrink-0 hover:!border-[var(--error)]/40 hover:!text-[var(--error)]"
            >
              <Stop size={12} weight="fill" />
              {stopping ? 'Stopping' : 'Stop'}
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!draft.trim()}
              aria-label="Send"
              className="btn-primary h-9 w-9 shrink-0 !rounded-[9px] !p-0"
            >
              <ArrowUp size={15} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
