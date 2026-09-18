/**
 * useFlowClock — one requestAnimationFrame loop driving the whole flow layer.
 *
 * The clock deliberately does NOT live in React state. Subscribers receive the
 * current stage-time `p` every frame and mutate SVG attributes directly, so a
 * 60fps animation costs zero React renders no matter how many head lanes,
 * edges or badges are on screen. The only components that re-render are the
 * transport readouts, and only when the integer stage changes.
 *
 * `p` is in stage units (see flow.ts): `speed` is stages-per-second.
 *
 * Reduced motion: when `prefers-reduced-motion: reduce` is set the loop never
 * starts. The clock still publishes `p` — it just only moves when the step
 * control moves it, so the graph becomes a static, steppable diagram.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type FlowSubscriber = (p: number) => void;

export interface FlowClock {
  /** Register a per-frame callback. Returns an unsubscribe fn. */
  subscribe: (fn: FlowSubscriber) => () => void;
  /** Current stage-time, readable at any moment (e.g. on mount). */
  getP: () => number;
}

export interface UseFlowClockOptions {
  /** End of the timeline in stage units; `p` wraps back to 0 here. */
  timelineEnd: number;
  playing: boolean;
  /** Stages per second. */
  speed: number;
  /** Pinned stage-time used while paused (the step control's output). */
  steppedP: number;
  /** Re-seed the clock when this changes (graph identity). */
  resetKey: string;
}

/** True when the user has asked the OS for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function useFlowClock({
  timelineEnd,
  playing,
  speed,
  steppedP,
  resetKey,
}: UseFlowClockOptions): FlowClock {
  const subs = useRef(new Set<FlowSubscriber>());
  const pRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // Read live values inside the loop without restarting it every prop change.
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const endRef = useRef(timelineEnd);
  endRef.current = Math.max(1, timelineEnd);

  const publish = useCallback((p: number) => {
    pRef.current = p;
    for (const fn of subs.current) fn(p);
  }, []);

  const clock = useMemo<FlowClock>(
    () => ({
      subscribe: (fn: FlowSubscriber) => {
        subs.current.add(fn);
        fn(pRef.current); // paint the current frame immediately on mount
        return () => {
          subs.current.delete(fn);
        };
      },
      getP: () => pRef.current,
    }),
    [],
  );

  // Paused (or reduced motion): the step control owns `p` outright.
  useEffect(() => {
    if (playing) return;
    publish(steppedP);
  }, [playing, steppedP, publish]);

  // Re-seed on graph change so a new model starts from its own input node.
  useEffect(() => {
    lastTsRef.current = null;
    publish(0);
    // resetKey is the dependency that matters; publish is stable.
  }, [resetKey, publish]);

  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      // Guard the first frame and any tab-restore jump (>250ms) so the pulse
      // never teleports across the network after a background pause.
      const dt = last == null ? 0 : Math.min(0.25, (ts - last) / 1000);
      let next = pRef.current + dt * speedRef.current;
      if (next >= endRef.current) next -= endRef.current;
      publish(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [playing, publish]);

  return clock;
}

/**
 * Subscribe to the clock but only re-render when the reported integer stage
 * changes — the escape hatch for the handful of readouts that genuinely need
 * React state (transport label, active-layer name).
 */
export function useActiveStage(clock: FlowClock, stageCount: number): number {
  const [stage, setStage] = useState(() =>
    Math.min(stageCount - 1, Math.max(0, Math.floor(clock.getP()))),
  );
  useEffect(() => {
    let current = -1;
    return clock.subscribe((p) => {
      const s = Math.min(stageCount - 1, Math.max(0, Math.floor(p)));
      if (s !== current) {
        current = s;
        setStage(s);
      }
    });
  }, [clock, stageCount]);
  return stage;
}
