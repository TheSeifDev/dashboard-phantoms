import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  hideLabel?: boolean;
}

/** Pill segmented control; the active thumb glides between options with GSAP. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const container = root.current;
    const pill = thumb.current;
    if (!container || !pill) return;
    const place = (animate: boolean) => {
      const active = container.querySelector<HTMLElement>('button[aria-pressed="true"]');
      if (!active) return;
      const props = { x: active.offsetLeft, width: active.offsetWidth };
      if (animate && !prefersReducedMotion()) gsap.to(pill, { ...props, duration: 0.5, ease: 'elastic.out(1, 0.75)', overwrite: true });
      else gsap.set(pill, props);
      container.dataset.ready = 'true';
    };
    place(!first.current);
    first.current = false;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, [value, options]);
  return (
    <div ref={root} className={`seg ${className}`} role="group" aria-label={label}>
      <span ref={thumb} className="seg-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.hideLabel ? option.label : undefined}
          title={option.hideLabel ? option.label : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {!option.hideLabel && <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}
