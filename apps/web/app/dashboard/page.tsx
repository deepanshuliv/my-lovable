'use client';

import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import DashboardProjectGrid from '@/components/DashboardProjectGrid';
import PromptBox from '@/components/PromptBox';
import { Note } from '@/components/lime';
import { createProject } from '@/lib/api';
import { useToken } from '@/lib/useToken';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const router = useRouter();
  const getToken = useToken();
  const { user } = useUser();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hello, setHello] = useState('Hello');

  useEffect(() => {
    setHello(greeting());
  }, []);

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
    void createAndGo(text);
  }

  return (
    <div className="pb-24">
      <section className="relative overflow-hidden bg-[var(--paper)]">
        <div aria-hidden="true" className="absolute left-1/2 top-[-55%] aspect-square w-[min(1000px,150vw)] -translate-x-1/2 rounded-full bg-[var(--soft)] [mask-image:linear-gradient(to_bottom,black_60%,transparent_95%)]" />
        <div className="relative mx-auto flex w-full max-w-[760px] flex-col items-center px-5 pb-16 pt-14 text-center md:pb-20 md:pt-20">
          <span className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--ink)] px-3 py-1.5 text-[13.5px] font-medium text-white">
            {hello}
            {user?.firstName ? `, ${user.firstName}` : ''}
          </span>
          <h1 className="display mt-6 flex flex-wrap items-center justify-center gap-x-3 text-[clamp(36px,5vw,60px)]">
            What should we
            <span className="rounded-[10px] bg-[var(--lime)] px-3 leading-[1.18]">build</span>
            today?
          </h1>
          <p className="mt-5 max-w-[46ch] text-[17px] font-medium leading-[1.45]">
            Describe it in your own words. You will watch it come together, and you can change anything after.
          </p>
          <div className="relative mt-9 w-full text-left">
            <PromptBox
              id="dashboard-prompt"
              value={prompt}
              onChange={setPrompt}
              onSubmit={start}
              busy={busy}
              error={error}
              inputRef={inputRef}
              placeholder="For example: a website for my bakery with a menu, opening hours and a way to order cakes"
              align="center"
            />
            <Note className="-right-44 top-6 hidden xl:flex" arrow="none">
              one sentence is enough!
            </Note>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8">
        <DashboardProjectGrid onStart={() => inputRef.current?.focus()} />
      </div>
    </div>
  );
}
