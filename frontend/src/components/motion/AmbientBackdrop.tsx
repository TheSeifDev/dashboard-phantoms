import { useRef } from 'react';
import { gsap, useGSAP, prefersReducedMotion } from './gsap';

/**
 * Fixed aurora backdrop behind every screen: four blurred color fields that drift slowly,
 * a fading engineering grid and a honeycomb motif. Pointer parallax on fine pointers.
 */
export function AmbientBackdrop() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const element = root.current;
    if (!element || prefersReducedMotion()) return;
    const blobs = gsap.utils.toArray<HTMLElement>('.app-backdrop__blob', element);
    const tweens = blobs.map((blob, index) => gsap.to(blob, {
      xPercent: gsap.utils.random(-16, 16),
      yPercent: gsap.utils.random(-14, 14),
      scale: gsap.utils.random(0.86, 1.18),
      rotation: gsap.utils.random(-25, 25),
      duration: gsap.utils.random(16, 26),
      delay: index * -3,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    }));
    const hex = element.querySelector<SVGElement>('.app-backdrop__hex');
    const hexTween = hex ? gsap.to(hex, { rotation: 18, duration: 60, ease: 'none', repeat: -1, yoyo: true, transformOrigin: '60% 40%' }) : null;
    const layer = element.querySelector<HTMLElement>('.app-backdrop__field');
    const fine = window.matchMedia?.('(pointer: fine)').matches;
    let moveX: gsap.QuickToFunc | null = null;
    let moveY: gsap.QuickToFunc | null = null;
    if (layer && fine) {
      moveX = gsap.quickTo(layer, 'x', { duration: 1.6, ease: 'power3.out' });
      moveY = gsap.quickTo(layer, 'y', { duration: 1.6, ease: 'power3.out' });
    }
    const onMove = (event: PointerEvent) => {
      if (!moveX || !moveY) return;
      moveX((event.clientX / window.innerWidth - 0.5) * -36);
      moveY((event.clientY / window.innerHeight - 0.5) * -28);
    };
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      tweens.forEach((tween) => (hidden ? tween.pause() : tween.resume()));
      if (hexTween) { if (hidden) hexTween.pause(); else hexTween.resume(); }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    gsap.from(element, { opacity: 0, duration: 1.2, ease: 'power2.out' });
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, { scope: root });

  return (
    <div ref={root} className="app-backdrop" aria-hidden="true">
      <div className="app-backdrop__field" style={{ position: 'absolute', inset: '-60px' }}>
        <span className="app-backdrop__blob app-backdrop__blob--1" />
        <span className="app-backdrop__blob app-backdrop__blob--2" />
        <span className="app-backdrop__blob app-backdrop__blob--3" />
        <span className="app-backdrop__blob app-backdrop__blob--4" />
      </div>
      <div className="app-backdrop__grid" />
      <svg className="app-backdrop__hex" viewBox="0 0 520 520" fill="none" stroke="currentColor" strokeWidth="1">
        <defs>
          <pattern id="phantoms-hex-pattern" width="52" height="90" patternUnits="userSpaceOnUse" patternTransform="scale(1)">
            <path d="M26 0 L52 15 L52 45 L26 60 L0 45 L0 15 Z M26 60 L26 90" />
          </pattern>
        </defs>
        <rect width="520" height="520" fill="url(#phantoms-hex-pattern)" />
      </svg>
    </div>
  );
}
