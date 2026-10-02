'use client';

import { useUser } from '@clerk/nextjs';
import { ArrowUpRight, Coins, EnvelopeSimple, GoogleLogo } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { CreditBalance } from '@/lib/api';
import { useCredits } from '@/lib/useCredits';

export const CREDITS_EMAIL = process.env.NEXT_PUBLIC_CREDITS_REQUEST_EMAIL || 'deepanshusaini545@gmail.com';

function useRequestLinks(credits: CreditBalance | null) {
  const { user } = useUser();
  const name = user?.fullName || user?.firstName || 'there';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';

  const subject = `More Inkling credits for ${user?.fullName || email || 'my account'}`;
  const body = [
    'Hi Deepanshu,',
    '',
    'I would like more credits on Inkling, please.',
    '',
    `Name: ${user?.fullName ?? ''}`,
    `Account email: ${email}`,
    `User ID: ${user?.id ?? ''}`,
    credits ? `Credits used: ${credits.usedUnits} of ${credits.totalUnits}` : '',
    '',
    'What I am building:',
    '',
    '',
    'Thanks,',
    name,
  ]
    .filter((line, index, lines) => !(line === '' && lines[index - 1] === '' && lines[index - 2] === ''))
    .join('\n');

  const mailto = `mailto:${CREDITS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CREDITS_EMAIL)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${
    email ? `&authuser=${encodeURIComponent(email)}` : ''
  }`;

  return { mailto, gmail };
}

export function RequestCredits({ credits, compact = false }: { credits: CreditBalance | null; compact?: boolean }) {
  const { mailto, gmail } = useRequestLinks(credits);

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      <a href={gmail} target="_blank" rel="noreferrer" className="btn-primary btn-sm w-full">
        <GoogleLogo size={14} weight="bold" />
        Request more in Gmail
        <ArrowUpRight size={12} />
      </a>
      <a href={mailto} className="btn-secondary btn-sm w-full">
        <EnvelopeSimple size={14} />
        Use my mail app instead
      </a>
      <p className="text-center text-[11.5px] leading-relaxed text-[var(--faint)]">
        Goes to {CREDITS_EMAIL}. Your details are filled in, just add what you are building.
      </p>
    </div>
  );
}

export function CreditsSummary({ credits }: { credits: CreditBalance | null }) {
  const total = credits?.totalUnits ?? 100;
  const left = credits?.remainingUnits ?? 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const low = credits !== null && left <= Math.max(5, total * 0.1);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-[var(--muted)]">Free credits</span>
        <span className="text-[13px] tabular-nums text-[var(--muted)]">
          <span className={`text-[20px] font-bold ${low ? 'text-[var(--warning)]' : 'text-[var(--text)]'}`}>{credits ? left : '-'}</span>
          {' '}of {total} left
        </span>
      </div>
      <div className="mt-3 h-3.5 overflow-hidden rounded-[4px] border-2 border-[var(--edge)] bg-[var(--panel)]">
        <div
          className="h-full origin-left transition-transform duration-500"
          style={{ transform: `scaleX(${pct / 100})`, background: low ? '#ffcb57' : 'var(--lime)' }}
        />
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
        Each build uses a few credits, depending on how much work it takes. Credits do not reset. When they run out, ask for
        more or use your own AI key.
      </p>
    </div>
  );
}

export default function CreditsPill() {
  const { credits } = useCredits();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const left = credits?.remainingUnits;
  const low = credits !== null && (left ?? 0) <= Math.max(5, (credits?.totalUnits ?? 100) * 0.1);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="Your free credits"
        className="flex h-10 items-center gap-2.5 rounded-[10px] bg-[var(--ink)] py-1.5 pl-3.5 pr-1.5 text-[12.5px] font-bold uppercase text-white transition-transform active:translate-y-px"
      >
        <Coins size={16} weight="fill" className={low ? 'text-[#ffcb57]' : 'text-[var(--lime)]'} />
        Credits
        <span
          className={`flex h-7 min-w-7 items-center justify-center rounded-[6px] px-1.5 font-mono text-[12.5px] tabular-nums ${
            low ? 'bg-[#ffcb57] text-[var(--ink)]' : 'bg-[var(--lime)] text-[var(--ink)]'
          }`}
        >
          {credits ? left : '-'}
        </span>
      </button>

      {open && (
        <div className="rise-in absolute right-0 top-full z-[var(--z-modal)] mt-2 w-[300px] rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] p-4 shadow-[var(--hard)]">
          <CreditsSummary credits={credits} />
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <RequestCredits credits={credits} compact />
          </div>
        </div>
      )}
    </div>
  );
}
