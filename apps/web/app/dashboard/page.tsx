'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { createProject } from '@/lib/api';
import { useToken } from '@/lib/useToken';
import DashboardProjectGrid from '@/components/DashboardProjectGrid';

export default function DashboardPage() {
  const router = useRouter();
  const getToken = useToken();

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    void createAndGo(text);
  }

  return (
    <div className="flex flex-col min-h-full px-6 py-8 md:px-12 md:py-12 max-w-[1200px] mx-auto">
      {/* Header area - Dashboard title & actions */}
      <div className="mb-10 flex items-center justify-between">
         <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
      </div>

      {/* Hero / Create Area */}
      <div className="w-full mb-12">
        <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--muted)' }}>
          What's the vision?
        </h2>
        
        <div className="rounded-[20px] border p-2 transition-colors focus-within:border-[var(--line-strong)]" 
             style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--line)' }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                start();
              }
            }}
            rows={1}
            placeholder="A modern real-time Kanban board with drag-and-drop, tags, and Postgres persistence…"
            className="w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed outline-none placeholder:opacity-30 text-white min-h-[60px]"
          />
          <div className="flex items-center justify-between px-4 pb-2 pt-1">
            <span className="text-[12px] opacity-40">
              Press Enter ↵ to start
            </span>
            <button
              onClick={start}
              disabled={busy || !prompt.trim()}
              className="btn-primary min-w-[120px] gap-2 py-2 px-5 text-[13px] h-9"
            >
              {busy ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                  Generating…
                </>
              ) : (
                'Start building'
              )}
            </button>
          </div>
        </div>
        
        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
            {error} — ensure backend is reachable
          </div>
        )}
      </div>

      {}
      <DashboardProjectGrid />
      
    </div>
  );
}
