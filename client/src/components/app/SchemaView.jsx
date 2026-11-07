import { useMemo, useState } from 'react';
import { Database, ChevronRight, Search, RefreshCw, Hash, Type, Calendar, Braces, List, ToggleLeft, KeyRound, CircleAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import { TurnButton } from './turnParts';

const TYPE_ICONS = { number: Hash, decimal: Hash, string: Type, date: Calendar, object: Braces, array: List, boolean: ToggleLeft, objectId: KeyRound };

function formatSample(sample) {
  if (sample === null || sample === undefined) return '';
  const s = typeof sample === 'object' ? JSON.stringify(sample) : String(sample);
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

/** Schema explorer: every collection with its document count and sampled fields. */
export default function SchemaView({ schema, isLoading, error, onRefresh, dbName }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const collections = useMemo(() => schema?.collections || [], [schema]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(s) || (c.fields || []).some((f) => f.name.toLowerCase().includes(s)));
  }, [collections, q]);

  return (
    <section aria-labelledby="schema-title" className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-[920px] mx-auto px-4 sm:px-6 pt-5 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="schema-title" className="flex items-center gap-2.5 text-[20px] leading-8 font-semibold tracking-[-0.01em] text-vg-text">
            <Database size={19} className="text-vg-text-2" aria-hidden="true" />
            Schema explorer
          </h1>
          <TurnButton variant="outline" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw size={15} className={cn('text-vg-text-2', isLoading && 'animate-spin')} aria-hidden="true" />
            Refresh schema
          </TurnButton>
        </div>
        <p className="mt-1 text-[13.5px] text-vg-text-3">
          <span className="font-code text-vg-text-2">{dbName}</span>, {collections.length} {collections.length === 1 ? 'collection' : 'collections'}. Fields come from a sample of documents.
        </p>

        <label className="mt-5 h-10 px-3 rounded-lg bg-vg-surface border border-vg-line flex items-center gap-2 focus-within:border-vg-accent-deep">
          <Search size={15} className="text-vg-text-3" aria-hidden="true" />
          <span className="sr-only">Filter collections and fields</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter collections and fields" className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-vg-text placeholder:text-vg-text-3" />
        </label>

        {error && (
          <p role="alert" className="mt-4 flex items-center gap-2 text-[13.5px] text-vg-red">
            <CircleAlert size={15} aria-hidden="true" />
            {error}
          </p>
        )}

        <ul className="mt-4 rounded-xl border border-vg-line bg-vg-surface divide-y divide-vg-line-soft overflow-hidden">
          {isLoading && collections.length === 0 &&
            [60, 45, 70].map((w) => (
              <li key={w} aria-hidden="true" className="h-12 px-4 flex items-center">
                <span className="h-3 rounded bg-vg-surface-2 vg-shimmer" style={{ width: `${w}%` }} />
              </li>
            ))}
          {!isLoading && filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-[13.5px] text-vg-text-3">{q ? 'Nothing matches the filter.' : 'No collections found.'}</li>
          )}
          {filtered.map((c) => {
            const expanded = Boolean(open[c.name]) || Boolean(q.trim());
            const fields = c.fields || [];
            return (
              <li key={c.name}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((p) => ({ ...p, [c.name]: !p[c.name] }))}
                  className={cn('w-full min-h-12 px-4 flex items-center gap-3 text-left hover:bg-vg-surface-2/60', focusRing)}
                >
                  <ChevronRight size={14} className={cn('shrink-0 text-vg-text-3 transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
                  <span className="font-code text-[13.5px] text-vg-text truncate">{c.name}</span>
                  <span className="ml-auto flex items-center gap-4 text-[12.5px] text-vg-text-3 whitespace-nowrap">
                    <span>{fields.length} fields</span>
                    {c.documentCount != null && <span className="font-code">{c.documentCount.toLocaleString()} docs</span>}
                  </span>
                </button>
                {expanded && fields.length > 0 && (
                  <table className="w-full text-[13px] border-t border-vg-line-soft bg-vg-bg/40">
                    <caption className="sr-only">Fields of {c.name}</caption>
                    <thead className="sr-only">
                      <tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Sample</th></tr>
                    </thead>
                    <tbody>
                      {fields.map((f) => {
                        const Icon = TYPE_ICONS[f.type] || Type;
                        const hit = q.trim() && f.name.toLowerCase().includes(q.trim().toLowerCase());
                        return (
                          <tr key={f.name} className="border-b border-vg-line-soft last:border-0">
                            <td className="pl-11 pr-3 h-9">
                              <span className={cn('font-code text-[12.5px]', hit ? 'text-vg-accent' : 'text-vg-text')}>{f.name}</span>
                            </td>
                            <td className="px-3 h-9 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-vg-text-2">
                                <Icon size={13} className="text-vg-text-3" aria-hidden="true" />
                                {f.type}
                              </span>
                            </td>
                            <td className="pr-4 px-3 h-9 font-code text-[12px] text-vg-text-3 truncate max-w-[280px] hidden sm:table-cell">
                              {formatSample(f.sample)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
