import { useId, useState } from 'react';
import { FolderOpen, Check, Plus, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TurnTitle, TurnButton } from './turnParts';

/** Query needs collections outside the active scope: pick which to add and re-run, or run on everything. */
export default function ScopeTurn({ message, onAddAndRerun, onRunAll, isLoading }) {
  const idPrefix = useId().replace(/:/g, '');
  const suggested = message.suggestedCollections || [];
  const current = message.scope || [];
  const [toAdd, setToAdd] = useState(() => [...suggested]);
  const [submitting, setSubmitting] = useState(null);

  const toggle = (c) => setToAdd((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const run = async (kind) => {
    if (submitting || isLoading) return;
    setSubmitting(kind);
    try {
      if (kind === 'add') await onAddAndRerun(toAdd);
      else await onRunAll();
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <article className="flex flex-col" aria-labelledby={`${idPrefix}-title`}>
      <TurnTitle id={`${idPrefix}-title`} icon={FolderOpen} iconClass="text-vg-amber" title="Collections outside scope" aside="Pipeline not run" />

      <div className="mt-4 rounded-xl border border-vg-line bg-vg-surface">
        <fieldset className="p-4">
          <legend className="float-left text-[15px] leading-[22px] font-medium text-vg-text">
            Add {suggested.length === 1 ? 'this collection' : 'these collections'} to the scope?
          </legend>
          <div className="clear-both mt-3 flex flex-col gap-1">
            {suggested.map((c) => {
              const on = toAdd.includes(c);
              return (
                <label
                  key={c}
                  className={cn(
                    'min-h-9 px-2.5 py-1.5 rounded-lg flex items-center gap-3 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vg-accent',
                    on ? 'bg-vg-surface-2' : 'hover:bg-vg-surface-2'
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(c)} disabled={Boolean(submitting) || isLoading} />
                  <span aria-hidden="true" className={cn('w-4 h-4 shrink-0 rounded-[4px] flex items-center justify-center', on ? 'bg-vg-accent text-vg-ink' : 'border border-vg-text-3')}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="font-code text-[13px] text-vg-text">{c}</span>
                  <span className="ml-auto text-[12px] text-vg-text-3">Required by this question</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {current.length > 0 && (
          <p className="px-4 py-3 border-t border-vg-line-soft text-[13px] text-vg-text-3">
            Current scope <span className="font-code text-[12.5px] text-vg-text-2">{current.join(', ')}</span>
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <TurnButton variant="primary" onClick={() => run('add')} disabled={toAdd.length === 0 || Boolean(submitting) || isLoading}>
          {submitting === 'add' ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          Add and re-run
        </TurnButton>
        {onRunAll && (
          <TurnButton variant="ghost" className="px-3.5" onClick={() => run('all')} disabled={Boolean(submitting) || isLoading}>
            Run on all collections
          </TurnButton>
        )}
      </div>
    </article>
  );
}
