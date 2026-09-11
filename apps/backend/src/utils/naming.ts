import { MAX_TITLE_LENGTH } from '../config';
import { getNamingProvider, type ProviderOverride } from '../providers';

export function deriveTitle(prompt: string): string {
  const cleaned = prompt.split(' ').filter(Boolean).join(' ');
  if (!cleaned) return 'Untitled';
  if (cleaned.length <= MAX_TITLE_LENGTH) return cleaned;

  const clipped = cleaned.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${lastSpace > MAX_TITLE_LENGTH * 0.6 ? clipped.slice(0, lastSpace) : clipped}…`;
}

const SYSTEM = [
  'You name software projects.',
  'Given the first thing a user asked for, reply with a short title for it.',
  'Rules: 2 to 5 words. Title Case. No quotes, no punctuation at the end, no explanation.',
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

    const raw = await provider.complete(SYSTEM, cleaned.slice(0, 500), 24);
    return cleanTitle(raw);
  } catch (error) {
    
    console.log('[TITLE_FAILED] , ', String((error as Error).message).slice(0, 200));
    return null;
  }
}
