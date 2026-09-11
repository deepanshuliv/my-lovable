'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Viewport = 'desktop' | 'tablet' | 'mobile';

export type ClientError = { level: 'error' | 'warn'; message: string; source: string };

const PREVIEW_ERROR_TAG = 'my-lovable:client-errors';

const WIDTHS: Record<Viewport, string> = {
  desktop: '100%',
  tablet: '834px',
  mobile: '390px',
};

export default function PreviewPanel({
  url,
  reloadToken,
  onManualReload,
  onClientErrors,
}: {
  url: string | null;
  reloadToken: number;
  onManualReload: () => void;
    onClientErrors?: (errors: ClientError[]) => void;
}) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [loading, setLoading] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const previousToken = useRef(reloadToken);

  useEffect(() => {
    if (reloadToken !== previousToken.current) {
      previousToken.current = reloadToken;
      setLoading(true);
    }
  }, [reloadToken]);

  useEffect(() => {
    if (url && iframeReady) return;
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % 4);
    }, 2800);
    return () => clearInterval(interval);
  }, [url, iframeReady]);

    useEffect(() => {
    if (!onClientErrors || !url) return;

    let previewOrigin: string;
    try {
      previewOrigin = new URL(url).origin;
    } catch {
      return;
    }

    function handle(event: MessageEvent) {
      if (event.origin !== previewOrigin) return;

      const data = event.data as { source?: unknown; errors?: unknown } | null;
      if (!data || data.source !== PREVIEW_ERROR_TAG) return;
      if (!Array.isArray(data.errors) || data.errors.length === 0) return;

      const cleaned = data.errors.slice(0, 20).map((raw): ClientError => {
        const item = (raw ?? {}) as Record<string, unknown>;
        return {
          level: item.level === 'warn' ? 'warn' : 'error',
          message: String(item.message ?? '').slice(0, 1000),
          source: String(item.source ?? '').slice(0, 300),
        };
      });

      onClientErrors?.(cleaned.filter((error) => error.message.length > 0));
    }

    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [onClientErrors, url]);

  const src = useMemo(() => {
    if (!url) return null;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}__v=${reloadToken}`;
  }, [url, reloadToken]);

  const steps = [
    { label: 'Provisioning cloud sandbox', detail: 'Allocating dedicated container in Daytona' },
    { label: 'Loading template & modules', detail: 'Scaffolding Next.js fullstack workspace' },
    { label: 'Starting dev server', detail: 'Booting Node runtime & compiling components' },
    { label: 'Connecting live preview', detail: 'Establishing proxy and fast refresh link' },
  ];

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border shadow-lg"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="flex h-12 shrink-0 items-center justify-between border-b px-4"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--panel-2)' }}>
          {(['desktop', 'tablet', 'mobile'] as Viewport[]).map((option) => (
            <button
              key={option}
              onClick={() => setViewport(option)}
              className="rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition"
              style={{
                background: viewport === option ? 'var(--text)' : 'transparent',
                color: viewport === option ? '#000' : 'var(--muted)',
              }}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setLoading(true);
              onManualReload();
            }}
            disabled={!url}
            title="Reload preview"
            className="rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all hover:bg-white/5 hover:text-white disabled:opacity-25 disabled:pointer-events-none"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}
          >
            Reload
          </button>

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all hover:opacity-80"
              style={{
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                background: 'var(--accent-soft)',
              }}
            >
              <span>Open App</span>
              <svg
                className="h-3 w-3 text-white transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"
                />
              </svg>
            </a>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto bg-black/40 p-3">
        {src ? (
          <div
            className="relative mx-auto h-full transition-all"
            style={{ width: WIDTHS[viewport], maxWidth: '100%' }}
          >
            <iframe
              key={reloadToken}
              src={src}
              onLoad={() => {
                setLoading(false);
                setIframeReady(true);
              }}
              className="h-full w-full rounded-lg border bg-white shadow-2xl transition-opacity duration-300"
              style={{ borderColor: 'var(--line)' }}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
            />
          </div>
        ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
            <div className="relative mb-6">
              {}
              <div
                className="absolute inset-0 -m-4 rounded-full opacity-30 blur-xl animate-pulse"
                style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
              />

              {}
              <div
                className="relative flex h-16 w-16 items-center justify-center rounded-2xl border shadow-xl"
                style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }}
              >
                <div className="flex gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full bg-[var(--accent)] opacity-40 animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="h-2 w-2 rounded-full bg-[var(--accent)] opacity-70 animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="h-2 w-2 rounded-full bg-[var(--accent)] animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              </div>
            </div>

            <h3 className="mb-2 text-base font-semibold tracking-tight text-white">
              Your project is getting ready
            </h3>
            <p className="mb-6 max-w-sm text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              We are spinning up an isolated cloud sandbox with your code and live development
              server.
            </p>

            {}
            <div className="w-full max-w-xs space-y-2">
              {steps.map((step, idx) => {
                const isActive = idx === loadingStep;
                const isPast = idx < loadingStep;
                return (
                  <div
                    key={step.label}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all"
                    style={{
                      background: isActive ? 'var(--panel-2)' : 'transparent',
                      borderColor: isActive ? 'var(--accent)' : 'var(--line)',
                      opacity: isPast ? 0.6 : isActive ? 1 : 0.35,
                    }}
                  >
                    <div
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{
                        background: isPast
                          ? 'var(--success)'
                          : isActive
                            ? 'var(--accent)'
                            : 'var(--line)',
                        color: isPast || isActive ? '#000' : 'var(--muted)',
                      }}
                    >
                      {isPast ? '✓' : idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-white">{step.label}</div>
                      <div className="truncate text-[10px]" style={{ color: 'var(--muted)' }}>
                        {step.detail}
                      </div>
                    </div>
                    {isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-ping" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading && src && (
          <div
            className="pointer-events-none absolute right-5 top-5 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] shadow-lg backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 25, 0.85)',
              borderColor: 'var(--line)',
              color: 'var(--muted)',
            }}
          >
            <span className="h-2 w-2 animate-spin rounded-full border border-[var(--accent)] border-t-transparent" />
            <span>Updating live preview…</span>
          </div>
        )}
      </div>
    </div>
  );
}
