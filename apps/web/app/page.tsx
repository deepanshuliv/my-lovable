'use client';

import { SignInButton, UserButton, useAuth, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createProject } from '@/lib/api';
import { useToken } from '@/lib/useToken';

const PENDING_KEY = 'my-lovable.pending-prompt';

export default function Landing() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const getToken = useToken();

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards the auto-submit below against React's StrictMode, which mounts effects twice in
   * development. Without it, signing in with a pending prompt creates *two* projects and
   * navigates to the second — a real bug, not a dev-only artefact, since the first project
   * is left orphaned in the user's list.
   */
  const firedRef = useRef(false);

  const createAndGo = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);

      try {
        const projectId = await createProject(await getToken(), text);
        router.push(`/project/${projectId}?q=${encodeURIComponent(text)}`);
      } catch (e) {
        setError(String(e));
        setBusy(false);
      }
    },
    [getToken, router],
  );

  function start() {
    const text = prompt.trim();
    if (!text || busy) return;

    if (!isSignedIn) {
      sessionStorage.setItem(PENDING_KEY, text);
      openSignIn({});
      return;
    }

    void createAndGo(text);
  }

  useEffect(() => {
    if (!isLoaded || !isSignedIn || firedRef.current) return;

    const pending = sessionStorage.getItem(PENDING_KEY);
    if (!pending) {
      router.push('/dashboard');
      return;
    }

    firedRef.current = true;
    sessionStorage.removeItem(PENDING_KEY);
    setPrompt(pending);
    void createAndGo(pending);
  }, [isLoaded, isSignedIn, createAndGo, router]);

  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-magic selection:bg-[var(--accent)]/30 selection:text-[var(--accent)]">

      {}
      <div className="w-full px-6 pt-4 z-10">
        <div className="nav-container">
          {}
          <div className="flex items-center gap-2 shrink-0">
            <img src="/logo.jpg" alt="Logo" className="h-8 w-8 rounded-md object-cover" />
            <span className="font-heading text-[18px] uppercase text-white tracking-wider leading-none">
              MY-LOVABLE
            </span>
            <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] text-black font-extrabold leading-none">
              AI
            </span>
          </div>

          {}
          <nav className="hidden md:flex items-center gap-8 text-[11px] font-bold uppercase tracking-widest text-white/50">
            <a href="#" className="hover:text-[var(--accent)] hover:[text-shadow:_0_0_15px_var(--accent)] transition-all">Benefits</a>
            <a href="#" className="hover:text-[var(--accent)] hover:[text-shadow:_0_0_15px_var(--accent)] transition-all">How it works</a>
            <a href="#" className="hover:text-[var(--accent)] hover:[text-shadow:_0_0_15px_var(--accent)] transition-all">Testimonials</a>
            <a href="#" className="hover:text-[var(--accent)] hover:[text-shadow:_0_0_15px_var(--accent)] transition-all">Pricing</a>
            <a href="#" className="hover:text-[var(--accent)] hover:[text-shadow:_0_0_15px_var(--accent)] transition-all">FAQ</a>
          </nav>

          {}
          <div className="shrink-0">
            {isLoaded && !isSignedIn && (
              <SignInButton mode="modal">
                <button className="rounded-xl bg-white px-6 py-2 text-[12px] font-bold uppercase tracking-wider text-black transition-all hover:bg-gray-200 active:scale-95">
                  Sign up
                </button>
              </SignInButton>
            )}
            {isSignedIn && <UserButton />}
          </div>
        </div>
      </div>

      {}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-12 z-10">
        <div className="w-full max-w-[880px] text-center flex flex-col items-center">

          {}
          <div className="mb-8 flex items-center gap-2">
          </div>

          {}
          <div className="relative w-full flex flex-col items-center">
            {}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[120%] bg-white/[0.03] blur-[100px] rounded-full pointer-events-none z-0"></div>

            {}
            <h1 className="hero-headline-base hero-headline-ghost absolute top-0 left-0 w-full text-center z-10 pointer-events-none select-none" aria-hidden="true">
              CODING IS A<br />NIGHTMARE.
            </h1>

            {}
            <h1 className="hero-headline-base hero-headline-front text-center w-full relative z-20">
              CODING IS A<br />NIGHTMARE.
            </h1>

            {}
            <div className="hero-handwritten-wrap relative z-30 pointer-events-none select-none flex justify-center" aria-hidden="true">
              <div className="relative inline-block hero-handwritten-base">
                {}
                <span className="hero-handwritten-ghost absolute top-0 left-0 w-full h-full">
                  NOT ANYMORE!
                </span>
                {}
                <span className="hero-handwritten-front relative block">
                  NOT ANYMORE!
                </span>
              </div>
            </div>
          </div>

          {}
          <p className="mt-8 mb-8 text-[17px] md:text-[19px] leading-[1.7] max-w-[640px] mx-auto text-white/80 font-medium">
            Ditch the hassle of manual coding. Let my-lovable handle your application
            generation and sandbox deployment — quickly, simply, and efficiently.
          </p>

          {}
          <div className="w-full max-w-[640px]">
            <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-2 transition-all focus-within:border-[var(--accent)]/30 focus-within:ring-4 focus-within:ring-[var(--accent)]/10">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    start();
                  }
                }}
                rows={2}
                placeholder="A modern real-time Kanban board with drag-and-drop, tags, and Postgres persistence…"
                className="w-full resize-none bg-transparent px-6 py-4 text-[15px] leading-relaxed outline-none rounded-t-xl transition-all placeholder:text-white/30 text-white"
              />
              <div className="flex items-center justify-between px-6 pb-4 pt-2">
                <span className="text-[13px] text-white/35">
                  {isLoaded && !isSignedIn
                    ? 'Enter to start \u2014 you\u2019ll sign in first'
                    : 'Press Enter \u21B5 to start'}
                </span>
                <button
                  onClick={start}
                  disabled={busy || !prompt.trim()}
                  className="btn-primary min-w-[140px] gap-2 py-3 px-6"
                >
                  {busy ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      Generating…
                    </>
                  ) : (
                    'Start building'
                  )}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 px-6 py-4 text-center text-sm font-medium text-red-400">
              {error} — ensure backend is reachable on{' '}
              <span className="font-mono text-red-300">
                {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}
              </span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
