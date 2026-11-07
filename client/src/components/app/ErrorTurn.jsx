import { CircleAlert, RotateCcw } from 'lucide-react';
import { TurnButton } from './turnParts';

/** A request that failed before producing an outcome (network, LLM, server error). */
export default function ErrorTurn({ message, onRetry, disabled }) {
  return (
    <article className="flex flex-col" aria-label="Request failed">
      <div
        role="alert"
        className="rounded-xl border border-[color-mix(in_srgb,var(--vg-red)_35%,transparent)] bg-vg-red-wash px-4 py-3 flex items-start gap-3"
      >
        <CircleAlert size={17} className="mt-0.5 shrink-0 text-vg-red" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-vg-text">
            {message.isVoice ? 'Voice question failed' : 'Request failed'}
          </p>
          <p className="mt-1 text-[13.5px] leading-5 text-vg-text-2 break-words">{message.content}</p>
        </div>
      </div>
      {onRetry && message.naturalLanguage && (
        <div className="mt-3">
          <TurnButton variant="outline" onClick={onRetry} disabled={disabled}>
            <RotateCcw size={15} className="text-vg-text-2" aria-hidden="true" />
            Retry
          </TurnButton>
        </div>
      )}
    </article>
  );
}
