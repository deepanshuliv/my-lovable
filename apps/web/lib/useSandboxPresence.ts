'use client';

import { useEffect, useRef } from 'react';
import { leaveProject, sendHeartbeat, wakeProjectStream, type ChatStreamHandle, type Token } from './api';
import type { StreamEvent } from './types';

const FIRST_BEAT_MS = 20_000;
const BEAT_EVERY_MS = 60_000;

export function useSandboxPresence(options: {
  projectId: string;
  getToken: () => Promise<Token>;
  onEvent: (event: StreamEvent) => void;
  isBusy: () => boolean;
  onWaking: () => void;
  onAwake: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const { projectId } = options;

  useEffect(() => {
    let ticket: string | null = null;
    let wake: ChatStreamHandle | null = null;
    let waking = false;
    let disposed = false;

    const beat = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      const result = await sendHeartbeat(await latest.current.getToken(), projectId);
      if (!result || disposed) return;
      ticket = result.ticket;
      if (result.sandbox !== 'stopped' || waking || latest.current.isBusy()) return;

      waking = true;
      latest.current.onWaking();
      wake = wakeProjectStream(await latest.current.getToken(), projectId, (event) => latest.current.onEvent(event), () => {
        waking = false;
        wake = null;
        if (!disposed) latest.current.onAwake();
      });
    };

    const leave = () => {
      if (ticket) leaveProject(projectId, ticket);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void beat();
    };

    const first = setTimeout(() => void beat(), FIRST_BEAT_MS);
    const interval = setInterval(() => void beat(), BEAT_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);

    return () => {
      disposed = true;
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
      wake?.abort();
      leave();
    };
  }, [projectId]);
}
