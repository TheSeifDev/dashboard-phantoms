import { useEffect, useRef, type RefObject } from 'react';
import { gsap, ScrollTrigger, prefersReducedMotion } from './gsap';

/** Counts from the previous value to the next one; screen readers always get the final value. */
export function AnimatedNumber({
  value,
  format,
  className,
  duration = 1.1,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
  duration?: number;
}) {
  const visual = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);
  const formatRef = useRef(format);
  formatRef.current = format;
  useEffect(() => {
    const element = visual.current;
    if (!element) return;
    if (prefersReducedMotion() || !Number.isFinite(value)) {
      element.textContent = formatRef.current(value);
      previous.current = value;
      return;
    }
    const state = { current: previous.current };
    const tween = gsap.to(state, {
      current: value,
      duration,
      ease: 'power3.out',
      onUpdate: () => { element.textContent = formatRef.current(Math.round(state.current)); },
      onComplete: () => { element.textContent = formatRef.current(value); previous.current = value; },
    });
    return () => { tween.kill(); element.textContent = formatRef.current(value); previous.current = value; };
  }, [value, duration]);
  return (
    <span className={className}>
      <span ref={visual} aria-hidden="true">{format(value)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

/**
 * Staggered entrance for [data-reveal] descendants. Elements already on screen animate
 * immediately; the rest rise in as they scroll into view. Content stays visible without JS.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const root = scope.current;
    if (!root || prefersReducedMotion()) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!targets.length) return;
    const context = gsap.context(() => {
      gsap.set(targets, { opacity: 0, y: 26, scale: 0.985 });
      ScrollTrigger.batch(targets, {
        start: 'top 96%',
        once: true,
        onEnter: (batch) => gsap.to(batch, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.8,
          stagger: 0.07,
          ease: 'power3.out',
          clearProps: 'opacity,transform',
        }),
      });
      ScrollTrigger.refresh();
    }, root);
    // Safety net: never leave content hidden if a trigger is missed (print, odd layouts).
    const timer = window.setTimeout(() => {
      targets.forEach((target) => {
        if (target.style.opacity === '0') gsap.to(target, { opacity: 1, y: 0, scale: 1, duration: 0.5, clearProps: 'opacity,transform' });
      });
    }, 4000);
    return () => { window.clearTimeout(timer); context.revert(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
