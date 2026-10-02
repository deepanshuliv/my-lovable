'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { CaretLeft, GithubLogo, Sliders } from '@phosphor-icons/react';
import CreditsPill from '@/components/Credits';
import ThemeToggle from '@/components/ThemeToggle';
import ByokModal from '@/components/ByokModal';
import ChatPanel from '@/components/ChatPanel';
import PreviewPanel, { type ClientError } from '@/components/PreviewPanel';
import SecretsPanel from '@/components/SecretsPanel';
import GitHubPanel from '@/components/GitHubPanel';
import {
  fetchHealth,
  fetchHistory,
  listProjects,
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
  DEFAULT_PREFERENCE,
  isAuthError,
  isByokProvider,
  getProviderPreference,
  setProviderPreference,
  type ByokProvider,
  type ProviderPreference,
} from '@/lib/byok';
import { START_PROGRESS, advance, fromStage, fromTool, type BuildProgress } from '@/lib/phase';
import { useCredits } from '@/lib/useCredits';
import { useToken } from '@/lib/useToken';
import { useSandboxPresence } from '@/lib/useSandboxPresence';
import { toolTarget } from '@/lib/tools';
import type { AgentMode, ChatItem, KeyRequestStatus, RequiredSecret, StreamEvent } from '@/lib/types';

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q');

  const getToken = useToken();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [appBuilt, setAppBuilt] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
    const [queued, setQueued] = useState<{ id: string; text: string }[]>([]);
    const [stopping, setStopping] = useState(false);
    const [paused, setPaused] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const { credits, refresh: refreshCredits } = useCredits();
  const [progress, setProgress] = useState<BuildProgress>(START_PROGRESS);
  const [projectName, setProjectName] = useState<string | null>(null);
    const [mode, setMode] = useState<AgentMode>('build');
    const [draft, setDraft] = useState('');
  const [mobileView, setMobileView] = useState<'chat' | 'preview'>('chat');
  const [savedKeys, setSavedKeys] = useState<StoredKey[]>([]);
  const [byokFor, setByokFor] = useState<ByokProvider | null>(null);
  const [providerPref, setProviderPref] = useState<ProviderPreference>(DEFAULT_PREFERENCE);

  useEffect(() => {
    setProviderPref(getProviderPreference());
  }, []);

  const choosePreference = useCallback((next: ProviderPreference) => {
    setProviderPref(next);
    setProviderPreference(next);
  }, []);

  const handleProviderChange = useCallback(
    (provider: ByokProvider, usePlatform: boolean) => {
      if (usePlatform || savedKeys.some((key) => key.provider === provider)) {
        choosePreference({ provider, usePlatform });
        return;
      }
      setByokFor(provider);
    },
    [choosePreference, savedKeys],
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
          if (HIDDEN_TOOLS.has(String(event.name))) return;
          const name = String(event.name ?? 'tool');
          const target = toolTarget(name, event.args as Record<string, unknown> | undefined);
          const step = fromTool(name, target);
          setProgress((current) => advance(current, step));
          setStatus(step.detail);
          push({ kind: 'tool', id: crypto.randomUUID(), name, args: target });
          return;
        }

        case 'tool_result': {
          if (HIDDEN_TOOLS.has(String(event.name))) return;
          setStatus('Thinking about the next step');
          setProgress((current) => advance(current, { phase: null, detail: 'Thinking about the next step' }));
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

        case 'running': {
          const step = fromStage(String(event.stage ?? ''));
          setProgress((current) => advance(current, step));
          setStatus(step.detail);
          return;
        }

        case 'preview_ready':
          setPreviewUrl(String(event.url ?? ''));
          return;

        case 'preview_reload':
          setProgress((current) => advance(current, { phase: 4, detail: 'Refreshing your preview' }));
          setAppBuilt(true);
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

        case 'keys_request': {
          const item = keyRequestItem(crypto.randomUUID(), event);
          if (item) push(item);
          setStatus(null);
          return;
        }

        case 'keys_status': {
          const status = keyStatus(event.status);
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'keys' && item.requestId === event.requestId ? { ...item, status } : item,
            ),
          );
          return;
        }

        case 'verification':
          setProgress((current) => advance(current, { phase: 3, detail: event.ok ? 'Everything checks out' : 'Fixing a problem it found' }));
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
      setProgress(START_PROGRESS);
      setStatus('Getting started');

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
              stage: 'Stopped. Everything done so far is saved.',
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
          getToken,
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
        setAppBuilt(
          history.events.some(
            (event) =>
              event.type === 'verification' ||
              (event.type === 'tool_call' && ['write_file', 'edit_file'].includes(String(event.payload?.name))),
          ),
        );
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
  }, [projectId]);

  useEffect(() => {
    let handle: ChatStreamHandle | null = null;

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
  }, [projectId]);

  useSandboxPresence({
    projectId,
    getToken,
    onEvent: handleEvent,
    isBusy: () => busyRef.current,
    onWaking: () => setStatus('Waking up your workspace'),
    onAwake: () => {
      setStatus(null);
      setReloadToken((n) => n + 1);
    },
  });

  useEffect(() => {
    fetchHealth().then(setHealth);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const projects = await listProjects(await getToken());
        if (live) setProjectName(projects.find((project) => project.id === projectId)?.name ?? null);
      } catch {
        if (live) setProjectName(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [getToken, projectId, busy]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { keys } = await getMyKeys(await getToken());
      if (cancelled) return;
      setSavedKeys(keys);
      const pref = getProviderPreference();
      if (!pref.usePlatform && !keys.some((key) => key.provider === pref.provider)) {
        choosePreference(DEFAULT_PREFERENCE);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [choosePreference, getToken]);

  const loadEarlier = useCallback(async () => {
    if (loadingEarlier || !hasMore || oldestSeqRef.current === null) return;

    setLoadingEarlier(true);
    try {
      const page = await fetchHistory(await getToken(), projectId, oldestSeqRef.current);

      if (page.events.length > 0) {
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

  const retryLastQuery = useCallback(() => {
    if (!lastQueryRef.current || busyRef.current) return;
    const retryQuery = lastQueryRef.current;
    lastQueryFailedRef.current = false;

    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last && (last.kind === 'error' || (last.kind === 'assistant' && isAuthError(last.text)))) {
        return prev.slice(0, -1);
      }
      return prev;
    });

    void startTurn(retryQuery, true);
  }, [startTurn]);

  const applyByok = useCallback(
    (key: StoredKey) => {
      setSavedKeys((prev) => [key, ...prev.filter((item) => item.provider !== key.provider)]);
      setByokFor(null);
      if (isByokProvider(key.provider)) {
        const next = { provider: key.provider, usePlatform: false };
        choosePreference(next);
        providerPrefRef.current = next;
      }
      if (lastQueryFailedRef.current) retryLastQuery();
    },
    [choosePreference, retryLastQuery],
  );

  const forgetByok = useCallback(
    async (provider: ByokProvider) => {
      await deleteMyKey(await getToken(), provider);
      setSavedKeys((prev) => prev.filter((item) => item.provider !== provider));
      setByokFor(null);
      if (!providerPref.usePlatform && providerPref.provider === provider) choosePreference(DEFAULT_PREFERENCE);
    },
    [choosePreference, getToken, providerPref],
  );

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
    if (!busy) {
      void refreshCredits();
      return;
    }
    const timer = setInterval(() => void refreshCredits(), 3_000);
    return () => clearInterval(timer);
  }, [busy, refreshCredits]);

  useEffect(() => {
    const leave = () => streamRef.current?.abort();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden">
      <header className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b-2 border-[var(--edge)] bg-[var(--paper)] px-3 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/dashboard"
            aria-label="Back to your projects"
            title="Back to your projects"
            className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] shadow-[var(--hard-sm)] transition-[background-color,transform,box-shadow] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:bg-[var(--lime)] hover:shadow-[2px_2px_0_var(--edge)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
          >
            <CaretLeft size={16} weight="bold" className="transition-transform duration-200 group-hover:-translate-x-0.5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-bold leading-tight tracking-[-0.025em]">
              {projectName ?? 'Untitled project'}
            </h1>
            <p className="hidden truncate text-[12.5px] font-medium text-[var(--muted)] sm:flex sm:items-center sm:gap-1.5">
              {busy && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full border border-[var(--edge)] bg-[var(--lime)]" />}
              {busy ? progress.detail : appBuilt ? 'Ask for changes in the chat' : 'Describe what you want in the chat'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => setSecretsOpen(true)} className="btn-ghost btn-sm relative" title="Keys your app uses, like payments or email">
            <Sliders size={15} />
            <span className="hidden lg:inline">App settings</span>
            {requiredSecrets.length > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-[5px] border-[1.5px] border-[var(--edge)] bg-[var(--lime)] px-1 text-[10.5px] font-bold text-[var(--accent-ink)]">
                {requiredSecrets.length}
              </span>
            )}
          </button>

          <button onClick={() => setGithubOpen(true)} className="btn-ghost btn-sm" title="Save your code to GitHub">
            <GithubLogo size={15} weight="fill" />
            <span className="hidden lg:inline">GitHub</span>
          </button>

          <ThemeToggle className="hidden sm:flex" />
          <span className="hidden sm:block">
            <CreditsPill />
          </span>

          <span className="ml-1 flex h-9 items-center">
            <UserButton />
          </span>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 border-b-2 border-[var(--edge)] bg-[var(--cream)] p-2 md:hidden" role="tablist">
        {(['chat', 'preview'] as const).map((view) => (
          <button
            key={view}
            role="tab"
            aria-selected={mobileView === view}
            onClick={() => setMobileView(view)}
            className={`flex-1 rounded-[8px] py-2 text-[13px] font-medium capitalize transition-colors ${
              mobileView === view ? 'border-2 border-[var(--edge)] bg-[var(--lime)] font-bold' : 'border-2 border-transparent text-[var(--muted)]'
            }`}
          >
            {view}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={`${mobileView === 'chat' ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-[var(--edge)] bg-[var(--paper)] md:flex md:w-[380px] md:border-r-2 xl:w-[440px]`}
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
            onOpenByok={() => setByokFor(providerPref.usePlatform ? 'openrouter' : providerPref.provider)}
            hasEarlier={hasMore}
            loadingEarlier={loadingEarlier}
            onLoadEarlier={() => void loadEarlier()}
            draft={draft}
            setDraft={setDraft}
            providerPref={providerPref}
            onProviderChange={handleProviderChange}
            platformCreditsLeft={credits?.remainingUnits ?? null}
            savedKeyProviders={savedKeys.map((key) => key.provider)}
          />
        </div>

        <div className={`${mobileView === 'preview' ? 'block' : 'hidden'} min-w-0 flex-1 bg-[var(--cream)] p-2 md:block md:p-4`}>
          <PreviewPanel
            url={previewUrl}
            reloadToken={reloadToken}
            onManualReload={() => setReloadToken((n) => n + 1)}
            onClientErrors={handleClientErrors}
            building={busy}
            progress={progress}
            appBuilt={appBuilt}
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
          projectName={projectName}
          onClose={() => setGithubOpen(false)}
          onConnectDatabase={() => {
            setGithubOpen(false);
            setDraft('Connect a real database to my website so nothing gets lost.');
          }}
        />
      )}

      {byokFor && (
        <ByokModal
          initialProvider={byokFor}
          models={health?.byokModels}
          saved={savedKeys}
          onSaved={applyByok}
          onClose={() => setByokFor(null)}
          onForget={(provider) => void forgetByok(provider)}
        />
      )}
    </div>
  );
}

function replayToItems(
  events: { seq: number; type: string; payload: Record<string, unknown> }[],
): ChatItem[] {
  const items: ChatItem[] = [];
  let skipResult = false;

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
      if (HIDDEN_TOOLS.has(String(payload.name))) continue;
      if (JSON.stringify(payload.args ?? {}).includes('.agents/')) {
        skipResult = true;
        continue;
      }
      const name = String(payload.name ?? 'tool');
      items.push({
        kind: 'tool',
        id: `e${event.seq}`,
        name,
        args: toolTarget(name, payload.args as Record<string, unknown> | undefined),
      });
    } else if (event.type === 'tool_result') {
      if (HIDDEN_TOOLS.has(String(payload.name))) continue;
      if (skipResult) {
        skipResult = false;
        continue;
      }
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
    } else if (event.type === 'keys_request') {
      const item = keyRequestItem(`e${event.seq}`, payload);
      if (item) items.push(item);
    } else if (event.type === 'keys_status') {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item && item.kind === 'keys' && item.requestId === payload.requestId) {
          items[i] = { ...item, status: keyStatus(payload.status) };
          break;
        }
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

const HIDDEN_TOOLS = new Set(['question_tool', 'request_api_keys']);

function keyStatus(value: unknown): KeyRequestStatus {
  return value === 'verified' || value === 'declined' || value === 'expired' ? value : 'pending';
}

function keyRequestItem(id: string, payload: Record<string, unknown>): ChatItem | null {
  const keys = Array.isArray(payload.keys)
    ? (payload.keys as Record<string, unknown>[]).map((key) => ({
        key: String(key.key ?? ''),
        reason: String(key.reason ?? ''),
        service: String(key.service ?? 'Service key'),
        helpUrl: typeof key.helpUrl === 'string' ? key.helpUrl : undefined,
      }))
    : [];
  if (keys.length === 0) return null;
  return {
    kind: 'keys',
    id,
    requestId: String(payload.requestId ?? ''),
    service: String(payload.service ?? ''),
    keys,
    status: 'pending',
  };
}
