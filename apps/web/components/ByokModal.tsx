'use client';

import { ArrowUpRight, Check, LockSimple } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { FALLBACK_MODELS, PROVIDERS, type ByokModel, type ByokProvider } from '@/lib/byok';
import { saveMyKey, type StoredKey } from '@/lib/api';
import { useToken } from '@/lib/useToken';
import Modal from './Modal';

export default function ByokModal({
  initialProvider = 'openrouter',
  models,
  saved = [],
  onSaved,
  onClose,
  onForget,
}: {
  initialProvider?: ByokProvider;
  models?: Record<string, { id: string; label?: string; note?: string; recommended: boolean }[]>;
  saved?: StoredKey[];
  onSaved: (key: StoredKey) => void;
  onClose: () => void;
  onForget?: (provider: ByokProvider) => void;
}) {
  const getToken = useToken();

  const [provider, setProvider] = useState<ByokProvider>(initialProvider);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);

  const info = PROVIDERS.find((p) => p.id === provider)!;
  const existing = saved.find((key) => key.provider === provider) ?? null;

  const available: ByokModel[] = useMemo(() => {
    const fromServer = models?.[provider];
    if (fromServer && fromServer.length > 0) {
      return fromServer.slice(0, 3).map((item) => ({
        id: item.id,
        label: item.label ?? item.id,
        note: item.note ?? '',
        recommended: item.recommended,
      }));
    }
    return FALLBACK_MODELS[provider];
  }, [models, provider]);

  const recommended = available.find((m) => m.recommended) ?? available[0];
  const selected = model || existing?.model || recommended?.id || '';

  async function submit() {
    if (!apiKey.trim() || saving) return;

    setSaving(true);
    setError(null);

    try {
      const { key } = await saveMyKey(await getToken(), provider, apiKey.trim(), selected);
      setApiKey('');
      onSaved(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That key could not be saved. Check it and try again.');
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Use your own AI key"
      description="Builds run on your own account instead of your free credits. You pay your provider directly."
      onClose={onClose}
      width="max-w-lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={!apiKey.trim() || saving} className="btn-primary">
            {saving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent-ink)] border-t-transparent" />
                Checking your key
              </>
            ) : existing ? (
              'Check and replace key'
            ) : (
              'Check key and save'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <span className="field-label">1. Choose your provider</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={provider === p.id}
                onClick={() => {
                  setProvider(p.id);
                  setModel('');
                  setError(null);
                  setConfirmForget(false);
                }}
                className={`rounded-[10px] border-2 px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] ${
                  provider === p.id
                    ? 'border-[var(--edge)] bg-[var(--lime)] shadow-[var(--hard-sm)]'
                    : 'border-[var(--line-strong)] bg-[var(--panel)] hover:border-[var(--edge)]'
                }`}
              >
                <span className="block text-[13.5px] font-semibold">{p.label}</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--muted)]">{p.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="byok-key" className="text-[13px] font-medium">
              2. Paste your {info.label} key
            </label>
            <a
              href={info.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[12px] text-[var(--accent-text)] transition-opacity hover:opacity-80"
            >
              Get a key
              <ArrowUpRight size={12} />
            </a>
          </div>
          {existing && (
            <div className="mb-2.5 flex items-center justify-between gap-3 rounded-[10px] border-2 border-[var(--edge)] bg-[var(--cream)] px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-[var(--muted)]">
                <Check size={13} weight="bold" className="shrink-0 text-[var(--accent-text)]" />
                <span className="truncate">
                  Saved: <span className="font-mono">{existing.maskedPreview}</span>
                </span>
              </span>
              {onForget &&
                (confirmForget ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button onClick={() => setConfirmForget(false)} className="btn-ghost btn-sm !py-1">
                      Keep
                    </button>
                    <button onClick={() => onForget(provider)} className="btn-ghost btn-sm !py-1 !text-[var(--error)]">
                      Remove
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmForget(true)} className="btn-ghost btn-sm shrink-0 !py-1">
                    Remove
                  </button>
                ))}
            </div>
          )}
          <input
            id="byok-key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={existing ? `Paste a new ${info.label} key to replace it` : info.placeholder}
            className="field font-mono text-[13px]"
          />
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            <LockSimple size={13} />
            We check it works, then store it encrypted. It is never shown again.
          </p>
        </div>

        <div>
          <span className="field-label">3. Pick a model</span>
          <div className="space-y-2" role="radiogroup">
            {available.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected === m.id}
                onClick={() => setModel(m.id)}
                className={`flex w-full items-center gap-3 rounded-[10px] border-2 px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] ${
                  selected === m.id
                    ? 'border-[var(--edge)] bg-[var(--lime)] shadow-[var(--hard-sm)]'
                    : 'border-[var(--line-strong)] bg-[var(--panel)] hover:border-[var(--edge)]'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected === m.id ? 'border-[var(--edge)] bg-[var(--ink)]' : 'border-[var(--line-strong)]'
                  }`}
                >
                  {selected === m.id && <span className="h-1.5 w-1.5 rounded-full bg-[var(--lime)]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold">
                    {m.label}
                    {m.recommended && (
                      <span className="rounded-[4px] bg-[var(--ink)] px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-[var(--lime)]">
                        Recommended
                      </span>
                    )}
                  </span>
                  {m.note && <span className="mt-0.5 block text-[12px] text-[var(--muted)]">{m.note}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-[10px] border-2 border-[var(--edge)] bg-[var(--error-card)] px-3 py-2.5 text-[13px] font-medium text-[var(--text)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

