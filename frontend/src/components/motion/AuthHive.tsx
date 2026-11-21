import { useEffect, useRef } from 'react';
import { ClipboardCheck, Flame, GitCommitHorizontal } from 'lucide-react';
import { gsap, prefersReducedMotion } from './gsap';
import { PhantomsSymbol } from '../brand/PhantomsLogo';
import { useLocale } from '../../i18n/useLocale';

const R = 30;
const W = Math.sqrt(3) * R;
const RADIUS = 3;

interface HiveCell { q: number; r: number; ring: number; x: number; y: number; tier: number }

// A 37-cell hexagonal "flower" (axial radius 3). Tiers are deterministic so the
// server/client markup is stable; outer rings lean to the cooler single-contributor tones.
const CELLS: HiveCell[] = (() => {
  const cells: HiveCell[] = [];
  for (let q = -RADIUS; q <= RADIUS; q += 1) {
    for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r += 1) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const seed = Math.abs((q * 73856093) ^ (r * 19349663)) % 97;
      const tier = ring === 0 ? 4 : ring === 1 ? 3 + (seed % 2) : ring === 2 ? 2 + (seed % 2) : 1 + (seed % 2);
      cells.push({ q, r, ring, x: W * (q + r / 2), y: 1.5 * R * r, tier });
    }
  }
  return cells;
})();

const HEX = Array.from({ length: 6 }, (_, index) => {
  const angle = (Math.PI / 180) * (60 * index - 30);
  return `${(R * 0.9 * Math.cos(angle)).toFixed(2)},${(R * 0.9 * Math.sin(angle)).toFixed(2)}`;
}).join(' ');

const axial = (q: number, r: number) => ({ x: W * (q + r / 2), y: 1.5 * R * r });

// Three "merge traces" (task approvals, GitHub pushes, team heat) run from the hive's
// outer corners, 120° apart, through each ring's cell centre into the PHANTOMS core.
const TRACES = [
  { id: 'tasks', tone: 1, dq: 1, dr: -1 },
  { id: 'github', tone: 2, dq: -1, dr: 0 },
  { id: 'heat', tone: 4, dq: 0, dr: 1 },
].map((trace, index) => {
  const nodes = Array.from({ length: RADIUS }, (_, step) => axial(trace.dq * (RADIUS - step), trace.dr * (RADIUS - step)));
  return { ...trace, delay: 0.7 + index * 0.22, nodes, d: `M ${nodes.map((n) => `${n.x.toFixed(2)} ${n.y.toFixed(2)}`).join(' L ')} L 0 0` };
});

/**
 * Sign-in hero visual: the team honeycomb. Cells light up as "contributions" land
 * (task approvals + GitHub pushes), merge traces draw into the PHANTOMS core with
 * travelling pulses, heat ripples outward and three glass event chips float around it.
 * Pure SVG + GSAP (traces draw with CSS so they settle even without JS motion); respects reduced motion.
 */
