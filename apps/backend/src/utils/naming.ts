import { MAX_TITLE_LENGTH } from '../config';
import { getNamingProvider, type ProviderOverride } from '../providers';

const LEADING = /^(please\s+)?(can you\s+|could you\s+|i want( you)? to\s+|i need\s+|help me\s+)?(create|build|make|design|generate|develop|code|write|set up|setup)?\s*(me\s+)?(a|an|the|my|some)?\s+/i;
const CUT = /\s+(with|that|which|where|so|using|including|featuring|to|and|in|on|like|my|our|your|can|will)\s+.*$/i;
const SMALL = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'my', 'our']);

function titleCase(words: string[]): string {
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL.has(lower)) return lower;
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return lower
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('-');
    })
    .join(' ');
}

export function fallbackTitle(prompt: string): string | null {
  let text = prompt.replace(/[\n\r]+/g, ' ').replace(/["'`.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  text = text.split(/[,;:]/)[0] ?? text;
  text = text.replace(LEADING, '').trim();

  const purpose = text.match(/^(.+?)\s+for\s+(?:my|our|a|an|the)?\s*(.+)$/i);
  let words: string[];
  if (purpose?.[1] && purpose[2]) {
    const what = purpose[1].replace(CUT, '').trim();
    const forWhom = purpose[2].replace(CUT, '').trim().replace(/^(my|our|a|an|the)\s+/i, '');
    words = [...forWhom.split(' ').slice(0, 3), ...what.split(' ').slice(0, 3)];
  } else {
    words = text.replace(CUT, '').split(' ').filter((word) => !/^(my|our|a|an|the)$/i.test(word)).slice(0, 5);
  }

  const result = titleCase(words.filter(Boolean)).slice(0, MAX_TITLE_LENGTH).trim();
  return result.length >= 3 ? result : null;
}

export function deriveTitle(prompt: string): string {
  const cleaned = prompt.split(' ').filter(Boolean).join(' ');
  if (!cleaned) return 'Untitled';
  const short = fallbackTitle(cleaned);
  if (short) return short;
  if (cleaned.length <= MAX_TITLE_LENGTH) return cleaned;

  const clipped = cleaned.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${lastSpace > MAX_TITLE_LENGTH * 0.6 ? clipped.slice(0, lastSpace) : clipped}…`;
}

const SYSTEM = [
  'You name software projects so people can find them again in a list.',
  'Given the first thing a user asked for, reply with a short, specific title that says what is being built and for whom.',
  'Rules: 2 to 5 words. Title Case. Lead with the subject, end with the kind of app.',
  'Drop filler like "a", "my", "create", "build", "app for".',
  'Examples: "a landing page for my media house" -> Media House Landing Page;',
  '"build me a todo app with dark mode" -> Todo List;',
  '"a recipe box my family can add to" -> Family Recipe Box;',
  '"booking site for my yoga classes" -> Yoga Class Booking.',
  'Reply with the title and nothing else.',
].join(' ');

function cleanTitle(raw: string): string | null {
  const firstLine = raw.split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine) return null;

  let stripped = firstLine.trim();
  const lower = stripped.toLowerCase();

  if (lower.startsWith('title:') || lower.startsWith('project:') || lower.startsWith('name:')) {
    stripped = stripped.slice(stripped.indexOf(':') + 1).trim();
  } else if (lower.startsWith('title-') || lower.startsWith('project-') || lower.startsWith('name-')) {
    stripped = stripped.slice(stripped.indexOf('-') + 1).trim();
  } else if (lower.startsWith('title—') || lower.startsWith('project—') || lower.startsWith('name—')) {
    stripped = stripped.slice(stripped.indexOf('—') + 1).trim();
  } else if (lower.startsWith('title ') || lower.startsWith('project ') || lower.startsWith('name ')) {
    stripped = stripped.slice(stripped.indexOf(' ') + 1).trim();
  }

  while (stripped.length > 0 && ['"', "'", '`', '*', ' '].includes(stripped.charAt(0))) {
    stripped = stripped.slice(1);
  }
  while (stripped.length > 0 && ['"', "'", '`', '*', ' ', '.'].includes(stripped.charAt(stripped.length - 1))) {
    stripped = stripped.slice(0, -1);
  }

  if (!stripped) return null;

  if (stripped.length > MAX_TITLE_LENGTH) return null;
  if (stripped.split(' ').filter(Boolean).length > 8) return null;

  return stripped;
}

export async function generateProjectTitle(
  prompt: string,
  override?: ProviderOverride,
): Promise<string | null> {
  const cleaned = prompt.split(' ').filter(Boolean).join(' ');
  if (!cleaned) return null;

  try {
    const provider = getNamingProvider(override);

    const raw = await provider.complete(SYSTEM, cleaned.slice(0, 500), 32);
    return cleanTitle(raw);
  } catch (error) {
    console.log('[TITLE_FAILED] , ', String((error as Error).message).slice(0, 200));
    return null;
  }
}

export function looksLikePrompt(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (/^(a|an|create|build|make|design|generate|i want|i need|please|can you)\b/i.test(trimmed)) return true;
  return /^[a-z]/.test(trimmed) && trimmed.split(/\s+/).length >= 2;
}
