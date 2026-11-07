import { useRef, useState } from 'react';
import { FlaskConical, Mic } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from '../../lib/models';
import { REFUNDS, REFUND_SCALE, VOICE_TRANSCRIPT, usd } from './demoData';
import { RadioDot, focusRing } from '../ui/vg/primitives';
import { MOTION_OK, gsap, prefersReducedMotion, useGSAP, useScopedAnimation } from './motion';

const GRID = 'grid grid-cols-[28px_1fr_auto] sm:grid-cols-[28px_1fr_200px_120px] lg:grid-cols-[28px_1fr_220px_120px]';

export default function ModelsVoiceSection() {
  const scope = useRef(null);
  const transcriptRef = useRef(null);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [playing, setPlaying] = useState(false);
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo('.voice-model', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 });
      });
      return () => mm.revert();
    },
    { scope, dependencies: [modelId] }
  );

  const animate = useScopedAnimation(scope);

  const play = () => {
    if (prefersReducedMotion() || playing) return;
    const el = transcriptRef.current;
    const words = VOICE_TRANSCRIPT.split(' ');
    const o = { n: 0 };
    setPlaying(true);
    animate(() => gsap.timeline({
      onComplete: () => {
        el.textContent = VOICE_TRANSCRIPT;
        setPlaying(false);
      },
    })
      .fromTo('.voice-prog', { scaleX: 0 }, { scaleX: 1, duration: 2.4, ease: 'none' }, 0)
      .fromTo(o, { n: 0 }, {
        n: words.length, duration: 2.2, ease: 'none',
        onUpdate: () => { el.textContent = words.slice(0, Math.round(o.n)).join(' ') || ' '; },
      }, 0.15)
      .fromTo('.v-bar', { scaleX: 0 }, { scaleX: 1, stagger: 0.08, duration: 0.6, ease: 'power3.out' }, 2.5));
  };

  const onRadioKey = (e) => {
    const i = AVAILABLE_MODELS.findIndex((m) => m.id === modelId);
    let n = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % AVAILABLE_MODELS.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + AVAILABLE_MODELS.length) % AVAILABLE_MODELS.length;
    if (n === null) return;
    e.preventDefault();
    setModelId(AVAILABLE_MODELS[n].id);
    e.currentTarget.querySelectorAll('[role="radio"]')[n]?.focus();
  };

  const refundsLabel = `Refunds by category, Q3 2026: ${REFUNDS.map((r) => `${r.label} ${usd(r.value)}`).join(', ')}`;

  return (
    <section
      ref={scope}
      id="models"
      data-nav="models"
      className="px-5 md:px-10 lg:px-20 py-24 lg:py-0 lg:min-h-[900px] lg:pt-[72px] flex flex-col justify-center scroll-mt-[72px]"
    >
      <div className="w-full max-w-[1280px] mx-auto">
        <h2 className="font-read text-[34px] leading-[40px] lg:text-[44px] lg:leading-[50px] tracking-[-0.01em] max-w-[720px]">
          Choose the model per question. Or say it out loud.
        </h2>

        <div className="mt-12 flex flex-col lg:flex-row gap-12 xl:gap-24">
          <div className="lg:w-[744px] lg:shrink min-w-0">
            <div className={cn(GRID, 'h-10 px-4 items-center text-[12.5px] text-vg-text-3 border-b border-vg-line')} aria-hidden="true">
              <span />
              <span>Model</span>
              <span className="hidden sm:block">Model ID</span>
              <span className="text-right">Provider</span>
            </div>
            <div role="radiogroup" aria-label="Query model" onKeyDown={onRadioKey}>
              {AVAILABLE_MODELS.map((m, i) => {
                const on = m.id === modelId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    onClick={() => setModelId(m.id)}
                    className={cn(
                      GRID,
                      'w-full h-14 px-4 gap-x-3 sm:gap-x-0 items-center text-left rounded-lg transition-colors',
                      on ? 'bg-vg-surface-2' : 'hover:bg-vg-surface',
                      focusRing
                    )}
                  >
                    <RadioDot on={on} />
                    <span className="text-[15px] truncate">
                      {m.name}
                      {i === 0 && <span className="ml-2 text-[12px] text-vg-text-2">Default</span>}
                    </span>
                    <span className="hidden sm:block font-code text-[12.5px] text-vg-text-2 truncate">{m.id}</span>
                    <span className="text-right text-[13.5px] text-vg-text-2">{m.vendor}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-4 px-4 text-[13.5px] text-vg-text-3">
              All query models are served through Groq. Switch models from the composer at any time.
            </p>
          </div>

          <div className="flex-1 min-w-0 lg:max-w-[440px] rounded-xl border border-vg-line bg-vg-char overflow-hidden self-start w-full">
            <div className="h-[52px] px-5 flex items-center justify-between border-b border-vg-line-soft">
              <span className="text-[14px] font-medium">Voice query</span>
              <span className="text-[12.5px] text-vg-text-3 flex items-center gap-1.5">
                <FlaskConical size={13} aria-hidden="true" />
                Demo data
              </span>
            </div>
            <div className="px-5 py-5 flex items-center gap-4 border-b border-vg-line-soft">
              <button
                type="button"
                onClick={play}
                aria-label="Play voice sample"
                aria-pressed={playing}
                className={cn('w-12 h-12 rounded-full bg-vg-accent text-vg-ink flex items-center justify-center shrink-0 hover:brightness-110', focusRing)}
              >
                <Mic size={20} />
              </button>
              <div className="flex-1">
                <div className="h-1.5 rounded-full bg-vg-surface-3 overflow-hidden">
                  <div className="voice-prog h-full w-full bg-vg-accent origin-left" />
                </div>
                <div className="mt-2 flex justify-between text-[12px] text-vg-text-3 tabular-nums">
                  <span>Sample recording</span>
                  <span>0:04</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-b border-vg-line-soft">
              <p className="text-[12.5px] text-vg-text-3">Transcript · Whisper large v3 turbo</p>
              <p ref={transcriptRef} className="mt-1.5 font-read text-[18px] leading-[26px] min-h-[52px]">
                {VOICE_TRANSCRIPT}
              </p>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-3 text-[12.5px] text-vg-text-3">
                <span>Refunds (USD), Q3 2026</span>
                <span>
                  Model <span className="voice-model font-code text-vg-text-2">{model.name}</span>
                </span>
              </div>
              <div role="img" aria-label={refundsLabel} className="mt-3 flex flex-col gap-2 text-[13px]">
                {REFUNDS.map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-vg-text-2">{r.label}</span>
                    <div className="flex-1 h-5 flex items-center">
                      <div
                        className="v-bar h-full rounded-r-[3px] bg-vg-clay origin-left"
                        style={{ width: `${(r.value / REFUND_SCALE) * 100}%` }}
                      />
                      <span className="ml-2 tabular-nums">{usd(r.value)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
