'use client';

import { useEffect } from 'react';

/**
 * Reports this app's browser errors out to whatever is framing it.
 *
 * Why this has to exist at all: this app runs inside an iframe on a different origin from
 * the builder that embeds it. The same-origin policy means the builder cannot read anything
 * in here — not the DOM, not the console, not an exception. And the sandbox cannot see them
 * either, because these errors happen in the *visitor's* browser, running their copy of the
 * bundle; nothing about them ever travels back to the server. So a page that compiles
 * perfectly and then throws on render is invisible to every part of the system.
 *
 * `postMessage` is the one channel browsers allow across origins. This component listens
 * for the four ways a client-side problem shows up and forwards them.
 *
 * It is deliberately tiny and deliberately silent on failure. It runs inside someone's
 * generated app, and a reporting shim that can itself break the page it is reporting on
 * would be worse than no shim.
 */

/** Must match `PREVIEW_ERROR_TAG` in the builder's PreviewPanel. */
const TAG = 'my-lovable:client-errors';

/** Batch window. An app stuck in a render loop can throw faster than anything can read. */
const FLUSH_MS = 500;
const MAX_BATCH = 20;

type Report = { level: 'error' | 'warn'; message: string; source: string };

export default function ErrorReporter() {
  useEffect(() => {
    // Nothing to report to if this is not framed — the app opened directly in a tab is a
    // normal visit, not a preview.
    if (typeof window === 'undefined' || window.parent === window) return;

    // Development only. Once this app is deployed or shared, any site that frames it would
    // otherwise receive its console stream, which is a leak the app's author never agreed
    // to. The builder's preview always runs the dev server, so nothing is lost.
    if (process.env.NODE_ENV === 'production') return;

    let queue: Report[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Guards against reporting our own reporting, which would loop. */
    let reporting = false;
    /**
     * Every message reported so far this session.
     *
     * Deduping only within a batch is not enough: a component that throws on every render
     * produces the same message in a fresh batch twice a second, forever, and each batch
     * becomes a network request, a persisted event row, and a card in the builder's chat.
     * One report of a repeating error is the whole signal.
     */
    const seen = new Set<string>();
    const MAX_DISTINCT = 100;

    function flush() {
      timer = null;
      if (queue.length === 0) return;

      const batch = queue.slice(0, MAX_BATCH);
      queue = [];

      try {
        reporting = true;
        // '*' rather than a fixed origin: the builder's origin is not known to this app,
        // and the payload carries no data that is not already visible in this page's own
        // console.
        window.parent.postMessage({ source: TAG, errors: batch }, '*');
      } catch {
        // A blocked postMessage is not worth breaking the page over.
      } finally {
        reporting = false;
      }
    }

    function push(report: Report) {
      if (reporting || !report.message) return;

      // Identical repeated messages are the signature of a render loop; one is informative,
      // two hundred is noise that buries everything else. Suppressed for the whole session,
      // not just the current batch.
      if (seen.has(report.message)) return;
      // A page generating endlessly *distinct* errors is pathological too; stop rather than
      // grow this set without bound.
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

    // Console patching, kept last so the originals are captured after any other tooling
    // has installed its own wrappers.
    const originalError = console.error;
    const originalWarn = console.warn;

    function format(args: unknown[]): string {
      try {
        return args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
            if (typeof arg === 'object' && arg !== null) {
              // Avoid inspecting React Fibers / internal elements that trigger Webpack lazy module getters
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
        // Avoid intercepting benign HMR / Webpack fast refresh messages
        if (msg && !msg.includes('[Fast Refresh]') && !msg.includes('HMR')) {
          push({ level: 'error', message: msg, source: 'console.error' });
        }
      } catch {
        // Prevent reporting failure from breaking page
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
        // Prevent reporting failure from breaking page
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
