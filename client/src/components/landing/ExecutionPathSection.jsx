import { useRef, useState } from 'react';
import {
  Braces, ChartBar, Check, CircleHelp, Database, Library, Play, ShieldCheck, ShieldX, Zap,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { GENERATED_MQL, KEY_STAGE, PATH_STAGES, SCENARIOS, SCHEMA_PROFILE_ROWS } from './demoData';
import { PipelineCode, SegmentedTabs, focusRing } from '../ui/vg/primitives';
import { MOTION_OK, gsap, prefersReducedMotion, useGSAP, useScopedAnimation } from './motion';

const STAGE_ICONS = {
  database: Database, library: Library, help: CircleHelp, braces: Braces,
  shield: ShieldCheck, zap: Zap, chart: ChartBar,
};

function Row({ label, children, className }) {
  return (
    <p className={cn('flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0', className)}>
      <span className="text-vg-text-3 sm:mr-3 inline-block sm:w-36 shrink-0">{label}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function ValidationDetail({ scenario }) {
  if (scenario === 'blocked') {
    return (
      <div className="flex flex-col gap-3 text-[14px]">
        <Row label="Operation class">Read with server-side code</Row>
        <Row label="Blocked operator"><span className="font-code text-[13px] text-vg-red">$function</span></Row>
        <Row label="Validation">
          <span className="text-vg-red flex items-center gap-1.5">
            <ShieldX size={15} aria-hidden="true" />
            Rejected — not executed
          </span>
        </Row>
      </div>
    );
  }
  if (scenario === 'write') {
    return (
      <div className="flex flex-col gap-3 text-[14px]">
        <Row label="Operation class">Write · <span className="font-code text-[13px]">updateMany</span> on orders</Row>
        <Row label="Validation"><span className="text-vg-amber">Staged as draft · approval token issued</span></Row>
        <div className="flex flex-wrap items-center gap-2 mt-1" aria-label="Approval actions (preview)">
          <span className="h-10 px-4 rounded-lg bg-vg-amber text-vg-bg text-[13.5px] font-semibold flex items-center gap-2">
            <Check size={14} aria-hidden="true" />
            Authorize &amp; commit
          </span>
          <span className="h-10 px-4 rounded-lg border border-vg-line text-[13.5px] text-vg-text-2 flex items-center">Discard draft</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <Row label="Operation class">Read</Row>
      <Row label="Stages checked"><span className="font-code text-[13px]">$match · $group · $sort · $project</span></Row>
      <Row label="Validation">
        <span className="text-vg-accent flex items-center gap-1.5">
          <ShieldCheck size={15} aria-hidden="true" />
          Read-only verified
        </span>
      </Row>
    </div>
  );
}

function StageDetail({ stage, scenario }) {
  switch (stage) {
    case 0:
      return (
        <table className="w-full font-code text-[13px]">
          <tbody>
            {SCHEMA_PROFILE_ROWS.map((r, i) => (
              <tr key={r.collection} className={cn(i < SCHEMA_PROFILE_ROWS.length - 1 && 'border-b border-vg-line-soft')}>
                <td className="h-10 text-vg-text-3 w-28 sm:w-40 align-middle">{r.collection}</td>
                <td className="py-2">{r.fields}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 1:
      return (
        <div className="flex flex-col gap-3 text-[14px]">
          <p><span className="text-vg-text-3 mr-3">Examples used</span>3</p>
          <p><span className="text-vg-text-3 mr-3">Example question</span>&ldquo;Revenue by country for September&rdquo;</p>
          <PipelineCode
            code={'[{ $match: … }, { $group: { _id: "$country", revenue: { $sum: "$amount" } } }]'}
            className="text-[12.5px] text-vg-text-2"
          />
        </div>
      );
    case 2:
      return (
        <div className="flex flex-col gap-3 text-[14px]">
          <p><span className="text-vg-text-3 mr-3">Question</span>Which date field should define the month?</p>
          <p><span className="text-vg-text-3 mr-3">Options</span><span className="font-code text-[13px]">ordered_at · paid_at · Other</span></p>
          <p><span className="text-vg-text-3 mr-3">Selected</span><span className="font-code text-[13px] text-vg-accent">ordered_at</span></p>
        </div>
      );
    case 3:
      return <PipelineCode code={GENERATED_MQL} className="text-[12.5px] leading-[20px] text-vg-text-2" />;
    case 4:
      return <ValidationDetail scenario={scenario} />;
    case 5:
      return (
        <div className="flex flex-col gap-3 text-[14px]">
          <Row label="Elapsed"><span className="tabular-nums">184 ms</span></Row>
          <Row label="Rows returned"><span className="tabular-nums">4</span></Row>
          <Row label="Collection"><span className="font-code text-[13px]">analytics_prod.orders</span></Row>
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-3 text-[14px]">
          <Row label="Visualization">Horizontal bar · bar · line · pie · area · table</Row>
          <Row label="Pipeline">Shown with the answer, copyable</Row>
          <p>
            <a href="#product" className={cn('text-vg-text-2 underline decoration-vg-line underline-offset-4 hover:text-vg-text rounded', focusRing)}>
              See saved results in the demo
            </a>
          </p>
        </div>
      );
  }
}

export default function ExecutionPathSection() {
  const scope = useRef(null);
  const tlRef = useRef(null);
  const [scenario, setScenario] = useState('read');
  const [stage, setStage] = useState(KEY_STAGE);

  // Inspector fade on every stage or scenario change
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo('.ins-body', { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.3 });
      });
      return () => mm.revert();
    },
    { scope, dependencies: [stage, scenario] }
  );

  const animate = useScopedAnimation(scope);

  const stopReplay = () => {
    tlRef.current?.revert();
    tlRef.current = null;
  };

  const replay = () => {
    stopReplay();
    if (prefersReducedMotion()) {
      setStage(KEY_STAGE);
      return;
    }
    tlRef.current = animate(() => {
      const tl = gsap.timeline();
      tl.fromTo('.path-fill', { scaleX: 0 }, { scaleX: 1, duration: 4.2, ease: 'none' }, 0);
      PATH_STAGES.forEach((_, i) => tl.call(() => setStage(i), null, i * 0.7));
      tl.call(() => setStage(KEY_STAGE), null, 4.6);
    });
  };

  const selectStage = (i) => {
    stopReplay();
    setStage(i);
  };

  const selectScenario = (id) => {
    stopReplay();
    setScenario(id);
    setStage(KEY_STAGE);
  };

  const current = PATH_STAGES[stage];

  return (
    <section
      ref={scope}
      id="safety"
      data-nav="safety"
      className="px-5 md:px-10 lg:px-20 py-24 lg:py-0 lg:min-h-[900px] lg:pt-[72px] flex flex-col justify-center bg-vg-char scroll-mt-[72px]"
    >
      <div className="w-full max-w-[1280px] mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <h2 className="font-read text-[34px] leading-[40px] lg:text-[44px] lg:leading-[50px] tracking-[-0.01em] max-w-[640px]">
            Every question takes the same path from schema to result.
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedTabs
              items={SCENARIOS}
              value={scenario}
              onChange={selectScenario}
              label="Request type"
              variant="segmented"
              className="max-w-full overflow-x-auto [scrollbar-width:none]"
            />
            <button
              type="button"
              onClick={replay}
              className={cn('h-11 px-4 rounded-lg border border-vg-line text-[13.5px] text-vg-text-2 flex items-center gap-2 hover:text-vg-text hover:bg-vg-surface-2', focusRing)}
            >
              <Play size={14} aria-hidden="true" />
              Replay
            </button>
          </div>
        </div>

        <div className="mt-14 overflow-x-auto -mx-5 px-5 md:mx-0 md:px-0 pt-3 pb-1">
          <div className="relative min-w-[760px]">
            <div className="absolute left-[40px] right-[40px] top-[20px] h-[2px] bg-vg-line" aria-hidden="true" />
            <div
              className="path-fill absolute left-[40px] right-[40px] top-[20px] h-[2px] bg-vg-accent origin-left"
              aria-hidden="true"
            />
            <ol className="relative grid grid-cols-7" aria-label="Execution path">
              {PATH_STAGES.map((s, i) => {
                const Icon = STAGE_ICONS[s.icon];
                const on = i === stage;
                const key = i === KEY_STAGE;
                return (
                  <li key={s.name}>
                    <button
                      type="button"
                      onClick={() => selectStage(i)}
                      aria-current={on ? 'step' : undefined}
                      className={cn('group w-full flex flex-col items-center gap-3 rounded-xl py-1', key && '-mt-3', focusRing)}
                    >
                      <span
                        className={cn(
                          'border-2 flex items-center justify-center transition-colors duration-200',
                          key ? 'w-16 h-16 rounded-2xl' : 'w-10 h-10 rounded-full',
                          on
                            ? 'bg-vg-accent border-vg-accent text-vg-ink'
                            : 'bg-vg-bg border-vg-line text-vg-text-2 group-hover:border-vg-text-3'
                        )}
                      >
                        <Icon size={key ? 24 : 16} aria-hidden="true" />
                      </span>
                      <span
                        className={cn(
                          'transition-colors',
                          key ? 'text-[15px] font-semibold' : 'text-[14px]',
                          on ? 'text-vg-text' : 'text-vg-text-2 group-hover:text-vg-text'
                        )}
                      >
                        {s.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="mt-12 rounded-xl border border-vg-line bg-vg-bg min-h-[260px]" aria-live="polite">
          <div className="ins-body p-6 md:p-8 flex flex-col md:flex-row gap-6 md:gap-12">
            <div className="md:w-[300px] shrink-0">
              <h3 className="text-[20px] font-semibold">{current.name}</h3>
              <p className="mt-2 text-[15px] leading-[24px] text-vg-text-2">{current.desc}</p>
              {stage === 3 && (
                <p className="mt-4 text-[14px]">
                  <span className="text-vg-text-3 mr-3">Model</span>
                  <span className="font-code text-[13px]">openai/gpt-oss-120b</span>
                </p>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <StageDetail stage={stage} scenario={scenario} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
