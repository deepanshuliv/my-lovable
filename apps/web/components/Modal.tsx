'use client';

import { X } from '@phosphor-icons/react';
import { useEffect, useId } from 'react';

export default function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-md',
  tone = 'default',
}: {
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  tone?: 'default' | 'warning';
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-[rgba(28,29,26,0.55)] p-0 backdrop-blur-[4px] sm:items-center sm:p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        className={`rise-in flex max-h-[90dvh] w-full ${width} flex-col overflow-hidden rounded-t-[18px] border-2 border-[var(--edge)] bg-[var(--panel)] sm:rounded-[18px] ${
          tone === 'warning' ? 'shadow-[6px_6px_0_#f5b82e]' : 'shadow-[var(--hard-lg)]'
        }`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="display text-[24px]">
              {title}
            </h2>
            {description && <div className="mt-2 text-[14px] font-medium leading-relaxed text-[var(--muted)]">{description}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--edge)] transition-colors hover:bg-[var(--lime)]"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="shrink-0 border-t-2 border-[var(--edge)] bg-[var(--cream)] px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
