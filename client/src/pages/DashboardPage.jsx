import { useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import InsightDashboard from '../components/InsightDashboard';

const EXIT_MS = 180;

// Inlined rather than imported from landing/motion.js, which pulls in GSAP.
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Dashboards view: every chart pinned from an answer. */
export default function DashboardPage({ pins = [], onRemovePin, isLoading }) {
  // Ids fading out; the pin is removed once the fade finishes.
  const [removing, setRemoving] = useState(() => new Set());

  const removeWithFade = (id) => {
    setRemoving((prev) => new Set(prev).add(id));
    setTimeout(async () => {
      try {
        await onRemovePin(id);
      } finally {
        // On failure the pin is still listed, so it fades back in.
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }, prefersReducedMotion() ? 0 : EXIT_MS);
  };

  return (
    <section aria-labelledby="dashboards-title" className="flex-1 min-h-0 overflow-y-auto font-ui">
      <div className="w-full max-w-[1200px] mx-auto px-4 sm:px-6 pt-5 pb-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="dashboards-title" className="flex items-center gap-2.5 text-[20px] leading-8 font-semibold tracking-[-0.01em] text-vg-text">
            <LayoutDashboard size={19} className="text-vg-text-2" aria-hidden="true" />
            Dashboards
          </h1>
          <span className="text-[13px] text-vg-text-3">
            {pins.length} {pins.length === 1 ? 'pinned chart' : 'pinned charts'}
          </span>
        </header>

        {isLoading && pins.length === 0 ? (
          <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-5" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-[400px] rounded-xl border border-vg-line-soft bg-vg-surface/60 vg-shimmer" />
            ))}
          </div>
        ) : pins.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-vg-line px-6 py-16 flex flex-col items-center text-center">
            <LayoutDashboard size={28} className="text-vg-text-3" aria-hidden="true" />
            <h2 className="mt-4 text-[16px] font-medium text-vg-text">No pinned charts</h2>
            <p className="mt-1.5 max-w-[420px] text-[14px] leading-5 text-vg-text-2">
              Ask a question in a new query, then use Pin to dashboard on the answer to keep its chart here.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-5">
            {pins.map((pin) => {
              const id = pin._id || pin.id;
              return (
                <div
                  key={id}
                  className={`vg-enter relative group transition-[opacity,transform] duration-[180ms] motion-reduce:transition-none ${
                    removing.has(id) ? 'opacity-0 scale-[0.97] pointer-events-none' : ''
                  }`}
                >
                  <InsightDashboard
                    data={pin.results}
                    type={pin.chartType || 'bar'}
                    title={pin.chartTitle || pin.queryText || pin.query || 'Untitled'}
                    pinId={id}
                    shared={Boolean(pin.shared)}
                    onRemove={() => removeWithFade(id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
