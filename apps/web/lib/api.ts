import type { ByokProvider } from './byok';
import type { AgentMode, SecretSummary, StreamEvent } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export type Token = string | null;

function authHeaders(token: Token, json = false): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredKey = {
  provider: 'openrouter' | 'gemini';
  maskedPreview: string;
  model: string | null;
  updatedAt: string;
};

export type HealthInfo = {
  backendId: string;
  model: { provider: string; model: string; reason: string };
  memory: string;
  storage: string;
  secrets: string;
  sandbox: string;
  template: string;
    byokModels?: Record<string, { id: string; recommended: boolean }[]>;
    auth?: string;
    userKeys?: string;
};

export async function fetchHealth(): Promise<HealthInfo | null> {
  try {
    const response = await fetch(`${API_URL}/health`);
    if (!response.ok) return null;
    return (await response.json()) as HealthInfo;
  } catch {
    return null;
  }
}

export async function createProject(token: Token, prompt: string): Promise<string> {
  const response = await fetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) throw new Error(`could not create project: ${response.status}`);
  const data = (await response.json()) as { projectId: string };
  return data.projectId;
}

export async function listProjects(token: Token): Promise<ProjectSummary[]> {
  const response = await fetch(`${API_URL}/projects`, { headers: authHeaders(token) });
  if (!response.ok) return [];
  const data = (await response.json()) as { projects: ProjectSummary[] };
  return data.projects ?? [];
}

export async function renameProject(token: Token, projectId: string, name: string) {
  const response = await fetch(`${API_URL}/projects/${projectId}`, {
    method: 'PATCH',
    headers: authHeaders(token, true),
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { msg?: string };
    throw new Error(body.msg || `rename failed: ${response.status}`);
  }
  return (await response.json()) as { project: ProjectSummary };
}

export async function deleteProject(token: Token, projectId: string) {
  const response = await fetch(`${API_URL}/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { msg?: string };
    throw new Error(body.msg || `delete failed: ${response.status}`);
  }
}

export async function fetchHistory(token: Token, projectId: string, before?: number) {
  const url = new URL(`${API_URL}/projects/${projectId}/history`);
  if (before) url.searchParams.set('before', String(before));

  const response = await fetch(url.toString(), { headers: authHeaders(token) });
  if (!response.ok) return { events: [], hasMore: false };
  return (await response.json()) as {
    events: { seq: number; type: string; payload: Record<string, unknown> }[];
    hasMore: boolean;
  };
}

export async function sendAnswer(token: Token, questionId: string, answer: string) {
  await fetch(`${API_URL}/answer/${questionId}`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ answer }),
  });
}

export async function fetchSecrets(token: Token, projectId: string) {
  const response = await fetch(`${API_URL}/projects/${projectId}/secrets`, {
    headers: authHeaders(token),
  });
  if (!response.ok) return { secrets: [] as SecretSummary[], enabled: false };
  return (await response.json()) as { secrets: SecretSummary[]; enabled: boolean };
}

export async function removeSecret(token: Token, projectId: string, key: string) {
  await fetch(`${API_URL}/projects/${projectId}/secrets/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
}

export async function saveSecretsBatch(
  token: Token,
  projectId: string,
  secrets: { key: string; value: string }[],
) {
  const response = await fetch(`${API_URL}/projects/${projectId}/secrets/batch`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ secrets }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { msg?: string };
    throw new Error(body.msg || `save failed: ${response.status}`);
  }

  return (await response.json()) as {
    secrets: SecretSummary[];
    rejected: { key: string; msg: string }[];
  };
}

export async function reportClientErrors(
  token: Token,
  projectId: string,
  errors: { level: 'error' | 'warn'; message: string; source: string }[],
) {
  try {
    await fetch(`${API_URL}/projects/${projectId}/client-errors`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ errors }),
    });
  } catch {
    
  }
}

export type ChatStreamHandle = { abort: () => void };

