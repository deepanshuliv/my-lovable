'use client';

import { useEffect } from 'react';

const TAG = 'my-lovable:client-errors';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== 'undefined' && window.parent !== window) {
      try {
        window.parent.postMessage(
          {
            source: TAG,
            errors: [
              {
                level: 'error',
                message: error?.message || 'Global layout error',
                source: 'Next.js GlobalError',
              },
            ],
          },
          '*',
        );
      } catch {
        // ignore
      }
    }
  }, [error]);

  return (
    <html lang="en" className="dark bg-zinc-950">
      <body className="flex min-h-screen flex-col items-center justify-center p-8 text-center text-zinc-200">
        <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 shadow-lg">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-400 animate-ping" />
        </div>
        <h2 className="text-base font-semibold tracking-tight text-white">
          Updating Workspace
        </h2>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-400">
          The AI agent is applying changes in the background. The preview will update automatically once verified.
        </p>
        <button
          onClick={() => reset()}
          className="mt-5 rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
        >
          Reload
        </button>
      </body>
    </html>
  );
}
