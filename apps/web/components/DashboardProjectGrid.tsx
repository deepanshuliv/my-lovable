'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listProjects, renameProject, deleteProject, type ProjectSummary } from '@/lib/api';
import { useToken } from '@/lib/useToken';

export default function DashboardProjectGrid() {
  const getToken = useToken();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const load = useCallback(async () => {
    setProjects(await listProjects(await getToken()));
  }, [getToken]);

  useEffect(() => {
    void load();

    const saved = localStorage.getItem('my-lovable-view-mode');
    if (saved === 'grid' || saved === 'list') {
      setViewMode(saved);
    }
  }, [load]);

  const toggleViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('my-lovable-view-mode', mode);
  };

  async function commitRename(projectId: string) {
    const name = draft.trim();
    setEditing(null);

    const current = projects?.find((project) => project.id === projectId);
    if (!name || !current || name === current.name) return;

    setProjects((rows) =>
      rows ? rows.map((row) => (row.id === projectId ? { ...row, name } : row)) : rows,
    );

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
    } catch (error) {
      console.error('Delete failed', error);
      void load();
    }
  }

  if (!projects) {
    return (
      <div className="mt-8 animate-pulse">
        <div className="h-8 w-48 bg-[var(--panel)] rounded mb-6"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-48 rounded-xl bg-[var(--panel)] border"
              style={{ borderColor: 'var(--line)' }}
            ></div>
          ))}
        </div>
      </div>
    );
  }

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="mt-12">
      {}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative max-w-sm w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-[var(--panel)] py-2 pl-10 pr-4 text-[13px] outline-none transition-colors focus:bg-[var(--panel-hover)] focus:border-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--accent)]/20 shadow-none focus:shadow-[0_0_15px_rgba(85,255,0,0.1)]"
            style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
          />
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center rounded-lg border p-1"
            style={{ borderColor: 'var(--line)', backgroundColor: 'var(--panel)' }}
          >
            <button
              onClick={() => toggleViewMode('grid')}
              className={`rounded-md p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-[var(--panel-hover)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
              title="Grid View"
            >
              <GridIcon />
            </button>
            <button
              onClick={() => toggleViewMode('list')}
              className={`rounded-md p-1.5 transition-colors ${viewMode === 'list' ? 'bg-[var(--panel-hover)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
              title="List View"
            >
              <ListIcon />
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          className="rounded-xl border p-12 text-center"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--panel)' }}
        >
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--panel-2)]">
            <FolderIcon />
          </div>
          <h3 className="text-[15px] font-medium text-white mb-2">No projects found</h3>
          <p className="text-[13px] max-w-sm mx-auto" style={{ color: 'var(--muted)' }}>
            {search
              ? "We couldn't find anything matching your search."
              : "You haven't created any projects yet. Start by describing what you want to build above."}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="group flex flex-col rounded-xl border transition-all"
              style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--panel-hover)';
                e.currentTarget.style.borderColor = 'var(--line-strong)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--panel)';
                e.currentTarget.style.borderColor = 'var(--line)';
              }}
            >
              <Link
                href={`/project/${project.id}`}
                className="block relative aspect-[4/3] w-full overflow-hidden rounded-t-xl border-b flex items-center justify-center bg-[var(--bg)]"
                style={{ borderColor: 'var(--line)' }}
              >
                {}
                <div className="text-[var(--accent)] font-heading text-4xl uppercase opacity-20 transform transition-transform group-hover:scale-110">
                  {project.name.substring(0, 2)}
                </div>
                {}
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10"></div>
              </Link>

              <div className="p-4">
                {editing === project.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(project.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(project.id);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="w-full rounded-md border px-3 py-1.5 text-[14px] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--accent)]/20 shadow-none focus:shadow-[0_0_15px_rgba(85,255,0,0.1)]"
                    style={{
                      borderColor: 'var(--line-strong)',
                      background: 'var(--panel-2)',
                      color: 'var(--text)',
                    }}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/project/${project.id}`}
                      className="truncate text-[15px] font-medium transition hover:text-[var(--accent)]"
                      style={{ color: 'var(--text)' }}
                    >
                      {project.name}
                    </Link>
                    <DropdownMenu
                      onRename={() => {
                        setEditing(project.id);
                        setDraft(project.name);
                      }}
                      onDelete={() => void commitDelete(project.id)}
                    />
                  </div>
                )}

                <div
                  className="mt-3 flex items-center text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--muted)' }}
                >
                  <span>
                    Edited{' '}
                    {new Date(project.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
                <div
          className="rounded-xl border overflow-visible"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--panel)' }}
        >
          <table className="w-full text-left text-[13px]">
            <thead
              className="border-b bg-[var(--panel-2)]"
              style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
            >
              <tr className="border-b bg-[var(--panel-2)]" style={{ borderColor: 'var(--line)' }}>
                <th className="px-4 py-3 font-medium w-full rounded-tl-xl">Project</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Last Edited</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap text-right rounded-tr-xl">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => (
                <tr
                  key={project.id}
                  className="border-b last:border-0 hover:bg-[var(--panel-hover)] transition-colors"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs"
                        style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }}
                      >
                        <span className="font-bold text-[var(--accent)]">·</span>
                      </div>
                      {editing === project.id ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => void commitRename(project.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitRename(project.id);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          className="w-full max-w-xs rounded-md border px-3 py-1.5 text-[14px] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--accent)]/20 shadow-none focus:shadow-[0_0_15px_rgba(85,255,0,0.1)]"
                          style={{
                            borderColor: 'var(--line-strong)',
                            background: 'var(--panel-2)',
                            color: 'var(--text)',
                          }}
                        />
                      ) : (
                        <Link
                          href={`/project/${project.id}`}
                          className="truncate font-medium transition hover:text-[var(--accent)] text-white"
                        >
                          {project.name}
                        </Link>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                    {new Date(project.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setEditing(project.id);
                        setDraft(project.name);
                      }}
                      className="rounded-md px-3 py-1.5 text-[12px] opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-white inline-flex opacity-100"
                      style={{ color: 'var(--muted)' }}
                    >
                      Rename
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--muted)' }}
    >
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7"></rect>
      <rect x="14" y="3" width="7" height="7"></rect>
      <rect x="14" y="14" width="7" height="7"></rect>
      <rect x="3" y="14" width="7" height="7"></rect>
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" y1="6" x2="21" y2="6"></line>
      <line x1="8" y1="12" x2="21" y2="12"></line>
      <line x1="8" y1="18" x2="21" y2="18"></line>
      <line x1="3" y1="6" x2="3.01" y2="6"></line>
      <line x1="3" y1="12" x2="3.01" y2="12"></line>
      <line x1="3" y1="18" x2="3.01" y2="18"></line>
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--muted)' }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
  );
}

function DropdownMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) {
      setTimeout(() => setConfirming(false), 200);
    }
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/10"
        style={{ color: 'var(--muted)' }}
      >
        <MoreHorizontalIcon />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-xl border p-1.5 shadow-lg bg-[#141415]"
          style={{ borderColor: 'var(--line-strong)' }}
          onMouseDown={(e) => e.preventDefault()} 
        >
          {confirming ? (
            <div className="flex flex-col gap-1.5 px-1 py-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400 mb-1 px-1">
                Are you sure?
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                  setOpen(false);
                }}
                className="w-full rounded-md bg-red-500/20 px-2 py-1.5 text-left text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/30"
              >
                Yes, Delete
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRename();
                  setOpen(false);
                }}
                className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-white transition-colors hover:bg-white/10"
              >
                Rename
              </button>
              <button
                className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-white opacity-50 cursor-not-allowed"
                title="Coming soon"
              >
                Duplicate
              </button>
              <div className="my-1 h-px w-full bg-white/10" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(true);
                }}
                className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MoreHorizontalIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="1"></circle>
      <circle cx="19" cy="12" r="1"></circle>
      <circle cx="5" cy="12" r="1"></circle>
    </svg>
  );
}
