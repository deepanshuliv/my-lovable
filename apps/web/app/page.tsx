'use client';

import { useAuth, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import LimeLanding from '@/components/landing/LimeLanding';
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const createAndGo = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);

      try {
        const projectId = await createProject(await getToken(), text);
        router.push(`/project/${projectId}?q=${encodeURIComponent(text)}`);
      } catch {
        setError('We could not start your project. Check your connection and try again.');
        setBusy(false);
      }
    },
    [getToken, router],
  );

  function start() {
    const text = prompt.trim();
    if (!text || busy) {
      inputRef.current?.focus();
      return;
    }

    if (!isSignedIn) {
      sessionStorage.setItem(PENDING_KEY, text);
      openSignIn({});
      return;
    }

    void createAndGo(text);
  }

  function focusPrompt(text?: string) {
    if (text) setPrompt(text);
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 450);
  }

  useEffect(() => {
    if (!isLoaded) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('sign-in')) return;
    const next = params.get('next') ?? '';
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
    window.history.replaceState(null, '', '/');
    if (isSignedIn) {
      router.replace(safeNext);
      return;
    }
    openSignIn({ forceRedirectUrl: safeNext });
  }, [isLoaded, isSignedIn, openSignIn, router]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || firedRef.current) return;

    const pending = sessionStorage.getItem(PENDING_KEY);
    if (!pending) return;

    firedRef.current = true;
    sessionStorage.removeItem(PENDING_KEY);
    setPrompt(pending);
    void createAndGo(pending);
  }, [isLoaded, isSignedIn, createAndGo]);

  return (
    <LimeLanding
      isLoaded={isLoaded}
      isSignedIn={isSignedIn}
      prompt={prompt}
      setPrompt={setPrompt}
      start={start}
      busy={busy}
      error={error}
      inputRef={inputRef}
      focusPrompt={focusPrompt}
    />
  );
}
