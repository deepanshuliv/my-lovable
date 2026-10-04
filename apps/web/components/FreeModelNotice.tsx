'use client';

import { Key, Sparkle } from '@phosphor-icons/react';
import Modal from './Modal';
import { freeModelLabel, PROVIDERS } from '@/lib/byok';

export default function FreeModelNotice({
  model,
  onOk,
  onUseKey,
}: {
  model?: string | null;
  onOk: () => void;
  onUseKey: () => void;
}) {
  const label = freeModelLabel(model);

  return (
    <Modal
      title="You are using the free AI"
      onClose={onOk}
      width="max-w-lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button onClick={onUseKey} className="btn-ghost min-h-[44px] justify-center">
            <Key size={15} weight="bold" />
            Use my own key
          </button>
          <button onClick={onOk} className="btn-primary min-h-[44px] justify-center sm:min-w-[96px]">
            OK
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-[12px] border-2 border-[var(--edge)] bg-[var(--cream)] p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border-2 border-[var(--edge)] bg-[var(--lime)] text-[var(--ink)]">
            <Sparkle size={18} weight="fill" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase text-[var(--muted)]">Building your app</p>
            <p className="truncate text-[16px] font-bold">{label}</p>
          </div>
          <span className="ml-auto shrink-0 rounded-[6px] bg-[var(--lime)] px-2 py-0.5 text-[12px] font-bold uppercase text-[var(--ink)]">Free</span>
        </div>

        <p className="text-[14.5px] font-medium leading-relaxed">
          Your app is being built by <strong>{label}</strong>, a free AI. It is great for trying out ideas, but its designs can
          sometimes look plain or a little off.
        </p>

        <div>
          <p className="text-[14.5px] font-bold">Want better-looking designs?</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--muted)]">
            Use your own AI key from any of these companies. A stronger AI means better designs, and you skip the free daily limit.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PROVIDERS.map((provider) => (
              <li key={provider.id} className="rounded-[10px] border-2 border-[var(--edge)] bg-[var(--panel)] px-3 py-2">
                <p className="text-[13.5px] font-bold">{provider.label}</p>
                <p className="text-[12px] leading-snug text-[var(--muted)]">{provider.blurb}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">
          You pay the company directly for what you use. Your key is locked away safely and never shown again. You
          can switch any time from the AI menu under the chat box.
        </p>
      </div>
    </Modal>
  );
}