export function openChatStream(
  token: Token,
  projectId: string,
  query: string,
  onEvent: (event: StreamEvent) => void,
  onClose: (error?: string) => void,
  options?: { mode?: AgentMode; provider?: ByokProvider; usePlatform?: boolean },
): ChatStreamHandle {
  const controller = new AbortController();

  void (async () => {
    try {
      const response = await fetch(`${API_URL}/chat/${projectId}`, {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({
          query,
          mode: options?.mode ?? 'build',
          provider: options?.provider,
          usePlatform: options?.usePlatform,
        }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        onClose('please sign in');
        return;
      }

      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { msg?: string };
        onClose(body.msg || 'this project is open in another session');
        return;
      }

      if (!response.ok || !response.body) {
        onClose(`chat failed: ${response.status}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. A partial frame stays in the buffer
        // until the rest of it arrives.
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');

          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;

          try {
            onEvent(JSON.parse(line.slice(6)) as StreamEvent);
          } catch {
            
          }
        }
      }

      onClose();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        onClose();
        return;
      }
      onClose(String(error));
    }
  })();

  return { abort: () => controller.abort() };
}

export function wakeProjectStream(
  token: Token,
  projectId: string,
  onEvent: (event: StreamEvent) => void,
  onClose: (error?: string) => void,
): ChatStreamHandle {
  const controller = new AbortController();

  void (async () => {
    try {
      const response = await fetch(`${API_URL}/projects/${projectId}/wake`, {
        method: 'POST',
        headers: authHeaders(token),
        signal: controller.signal,
      });

      if (response.status === 401) {
        onClose('please sign in');
        return;
      }

      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { msg?: string };
        onClose(body.msg || 'this project is open in another session');
        return;
      }

      if (!response.ok || !response.body) {
        onClose(`wake failed: ${response.status}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');

          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;

          try {
            onEvent(JSON.parse(line.slice(6)) as StreamEvent);
          } catch {
            
          }
        }
      }

      onClose();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        onClose();
        return;
      }
      onClose(String(error));
    }
  })();

  return { abort: () => controller.abort() };
}

export async function getMyKeys(token: Token) {
  const response = await fetch(`${API_URL}/me/keys`, { headers: authHeaders(token) });
  if (!response.ok) return { keys: [] as StoredKey[], enabled: false };
  return (await response.json()) as { keys: StoredKey[]; enabled: boolean };
}

export async function saveMyKey(
  token: Token,
  provider: 'openrouter' | 'gemini',
  apiKey: string,
  model?: string,
) {
  const response = await fetch(`${API_URL}/me/keys`, {
    method: 'PUT',
    headers: authHeaders(token, true),
    body: JSON.stringify({ provider, apiKey, model }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { msg?: string };
    throw new Error(body.msg || `could not save key: ${response.status}`);
  }

  return (await response.json()) as { key: StoredKey };
}

export async function deleteMyKey(token: Token, provider: 'openrouter' | 'gemini') {
  await fetch(`${API_URL}/me/keys/${provider}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
}

export async function fetchGithubStatus(token: Token) {
  const response = await fetch(`${API_URL}/github/status`, {
    headers: authHeaders(token),
  });
  if (!response.ok) return { connected: false };
  return (await response.json()) as { connected: boolean };
}

export async function fetchGithubRepositories(token: Token) {
  const response = await fetch(`${API_URL}/github/repositories`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error('Failed to fetch repositories');
  return (await response.json()) as { repositories: { id: number; name: string; private: boolean; defaultBranch: string }[] };
}

export async function createGithubRepository(token: Token, name: string, isPrivate: boolean) {
  const response = await fetch(`${API_URL}/github/repositories`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ name, isPrivate }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.msg || 'Failed to create repository');
  }
  return (await response.json()) as { repository: { id: number; name: string; private: boolean; defaultBranch: string } };
}

export async function fetchGithubConnection(token: Token, projectId: string) {
  const response = await fetch(`${API_URL}/projects/${projectId}/github`, {
    headers: authHeaders(token),
  });
  if (!response.ok) return { connection: null };
  return (await response.json()) as {
    connection: {
      projectId: string;
      repository: string;
      branch: string;
      prNumber: number | null;
      prUrl: string | null;
      lastSyncedCommit: string | null;
    } | null;
  };
}

export async function pushToGithub(token: Token, projectId: string, repository: string, title?: string, body?: string) {
  const response = await fetch(`${API_URL}/projects/${projectId}/github/push`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ repository, title, body }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.msg || 'Failed to push to GitHub');
  }
  return (await response.json()) as { success: boolean; connection: any };
}
