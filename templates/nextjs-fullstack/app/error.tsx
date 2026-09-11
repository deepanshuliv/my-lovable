'use client';

import { useEffect } from 'react';

/** Must match `PREVIEW_ERROR_TAG` in the builder's PreviewPanel. */
const TAG = 'my-lovable:client-errors';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report error to builder UI via postMessage
    if (typeof window !== 'undefined' && window.parent !== window) {
      try {
        window.parent.postMessage(
          {
            source: TAG,
            errors: [
              {
                level: 'error',
                message: error?.message || 'Component runtime error',
                source: 'React ErrorBoundary',
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
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center text-zinc-200">
      <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 shadow-lg">
        <span className="h-2.5 w-2.5 rounded-full bg-orange-400 animate-ping" />
      </div>
      <h2 className="text-base font-semibold tracking-tight text-white">
        Updating Application
      </h2>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-400">
        The AI agent is updating and resolving code changes in the background. Live preview will automatically refresh once complete.
      </p>
      <button
        onClick={() => reset()}
        className="mt-5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
      >
        Retry render
      </button>
    </div>
  );
}
