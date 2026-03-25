import { useState, useEffect, useRef, useCallback } from "react";
import { setFetchListener } from "@/lib/queryClient";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpeedEntry {
  url?: string;
  filename?: string;
  sizeBytes: number | null;
  durationMs: number;
  throughputMBps?: number;
  timestamp: number;
  type: "api" | "upload" | "download";
}

export interface SpeedMetrics {
  entries: SpeedEntry[];
  avgApiLatency: number;
  p95ApiLatency: number;
  avgUploadSpeed: number;
  avgDownloadSpeed: number;
  pageLoadTime: number;
  ttfb: number;
  lcp: number | null;
  fid: number | null;
  cls: number | null;
  trackFetch: (url: string, durationMs: number, sizeBytes: number | null) => void;
  trackUpload: (filename: string, sizeBytes: number, durationMs: number) => void;
  trackDownload: (url: string, sizeBytes: number, durationMs: number) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 200;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export default function useSpeedAudit(): SpeedMetrics {
  const entriesRef = useRef<SpeedEntry[]>([]);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  // Navigation timing (collected once on mount)
  const [navTiming, setNavTiming] = useState({ pageLoadTime: 0, ttfb: 0, domInteractive: 0, domContentLoaded: 0 });

  // Web Vitals state
  const [lcp, setLcp] = useState<number | null>(null);
  const [fid, setFid] = useState<number | null>(null);
  const [cls, setCls] = useState<number | null>(null);

  // ── Page navigation timing ────────────────────────────────────────────
  useEffect(() => {
    const collect = () => {
      const entries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (entries.length === 0) return;
      const nav = entries[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return;
      setNavTiming({
        pageLoadTime: nav.loadEventEnd - nav.startTime,
        ttfb: nav.responseStart - nav.requestStart,
        domInteractive: nav.domInteractive - nav.startTime,
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
      });
    };
    // Navigation entries may not be available immediately
    if (document.readyState === "complete") {
      collect();
    } else {
      window.addEventListener("load", collect, { once: true });
      return () => window.removeEventListener("load", collect);
    }
  }, []);

  // ── Web Vitals observers ──────────────────────────────────────────────
  useEffect(() => {
    const observers: PerformanceObserver[] = [];
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) setLcp(last.startTime);
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(lcpObs);
    } catch { /* not supported */ }

    try {
      const fidObs = new PerformanceObserver((list) => {
        const entries = list.getEntries() as PerformanceEventTiming[];
        const first = entries[0];
        if (first) setFid(first.processingStart - first.startTime);
      });
      fidObs.observe({ type: "first-input", buffered: true });
      observers.push(fidObs);
    } catch { /* not supported */ }

    try {
      let clsValue = 0;
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
            clsValue += (entry as PerformanceEntry & { value: number }).value;
          }
        }
        setCls(clsValue);
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
      observers.push(clsObs);
    } catch { /* not supported */ }

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  // ── Tracking functions ────────────────────────────────────────────────
  const pushEntry = useCallback(
    (entry: SpeedEntry) => {
      const arr = entriesRef.current;
      arr.push(entry);
      if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
      bump();
    },
    [bump],
  );

  const trackFetch = useCallback(
    (url: string, durationMs: number, sizeBytes: number | null) => {
      pushEntry({ url, durationMs, sizeBytes, timestamp: Date.now(), type: "api" });
    },
    [pushEntry],
  );

  const trackUpload = useCallback(
    (filename: string, sizeBytes: number, durationMs: number) => {
      pushEntry({
        filename,
        sizeBytes,
        durationMs,
        throughputMBps: sizeBytes / durationMs / 1024,
        timestamp: Date.now(),
        type: "upload",
      });
    },
    [pushEntry],
  );

  const trackDownload = useCallback(
    (url: string, sizeBytes: number, durationMs: number) => {
      pushEntry({
        url,
        sizeBytes,
        durationMs,
        throughputMBps: sizeBytes / durationMs / 1024,
        timestamp: Date.now(),
        type: "download",
      });
    },
    [pushEntry],
  );

  // ── Wire up the global fetch listener ─────────────────────────────────
  useEffect(() => {
    setFetchListener(trackFetch);
    return () => setFetchListener(null);
  }, [trackFetch]);

  // ── Computed metrics ──────────────────────────────────────────────────
  const entries = entriesRef.current;
  const apiEntries = entries.filter((e) => e.type === "api");
  const uploadEntries = entries.filter((e) => e.type === "upload");
  const downloadEntries = entries.filter((e) => e.type === "download");

  const apiDurations = apiEntries.map((e) => e.durationMs);
  const sortedApiDurations = [...apiDurations].sort((a, b) => a - b);

  return {
    entries: [...entries],
    avgApiLatency: avg(apiDurations),
    p95ApiLatency: percentile(sortedApiDurations, 95),
    avgUploadSpeed: avg(uploadEntries.map((e) => e.throughputMBps ?? 0)),
    avgDownloadSpeed: avg(downloadEntries.map((e) => e.throughputMBps ?? 0)),
    pageLoadTime: navTiming.pageLoadTime,
    ttfb: navTiming.ttfb,
    lcp,
    fid,
    cls,
    trackFetch,
    trackUpload,
    trackDownload,
  };
}
