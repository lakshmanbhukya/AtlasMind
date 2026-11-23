import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { useDismiss } from '../../hooks/useDismiss';

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled])';

/**
 * Popover menu (`role="menu"`): focuses the first (or checked) item on open,
 * Arrow/Home/End move focus, Esc closes and returns focus to the trigger,
 * Tab and outside clicks close it.
 */
export function Menu({ open, onClose, anchorRef, label, className, children, focusChecked = true, beside = false }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (!open || !beside) return;
    const menu = ref.current;
    const anchor = anchorRef.current;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const gap = 8;
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      const fitsRight = rect.right + gap + menu.offsetWidth <= width - gap;
      menu.style.left = `${fitsRight ? rect.right + gap : Math.max(gap, rect.left - gap - menu.offsetWidth)}px`;
      menu.style.top = `${Math.max(gap, Math.min(rect.top, height - menu.offsetHeight - gap))}px`;
    };
    position();
    const visibility = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) onClose();
    });
    visibility.observe(anchor);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      visibility.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, beside, anchorRef, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const el = ref.current;
    const items = el ? [...el.querySelectorAll(ITEM_SELECTOR)] : [];
    const checked = focusChecked ? items.find((i) => i.getAttribute('aria-checked') === 'true') : null;
    (checked || items[0])?.focus();
    return undefined;
  }, [open, focusChecked]);

  useDismiss(open, onClose, { insideRefs: [ref, anchorRef ?? { current: null }], escape: false });

  if (!open) return null;

  const onKeyDown = (e) => {
    const items = [...ref.current.querySelectorAll(ITEM_SELECTOR)];
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchorRef?.current?.focus();
      return;
    } else if (e.key === 'Tab') {
      onClose();
      return;
    }
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const menu = (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'absolute z-40 p-1 rounded-xl border border-vg-line bg-[var(--vg-menu)] shadow-[0_16px_40px_rgba(0,0,0,0.65)] text-vg-text',
        beside && 'fixed z-[60] max-h-[calc(100dvh-16px)] overflow-y-auto',
        className
      )}
    >
      {children}
    </div>
  );
  return beside ? createPortal(menu, document.querySelector('.vg-app') || document.body) : menu;
}

export function MenuItem({ icon: Icon, children, onSelect, danger, role = 'menuitem', checked, className, hint, ...props }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitem' ? undefined : Boolean(checked)}
      tabIndex={-1}
      onClick={onSelect}
      {...props}
      className={cn(
        'w-full min-h-9 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 text-left text-[13.5px] outline-none',
        danger
          ? 'text-vg-red hover:bg-vg-red-wash focus:bg-vg-red-wash'
          : 'text-vg-text hover:bg-vg-surface-2 focus:bg-vg-surface-2',
        className
      )}
    >
      {Icon && <Icon size={15} className={cn('shrink-0', danger ? '' : 'text-vg-text-2')} aria-hidden="true" />}
      <span className="min-w-0 flex-1">{children}</span>
      {hint}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-vg-line" />;
}

export function MenuLabel({ children }) {
  return <div className="px-2.5 pt-2 pb-1 text-[12px] text-vg-text-3">{children}</div>;
}
