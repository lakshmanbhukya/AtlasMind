import { useMemo } from 'react';
import { cn } from '../../../lib/utils';
import { formatPipelineLines } from '../../../lib/pipelineFormat';

/* Operators bright, strings in the code-string tint, everything else text-2 (matches the chat designs). */
const TOKEN_RE = /("(?:[^"\\]|\\.)*")|(\$\$?[A-Za-z_][\w]*)/g;

function tokenize(text) {
  const out = [];
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      m[1] ? (
        <span key={m.index} className="text-[var(--vg-code-str)]">{m[0]}</span>
      ) : (
        <span key={m.index} className="text-vg-text font-medium">{m[0]}</span>
      )
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Line-numbered pipeline. `markLine` (index into the formatted lines) gets a
 * highlighted row and the `marker` node at its right edge.
 *
 * Pass either `lines` (from formatPipelineLines) or `collection` + `pipeline`.
 */
export default function PipelineLines({ lines: givenLines, collection, pipeline, markLine = -1, marker, label, className }) {
  const lines = useMemo(
    () => givenLines || formatPipelineLines(collection, pipeline),
    [givenLines, collection, pipeline]
  );

  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn('font-code text-[12.5px] leading-[19px] py-3 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vg-accent', className)}
    >
      <div className="min-w-max">
        {lines.map((line, i) => {
          const marked = i === markLine;
          return (
            <div key={i} className={cn('flex items-center min-h-[22px]', marked && 'bg-vg-surface-2')}>
              <span aria-hidden="true" className="w-10 shrink-0 pr-3 text-right text-vg-text-3 select-none">{i + 1}</span>
              <span className="flex-1 whitespace-pre text-vg-text-2 pr-4">{tokenize(line.text)}</span>
              {marked && marker && (
                <span className="sticky right-0 pl-3 pr-3 flex items-center gap-1.5 text-[12px] font-ui text-vg-text bg-vg-surface-2 whitespace-nowrap">
                  {marker}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
