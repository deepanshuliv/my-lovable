'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type ProjectSummary, listProjects } from '@/lib/api';
import { useToken } from '@/lib/useToken';

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const getToken = useToken();
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    async function loadRecent() {
      const token = await getToken();
      const all = await listProjects(token);
      
      setRecentProjects(all.slice(0, 5));
    }
    void loadRecent();
  }, [getToken]);

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', icon: <HomeIcon /> },
    { label: 'All Projects', href: '/dashboard', icon: <FolderIcon /> },
  ];

  return (
    <aside className="flex h-screen w-64 flex-col border-r flex-shrink-0" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--line)' }}>
      {}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded bg-[var(--panel-2)] border shadow-[0_0_8px_rgba(85,255,0,0.15)]" style={{ borderColor: 'var(--line)' }}>
             <img src="/logo.jpg" alt="ML" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="truncate text-sm font-medium text-white">{user?.fullName || user?.primaryEmailAddress?.emailAddress || 'My Workspace'}</span>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Workspace</span>
          </div>
        </div>
        <div className="shrink-0">
          <UserButton afterSignOutUrl="/" appearance={{ elements: { userButtonAvatarBox: "h-7 w-7" } }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {}
        <div className="space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href && item.label === 'Dashboard';
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                style={{ 
                  backgroundColor: active ? 'var(--panel-hover)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--muted)' 
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>

        {}
        <div>
          <h3 className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Recent Projects
          </h3>
          <div className="space-y-0.5">
            {recentProjects.length === 0 ? (
               <div className="px-3 py-2 text-xs" style={{ color: 'var(--muted)' }}>No recent projects</div>
            ) : (
              recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--panel)]"
                  style={{ color: 'var(--muted)' }}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] transition-colors group-hover:border-[var(--line-strong)] group-hover:bg-[var(--panel-hover)]"
                    style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }}>
                    <span className="font-bold text-[var(--accent)]">·</span>
                  </div>
                  <span className="truncate group-hover:text-white transition-colors">{project.name}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <polyline points="9 22 9 12 15 12 15 22"></polyline>
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
  );
}
