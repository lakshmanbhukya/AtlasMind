import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useEffect, useRef } from 'react';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scrolls to the connection form and focuses the connection string input. */
export function goToConnect(e) {
  const input = document.getElementById('connection-string');
  if (!input) return;
  e?.preventDefault();
  document.getElementById('connect')?.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'center',
  });
  input.focus({ preventScroll: true });
}

/**
 * For click-driven animations. `run(fn)` executes fn inside a gsap.context
 * scoped to `scope`, so selectors stay local; every context is reverted on
 * unmount. Call it from event handlers only.
 */
export function useScopedAnimation(scope) {
  const contexts = useRef([]);
  useEffect(() => {
    const list = contexts.current;
    return () => list.forEach((ctx) => ctx.revert());
  }, []);
  return (fn) => {
    const ctx = gsap.context(fn, scope.current);
    contexts.current.push(ctx);
    return ctx;
  };
}

export { gsap, useGSAP };
