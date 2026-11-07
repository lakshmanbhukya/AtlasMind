import { useRef } from 'react';
import { Cpu, Mic, Scale, ShieldCheck } from 'lucide-react';
import ConnectForm from './ConnectForm';
import HeroDemoCard from './HeroDemoCard';
import { MOTION_OK, gsap, useGSAP } from './motion';

const SIGNAL_POINTS = Array.from({ length: 25 }, (_, i) => `${i * 120},${258 - i * 8.5 - (i % 2 ? 20 : 0)}`).join(' ');

const TRUST = [
  { icon: Scale, label: 'MIT licensed' },
  { icon: ShieldCheck, label: 'Read-only queries', accent: true },
  { icon: Mic, label: 'Voice input' },
  { icon: Cpu, label: '5 models via Groq' },
];

export default function Hero({ onConnected }) {
  const scope = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from('.hero-rise', { y: 18, autoAlpha: 0, duration: 0.6, stagger: 0.09, ease: 'power3.out' });
        gsap.fromTo(
          '.hero-form',
          { clipPath: 'inset(0 100% 0 0 round 14px)' },
          { clipPath: 'inset(0 0% 0 0 round 14px)', duration: 0.42, ease: 'power2.out', delay: 0.15, clearProps: 'clipPath' }
        );
        gsap.from('.hero-cta', { scale: 0.98, duration: 0.25, delay: 0.55 });
        gsap.to('.hero-signal', { x: -1440, duration: 26, ease: 'none', repeat: -1 });
        gsap.fromTo(
          '.hero-card-stage .hero-card',
          { clipPath: 'inset(0 0 100% 0)' },
          { clipPath: 'inset(0 0 0% 0)', duration: 0.45, ease: 'power2.out', delay: 0.2, clearProps: 'clipPath' }
        );
      });
      mm.add(`${MOTION_OK} and (min-width: 1024px)`, () => {
        gsap.fromTo(
          '.hero-card-stage .hero-card',
          { rotateX: 16, scale: 0.93, y: 30, transformOrigin: '50% 0%' },
          {
            rotateX: 0, scale: 1, y: 0, ease: 'none',
            scrollTrigger: { trigger: scope.current, start: 'top top', end: '+=440', scrub: 0.6 },
          }
        );
      });
      return () => mm.revert();
    },
    { scope }
  );

  return (
    <section
      ref={scope}
      id="product"
      data-nav="product"
      className="relative overflow-hidden px-5 md:px-10 lg:px-20 pt-24 md:pt-32 lg:pt-[170px] pb-24 lg:pb-[150px] scroll-mt-[72px]"
    >
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        <defs>
          <pattern id="vgGrid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="#E9EFE9" strokeOpacity="0.05" strokeWidth="1" />
          </pattern>
          <radialGradient id="vgFade" cx="50%" cy="22%" r="55%">
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="vgMask">
            <rect width="100%" height="100%" fill="url(#vgFade)" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#vgGrid)" mask="url(#vgMask)" />
        <polyline className="hero-signal" points={SIGNAL_POINTS} fill="none" stroke="#4FC79B" strokeOpacity="0.1" strokeWidth="1.5" />
        <g stroke="#E9EFE9" strokeOpacity="0.18" className="hidden lg:block">
          <path d="M80 18v12M74 24h12" />
          <path d="M1360 18v12M1354 24h12" />
        </g>
      </svg>

      <div className="relative w-full max-w-[1280px] mx-auto">
        <div className="flex flex-col items-center text-center">
          <h1 className="hero-rise font-read text-[52px] leading-[56px] md:text-[72px] md:leading-[78px] lg:text-[92px] lg:leading-[96px] font-normal tracking-[-0.025em]">
            Talk to your data.
          </h1>
          <p className="hero-rise mt-5 max-w-[560px] text-[17px] md:text-[18px] leading-[28px] text-vg-text-2">
            Ask MongoDB questions in plain English. Get a chart and the aggregation pipeline that produced it.
          </p>
        </div>

        <ConnectForm onConnected={onConnected} />

        <ul className="hero-rise mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-vg-text-3">
          {TRUST.map(({ icon: Icon, label, accent }) => (
            <li key={label} className="flex items-center gap-1.5">
              <Icon size={14} className={accent ? 'text-vg-accent' : undefined} aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>

        <div className="hero-card-stage [perspective:1600px] mt-20 lg:mt-[150px]">
          <HeroDemoCard />
        </div>
      </div>
    </section>
  );
}
