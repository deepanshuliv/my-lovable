'use client';

import { useMemo, useState } from 'react';
import { FALLBACK_MODELS, PROVIDERS, markByokSkipped, type ByokProvider } from '@/lib/byok';
import { saveMyKey, type StoredKey } from '@/lib/api';
import { useToken } from '@/lib/useToken';

export default function ByokModal({
  models,
  onDone,
}: {
  models?: Record<string, { id: string; recommended: boolean }[]>;
  onDone: (key: StoredKey | null) => void;
}) {
  const getToken = useToken();

  const [provider, setProvider] = useState<ByokProvider>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerInfo = PROVIDERS.find((p) => p.id === provider)!;

  const available = useMemo(() => {
    const list = models?.[provider];
    return list && list.length > 0 ? list : FALLBACK_MODELS[provider];
  }, [models, provider]);

  const recommended = available.find((m) => m.recommended) ?? available[0];
  const selected = model || recommended?.id || '';

  async function submit() {
    if (!apiKey.trim() || saving) return;

    setSaving(true);
    setError(null);

    try {
      const { key } = await saveMyKey(await getToken(), provider, apiKey.trim(), selected);
      setApiKey('');
      onDone(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function skip() {
    markByokSkipped();
    onDone(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-md">
      <div
        className="w-full max-w-md overflow-hidden rounded-[24px] border shadow-2xl transition-all relative"
        style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
      >
        <button
          onClick={skip}
          className="absolute top-5 right-5 text-white/40 hover:text-white transition"
          title="Close"
        >
          ✕
        </button>

        <div
          className="flex flex-col items-center justify-center border-b px-6 pt-8 pb-6 text-center"
          style={{ borderColor: 'var(--line)' }}
        >
          <h2 className="font-heading text-[24px] uppercase tracking-wider text-white">
            Power Your Build
          </h2>
          <p className="mt-2 text-[14px] text-white/50 leading-relaxed max-w-[320px]">
            Run on our high-speed platform model by default, or bring your own API key.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <label className="block">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
              Provider
            </span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as ByokProvider);
                setModel('');
              }}
              className="w-full rounded-xl border px-4 py-3 text-[14px] font-medium text-white outline-none transition-all focus:border-[var(--accent)]/30 focus:ring-4 focus:ring-[var(--accent)]/10"
              style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 flex items-center justify-between">
              <span className="block text-[11px] font-bold uppercase tracking-widest text-white/40">
                API key
              </span>
              <a
                href={providerInfo.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[var(--accent)] hover:opacity-80 transition"
              >
                Get a key ↗
              </a>
            </div>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={providerInfo.placeholder}
              className="w-full rounded-xl border px-4 py-3 font-mono text-[13px] text-white outline-none placeholder:text-white/20 transition-all focus:border-[var(--accent)]/30 focus:ring-4 focus:ring-[var(--accent)]/10"
              style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
              Model
            </span>
            <select
              value={selected}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-xl border px-4 py-3 font-mono text-[13px] text-white outline-none transition-all focus:border-[var(--accent)]/30 focus:ring-4 focus:ring-[var(--accent)]/10"
              style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
            >
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.recommended ? '  (recommended)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-3 pt-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!apiKey.trim() || saving}
              className="btn-primary w-full"
            >
              {saving ? 'Saving…' : 'Save & Use My Key'}
            </button>
            <button
              type="button"
              onClick={skip}
              className="btn-secondary w-full"
            >
              Skip & Use Platform Key
            </button>
          </div>

          <p className="mt-1 text-center text-[11px] text-white/30">
            Encrypted with AES-256-GCM. Delete anytime.
          </p>

          {error && <p className="mt-2 text-center text-[12px] text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
