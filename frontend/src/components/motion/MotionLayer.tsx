import { useEffect } from 'react';
import { gsap, hasFinePointer, prefersReducedMotion } from './gsap';

const SPOT_SELECTOR = '.glass-card, [data-spotlight]';
const MAGNET_SELECTOR = '[data-magnetic]';
const TILT_SELECTOR = '[data-tilt]';

/**
 * One delegated listener drives pointer physics for the whole app:
 * - spotlight: writes --mx/--my on hovered glass cards
 * - magnetic: buttons with [data-magnetic] lean toward the cursor and spring back
 * - tilt: cards with [data-tilt] rotate a few degrees in 3D
 * Touch devices and reduced-motion users get no transforms.
 */
export function MotionLayer() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const physics = hasFinePointer() && !prefersReducedMotion();
    let magnet: HTMLElement | null = null;
    let tilt: HTMLElement | null = null;

    const release = (element: HTMLElement | null, kind: 'magnet' | 'tilt') => {
      if (!element) return;
      if (kind === 'magnet') gsap.to(element, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)', overwrite: 'auto' });
      else gsap.to(element, { rotationX: 0, rotationY: 0, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
    };

    const onMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const spot = target.closest<HTMLElement>(SPOT_SELECTOR);
      if (spot) {
        const rect = spot.getBoundingClientRect();
        spot.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        spot.style.setProperty('--my', `${event.clientY - rect.top}px`);
      }
      if (!physics) return;
      const nextMagnet = target.closest<HTMLElement>(MAGNET_SELECTOR);
      if (nextMagnet !== magnet) { release(magnet, 'magnet'); magnet = nextMagnet; }
      if (magnet) {
        const rect = magnet.getBoundingClientRect();
        const strength = Number(magnet.dataset.magnetic) || 0.28;
        gsap.to(magnet, {
          x: (event.clientX - (rect.left + rect.width / 2)) * strength,
          y: (event.clientY - (rect.top + rect.height / 2)) * strength,
          duration: 0.35,
          ease: 'power3.out',
          overwrite: 'auto',
        });
      }
      const nextTilt = target.closest<HTMLElement>(TILT_SELECTOR);
      if (nextTilt !== tilt) { release(tilt, 'tilt'); tilt = nextTilt; }
      if (tilt) {
        const rect = tilt.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        const max = Number(tilt.dataset.tilt) || 5;
        gsap.to(tilt, { rotationY: px * max, rotationX: -py * max, transformPerspective: 900, duration: 0.5, ease: 'power3.out', overwrite: 'auto' });
      }
    };
    const onLeaveWindow = () => { release(magnet, 'magnet'); release(tilt, 'tilt'); magnet = null; tilt = null; };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeaveWindow);
    window.addEventListener('blur', onLeaveWindow);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeaveWindow);
      window.removeEventListener('blur', onLeaveWindow);
    };
  }, []);
  return null;
}
