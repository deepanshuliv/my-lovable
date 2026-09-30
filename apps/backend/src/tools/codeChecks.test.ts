import { describe, expect, test } from 'bun:test';
import { cssImportWarning, easeArrayWarning, fileSizeNote, lucideImports, lucideWarning, missingImportWarning, strayCdPrefix } from './codeChecks';

const YOGA_PAGE = `'use client';
import { ArrowRight, CalendarDays, CheckCircle, Instagram, Mail, MapPin } from 'lucide-react';

export default function YogaPage() {
  const [slot, setSlot] = useState<string | null>(null);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <AnimatePresence>{slot && <p className={cn('a', 'b')}>{slot}</p>}</AnimatePresence>
    </motion.div>
  );
}
`;

describe('missing imports', () => {
  test('flags hooks, motion and cn used without an import (the yoga page)', () => {
    const warning = missingImportWarning('app/page.tsx', YOGA_PAGE);
    expect(warning).toContain('useState');
    expect(warning).toContain('motion');
    expect(warning).toContain('AnimatePresence');
    expect(warning).toContain('cn');
    expect(warning).toContain("from 'motion/react'");
  });

  test('stays quiet when everything is imported', () => {
    const ok = `'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
export default function P() { const [a] = useState(0); return <AnimatePresence><motion.div className={cn('x')}>{a}</motion.div></AnimatePresence>; }`;
    expect(missingImportWarning('app/page.tsx', ok)).toBeNull();
  });

  test('React.useState, local definitions and renamed imports are not false alarms', () => {
    const ok = `import React from 'react';
import { motion as m } from 'motion/react';
function cn(...c: string[]) { return c.join(' '); }
const motion = m;
export function A() { const [x] = React.useState(0); return <motion.div className={cn('a')}>{x}</motion.div>; }`;
    expect(missingImportWarning('components/A.tsx', ok)).toBeNull();
  });

  test('words in strings and comments do not count as usage', () => {
    expect(missingImportWarning('app/page.tsx', `// call useState( here\nconst tip = "use motion.div and cn(";\nexport default function P() { return <p>{tip}</p>; }`)).toBeNull();
  });

  test('non-code files are ignored', () => {
    expect(missingImportWarning('README.md', 'useState(')).toBeNull();
  });
});

describe('lucide icons that do not exist in lucide-react 1.x', () => {
  const installed = new Set(['ArrowRight', 'CalendarDays', 'CircleCheck', 'Mail', 'MapPin', 'Camera']);
  const exists = (name: string) => installed.has(name);

  test('brand icons and renamed icons from the yoga page are flagged with replacements', () => {
    const warning = lucideWarning('app/page.tsx', YOGA_PAGE, exists);
    expect(warning).toContain('Instagram');
    expect(warning).toContain('CheckCircle');
    expect(warning).toContain('CircleCheck');
    expect(warning).not.toContain('MapPin,');
    expect(warning).toMatch(/inline <svg>/);
  });

  test('aliased and multi-line imports are parsed', () => {
    const source = `import {\n  Github as GH,\n  Twitter,\n  Mail,\n} from "lucide-react";`;
    const warning = lucideWarning('components/Footer.tsx', source, exists);
    expect(warning).toContain('Github');
    expect(warning).toContain('Twitter');
  });

  test('ordinary icons pass', () => {
    expect(lucideWarning('app/page.tsx', `import { MapPin, Mail, Camera } from 'lucide-react';`, exists)).toBeNull();
  });

  test('without the installed list, known brand icons are still caught', () => {
    expect(lucideWarning('app/page.tsx', `import { Instagram, Mail } from 'lucide-react';`)).toContain('Instagram');
    expect(lucideWarning('app/page.tsx', `import { Mail } from 'lucide-react';`)).toBeNull();
  });

  test('an earlier import block is never read as lucide icons (Hero.tsx from the eval)', () => {
    const hero = `'use client';\n\nimport { motion, useReducedMotion } from 'motion/react';\nimport { ArrowRight } from 'lucide-react';`;
    expect(lucideImports(hero)).toEqual(['ArrowRight']);
    expect(lucideWarning('components/Hero.tsx', hero, exists)).toBeNull();
  });

  test('lucideImports lists imported names for the sandbox lookup', () => {
    expect(lucideImports(`import { A, B as C } from 'lucide-react';\nimport { D } from 'react';`)).toEqual(['A', 'B']);
  });
});

