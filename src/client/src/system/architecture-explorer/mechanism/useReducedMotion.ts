/**
 * Reduced-motion state, plus an explicit per-surface override.
 *
 * Honouring `prefers-reduced-motion: reduce` is the correct default and stays
 * the default: engines settle to a still frame. But this page exists to be
 * watched, and a viewer who lands here and asks for motion has knowingly
 * overridden their own global preference for this one surface. Without an
 * override they get a frozen picture and no way to say otherwise — which is
 * exactly what happened in testing, where the OS setting made every engine look
 * broken.
 *
 * The toggle is only surfaced when the preference is actually set, so it is
 * invisible noise for everyone else.
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
