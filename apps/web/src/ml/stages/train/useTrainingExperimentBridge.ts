/**
 * useTrainingExperimentBridge — W4.d
 *
 * Bridges the global training SSE stream (TrainingContext) into the
 * /ml-studio ExperimentLedger by dispatching `updateExperiment` actions
 * onto MLStudioContext as live events arrive.
 *
 * The current useTrainingLive() / useTrainingControl() surfaces expose
 * already-processed state (metrics map, iterationHistory, phase, error,
 * completedModelId, diagnostics) rather than a raw event[] feed. The
 * bridge derives transitions from changes in that state:
 *
 *   running   <- training.isTraining flipped from false -> true
 *                AND training.sessionId === experiment.trainingSessionId
 *   foldMetrics  <- new entries appended to live.iterationHistory whose
 *                   metric keys match `fold_<i>_<name>` (parseFoldMetricKey)
 *   done      <- training.completedModelId becomes non-null
 *                OR training.phase === "complete"
 *   failed    <- training.error becomes non-null
 *
 * Race-safety per section 5.3 of the plan:
 *   - Only the experiment whose trainingSessionId === currentSessionId is
 *     ever patched. A 30s server hydrate of OTHER experiments cannot clobber
 *     this one (W4.c reducer also enforces "prefer local while running").
 *   - Each transition is gated by a per-(sessionId, transition-key) ref so
 *     re-renders don't re-dispatch the same patch.
 *   - History rows are processed by their last-iteration cursor; only rows
 *     newer than the cursor produce dispatches.
 */

import { useEffect, useRef } from "react";
import { useMLStudio } from "../../MLStudioContext";
import {
  useTrainingControl,
  useTrainingLive,
} from "@/training/lib/TrainingContext";
import {
  applyFoldComplete,
  deriveSummaryFromFolds,
  mergeFoldMetric,
  parseFoldMetricKey,
  type ExperimentRecord,
  type FoldMetric,
} from "../../experimentTypes";

/**
 * Pull a `diagnostics_path` (or `diagnosticsPath`) string out of the
 * arbitrary diagnostics payload emitted on the `done` event. Returns
 * null if absent or malformed.
 */
function extractDiagnosticsPath(diagnostics: unknown): string | null {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const obj = diagnostics as Record<string, unknown>;
  const path = obj.diagnostics_path ?? obj.diagnosticsPath ?? obj.path;
  return typeof path === "string" ? path : null;
}

const FOLD_COMPLETE_KEY_RE = /^fold[_-](\d+)[_-]complete$/i;

/**
 * Detect whether an iteration-history row corresponds to a `fold_complete`
 * server event. Server runners emit a sentinel `fold_<i>_complete: 1` plus
 * the per-fold metric siblings; we treat the structured siblings as the
 * source of truth and let applyFoldComplete merge them.
 */
function isFoldCompleteRow(metrics: Record<string, number>): {
  foldIdx: number;
  metrics: Record<string, number>;
} | null {
  const sentinel = Object.keys(metrics).find((k) => FOLD_COMPLETE_KEY_RE.test(k));
  if (!sentinel) return null;
  const m = sentinel.match(FOLD_COMPLETE_KEY_RE);
  if (!m) return null;
  const foldIdx = Number(m[1]);
  if (!Number.isFinite(foldIdx) || foldIdx < 0) return null;
  // Strip everything that doesn't belong to this fold.
  const out: Record<string, number> = {};
  const prefix1 = `fold_${foldIdx}_`;
  const prefix2 = `fold-${foldIdx}-`;
  for (const [k, v] of Object.entries(metrics)) {
    if (typeof v !== "number") continue;
    if (k === sentinel) continue;
    if (k.startsWith(prefix1)) {
      out[k.slice(prefix1.length)] = v;
    } else if (k.startsWith(prefix2)) {
      out[k.slice(prefix2.length)] = v;
    }
  }
  return { foldIdx, metrics: out };
}

interface BridgeCursor {
  sessionId: string;
  // Highest iteration (rounded down to int) we've already merged into
  // the experiment's foldMetrics. -1 means nothing processed yet.
  lastIteration: number;
  // Set true once we've dispatched the running transition.
  startedDispatched: boolean;
  // Set true once we've dispatched the terminal (done | failed) transition.
  terminalDispatched: boolean;
}

/**
 * The bridge hook. Mount once inside <TrainStage> via the zero-render
 * <TrainingExperimentBridge/> wrapper.
 */
