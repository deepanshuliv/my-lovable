import { envInt, envOr } from '@repo/shared';
import {
  formatFileOperations,
  SUMMARIZATION_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  UPDATE_SUMMARIZATION_PROMPT,
} from './prompts';

export * from './prompts';

const COMPACT_AT = Number(envOr('COMPACT_AT_FRACTION', '0.8'));

const KEEP_RECENT_TOKENS = envInt('KEEP_RECENT_TOKENS', 20_000);

const SUMMARY_MAX_TOKENS = envInt('SUMMARY_MAX_TOKENS', 2_000);

const TOOL_RESULT_MAX_CHARS = 2_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type ConversationPart = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
};

function serializeConversation(parts: ConversationPart[]): string {
  const out: string[] = [];

  for (const part of parts) {
    if (part.role === 'tool') {
      const content =
        part.content.length > TOOL_RESULT_MAX_CHARS
          ? `${part.content.slice(0, TOOL_RESULT_MAX_CHARS)}\n[... truncated]`
          : part.content;
      out.push(`[Tool result]: ${content}`);
    } else if (part.role === 'assistant') {
      out.push(`[Assistant]: ${part.content}`);
    } else {
      out.push(`[User]: ${part.content}`);
    }
  }

  return out.join('\n\n');
}

export type FileOps = { read: Set<string>; modified: Set<string> };

export function createFileOps(): FileOps {
  return { read: new Set(), modified: new Set() };
}

const READ_PATTERNS = [/\bcat\s+([^\s|;&><]+)/g, /\bhead\s+(?:-\S+\s+)*([^\s|;&><]+)/g, /\btail\s+(?:-\S+\s+)*([^\s|;&><]+)/g];
const WRITE_PATTERNS = [/>\s*([^\s|;&><]+)/g, /\btee\s+([^\s|;&><]+)/g];

export function trackFileOps(ops: FileOps, command: string) {
  for (const pattern of READ_PATTERNS) {
    for (const match of command.matchAll(pattern)) {
      const path = match[1];
      if (path && !path.startsWith('-') && path.includes('.')) ops.read.add(path);
    }
  }
  for (const pattern of WRITE_PATTERNS) {
    for (const match of command.matchAll(pattern)) {
      const path = match[1];
      if (path && path !== '/dev/null' && path.includes('.')) ops.modified.add(path);
    }
  }
}

export interface Summarizer {
  complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
}

export type CompactionResult = {
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
};

export async function summarize(
  summarizer: Summarizer,
  parts: ConversationPart[],
  fileOps: FileOps,
  previousSummary?: string,
): Promise<string> {
  const conversation = serializeConversation(parts);

  const userPrompt = previousSummary
    ? `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${conversation}\n\n${UPDATE_SUMMARIZATION_PROMPT}`
    : `${conversation}\n\n${SUMMARIZATION_PROMPT}`;

  try {
    const summary = (await summarizer.complete(
      SUMMARIZATION_SYSTEM_PROMPT,
      userPrompt,
      SUMMARY_MAX_TOKENS,
    )).trim();
    if (summary.length > 0) return summary + formatFileOperations([...fileOps.read], [...fileOps.modified]);
  } catch (error) {
    // Compaction is a continuity optimisation. A provider outage must not erase the
    // in-memory history or prevent the provider from attempting a deterministic rebuild.
    console.log('[COMPACTION_PROVIDER_FAILED] , ', String(error).slice(0, 240));
  }

  const fallback = [
    previousSummary ? `<previous-summary>\n${previousSummary.slice(-8_000)}\n</previous-summary>` : '',
    '## Durable fallback checkpoint',
    parts.slice(-24).map((part) => `[${part.role}] ${part.content.slice(-900)}`).join('\n'),
    'Preserve the current objective and continue from the latest observable tool result.',
  ].filter(Boolean).join('\n');
  return fallback.slice(0, 12_000) + formatFileOperations([...fileOps.read], [...fileOps.modified]);
}

export function findCutPoint(parts: ConversationPart[], keepTokens = KEEP_RECENT_TOKENS): number {
  let accumulated = 0;

  for (let i = parts.length - 1; i >= 0; i--) {
    accumulated += estimateTokens(parts[i]!.content);
    if (accumulated >= keepTokens) {
      
      return Math.min(i + 1, parts.length - 1);
    }
  }

  return 0;
}

export function isOverThreshold(usedTokens: number, contextWindow: number): boolean {
  return usedTokens >= contextWindow * COMPACT_AT;
}
