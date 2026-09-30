const CODE_FILE = /\.(tsx|ts|jsx|js)$/;
const MAX_FILE_LINES = 350;

const SOURCES: Record<string, string> = {
  useState: 'react',
  useEffect: 'react',
  useRef: 'react',
  useMemo: 'react',
  useCallback: 'react',
  useReducer: 'react',
  useContext: 'react',
  useLayoutEffect: 'react',
  useTransition: 'react',
  useId: 'react',
  useOptimistic: 'react',
  useActionState: 'react',
  motion: 'motion/react',
  AnimatePresence: 'motion/react',
  useReducedMotion: 'motion/react',
  useInView: 'motion/react',
  useScroll: 'motion/react',
  useTransform: 'motion/react',
  useSpring: 'motion/react',
  useMotionValue: 'motion/react',
  cn: '@/lib/utils',
};

const BRAND_ICONS = new Set([
  'Instagram', 'Facebook', 'Twitter', 'Github', 'Gitlab', 'Linkedin', 'Youtube', 'Twitch', 'Dribbble',
  'Figma', 'Framer', 'Slack', 'Codepen', 'Codesandbox', 'Chrome', 'Chromium', 'Pocket', 'Trello',
]);

const RENAMED_ICONS: Record<string, string> = {
  CheckCircle: 'CircleCheck',
  CheckCircle2: 'CircleCheckBig',
  XCircle: 'CircleX',
  AlertCircle: 'CircleAlert',
  AlertTriangle: 'TriangleAlert',
  HelpCircle: 'CircleHelp',
  PlayCircle: 'CirclePlay',
  PlusCircle: 'CirclePlus',
  MinusCircle: 'CircleMinus',
  ArrowRightCircle: 'CircleArrowRight',
  Edit: 'SquarePen',
  Edit2: 'Pen',
  Edit3: 'PenLine',
  Home: 'House',
  Loader2: 'LoaderCircle',
  MoreHorizontal: 'Ellipsis',
  MoreVertical: 'EllipsisVertical',
  Sliders: 'SlidersVertical',
  Unlock: 'LockOpen',
  BarChart: 'ChartNoAxesColumnIncreasing',
  BarChart3: 'ChartColumn',
  LineChart: 'ChartLine',
  PieChart: 'ChartPie',
};

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function declaredNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = match[1]!;
    const named = /\{([\s\S]*?)\}/.exec(clause);
    if (named) {
      for (const part of named[1]!.split(',')) {
        const local = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
        if (local) names.add(local);
      }
    }
    const rest = clause.replace(/\{[\s\S]*?\}/, '').replace(/^type\s+/, '');
    for (const part of rest.split(',')) {
      const name = part.trim().replace(/^\*\s+as\s+/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]!);
  return names;
}

