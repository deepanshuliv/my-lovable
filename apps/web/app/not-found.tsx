import Link from 'next/link';
import { Logo } from '@/components/lime';

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-[var(--paper)] px-5 text-[var(--text)]">
      <div className="mx-auto flex h-[72px] w-full max-w-[1312px] items-center md:h-[84px] md:px-3">
        <Logo />
      </div>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center pb-24 text-center">
        <p className="rounded-[8px] bg-[var(--lime)] px-3 py-1 font-mono text-[14px] font-bold text-[var(--ink)]">404</p>
        <h1 className="mt-6 text-[clamp(34px,6vw,56px)] font-bold leading-[1.05] tracking-[-0.03em]">This page does not exist.</h1>
        <p className="mt-5 max-w-[40ch] text-[17px] font-medium leading-[1.5] text-[var(--muted)]">
          The link may be old or mistyped. Your projects are safe on your dashboard.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="flex min-h-[46px] items-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--lime)] px-5 text-[13px] font-bold uppercase text-[var(--ink)] shadow-[var(--hard-sm)] transition-transform hover:-translate-y-0.5"
          >
            Back to home
          </Link>
          <Link
            href="/dashboard"
            className="flex min-h-[46px] items-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] px-5 text-[13px] font-bold uppercase transition-transform hover:-translate-y-0.5"
          >
            Your dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
