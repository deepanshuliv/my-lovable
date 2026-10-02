'use client';

import { CircleHalf } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { THEME_KEY } from '@/lib/theme';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] text-[var(--text)] shadow-[var(--hard-sm)] transition-[transform,box-shadow] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_var(--edge)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none ${className}`}
    >
      <CircleHalf size={17} weight="fill" className={`transition-transform duration-500 ${theme === 'dark' ? 'rotate-180' : ''}`} />
    </button>
  );
}
