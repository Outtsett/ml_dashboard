/**
 * useTrainingReattach — adopt a server-side training run after a page reload.
 *
 * Training lives in the server process, not in the tab: `POST /api/training/start`
 * spawns the Python child, and `GET /api/training/stream/:modelId` buffers every
 * event so a client that disconnects (F5, crash, closed laptop) can come back and
 * replay from the beginning. Nothing on the server dies when the EventSource
 * closes. The only missing piece was that the client never asked on mount.
 *
 * This hook asks exactly once: `GET /api/training/status` → `{ sessions: [...] }`.
 * It hands the caller the single run this tab should adopt and returns the other
 * live runs rather than pretending they do not exist.
 */

import { useEffect, useRef, useState } from "react";
import { trainingApi } from "@/infrastructure/api/api_service";
import { logWarn } from "@/infrastructure/lib/error_logger";

/**
 * One row of `GET /api/training/status`, as built by `listTrainingSessions()`
 * in apps/api/training/orchestrator.ts. Note what is NOT here: `sessionId`
 * and the original `TrainingRequest`. `sessionId` arrives instead on the
 * replayed `started` SSE event; the hyperparameters are simply not recoverable
 * from this endpoint, so a reattached run reports the three fields it can
 * prove (modelType, symbol, timeframe) and leaves the rest unset.
 */
export interface ActiveTrainingSession {
  modelId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  /** Seconds since the server spawned the run. */
  elapsedSeconds: number;
  finished: boolean;
  eventCount: number;
}

export interface UseTrainingReattachOptions {
  /**
   * The modelId this tab already owns, or null. Read at probe-resolution time,
   * not at mount time: the user can press Run while the status request is in
   * flight, and that run must not be second-guessed by a stale probe.
   */
  currentModelId: () => string | null;
  /** Invoked at most once, with the single session this tab adopts. */
  onReattach: (session: ActiveTrainingSession) => void;
}

export interface UseTrainingReattachResult {
  /** False until the status probe has resolved or failed. */
  reattachChecked: boolean;
  /**
   * Live server-side runs this tab is NOT driving. Surfaced so a second
   * concurrent run is visible instead of silently discarded.
   */
  otherActiveSessions: ActiveTrainingSession[];
}

/** Narrow an untyped status row; a malformed row is dropped, not guessed at. */
function toActiveSession(raw: unknown): ActiveTrainingSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.modelId !== "string" || r.modelId.length === 0) return null;
  return {
    modelId: r.modelId,
    modelType: typeof r.modelType === "string" ? r.modelType : "",
    symbol: typeof r.symbol === "string" ? r.symbol : "",
    timeframe: typeof r.timeframe === "string" ? r.timeframe : "",
    elapsedSeconds: typeof r.elapsed === "number" ? r.elapsed : 0,
    finished: r.finished === true,
    eventCount: typeof r.eventCount === "number" ? r.eventCount : 0,
  };
}

export function useTrainingReattach(
  options: UseTrainingReattachOptions,
): UseTrainingReattachResult {
  const [reattachChecked, setReattachChecked] = useState(false);
  const [otherActiveSessions, setOtherActiveSessions] = useState<ActiveTrainingSession[]>([]);

  // Latest callbacks without re-running the mount effect.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // StrictMode mounts effects twice in development. One probe, one adoption.
  const probedRef = useRef(false);

  useEffect(() => {
    if (probedRef.current) return;
    probedRef.current = true;

    let cancelled = false;

    void (async () => {
      let rows: unknown[] = [];
      try {
        const payload = await trainingApi.getStatus() as { sessions?: unknown };
        rows = Array.isArray(payload?.sessions) ? payload.sessions : [];
      } catch (err) {
        // A dead status endpoint must not block the page — the user can still
        // start a run; they just do not inherit the old one.
        logWarn("useTrainingReattach", "training status probe failed", { error: String(err) });
      }
      if (cancelled) return;

      // `finished` sessions linger in the server's map for a while. Adopting one
      // would flip the UI to "running" for a run that is already over AND make
      // the EventSource replay-then-close in a reconnect loop, so they are left out.
      const live = rows
        .map(toActiveSession)
        .filter((s): s is ActiveTrainingSession => s !== null && !s.finished)
        // Deterministic: most recently started first (smallest elapsed),
        // modelId as the tie-break so two runs started in the same millisecond
        // still resolve the same way on every reload.
        .sort((a, b) => (a.elapsedSeconds - b.elapsedSeconds) || a.modelId.localeCompare(b.modelId));

      const ownedModelId = optionsRef.current.currentModelId();
      const notOurs = live.filter((s) => s.modelId !== ownedModelId);

      if (!ownedModelId && notOurs.length > 0) {
        setOtherActiveSessions(notOurs.slice(1));
        optionsRef.current.onReattach(notOurs[0]!);
      } else {
        // This tab started its own run while the probe was in flight — keep it
        // and report every other live run.
        setOtherActiveSessions(notOurs);
      }

      setReattachChecked(true);
    })();

    return () => { cancelled = true; };
  }, []);

  return { reattachChecked, otherActiveSessions };
}
