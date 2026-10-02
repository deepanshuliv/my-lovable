import { randomUUIDv7 } from 'bun';
import { envBool, envInt, envOr } from '@repo/shared';

export const BACKEND_ID = process.env.BACKEND_ID || `backend-${randomUUIDv7()}`;

export const PORT = envInt('PORT', 8000);

export const PREVIEW_PORT = envInt('PREVIEW_PORT', 3000);

export const PUBLIC_PREVIEW = envBool('SANDBOX_PUBLIC_PREVIEW', true);

export const SANDBOX_IMAGE = envOr('SANDBOX_IMAGE', 'node:22-bookworm');
export const SANDBOX_CPU = envInt('SANDBOX_CPU', 2);
export const SANDBOX_MEMORY_GIB = envInt('SANDBOX_MEMORY_GIB', 4);
export const SANDBOX_DISK_GIB = envInt('SANDBOX_DISK_GIB', 4);
export const SANDBOX_AUTO_STOP_MINUTES = envInt('SANDBOX_AUTO_STOP_MINUTES', 15);
export const SANDBOX_AUTO_DELETE_MINUTES = envInt('SANDBOX_AUTO_DELETE_MINUTES', -1);
export const SANDBOX_AUTO_ARCHIVE_MINUTES = envInt('SANDBOX_AUTO_ARCHIVE_MINUTES', 30);
export const SANDBOX_LEAVE_GRACE_SECONDS = envInt('SANDBOX_LEAVE_GRACE_SECONDS', 90);

export const PROJECT_DIR = envOr('PROJECT_DIR', 'app');

export const TEMPLATE_NAME = envOr('TEMPLATE_NAME', 'nextjs-fullstack');

export const TEMPLATE_SOURCE = envOr('TEMPLATE_SOURCE', 'builtin') as
  | 'builtin'
  | 'git'
  | 'snapshot';
export const TEMPLATE_GIT_URL = process.env.TEMPLATE_GIT_URL;
export const TEMPLATE_GIT_REF = envOr('TEMPLATE_GIT_REF', 'main');
export const TEMPLATE_SNAPSHOT = process.env.TEMPLATE_SNAPSHOT;

export const STRICT_OWNERSHIP = envBool('STRICT_OWNERSHIP', false);

export const QUESTION_TIMEOUT_MS = envInt('QUESTION_TIMEOUT_MS', 10 * 60 * 1000);

export const COMMAND_TIMEOUT_SECONDS = envInt('COMMAND_TIMEOUT_SECONDS', 300);

export const MAX_AGENT_TURNS = envInt('MAX_AGENT_TURNS', 30);

export const DEV_LOG_PATH = envOr('DEV_LOG_PATH', '/tmp/dev-server.log');

export const DEV_LOG_TAIL_LINES = envInt('DEV_LOG_TAIL_LINES', 60);

export const VERIFY_AFTER_TURN = envBool('VERIFY_AFTER_TURN', true);

export const VERIFY_REPAIR_ROUNDS = Math.max(0, envInt('VERIFY_REPAIR_ROUNDS', 2));

export const AGENT_GUARDS = envBool('AGENT_GUARDS', true);

export const AGENT_MAX_TURN_COST_MICROS = Math.round(Number(process.env.AGENT_MAX_TURN_COST_USD || '1') * 1_000_000);

export const AGENT_REVIEW_ROUND = envBool('AGENT_REVIEW_ROUND', true);

export const REVIEW_MAX_TURNS = Math.max(1, envInt('REVIEW_MAX_TURNS', 12));

export const REPAIR_MAX_TURNS = Math.max(1, envInt('REPAIR_MAX_TURNS', 10));

export const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

export const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY || undefined;

export const CLERK_AUTHORIZED_PARTIES = (process.env.CLERK_AUTHORIZED_PARTIES || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const NAMING_MODEL_OPENROUTER = envOr(
  'NAMING_MODEL_OPENROUTER',
  'deepseek/deepseek-v4-flash',
);
export const NAMING_MODEL_GEMINI = envOr('NAMING_MODEL_GEMINI', 'gemini-2.0-flash-lite');

export const MAX_TITLE_LENGTH = envInt('MAX_TITLE_LENGTH', 60);

export const HISTORY_PAGE_SIZE = envInt('HISTORY_PAGE_SIZE', 100);

export const HISTORY_LIMIT = envInt('HISTORY_LIMIT', 40);

export const SNAPSHOT_EVERY_N_EVENTS = Math.max(1, envInt('SNAPSHOT_EVERY_N_EVENTS', 1));
