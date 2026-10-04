import { UserButton } from '@clerk/nextjs';
import CreditsPill from '@/components/Credits';
import ThemeToggle from '@/components/ThemeToggle';
import { Logo } from '@/components/lime';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]">
      <header className="sticky top-0 z-[var(--z-sticky)] border-b-2 border-[var(--edge)] bg-[var(--paper)]">
        <div className="mx-auto flex h-[72px] w-full max-w-[1200px] items-center justify-between px-5 md:px-8">
          <Logo href="/" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <CreditsPill />
            <span className="flex h-10 items-center">
              <UserButton />
            </span>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
