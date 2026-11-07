import { useRef, useState } from 'react';
import { CircleHelp, FlaskConical, Play } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CHOICE_TYPES, CLARIFY_FIELDS, MONTHLY_SALES, MONTHS, clarifyPipeline } from './demoData';
import { PipelineCode, RadioDot, focusRing } from '../ui/vg/primitives';
import { MOTION_OK, gsap, useGSAP } from './motion';

const AXIS = ['1.2M', '0.8M', '0.4M', '0'];

export default function ClarifySection() {
  const scope = useRef(null);
  const [field, setField] = useState('ordered_at');
  const [shownField, setShownField] = useState('ordered_at');
  const [assumed, setAssumed] = useState(false);
  const [runKey, setRunKey] = useState(0);

  const pending = field !== shownField;
  const bars = MONTHLY_SALES[shownField];

  // Grow the bars the first time the chart scrolls into view
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from('.m-bar', {
          height: '0%', duration: 0.6, stagger: 0.06, ease: 'power3.out',
          scrollTrigger: { trigger: '.m-chart', start: 'top 85%', once: true },
        });
      });
      return () => mm.revert();
    },
    { scope }
  );

  // Re-grow after "Run query" / "Run with assumptions"
  useGSAP(
    () => {
      if (!runKey) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo('.m-bar', { height: '0%' }, {
          height: (i) => `${bars[i].pct}%`, duration: 0.6, stagger: 0.06, ease: 'power3.out', clearProps: 'height',
        });
      });
      return () => mm.revert();
    },
    { scope, dependencies: [runKey] }
  );

  // Fade the field name when the option changes
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo('.clar-field', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 });
      });
      return () => mm.revert();
    },
    { scope, dependencies: [field] }
  );

  const pick = (id) => {
    setField(id);
    setAssumed(false);
  };

  const run = (assume) => {
    const next = assume ? 'ordered_at' : field;
    setField(next);
    setShownField(next);
    setAssumed(assume);
    setRunKey((k) => k + 1);
  };

  const chartLabel = `Monthly sales, June to October 2026, grouped by ${shownField}: ${MONTHS.map((m, i) => `${m} ${bars[i].label}`).join(', ')}`;

  return (
    <section
      ref={scope}
      id="clarify"
      data-nav="product"
      className="px-5 md:px-10 lg:px-20 py-24 lg:py-0 lg:min-h-[900px] flex flex-col justify-center border-t border-vg-line-soft scroll-mt-[72px]"
    >
      <div className="w-full max-w-[1280px] mx-auto flex flex-col lg:flex-row gap-12 lg:gap-24">
        <div className="lg:w-[320px] shrink-0 pt-2">
          <h2 className="font-read text-[34px] leading-[40px] lg:text-[40px] lg:leading-[46px] tracking-[-0.01em]">
            Clarify the question before running it.
          </h2>
          <p className="mt-6 text-[16px] leading-[26px] text-vg-text-2">
            When a question can map to more than one field, AtlasMind asks which one you mean and recommends a default
            from your schema. Pick a field or run with the recommended assumption.
          </p>
          <dl className="mt-8 flex flex-col gap-3 text-[14px]">
            {CHOICE_TYPES.map((c) => (
              <div key={c.term} className="flex gap-3">
                <dt className="text-vg-text-3 w-24 shrink-0">{c.term}</dt>
                <dd>{c.desc}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex-1 min-w-0 rounded-xl border border-vg-line bg-vg-char overflow-hidden">
          <div className="min-h-[52px] px-5 py-2 flex items-center justify-between gap-3 border-b border-vg-line-soft">
            <p className="text-[15px] flex items-center gap-3">
              <span className="text-[12.5px] text-vg-text-3">Question</span>
              Now compare monthly sales.
            </p>
            <span className="text-[12.5px] text-vg-text-3 flex items-center gap-1.5 shrink-0">
              <FlaskConical size={13} aria-hidden="true" />
              Demo data
            </span>
          </div>

          <div className="px-5 py-5 border-b border-vg-line-soft">
            <p id="clarify-q" className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] text-vg-amber flex items-center gap-1.5">
                <CircleHelp size={14} aria-hidden="true" />
                Clarification needed
              </span>
              <span className="font-read text-[19px]">Which date field should define the month?</span>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-labelledby="clarify-q" className="flex flex-wrap gap-2">
                {CLARIFY_FIELDS.map((f) => {
                  const on = f.id === field;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => pick(f.id)}
                      className={cn(
                        'h-11 pl-3 pr-4 rounded-lg border flex items-center gap-2.5 transition-colors',
                        on ? 'border-vg-accent-deep bg-vg-accent-wash' : 'border-vg-line hover:bg-vg-surface-2',
                        focusRing
                      )}
                    >
                      <RadioDot on={on} />
                      <span className="font-code text-[13px]">{f.id}</span>
                      {f.recommended && <span className="text-[12px] text-vg-text-2">Recommended</span>}
                    </button>
                  );
                })}
              </div>
              <div className="sm:ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => run(true)}
                  className={cn('h-11 px-4 rounded-lg text-[14px] text-vg-text-2 hover:bg-vg-surface-2 hover:text-vg-text', focusRing)}
                >
                  Run with assumptions
                </button>
                <button
                  type="button"
                  onClick={() => run(false)}
                  className={cn('h-11 px-5 rounded-lg bg-vg-text text-vg-bg text-[14px] font-semibold flex items-center gap-2 hover:bg-white', focusRing)}
                >
                  <Play size={15} aria-hidden="true" />
                  Run query
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row">
            <div className="md:w-[400px] shrink-0 border-b md:border-b-0 md:border-r border-vg-line-soft bg-vg-char-2 px-5 py-4">
              <p className="text-[12.5px] text-vg-text-3 mb-2">Pipeline fragment</p>
              <PipelineCode
                code={clarifyPipeline(field)}
                mark={field}
                markClass="clar-field"
                label="Pipeline fragment"
                className="text-[12.5px] leading-[20px] text-vg-text-2"
              />
              {assumed && (
                <p className="mt-3 text-[12.5px] text-vg-text-3">
                  Assumption used: month from <span className="font-code text-vg-text-2">ordered_at</span>
                </p>
              )}
            </div>

            <div className="flex-1 min-w-0 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-vg-text-3">
                <span>Monthly sales (USD), Jun–Oct 2026</span>
                <span className="text-vg-text-2" aria-live="polite">
                  {pending ? 'Run query to update' : <>Grouped by <span className="font-code">{shownField}</span></>}
                </span>
              </div>
              <div className="m-chart relative mt-3 h-[176px] ml-11" role="img" aria-label={chartLabel}>
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" aria-hidden="true">
                  {AXIS.map((a, i) => (
                    <div
                      key={a}
                      className={cn('relative border-t', i === AXIS.length - 1 ? 'border-[#34403A]' : 'border-dashed border-vg-line')}
                    >
                      <span className="absolute -left-11 -top-2 text-[11px] text-vg-text-3 tabular-nums">{a}</span>
                    </div>
                  ))}
                </div>
                <div
                  className={cn('relative h-full flex items-end justify-around px-2 sm:px-4 transition-opacity duration-200', pending && 'opacity-35')}
                  aria-hidden="true"
                >
                  {bars.map((b, i) => (
                    <div key={MONTHS[i]} className="flex flex-col items-center h-full justify-end w-10 sm:w-14">
                      <span className={cn('text-[11.5px] tabular-nums mb-1', i === bars.length - 1 ? 'text-vg-text' : 'text-vg-text-2')}>
                        {b.label}
                      </span>
                      <div className="m-bar w-full rounded-t-[4px] bg-vg-clay" style={{ height: `${b.pct}%` }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ml-11 mt-2 flex justify-around px-2 sm:px-4 text-[12px] text-vg-text-3" aria-hidden="true">
                {MONTHS.map((m) => (
                  <span key={m} className="w-10 sm:w-14 text-center">{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
