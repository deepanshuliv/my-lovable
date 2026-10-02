'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Logo } from '@/components/lime';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[100dvh] flex-col bg-[var(--paper)] px-5 text-[var(--text)]">
      <div className="mx-auto flex h-[72px] w-full max-w-[1312px] items-center md:h-[84px] md:px-3">
        <Logo />
      </div>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center pb-24 text-center">
        <h1 className="text-[clamp(32px,5.5vw,52px)] font-bold leading-[1.05] tracking-[-0.03em]">Something went wrong.</h1>
        <p className="mt-5 max-w-[42ch] text-[17px] font-medium leading-[1.5] text-[var(--muted)]">
          This page hit an unexpected error. Your work is saved. Try again, and if it keeps happening, head back home.
        </p>
        {error.digest && <p className="mt-4 font-mono text-[12px] text-[var(--muted)]">Reference: {error.digest}</p>}
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="flex min-h-[46px] items-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--lime)] px-5 text-[13px] font-bold uppercase text-[var(--ink)] shadow-[var(--hard-sm)] transition-transform hover:-translate-y-0.5"
          >
            Try again
          </button>
          <Link
            href="/"
            className="flex min-h-[46px] items-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] px-5 text-[13px] font-bold uppercase transition-transform hover:-translate-y-0.5"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
