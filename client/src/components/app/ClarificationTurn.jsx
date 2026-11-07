import { useId, useState } from 'react';
import { CircleHelp, ArrowRight, Check, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TurnTitle, TurnButton } from './turnParts';

const OTHER = '__other__';
const isMultiType = (q) => q.type === 'multiple' || q.type === 'multi';
const optionLabel = (opt) => (opt.value === OTHER ? 'Other' : opt.label || opt.value);
const fieldPath = (opt) => (opt.value === OTHER ? '' : opt.collection ? `${opt.collection}.${opt.value}` : opt.value);

function initialAnswers(questions) {
  const init = {};
  for (const q of questions) {
    const rec = (q.options || []).find((o) => o.recommended);
    if (rec) init[q.id] = isMultiType(q) ? [rec.value] : rec.value;
  }
  return init;
}

/** Indicator drawn over the real (visually hidden) input. */
function Indicator({ multi, on }) {
  if (multi) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'w-4 h-4 shrink-0 rounded-[4px] flex items-center justify-center',
          on ? 'bg-vg-accent text-vg-ink' : 'border border-vg-text-3'
        )}
      >
        {on && <Check size={11} strokeWidth={3} />}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn('w-4 h-4 shrink-0 rounded-full border flex items-center justify-center', on ? 'border-vg-accent' : 'border-vg-text-3')}
    >
      {on && <span className="w-2 h-2 rounded-full bg-vg-accent" />}
    </span>
  );
}

function QuestionGroup({ question, value, customText, onSelect, onCustomText, disabled, idPrefix }) {
  const multi = isMultiType(question);
  const selected = (v) => (multi ? Array.isArray(value) && value.includes(v) : value === v);
  const otherOn = selected(OTHER);
  const name = `${idPrefix}-${question.id}`;

  return (
    <fieldset className="min-w-0 p-4" disabled={disabled}>
      <div className="flex items-start justify-between gap-4">
        <legend className="float-left text-[15px] leading-[22px] font-medium text-vg-text">{question.question}</legend>
        <span className="shrink-0 mt-0.5 text-[12px] text-vg-text-3">{multi ? 'Choose any' : 'Choose one'}</span>
      </div>
      <div className="clear-both mt-3 flex flex-col gap-1">
        {(question.options || []).map((opt) => {
          const on = selected(opt.value);
          const path = fieldPath(opt);
          return (
            <label
              key={opt.value}
              className={cn(
                'relative min-h-9 px-2.5 py-1.5 rounded-lg flex items-center gap-3 cursor-pointer transition-colors',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vg-accent',
                on ? 'bg-vg-surface-2' : 'hover:bg-vg-surface-2'
              )}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={name}
                value={opt.value}
                checked={on}
                onChange={() => onSelect(opt.value)}
                className="sr-only"
              />
              <Indicator multi={multi} on={on} />
              <span className={cn('text-[14px] whitespace-nowrap', on ? 'text-vg-text' : 'text-vg-text-2')}>{optionLabel(opt)}</span>
              {opt.recommended && <span className="text-[12px] text-vg-text-3">Recommended</span>}
              {path && <span className="ml-auto min-w-0 font-code text-[11.5px] text-vg-text-3 truncate" title={path}>{path}</span>}
            </label>
          );
        })}
        {otherOn && (
          <div className="mt-1.5 pl-[38px] pr-2.5">
            <label htmlFor={`${name}-other`} className="block text-[12px] text-vg-text-3 mb-1.5">Field path</label>
            <input
              id={`${name}-other`}
              value={customText || ''}
              onChange={(e) => onCustomText(e.target.value)}
              placeholder="collection.field"
              autoComplete="off"
              spellCheck={false}
              className="w-full h-9 px-3 rounded-lg bg-vg-bg border border-vg-accent-deep outline-none focus:border-vg-accent font-code text-[13px] text-vg-text placeholder:text-vg-muted"
            />
          </div>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Ambiguous question: one fieldset per question (radio for single choice,
 * checkboxes for multiple). Multi-select answers are sent as arrays.
 */
export default function ClarificationTurn({ message, onSubmit, onBypass, isLoading, answered }) {
  const idPrefix = useId().replace(/:/g, '');
  const questions = message.questions || [];
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [customTexts, setCustomTexts] = useState({});
  const [submitting, setSubmitting] = useState(null); // 'continue' | 'bypass'

  const select = (q, v) => {
    setAnswers((prev) => {
      if (!isMultiType(q)) return { ...prev, [q.id]: v };
      const cur = Array.isArray(prev[q.id]) ? prev[q.id] : [];
      return { ...prev, [q.id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });
  };

  const isAnswered = (q) => {
    const val = answers[q.id];
    const custom = (customTexts[q.id] || '').trim();
    if (isMultiType(q)) {
      if (!Array.isArray(val) || val.length === 0) return false;
      return !val.includes(OTHER) || custom.length > 0;
    }
    if (!val) return false;
    return val !== OTHER || custom.length > 0;
  };
  const canContinue = questions.length > 0 && questions.every(isAnswered);

  const buildClarifications = () =>
    questions.map((q) => {
      const val = answers[q.id];
      const custom = (customTexts[q.id] || '').trim();
      if (isMultiType(q)) {
        const values = Array.isArray(val) ? val : [];
        return values.includes(OTHER) ? { id: q.id, value: values, customText: custom } : { id: q.id, value: values };
      }
      return val === OTHER ? { id: q.id, value: OTHER, customText: custom } : { id: q.id, value: val };
    });

  const run = async (kind) => {
    if (submitting || isLoading) return;
    setSubmitting(kind);
    try {
      if (kind === 'continue') await onSubmit(buildClarifications());
      else await onBypass();
    } finally {
      setSubmitting(null);
    }
  };

  const disabled = Boolean(answered) || isLoading || Boolean(submitting);

  return (
    <article className="flex flex-col" aria-labelledby={`${idPrefix}-title`}>
      <TurnTitle id={`${idPrefix}-title`} icon={CircleHelp} title="Clarification required" aside={answered ? 'Answered' : 'Pipeline not generated'} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canContinue) run('continue');
        }}
        className="mt-4"
      >
        <div
          className={cn(
            'rounded-xl border border-vg-line bg-vg-surface grid grid-cols-1',
            questions.length > 1 && 'lg:grid-cols-[400px_minmax(0,1fr)] divide-y lg:divide-y-0 lg:divide-x divide-vg-line-soft'
          )}
        >
          {questions.map((q) => (
            <QuestionGroup
              key={q.id}
              question={q}
              value={answers[q.id]}
              customText={customTexts[q.id]}
              onSelect={(v) => select(q, v)}
              onCustomText={(t) => setCustomTexts((prev) => ({ ...prev, [q.id]: t }))}
              disabled={disabled}
              idPrefix={idPrefix}
            />
          ))}
        </div>

        {!answered && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <TurnButton type="submit" variant="primary" disabled={!canContinue || disabled}>
              {submitting === 'continue' ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}
              Continue
              {submitting !== 'continue' && <ArrowRight size={15} aria-hidden="true" />}
            </TurnButton>
            <TurnButton variant="ghost" className="px-3.5" onClick={() => run('bypass')} disabled={disabled}>
              {submitting === 'bypass' && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
              Run with assumptions
            </TurnButton>
          </div>
        )}
      </form>
    </article>
  );
}
