import { useEffect, useId, useMemo, useState } from 'react';
import { TriangleAlert, KeyRound, Timer, Repeat1, Play, PencilLine, LoaderCircle, CircleAlert, RotateCcw } from 'lucide-react';
import PipelineLines from '../ui/vg/PipelineLines';
import { formatPipelineLines, findMarkedLine, pipelineToText } from '../../lib/pipelineFormat';
import { findMatchDate } from '../../lib/turnFormat';
import { TurnTitle, TurnButton, CopyButton, SurfaceCard, CardHeader } from './turnParts';

function useCountdown(expiresAt) {
  const target = expiresAt ? Date.parse(expiresAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(target)) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.floor((target - now) / 1000));
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function Detail({ label, children, code = true }) {
  return (
    <div className="bg-vg-surface px-4 py-3 min-w-0">
      <dt className="text-[12px] text-vg-text-3">{label}</dt>
      <dd className={code ? 'mt-1 font-code text-[13px] text-vg-text break-words' : 'mt-1 text-[14px] text-vg-text'}>{children}</dd>
    </div>
  );
}

/** Staged $merge/$out: what it would write, the pipeline with the write stage marked, and the token's expiry. */
export default function ApprovalTurn({ message, dbName, onApprove, onDiscard, onAskAgain, isLoading }) {
  const idPrefix = useId().replace(/:/g, '');
  const approval = message.approval || {};
  const remaining = useCountdown(approval.expiresAt);
  const expired = remaining === 0;
  const discarded = Boolean(message.approvalDiscarded);
  const [approving, setApproving] = useState(false);

  const lines = useMemo(() => formatPipelineLines(message.collection, message.pipeline), [message.collection, message.pipeline]);
  const markLine = useMemo(
    () => findMarkedLine(lines, { stageIndex: approval.writeStageIndex ?? null, reference: approval.writeStage }),
    [lines, approval.writeStageIndex, approval.writeStage]
  );
  const cutoff = useMemo(() => findMatchDate(message.pipeline), [message.pipeline]);
  const minutesLeft = remaining === null ? null : Math.ceil(remaining / 60);

  const approve = async () => {
    if (approving || expired || !message.approvalToken) return;
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };

  const state = discarded ? 'Discarded' : expired ? 'Expired, not executed' : 'Staged, not executed';

  return (
    <article className="flex flex-col" aria-labelledby={`${idPrefix}-title`}>
      <TurnTitle id={`${idPrefix}-title`} icon={TriangleAlert} iconClass="text-vg-amber" title="Write approval required" aside={state} />

      <SurfaceCard className="mt-4 overflow-hidden">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-vg-line-soft border-b border-vg-line-soft">
          <Detail label="Database">{dbName || '—'}</Detail>
          <Detail label="Source collection">{approval.sourceCollection || message.collection || '—'}</Detail>
          <Detail label="Destination collection">{approval.targetCollection || '—'}</Detail>
          <Detail label="Write stage">{approval.writeStage || '—'}</Detail>
          {cutoff && <Detail label="Cutoff date" code={false}>{cutoff}</Detail>}
          <Detail label="Fields written">
            {approval.fieldsWritten?.length ? approval.fieldsWritten.join(', ') : 'Whole documents'}
          </Detail>
        </dl>

        <CardHeader>
          <span className="text-[13.5px] text-vg-text">Staged pipeline</span>
          <CopyButton text={pipelineToText(message.collection, message.pipeline)} />
        </CardHeader>
        <PipelineLines
          lines={lines}
          markLine={markLine}
          label="Staged pipeline"
          marker={
            <>
              <PencilLine size={13} className="text-vg-amber" aria-hidden="true" />
              Write stage
            </>
          }
        />

        <div className="min-h-14 px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-vg-line-soft bg-[var(--vg-strip)] text-[13px]">
          <span className="flex items-center gap-2 text-vg-text">
            <KeyRound size={15} className="text-vg-text-2" aria-hidden="true" />
            Write Approval Token
          </span>
          {remaining !== null && !discarded && (
            <span className="flex items-center gap-1.5 text-vg-text-2">
              <Timer size={14} className="text-vg-text-3" aria-hidden="true" />
              {expired ? (
                'Expired'
              ) : (
                <>
                  Expires in <span aria-hidden="true" className="font-code text-[12.5px] text-vg-text tabular-nums">{mmss(remaining)}</span>
                  <span className="sr-only" aria-live="polite">
                    {minutesLeft} {minutesLeft === 1 ? 'minute' : 'minutes'}
                  </span>
                </>
              )}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-vg-text-2">
            <Repeat1 size={14} className="text-vg-text-3" aria-hidden="true" />
            Single use
          </span>
          <span className="sm:ml-auto text-vg-text-3">No changes have been executed.</span>
        </div>
      </SurfaceCard>

      {message.approvalError && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[13.5px] text-vg-red">
          <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {message.approvalError}
        </p>
      )}

      {!discarded && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {expired ? (
            <TurnButton variant="outline" onClick={onAskAgain} disabled={isLoading || !onAskAgain}>
              <RotateCcw size={15} className="text-vg-text-2" aria-hidden="true" />
              Approval expired, ask again
            </TurnButton>
          ) : (
            <TurnButton variant="primary" onClick={approve} disabled={approving || isLoading || !message.approvalToken}>
              {approving ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              {approving ? 'Running…' : 'Approve and run'}
            </TurnButton>
          )}
          <TurnButton variant="outline" onClick={onDiscard} disabled={approving}>
            Discard
          </TurnButton>
        </div>
      )}
    </article>
  );
}
