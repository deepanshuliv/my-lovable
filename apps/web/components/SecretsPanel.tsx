'use client';

import { Check, Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { fetchSecrets, removeSecret, saveSecretsBatch } from '@/lib/api';
import { useToken } from '@/lib/useToken';
import type { RequiredSecret, SecretSummary } from '@/lib/types';
import Modal from './Modal';

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
  const [adding, setAdding] = useState(false);

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
        rows.push({ key, reason: '' });
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
    setAdding(false);
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
        setError(result.rejected.map((r) => `${r.key}: ${r.msg}`).join('. '));
      }
      if (accepted.size > 0) {
        setSavedNote(`Saved ${accepted.size === 1 ? 'it' : `all ${accepted.size}`}. Your app is restarting.`);
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
    <Modal
      title="App settings"
      width="max-w-lg"
      description={
        pending.length > 0
          ? 'Your app needs these to work. Paste each value and save.'
          : 'Private keys your app uses, like a payments or email key. They are encrypted and never shown again.'
      }
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-[var(--muted)]">{savedNote ?? (filledCount > 0 ? 'Your app restarts to use them.' : '')}</p>
          <button onClick={submit} disabled={!enabled || saving || filledCount === 0} className="btn-primary shrink-0">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {!enabled && (
          <p className="rounded-[10px] border-2 border-[var(--edge)] bg-[var(--error-card)] px-4 py-3 text-[13px] font-medium leading-relaxed">
            Saving keys is turned off on this server. Ask whoever runs it to set{' '}
            <code className="font-mono text-[12px]">SECRETS_MASTER_KEY</code>.
          </p>
        )}

        {pending.map((row) => (
          <div key={row.key}>
            <label htmlFor={`secret-${row.key}`} className="mb-1.5 block font-mono text-[13px] font-medium">
              {row.key}
            </label>
            <input
              id={`secret-${row.key}`}
              value={drafts[row.key] ?? ''}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your key here"
              className="field font-mono text-[13px]"
            />
            {row.reason && <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">{row.reason}</p>}
          </div>
        ))}

        {secrets.length > 0 && (
          <ul className="divide-y-2 divide-[var(--edge)] rounded-[10px] border-2 border-[var(--edge)]">
            {secrets.map((secret) => (
              <li key={secret.key} className="flex items-center gap-3 py-2 pl-4 pr-2">
                <Check size={14} weight="bold" className="shrink-0 text-[var(--accent-text)]" />
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{secret.key}</code>
                <span className="font-mono text-[12px] text-[var(--muted)]">{secret.maskedPreview}</span>
                <button
                  onClick={() => remove(secret.key)}
                  aria-label={`Remove ${secret.key}`}
                  className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--muted)] transition-colors hover:bg-[var(--tint)] hover:text-[var(--error)]"
                >
                  <Trash size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Key name"
              autoFocus
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="KEY_NAME"
              spellCheck={false}
              className="field font-mono text-[13px] sm:w-[42%]"
            />
            <input
              aria-label="Value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addRow();
              }}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Value"
              className="field font-mono text-[13px] sm:flex-1"
            />
            <button onClick={addRow} disabled={!newKey.trim()} className="btn-secondary shrink-0">
              Add
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="btn-ghost btn-sm -ml-2">
            <Plus size={14} weight="bold" />
            Add a key yourself
          </button>
        )}

        {error && (
          <p role="alert" className="text-[13px] text-[var(--error)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
