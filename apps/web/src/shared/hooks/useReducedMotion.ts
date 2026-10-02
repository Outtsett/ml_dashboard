/**
 * Reduced-motion state, plus an explicit per-surface override.
 *
 * Honouring `prefers-reduced-motion: reduce` is the correct default and stays
 * the default: animated surfaces settle to a still frame. But some surfaces
 * exist to be watched, and a viewer who lands on one and asks for motion has
 * knowingly overridden their own global preference for that one surface.
 * Without an override they get a frozen picture and no way to say otherwise —
 * which is exactly what happened in testing, where the OS setting made every
 * animation engine look broken.
 *
 * Any such toggle should only be surfaced when the preference is actually set,
 * so it stays invisible noise for everyone else.
 *
 * Lifted here from `system/architecture-explorer/mechanism/` when the live
 * telemetry surface became a second consumer.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
