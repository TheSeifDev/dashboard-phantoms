import { useLayoutEffect, type RefObject } from 'react';
import gsap from 'gsap';

/** GSAP needs a real rendering environment and the user must allow motion. */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Staggered entrance for the ledger surfaces (hero, metrics, panels, charts).
 * Elements opt in with `data-ldg-enter`; nothing animates when motion is reduced.
 */
export function useLedgerEnter(
  ref: RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown> = [],
  selector = '[data-ldg-enter]',
) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed()) return;
    const targets = root.querySelectorAll<HTMLElement>(selector);
    if (targets.length === 0) return;
    const tween = gsap.fromTo(
      targets,
      { y: 18, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.55,
        stagger: 0.055,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
      },
    );
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Re-stagger table rows whenever the visible slice changes (tab, search, team). */
export function useLedgerRows(
  ref: RefObject<HTMLElement | null>,
  key: string,
  selector = '.ldg-table-row',
) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed()) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>(selector)).slice(0, 18);
    if (rows.length === 0) return;
    const tween = gsap.fromTo(
      rows,
      { y: 10, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.34,
        stagger: 0.026,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
      },
    );
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Counts a number up in place; falls back to the final value without motion. */
export function tweenNumber(to: number, write: (value: number) => void, duration = 0.9) {
  if (!motionAllowed() || !Number.isFinite(to)) {
    write(to);
    return () => {};
  }
  const state = { value: 0 };
  const tween = gsap.to(state, {
    value: to,
    duration,
    ease: 'power2.out',
    onUpdate: () => write(state.value),
    onComplete: () => write(to),
  });
  return () => { tween.kill(); };
}