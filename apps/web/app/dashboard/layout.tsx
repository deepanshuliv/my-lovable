import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      {}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {}
      <main className="flex-1 overflow-y-auto">
        {}
        <div className="md:hidden flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-[var(--panel-2)] border" style={{ borderColor: 'var(--line)' }}>
               <span className="font-heading text-xs uppercase text-white tracking-wider leading-none">ML</span>
            </div>
          </div>
          {}
        </div>

        {children}
      </main>
    </div>
  );
}
