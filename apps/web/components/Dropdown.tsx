'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';

export type DropdownItem = {
  id: string;
  label: ReactNode;
  secondary?: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
};

export type DropdownGroup = {
  title?: string;
  items: DropdownItem[];
};

export default function Dropdown({
  trigger,
  groups,
  align = 'left',
  direction = 'down',
  width = 'auto',
}: {
  trigger: ReactNode;
  groups: DropdownGroup[];
  align?: 'left' | 'right';
  direction?: 'up' | 'down';
  width?: string | number;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <div onClick={() => setOpen((prev) => !prev)} className="cursor-pointer">
        {trigger}
      </div>

      {open && (
        <div
          className={`absolute z-50 rounded-xl border shadow-xl backdrop-blur-xl ${
            direction === 'up' ? `bottom-full mb-2 origin-bottom-${align}` : `mt-2 origin-top-${align}`
          }`}
          style={{
            [align]: 0,
            background: 'rgba(10, 10, 11, 0.95)',
            borderColor: 'var(--line-strong)',
            minWidth: width,
            animation: `dropdown-in-${direction} 0.15s ease-out`,
          }}
        >
          <div className="py-1.5 flex flex-col gap-1 max-h-[300px] overflow-y-auto">
            {groups.map((group, groupIndex) => (
              <div key={groupIndex}>
                {group.title && (
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    {group.title}
                  </div>
                )}
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      item.onClick();
                      setOpen(false);
                    }}
                    className="w-full text-left flex flex-col px-3 py-1.5 transition-colors hover:bg-zinc-800/50"
                  >
                    <div className="flex items-center gap-2">
                      {item.icon && <span className="flex-shrink-0 w-4">{item.icon}</span>}
                      <span className="text-xs font-medium text-zinc-200">{item.label}</span>
                    </div>
                    {item.secondary && (
                      <div className="text-[10px] text-zinc-500 mt-0.5" style={{ paddingLeft: item.icon ? '1.5rem' : '0' }}>
                        {item.secondary}
                      </div>
                    )}
                  </button>
                ))}
                {groupIndex < groups.length - 1 && (
                  <div className="h-px bg-zinc-800/60 my-1.5 mx-2" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes dropdown-in-down {
          from { opacity: 0; transform: scale(0.95) translateY(-5px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes dropdown-in-up {
          from { opacity: 0; transform: scale(0.95) translateY(5px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}} />
    </div>
  );
}
