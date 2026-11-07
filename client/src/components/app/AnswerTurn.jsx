import { useId, useMemo, useState } from 'react';
import { ChartBarBig, ChartLine, ChartPie, ChartArea, Table2, CircleCheck, Pin, PinOff, ChevronDown, Download, SearchX } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import PipelineLines from '../ui/vg/PipelineLines';
import { pipelineToText } from '../../lib/pipelineFormat';
import { answerTitle, singleColumnTotal, formatNumber, pipelineFieldNames, resultShape, flattenValue } from '../../lib/turnFormat';
import { downloadCsv } from '../../lib/csv';
import TurnChart from './TurnChart';
import { TurnTitle, CopyButton, SurfaceCard, CardHeader, CodeAwareText } from './turnParts';

const CHART_ICONS = { bar: ChartBarBig, line: ChartLine, area: ChartArea, pie: ChartPie, table: Table2 };

function cellText(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') return formatNumber(val);
  return String(flattenValue(val));
}

function ResultTable({ results }) {
  const { columns } = resultShape(results);
  return (
    <div className="max-h-[360px] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vg-accent" tabIndex={0} role="region" aria-label="Result rows">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className={cn('sticky top-0 bg-vg-surface font-medium text-[12px] text-vg-text-3 px-4 h-9 border-b border-vg-line-soft whitespace-nowrap', typeof results[0][c] === 'number' ? 'text-right' : 'text-left')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => (
            <tr key={i} className="border-b border-vg-line-soft last:border-0 hover:bg-vg-surface-2/60">
              {columns.map((c) => {
                const isNum = typeof row[c] === 'number';
                return (
                  <td key={c} className={cn('px-4 h-9 whitespace-nowrap', isNum ? 'font-code text-[12.5px] text-vg-text text-right' : 'text-vg-text-2')}>
                    {cellText(row[c])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewSwitch({ value, onChange, idPrefix }) {
  const items = [
    { id: 'chart', label: 'Chart', Icon: ChartBarBig },
    { id: 'table', label: 'Table', Icon: Table2 },
  ];
  const onKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = value === 'chart' ? 'table' : 'chart';
    onChange(next);
    e.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Result view" onKeyDown={onKeyDown} className="h-7 p-0.5 rounded-md bg-vg-bg flex text-[13px]">
      {items.map(({ id, label, Icon }) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            data-tab={id}
            id={`${idPrefix}-tab-${id}`}
            aria-controls={`${idPrefix}-panel`}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              'h-6 px-2.5 rounded-[5px] flex items-center gap-1.5 transition-colors',
              on ? 'bg-vg-surface-2 text-vg-text' : 'text-vg-text-3 hover:text-vg-text-2',
              focusRing
            )}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Successful read (or an approved write that ran): result figure, explanation, generated pipeline. */
export default function AnswerTurn({ message, onPin }) {
  const idPrefix = useId().replace(/:/g, '');
  const results = useMemo(() => (Array.isArray(message.results) ? message.results : []), [message.results]);
  const hasResults = results.length > 0;
  const [view, setView] = useState(message.chartType === 'table' ? 'table' : 'chart');
  const [pipelineOpen, setPipelineOpen] = useState(true);
  const [pinState, setPinState] = useState('idle'); // idle | saving | pinned | error

  const isWrite = message.safetyStatus === 'write-executed';
  const question = message.naturalLanguage || message.content;
  const title = isWrite ? 'Write executed' : answerTitle(question);
  const TitleIcon = isWrite ? CircleCheck : CHART_ICONS[message.chartType] || ChartBarBig;
  const total = useMemo(() => (hasResults ? singleColumnTotal(results) : null), [results, hasResults]);
  const fields = useMemo(() => pipelineFieldNames(message.pipeline), [message.pipeline]);
  const explanation = message.explanation || (message.content !== question ? message.content : '');
  const pipelineText = useMemo(() => pipelineToText(message.collection, message.pipeline), [message.collection, message.pipeline]);
  const hasPipeline = Array.isArray(message.pipeline) && message.pipeline.length > 0;

  const handlePin = async () => {
    if (!onPin || pinState === 'saving' || pinState === 'pinned') return;
    setPinState('saving');
    try {
      await onPin({
        query: question,
        chartType: view === 'table' ? 'table' : (message.chartType === 'table' ? 'bar' : message.chartType),
        results,
        collection: message.collection,
        pipeline: message.pipeline,
      });
      setPinState('pinned');
    } catch {
      setPinState('error');
    }
  };

  return (
    <article className="flex flex-col" aria-labelledby={`${idPrefix}-title`}>
      <TurnTitle
        id={`${idPrefix}-title`}
        icon={TitleIcon}
        iconClass={isWrite ? 'text-vg-accent' : 'text-vg-text-2'}
        title={title}
        aside={
          <span className="flex items-center gap-1.5 text-vg-text-2">
            <CircleCheck size={15} className="text-vg-accent" aria-hidden="true" />
            {isWrite ? 'Approved write executed' : 'Read-only verified'}
          </span>
        }
      />

      {hasResults ? (
        <SurfaceCard as="figure" className="mt-3 overflow-hidden">
          <div className="min-h-10 px-2 py-1.5 flex flex-wrap items-center justify-between gap-2 border-b border-vg-line-soft">
            <ViewSwitch value={view} onChange={setView} idPrefix={idPrefix} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[12.5px] text-vg-text-3">
                {results.length} {results.length === 1 ? 'row' : 'rows'}
              </span>
              {total && (
                <>
                  <span aria-hidden="true" className="w-px h-4 bg-vg-line" />
                  <span className="text-[12.5px] text-vg-text-3">
                    Total <span className="font-code text-vg-text-2">{formatNumber(total.total, { money: total.money })}</span>
                  </span>
                </>
              )}
              {view === 'table' && (
                <button
                  type="button"
                  onClick={() => downloadCsv(results, `${(message.collection || 'results')}-${Date.now()}.csv`)}
                  className={cn('h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[13px] text-vg-text-2 hover:bg-vg-surface-2 hover:text-vg-text', focusRing)}
                >
                  <Download size={14} aria-hidden="true" />
                  Export CSV
                </button>
              )}
              {onPin && !isWrite && (
                <button
                  type="button"
                  onClick={handlePin}
                  disabled={pinState === 'saving' || pinState === 'pinned'}
                  className={cn(
                    'h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[13px] hover:bg-vg-surface-2 disabled:hover:bg-transparent',
                    pinState === 'pinned' ? 'text-vg-accent' : 'text-vg-text',
                    focusRing
                  )}
                >
                  {pinState === 'pinned' ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
                  <span aria-live="polite">
                    {pinState === 'pinned' ? 'Pinned' : pinState === 'saving' ? 'Pinning…' : pinState === 'error' ? 'Pin failed, retry' : 'Pin to dashboard'}
                  </span>
                </button>
              )}
            </div>
          </div>
          <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${view}`}>
            {view === 'chart' ? (
              <TurnChart results={results} chartType={message.chartType} />
            ) : (
              <ResultTable results={results} />
            )}
          </div>
        </SurfaceCard>
      ) : (
        hasPipeline && (
          <SurfaceCard className="mt-3 px-4 py-3.5 flex items-start gap-3">
            <SearchX size={17} className="mt-0.5 shrink-0 text-vg-text-3" aria-hidden="true" />
            <div>
              <p className="text-[14px] font-medium text-vg-text">{isWrite ? 'The write ran and returned no rows' : 'No matching documents'}</p>
              {!isWrite && (
                <p className="mt-1 text-[13.5px] leading-5 text-vg-text-2">
                  The pipeline ran without errors but matched 0 documents. Check the field names and filters in the pipeline below, or rephrase with exact field names.
                </p>
              )}
            </div>
          </SurfaceCard>
        )
      )}

      {explanation && (
        <div className="mt-5">
          <p className="font-read text-[16px] leading-6 text-vg-text max-w-[760px]">
            <CodeAwareText text={explanation} fields={fields} />
          </p>
        </div>
      )}

      {hasPipeline && (
        <SurfaceCard className="mt-5">
          <CardHeader className={cn(!pipelineOpen && 'border-b-0')}>
            <button
              type="button"
              aria-expanded={pipelineOpen}
              aria-controls={`${idPrefix}-pipeline`}
              onClick={() => setPipelineOpen((o) => !o)}
              className={cn('flex items-center gap-2 text-[13.5px] text-vg-text rounded-md', focusRing)}
            >
              <ChevronDown size={14} className={cn('text-vg-text-3 transition-transform', !pipelineOpen && '-rotate-90')} aria-hidden="true" />
              Generated pipeline
              {message.collection && <span className="font-code text-[12px] text-vg-text-3">{message.collection}</span>}
            </button>
            <CopyButton text={pipelineText} />
          </CardHeader>
          {pipelineOpen && (
            <div id={`${idPrefix}-pipeline`}>
              <PipelineLines collection={message.collection} pipeline={message.pipeline} label="Generated pipeline" />
            </div>
          )}
        </SurfaceCard>
      )}
    </article>
  );
}