export function useTrainingExperimentBridge(): void {
  const { state, dispatch } = useMLStudio();
  const training = useTrainingControl();
  const live = useTrainingLive();

  const cursorRef = useRef<BridgeCursor | null>(null);

  // Reset the cursor whenever the active sessionId changes (new training
  // run, or the user navigated away and back).
  useEffect(() => {
    if (training.sessionId !== cursorRef.current?.sessionId) {
      cursorRef.current = training.sessionId
        ? {
            sessionId: training.sessionId,
            lastIteration: -1,
            startedDispatched: false,
            terminalDispatched: false,
          }
        : null;
    }
  }, [training.sessionId]);

  useEffect(() => {
    const sessionId = training.sessionId;
    if (!sessionId) return;
    const cursor = cursorRef.current;
    if (!cursor || cursor.sessionId !== sessionId) return;

    // Find the experiment row this session belongs to. Exact-match on
    // trainingSessionId — never broadcast to other rows.
    const exp = state.experiments.find((e) => e.trainingSessionId === sessionId);
    if (!exp) return;

    // 1. queued -> running transition
    if (
      !cursor.startedDispatched &&
      training.isTraining &&
      (exp.status === "queued" || exp.status === "proposed")
    ) {
      cursor.startedDispatched = true;
      const patch: Partial<ExperimentRecord> = {
        status: "running",
        startedAt: exp.startedAt ?? new Date().toISOString(),
        modelId: training.modelId ?? exp.modelId,
      };
      dispatch({ type: "updateExperiment", id: exp.id, patch });
    }

    // 2. Per-fold metric updates from iterationHistory.
    //
    // Walk new history rows (those with iteration > cursor.lastIteration).
    // For each row:
    //   - If it looks like a fold_complete sentinel, applyFoldComplete with
    //     the structured metrics dict.
    //   - Otherwise, scan keys for fold_<i>_<name> patterns and merge each.
    //
    // We compute the next foldMetrics array purely from cursor + new rows
    // and dispatch ONE patch per render cycle to keep dispatch traffic
    // bounded. Reducer applies it in O(1).
    if (live.iterationHistory.length > 0) {
      let nextFolds: FoldMetric[] = exp.foldMetrics;
      let advancedCursor = cursor.lastIteration;
      let mutated = false;

      for (const row of live.iterationHistory) {
        if (row.iteration <= cursor.lastIteration) continue;
        advancedCursor = Math.max(advancedCursor, row.iteration);

        const foldComplete = isFoldCompleteRow(row.metrics);
        if (foldComplete) {
          const before = nextFolds;
          nextFolds = applyFoldComplete(nextFolds, foldComplete.foldIdx, foldComplete.metrics);
          if (nextFolds !== before) mutated = true;
          continue;
        }

        for (const [key, value] of Object.entries(row.metrics)) {
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          const parsed = parseFoldMetricKey(key);
          if (!parsed) continue;
          const before = nextFolds;
          nextFolds = mergeFoldMetric(nextFolds, parsed.foldIdx, parsed.field, value);
          if (nextFolds !== before) mutated = true;
        }
      }

      if (advancedCursor > cursor.lastIteration) {
        cursor.lastIteration = advancedCursor;
      }
      if (mutated) {
        dispatch({
          type: "updateExperiment",
          id: exp.id,
          patch: { foldMetrics: nextFolds },
        });
        // Update local exp.foldMetrics for downstream summary derivation in
        // the same effect tick (read-after-write within this closure).
        exp.foldMetrics = nextFolds;
      }
    }

    // 3. done transition
    if (
      !cursor.terminalDispatched &&
      training.completedModelId &&
      !training.error
    ) {
      cursor.terminalDispatched = true;
      const summary = deriveSummaryFromFolds(exp.foldMetrics);
      const patch: Partial<ExperimentRecord> = {
        status: "done",
        completedAt: new Date().toISOString(),
        modelId: training.completedModelId,
        summary,
        diagnosticsPath: extractDiagnosticsPath(live.diagnostics),
      };
      dispatch({ type: "updateExperiment", id: exp.id, patch });
      return;
    }

    // 4. failed transition
    if (!cursor.terminalDispatched && training.error) {
      cursor.terminalDispatched = true;
      const patch: Partial<ExperimentRecord> = {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: training.error,
      };
      dispatch({ type: "updateExperiment", id: exp.id, patch });
    }
  }, [
    training.sessionId,
    training.isTraining,
    training.completedModelId,
    training.error,
    training.modelId,
    live.iterationHistory,
    live.diagnostics,
    state.experiments,
    dispatch,
  ]);
}
