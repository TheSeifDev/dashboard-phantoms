import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { motionAllowed } from '../components/teamCopy';

export type ChartTone = 'primary' | 'accent' | 'warning' | 'muted';

export interface BarDatum {
  id: string | number;
  label: string;
  value: number;
  hint?: string;
  tone?: ChartTone;
}

/**
 * أعمدة أفقية حقيقية من الداتا الحقيقية فقط. كل عمود بيتحرك من 0 لقيمته بـ GSAP،
 * والاتجاه بيتبع dir الصفحة (RTL) عشان النمو يبان من اليمين.
 */
export function BarsChart({
  data, format, emptyLabel, ariaLabel,
}: {
  data: BarDatum[];
  format: (value: number) => string;
  emptyLabel: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const max = Math.max(1, ...data.map((item) => Math.abs(item.value)));
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed()) return;
    const bars = root.querySelectorAll<HTMLElement>('[data-bar]');
    if (!bars.length) return;
    const tween = gsap.fromTo(bars, { scaleX: 0 }, {
      scaleX: 1, duration: 0.85, stagger: 0.06, ease: 'power3.out', clearProps: 'transform',
    });
    return () => { tween.kill(); };
  }, [data]);
  if (data.length === 0) return <p className="tmc-chart-empty">{emptyLabel}</p>;
  return (
    <ul className="tmc-bars" ref={ref} aria-label={ariaLabel}>
      {data.map((item) => (
        <li key={item.id} className="tmc-bars-row">
          <span className="tmc-bars-label" title={item.label}>{item.label}</span>
          <span className="tmc-bars-track">
            <span
              className={`tmc-bars-fill is-${item.tone ?? 'primary'}`}
              data-bar
              style={{ width: `${Math.max(4, (Math.abs(item.value) / max) * 100)}%` }}
            />
          </span>
          <span className="tmc-bars-value" dir="ltr">{format(item.value)}</span>
          {item.hint ? <span className="tmc-bars-hint">{item.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  tone: ChartTone;
}

/** دونات بأجزاء مرسومة بـ stroke-dashoffset متحرك. */
export function DonutChart({
  segments, centerValue, centerLabel, size = 148,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  size?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = segments.map((segment) => {
    const share = total > 0 ? segment.value / total : 0;
    const length = share * circumference;
    const arc = { ...segment, length, start: offset, share };
    offset += length;
    return arc;
  });
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed()) return;
    const shapes = root.querySelectorAll<SVGCircleElement>('[data-arc]');
    if (!shapes.length) return;
    const tween = gsap.fromTo(shapes, { strokeDasharray: `0 ${circumference}` }, {
      strokeDasharray: (_index: number, target: SVGCircleElement) => target.dataset.arcLength ?? `0 ${circumference}`,
      duration: 1, ease: 'power2.out', stagger: 0.08,
    });
    return () => { tween.kill(); };
  }, [circumference, segments]);
  return (
    <div className="tmc-donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" ref={ref} role="img" aria-label={`${centerLabel}: ${centerValue}`}>
        <circle className="tmc-donut-track" cx="64" cy="64" r={radius} />
        {total > 0 && arcs.map((arc) => (
          <circle
            key={arc.id}
            className={`tmc-donut-arc is-${arc.tone}`}
            cx="64"
            cy="64"
            r={radius}
            data-arc
            data-arc-length={`${arc.length} ${circumference - arc.length}`}
            strokeDasharray={total > 0 ? `${arc.length} ${circumference - arc.length}` : undefined}
            strokeDashoffset={-arc.start}
          />
        ))}
      </svg>
      <span className="tmc-donut-center">
        <strong>{centerValue}</strong>
        <small>{centerLabel}</small>
      </span>
    </div>
  );
}

/** حلقة تقدم لهدف واحد — نسبة الإنجاز الحقيقية من current/target. */
export function ProgressRing({
  value, max, label, sublabel, tone = 'accent', size = 96,
}: {
  value: number;
  max: number;
  label: string;
  sublabel?: string;
  tone?: ChartTone;
  size?: number;
}) {
  const ref = useRef<SVGCircleElement>(null);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const target = circumference * (1 - ratio);
  useLayoutEffect(() => {
    const circle = ref.current;
    if (!circle || !motionAllowed()) return;
    const tween = gsap.fromTo(circle, { strokeDashoffset: circumference }, {
      strokeDashoffset: target, duration: 1.1, ease: 'power3.out',
    });
    return () => { tween.kill(); };
  }, [circumference, target]);
  return (
    <div className="tmc-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 96 96" role="img" aria-label={`${label}: ${Math.round(ratio * 100)}%`}>
        <circle className="tmc-ring-track" cx="48" cy="48" r={radius} />
        <circle
          ref={ref}
          className={`tmc-ring-value is-${tone}`}
          cx="48"
          cy="48"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={target}
        />
      </svg>
      <span className="tmc-ring-center">
        <strong dir="ltr">{Math.round(ratio * 100)}%</strong>
        <small>{sublabel ?? label}</small>
      </span>
    </div>
  );
}

/** خط اتجاه (area + line) لعدد الأحداث الحقيقي لكل يوم. */
export function TrendChart({
  points, ariaLabel,
}: {
  points: { label: string; value: number }[];
  ariaLabel: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const width = 320;
  const height = 96;
  const max = Math.max(1, ...points.map((point) => point.value));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((point, index) => ({
    x: index * step,
    y: height - 8 - (point.value / max) * (height - 20),
    ...point,
  }));
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed()) return;
    const path = root.querySelector<SVGPathElement>('[data-line]');
    const fill = root.querySelector<SVGPathElement>('[data-area]');
    const dots = root.querySelectorAll<SVGCircleElement>('[data-dot]');
    const timeline = gsap.timeline();
    if (path) {
      const length = path.getTotalLength();
      timeline.fromTo(path, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out' }, 0);
    }
    if (fill) timeline.fromTo(fill, { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0.2);
    if (dots.length) timeline.fromTo(dots, { scale: 0, transformOrigin: 'center' }, { scale: 1, duration: 0.35, stagger: 0.05, ease: 'back.out(2)' }, 0.4);
    return () => { timeline.kill(); };
  }, [line, area]);
  if (points.every((point) => point.value === 0)) {
    return <p className="tmc-chart-empty">{ariaLabel}</p>;
  }
  return (
    <svg className="tmc-trend" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" ref={ref} role="img" aria-label={ariaLabel}>
      <path className="tmc-trend-area" d={area} data-area />
      <path className="tmc-trend-line" d={line} data-line />
      {coords.map((point) => (
        <circle key={point.label} className="tmc-trend-dot" cx={point.x} cy={point.y} r="2.6" data-dot />
      ))}
    </svg>
  );
}
