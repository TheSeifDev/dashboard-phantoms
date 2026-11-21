import { useEffect, useRef } from 'react';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';

const R = 26;
const W = Math.sqrt(3) * R;
// Axial hex coordinates for a 19-cell flower (centre, ring 1, ring 2).
const CELLS: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 1], [1, -1, 1], [0, -1, 1], [-1, 0, 1], [-1, 1, 1], [0, 1, 1],
  [2, 0, 2], [2, -1, 2], [2, -2, 2], [1, -2, 2], [0, -2, 2], [-1, -1, 2], [-2, 0, 2], [-2, 1, 2], [-2, 2, 2], [-1, 2, 2], [0, 2, 2], [1, 1, 2],
];
const HEX = Array.from({ length: 6 }, (_, index) => {
  const angle = (Math.PI / 180) * (60 * index - 30);
  return `${(R * 0.92 * Math.cos(angle)).toFixed(2)},${(R * 0.92 * Math.sin(angle)).toFixed(2)}`;
}).join(' ');

/**
 * Decorative honeycomb for the hero: tiers light up by "heat" (how many people were
 * active today) and the whole cluster breathes/rotates subtly with GSAP.
 */
export function HeroHexCluster({ heat, value, caption }: { heat: number; value: string; caption: string }) {
  const root = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = root.current;
    if (!svg || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      gsap.fromTo('.hero-hex', { scale: 0, opacity: 0, transformOrigin: '50% 50%' }, {
        scale: 1,
        opacity: 1,
        duration: 0.8,
        ease: 'back.out(1.7)',
        stagger: { each: 0.035, from: 'center' },
      });
      gsap.to('.hero-hex[data-ring="2"]', { opacity: 0.45, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true, stagger: { each: 0.18, from: 'random', repeat: -1, yoyo: true } });
      gsap.to('.hero-hex-cluster', { rotate: 6, duration: 9, ease: 'sine.inOut', repeat: -1, yoyo: true, transformOrigin: '50% 50%' });
      gsap.to('.hero-hex-orbit', { rotate: 360, duration: 26, ease: 'none', repeat: -1, transformOrigin: '50% 50%' });
    }, svg);
    return () => context.revert();
  }, []);
  const size = 5 * W + 24;
  return (
    <div className="hero-hex" aria-hidden="true">
      <svg ref={root} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className="hero-hex-svg" focusable="false">
        <defs>
          {[1, 2, 3, 4].map((tier) => (
            <linearGradient key={tier} id={`heroHex${tier}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={`var(--crew-${tier})`} stopOpacity="0.95" />
              <stop offset="100%" stopColor={`var(--crew-${Math.min(4, tier + 1)})`} stopOpacity="0.75" />
            </linearGradient>
          ))}
        </defs>
        <g className="hero-hex-orbit">
          <circle r={size / 2 - 6} fill="none" stroke="var(--glass-hairline)" strokeDasharray="2 7" />
          <circle cx={size / 2 - 6} cy="0" r="3.5" fill="var(--crew-2)" />
        </g>
        <g className="hero-hex-cluster">
          {CELLS.map(([q, r, ring], index) => {
            const x = W * (q + r / 2);
            const y = 1.5 * R * r;
            const tier = ring === 0 ? Math.max(1, Math.min(4, heat)) : ring === 1 ? (index % 3) + 1 : ((index + 1) % 4) + 1;
            const lit = ring === 0 || ring === 1 || index % 3 !== 0;
            return (
              <polygon
                key={`${q}:${r}`}
                className="hero-hex"
                data-ring={ring}
                points={HEX}
                transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
                fill={lit ? `url(#heroHex${tier})` : 'var(--heat-0)'}
                opacity={ring === 2 ? 0.7 : 1}
              />
            );
          })}
          <text className="hero-hex-value" textAnchor="middle" dominantBaseline="central" y="-4">{value}</text>
          <text className="hero-hex-caption" textAnchor="middle" dominantBaseline="central" y="13">{caption}</text>
        </g>
      </svg>
    </div>
  );
}
