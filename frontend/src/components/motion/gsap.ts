import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

export { gsap, ScrollTrigger, useGSAP };

/** True when the user asked for less motion (or when no browser environment exists). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fine pointers get hover physics (magnetic, tilt); touch devices keep plain taps. */
export function hasFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: fine)').matches;
}

export const EASE = {
  out: 'power3.out',
  inOut: 'power2.inOut',
  spring: 'back.out(1.6)',
  elastic: 'elastic.out(1, 0.45)',
} as const;
