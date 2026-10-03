'use client';

import { useEffect } from 'react';

const TAG = 'my-lovable:client-errors';

const FLUSH_MS = 500;
const MAX_BATCH = 20;

type Report = { level: 'error' | 'warn'; message: string; source: string };

export default function ErrorReporter() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;

    if (process.env.NODE_ENV === 'production') return;

    let queue: Report[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    let reporting = false;

    const seen = new Set<string>();
    const MAX_DISTINCT = 100;

    function flush() {
      timer = null;
      if (queue.length === 0) return;

      const batch = queue.slice(0, MAX_BATCH);
      queue = [];

      try {
        reporting = true;

        window.parent.postMessage({ source: TAG, errors: batch }, '*');
      } catch {
      } finally {
        reporting = false;
      }
    }

    function push(report: Report) {
      if (reporting || !report.message) return;

      if (seen.has(report.message)) return;

      if (seen.size >= MAX_DISTINCT) return;
      seen.add(report.message);

      queue.push(report);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    }

    function onError(event: ErrorEvent) {
      push({
        level: 'error',
        message: event.message || String(event.error ?? 'unknown error'),
        source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '',
      });
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { message?: string; stack?: string } | string | undefined;
      push({
        level: 'error',
        message:
          typeof reason === 'string'
            ? reason
            : reason?.message || String(reason ?? 'unhandled promise rejection'),
        source: 'unhandled rejection',
      });
    }

    const originalError = console.error;
    const originalWarn = console.warn;

    function format(args: unknown[]): string {
      try {
        return args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
            if (typeof arg === 'object' && arg !== null) {
              if ('$$typeof' in (arg as Record<string, unknown>)) return '[React Element]';
              try {
                return (arg as { message?: string }).message || String(arg);
              } catch {
                return '[Object]';
              }
            }
            return String(arg);
          })
          .join(' ')
          .slice(0, 1000);
      } catch {
        return 'runtime diagnostic';
      }
    }

    console.error = function (...args: unknown[]) {
      try {
        const msg = format(args);

        if (msg && !msg.includes('[Fast Refresh]') && !msg.includes('HMR')) {
          push({ level: 'error', message: msg, source: 'console.error' });
        }
      } catch {
      }
      return originalError.apply(console, args);
    };

    console.warn = function (...args: unknown[]) {
      try {
        const msg = format(args);
        if (msg && !msg.includes('[Fast Refresh]') && !msg.includes('HMR')) {
          push({ level: 'warn', message: msg, source: 'console.warn' });
        }
      } catch {
      }
      return originalWarn.apply(console, args);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      console.error = originalError;
      console.warn = originalWarn;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
