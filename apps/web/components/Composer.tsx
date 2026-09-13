'use client';

import { useRef, useEffect } from 'react';
import type { AgentMode } from '@/lib/types';
import { MODES, type ByokProvider, type ProviderPreference } from '@/lib/byok';
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

  const modeGroups: DropdownGroup[] = [
    {
      items: MODES.map((option) => ({
        id: option.id,
        label: option.label,
        secondary: option.hint,
        icon: mode === option.id ? <span className="text-[var(--accent)] text-sm font-bold">·</span> : <span className="w-4" />,
        onClick: () => onModeChange(option.id),
      })),
    },
  ];

  const providerGroups: DropdownGroup[] = [
    {
      title: 'Google Gemini',
      items: [
        {
          id: 'gemini-byok',
          label: 'Gemini',
          secondary: 'My API key',
          icon: providerPref?.provider === 'gemini' && !providerPref?.usePlatform ? <span className="text-[var(--accent)] text-sm font-bold">·</span> : <span className="w-4" />,
          onClick: () => onProviderChange('gemini', false),
        },
        {
          id: 'gemini-platform',
          label: 'Gemini',
          secondary: 'Platform credits',
          icon: providerPref?.provider === 'gemini' && providerPref?.usePlatform ? <span className="text-[var(--accent)] text-sm font-bold">·</span> : <span className="w-4" />,
          onClick: () => onProviderChange('gemini', true),
        }
      ]
    },
    {
      title: 'OpenRouter',
      items: [
        {
          id: 'or-byok',
          label: 'OpenRouter',
          secondary: 'My API key',
          icon: providerPref?.provider === 'openrouter' && !providerPref?.usePlatform ? <span className="text-[var(--accent)] text-sm font-bold">·</span> : <span className="w-4" />,
          onClick: () => onProviderChange('openrouter', false),
        },
        {
          id: 'or-platform',
          label: 'OpenRouter',
          secondary: 'Platform credits',
          icon: providerPref?.provider === 'openrouter' && providerPref?.usePlatform ? <span className="text-[var(--accent)] text-sm font-bold">·</span> : <span className="w-4" />,
          onClick: () => onProviderChange('openrouter', true),
        }
      ]
    }
  ];

  const activeProviderLabel = providerPref?.provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
  const activeSourceLabel = providerPref?.usePlatform ? 'Platform credits' : 'My API key';

  return (
    <div className="shrink-0 border-t p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      {queued.length > 0 && (
        <div className="mb-3 space-y-1">
          {paused && (
            <div className="flex items-center justify-between px-0.5 pb-1">
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                paused — {queued.length} waiting
              </span>
              <button
                onClick={onResumeQueue}
                className="text-[11px] underline underline-offset-2 transition hover:opacity-70"
                style={{ color: 'var(--accent)' }}
              >
                Run them
              </button>
            </div>
          )}
          {queued.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm"
              style={{
                borderColor: 'var(--line)',
                background: 'var(--panel-2)',
                color: 'var(--muted)',
              }}
            >
              <span className="shrink-0 font-bold" style={{ color: 'var(--accent)' }}>·</span>
              <span className="min-w-0 flex-1 truncate" title={item.text}>{item.text}</span>
              <button
                onClick={() => onCancelQueued(item.id)}
                className="shrink-0 opacity-40 transition hover:opacity-100"
                title="Remove from queue"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className="flex flex-col rounded-xl border shadow-sm transition-all focus-within:border-[var(--accent)]/30 focus-within:ring-4 focus-within:ring-[var(--accent)]/10"
        style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }}
      >
        <textarea
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
              ? 'Add another instruction — it will run next…'
              : mode === 'plan'
                ? 'Describe what you want planned…'
                : 'Ask for a change…'
          }
          className="w-full resize-none bg-transparent p-3.5 text-[13px] leading-relaxed text-zinc-200 outline-none placeholder:opacity-35"
        />

        <div className="flex items-center justify-between p-2 pt-0">
          <div className="flex items-center gap-2">
            <Dropdown
              groups={modeGroups}
              align="left"
              direction="up"
              width={220}
              trigger={
                <button
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition hover:bg-zinc-800/50"
                  style={{ color: 'var(--muted)' }}
                  title="Select mode"
                >
                  <div className={`h-1.5 w-1.5 rounded-full ${mode === 'build' ? 'bg-[var(--accent)]' : 'bg-purple-400'}`} />
                  <span>{currentModeOption.label}</span>
                  <span className="text-[8px] opacity-60">▼</span>
                </button>
              }
            />

            <div className="h-3 w-px bg-zinc-700/50" />

            <Dropdown
              groups={providerGroups}
              align="left"
              direction="up"
              width={240}
              trigger={
                <button
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition hover:bg-zinc-800/50"
                  style={{ color: 'var(--muted)' }}
                  title="Select AI Provider"
                >
                  <span className="text-zinc-300">{activeProviderLabel}</span>
                  <span className="opacity-50">·</span>
                  <span className="opacity-70">{activeSourceLabel}</span>
                  <span className="text-[8px] opacity-60">▼</span>
                </button>
              }
            />
          </div>

          <div className="flex items-center gap-2">
            {busy ? (
              <button
                onClick={onStop}
                disabled={stopping}
                className="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition hover:bg-red-950/30 hover:text-red-400 hover:border-red-900/50 disabled:opacity-50"
                style={{ borderColor: 'var(--line)', color: 'var(--muted)', background: 'var(--panel)' }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[2px]"
                  style={{ background: stopping ? 'var(--muted)' : '#f87171' }}
                />
                {stopping ? 'Stopping…' : 'Stop'}
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="btn-primary px-4 py-1.5 text-[12px] min-w-[80px]"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
