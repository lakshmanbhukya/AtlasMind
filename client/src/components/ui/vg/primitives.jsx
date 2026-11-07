import { Leaf, ShieldCheck, TriangleAlert, Ban } from 'lucide-react';
import { cn } from '../../../lib/utils';

/* ── MQL token colouring ────────────────────────────────────────── */

const TOKEN_RE = /(ISODate\("[^"]*"\))|("(?:[^"\\]|\\.)*")|(\$[A-Za-z_]+)|((?<![\w$.])-?\d+(?:\.\d+)?)|([{}[\]]+(?:\s+[{}[\]]+)*)/g;
const TOKEN_CLASS = ['text-[var(--vg-tok-str)]', 'text-[var(--vg-tok-str)]', 'text-[var(--vg-tok-key)]', 'text-[var(--vg-tok-num)]', 'text-vg-text-3'];

/**
 * Splits one line of MQL into coloured spans. Any occurrence of `mark`
 * (e.g. the chosen date field) also gets `markClass`, so it can be animated.
 */
function tokenize(line, mark, markClass) {
  const out = [];
  let last = 0;
  let m;
  const plain = (text, key) => {
    if (!mark || !text.includes(mark)) return text;
    return text.split(mark).flatMap((part, i) =>
      i === 0 ? [part] : [<span key={`${key}-${i}`} className={markClass}>{mark}</span>, part]
    );
  };
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line))) {
    if (m.index > last) out.push(plain(line.slice(last, m.index), `p${last}`));
    const group = m.slice(1).findIndex(Boolean);
    const marked = mark && m[0].includes(mark);
    out.push(
      <span key={m.index} className={cn(TOKEN_CLASS[group], marked && markClass)}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(plain(line.slice(last), `p${last}`));
  return out;
}

/**
 * Monospace pipeline block. `lineNumbers` adds a gutter; `lineClassName`
 * lets a parent target each line for stagger animations.
 */
export function PipelineCode({ code, lineNumbers = false, className, lineClassName, label, mark, markClass }) {
  const lines = code.split('\n');
  return (
    <pre
      aria-label={label}
      className={cn('font-code whitespace-pre overflow-x-auto overflow-y-hidden', className)}
    >
      <code>
        {lines.map((line, i) => (
          <div key={i} className={lineClassName}>
            {lineNumbers && (
              <span aria-hidden="true" data-ln={i + 1} className="inline-block w-6 select-none text-vg-muted before:content-[attr(data-ln)]" />
            )}
            {tokenize(line, mark, markClass)}
          </div>
        ))}
      </code>
    </pre>
  );
}

/* ── Controls ───────────────────────────────────────────────────── */

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vg-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vg-bg';

/** Row of tabs. `variant="segmented"` wraps them in the pill track used by the execution path. */
export function SegmentedTabs({ items, value, onChange, label, variant = 'plain', idPrefix, className }) {
  const onKeyDown = (e) => {
    const i = items.findIndex((t) => t.id === value);
    let next = null;
    if (e.key === 'ArrowRight') next = items[(i + 1) % items.length];
    if (e.key === 'ArrowLeft') next = items[(i - 1 + items.length) % items.length];
    if (e.key === 'Home') next = items[0];
    if (e.key === 'End') next = items[items.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    e.currentTarget.querySelector(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-center',
        variant === 'segmented' ? 'p-1 rounded-xl bg-vg-bg border border-vg-line gap-0' : 'gap-1',
        className
      )}
    >
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-lg text-[13.5px] transition-colors',
              variant === 'segmented' ? 'h-9 px-3.5' : 'h-10 px-3.5',
              on
                ? variant === 'segmented'
                  ? 'bg-vg-surface-3 text-vg-text'
                  : 'bg-vg-surface-2 text-vg-text'
                : 'text-vg-text-2 hover:text-vg-text',
              focusRing
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Radio indicator used by the clarification options and model rows. */
export function RadioDot({ on }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors',
        on ? 'border-vg-accent' : 'border-vg-muted'
      )}
    >
      {on && <span className="w-1.5 h-1.5 rounded-full bg-vg-accent" />}
    </span>
  );
}

const PILL_TONES = {
  accent: { cls: 'bg-vg-accent-wash text-vg-accent', Icon: ShieldCheck },
  amber: { cls: 'bg-[color-mix(in_srgb,var(--vg-amber)_14%,transparent)] text-vg-amber', Icon: TriangleAlert },
  red: { cls: 'bg-vg-red-wash text-vg-red', Icon: Ban },
};

/** Small status pill. `tone` picks the colour and icon (accent = verified, amber = needs approval, red = blocked). */
export function StatusPill({ className, children = 'Read-only verified', tone = 'accent', icon }) {
  const t = PILL_TONES[tone] || PILL_TONES.accent;
  const Icon = icon || t.Icon;
  return (
    <span
      className={cn(
        'h-7 px-2.5 rounded-full inline-flex items-center gap-1.5 text-[12.5px]',
        t.cls,
        className
      )}
    >
      <Icon size={13} aria-hidden="true" />
      {children}
    </span>
  );
}

export function LogoMark({ size = 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-vg-accent flex items-center justify-center text-vg-ink',
        size === 'md' ? 'w-7 h-7 rounded-lg' : 'w-6 h-6 rounded-md'
      )}
    >
      <Leaf size={size === 'md' ? 15 : 12} strokeWidth={2.2} />
    </span>
  );
}
