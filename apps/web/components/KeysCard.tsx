'use client';

import { Check, CheckCircle, Key, Minus, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { declineKeys, submitKeys } from '@/lib/api';
import type { ChatItem, KeyCheck } from '@/lib/types';
import { useToken } from '@/lib/useToken';

type Item = Extract<ChatItem, { kind: 'keys' }>;

const HEADINGS: Record<Item['status'], string> = {
  pending: 'Connect your services',
  verified: 'Keys checked',
  declined: 'Continuing without keys',
  expired: 'Request expired',
};

const CHECK_COLORS: Record<KeyCheck['status'], string> = {
  valid: 'var(--success)',
  invalid: 'var(--error)',
  unchecked: 'var(--muted)',
  unreachable: 'var(--warning)',
};

export default function KeysCard({ item }: { item: Item }) {
  const getToken = useToken();
  const [values, setValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, KeyCheck>>({});
  const [busy, setBusy] = useState<'check' | 'decline' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<'verified' | 'declined' | 'expired' | null>(null);

  const status = item.status === 'pending' && accepted ? accepted : item.status;
  const pending = status === 'pending';
  const filled = item.keys.every((key) => (values[key.key] ?? '').trim().length > 0);

  async function check() {
    if (!filled || busy) return;
    setBusy('check');
    setMessage(null);
    const outcome = await submitKeys(await getToken(), item.requestId, values);
    setResults(Object.fromEntries(outcome.results.map((result) => [result.key, result])));
    if (outcome.ok) {
      setValues({});
      setAccepted('verified');
    } else if (outcome.status === 'expired') {
      setAccepted('expired');
    } else if (outcome.status === 'unreachable') {
      setMessage("Some of these services can't be used here yet. You can continue with just the design, or use a different service.");
    } else if (outcome.status === 'invalid') {
      setMessage('Some keys did not work. Fix the ones marked below and try again.');
    } else {
      setMessage(outcome.message ?? 'Something went wrong. Please try again.');
    }
    setBusy(null);
  }

  async function decline() {
    if (busy) return;
    setBusy('decline');
    setMessage(null);
    const outcome = await declineKeys(await getToken(), item.requestId);
    if (outcome.ok) setAccepted('declined');
    else if (outcome.status === 'expired') setAccepted('expired');
    else setMessage(outcome.message ?? 'Something went wrong. Please try again.');
    setBusy(null);
  }

  return (
    <div
      className={`overflow-hidden rounded-[12px] border-2 bg-[var(--panel)] ${pending ? 'border-[var(--edge)] shadow-[var(--hard)]' : 'border-[var(--line-strong)]'}`}
    >
      <div
        className={`flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5 text-[12.5px] font-medium ${
          pending ? 'bg-[var(--lime)] font-bold text-[var(--ink)]' : 'text-[var(--muted)]'
        }`}
      >
        {status === 'verified' ? <CheckCircle size={15} weight="fill" /> : pending ? <Key size={15} weight="fill" /> : <Minus size={15} />}
        {HEADINGS[status]}
      </div>

      <div className="space-y-3 p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text)]/85">
          {pending && (
            <>
              To build {item.service || 'this'}, your website needs to connect to the services below. Paste your keys and
              we will check that each one works <strong className="font-semibold text-[var(--text)]">before</strong> we start, so
              no credits are spent on a build that cannot work.
            </>
          )}
          {status === 'verified' && 'Your keys work and are saved securely. Building the full version now.'}
          {status === 'declined' && 'No problem. You can add these keys any time later.'}
          {status === 'expired' && 'This request timed out. Send your message again whenever you are ready.'}
        </p>

        <div className="space-y-2.5">
          {item.keys.map((key) => {
            const result = results[key.key];
            return (
              <div key={key.key} className="rounded-[10px] border-2 border-[var(--edge)] bg-[var(--cream)] p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold">{key.service}</span>
                  <code className="truncate font-mono text-[10.5px]" style={{ color: 'var(--muted)' }}>
                    {key.key}
                  </code>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {key.reason}
                </p>

                {pending && (
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={values[key.key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void check();
                    }}
                    placeholder={`Paste your ${key.service} key`}
                    aria-label={`${key.service} key (${key.key})`}
                    className="field mt-2.5 px-3 py-2 font-mono text-[12px] placeholder:font-sans"
                    style={{
                      borderColor:
                        result?.status === 'invalid' ? 'var(--error)' : result?.status === 'unreachable' ? 'var(--warning)' : 'var(--line-strong)',
                    }}
                  />
                )}

                {result && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug" style={{ color: CHECK_COLORS[result.status] }}>
                    {result.status === 'valid' ? (
                      <Check size={12} weight="bold" className="mt-0.5 shrink-0" />
                    ) : result.status !== 'unchecked' ? (
                      <WarningCircle size={12} weight="fill" className="mt-0.5 shrink-0" />
                    ) : null}
                    {result.message}
                  </p>
                )}

                {pending && key.helpUrl && (
                  <a
                    href={key.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-block text-[11px] underline underline-offset-2 transition hover:opacity-80"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    Where do I find this?
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {message && (
          <p role="alert" className="rounded-[10px] border-2 border-[var(--edge)] bg-[var(--error-card)] px-3 py-2 text-[12.5px] font-medium">
            {message}
          </p>
        )}

        {pending && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void check()}
              disabled={!filled || busy !== null}
              className="btn-primary w-full"
            >
              {busy === 'check' ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent-ink)] border-t-transparent" />
                  Checking your keys…
                </>
              ) : (
                'Check keys and start building'
              )}
            </button>
            <button
              type="button"
              onClick={() => void decline()}
              disabled={busy !== null}
              className="btn-ghost w-full"
            >
              {busy === 'decline' ? 'One moment…' : "I don't have these keys"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
