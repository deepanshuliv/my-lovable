const CAPACITY =
  'Our build servers are busy right now. Please wait a minute and try again. Your project and messages are safe.';
const WORKSPACE = 'We could not start your project right now. Please try again in a moment. Your project is safe.';
const CONNECTION = 'We lost connection to one of our services. Please try again in a moment.';
const AI_LIMIT =
  'The AI service has reached its usage limit, so the build stopped. Your project is saved. Please try again later, or add your own AI key in settings to keep building.';

const RULES: [RegExp, string][] = [
  [
    /total (memory|cpu|disk|storage) limit exceeded|dashboard\/limits|upgrade your organization'?s tier|daytona[\s\S]*(quota|limit exceeded|insufficient resources|no available runners)|no available runners/i,
    CAPACITY,
  ],
  [/key limit exceeded|workspaces\/[^\s"]*\/keys\//i, AI_LIMIT],
  [/daytona/i, WORKSPACE],
  [/\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|socket hang up|^fetch failed$/i, CONNECTION],
];

export function friendlyError(message: string): string {
  for (const [pattern, replacement] of RULES) {
    if (pattern.test(message)) return replacement;
  }
  return message;
}

export function sanitizeErrorPayload(
  projectId: string,
  type: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (type !== 'error' || typeof payload.message !== 'string') return payload;
  const message = friendlyError(payload.message);
  if (message === payload.message) return payload;
  console.log('[USER_ERROR_HIDDEN] , ', projectId, payload.message.slice(0, 300));
  return { ...payload, message };
}
