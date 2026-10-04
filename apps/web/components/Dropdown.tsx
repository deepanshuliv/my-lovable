'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';

type DropdownItem = {
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
      document.addEventListener('pointerdown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
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
          role="menu"
          className={`rise-in absolute z-[var(--z-modal)] overflow-hidden rounded-[12px] border-2 border-[var(--edge)] bg-[var(--panel)] shadow-[var(--hard)] ${
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
          style={{ [align]: 0, minWidth: width }}
        >
          <div className="flex max-h-[320px] flex-col overflow-y-auto p-1.5">
            {groups.map((group, groupIndex) => (
              <div key={groupIndex}>
                {group.title && <div className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-[var(--faint)]">{group.title}</div>}
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    role="menuitem"
                    onClick={() => {
                      item.onClick();
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--lime)]"
                  >
                    {item.icon && <span className="mt-0.5 flex w-[13px] shrink-0 justify-center">{item.icon}</span>}
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--text)]">{item.label}</span>
                      {item.secondary && <span className="mt-0.5 block text-[12px] text-[var(--muted)]">{item.secondary}</span>}
                    </span>
                  </button>
                ))}
                {groupIndex < groups.length - 1 && <div className="mx-2 my-1.5 h-px bg-[var(--line)]" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
