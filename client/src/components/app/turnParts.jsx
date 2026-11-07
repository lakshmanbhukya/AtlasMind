import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';

/** Title row shared by every assistant turn: icon + heading on the left, state on the right. */
export function TurnTitle({ icon: Icon, iconClass = 'text-vg-text-2', title, aside, as: Tag = 'h2', id }) {
  return (
    <div className="min-h-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <Tag id={id} className="flex items-center gap-2.5 text-[20px] leading-8 font-semibold tracking-[-0.01em] text-vg-text">
        {Icon && <Icon size={19} className={cn('shrink-0', iconClass)} aria-hidden="true" />}
        {title}
      </Tag>
      {aside && <div className="text-[13px] text-vg-text-3 flex items-center gap-1.5">{aside}</div>}
    </div>
  );
}

/** "Copy" ghost button that confirms for 1.5s. */
export function CopyButton({ text, label = 'Copy', className }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be unavailable on http; nothing to do */
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn('h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[13px] text-vg-text-2 hover:bg-vg-surface-2 hover:text-vg-text transition-colors', focusRing, className)}
    >
      {copied ? <Check size={14} className="text-vg-accent" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}

const BUTTON_VARIANTS = {
  primary: 'bg-vg-accent text-vg-ink font-semibold hover:bg-[#62D3AA] disabled:bg-vg-surface-3 disabled:text-vg-text-3',
  outline: 'border border-vg-line text-vg-text hover:bg-vg-surface disabled:text-vg-text-3',
  ghost: 'text-vg-text-2 hover:bg-vg-surface hover:text-vg-text disabled:text-vg-text-3',
};

export function TurnButton({ variant = 'ghost', className, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'h-10 px-4 rounded-lg text-[14px] flex items-center gap-2 transition-colors disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        focusRing,
        className
      )}
    >
      {children}
    </button>
  );
}

/** Bordered surface card used by figures, pipelines and forms. */
export function SurfaceCard({ as: Tag = 'div', className, children, ...props }) {
  return (
    <Tag {...props} className={cn('rounded-xl border border-vg-line bg-vg-surface', className)}>
      {children}
    </Tag>
  );
}

/** Card header strip (h-10) with a bottom hairline. */
export function CardHeader({ className, children }) {
  return (
    <div className={cn('min-h-10 pl-4 pr-2 flex items-center justify-between gap-3 border-b border-vg-line-soft', className)}>
      {children}
    </div>
  );
}

/** Wraps known field names (and `backticked` spans) of a sentence in code font. */
export function CodeAwareText({ text, fields = [] }) {
  const source = String(text || '');
  if (!source) return null;
  const escaped = fields
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = ['`([^`]+)`'];
  if (escaped.length) parts.push(`(?<![\\w.])(${escaped.join('|')})(?![\\w])`);
  const re = new RegExp(parts.join('|'), 'g');

  const out = [];
  const seen = new Set();
  let last = 0;
  let m;
  while ((m = re.exec(source))) {
    // Field names are code-formatted on first mention only, so prose ("the largest region") stays prose.
    if (m[2] && seen.has(m[2])) continue;
    if (m[2]) seen.add(m[2]);
    if (m.index > last) out.push(source.slice(last, m.index));
    out.push(
      <code key={m.index} className="font-code text-[13px] text-vg-text-2">{m[1] || m[2]}</code>
    );
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}
