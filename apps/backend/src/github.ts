import { createClerkClient } from '@clerk/backend';
import { executeCommand, type ProjectSandbox } from './sandbox';
import { commitBaseline } from './sandbox/git';
import { CLERK_SECRET_KEY } from './config';

const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });

export async function getGithubToken(userId: string): Promise<string | null> {
  try {
    const response = await clerkClient.users.getUserOauthAccessToken(userId, 'oauth_github');
    
    if (response?.data && response.data.length > 0) {
      return response.data[0]?.token || null;
    }
    return null;
  } catch (error) {
    console.log('[GITHUB_OAUTH_TOKEN_ERROR]', String(error).slice(0, 200));
    return null;
  }
}

export async function listRepositories(token: string) {
  const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const repos = await response.json();
  return repos.map((repo: any) => ({
    id: repo.id,
    name: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
  }));
}

export async function createRepository(token: string, name: string, isPrivate: boolean) {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      private: isPrivate,
      auto_init: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const repo = await response.json();
  return {
    id: repo.id,
    name: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
  };
}

export async function pushToGitHub(
  entry: ProjectSandbox,
  repoFullName: string,
  branch: string,
  token: string,
): Promise<{ commitSha: string }> {
  const { projectId, rootDir } = entry;

  await commitBaseline(entry);

  const remoteUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  const remoteName = `lovable_${Date.now()}`; 

  try {
    
    await entry.sandbox.git.add(rootDir, ['.']);
    try {
      await entry.sandbox.git.commit(
        rootDir,
        'Update from Lovable AI',
        'my-lovable agent',
        'agent@my-lovable.local',
        false 
      );
    } catch (e) {
      
    }

    await executeCommand(projectId, `cd ${rootDir} && git remote add ${remoteName} ${remoteUrl}`);

    const branchCmd = await executeCommand(projectId, `cd ${rootDir} && git branch --show-current`);
    let currentBranch = branchCmd.output.trim();
    if (!currentBranch) {
      currentBranch = 'main';
      await executeCommand(projectId, `cd ${rootDir} && git checkout -b main`);
    }

    const pushCmd = await executeCommand(projectId, `cd ${rootDir} && git push -u -f ${remoteName} HEAD:refs/heads/${branch}`);
    
    if (pushCmd.exitCode !== 0) {
      throw new Error(`Git push failed: ${pushCmd.output.slice(-500)}`);
    }

    const shaCmd = await executeCommand(projectId, `cd ${rootDir} && git rev-parse HEAD`);
    return { commitSha: shaCmd.output.trim() };

  } finally {
    
    await executeCommand(projectId, `cd ${rootDir} && git remote remove ${remoteName}`).catch(() => {});
  }
}

export async function createOrUpdatePullRequest(
  token: string,
  repoFullName: string,
  branch: string,
  title: string,
  body: string
) {
  const [owner, repo] = repoFullName.split('/');

  const listResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (listResponse.ok) {
    const prs = await listResponse.json();
    if (prs && prs.length > 0) {
      
      return {
        prNumber: prs[0].number,
        prUrl: prs[0].html_url,
      };
    }
  }

  const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!repoResponse.ok) throw new Error('Failed to fetch repository details');
  const repoData = await repoResponse.json();
  const defaultBranch = repoData.default_branch;

  if (branch === defaultBranch) {
    
    return {
      prNumber: null,
      prUrl: null,
    };
  }

  const createResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      head: branch,
      base: defaultBranch,
      body,
    }),
  });

  if (!createResponse.ok) {
    
    const errText = await createResponse.text();
    if (errText.includes('No commits between')) {
      return { prNumber: null, prUrl: null };
    }
    throw new Error(`Failed to create PR: ${createResponse.status} ${errText}`);
  }

  const pr = await createResponse.json();
  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
  };
}
