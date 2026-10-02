/**
 * useLocalReplay — Client-side market replay that works with already-loaded chart data.
 *
 * Think of it as: A DVR for your chart. You already have ALL the bars loaded.
 * This hook just controls a "playhead" — a cursor that says "show bars 0 through N".
 * Press play → the cursor moves forward, revealing one bar at a time.
 * The chart sees a growing slice of your data, like watching price action unfold live.
 *
 * No API calls. No separate data loading. Just a smart index into your existing data.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

// ─── Types ───────────────────────────────────────────────────

export type PlaybackSpeed = 1 | 2 | 5 | 10 | 25 | 50 | 100;
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'finished';

export interface LocalReplaySnapshot<T> {
  /** Bars visible up to current playhead */
  visibleBars: T[];
  /** Current bar index (0-based) */
  currentBarIndex: number;
  /** Total bars available */
  totalBars: number;
  /** Progress 0–1 */
  progress: number;
  /** The bar at the playhead */
  currentBar: T | null;
}

// ─── Speed → milliseconds per bar tick ─────────────────────

const SPEED_MS: Record<PlaybackSpeed, number> = {
  1: 500,
  2: 250,
  5: 100,
  10: 50,
  25: 20,
  50: 10,
  100: 4,
};

// ─── Hook ────────────────────────────────────────────────────

export function useLocalReplay<T>(data: T[]) {
  const [active, setActive] = useState(false);
  const [state, setState] = useState<PlaybackState>('idle');
  const [speed, setSpeed] = useState<PlaybackSpeed>(10);
  const [currentIndex, setCurrentIndex] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataRef = useRef(data);
  const currentIndexRef = useRef(0);

  // Keep refs in sync
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // ── Stop interval ──
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ── Toggle replay mode on/off ──
  const toggleReplay = useCallback(() => {
    setActive(prev => {
      if (prev) {
        // Turning OFF
        stopTimer();
        setState('idle');
        setCurrentIndex(0);
        return false;
      } else {
        // Turning ON — start paused at first bar, show ~50 bars initially for context
        const startIdx = Math.min(50, dataRef.current.length - 1);
        setCurrentIndex(startIdx);
        setState('paused');
        return true;
      }
    });
  }, [stopTimer]);

  // ── Play ──
  const play = useCallback(() => {
    const d = dataRef.current;
    if (!d.length) return;

    // If finished, restart
    if (currentIndexRef.current >= d.length - 1) {
      setCurrentIndex(Math.min(50, d.length - 1));
    }

    setState('playing');
    stopTimer();

    timerRef.current = setInterval(() => {
      setCurrentIndex(prev => {
        const d2 = dataRef.current;
        if (!d2.length) return prev;
        const next = prev + 1;
        if (next >= d2.length - 1) {
          stopTimer();
          setState('finished');
          return d2.length - 1;
        }
        return next;
      });
    }, SPEED_MS[speed]);
  }, [speed, stopTimer]);

  // ── Pause ──
  const pause = useCallback(() => {
    stopTimer();
    setState('paused');
  }, [stopTimer]);

  // ── Step forward ──
  const stepForward = useCallback(() => {
    setCurrentIndex(prev => {
      const d = dataRef.current;
      if (!d.length) return prev;
      const next = Math.min(prev + 1, d.length - 1);
      if (next >= d.length - 1) setState('finished');
      return next;
    });
  }, []);

  // ── Step backward ──
  const stepBackward = useCallback(() => {
    setCurrentIndex(prev => {
      const next = Math.max(prev - 1, 0);
      setState(s => s === 'finished' ? 'paused' : s);
      return next;
    });
  }, []);

  // ── Seek to bar index ──
  const seekTo = useCallback((idx: number) => {
    const d = dataRef.current;
    if (!d.length) return;
    const clamped = Math.max(0, Math.min(idx, d.length - 1));
    setCurrentIndex(clamped);
    if (clamped >= d.length - 1) setState('finished');
    else if (state === 'finished') setState('paused');
  }, [state]);

  // ── Reset ──
  const reset = useCallback(() => {
    stopTimer();
    const startIdx = Math.min(50, dataRef.current.length - 1);
    setCurrentIndex(startIdx);
    setState('paused');
  }, [stopTimer]);

  // ── Speed change ──
  const changeSpeed = useCallback((newSpeed: PlaybackSpeed) => {
    setSpeed(newSpeed);
  }, []);

  // Restart interval when speed changes during playback
  useEffect(() => {
    if (state === 'playing') {
      stopTimer();
      timerRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          const d = dataRef.current;
          if (!d.length) return prev;
          const next = prev + 1;
          if (next >= d.length - 1) {
            stopTimer();
            setState('finished');
            return d.length - 1;
          }
          return next;
        });
      }, SPEED_MS[speed]);
    }
     
  }, [speed]);

  // Reset when data changes (new symbol/timeframe)
  useEffect(() => {
    if (active) {
      stopTimer();
      const startIdx = Math.min(50, data.length - 1);
      setCurrentIndex(startIdx);
      setState('paused');
    }
  }, [data.length, active, stopTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopTimer(); };
  }, [stopTimer]);

  // ── Compute snapshot — just slice the data array ──
  const snapshot: LocalReplaySnapshot<T> = useMemo(() => {
    if (!active || !data.length) {
      return {
        visibleBars: data,
        currentBarIndex: data.length - 1,
        totalBars: data.length,
        progress: 1,
        currentBar: data[data.length - 1] || null,
      };
    }

    const idx = currentIndex;
    return {
      visibleBars: data.slice(0, idx + 1),
      currentBarIndex: idx,
      totalBars: data.length,
      progress: data.length > 1 ? idx / (data.length - 1) : 0,
      currentBar: data[idx] || null,
    };
  }, [data, active, currentIndex]);

  return {
    // State
    active,
    state,
    speed,
    snapshot,

    // Actions
    toggleReplay,
    play,
    pause,
    stepForward,
    stepBackward,
    seekTo,
    changeSpeed,
    reset,
  };
}
