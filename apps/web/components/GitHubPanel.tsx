import { useState, useEffect } from 'react';
import { useToken } from '@/lib/useToken';
import {
  fetchGithubStatus,
  fetchGithubRepositories,
  createGithubRepository,
  fetchGithubConnection,
  pushToGithub,
} from '@/lib/api';

export default function GitHubPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const getToken = useToken();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<any[]>([]);
  const [connection, setConnection] = useState<any>(null);

  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [newRepoName, setNewRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const token = await getToken();
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
                setSelectedRepo(reposData.repositories[0].name);
              }
            }
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to load GitHub status');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [getToken, projectId]);

  const handlePush = async () => {
    setError(null);
    setPushing(true);
    try {
      const token = await getToken();
      let repoToPush = selectedRepo;
      
      if (selectedRepo === 'new') {
        if (!newRepoName) throw new Error('Please enter a repository name');
        const repoData = await createGithubRepository(token, newRepoName, isPrivate);
        repoToPush = repoData.repository.name;
      }
      
      const result = await pushToGithub(token, projectId, repoToPush);
      setConnection(result.connection);
    } catch (err: any) {
      setError(err.message || 'Failed to push to GitHub');
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-xl border bg-[var(--panel)] p-6 shadow-xl"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text)]">Push to GitHub</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-[var(--muted)] hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-[var(--muted)]">Loading GitHub status...</div>
        ) : !connected ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Connect your GitHub account to push your project.
            </p>
            <button
              onClick={() => {
                alert('Please configure Clerk OAuth GitHub connection in your dashboard. Once connected, refresh this page.');
              }}
              className="w-full rounded bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-200"
            >
              Connect GitHub
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {connection ? (
              <div className="rounded border border-[var(--line-strong)] bg-white/5 p-3">
                <div className="text-xs font-semibold text-[var(--muted)]">CONNECTED REPOSITORY</div>
                <div className="mt-1 font-mono text-sm text-[var(--text)]">{connection.repository}</div>
                <div className="mt-2 text-xs font-semibold text-[var(--muted)]">BRANCH</div>
                <div className="mt-1 font-mono text-sm text-[var(--text)]">{connection.branch}</div>
                
                {connection.prUrl && (
                  <div className="mt-3">
                    <a href={connection.prUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] hover:underline">
                      View Pull Request #{connection.prNumber} ↗
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-[var(--text)]">Repository</label>
                <select
                  value={selectedRepo}
                  onChange={(e) => setSelectedRepo(e.target.value)}
                  className="w-full rounded border border-[var(--line)] bg-transparent p-2 text-sm text-[var(--text)] outline-none transition-all focus:border-[var(--accent)]/30 focus:ring-4 focus:ring-[var(--accent)]/10"
                >
                  {repos.map(r => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                  <option value="new">+ Create new repository</option>
                </select>

                {selectedRepo === 'new' && (
                  <div className="space-y-3 rounded border border-[var(--line-strong)] bg-white/5 p-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)]">Repository Name</label>
                      <input
                        type="text"
                        value={newRepoName}
                        onChange={(e) => setNewRepoName(e.target.value)}
                        placeholder="my-awesome-project"
                        className="mt-1 w-full rounded border border-[var(--line)] bg-transparent p-2 text-sm text-[var(--text)] outline-none transition-all focus:border-[var(--accent)]/30 focus:ring-4 focus:ring-[var(--accent)]/10"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="isPrivate"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                      />
                      <label htmlFor="isPrivate" className="text-xs text-[var(--muted)]">Private repository</label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && <div className="text-sm text-red-500">{error}</div>}

            <button
              onClick={handlePush}
              disabled={pushing || (selectedRepo === 'new' && !newRepoName)}
              className="mt-4 w-full rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {pushing ? 'Pushing to GitHub...' : connection ? 'Push latest changes' : 'Push to GitHub'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
