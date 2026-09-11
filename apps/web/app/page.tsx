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
    <main className="relative flex h-screen flex-col overflow-hidden bg-[var(--bg)] selection:bg-[var(--primary)]/30 selection:text-[var(--primary)] text-[var(--text)]">

      {/* NAVBAR */}
      <div className="w-full px-6 pt-4 z-10 flex-shrink-0">
        <div className="flex items-center justify-between w-full max-w-7xl mx-auto py-3 px-1 border-b border-[var(--line)]">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded bg-[var(--panel-2)] border border-[var(--line)]">
              <img src="/logo.jpg" alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="font-heading text-[16px] font-medium tracking-wide leading-none text-white">
                MY-LOVABLE
              </span>
              <span className="text-[10px] font-mono text-[var(--primary)] tracking-widest uppercase mt-1">
                Trading Protocol
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-[12px] font-medium text-[var(--muted)] tracking-wide uppercase">
            <a href="#" className="hover:text-[var(--primary)] transition-colors">Documentation</a>
            <a href="#" className="hover:text-[var(--primary)] transition-colors">Markets</a>
            <a href="#" className="hover:text-[var(--primary)] transition-colors">Pro API</a>
          </nav>

          <div className="shrink-0 flex items-center gap-4">
            {isLoaded && !isSignedIn && (
              <SignInButton mode="modal">
                <button className="btn-secondary text-[12px] uppercase tracking-wider py-1.5 px-4 h-8 rounded">
                  Connect Wallet
                </button>
              </SignInButton>
            )}
            {isSignedIn && <UserButton />}
          </div>
        </div>
      </div>

      {/* HERO / TERMINAL */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-12 z-10">
        <div className="w-full max-w-3xl flex flex-col items-center">

          <div className="text-center mb-10">
            <h1 className="font-heading text-4xl md:text-5xl font-medium tracking-tight text-white mb-4">
              Deploy your ideas at execution speed.
            </h1>
            <p className="text-[14px] md:text-[15px] font-mono text-[var(--muted)] max-w-xl mx-auto leading-relaxed">
              &gt; Initialize environment...<br/>
              &gt; Describe the application interface and backend logic.<br/>
              &gt; Compiling to sandbox container.
            </p>
          </div>

          <div className="w-full">
            <div className="trading-panel transition-all duration-200 focus-within:border-[var(--primary)]">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--line)] bg-[var(--panel-2)] text-[11px] font-mono text-[var(--muted)] uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-[var(--primary)] inline-block"></span>
                Terminal // Input Prompt
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    start();
                  }
                }}
                rows={3}
                placeholder="Initialize a robust order book matching engine with depth charts..."
                className="w-full resize-none bg-transparent px-4 py-4 text-[14px] font-mono leading-relaxed outline-none transition-all placeholder:text-[var(--muted)] text-white"
              />
              <div className="flex items-center justify-between px-4 pb-4 pt-2">
                <span className="text-[11px] font-mono text-[var(--secondary-muted)] uppercase">
                  {isLoaded && !isSignedIn
                    ? '[ENTER] to Connect & Execute'
                    : '[ENTER] to Execute'}
                </span>
                <button
                  onClick={start}
                  disabled={busy || !prompt.trim()}
                  className="btn-primary min-w-[140px] gap-2 py-2 px-6 h-9 rounded text-[12px] uppercase tracking-wider"
                >
                  {busy ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      Executing...
                    </>
                  ) : (
                    'Execute Build'
                  )}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-6 w-full rounded border border-[var(--error)] bg-[var(--error-bg)] px-4 py-3 text-left text-xs font-mono text-[var(--error)]">
              [ERR] {error} <br/>
              <span className="opacity-70 mt-1 block">
                Target node: {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}
              </span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
