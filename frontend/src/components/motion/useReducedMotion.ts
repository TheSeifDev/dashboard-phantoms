import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';
function snapshot(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(query).matches;
}
function subscribe(notify: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(query);
  media.addEventListener?.('change', notify);
  return () => media.removeEventListener?.('change', notify);
}

/** CSS and every motion engine use the same user preference; no artificial delay. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
