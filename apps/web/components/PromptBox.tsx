'use client';

import type { RefObject } from 'react';
import { LimeButton } from './lime';

export const EXAMPLE_PROMPTS = [
  'Booking page for my yoga classes',
  'Online shop for handmade candles',
  'Recipe box my family can add to',
  'Wedding RSVP with a guest list',
  'Habit tracker with weekly streaks',
];

export default function PromptBox({
  id,
  value,
  onChange,
  onSubmit,
  busy = false,
  error,
  inputRef,
  placeholder = 'Describe your app in a sentence or two',
  examples = EXAMPLE_PROMPTS,
  hint,
  align = 'left',
  size = 'lg',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  examples?: string[];
  hint?: string;
  align?: 'left' | 'center';
  size?: 'md' | 'lg';
}) {
  return (
    <div className="w-full">
      <label htmlFor={id} className="sr-only">
        Describe the app you want
      </label>
      <div className="rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] p-2 shadow-[var(--hard-lg)] transition-shadow focus-within:shadow-[var(--hard-lg),0_0_0_6px_var(--accent-ring)]">
        <textarea
          id={id}
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={size === 'lg' ? 3 : 2}
          placeholder={placeholder}
          className={`block w-full resize-none bg-transparent px-3 pt-2 font-medium leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--faint)] ${
            size === 'lg' ? 'text-[16px]' : 'text-[15px]'
          }`}
        />
        <div className="flex items-center justify-between gap-3 pl-3">
          <span className="text-[12.5px] font-medium text-[var(--muted)]">{hint ?? 'Press Enter to start'}</span>
          <LimeButton onClick={onSubmit} disabled={busy}>
            {busy ? 'Starting' : 'Start building'}
          </LimeButton>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--error)]">
          {error}
        </p>
      )}

      {examples.length > 0 && (
        <div className={`mt-5 flex flex-wrap items-center gap-2 ${align === 'center' ? 'justify-center' : ''}`}>
          <span className="font-scrawl mr-1 text-[16px]">try one:</span>
          {examples.map((example, index) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                onChange(example);
                inputRef?.current?.focus();
              }}
              className={`rounded-[8px] border-2 border-[var(--edge)] bg-[var(--panel)] px-2.5 py-1 text-[12.5px] font-bold transition-colors hover:bg-[var(--lime)] active:translate-y-px ${
                index >= 3 ? 'hidden sm:inline-block' : ''
              }`}
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
