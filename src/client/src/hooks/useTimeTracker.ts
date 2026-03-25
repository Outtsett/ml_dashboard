import { useState, useEffect, useRef, useCallback } from "react";

const FLUSH_INTERVAL_MS = 30_000;

function flushTime(lessonId: string, timeMs: number) {
  if (timeMs <= 0) return;
  fetch("/api/curriculum/time", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonId, timeMs }),
  }).catch(() => {});
}

export function useTimeTracker(lessonId: string) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isTracking, setIsTracking] = useState(true);

  const accumulatedRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lessonIdRef = useRef(lessonId);

  // Flush accumulated time to server
  const flush = useCallback(() => {
    if (accumulatedRef.current > 0) {
      flushTime(lessonIdRef.current, accumulatedRef.current);
      accumulatedRef.current = 0;
    }
  }, []);

  // Reset when lessonId changes
  useEffect(() => {
    // Flush any remaining time from previous lesson
    if (lessonIdRef.current !== lessonId && accumulatedRef.current > 0) {
      flushTime(lessonIdRef.current, accumulatedRef.current);
      accumulatedRef.current = 0;
    }
    lessonIdRef.current = lessonId;
    setElapsedMs(0);
    setIsTracking(true);
  }, [lessonId]);

  // Main tracking loop
  useEffect(() => {
    const TICK_MS = 1000;

    // 1-second tick for UI updates and accumulation
    tickRef.current = setInterval(() => {
      setElapsedMs((prev) => prev + TICK_MS);
      accumulatedRef.current += TICK_MS;
    }, TICK_MS);

    // 30-second flush to server
    intervalRef.current = setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Flush remaining time on unmount
      flush();
    };
  }, [lessonId, flush]);

  // Pause/resume on visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        // Pause: clear intervals and flush
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        flush();
        setIsTracking(false);
      } else {
        // Resume: restart intervals
        const TICK_MS = 1000;
        if (!tickRef.current) {
          tickRef.current = setInterval(() => {
            setElapsedMs((prev) => prev + TICK_MS);
            accumulatedRef.current += TICK_MS;
          }, TICK_MS);
        }
        if (!intervalRef.current) {
          intervalRef.current = setInterval(flush, FLUSH_INTERVAL_MS);
        }
        setIsTracking(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [flush]);

  return { elapsedMs, isTracking };
}
