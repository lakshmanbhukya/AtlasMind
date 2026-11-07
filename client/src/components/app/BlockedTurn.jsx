import { useId, useMemo, useRef, useState } from 'react';
import { Ban, Pencil, ChevronRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDismiss } from '../../hooks/useDismiss';
import { focusRing } from '../ui/vg/primitives';
import PipelineLines from '../ui/vg/PipelineLines';
import { formatPipelineLines, findMarkedLine, pipelineToText } from '../../lib/pipelineFormat';
import { TurnTitle, TurnButton, CopyButton, SurfaceCard, CardHeader } from './turnParts';

const RULE_LABELS = {
  protected_collection: 'Protected collection',
  out_of_scope_collection: 'Outside workspace scope',
  invalid_collection: 'Invalid collection name',
  hard_blocked_operator: 'Code execution operator',
  blocked_write_operator: 'Mutating operator',
  blocked_write_stage: 'Unapproved write stage',
  restricted_stage: 'Restricted stage',
  malformed_pipeline: 'Malformed pipeline',
};

function referenceLabel(referenceType = '') {
  const t = referenceType.toLowerCase();
  if (t.includes('collection')) return 'Collection';
  if (t.includes('operator')) return 'Operator';
  if (t.includes('stage')) return 'Stage';
  return 'Reference';
}

function Field({ label, children, code }) {
  return (
    <div className="bg-vg-bg px-4 py-3 min-w-0">
      <dt className="text-[12px] text-vg-text-3">{label}</dt>
      <dd className={code ? 'mt-1 font-code text-[13px] text-vg-text break-words' : 'mt-1 text-[14px] text-vg-text'}>{children}</dd>
    </div>
  );
}

function SafetyDetails({ block, reason }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const popId = useId();

  useDismiss(open, () => setOpen(false), {
    insideRefs: [ref],
    onEscape: () => {
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    },
  });

  return (
    <div className="relative" ref={ref}>
      <TurnButton variant="ghost" className="px-3.5 gap-1.5" aria-expanded={open} aria-controls={popId} onClick={() => setOpen((o) => !o)}>
        Safety details
        <ChevronRight size={14} className={cn('text-vg-text-3 transition-transform', open && 'rotate-90')} aria-hidden="true" />
      </TurnButton>
      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label="Safety details"
          className="absolute left-0 bottom-12 z-30 w-[min(420px,calc(100vw-48px))] rounded-xl border border-vg-line bg-[var(--vg-menu)] shadow-[0_16px_40px_rgba(0,0,0,0.65)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[14px] font-medium text-vg-text">{RULE_LABELS[block?.code] || 'Safety guard'}</p>
            <button type="button" aria-label="Close safety details" onClick={() => setOpen(false)} className={cn('w-7 h-7 -mt-1 -mr-1 rounded-md flex items-center justify-center text-vg-text-3 hover:bg-vg-surface-2 hover:text-vg-text', focusRing)}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {block?.rule && <p className="mt-2 text-[13.5px] leading-5 text-vg-text-2">{block.rule}</p>}
          <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            {block?.stage && (
              <>
                <dt className="text-vg-text-3">Stage</dt>
                <dd className="font-code text-vg-text">{block.stage}{block.stageIndex !== null && block.stageIndex !== undefined ? ` (index ${block.stageIndex})` : ''}</dd>
              </>
            )}
            {block?.reference && (
              <>
                <dt className="text-vg-text-3">Reference</dt>
                <dd className="font-code text-vg-text break-all">{block.reference}</dd>
              </>
            )}
            <dt className="text-vg-text-3">Guard message</dt>
            <dd className="font-code text-vg-text break-words">{reason}</dd>
          </dl>
          <p className="mt-3 text-[12.5px] text-vg-text-3">The pipeline was rejected before reaching the database. Nothing was read or written.</p>
        </div>
      )}
    </div>
  );
}

/** Pipeline rejected by the safety guard: the rule, the reason, and the attempted pipeline with the offending line marked. */
export default function BlockedTurn({ message, onEditQuestion }) {
  const idPrefix = useId().replace(/:/g, '');
  const block = message.safetyBlock || {};
  const reason = block.reason || message.errorMessage || message.content;
  const hasPipeline = Array.isArray(message.pipeline) && message.pipeline.length > 0;

  const lines = useMemo(() => formatPipelineLines(message.collection, message.pipeline), [message.collection, message.pipeline]);
  const markLine = useMemo(
    () => findMarkedLine(lines, { stageIndex: block.stageIndex ?? null, reference: block.reference }),
    [lines, block.stageIndex, block.reference]
  );

  return (
    <article className="flex flex-col" aria-labelledby={`${idPrefix}-title`}>
      <TurnTitle id={`${idPrefix}-title`} icon={Ban} iconClass="text-vg-red" title="Query blocked" aside="Not run" />

      <div className="mt-4 border-y border-vg-line">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-vg-line-soft">
          <Field label="Reference type">{block.referenceType ? referenceLabel(block.referenceType) : 'Pipeline'}</Field>
          <Field label={referenceLabel(block.referenceType)} code>{block.reference || '—'}</Field>
          <Field label="Rule">{RULE_LABELS[block.code] || 'Safety guard'}</Field>
          <Field label="Code" code>{block.code || message.errorCode || 'safety_violation'}</Field>
        </dl>
        <div className="px-4 py-3 border-t border-vg-line-soft flex items-start sm:items-center gap-3">
          <span className="text-[12px] text-vg-text-3 w-[64px] shrink-0">Reason</span>
          <span className="font-code text-[13px] text-vg-text break-words min-w-0">{reason}</span>
        </div>
      </div>

      {hasPipeline && (
        <SurfaceCard className="mt-5">
          <CardHeader>
            <span className="flex items-center gap-2 text-[13.5px] text-vg-text">
              Attempted pipeline
              {message.collection && <span className="font-code text-[12px] text-vg-text-3">{message.collection}</span>}
            </span>
            <CopyButton text={pipelineToText(message.collection, message.pipeline)} />
          </CardHeader>
          <PipelineLines
            lines={lines}
            markLine={markLine}
            label="Attempted pipeline"
            marker={
              <>
                <Ban size={13} className="text-vg-red" aria-hidden="true" />
                Blocked reference
              </>
            }
          />
        </SurfaceCard>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {onEditQuestion && message.naturalLanguage && (
          <TurnButton variant="outline" onClick={() => onEditQuestion(message.naturalLanguage)}>
            <Pencil size={15} className="text-vg-text-2" aria-hidden="true" />
            Edit question
          </TurnButton>
        )}
        <SafetyDetails block={block} reason={reason} />
      </div>
    </article>
  );
}
