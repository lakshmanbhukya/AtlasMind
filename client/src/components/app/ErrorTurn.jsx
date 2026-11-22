import { useEffect, useState } from 'react';
import { CircleAlert, KeyRound, RotateCcw, Leaf } from 'lucide-react';
import { TurnButton } from './turnParts';
import { formatClock } from '../../lib/providerSettings';

const ACTION_LABELS = {
  enterKey: { label: 'Use your own Groq key', icon: KeyRound },
  updateKey: { label: 'Update key', icon: KeyRound },
  useManaged: { label: 'Switch to AtlasMind allowance', icon: Leaf },
};

/** Whole seconds until `at` (epoch ms), ticking down to 0. */
function useSecondsUntil(at) {
  const left = () => (at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0);
  // A turn's retryAt never changes, so the initial value is current for its card.
  const [secs, setSecs] = useState(left);
  useEffect(() => {
    if (!at) return undefined;
    const tick = () => setSecs(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [at]);
  return secs;
}

/**
 * A request that failed before producing an outcome (network, LLM, server error).
 * Provider failures add their own title, the reset time of the AtlasMind allowance,
 * and actions (`onAction('enterKey' | 'updateKey' | 'useManaged')`); a rate limit
 * holds Retry until `retryAt`.
 */
export default function ErrorTurn({ message, onRetry, onAction, disabled }) {
  const wait = useSecondsUntil(message.retryAt);
  const resetAt = formatClock(message.resetAt);
  const title = message.title || (message.isVoice ? 'Voice question failed' : 'Request failed');
  const actions = onAction ? (message.actions || []).filter((a) => ACTION_LABELS[a]) : [];
  const canRetry = Boolean(onRetry && message.naturalLanguage);

  return (
    <article className="flex flex-col" aria-label={title}>
      <div
        role="alert"
        className="rounded-xl border border-[color-mix(in_srgb,var(--vg-red)_35%,transparent)] bg-vg-red-wash px-4 py-3 flex items-start gap-3"
      >
        <CircleAlert size={17} className="mt-0.5 shrink-0 text-vg-red" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-vg-text">{title}</p>
          <p className="mt-1 text-[13.5px] leading-5 text-vg-text-2 break-words">{message.content}</p>
          {resetAt && <p className="mt-1 text-[13px] text-vg-text-3">Resets at {resetAt}.</p>}
        </div>
      </div>
      {(actions.length > 0 || canRetry) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => {
            const { label, icon: Icon } = ACTION_LABELS[a];
            return (
              <TurnButton key={a} variant={a === 'useManaged' ? 'outline' : 'primary'} onClick={() => onAction(a)} disabled={disabled}>
                <Icon size={15} aria-hidden="true" />
                {label}
              </TurnButton>
            );
          })}
          {canRetry && (
            <TurnButton variant="outline" onClick={onRetry} disabled={disabled || wait > 0}>
              <RotateCcw size={15} className="text-vg-text-2" aria-hidden="true" />
              {wait > 0 ? `Try again in ${wait} s` : message.retryLabel || 'Retry'}
            </TurnButton>
          )}
        </div>
      )}
    </article>
  );
}
