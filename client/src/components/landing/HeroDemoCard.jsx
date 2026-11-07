import { useEffect, useRef, useState } from 'react';
import {
  ChartBar, ChartLine, ChartPie, Check, CircleHelp, Copy, CornerDownRight, RotateCcw, Table2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  HERO_METRICS, HERO_PIPELINE, HERO_QUESTIONS, HERO_STAGES, HERO_TABS, REGION_SALES, REGION_SCALE,
  REGION_TOTAL, SAVED_RESULTS, SCHEMA_FIELDS, usd,
} from './demoData';
import { PipelineCode, RadioDot, SegmentedTabs, StatusPill, focusRing } from '../ui/vg/primitives';
import { MOTION_OK, gsap, prefersReducedMotion, useGSAP } from './motion';

const SAVED_ICONS = { bar: ChartBar, table: Table2, line: ChartLine, pie: ChartPie };

function AnswerPanel({ replayKey }) {
  const scope = useRef(null);
  const [chip, setChip] = useState(0);
  const [copied, setCopied] = useState(false);

  // Cycle the highlighted stage chip, as in the design
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setChip((c) => (c + 1) % HERO_STAGES.length), 1600);
    return () => clearInterval(t);
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline();
        tl.from('.mql-line', { autoAlpha: 0, x: -6, stagger: 0.05, duration: 0.25 }, 0.1)
          .from('.hero-bar', { scaleX: 0, stagger: 0.08, duration: 0.7, ease: 'power3.out' }, 0.2);
        gsap.utils.toArray('.hero-val').forEach((el, i) => {
          const o = { v: 0 };
          const target = Number(el.dataset.v);
          tl.to(o, { v: target, duration: 0.7, ease: 'power3.out', onUpdate: () => { el.textContent = usd(o.v); } }, 0.55 + i * 0.08);
        });
        const total = scope.current.querySelector('.hero-total');
        const t = { v: 0 };
        tl.to(t, { v: REGION_TOTAL, duration: 0.9, ease: 'power3.out', onUpdate: () => { total.textContent = Math.round(t.v).toLocaleString('en-US'); } }, 0.3);
        tl.from('.hero-verified', { autoAlpha: 0, x: 8, duration: 0.3 }, '-=0.2');
      });
      return () => mm.revert();
    },
    { scope, dependencies: [replayKey], revertOnUpdate: true }
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(HERO_PIPELINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const summary = REGION_SALES.map((r) => `${r.label} ${usd(r.value)}`).join(', ');

  return (
    <div ref={scope}>
      <div className="flex flex-col md:flex-row md:h-[284px]">
        <div className="md:w-[58%] px-5 md:px-7 py-5 flex flex-col">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-medium">Sales by region</span>
            <span className="font-code text-[12px] text-vg-text-3">October 2026 · demo data</span>
          </div>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="hero-total font-read text-[40px] leading-[46px] tabular-nums">
              {REGION_TOTAL.toLocaleString('en-US')}
            </span>
            <span className="font-code text-[12px] text-vg-text-3">USD total</span>
          </p>
          <div role="img" aria-label={`Sales by region: ${summary}`} className="mt-2 flex flex-col">
            {REGION_SALES.map((r, i) => (
              <div key={r.label} className="h-10 flex flex-col justify-center gap-1.5">
                <div className="flex items-baseline justify-between">
                  <span className={cn('text-[14px]', i === 0 ? 'text-vg-text' : 'text-vg-text-2')}>{r.label}</span>
                  <span className="hero-val font-code text-[13px] tabular-nums" data-v={r.value}>{usd(r.value)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-vg-surface-2 overflow-hidden">
                  <div
                    className="hero-bar h-full rounded-full bg-vg-clay origin-left"
                    style={{ width: `${(r.value / REGION_SCALE) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0 border-t md:border-t-0 md:border-l border-vg-line bg-vg-char-2 flex flex-col">
          <div className="h-11 px-5 flex items-center justify-between border-b border-vg-line-soft">
            <span className="font-code text-[11px] uppercase tracking-[0.08em] text-vg-text-2 truncate">
              Aggregation pipeline
              <span className="normal-case tracking-normal text-vg-text-3 ml-1.5">analytics_prod.orders</span>
            </span>
            <button
              type="button"
              onClick={copy}
              className={cn('h-7 px-2 shrink-0 rounded-md text-[12.5px] text-vg-text-2 flex items-center gap-1.5 hover:bg-vg-surface-2', focusRing)}
            >
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy MQL'}
            </button>
          </div>
          <div className="px-5 pt-3 flex gap-1.5 font-code text-[11px]" aria-hidden="true">
            {HERO_STAGES.map((s, i) => (
              <span
                key={s}
                className={cn(
                  'h-6 px-2 rounded-md flex items-center transition-colors duration-300',
                  i === chip ? 'bg-vg-accent-wash text-vg-accent' : 'bg-vg-surface-2 text-vg-text-2'
                )}
              >
                {s}
              </span>
            ))}
          </div>
          <PipelineCode
            code={HERO_PIPELINE}
            lineNumbers
            label="Generated aggregation pipeline"
            lineClassName="mql-line"
            className="text-[12.5px] leading-[19px] text-vg-text px-5 py-2.5"
          />
        </div>
      </div>

      <div className="min-h-11 px-5 py-2.5 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-vg-line text-[13px]">
        {HERO_METRICS.map((m) => (
          <span key={m.label} className="flex gap-2">
            <span className="text-vg-text-3">{m.label}</span>
            <span className={m.code ? 'font-code text-[12.5px]' : 'tabular-nums'}>{m.value}</span>
          </span>
        ))}
        <StatusPill className="hero-verified ml-auto" />
      </div>
    </div>
  );
}

function ClarifyPanel() {
  return (
    <div className="min-h-[344px] px-5 md:px-7 py-7 flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-vg-amber flex items-center gap-1.5">
          <CircleHelp size={14} aria-hidden="true" />
          Clarification needed
        </span>
        <span className="font-read text-[20px]">Which date field should define the month?</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <span className="h-11 pl-3 pr-4 rounded-lg border border-vg-accent-deep bg-vg-accent-wash flex items-center gap-2.5">
          <RadioDot on />
          <span className="font-code text-[13px]">ordered_at</span>
          <span className="text-[12px] text-vg-text-2">Recommended</span>
        </span>
        <span className="h-11 pl-3 pr-4 rounded-lg border border-vg-line flex items-center gap-2.5">
          <RadioDot />
          <span className="font-code text-[13px] text-vg-text-2">paid_at</span>
        </span>
        <span className="h-11 pl-3 pr-4 rounded-lg border border-vg-line flex items-center gap-2.5">
          <RadioDot />
          <span className="text-[13px] text-vg-text-2">Other</span>
        </span>
      </div>
      <a
        href="#clarify"
        className={cn('text-[13.5px] text-vg-text-2 underline decoration-vg-line underline-offset-4 self-start hover:text-vg-text rounded', focusRing)}
      >
        Try the clarification step below
      </a>
    </div>
  );
}

function SchemaPanel() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-[13.5px]">
        <thead>
          <tr className="text-left text-[12.5px] text-vg-text-3 border-b border-vg-line-soft">
            <th className="h-10 px-5 font-normal">Field</th>
            <th className="font-normal">BSON type</th>
            <th className="font-normal">Sample value</th>
            <th className="font-normal pr-5 text-right">Used in pipeline</th>
          </tr>
        </thead>
        <tbody className="font-code text-[12.5px]">
          {SCHEMA_FIELDS.map((f, i) => (
            <tr key={f.field} className={cn(i < SCHEMA_FIELDS.length - 1 && 'border-b border-vg-line-soft')}>
              <td className="h-11 px-5">{f.field}</td>
              <td className="text-vg-text-2">{f.type}</td>
              <td className="text-vg-text-3">{f.sample}</td>
              <td className={cn('pr-5 text-right', f.usedIn ? 'text-vg-accent' : 'text-vg-text-3')}>{f.usedIn || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavedPanel() {
  return (
    <ul className="text-[14px]">
      {SAVED_RESULTS.map((s, i) => {
        const Icon = SAVED_ICONS[s.icon];
        return (
          <li
            key={s.title}
            className={cn(
              'min-h-[60px] px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2',
              i < SAVED_RESULTS.length - 1 && 'border-b border-vg-line-soft'
            )}
          >
            <Icon size={16} className="text-vg-text-3" aria-hidden="true" />
            <span className="flex-1 min-w-[180px]">{s.title}</span>
            <span className="text-[12.5px] text-vg-text-3 tabular-nums w-24">{s.rows} rows</span>
            <span className="text-[12.5px] text-vg-text-3 w-28">{s.pinned}</span>
            <span className="flex gap-1">
              <span className="h-8 px-2.5 rounded-md border border-vg-line text-[12.5px] text-vg-text-2 flex items-center">Export CSV</span>
              <span className="h-8 px-2.5 rounded-md border border-vg-line text-[12.5px] text-vg-text-2 flex items-center">Export JSON</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function HeroDemoCard() {
  const [tab, setTab] = useState('answer');
  const [replayKey, setReplayKey] = useState(0);
  const panelRef = useRef(null);

  useGSAP(
    () => {
      if (tab === 'answer' || prefersReducedMotion()) return;
      gsap.fromTo(panelRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 });
    },
    { dependencies: [tab] }
  );

  const replay = () => {
    setTab('answer');
    setReplayKey((k) => k + 1);
  };

  return (
    <div className="hero-card shadow-[0_-30px_80px_rgba(79,199,155,0.06)] rounded-2xl border border-vg-line bg-vg-char overflow-hidden">
      <div className="min-h-14 pl-5 pr-2 py-2 flex flex-col lg:flex-row lg:items-center justify-between gap-2 border-b border-vg-line">
        <p className="flex items-center gap-2.5 text-[15px]">
          <CornerDownRight size={16} className="shrink-0 text-vg-accent" aria-hidden="true" />
          <span>{HERO_QUESTIONS[tab]}</span>
        </p>
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] -ml-3 lg:ml-0">
          <SegmentedTabs items={HERO_TABS} value={tab} onChange={setTab} label="Demo views" idPrefix="hero" />
          <span className="w-px h-5 bg-vg-line mx-1.5 shrink-0" aria-hidden="true" />
          <button
            type="button"
            onClick={replay}
            aria-label="Replay answer"
            className={cn('w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-vg-text-3 hover:text-vg-text hover:bg-vg-surface-2', focusRing)}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      <div
        ref={panelRef}
        role="tabpanel"
        id={`hero-panel-${tab}`}
        aria-labelledby={`hero-tab-${tab}`}
      >
        {tab === 'answer' && <AnswerPanel replayKey={replayKey} />}
        {tab === 'clarify' && <ClarifyPanel />}
        {tab === 'schema' && <SchemaPanel />}
        {tab === 'saved' && <SavedPanel />}
      </div>
    </div>
  );
}
