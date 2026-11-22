import { useCallback, useSyncExternalStore } from 'react';

/** Reactive `matchMedia` without layout thrash: one listener per query, SSR-safe fallback. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
    return window.matchMedia(query).matches;
  }, [query, fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}

/** Phones only (< 768px): the dashboard drops its heaviest visual work here. */
export function useCompactViewport(): boolean {
  return useMediaQuery('(max-width: 767px)');
}