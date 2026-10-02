'use client';

import { ArrowClockwise, ArrowSquareOut, Desktop, DeviceMobile, DeviceTablet, type Icon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PHASES, type BuildProgress } from '@/lib/phase';
import BuildCanvas from './BuildCanvas';

type Viewport = 'desktop' | 'tablet' | 'mobile';

export type ClientError = { level: 'error' | 'warn'; message: string; source: string };

const PREVIEW_ERROR_TAG = 'my-lovable:client-errors';

const WIDTHS: Record<Viewport, string> = {
  desktop: '100%',
  tablet: '834px',
  mobile: '390px',
};

const VIEWPORTS: { id: Viewport; label: string; icon: Icon }[] = [
  { id: 'desktop', label: 'Desktop', icon: Desktop },
  { id: 'tablet', label: 'Tablet', icon: DeviceTablet },
  { id: 'mobile', label: 'Phone', icon: DeviceMobile },
];

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function useElapsed(running: boolean, resetKey: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!running) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, resetKey]);
  return elapsed;
}

function usePhaseFill(phase: number, running: boolean) {
  const [fill, setFill] = useState(0);
  useEffect(() => {
    setFill(0);
    if (!running) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      setFill(0.85 * (1 - Math.exp(-seconds / 18)));
    }, 400);
    return () => clearInterval(timer);
  }, [phase, running]);
  return fill;
}

function StatusChip({
  progress,
  elapsed,
  title,
  inline = false,
}: {
  progress: BuildProgress;
  elapsed: number | null;
  title?: string;
  inline?: boolean;
}) {
  return (
    <div
      className={
        inline
          ? 'mx-auto w-full max-w-[560px] shrink-0'
          : 'pointer-events-none absolute left-1/2 top-5 z-[var(--z-raised)] w-[min(460px,calc(100%-32px))] -translate-x-1/2'
      }
    >
      <div className="rounded-[12px] border-2 border-[var(--edge)] bg-[var(--panel)] px-4 py-3 shadow-[var(--hard)]">
        <div className="flex items-center gap-2.5">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--edge)] border-t-[var(--lime)]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{title ?? PHASES[progress.phase]}</span>
            <span className="block truncate text-[12.5px] font-medium text-[var(--muted)]">{progress.detail}</span>
          </span>
          {elapsed !== null && (
            <span className="shrink-0 rounded-[6px] bg-[var(--ink)] px-2 py-1 font-mono text-[11.5px] tabular-nums text-[var(--lime)]">
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>
        <div className="mt-3 flex gap-1" aria-label={`Step ${progress.phase + 1} of ${PHASES.length}: ${PHASES[progress.phase]}`}>
          {PHASES.map((label, index) => (
            <span
              key={label}
              title={label}
              className={`h-2 flex-1 rounded-[3px] border-[1.5px] border-[var(--edge)] transition-colors duration-500 ${
                index < progress.phase ? 'bg-[var(--ink)]' : index === progress.phase ? 'animate-pulse bg-[var(--lime)]' : 'bg-[var(--panel)]'
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-[11.5px] font-bold uppercase tracking-[0.02em]">
          Step {progress.phase + 1} of {PHASES.length}
        </p>
      </div>
    </div>
  );
}

export default function PreviewPanel({
  url,
  reloadToken,
  onManualReload,
  onClientErrors,
  building = false,
  progress,
  appBuilt = false,
  previewImage,
}: {
  url: string | null;
  reloadToken: number;
  onManualReload: () => void;
  onClientErrors?: (errors: ClientError[]) => void;
  building?: boolean;
  progress: BuildProgress;
  appBuilt?: boolean;
  previewImage?: string;
}) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [loading, setLoading] = useState(false);
  const previousToken = useRef(reloadToken);
  const elapsed = useElapsed(building, 0);
  const fill = usePhaseFill(progress.phase, building || !url);

  useEffect(() => {
    if (reloadToken !== previousToken.current) {
      previousToken.current = reloadToken;
      setLoading(true);
    }
  }, [reloadToken]);

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
    if (previewImage) return previewImage;
    if (!url) return null;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}__v=${reloadToken}`;
  }, [previewImage, url, reloadToken]);

  const assembly = Math.min(1, (progress.phase + fill) / PHASES.length);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] shadow-[var(--hard)]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b-2 border-[var(--edge)] bg-[var(--cream)] px-3">
        <div className="flex gap-0.5 rounded-[9px] border-2 border-[var(--edge)] bg-[var(--panel)] p-0.5" role="radiogroup" aria-label="Preview size">
          {VIEWPORTS.map(({ id, label, icon: ViewIcon }) => (
            <button
              key={id}
              role="radio"
              aria-checked={viewport === id}
              aria-label={label}
              title={label}
              onClick={() => setViewport(id)}
              className={`flex h-7 w-9 items-center justify-center rounded-[6px] transition-colors ${
                viewport === id ? 'bg-[var(--ink)] text-[var(--lime)]' : 'hover:bg-[var(--cream)]'
              }`}
            >
              <ViewIcon size={15} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setLoading(true);
              onManualReload();
            }}
            disabled={!url}
            aria-label="Reload preview"
            title="Reload preview"
            className="btn-ghost btn-sm h-8 w-8 !p-0"
          >
            <ArrowClockwise size={15} className={loading ? 'animate-spin' : ''} />
          </button>

          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
              <span className="hidden sm:inline">Open in new tab</span>
              <ArrowSquareOut size={14} />
            </a>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--paper)] [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:18px_18px]">
        {(building && !appBuilt) || !src ? (
          <div className="absolute inset-0 flex flex-col gap-3 p-3 md:gap-4 md:p-5">
            <StatusChip
              inline
              progress={building ? progress : { phase: 0, detail: progress.detail === 'Getting started' ? 'This takes a few seconds the first time' : progress.detail }}
              elapsed={building ? elapsed : null}
              title={building ? undefined : 'Getting your project ready'}
            />
            <div className="mx-auto min-h-0 w-full flex-1 transition-[max-width] duration-300" style={{ maxWidth: WIDTHS[viewport] }}>
              <BuildCanvas progress={building ? assembly : 0.08} />
            </div>
          </div>
        ) : (
          <div className="relative mx-auto h-full transition-[width] duration-300" style={{ width: WIDTHS[viewport], maxWidth: '100%' }}>
            {previewImage ? (
              <img src={previewImage} alt="Preview of the finished app" className="rise-in block h-full w-full object-cover object-top" />
            ) : (
            <iframe
                key={reloadToken}
                src={src}
                title="Live preview of your app"
                onLoad={() => setLoading(false)}
                className={`block h-full w-full bg-white ${viewport === 'desktop' ? '' : 'border-x border-[var(--line)]'}`}
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
              />
            )}
            {building && <StatusChip progress={progress} elapsed={elapsed} title="Updating your app" />}
          </div>
        )}
      </div>
    </div>
  );
}
