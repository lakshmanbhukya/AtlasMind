import { LoaderCircle } from 'lucide-react';

/** Placeholder while the server profiles the schema, generates and validates the pipeline. */
export default function PendingTurn({ label = 'Generating pipeline…' }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <div className="h-8 flex items-center gap-2.5 text-[15px] text-vg-text-2">
        <LoaderCircle size={17} className="text-vg-accent animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {label}
      </div>
      <div aria-hidden="true" className="rounded-xl border border-vg-line-soft bg-vg-surface/60 p-4 flex flex-col gap-2.5">
        {[78, 64, 52].map((w) => (
          <span
            key={w}
            className="h-3 rounded bg-vg-surface-2 vg-shimmer"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}