function usagePattern(name: string): RegExp {
  if (name === 'motion') return /<motion\.|(?<![\w.$])motion\s*[.(]/;
  if (name === 'AnimatePresence') return /<AnimatePresence[\s>/]/;
  return new RegExp(`(?<![\\w.$])${name}\\s*[(<]`);
}

export function missingImportWarning(path: string, content: string): string | null {
  if (!CODE_FILE.test(path)) return null;
  const code = stripCommentsAndStrings(content);
  const declared = declaredNames(content);
  const missing = Object.keys(SOURCES).filter((name) => !declared.has(name) && usagePattern(name).test(code));
  if (missing.length === 0) return null;
  const bySource = new Map<string, string[]>();
  for (const name of missing) bySource.set(SOURCES[name]!, [...(bySource.get(SOURCES[name]!) ?? []), name]);
  const lines = [...bySource].map(([source, names]) => `import { ${names.join(', ')} } from '${source}';`);
  return `WARNING: ${path} uses ${missing.join(', ')} without importing ${missing.length === 1 ? 'it' : 'them'}, so it will not compile. Add:\n${lines.join('\n')}`;
}

export function lucideImports(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/import\s*\{([^{}]*)\}\s*from\s*['"]lucide-react['"]/g)) {
    for (const part of match[1]!.split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name && /^[A-Za-z][\w]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

function baseIconName(name: string): string {
  return name.replace(/^Lucide/, '').replace(/Icon$/, '');
}

export function lucideWarning(path: string, content: string, exists?: (name: string) => boolean): string | null {
  if (!CODE_FILE.test(path)) return null;
  const missing = lucideImports(content).filter((name) => (exists ? !exists(name) : BRAND_ICONS.has(baseIconName(name))));
  if (missing.length === 0) return null;
  const advice = missing.map((name) => {
    const base = baseIconName(name);
    if (BRAND_ICONS.has(base)) return `${name}: brand logos were removed from lucide-react; draw it as a small inline <svg> or use a neutral icon such as AtSign, Globe or Share2`;
    if (RENAMED_ICONS[base]) return `${name}: renamed to ${RENAMED_ICONS[base]}`;
    return `${name}: not exported; lucide 1.x uses shape-first names (CheckCircle is now CircleCheck), so pick an existing icon`;
  });
  return `WARNING: ${path} imports icons that do not exist in the installed lucide-react, so the page will crash:\n- ${advice.join('\n- ')}`;
}

export function fileSizeNote(path: string, content: string): string | null {
  if (!CODE_FILE.test(path)) return null;
  const lines = content.replace(/\n$/, '').split('\n').length;
  if (lines <= MAX_FILE_LINES) return null;
  return `NOTE: ${path} is ${lines} lines. Files over ${MAX_FILE_LINES} lines are slow and error-prone to repair; next time split sections into components/ files.`;
}

export function strayCdPrefix(command: string, rootDir: string): { command: string; skipped: string } | null {
  const match = /^\s*cd\s+(['"]?)([^\s'";&|]+)\1\s*(?:&&|;)\s*/.exec(command);
  if (!match) return null;
  const target = match[2]!;
  if (!/^(\/|~)/.test(target)) return null;
  const root = rootDir.replace(/\/$/, '');
  if (target.replace(/\/$/, '') === root || target.startsWith(`${root}/`)) return null;
  return { command: command.slice(match[0].length), skipped: target };
}

export function easeArrayWarning(path: string, content: string): string | null {
  if (!CODE_FILE.test(path)) return null;
  if (!/const\s+\w+\s*=\s*\{[^;]*?\bease\s*:\s*\[[^\]]*\](?!\s*as\s+const)/.test(content)) return null;
  return `WARNING: ${path} declares a motion variants/transition object with an ease array but no type, so TypeScript widens it to number[] and motion rejects it. Write \`ease: [0.16, 1, 0.3, 1] as const\` or type the object: \`const item: Variants = {...}\` (import type { Variants } from 'motion/react').`;
}

export function cssImportWarning(path: string, content: string): string | null {
  if (!/\.css$/.test(path)) return null;
  const css = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const badSource = /@source\s+(?:not\s+(?!['"])|(?!not\s)(?!['"]))[^;]*;?/.exec(css);
  const remoteImport = /@import\s+(?:url\(\s*)?['"]?https?:\/\/[^;]*;?/.exec(css);
  if (!badSource && !remoteImport) return null;
  const line = (badSource ?? remoteImport)![0].trim();
  return `WARNING: ${path} contains \`${line.slice(0, 120)}\`, which breaks or slows the stylesheet. \`@source\` only takes a quoted local path (the template's \`@source not '../.agents';\` is correct, keep it), and remote CSS imports are not allowed. Delete that line. Load fonts only with next/font/google in app/layout.tsx: \`const display = Manrope({ subsets: ['latin'], variable: '--font-display' })\`, put \`display.variable\` on <html>, then map it in globals.css with \`@theme { --font-sans: var(--font-display), ui-sans-serif, system-ui, sans-serif; }\`.`;
}
