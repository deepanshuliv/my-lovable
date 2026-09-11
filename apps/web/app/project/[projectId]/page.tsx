'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ByokModal from '@/components/ByokModal';
import ChatPanel from '@/components/ChatPanel';
import PreviewPanel, { type ClientError } from '@/components/PreviewPanel';
import SecretsPanel from '@/components/SecretsPanel';
import GitHubPanel from '@/components/GitHubPanel';
import {
  fetchHealth,
  fetchHistory,
  openChatStream,
  deleteMyKey,
  getMyKeys,
  reportClientErrors,
  sendAnswer,
  wakeProjectStream,
  type StoredKey,
  type ChatStreamHandle,
  type HealthInfo,
} from '@/lib/api';
import {
  hasSkippedByok,
  isAuthError,
  markByokSkipped,
  getProviderPreference,
  setProviderPreference,
  type ByokProvider,
} from '@/lib/byok';
import { useToken } from '@/lib/useToken';
import type { AgentMode, ChatItem, RequiredSecret, StreamEvent } from '@/lib/types';

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q');

  const getToken = useToken();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
    const [queued, setQueued] = useState<{ id: string; text: string }[]>([]);
    const [stopping, setStopping] = useState(false);
    const [paused, setPaused] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
    const [mode, setMode] = useState<AgentMode>('build');
    const [draft, setDraft] = useState('');
  const [byok, setByok] = useState<StoredKey | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [providerPref, setProviderPref] = useState<{
    provider: ByokProvider;
    usePlatform: boolean;
  } | null>(null);

  useEffect(() => {
    setProviderPref(getProviderPreference());
  }, []);

  const handleProviderChange = useCallback(
    (provider: ByokProvider, usePlatform: boolean) => {
      const newPref = { provider, usePlatform };
      setProviderPref(newPref);
      setProviderPreference(newPref);

      // If they switched to BYOK, and they don't have a key yet, prompt them
      if (!usePlatform && !byok) {
        setByokOpen(true);
      }
    },
    [byok],
  );

  const streamRef = useRef<ChatStreamHandle | null>(null);
    const modeRef = useRef<AgentMode>('build');
  const providerPrefRef = useRef(providerPref);
  useEffect(() => {
    providerPrefRef.current = providerPref;
  }, [providerPref]);
    const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const oldestSeqRef = useRef<number | null>(null);
    const stoppingRef = useRef(false);
    const reportedErrorsRef = useRef<Set<string>>(new Set());
    const busyRef = useRef(false);
    const startedRef = useRef(false);
    const lastQueryRef = useRef<string | null>(null);
  const lastQueryFailedRef = useRef(false);

  const push = useCallback((item: ChatItem) => setItems((prev) => [...prev, item]), []);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'text': {
          const text = String(event.text ?? '');
          // The backend re-sends the assembled text with final:true once the turn ends;
          // the deltas already painted it, so that one is a no-op here.
          if (event.final) {
            setItems((prev) =>
              prev.map((item) =>
                item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
              ),
            );
            return;
          }
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.kind === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), { ...last, text: last.text + text }];
            }
            return [...prev, { kind: 'assistant', id: crypto.randomUUID(), text, streaming: true }];
          });
          if (isAuthError(text)) {
            lastQueryFailedRef.current = true;
          }
          return;
        }

        case 'tool_call': {

          if (event.name === 'question_tool') return;
          const args = event.args as Record<string, unknown> | undefined;
          let shortLabel = '';
          if (event.name === 'write_file') {
            shortLabel = `write ${args?.path ?? 'file'}`;
          } else if (event.name === 'edit_file') {
            shortLabel = `edit ${args?.path ?? 'file'}`;
          } else if (event.name === 'read_file') {
            shortLabel = `read ${args?.path ?? 'file'}`;
          } else if (event.name === 'search_code') {
            shortLabel = `search "${args?.query ?? ''}"`;
          } else if (event.name === 'list_dir') {
            shortLabel = `list ${args?.path ?? '.'}`;
          } else {
            const rawCmd = String(args?.comand || args?.command || '');
            shortLabel = rawCmd
              ? rawCmd.split('\n')[0]?.slice(0, 45)
              : args
                ? JSON.stringify(args).slice(0, 40)
                : 'command';
          }

          setStatus(`Executing: ${shortLabel}…`);
          push({
            kind: 'tool',
            id: crypto.randomUUID(),
            name: String(event.name ?? 'tool'),
            args: shortLabel,
          });
          return;
        }

        case 'tool_result': {
          if (event.name === 'question_tool') return;
          setStatus('Analyzing output & drafting code…');
          setItems((prev) => {
            
            for (let i = prev.length - 1; i >= 0; i--) {
              const item = prev[i];
              if (item && item.kind === 'tool' && item.result === undefined) {
                const updated: ChatItem = {
                  ...item,
                  result: String(event.result ?? ''),
                  isError: Boolean(event.isError),
                };
                return [...prev.slice(0, i), updated, ...prev.slice(i + 1)];
              }
            }
            return prev;
          });
          return;
        }

        case 'question': {
          push({
            kind: 'question',
            id: crypto.randomUUID(),
            questionId: String(event.questionId ?? ''),
            question: String(event.question ?? ''),
            options: Array.isArray(event.options) ? (event.options as string[]).map(String) : [],
          });
          setStatus(null);
          return;
        }

        case 'answer': {
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'question' && item.questionId === event.questionId
                ? { ...item, answer: String(event.answer ?? '') }
                : item,
            ),
          );
          return;
        }

        case 'running':
          setStatus(String(event.stage ?? 'working'));
          return;

        case 'preview_ready':
          setPreviewUrl(String(event.url ?? ''));
          return;

        case 'preview_reload':

          setReloadToken((n) => n + 1);
          return;

        case 'compaction':
        case 'summarization':
          push({
            kind: 'compaction',
            id: crypto.randomUUID(),
            full: event.type === 'summarization',
            midStream: Boolean(event.midStream),
            tokensBefore: Number(event.tokensBefore ?? 0),
            tokensAfter: Number(event.tokensAfter ?? 0),
            contextWindow: Number(event.contextWindow ?? 0),
            summary: String(event.summary ?? ''),
          });
          return;

        case 'secrets_required': {
          const secrets = Array.isArray(event.secrets)
            ? (event.secrets as RequiredSecret[]).map((secret) => ({
                key: String(secret.key ?? ''),
                reason: String(secret.reason ?? ''),
              }))
            : [];
          if (secrets.length === 0) return;
          push({ kind: 'secrets', id: crypto.randomUUID(), secrets, provided: [] });
          return;
        }

        case 'verification':
          push({
            kind: 'verification',
            id: crypto.randomUUID(),
            ok: Boolean(event.ok),
            typecheckPassed:
              event.typecheckPassed === null || event.typecheckPassed === undefined
                ? null
                : Boolean(event.typecheckPassed),
            typecheckOutput: String(event.typecheckOutput ?? ''),
            runtimeErrors: Array.isArray(event.runtimeErrors)
              ? (event.runtimeErrors as unknown[]).map(String)
              : [],
          });
          return;

        case 'client_errors': {
          const errors = Array.isArray(event.errors) ? (event.errors as ClientError[]) : [];
          if (errors.length === 0) return;
          push({ kind: 'clientErrors', id: crypto.randomUUID(), errors });
          return;
        }

        case 'error':
          lastQueryFailedRef.current = true;
          push({
            kind: 'error',
            id: crypto.randomUUID(),
            message: String(event.message ?? 'error'),
          });
          return;

        case 'done':
          setStatus(null);
          return;

        default:
          return;
      }
    },
    [push],
  );

    const startTurn = useCallback(
    async (query: string, isAutoRetry = false) => {
      lastQueryRef.current = query;
      lastQueryFailedRef.current = false;
      if (!isAutoRetry) {
        push({ kind: 'user', id: crypto.randomUUID(), text: query });
      }
      busyRef.current = true;
      setBusy(true);
      setStatus('connecting');

      const token = await getToken();

      streamRef.current = openChatStream(
        token,
        projectId,
        query,
        handleEvent,
        (error) => {
          busyRef.current = false;
          setBusy(false);
          setStatus(null);
          streamRef.current = null;

          if (stoppingRef.current) {
            push({
              kind: 'status',
              id: crypto.randomUUID(),
              stage: 'stopped — work up to this point was saved',
            });
          }
          stoppingRef.current = false;
          setStopping(false);
          if (error) {
            lastQueryFailedRef.current = true;
            push({ kind: 'error', id: crypto.randomUUID(), message: error });
          }
        },

        {
          mode: modeRef.current,
          provider: providerPrefRef.current?.provider,
          usePlatform: providerPrefRef.current?.usePlatform,
        },
      );
    },
    [getToken, handleEvent, projectId, push],
  );

    const send = useCallback(
    (query: string) => {
      const text = query.trim();
      if (!text) return;

      setPaused(false);

      if (busyRef.current) {
        setQueued((prev) => [...prev, { id: crypto.randomUUID(), text }]);
        return;
      }

      void startTurn(text);
    },
    [startTurn],
  );

  const cancelQueued = useCallback((id: string) => {
    setQueued((prev) => prev.filter((item) => item.id !== id));
  }, []);

    const stopTurn = useCallback(() => {
    if (!streamRef.current) return;

    stoppingRef.current = true;
    setStopping(true);
    setPaused(true);
    streamRef.current.abort();
  }, []);

  const resumeQueue = useCallback(() => setPaused(false), []);

  useEffect(() => {
    if (busy || paused || queued.length === 0) return;

    const [next, ...rest] = queued;
    if (!next) return;

    setQueued(rest);
    void startTurn(next.text);
  }, [busy, paused, queued, startTurn]);

  const answer = useCallback(
    async (questionId: string, value: string) => {
      setItems((prev) =>
        prev.map((item) =>
          item.kind === 'question' && item.questionId === questionId
            ? { ...item, answer: value }
            : item,
        ),
      );
      await sendAnswer(await getToken(), questionId, value);
    },
    [getToken],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const history = await fetchHistory(await getToken(), projectId);
      if (cancelled) return;

      if (history.events.length > 0) {
        setItems(replayToItems(history.events));
        oldestSeqRef.current = history.events[0]?.seq ?? null;
      }
      setHasMore(history.hasMore);

      if (initialQuery && !startedRef.current) {
        startedRef.current = true;

        window.history.replaceState(null, '', `/project/${projectId}`);
        send(initialQuery);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally runs once per project: re-running on `send` identity would restart
    // the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Wake the project sandbox automatically in the background.
  useEffect(() => {
    let handle: ChatStreamHandle | null = null;

    // If there is an initial query, it will wake the sandbox automatically during `send`.
    if (!initialQuery) {
      void (async () => {
        handle = wakeProjectStream(await getToken(), projectId, handleEvent, (error) => {
          if (error) console.error('Wake failed:', error);
          setStatus(null);
        });
      })();
    }

    return () => {
      if (handle) handle.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    fetchHealth().then(setHealth);
  }, []);

  /**
   * Load whichever key the user has on file.
   *
   * A server round trip now, where this used to read `sessionStorage`. The upside is the
   * point of the change: a key set on any previous visit, in any tab, is already here and
   * the user is not asked again.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { keys } = await getMyKeys(await getToken());
      if (cancelled) return;

      if (keys.length > 0) setByok(keys[0]!);
      else if (!hasSkippedByok()) setByokOpen(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  /**
   * Fetch the page of history immediately before what is on screen.
   *
   * The first load deliberately returns only the most recent page — a project can run to
   * thousands of events and rendering all of them to show the last ten would be slow for no
   * benefit. This is how the rest stays reachable: the user scrolls up, asks for more, and
   * older turns are prepended.
   */
  const loadEarlier = useCallback(async () => {
    if (loadingEarlier || !hasMore || oldestSeqRef.current === null) return;

    setLoadingEarlier(true);
    try {
      const page = await fetchHistory(await getToken(), projectId, oldestSeqRef.current);

      if (page.events.length > 0) {
        // Prepended, and the cursor moves to the oldest row we now hold. Setting it from
        // the response rather than counting locally keeps it correct even if the server
        // filtered some event types out of the page.
        setItems((prev) => [...replayToItems(page.events), ...prev]);
        oldestSeqRef.current = page.events[0]?.seq ?? oldestSeqRef.current;
      }

      setHasMore(page.hasMore);
    } finally {
      setLoadingEarlier(false);
    }
  }, [getToken, hasMore, loadingEarlier, projectId]);

  const changeMode = useCallback((next: AgentMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const applyByok = useCallback(
    (key: StoredKey | null) => {
      // Null means the user chose to skip; remember that so the modal stops reappearing.
      if (!key) markByokSkipped();
      setByok(key);
      setByokOpen(false);

      // If a key was provided and the last query failed (e.g. auth error), automatically
      // restart the turn with the newly provided key without requiring the user to retype!
      if (key && lastQueryRef.current && !busyRef.current) {
        const retryQuery = lastQueryRef.current;
        lastQueryFailedRef.current = false;

        // Clean up the trailing error card from the transcript so it doesn't clutter the chat
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (
            last &&
            (last.kind === 'error' || (last.kind === 'assistant' && isAuthError(last.text)))
          ) {
            return prev.slice(0, -1);
          }
          return prev;
        });

        void startTurn(retryQuery, true);
      }
    },
    [startTurn],
  );

  const forgetByok = useCallback(async () => {
    if (!byok) return;
    await deleteMyKey(await getToken(), byok.provider);
    setByok(null);
  }, [byok, getToken]);

    const handleClientErrors = useCallback(
    (errors: ClientError[]) => {
      if (errors.length === 0) return;

      const fresh = errors.filter((error) => !reportedErrorsRef.current.has(error.message));
      if (fresh.length === 0 || reportedErrorsRef.current.size >= 100) return;
      for (const error of fresh) reportedErrorsRef.current.add(error.message);

      push({ kind: 'clientErrors', id: crypto.randomUUID(), errors: fresh });
      void (async () => reportClientErrors(await getToken(), projectId, fresh))();
    },
    [projectId, push],
  );

    const requiredSecrets = useMemo(() => {
    const collected = new Map<string, RequiredSecret>();

    for (const item of items) {
      if (item.kind !== 'secrets') continue;
      for (const secret of item.secrets) {
        if (secret.key) collected.set(secret.key, secret);
      }
    }

    return [...collected.values()];
  }, [items]);

    const markSecretsProvided = useCallback((keys: string[]) => {
    setItems((prev) =>
      prev.map((item) =>
        item.kind === 'secrets'
          ? { ...item, provided: [...new Set([...item.provided, ...keys])] }
          : item,
      ),
    );
  }, []);

  useEffect(() => {
    return () => streamRef.current?.abort();
  }, []);

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden">
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b px-4"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
      >
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-heading text-[16px] uppercase tracking-wider leading-none">
              MY-LOVABLE
            </span>
            <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] text-black font-extrabold leading-none">
              AI
            </span>
          </Link>
          <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
            / {projectId.slice(0, 8)}
          </span>
        </div>

        {}
        {health?.model && (
          <div
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
            title={`${health.model.provider} — ${health.model.reason} · served by ${health.backendId}`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: health.model.provider === 'unconfigured' ? '#f87171' : '#4ade80',
              }}
            />
            <span style={{ color: 'var(--text)' }}>{health.model.model}</span>
            <span>· {health.model.provider}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {}
          {byok ? (
            <button
              onClick={() => void forgetByok()}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-all hover:opacity-80"
              style={{
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                background: 'var(--accent-soft)',
              }}
              title={`Your ${byok.provider} key (${byok.maskedPreview}) — click to delete it from your account`}
            >
              <span>Your Key</span>
            </button>
          ) : (
            <button
              onClick={() => setByokOpen(true)}
              className="rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide transition-all hover:bg-white/5 hover:text-white"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}
              title="Run this project on your own API key"
            >
              Use my key
            </button>
          )}

          <button
            onClick={() => setGithubOpen(true)}
            className="flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide transition-all hover:bg-white/5 hover:text-white"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}
          >
            <span>GitHub</span>
          </button>

          <button
            onClick={() => setSecretsOpen(true)}
            className="flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide transition-all hover:bg-white/5 hover:text-white"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}
          >
            <span>Secrets</span>
            {requiredSecrets.length > 0 && (
              <span
                className="ml-2 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-black"
                style={{ background: 'var(--accent)' }}
              >
                {requiredSecrets.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className="flex w-[420px] shrink-0 flex-col border-r"
          style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
        >
          <ChatPanel
            items={items}
            busy={busy}
            status={status}
            queued={queued}
            stopping={stopping}
            paused={paused}
            mode={mode}
            onModeChange={changeMode}
            onSend={send}
            onAnswer={answer}
            onCancelQueued={cancelQueued}
            onStop={stopTurn}
            onResumeQueue={resumeQueue}
            onOpenSecrets={() => setSecretsOpen(true)}
            onOpenByok={() => setByokOpen(true)}
            hasEarlier={hasMore}
            loadingEarlier={loadingEarlier}
            onLoadEarlier={() => void loadEarlier()}
            draft={draft}
            setDraft={setDraft}
            providerPref={providerPref}
            onProviderChange={handleProviderChange}
          />
        </div>

        <div className="min-w-0 flex-1 p-3">
          <PreviewPanel
            url={previewUrl}
            reloadToken={reloadToken}
            onManualReload={() => setReloadToken((n) => n + 1)}
            onClientErrors={handleClientErrors}
          />
        </div>
      </div>

      {secretsOpen && (
        <SecretsPanel
          projectId={projectId}
          required={requiredSecrets}
          onClose={() => setSecretsOpen(false)}
          onSaved={markSecretsProvided}
        />
      )}

      {githubOpen && (
        <GitHubPanel
          projectId={projectId}
          onClose={() => setGithubOpen(false)}
        />
      )}

      {byokOpen && <ByokModal models={health?.byokModels} onDone={applyByok} />}
    </div>
  );
}

function replayToItems(
  events: { seq: number; type: string; payload: Record<string, unknown> }[],
): ChatItem[] {
  const items: ChatItem[] = [];

  for (const event of events) {
    const payload = event.payload ?? {};

    if (event.type === 'user_query') {
      items.push({ kind: 'user', id: `e${event.seq}`, text: String(payload.text ?? '') });
    } else if (event.type === 'text') {
      items.push({
        kind: 'assistant',
        id: `e${event.seq}`,
        text: String(payload.text ?? ''),
        streaming: false,
      });
    } else if (event.type === 'tool_call') {
      if (payload.name === 'question_tool') continue;
      const args = payload.args as Record<string, unknown> | undefined;
      items.push({
        kind: 'tool',
        id: `e${event.seq}`,
        name: String(payload.name ?? 'tool'),
        args: String(args?.comand ?? JSON.stringify(args ?? {})),
      });
    } else if (event.type === 'tool_result') {
      if (payload.name === 'question_tool') continue;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item && item.kind === 'tool' && item.result === undefined) {
          items[i] = {
            ...item,
            result: String(payload.result ?? ''),
            isError: Boolean(payload.isError),
          };
          break;
        }
      }
    } else if (event.type === 'compaction' || event.type === 'summarization') {
      items.push({
        kind: 'compaction',
        id: `e${event.seq}`,
        full: event.type === 'summarization',
        midStream: Boolean(payload.midStream),
        tokensBefore: Number(payload.tokensBefore ?? 0),
        tokensAfter: Number(payload.tokensAfter ?? 0),
        contextWindow: Number(payload.contextWindow ?? 0),
        summary: String(payload.summary ?? ''),
      });
    } else if (event.type === 'secrets_required') {
      const secrets = Array.isArray(payload.secrets)
        ? (payload.secrets as RequiredSecret[]).map((secret) => ({
            key: String(secret.key ?? ''),
            reason: String(secret.reason ?? ''),
          }))
        : [];
      if (secrets.length > 0) {
        items.push({ kind: 'secrets', id: `e${event.seq}`, secrets, provided: [] });
      }
    } else if (event.type === 'verification') {
      items.push({
        kind: 'verification',
        id: `e${event.seq}`,
        ok: Boolean(payload.ok),
        typecheckPassed:
          payload.typecheckPassed === null || payload.typecheckPassed === undefined
            ? null
            : Boolean(payload.typecheckPassed),
        typecheckOutput: String(payload.typecheckOutput ?? ''),
        runtimeErrors: Array.isArray(payload.runtimeErrors)
          ? (payload.runtimeErrors as unknown[]).map(String)
          : [],
      });
    } else if (event.type === 'client_errors') {
      const errors = Array.isArray(payload.errors)
        ? (payload.errors as { level?: unknown; message?: unknown; source?: unknown }[]).map(
            (error) => ({
              level: error.level === 'warn' ? ('warn' as const) : ('error' as const),
              message: String(error.message ?? ''),
              source: String(error.source ?? ''),
            }),
          )
        : [];
      if (errors.length > 0) {
        items.push({ kind: 'clientErrors', id: `e${event.seq}`, errors });
      }
    } else if (event.type === 'question') {
      items.push({
        kind: 'question',
        id: `e${event.seq}`,
        questionId: String(payload.questionId ?? ''),
        question: String(payload.question ?? ''),
        options: Array.isArray(payload.options) ? (payload.options as string[]).map(String) : [],
      });
    } else if (event.type === 'answer') {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item && item.kind === 'question' && item.questionId === payload.questionId) {
          items[i] = { ...item, answer: String(payload.answer ?? '') };
          break;
        }
      }
    }
  }

  return items;
}
