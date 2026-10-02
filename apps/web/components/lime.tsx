'use client';

import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import ProjectArt, { sitePhoto } from './ProjectArt';

export const EASE = [0.16, 1, 0.3, 1] as const;

export function LogoMark({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect x="1" y="1" width="38" height="38" rx="10" fill="#1c1d1a" stroke="#fafafa" strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x="16" y="18" width="8" height="15" rx="3" fill="var(--lime)" />
      <path
        d="M20 3.5c.9 4.4 2.2 5.7 6.6 6.6-4.4.9-5.7 2.2-6.6 6.6-.9-4.4-2.2-5.7-6.6-6.6 4.4-.9 5.7-2.2 6.6-6.6z"
        fill="var(--lime)"
        className="origin-[20px_10px] transition-transform duration-500 group-hover:rotate-90"
      />
    </svg>
  );
}

export function Logo({ href = '/', size = 'md', invert = false, compact = false }: { href?: string; size?: 'md' | 'lg'; invert?: boolean; compact?: boolean }) {
  const lg = size === 'lg';
  return (
    <Link href={href} aria-label="Inkling home" className="group flex shrink-0 items-center gap-2">
      <span className="rounded-[11px] shadow-[2px_2px_0_var(--edge)]">
        <LogoMark size={lg ? 44 : 32} />
      </span>
      {!compact && (
        <span className={`font-black tracking-[-0.045em] ${lg ? 'text-[38px]' : 'text-[23px]'} ${invert ? 'text-white' : 'text-[var(--text)]'}`}>
          inkling
        </span>
      )}
    </Link>
  );
}

export function LimeButton({
  children,
  onClick,
  href,
  dark = false,
  disabled,
  size = 'md',
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  dark?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  className?: string;
}) {
  const classes = `group inline-flex shrink-0 items-center gap-3 whitespace-nowrap rounded-[10px] border-2 border-[var(--edge)] font-bold uppercase tracking-[0.02em] shadow-[var(--hard)] transition-[transform,box-shadow,opacity] duration-150 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_var(--edge)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:pointer-events-none disabled:opacity-50 ${
    size === 'sm' ? 'py-1 pl-3.5 pr-1 text-[12px]' : 'py-2 pl-5 pr-2 text-[13px]'
  } ${dark ? 'bg-[var(--ink)] text-white' : 'bg-[var(--lime)] text-[var(--ink)]'} ${className}`;
  const inner = (
    <>
      {children}
      <span
        className={`flex items-center justify-center rounded-[7px] transition-transform duration-200 group-hover:translate-x-0.5 ${
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
        } ${dark ? 'bg-[var(--lime)] text-[var(--ink)]' : 'bg-[var(--ink)] text-[var(--lime)]'}`}
      >
        <ArrowRight size={size === 'sm' ? 13 : 15} weight="bold" />
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes}>
      {inner}
    </button>
  );
}

export function Note({
  children,
  className = '',
  arrow = 'up-right',
}: {
  children: ReactNode;
  className?: string;
  arrow?: 'up-right' | 'down-left' | 'none';
}) {
  return (
    <div className={`pointer-events-none absolute flex items-center gap-1 text-[var(--text)] ${className}`} aria-hidden="true">
      <span className="font-scrawl block max-w-[160px] rotate-[-8deg] text-center text-[17px] leading-[1.05]">{children}</span>
      {arrow !== 'none' && (
        <svg width="64" height="54" viewBox="0 0 64 54" fill="none" className={arrow === 'down-left' ? 'rotate-[200deg]' : '-mt-10'}>
          <path d="M4 50 C 18 30, 34 14, 58 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M46 4 L 58 6 L 52 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

export function Bubble({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`absolute z-10 inline-block rounded-full bg-[var(--lime)] px-3.5 py-1.5 text-[13px] font-bold text-[var(--ink)] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.6)] ${className}`}
    >
      {children}
      <span className="absolute -bottom-1.5 left-5 h-3 w-3 rotate-45 bg-[var(--lime)]" />
    </span>
  );
}

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setSeen(true);
    }, { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

function developFilter(p: number): string {
  const k = Math.max(0, Math.min(1, p));
  if (k >= 1) return 'none';
  return `brightness(${1 + 0.9 * (1 - k)}) contrast(${0.35 + 0.65 * k}) saturate(${k}) blur(${(1 - k) * 4}px)`;
}

export function Polaroid({
  name,
  caption,
  progress,
  delay = 0,
  shadow = 'var(--edge)',
  photo = true,
  className = '',
}: {
  photo?: boolean;
  name: string;
  caption?: ReactNode;
  progress?: number;
  delay?: number;
  shadow?: string;
  className?: string;
}) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const controlled = typeof progress === 'number';

  return (
    <div
      ref={ref}
      className={`rounded-[14px] border border-[#d9d9d4] bg-white p-2.5 pb-0 ${className}`}
      style={{ boxShadow: `7px 7px 0 ${shadow}` }}
    >
      <div className={`relative overflow-hidden rounded-[8px] ${!controlled && seen ? 'develop-sheen' : ''}`} style={{ animationDelay: `${delay}s` }}>
        <div
          className={!controlled && seen ? 'develop' : ''}
          style={
            controlled
              ? { filter: developFilter(progress!), transition: 'filter 900ms var(--ease-out)' }
              : seen
                ? { animationDelay: `${delay}s` }
                : { filter: developFilter(0) }
          }
        >
          {photo ? (
            <img src={sitePhoto(name)} alt={`${name} website`} loading="lazy" className="block aspect-[16/11] w-full object-cover object-top" />
          ) : (
            <ProjectArt name={name} className="aspect-[5/4] [&>span]:hidden" />
          )}
        </div>
      </div>
      <p className="font-scrawl px-1 py-2 text-[17px] leading-none text-[#1c1d1a]">{caption ?? name}</p>
    </div>
  );
}
