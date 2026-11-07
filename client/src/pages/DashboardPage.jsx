import { LayoutDashboard, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import InsightDashboard from '../components/InsightDashboard';

/** Dashboards view: every chart pinned from an answer. */
export default function DashboardPage({ pins = [], onRemovePin, isLoading }) {
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
            <AnimatePresence>
              {pins.map((pin) => {
                const id = pin._id || pin.id;
                return (
                  <motion.div
                    key={id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.18 }}
                    className="relative group"
                  >
                    <button
                      type="button"
                      onClick={() => onRemovePin(id)}
                      aria-label={`Remove ${pin.chartTitle || pin.queryText || 'chart'} from dashboards`}
                      className="absolute top-4 right-[88px] z-10 w-8 h-8 rounded-md flex items-center justify-center text-vg-text-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-vg-red-wash hover:text-vg-red transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vg-accent"
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                    <InsightDashboard
                      data={pin.results}
                      type={pin.chartType || 'bar'}
                      title={pin.chartTitle || pin.queryText || pin.query || 'Untitled'}
                      pinId={id}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </section>
  );
}
