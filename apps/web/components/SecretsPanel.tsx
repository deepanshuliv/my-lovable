'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchSecrets, removeSecret, saveSecretsBatch } from '@/lib/api';
import { useToken } from '@/lib/useToken';
import type { RequiredSecret, SecretSummary } from '@/lib/types';

export default function SecretsPanel({
  projectId,
  required,
  onClose,
  onSaved,
}: {
  projectId: string;
  required: RequiredSecret[];
  onClose: () => void;
  onSaved?: (keys: string[]) => void;
}) {
  const getToken = useToken();
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const data = await fetchSecrets(await getToken(), projectId);
      setSecrets(data.secrets);
      setEnabled(data.enabled);
    })();
  }, [projectId, getToken]);

  const savedKeys = useMemo(() => new Set(secrets.map((s) => s.key)), [secrets]);

  const pending = useMemo(() => {
    const rows: RequiredSecret[] = [];
    for (const item of required) {
      if (!savedKeys.has(item.key) && !rows.some((r) => r.key === item.key)) rows.push(item);
    }
    for (const key of extraKeys) {
      if (!savedKeys.has(key) && !rows.some((r) => r.key === key)) {
        rows.push({ key, reason: 'added by you' });
      }
    }
    return rows;
  }, [required, extraKeys, savedKeys]);

  const filledCount = pending.filter((row) => (drafts[row.key] ?? '').length > 0).length;

  function addRow() {
    const key = newKey.trim().toUpperCase();
    if (!key) return;
    setExtraKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    if (newValue) {
      setDrafts((prev) => ({ ...prev, [key]: newValue }));
    }
    setNewKey('');
    setNewValue('');
  }

  async function submit() {
    const payload = pending
      .map((row) => ({ key: row.key, value: drafts[row.key] ?? '' }))
      .filter((row) => row.value.length > 0);

    if (payload.length === 0 || saving) return;

    setSaving(true);
    setError(null);
    setSavedNote(null);

    try {
      const result = await saveSecretsBatch(await getToken(), projectId, payload);

      setSecrets((prev) => {
        const merged = new Map(prev.map((s) => [s.key, s]));
        for (const secret of result.secrets) merged.set(secret.key, secret);
        return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
      });

      const accepted = new Set(result.secrets.map((s) => s.key));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const key of accepted) delete next[key];
        return next;
      });
      setExtraKeys((prev) => prev.filter((key) => !accepted.has(key)));

      if (result.rejected.length > 0) {
        setError(result.rejected.map((r) => `${r.key}: ${r.msg}`).join(' · '));
      }
      if (accepted.size > 0) {
        setSavedNote(`Saved ${accepted.size} — dev server restarted.`);
        onSaved?.([...accepted]);
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(secretKey: string) {
    await removeSecret(await getToken(), projectId, secretKey);
    setSecrets((prev) => prev.filter((s) => s.key !== secretKey));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] border shadow-2xl transition-all relative"
        style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
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
            Project Secrets
          </h2>
          <p className="mt-2 text-[14px] text-white/50 leading-relaxed max-w-[400px]">
            Injected as environment variables. Values are encrypted and never shown in plaintext again.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          {!enabled && (
            <div className="rounded-xl border px-4 py-3 text-[13px] text-white/70" style={{ background: 'var(--error-bg)', borderColor: 'var(--error)' }}>
              Secrets storage is disabled on the server — <code className="font-mono text-white">SECRETS_MASTER_KEY</code> is not set.
            </div>
          )}

          {secrets.length > 0 && (
            <div className="space-y-2">
              <ColumnHeader left="Variable" right="Value" />
              {secrets.map((secret) => (
                <div
                  key={secret.key}
                  className="flex items-center gap-3 rounded-xl border px-4 py-3"
                  style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
                >
                  <code className="w-1/2 shrink-0 truncate font-mono text-[13px] text-white">{secret.key}</code>
                  <span className="flex-1 font-mono text-[13px]" style={{ color: 'var(--muted)' }}>
                    {secret.maskedPreview}
                  </span>
                  <button
                    onClick={() => remove(secret.key)}
                    className="shrink-0 text-[11px] text-white/40 hover:text-red-400 transition"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div className="space-y-3">
              <ColumnHeader
                left={`Needed (${pending.length})`}
                right="Paste the value"
                highlight
              />
              {pending.map((row) => (
                <div key={row.key} className="space-y-1">
                  <div className="flex items-center gap-3">
                    <code
                      className="w-1/2 shrink-0 truncate rounded-xl border px-4 py-3 font-mono text-[13px] font-semibold"
                      style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      title={row.key}
                    >
                      {row.key}
                    </code>
                    <input
                      value={drafts[row.key] ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submit();
                      }}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Paste value..."
                      className="min-w-0 flex-1 rounded-xl border px-4 py-3 font-mono text-[13px] text-white outline-none placeholder:text-white/20 focus:border-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--accent)]/20 shadow-none focus:shadow-[0_0_15px_rgba(85,255,0,0.1)] transition-colors"
                      style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
                    />
                  </div>
                  {row.reason && (
                    <p className="pl-1 text-[11px] text-[var(--accent)]">
                      ↳ {row.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {secrets.length === 0 && pending.length === 0 && (
            <p className="text-[13px] italic text-center text-white/30 py-4">
              No secrets yet. The agent will name what it needs as it builds.
            </p>
          )}

          <div className="space-y-3 border-t pt-6" style={{ borderColor: 'var(--line)' }}>
            <span className="block text-[11px] font-bold uppercase tracking-widest text-white/40">
              Add Custom Secret
            </span>
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Key (e.g. DATABASE_URL)"
                spellCheck={false}
                className="w-full sm:w-1/3 rounded-xl border px-4 py-3 font-mono text-[13px] text-white outline-none placeholder:text-white/20 focus:border-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--accent)]/20 shadow-none focus:shadow-[0_0_15px_rgba(85,255,0,0.1)] transition-colors"
                style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
              />
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addRow();
                }}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Value..."
                className="w-full sm:flex-1 rounded-xl border px-4 py-3 font-mono text-[13px] text-white outline-none placeholder:text-white/20 focus:border-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--accent)]/20 shadow-none focus:shadow-[0_0_15px_rgba(85,255,0,0.1)] transition-colors"
                style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
              />
              <button
                onClick={addRow}
                disabled={!newKey.trim()}
                className="btn-secondary whitespace-nowrap"
              >
                Add Row
              </button>
            </div>
          </div>

          {error && <p className="text-[13px] text-center text-red-400">{error}</p>}
          {savedNote && (
            <p className="text-[13px] text-center text-[var(--accent)]">
              {savedNote}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 shrink-0 border-t p-6" style={{ borderColor: 'var(--line)' }}>
          <button
            onClick={submit}
            disabled={!enabled || saving || filledCount === 0}
            className="btn-primary w-full"
          >
            {saving
              ? 'Saving & Restarting…'
              : filledCount === 0
                ? 'Submit'
                : `Submit ${filledCount} & Restart Sandbox`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnHeader({
  left,
  right,
  highlight,
}: {
  left: string;
  right: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="flex gap-3 px-1 text-[11px] font-bold uppercase tracking-widest"
      style={{ color: highlight ? 'var(--accent)' : 'rgba(255, 255, 255, 0.4)' }}
    >
      <span className="w-1/2 shrink-0">{left}</span>
      <span className="flex-1">{right}</span>
    </div>
  );
}
