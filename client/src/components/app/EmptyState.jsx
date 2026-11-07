import { useMemo } from 'react';
import { ChartLine, ChartBarBig, Table2, ListChecks } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import { greetingFor } from '../../lib/turnFormat';
import { suggestionsFromSchema } from '../../lib/suggestions';

const ICONS = { line: ChartLine, bar: ChartBarBig, table: Table2, list: ListChecks };

function LeafMark() {
  return (
    <svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M20 3c7 6.5 10.5 13 10.5 19.5C30.5 30 25.8 36 20 37c-5.8-1-10.5-7-10.5-14.5C9.5 16 13 9.5 20 3Z" fill="var(--vg-accent)" />
      <path d="M20 9v28" stroke="var(--vg-ink)" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 19l-5-4M20 26l6-5" stroke="var(--vg-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** New-query home: greeting, the large composer, and schema-derived starter questions. */
export default function EmptyState({ name, schema, composer, onSuggestion }) {
  const suggestions = useMemo(() => suggestionsFromSchema(schema), [schema]);
  const greeting = greetingFor();

  return (
    <section aria-labelledby="home-greeting" className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 pb-20 pt-6">
      <h1
        id="home-greeting"
        className="flex items-center gap-3.5 font-read text-[30px] leading-[38px] sm:text-[40px] sm:leading-[48px] font-normal tracking-[-0.01em] text-vg-text text-center"
      >
        <LeafMark />
        <span>
          {greeting}
          {name ? `, ${name}` : ''}
        </span>
      </h1>

      <div className="mt-8 w-full flex justify-center">{composer}</div>

      <div className="mt-10 w-full max-w-[760px] flex flex-wrap justify-center gap-2" aria-label="Starter questions" role="group">
        {suggestions.map((s) => {
          const Icon = ICONS[s.icon] || ChartBarBig;
          return (
            <button
              key={s.text}
              type="button"
              onClick={() => onSuggestion(s.text)}
              className={cn(
                'h-9 px-3.5 rounded-full border border-vg-line flex items-center gap-2 text-[13.5px] text-vg-text-2 hover:bg-vg-surface hover:text-vg-text transition-colors',
                focusRing
              )}
            >
              <Icon size={14} className="text-vg-text-3" aria-hidden="true" />
              {s.text}
            </button>
          );
        })}
      </div>
    </section>
  );
}
