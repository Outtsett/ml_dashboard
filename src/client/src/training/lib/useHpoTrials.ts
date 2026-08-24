/**
 * useHpoTrials — subscribe to /api/hpo/stream/:sessionId SSE and build a
 * flat trial list with params + best score per trial.
 *
 * Each ParallelCoords / ContourPlot / SlicePlot / BestSoFarLine inside HpoDetail
 * shares this hook so we open exactly one EventSource per session — not four.
 */

import { useEffect, useMemo, useState } from "react";

export type HpoTrialStatus =
  | "running"
  | "completed"
  | "pruned"
  | "killed"
  | "failed";

export interface HpoTrial {
  trialId: number;
  fold?: number;
  status: HpoTrialStatus;
  params: Record<string, number | string | boolean>;
  /** Final objective score (set on `hpo-trial-done`). */
  score: number | null;
  startedAt: number;
  finishedAt: number | null;
  durationSec: number | null;
}

interface SseEventData {
  trialId: number;
  fold?: number;
  params?: Record<string, number | string | boolean>;
  score?: number;
  durationSec?: number;
}

export function useHpoTrials(sessionId: string | null | undefined): HpoTrial[] {
  const [trials, setTrials] = useState<Map<number, HpoTrial>>(new Map());

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/hpo/stream/${sessionId}`);

    const onStart = (msg: MessageEvent) => {
      try {
        const d: SseEventData = JSON.parse(msg.data);
        setTrials((prev) => {
          const next = new Map(prev);
          next.set(d.trialId, {
            trialId: d.trialId,
            fold: d.fold,
            status: "running",
            params: d.params ?? {},
            score: null,
            startedAt: Date.now(),
            finishedAt: null,
            durationSec: null,
          });
          return next;
        });
      } catch {
        // ignore malformed event
      }
    };

    const onUpdate = (status: HpoTrialStatus) => (msg: MessageEvent) => {
      try {
        const d: SseEventData = JSON.parse(msg.data);
        setTrials((prev) => {
          const next = new Map(prev);
          const cur: HpoTrial = next.get(d.trialId) ?? {
            trialId: d.trialId,
            fold: d.fold,
            status,
            params: d.params ?? {},
            score: null,
            startedAt: Date.now(),
            finishedAt: null,
            durationSec: null,
          };
          cur.status = status;
          if (typeof d.score === "number") cur.score = d.score;
          if (typeof d.durationSec === "number") cur.durationSec = d.durationSec;
          if (d.params) cur.params = { ...cur.params, ...d.params };
          if (cur.finishedAt == null) cur.finishedAt = Date.now();
          next.set(d.trialId, cur);
          return next;
        });
      } catch {
        // ignore
      }
    };

    es.addEventListener("hpo-trial-start", onStart as EventListener);
    es.addEventListener("hpo-trial-done", onUpdate("completed") as EventListener);
    es.addEventListener("hpo-trial-pruned", onUpdate("pruned") as EventListener);
    es.addEventListener("hpo-trial-killed", onUpdate("killed") as EventListener);
    es.addEventListener("hpo-trial-failed", onUpdate("failed") as EventListener);

    return () => es.close();
  }, [sessionId]);

  return useMemo(
    () => Array.from(trials.values()).sort((a, b) => a.trialId - b.trialId),
    [trials],
  );
}

/** Discover the numeric param names present across a trial set. Used by all
 *  the new viz components to decide which axes to render. */
export function numericParamNames(trials: HpoTrial[]): string[] {
  const set = new Set<string>();
  for (const t of trials) {
    for (const [k, v] of Object.entries(t.params)) {
      if (typeof v === "number" && Number.isFinite(v)) set.add(k);
    }
  }
  return Array.from(set).sort();
}

export function getParamValue(t: HpoTrial, key: string): number | null {
  const v = t.params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