export function AuthHive() {
  const root = useRef<HTMLDivElement>(null);
  const { t } = useLocale();

  useEffect(() => {
    const element = root.current;
    if (!element || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      const lit = gsap.utils.toArray<SVGPolygonElement>('.auth-hive-lit', element);
      gsap.set('.auth-hive-cell', { transformOrigin: '50% 50%', transformBox: 'fill-box' });
      const intro = gsap.timeline({ defaults: { ease: 'back.out(1.6)' } });
      intro
        .from('.auth-hive-cell', { scale: 0, opacity: 0, duration: 0.7, stagger: { each: 0.018, from: 'center', grid: 'auto' } })
        .from('.auth-hive-core', { scale: 0.4, opacity: 0, rotate: -30, duration: 0.9, ease: 'elastic.out(1, 0.55)' }, 0.25)
        .from('.auth-hive-chip', { y: 18, opacity: 0, scale: 0.9, duration: 0.7, stagger: 0.14, ease: 'power3.out' }, 0.6);

      // Contributions landing: random cells flare to their tier colour and settle.
      gsap.to(lit, {
        opacity: 1,
        duration: 1.1,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.22, from: 'random', repeat: -1, yoyo: true },
        delay: 1,
      });
      // Heat ripple: every few seconds a wave rolls outward ring by ring.
      const ripple = gsap.timeline({ repeat: -1, repeatDelay: 2.6, delay: 2 });
      for (let ring = 0; ring <= RADIUS; ring += 1) {
        ripple.to(`.auth-hive-cell[data-ring="${ring}"]`, { scale: 1.12, duration: 0.28, ease: 'power2.out', yoyo: true, repeat: 1 }, ring * 0.16);
      }
      gsap.to('.auth-hive-svg', { rotate: 4, duration: 12, ease: 'sine.inOut', repeat: -1, yoyo: true, transformOrigin: '50% 50%' });
      gsap.to('.auth-hive-orbit', { rotate: 360, duration: 40, ease: 'none', repeat: -1, transformOrigin: '50% 50%' });
      gsap.utils.toArray<HTMLElement>('.auth-hive-chip', element).forEach((chip, index) => {
        gsap.to(chip, { y: index % 2 ? 9 : -9, x: index === 1 ? -6 : 4, duration: 3.2 + index * 0.6, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.2 + index * 0.3 });
      });
      // Merge pulses: a contribution travels each trace into the core, which "absorbs" it with a pop.
      const core = element.querySelector('.auth-hive-core');
      gsap.utils.toArray<SVGCircleElement>('.auth-hive-pulse', element).forEach((pulse, index) => {
        const start = TRACES[index]?.nodes[0];
        if (!start) return;
        const travel = gsap.timeline({ repeat: -1, repeatDelay: 2.4 + index * 0.5, delay: 2.2 + index * 0.9 });
        travel
          .fromTo(pulse, { attr: { cx: start.x, cy: start.y }, opacity: 0, scale: 0.6, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.25, ease: 'power1.out' })
          .to(pulse, { attr: { cx: 0, cy: 0 }, duration: 1.5, ease: 'power2.in' }, 0)
          .to(pulse, { opacity: 0, duration: 0.2 }, '>-0.12');
        if (core) travel.to(core, { scale: 1.07, duration: 0.16, ease: 'power2.out', yoyo: true, repeat: 1 }, '<');
      });

      // Pointer parallax on fine pointers: the hive and chips drift at different depths.
      if (!window.matchMedia?.('(pointer: fine)').matches) return;
      const hiveX = gsap.quickTo('.auth-hive-stage', 'x', { duration: 1.2, ease: 'power3.out' });
      const hiveY = gsap.quickTo('.auth-hive-stage', 'y', { duration: 1.2, ease: 'power3.out' });
      const chipsX = gsap.quickTo('.auth-hive-chips', 'x', { duration: 1.4, ease: 'power3.out' });
      const chipsY = gsap.quickTo('.auth-hive-chips', 'y', { duration: 1.4, ease: 'power3.out' });
      const onMove = (event: PointerEvent) => {
        const rect = element.getBoundingClientRect();
        const dx = (event.clientX - rect.left) / rect.width - 0.5;
        const dy = (event.clientY - rect.top) / rect.height - 0.5;
        hiveX(dx * 14); hiveY(dy * 12); chipsX(dx * -22); chipsY(dy * -18);
      };
      window.addEventListener('pointermove', onMove);
      return () => window.removeEventListener('pointermove', onMove);
    }, element);
    return () => context.revert();
  }, []);

  const size = (2 * RADIUS + 1) * W + 40;
  return (
    <div ref={root} className="auth-hive" aria-hidden="true">
      <div className="auth-hive-stage">
        <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className="auth-hive-svg" focusable="false">
          <defs>
            {[1, 2, 3, 4].map((tier) => (
              <linearGradient key={tier} id={`authHive${tier}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={`var(--crew-${tier})`} />
                <stop offset="100%" stopColor={`var(--crew-${Math.min(4, tier + 1)})`} stopOpacity="0.8" />
              </linearGradient>
            ))}
            <radialGradient id="authHiveGlow">
              <stop offset="0%" stopColor="var(--crew-2)" stopOpacity="0.42" />
              <stop offset="100%" stopColor="var(--crew-2)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle r={size / 2.4} fill="url(#authHiveGlow)" />
          <g className="auth-hive-orbit">
            <circle r={size / 2 - 8} fill="none" stroke="var(--glass-hairline)" strokeDasharray="2 8" />
            <circle cx={size / 2 - 8} cy="0" r="4" fill="var(--crew-2)" />
            <circle cx={-(size / 2 - 8)} cy="0" r="3" fill="var(--crew-4)" />
          </g>
          {CELLS.map((cell) => (
            <g key={`${cell.q}:${cell.r}`} className="auth-hive-cell" data-ring={cell.ring} transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}>
              <polygon className="auth-hive-base" points={HEX} />
              {cell.ring > 0 && <polygon className="auth-hive-lit" points={HEX} fill={`url(#authHive${cell.tier})`} data-ring={cell.ring} />}
            </g>
          ))}
          <g className="auth-hive-traces">
            {TRACES.map((trace) => (
              <g key={trace.id} className="auth-hive-branch" data-trace={trace.id} style={{ ['--trace-tone' as string]: `var(--crew-${trace.tone})`, ['--trace-delay' as string]: `${trace.delay}s` }}>
                <path className="auth-hive-trace" d={trace.d} pathLength={1} />
                {trace.nodes.map((node, step) => (
                  <circle key={step} className="auth-hive-node" cx={node.x.toFixed(2)} cy={node.y.toFixed(2)} r={step === 0 ? 5 : 3.5} style={{ animationDelay: `${trace.delay + step * 0.22}s` }} />
                ))}
              </g>
            ))}
            {TRACES.map((trace) => (
              <circle key={trace.id} className="auth-hive-pulse" r="4.5" cx={trace.nodes[0].x.toFixed(2)} cy={trace.nodes[0].y.toFixed(2)} style={{ ['--trace-tone' as string]: `var(--crew-${trace.tone})` }} />
            ))}
          </g>
        </svg>
        <div className="auth-hive-core"><PhantomsSymbol size="lg" /></div>
      </div>
      <div className="auth-hive-chips">
        <span className="auth-hive-chip auth-hive-chip--task"><i><ClipboardCheck size={14} /></i>{t('تم اعتماد تسليم', 'Delivery approved')}</span>
        <span className="auth-hive-chip auth-hive-chip--push"><i><GitCommitHorizontal size={14} /></i>{t('٣ دفعات على GitHub', '3 GitHub pushes')}</span>
        <span className="auth-hive-chip auth-hive-chip--heat"><i><Flame size={14} /></i>{t('الخلية سخنت', 'Hive is heating up')}</span>
      </div>
    </div>
  );
}
