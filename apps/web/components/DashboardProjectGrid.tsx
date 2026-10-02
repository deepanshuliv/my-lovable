'use client';

import { DotsThree, ListBullets, MagnifyingGlass, PencilSimple, Plus, SquaresFour, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listProjects, renameProject, deleteProject, type ProjectSummary } from '@/lib/api';
import { useToken } from '@/lib/useToken';
import { artKind, artLabel } from './ProjectArt';
import { LimeButton, Polaroid } from './lime';

const VIEW_KEY = 'my-lovable.projects-view';

function editedLabel(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'Edited just now';
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Edited ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `Edited ${days} ${days === 1 ? 'day' : 'days'} ago`;
  return `Edited ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

const TILT = ['-rotate-2', 'rotate-1', '-rotate-1', 'rotate-2'];

export default function DashboardProjectGrid({ onStart }: { onStart?: () => void }) {
  const getToken = useToken();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      setProjects(await listProjects(await getToken()));
    } catch {
      setLoadError(true);
      setProjects([]);
    }
  }, [getToken]);

  useEffect(() => {
    void load();

    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'grid' || saved === 'list') setViewMode(saved);
    } catch {}
  }, [load]);

  const toggleViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {}
  };

  async function commitRename(projectId: string) {
    const name = draft.trim();
    setEditing(null);

    const current = projects?.find((project) => project.id === projectId);
    if (!name || !current || name === current.name) return;

    setProjects((rows) => (rows ? rows.map((row) => (row.id === projectId ? { ...row, name } : row)) : rows));

    try {
      await renameProject(await getToken(), projectId, name);
    } catch {
      void load();
    }
  }

  async function commitDelete(projectId: string) {
    setProjects((rows) => (rows ? rows.filter((row) => row.id !== projectId) : rows));
    try {
      await deleteProject(await getToken(), projectId);
    } catch {
      void load();
    }
  }

  const startRename = (project: ProjectSummary) => {
    setEditing(project.id);
    setDraft(project.name);
  };

  const renameInput = (project: ProjectSummary) => (
    <input
      autoFocus
      aria-label="Project name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commitRename(project.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commitRename(project.id);
        if (e.key === 'Escape') setEditing(null);
      }}
      className="field px-2.5 py-1.5 text-[14px]"
    />
  );

  if (!projects) {
    return (
      <section className="mt-16" aria-label="Loading your projects">
        <div className="mb-6 h-8 w-48 animate-pulse rounded-[8px] bg-[var(--cream)]" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-[14px] border-2 border-[var(--line)] bg-[var(--cream)]" />
          ))}
        </div>
      </section>
    );
  }

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="mt-16">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <h2 className="display flex items-center gap-3 text-[32px]">
          Your projects
          {projects.length > 0 && (
            <span className="rounded-[6px] bg-[var(--ink)] px-2 py-0.5 text-[14px] font-bold tracking-normal text-[var(--lime)]">{projects.length}</span>
          )}
        </h2>

        {projects.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <MagnifyingGlass size={15} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Search projects"
                placeholder="Search projects"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="field py-2 pl-9 text-[13px]"
              />
            </div>
            <div className="flex shrink-0 rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] p-0.5" role="radiogroup" aria-label="Layout">
              {(
                [
                  ['list', ListBullets, 'List'],
                  ['grid', SquaresFour, 'Cards'],
                ] as const
              ).map(([mode, ModeIcon, label]) => (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={viewMode === mode}
                  aria-label={label}
                  title={label}
                  onClick={() => toggleViewMode(mode)}
                  className={`flex h-8 w-9 items-center justify-center rounded-[7px] transition-colors ${
                    viewMode === mode ? 'bg-[var(--ink)] text-[var(--lime)]' : 'hover:bg-[var(--cream)]'
                  }`}
                >
                  <ModeIcon size={16} weight="bold" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {loadError ? (
        <div className="card flex flex-col items-start gap-4 border-[var(--error)] p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] font-bold">We could not load your projects.</p>
          <button onClick={() => void load()} className="btn-secondary btn-sm">
            Try again
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="relative grid gap-8 overflow-hidden rounded-[18px] bg-[var(--ink)] p-8 text-white md:grid-cols-[1fr_auto] md:items-center md:p-10">
          <div>
            <span className="tag bg-[var(--lime)] text-[var(--ink)]">Empty for now</span>
            <p className="display mt-4 text-[34px]">Your first app goes here.</p>
            <p className="mt-3 max-w-[44ch] text-[15px] font-medium leading-[1.5] text-white/75">
              Describe your idea above. Every project you start is saved here, so you can come back and keep changing it.
            </p>
            {onStart && (
              <div className="mt-7">
                <LimeButton onClick={onStart}>Start your first app</LimeButton>
              </div>
            )}
          </div>
          <div className="hidden gap-3 md:flex">
            <Polaroid name="Yoga Class Booking" shadow="#000" className="w-[170px] -rotate-6" />
            <Polaroid name="Candle Shop" shadow="#000" delay={0.3} className="mt-8 w-[170px] rotate-6" />
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-[15px] font-medium text-[var(--muted)]">Nothing matches &ldquo;{search}&rdquo;.</p>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((project, index) => (
            <article key={project.id} className="group relative">
              <Link
                href={`/project/${project.id}`}
                className={`block transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-0 ${TILT[index % TILT.length]}`}
              >
                <Polaroid name={project.name} photo={false} caption={artLabel(artKind(project.name))} delay={(index % 4) * 0.12} />
              </Link>
              <div className="mt-5 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {editing === project.id ? (
                    renameInput(project)
                  ) : (
                    <Link href={`/project/${project.id}`} className="block truncate text-[16px] font-bold hover:underline">
                      {project.name}
                    </Link>
                  )}
                  <p className="mt-0.5 text-[13px] font-medium text-[var(--muted)]">{editedLabel(project.updatedAt)}</p>
                </div>
                <ProjectMenu name={project.name} onRename={() => startRename(project)} onDelete={() => void commitDelete(project.id)} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((project) => (
            <li
              key={project.id}
              className="group flex items-center gap-4 rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] p-3 pr-2 transition-[transform,box-shadow,background-color] duration-150 hover:-translate-x-[2px] hover:-translate-y-[2px] hover:bg-[var(--lime-wash)] hover:shadow-[var(--hard)] sm:p-3.5"
            >
              <Link
                href={`/project/${project.id}`}
                tabIndex={-1}
                aria-hidden="true"
                className="hidden w-[104px] shrink-0 -rotate-2 transition-transform duration-300 group-hover:rotate-0 sm:block"
              >
                <Polaroid name={project.name} photo={false} caption=" " className="!p-1.5 !pb-0 [&_p]:hidden" shadow="transparent" />
              </Link>
              <div className="min-w-0 flex-1">
                {editing === project.id ? (
                  renameInput(project)
                ) : (
                  <Link href={`/project/${project.id}`} className="block truncate text-[16.5px] font-bold">
                    {project.name}
                  </Link>
                )}
                <span className="mt-1 flex items-center gap-2 text-[12.5px] font-medium text-[var(--muted)]">
                  <span className="tag !px-1.5 !py-0.5 !text-[10.5px] bg-[var(--cream)] text-[var(--text)]">{artLabel(artKind(project.name))}</span>
                  {editedLabel(project.updatedAt)}
                </span>
              </div>
              <Link
                href={`/project/${project.id}`}
                className="hidden rounded-[8px] border-2 border-[var(--edge)] px-3 py-1.5 text-[12px] font-bold uppercase opacity-0 transition-opacity group-hover:opacity-100 md:block"
              >
                Open
              </Link>
              <ProjectMenu name={project.name} onRename={() => startRename(project)} onDelete={() => void commitDelete(project.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectMenu({ name, onRename, onDelete }: { name: string; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={`Options for ${name}`}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-transparent transition-colors hover:border-[var(--edge)] hover:bg-[var(--lime)]"
      >
        <DotsThree size={18} weight="bold" />
      </button>

      {open && (
        <div
          role="menu"
          className="rise-in absolute right-0 top-full z-[var(--z-modal)] mt-1.5 w-52 rounded-[12px] border-2 border-[var(--edge)] bg-[var(--panel)] p-1.5 shadow-[var(--hard)]"
        >
          {confirming ? (
            <div className="p-1.5">
              <p className="text-[13px] font-medium">Delete this project?</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">This removes it for good.</p>
              <div className="mt-3 flex gap-1.5">
                <button onClick={() => setConfirming(false)} className="btn-ghost btn-sm flex-1">
                  Keep
                </button>
                <button
                  onClick={() => {
                    onDelete();
                    setOpen(false);
                  }}
                  className="btn-sm flex-1 rounded-[8px] border-2 border-[var(--edge)] bg-[var(--error)] font-bold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  onRename();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-bold transition-colors hover:bg-[var(--lime)]"
              >
                <PencilSimple size={14} />
                Rename
              </button>
              <button
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-bold text-[var(--error)] transition-colors hover:bg-[var(--error-bg)]"
              >
                <Trash size={14} />
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
