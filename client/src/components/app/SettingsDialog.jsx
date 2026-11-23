import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KeyRound, Leaf, ExternalLink, LoaderCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import { apiErrorMessage } from '../../lib/apiError';
import { payerSummary } from '../../lib/providerSettings';
import { useProviderSettings } from '../../hooks/useProviderSettings';

const GROQ_KEYS_URL = 'https://console.groq.com/keys';

function SmallButton({ variant = 'ghost', className, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'h-8 px-2.5 rounded-md text-[13px] inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-vg-accent text-vg-ink font-semibold hover:bg-[#62D3AA]',
        variant === 'outline' && 'border border-vg-line text-vg-text hover:bg-vg-surface',
        variant === 'ghost' && 'text-vg-text-2 hover:bg-vg-surface hover:text-vg-text',
        variant === 'danger' && 'text-vg-red hover:bg-vg-red-wash',
        focusRing,
        className
      )}
    >
      {children}
    </button>
  );
}

export default function SettingsDialog({ connectionId, initialKeyForm, onKeySaved, onDismiss }) {
  const dialogRef = useRef(null);
  const [formOpen, setFormOpen] = useState(initialKeyForm);
  const { settings, isLoading, error, saveKey, setMode, deleteKey, isSaving } = useProviderSettings(connectionId);
  const [apiKey, setApiKey] = useState('');
  const [formError, setFormError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);

  const summary = payerSummary(settings);
  const personal = settings?.mode === 'personal';
  const reconnect = Boolean(settings?.requiresReconnectForPersonal);

  const closeForm = () => {
    setApiKey('');
    setFormError(null);
    if (initialKeyForm) onDismiss();
    else setFormOpen(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    const key = apiKey.trim();
    setApiKey('');
    if (!key) {
      setFormError('Paste your Groq API key.');
      return;
    }
    setFormError(null);
    try {
      await saveKey(key);
      onKeySaved?.();
      if (dialogRef.current) closeForm();
    } catch (err) {
      setFormError(apiErrorMessage(err, 'Could not save the key.'));
    }
  };

  const run = async (fn) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(apiErrorMessage(err, 'Could not change the Groq settings.'));
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-title"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      onClick={(event) => { if (event.target === dialogRef.current) onDismiss(); }}
      className="m-auto w-[min(480px,calc(100vw-32px))] max-h-[calc(100dvh-48px)] overflow-y-auto rounded-2xl border border-vg-line bg-vg-char p-0 font-ui text-vg-text shadow-[0_24px_64px_rgba(0,0,0,0.7)] backdrop:bg-black/60"
    >
      <header className="flex h-14 items-center justify-between border-b border-vg-line-soft pl-5 pr-3">
        <h2 id="settings-title" className="text-[16px] font-semibold">Settings</h2>
        <button type="button" aria-label="Close settings" onClick={onDismiss} className={cn('flex h-8 w-8 items-center justify-center rounded-md text-vg-text-3 hover:bg-vg-surface hover:text-vg-text', focusRing)}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <section aria-labelledby="usage-title" className="px-5 py-4 text-[13px]">
        <h3 id="usage-title" className="mb-3 text-sm font-semibold">Usage</h3>
        {isLoading && !settings && (
          <div aria-hidden="true" className="flex flex-col gap-1.5">
            <span className="h-3 w-[60%] rounded bg-vg-surface vg-shimmer" />
            <span className="h-3 w-[80%] rounded bg-vg-surface vg-shimmer" />
          </div>
        )}
        {!settings && !isLoading && error && (
          <p className="text-vg-text-3">Groq settings are unavailable right now.</p>
        )}

        {summary && (
          <div className="flex items-start gap-2.5">
            {summary.payer === 'personal' ? (
              <KeyRound size={15} className="mt-0.5 shrink-0 text-vg-accent" aria-hidden="true" />
            ) : (
              <Leaf size={15} className={cn('mt-0.5 shrink-0', summary.exhausted ? 'text-vg-red' : 'text-vg-accent')} aria-hidden="true" />
            )}
            <div className="min-w-0" aria-live="polite">
              <p className="text-vg-text truncate" data-testid="payer-title">{summary.title}</p>
              <p className={cn('text-[12.5px]', summary.exhausted ? 'text-vg-red' : 'text-vg-text-3')}>{summary.detail}</p>
            </div>
          </div>
        )}
      </section>
      <section aria-labelledby="api-key-title" className="border-t border-vg-line-soft px-5 py-4 text-[13px]">
        <h3 id="api-key-title" className="text-sm font-semibold">API key</h3>
        {settings && !formOpen && !confirmRemove && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {personal ? (
              <>
                <SmallButton variant="outline" disabled={isSaving} onClick={() => run(() => setMode('managed'))}>
                  Use AtlasMind allowance
                </SmallButton>
                <SmallButton disabled={isSaving} onClick={() => setFormOpen(true)}>Replace key</SmallButton>
                <SmallButton variant="danger" disabled={isSaving} onClick={() => setConfirmRemove(true)}>Remove key</SmallButton>
              </>
            ) : settings.hasKey ? (
              <>
                <SmallButton variant="outline" disabled={isSaving} onClick={() => run(() => setMode('personal'))}>
                  Use your key{settings.keyLast4 ? ` (…${settings.keyLast4})` : ''}
                </SmallButton>
                <SmallButton variant="danger" disabled={isSaving} onClick={() => setConfirmRemove(true)}>Remove key</SmallButton>
              </>
            ) : !reconnect ? (
              <SmallButton variant="outline" onClick={() => setFormOpen(true)}>
                <KeyRound size={13} aria-hidden="true" />
                Use your own Groq key
              </SmallButton>
            ) : null}
          </div>
        )}

        {reconnect && (
          <p className="mt-2 text-[12.5px] leading-[18px] text-vg-text-3">
            Disconnect and connect your database again to use your own Groq key.
          </p>
        )}

        {confirmRemove && (
          <div role="group" aria-label="Remove your Groq key" className="mt-2 rounded-lg border border-vg-line bg-vg-surface p-2.5">
            <p className="text-vg-text-2 leading-[18px]">
              Remove your key and switch to the AtlasMind allowance?
            </p>
            <div className="mt-2 flex gap-1.5">
              <SmallButton
                variant="danger"
                disabled={isSaving}
                onClick={() => run(async () => {
                  await deleteKey();
                  setConfirmRemove(false);
                })}
              >
                Remove and switch
              </SmallButton>
              <SmallButton onClick={() => setConfirmRemove(false)}>Keep key</SmallButton>
            </div>
          </div>
        )}

        {formOpen && !reconnect && (
          <form onSubmit={submit} className="mt-2 flex flex-col gap-2" aria-label="Your Groq key">
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] text-vg-text-2">Groq API key</span>
              <input
                ref={inputRef}
                type="password"
                name="groq-api-key"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="gsk_…"
                className="h-9 px-2.5 rounded-md bg-vg-bg border border-vg-line outline-none font-code text-[13px] text-vg-text placeholder:text-vg-text-3 focus:border-vg-accent-deep"
              />
            </label>
            <p className="text-[12px] leading-[17px] text-vg-text-3">
              Your questions and schema context (and audio, for voice) go to Groq on your account. The key is kept
              on the server for this sign-in only, and removed when you disconnect.
            </p>
            <a
              href={GROQ_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className={cn('inline-flex items-center gap-1 text-[12.5px] text-vg-accent hover:underline w-fit rounded', focusRing)}
            >
              Get a key at console.groq.com
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            <div className="flex gap-1.5">
              <SmallButton type="submit" variant="primary" disabled={isSaving}>
                {isSaving && <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />}
                Save and use key
              </SmallButton>
              <SmallButton onClick={closeForm}>Cancel</SmallButton>
            </div>
            {formError && <p role="alert" className="text-[12.5px] text-vg-red">{formError}</p>}
          </form>
        )}

        {actionError && <p role="alert" className="mt-2 text-[12.5px] text-vg-red">{actionError}</p>}
      </section>
    </dialog>
  );
}
