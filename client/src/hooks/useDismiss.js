import { useEffect, useRef } from 'react';

/**
 * Dismiss a popover/drawer while `open`: on a mousedown outside every ref in
 * `insideRefs` and/or on Escape. Pass `onEscape` to handle Escape differently
 * (for example to return focus to the trigger); it defaults to `onDismiss`.
 */
export function useDismiss(open, onDismiss, { insideRefs = [], outside = true, escape = true, onEscape } = {}) {
  const latest = useRef({ onDismiss, onEscape, insideRefs });
  useEffect(() => {
    latest.current = { onDismiss, onEscape, insideRefs };
  });

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const { insideRefs: refs, onDismiss: dismiss } = latest.current;
      if (refs.some((r) => r.current?.contains(e.target))) return;
      dismiss();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const { onEscape: esc, onDismiss: dismiss } = latest.current;
      (esc || dismiss)(e);
    };
    if (outside) document.addEventListener('mousedown', onDown);
    if (escape) document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, outside, escape]);
}
