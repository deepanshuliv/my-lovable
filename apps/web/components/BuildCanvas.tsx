'use client';

import { Check } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

type State = 'done' | 'active' | 'todo';

const BLOCKS = ['nav', 'headline', 'image', 'cards', 'checked', 'footer'] as const;

function stateOf(index: number, progress: number): State {
  const at = progress * BLOCKS.length;
  if (at >= index + 1) return 'done';
  if (at >= index) return 'active';
  return 'todo';
}

function Block({ state, label, className = '', children }: { state: State; label?: string; className?: string; children?: ReactNode }) {
  return (
    <div
      className={`relative overflow-hidden rounded-[10px] transition-[background-color,border-color,opacity,transform] duration-700 ${
        state === 'done'
          ? 'border-2 border-[var(--edge)] bg-[var(--panel)] opacity-100'
          : state === 'active'
            ? 'border-2 border-dashed border-[var(--edge)] bg-white/70 opacity-100'
            : 'border-2 border-dashed border-[var(--line-strong)] bg-transparent opacity-60'
      } ${className}`}
    >
      {state !== 'todo' && <div className={`h-full transition-opacity duration-700 ${state === 'done' ? 'opacity-100' : 'opacity-40'}`}>{children}</div>}
      {state === 'active' && (
        <>
          <div className="build-shimmer pointer-events-none absolute inset-0" />
          {label && (
            <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-[6px] bg-[var(--ink)] px-2 py-1 text-[10.5px] font-bold uppercase text-[var(--lime)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--lime)]" />
              {label}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function Line({ w, strong = false }: { w: string; strong?: boolean }) {
  return <span className={`block h-2.5 rounded-full ${strong ? 'bg-[var(--ink)]' : 'bg-[var(--soft-3)]'}`} style={{ width: w }} />;
}

export default function BuildCanvas({ progress }: { progress: number }) {
  const s = (i: number) => stateOf(i, progress);
  const verified = s(4) === 'done';

  return (
    <div className="@container relative h-full w-full overflow-hidden">
      <div className="build-scan pointer-events-none absolute inset-x-4 z-[2] h-10 @md:inset-x-6" aria-hidden="true" />
      <div className="mx-auto flex h-full w-full max-w-[1100px] flex-col gap-3 p-4 @md:gap-4 @md:p-6" aria-hidden="true">
        <Block state={s(0)} label="Nav" className="h-12 shrink-0 @md:h-14">
          <div className="flex h-full items-center justify-between px-4">
            <span className="h-4 w-20 rounded-[5px] bg-[var(--ink)]" />
            <span className="hidden gap-3 @md:flex">
              <Line w="44px" />
              <Line w="44px" />
              <Line w="44px" />
            </span>
            <span className="h-6 w-16 rounded-[6px] bg-[var(--lime)] ring-2 ring-[var(--edge)]" />
          </div>
        </Block>

        <div className="grid min-h-0 flex-[1.4] grid-cols-1 gap-3 @lg:grid-cols-[1.1fr_1fr] @md:gap-4">
          <Block state={s(1)} label="Headline" className="min-h-[120px]">
            <div className="flex h-full flex-col justify-center gap-3 p-5 @md:p-7">
              <Line w="85%" strong />
              <Line w="62%" strong />
              <span className="mt-2 block space-y-2">
                <Line w="90%" />
                <Line w="70%" />
              </span>
              <span className="mt-2 h-8 w-28 rounded-[8px] bg-[var(--lime)] ring-2 ring-[var(--edge)]" />
            </div>
          </Block>
          <Block state={s(2)} label="Images" className="hidden min-h-[120px] @lg:block">
            <div className="h-full w-full bg-[var(--cream)] [background-image:repeating-linear-gradient(135deg,transparent_0_14px,rgba(28,29,26,0.06)_14px_16px)]" />
          </Block>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 @md:grid-cols-3 @md:gap-4">
          {[0, 1, 2].map((card) => (
            <Block key={card} state={s(3)} label={card === 0 ? 'Sections' : undefined} className={`min-h-[90px] ${card === 2 ? 'hidden @md:block' : ''}`}>
              <div className="flex h-full flex-col gap-2.5 p-4">
                <span className="h-8 w-8 rounded-[8px] bg-[var(--cream)] ring-2 ring-[var(--edge)]" />
                <Line w="70%" strong />
                <Line w="90%" />
                {verified && (
                  <span className="rise-in absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--lime)] ring-2 ring-[var(--edge)]">
                    <Check size={13} weight="bold" />
                  </span>
                )}
              </div>
            </Block>
          ))}
        </div>

        <Block state={s(5)} label="Final touches" className="h-12 shrink-0 @md:h-14">
          <div className="flex h-full items-center justify-between bg-[var(--ink)] px-4">
            <span className="h-3 w-16 rounded-full bg-white/70" />
            <span className="h-3 w-24 rounded-full bg-white/30" />
          </div>
        </Block>
      </div>
    </div>
  );
}