describe('oversized files', () => {
  test('a 520-line page gets a split note', () => {
    expect(fileSizeNote('app/page.tsx', 'x\n'.repeat(520))).toMatch(/520 lines/);
  });

  test('normal files do not', () => {
    expect(fileSizeNote('app/page.tsx', 'x\n'.repeat(200))).toBeNull();
  });
});

describe('cd into a guessed project path', () => {
  test('a leading cd to another absolute path is stripped', () => {
    expect(strayCdPrefix('cd /workspace && npm run typecheck 2>&1', '/home/daytona/app')).toEqual({ command: 'npm run typecheck 2>&1', skipped: '/workspace' });
    expect(strayCdPrefix('cd ~/project; npm run typecheck', '/home/daytona/app')).toEqual({ command: 'npm run typecheck', skipped: '~/project' });
  });

  test('cd into the real root or a subfolder is left alone', () => {
    expect(strayCdPrefix('cd /home/daytona/app && ls', '/home/daytona/app')).toBeNull();
    expect(strayCdPrefix('cd app/api && ls', '/home/daytona/app')).toBeNull();
    expect(strayCdPrefix('npm run typecheck', '/home/daytona/app')).toBeNull();
  });
});

describe('motion ease arrays widened to number[]', () => {
  test('an untyped variants object with an ease array is flagged (the eval yoga page)', () => {
    const page = `const item = {\n  hidden: { opacity: 0, y: 20 },\n  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },\n};`;
    expect(easeArrayWarning('app/page.tsx', page)).toMatch(/as const/);
  });

  test('typed variants, as const and inline props are fine', () => {
    expect(easeArrayWarning('app/page.tsx', `const item: Variants = { show: { transition: { ease: [0.16, 1, 0.3, 1] } } };`)).toBeNull();
    expect(easeArrayWarning('app/page.tsx', `const item = { show: { transition: { ease: [0.16, 1, 0.3, 1] as const } } };`)).toBeNull();
    expect(easeArrayWarning('app/page.tsx', `const x = { a: 1 };\nexport default function P() { return <motion.div transition={{ ease: [0.16, 1, 0.3, 1] }} />; }`)).toBeNull();
  });
});

describe('cssImportWarning', () => {
  const base = `@import 'tailwindcss';\n@source not '../.agents';\n\n@theme {\n  --font-sans: var(--font-display), ui-sans-serif;\n}\n`;

  test('the template header and next/font tokens are fine', () => {
    expect(cssImportWarning('app/globals.css', base)).toBeNull();
    expect(cssImportWarning('app/globals.css', `@import "tailwindcss";\n@source "../components";\n`)).toBeNull();
  });

  test('flags a font url passed to @source', () => {
    const css = `${base}\n@source url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');\n`;
    expect(cssImportWarning('app/globals.css', css)).toMatch(/next\/font\/google/);
  });

  test('flags remote css imports', () => {
    expect(cssImportWarning('app/globals.css', `@import url('https://fonts.googleapis.com/css2?family=Manrope');\n${base}`)).toMatch(/remote CSS imports/);
    expect(cssImportWarning('app/globals.css', `${base}@import "https://example.com/x.css";`)).toMatch(/WARNING/);
  });

  test('ignores non-css files', () => {
    expect(cssImportWarning('app/page.tsx', `const s = "@source url('x')";`)).toBeNull();
  });
});
