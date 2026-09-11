
export const lockKey = (projectId: string) => `lock:project:${projectId}`;

export const ownerKey = (projectId: string) => `project:${projectId}:owner`;

export const liveKey = (projectId: string) => `project:${projectId}:live`;

export const seqKey = (projectId: string) => `project:${projectId}:seq`;

export const answerChannel = (questionId: string) => `answer:${questionId}`;

export const sessionKey = (projectId: string) => `session:${projectId}:history`;

export const previewKey = (projectId: string) => `project:${projectId}:preview`;

export const questionOwnerKey = (questionId: string) => `question:${questionId}:project`;
