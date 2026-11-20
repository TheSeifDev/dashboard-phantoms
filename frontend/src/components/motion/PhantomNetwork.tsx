import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ClipboardList, UsersRound } from 'lucide-react';
import { PhantomsSymbol } from '../brand/PhantomsLogo';

gsap.registerPlugin(useGSAP);

const connections = [
  'M340 260 L170 120', 'M340 260 L285 76', 'M340 260 L465 92', 'M340 260 L545 180',
  'M340 260 L530 355', 'M340 260 L410 440', 'M340 260 L250 430', 'M340 260 L105 340',
  'M170 120 L95 190', 'M170 120 L285 76', 'M285 76 L365 42', 'M465 92 L545 180',
  'M545 180 L610 270', 'M530 355 L610 270', 'M530 355 L410 440', 'M410 440 L310 485',
  'M250 430 L105 340', 'M105 340 L65 250', 'M95 190 L65 250', 'M250 430 L310 485',
];

const nodes = [
  [170, 120], [285, 76], [465, 92], [545, 180], [530, 355], [410, 440], [250, 430], [105, 340],
  [95, 190], [365, 42], [610, 270], [310, 485], [65, 250], [220, 190], [455, 260], [340, 155],
  [335, 365], [175, 285], [485, 160], [445, 390], [260, 330], [560, 300], [130, 260], [390, 115],
];

/** Original, decorative PHANTOMS network motif; all motion is local and disposable. */
export function PhantomNetwork() {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const paths = gsap.utils.toArray('.phantom-network__line', scope.current) as SVGPathElement[];
      paths.forEach((path: SVGPathElement) => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length, opacity: 0.7 });
      });
      gsap.set('.phantom-network__node', { transformOrigin: 'center', scale: 0.45, opacity: 0 });
      gsap.set('.phantom-network__center, .phantom-network__glyph', { opacity: 0, y: 8 });

      const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } });
      timeline.to(paths, { strokeDashoffset: 0, duration: 1.05, stagger: 0.035 }, 0.05)
        .to('.phantom-network__node', { scale: 1, opacity: 1, duration: 0.48, stagger: 0.022 }, 0.36)
        .to('.phantom-network__center', { opacity: 1, y: 0, duration: 0.7 }, 0.55)
        .to('.phantom-network__glyph', { opacity: 1, y: 0, duration: 0.45, stagger: 0.12 }, 0.78)
        .to('.phantom-network__node--accent', { scale: 1.12, duration: 0.24, yoyo: true, repeat: 1, stagger: 0.08 }, 1.05);
      return () => timeline.kill();
    });
    return () => media.revert();
  }, { scope });

  return (
    <div className="phantom-network" ref={scope} aria-hidden="true">
      <svg className="phantom-network__svg" viewBox="0 0 680 520" focusable="false">
        <defs>
          <radialGradient id="phantom-network-glow"><stop offset="0" stopColor="var(--primary)" stopOpacity=".13" /><stop offset="1" stopColor="var(--primary)" stopOpacity="0" /></radialGradient>
        </defs>
        <circle cx="340" cy="260" r="164" fill="url(#phantom-network-glow)" />
        <g className="phantom-network__lines">
          {connections.map((path) => <path className="phantom-network__line" d={path} key={path} />)}
        </g>
        <g>
          {nodes.map(([x, y], index) => (
            <rect
              className={`phantom-network__node${index % 5 === 0 ? ' phantom-network__node--accent' : ''}`}
              x={x - (index % 5 === 0 ? 4 : 3)}
              y={y - (index % 5 === 0 ? 4 : 3)}
              width={index % 5 === 0 ? 8 : 6}
              height={index % 5 === 0 ? 8 : 6}
              rx="1.5"
              key={`${x}-${y}`}
            />
          ))}
        </g>
      </svg>
      <div className="phantom-network__center"><PhantomsSymbol size="lg" /></div>
      <div className="phantom-network__glyph phantom-network__glyph--team"><UsersRound size={18} /><span>TEAM</span></div>
      <div className="phantom-network__glyph phantom-network__glyph--tasks"><ClipboardList size={18} /><span>TASKS</span></div>
      <div className="phantom-network__caption"><span className="phantom-network__caption-dot" /> PEOPLE <i /> IDEAS <i /> IMPACT</div>
    </div>
  );
}
