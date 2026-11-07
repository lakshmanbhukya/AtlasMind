import ChartRenderer from '../ChartRenderer';
import { barSeries, niceTicks, formatNumber, formatCompact, humanizeKey } from '../../lib/turnFormat';

/**
 * Answer chart. Up to 12 category rows with a single measure render as the
 * horizontal bar list from the design; anything else falls back to ChartRenderer.
 */
export default function TurnChart({ results, chartType }) {
  const series = barSeries(results, chartType);

  if (!series) {
    return (
      <div className="px-2 pt-3 pb-2">
        <ChartRenderer data={results} chartType={chartType && chartType !== 'table' ? chartType : 'bar'} />
      </div>
    );
  }

  const { rows, money, valueKey } = series;
  const max = Math.max(...rows.map((r) => r.value));
  const { max: axisMax, ticks } = niceTicks(max);
  const pct = (v) => `${(v / axisMax) * 100}%`;
  const axisTitle = `${humanizeKey(valueKey)}${money ? ', USD' : ''}`;

  return (
    <div className="pl-3 sm:pl-5 pr-4 sm:pr-6 pt-4 pb-3 flex">
      <table className="sr-only">
        <caption>{axisTitle}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}><th scope="row">{r.label}</th><td>{formatNumber(r.value, { money })}</td></tr>
          ))}
        </tbody>
      </table>

      <div aria-hidden="true" className="w-[112px] sm:w-[176px] shrink-0 flex flex-col">
        {rows.map((r) => (
          <span key={r.label} title={r.label} className="block h-9 leading-9 text-right pr-3 sm:pr-4 text-[13.5px] text-vg-text-2 truncate">
            {r.label}
          </span>
        ))}
      </div>

      <div aria-hidden="true" className="flex-1 min-w-0 mr-[72px] sm:mr-[96px] flex flex-col">
        <div className="relative">
          {ticks.map((t, i) => (
            <div
              key={t}
              className={i === 0 ? 'absolute top-0 bottom-0 w-px bg-vg-line' : 'absolute top-0 bottom-0 w-px bg-vg-line-soft'}
              style={{ left: pct(t) }}
            />
          ))}
          <div className="relative flex flex-col">
            {rows.map((r) => (
              <div key={r.label} className="h-9 flex items-center">
                <div className="h-5 rounded-r-[4px] bg-vg-accent" style={{ width: pct(r.value), minWidth: r.value > 0 ? 2 : 0 }} />
                <span className="ml-2.5 font-code text-[12px] text-vg-text whitespace-nowrap">{formatNumber(r.value, { money })}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-2 h-4">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={`absolute text-[11.5px] font-code text-vg-text-3 whitespace-nowrap ${i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full sm:-translate-x-1/2' : '-translate-x-1/2'} ${i % 2 === 1 ? 'hidden sm:inline' : ''}`}
              style={{ left: pct(t) }}
            >
              {formatCompact(t, { money })}
            </span>
          ))}
        </div>
        <span className="mt-2 text-center text-[11.5px] text-vg-text-3">{axisTitle}</span>
      </div>
    </div>
  );
}
