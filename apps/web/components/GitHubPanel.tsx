'use client';

import { useUser } from '@clerk/nextjs';
import { ArrowUpRight, GithubLogo, GitBranch, WarningCircle } from '@phosphor-icons/react';
import { useState, useEffect } from 'react';
import Modal from './Modal';
import { useToken } from '@/lib/useToken';
import {
  fetchGithubStatus,
  fetchGithubRepositories,
  createGithubRepository,
  fetchGithubConnection,
  fetchSecrets,
  pushToGithub,
} from '@/lib/api';

const DATABASE_KEYS = ['DATABASE_URL', 'POSTGRES_URL'];

export default function GitHubPanel({
  projectId,
  projectName,
  onClose,
  onConnectDatabase,
}: {
  projectId: string;
  projectName?: string | null;
  onClose: () => void;
  onConnectDatabase: () => void;
}) {
  const getToken = useToken();
  const { user } = useUser();
  const [linking, setLinking] = useState(false);
  const githubAccount = user?.externalAccounts.find((account) => account.provider === 'github');
  const hasRepoScope = Boolean(githubAccount?.approvedScopes?.split(/[ ,]+/).includes('repo'));

  const linkGithub = async () => {
    if (!user) return;
    setLinking(true);
    setError(null);
    try {
      const redirectUrl = window.location.href;
      const account = githubAccount
        ? await githubAccount.reauthorize({ redirectUrl, additionalScopes: ['repo'] })
        : await user.createExternalAccount({ strategy: 'oauth_github', redirectUrl, additionalScopes: ['repo'] });
      const next = account.verification?.externalVerificationRedirectURL;
      if (next) window.location.href = next.href;
      else setLinking(false);
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage || err?.message || 'GitHub sign-in is not turned on for this app yet.');
      setLinking(false);
    }
  };
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<any[]>([]);
  const [connection, setConnection] = useState<any>(null);

  const [selectedRepo, setSelectedRepo] = useState<string>('new');
  const [newRepoName, setNewRepoName] = useState(
    (projectName ?? 'inkling-app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inkling-app',
  );
  const [isPrivate, setIsPrivate] = useState(true);

  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usesMemory, setUsesMemory] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningAccepted, setWarningAccepted] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const token = await getToken();
        fetchSecrets(token, projectId)
          .then(({ secrets }) => {
            if (active) setUsesMemory(!secrets.some((secret) => DATABASE_KEYS.includes(secret.key)));
          })
          .catch(() => {});
        const status = await fetchGithubStatus(token);
        if (active) {
          setConnected(status.connected);
          if (status.connected) {
            const [reposData, connData] = await Promise.all([
              fetchGithubRepositories(token),
              fetchGithubConnection(token, projectId),
            ]);
            if (active) {
              setRepos(reposData.repositories);
              setConnection(connData.connection);
              if (connData.connection) {
                setSelectedRepo(connData.connection.repository);
              } else if (reposData.repositories.length > 0) {
                setSelectedRepo('new');
              }
            }
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'We could not reach GitHub. Try again in a moment.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [getToken, projectId]);

  const handlePush = () => {
    if (usesMemory && !warningAccepted) {
      setWarningOpen(true);
      return;
    }
    void push();
  };

  const push = async () => {
    setError(null);
    setPushing(true);
    try {
      const token = await getToken();
      let repoToPush = selectedRepo;

      if (selectedRepo === 'new') {
        if (!newRepoName) throw new Error('Give the new repository a name first.');
        const repoData = await createGithubRepository(token, newRepoName, isPrivate);
        repoToPush = repoData.repository.name;
      }

      const result = await pushToGithub(token, projectId, repoToPush);
      setConnection(result.connection);
    } catch (err: any) {
      setError(err.message || 'Saving to GitHub failed. Try again in a moment.');
    } finally {
      setPushing(false);
    }
  };

  if (warningOpen) {
    return (
      <Modal title="Before you take your app with you" tone="warning" onClose={() => setWarningOpen(false)}>
        <div className="space-y-3 text-[14px] leading-relaxed text-[var(--text)]/80">
          <p>
            Right now your app keeps things like sign-ups, messages and orders in temporary memory. Think of it like a
            whiteboard: it works while your app runs here, but it is wiped clean when the app restarts or moves somewhere
            new.
          </p>
          <p>
            If you continue, your app will start fresh in its new home, and{' '}
            <strong className="font-semibold text-[var(--text)]">anything saved so far will be lost</strong>.
          </p>
          <p>To keep everything safe, connect a database first. It gives your app a permanent notebook.</p>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <button type="button" onClick={onConnectDatabase} className="btn-primary w-full">
            Connect a database first
          </button>
          <button
            type="button"
            onClick={() => {
              setWarningAccepted(true);
              setWarningOpen(false);
              void push();
            }}
            className="btn-ghost w-full"
          >
            Continue anyway
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Save your code to GitHub"
      description="Your whole project goes into a GitHub repository, so you own the code and can take it anywhere."
      onClose={onClose}
    >
      {loading ? (
        <div className="space-y-3" aria-label="Loading">
          <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--panel-hover)]" />
          <div className="h-10 animate-pulse rounded-[10px] bg-[var(--panel-hover)]" />
          <div className="h-10 animate-pulse rounded-[10px] bg-[var(--cream)]" />
        </div>
      ) : !connected || !hasRepoScope ? (
        <div className="space-y-4">
          <ol className="space-y-3 text-[14px] leading-relaxed text-[var(--text)]/85">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border-2 border-[var(--edge)] bg-[var(--lime)] text-[12px] font-semibold text-[var(--accent-text)]">1</span>
              {connected ? 'Give Inkling permission to create and update your repositories.' : 'Connect your GitHub account. You will be sent to GitHub to approve, then brought back here.'}
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border-2 border-[var(--line-strong)] bg-[var(--panel)] text-[12px] font-semibold text-[var(--muted)]">2</span>
              Pick a repository, or create a new one, and save.
            </li>
          </ol>
          {error && (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-[var(--error)]">
              <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <button onClick={() => void linkGithub()} disabled={linking} className="btn-primary w-full">
            <GithubLogo size={16} weight="fill" />
            {linking ? 'Opening GitHub…' : connected ? 'Give access on GitHub' : 'Connect GitHub'}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {connection ? (
            <div className="rounded-[10px] border-2 border-[var(--edge)] bg-[var(--cream)] p-4">
              <p className="text-[12px] text-[var(--muted)]">Saving to</p>
              <p className="mt-1 flex items-center gap-2 font-mono text-[13px]">
                <GithubLogo size={14} weight="fill" className="shrink-0" />
                <span className="min-w-0 break-all">{connection.repository}</span>
              </p>
              <p className="mt-2 flex items-center gap-2 font-mono text-[12px] text-[var(--muted)]">
                <GitBranch size={14} className="shrink-0" />
                {connection.branch}
              </p>
              {connection.lastSyncedCommit && (
                <a
                  href={`https://github.com/${connection.repository}/tree/${connection.branch}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 mr-4 inline-flex items-center gap-1 text-[13px] text-[var(--accent-text)] hover:underline"
                >
                  Open on GitHub
                  <ArrowUpRight size={12} />
                </a>
              )}
              {connection.prUrl && (
                <a
                  href={connection.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[13px] text-[var(--accent-text)] hover:underline"
                >
                  View pull request #{connection.prNumber}
                  <ArrowUpRight size={12} />
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="gh-repo" className="field-label">
                  Repository
                </label>
                <select id="gh-repo" value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} className="field">
                  {repos.map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                  <option value="new">Create a new repository</option>
                </select>
              </div>

              {selectedRepo === 'new' && (
                <div className="space-y-3 rounded-[10px] border-2 border-[var(--edge)] bg-[var(--cream)] p-4">
                  <div>
                    <label htmlFor="gh-new" className="field-label">
                      Name
                    </label>
                    <input
                      id="gh-new"
                      type="text"
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="my-bakery-site"
                      className="field"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    Keep it private
                  </label>
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-[var(--error)]">
              <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <button
            onClick={handlePush}
            disabled={pushing || (selectedRepo === 'new' && !newRepoName)}
            className="btn-primary w-full"
          >
            {pushing ? 'Saving to GitHub…' : connection ? 'Save latest changes' : 'Save to GitHub'}
          </button>
        </div>
      )}
    </Modal>
  );
}
