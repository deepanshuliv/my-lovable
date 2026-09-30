export const lockKey = (projectId: string) => `lock:project:${projectId}`;

export const ownerKey = (projectId: string) => `project:${projectId}:owner`;

export const liveKey = (projectId: string) => `project:${projectId}:live`;

export const seqKey = (projectId: string) => `project:${projectId}:seq`;

export const answerChannel = (questionId: string) => `answer:${questionId}`;

export const sessionKey = (projectId: string) => `session:${projectId}:history`;

export const previewKey = (projectId: string) => `project:${projectId}:preview`;

export const questionOwnerKey = (questionId: string) => `question:${questionId}:project`;

export const recentEventsKey = (projectId: string) => `project:${projectId}:recent-events`;

export const projectUserKey = (projectId: string) => `project:${projectId}:user`;

export const projectSandboxKey = (projectId: string) => `project:${projectId}:sandbox-id`;

export const projectSandboxDirtyKey = 'project:sandbox-id:dirty';

export const taskStateKey = (taskId: string) => `taskstate:${taskId}`;

export const taskStateDirtyKey = 'taskstate:dirty';

export const secretsCacheKey = (projectId: string) => `project:${projectId}:secrets-encrypted`;

export const userKeyCacheKey = (userId: string) => `user:${userId}:provider-key-encrypted`;

export const pendingChargesKey = 'credits:pending-charges';

export const previewTokenKey = (projectId: string) => `project:${projectId}:preview-token`;

export const keyRequestKey = (requestId: string) => `keyrequest:${requestId}`;

export const projectLeftKey = (projectId: string) => `project:${projectId}:left`;

export const upgradeOfferedKey = (projectId: string) => `project:${projectId}:upgrade-offered`;

export const inflightCreditsKey = (userId: string) => `credits:inflight:${userId}`;
