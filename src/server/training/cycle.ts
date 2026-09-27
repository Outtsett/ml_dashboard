/**
 * Model Cycle accumulator — per-run state built from the domain event bus,
 * exactly the way `trainingStorage.ensureTrainingMetricRecorder()` subscribes
 * to `"training.event"` (`src/server/infrastructure/storage/trainingStorage.ts`).
 *
 * Every parsed training event — including the seven `cycle_*` events the
 * parser (`runners/parsers/generated.ts`) now validates against
 * `@shared/cycle/schema` — is republished on the bus by `emitSessionEvent`.
 * This module is the second, independent subscriber: it folds that stream
 * into a `CycleSnapshot` per model so a page reload (or a client that never
 * held the 1000-event SSE ring buffer) can rebuild the panel and chart from
 * `GET /api/training/cycle/:modelId` instead.
 *
 * Design: `docs/plans/2026-09-25-model-cycle.md`. Wire contract:
 * `@shared/cycle/schema`.
 */

import type { DomainEvent } from "@shared/event-types";
import {
  appendBars,
  emptyBarColumns,
  type CycleBarColumns,
  type CycleBars,
  type CycleCursor,
  type CycleEpoch,
  type CycleLogLine,
  type CyclePlan,
  type CycleRunStatus,
  type CycleRunSummary,
  type CycleScoreboard,
  type CycleSnapshot,
  type CycleTrade,
  type CycleTrial,
  type CycleParameters,
  isCycleEventType,
} from "@shared/cycle/schema";
import { getEventBus } from "../infrastructure/events";
import { refreshDerivedViews } from "../infrastructure/database/questdb";

/** How many `cycle_*` runs' state is kept in memory at once. */
const MAX_TRACKED_RUNS = 5;
/** Matches `CycleState.CYCLE_LOG_CAPACITY` on the client. */
const MAX_LOG_LINES = 5000;
/** The runner-key suffix every Model Cycle composite modelType ends with. */
const CYCLE_MODEL_TYPE_SUFFIX = "+walk_forward_cycle";

interface CycleRunState {
  modelId: string;
  modelType: string;
  status: CycleRunStatus;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  lastSequence: number;
  plan: CyclePlan | null;
  cursor: CycleCursor | null;
  bars: CycleBarColumns;
  /** Latest state per trade number — `cycle_trade` re-sends the same trade on close. */
  trades: Map<number, CycleTrade>;
  runningScoreboard: CycleScoreboard | null;
  /** Latest scoreboard per fold. */
  foldScoreboards: Map<number, CycleScoreboard>;
  finalScoreboard: CycleScoreboard | null;
  epochs: CycleEpoch[];
  /** Latest state per (fold, trial number) — a trial reports running, then complete; numbering restarts every fold. */
  trials: Map<string, CycleTrial>;
  /** Per fold: the hyperparameters its models were fitted with (`cycle_parameters`). */
  parameters: Map<number, CycleParameters>;
  logs: CycleLogLine[];
}

function trialKey(trial: CycleTrial): string {
  return `${trial.foldIndex ?? -1}:${trial.trial}`;
}

function newRunState(modelId: string, modelType: string, startedAt: number): CycleRunState {
  return {
    modelId,
    modelType,
    status: "running",
    startedAt,
    finishedAt: null,
    error: null,
    lastSequence: -1,
    plan: null,
    cursor: null,
    bars: emptyBarColumns(),
    trades: new Map(),
    runningScoreboard: null,
    foldScoreboards: new Map(),
    finalScoreboard: null,
    epochs: [],
    trials: new Map(),
    parameters: new Map(),
    logs: [],
  };
}

/** Insertion-ordered — the oldest entry is evicted first once the cap is hit. */
const runs = new Map<string, CycleRunState>();

function pushLog(run: CycleRunState, line: CycleLogLine): void {
  run.logs.push(line);
  if (run.logs.length > MAX_LOG_LINES) {
    run.logs.splice(0, run.logs.length - MAX_LOG_LINES);
  }
}

function sequenceOf(data: Record<string, unknown>): number | null {
  const seq = data.seq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : null;
}

function normaliseLevel(level: unknown): CycleLogLine["level"] {
  if (level === "error") return "error";
  if (level === "warn" || level === "warning") return "warn";
  if (level === "debug") return "debug";
  return "info";
}

function evictOldestIfOverCapacity(): void {
  while (runs.size > MAX_TRACKED_RUNS) {
    const oldestKey = runs.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    runs.delete(oldestKey);
  }
}

function getOrTrackRun(modelId: string, modelType: string, startedAt: number): CycleRunState {
  let run = runs.get(modelId);
  if (!run) {
    run = newRunState(modelId, modelType, startedAt);
    runs.set(modelId, run);
    evictOldestIfOverCapacity();
  }
  return run;
}

function applyCycleTypedEvent(run: CycleRunState, type: string, data: Record<string, unknown>): void {
  switch (type) {
    case "cycle_plan":
      run.plan = data as unknown as CyclePlan;
      return;
    case "cycle_bars":
      appendBars(run.bars, data as unknown as CycleBars);
      return;
    case "cycle_cursor":
      run.cursor = data as unknown as CycleCursor;
      return;
    case "cycle_epoch":
      run.epochs.push(data as unknown as CycleEpoch);
      return;
    case "cycle_trial": {
      const trial = data as unknown as CycleTrial;
      run.trials.set(trialKey(trial), trial);
      return;
    }
    case "cycle_parameters": {
      const parameters = data as unknown as CycleParameters;
      run.parameters.set(parameters.foldIndex ?? -1, parameters);
      return;
    }
    case "cycle_trade": {
      const trade = data as unknown as CycleTrade;
      run.trades.set(trade.tradeNumber, trade);
      return;
    }
    case "cycle_scoreboard": {
      const board = data as unknown as CycleScoreboard;
      if (board.scope === "running") {
        run.runningScoreboard = board;
      } else if (board.scope === "fold") {
        if (board.foldIndex !== null) run.foldScoreboards.set(board.foldIndex, board);
      } else {
        run.finalScoreboard = board;
      }
      return;
    }
    default:
      return;
  }
}

function finishRun(run: CycleRunState, status: CycleRunStatus, error: string | null, finishedAt: number): void {
  // The first terminal state wins. A user stop kills the process, and the
  // runner then reports the kill's non-zero exit as a second, generic
  // "Training failed (exit code …)" error, which must not relabel the stop.
  if (run.status !== "running") return;
  run.status = status;
  run.error = error;
  run.finishedAt = finishedAt;
  // the process landed its record tables while it ran; the serving views for
  // any table landed for the first time exist once the manifests are re-read
  void refreshDerivedViews().catch((refreshError) => {
    console.warn(`[cycle] derived views not refreshed after ${run.modelId}: ${String(refreshError)}`);
  });
}

/**
 * Fold one `"training.event"` domain event into run state. Exported (in
 * addition to `ensureCycleAccumulator`, which wires this to the live bus) so
 * tests can drive the accumulator directly and synchronously, without
 * depending on `EventBus`/`EventEmitter2` delivery timing.
 */
export function handleTrainingEvent(domainEvent: DomainEvent): void {
  const envelope = domainEvent.data as {
    modelId?: string;
    type?: string;
    data?: Record<string, unknown>;
    ts?: number;
  };
  const modelId = envelope.modelId;
  const type = envelope.type;
  if (!modelId || !type) return;
  const data = envelope.data ?? {};
  const eventTs = typeof envelope.ts === "number" ? envelope.ts : Date.now();

  let run = runs.get(modelId);

  if (!run) {
    // Track a cycle run as soon as we know it is one: either its "started"
    // event names a `+walk_forward_cycle` runner, or (defensively, in case
    // "started" was missed) the very first `cycle_*` event arrives.
    if (type === "started") {
      const modelType = typeof data.modelType === "string" ? data.modelType : "";
      if (modelType.endsWith(CYCLE_MODEL_TYPE_SUFFIX)) {
        getOrTrackRun(modelId, modelType, eventTs);
      }
      return;
    }
    if (!isCycleEventType(type)) return;
    run = getOrTrackRun(modelId, "", eventTs);
  }

  // Duplicate seq (an SSE reconnect replay, or the same event reaching the
  // bus twice) is ignored outright — every field below is applied at most
  // once per envelope seq, mirroring the client store's dedupe.
  const seq = sequenceOf(data);
  if (seq !== null) {
    if (seq <= run.lastSequence) return;
    run.lastSequence = seq;
  }

  if (isCycleEventType(type)) {
    applyCycleTypedEvent(run, type, data);
    return;
  }

  switch (type) {
    case "log": {
      const message = typeof data.message === "string" ? data.message : "";
      if (message) pushLog(run, { seq, level: normaliseLevel(data.level), message, receivedAt: Date.now() });
      return;
    }
    case "error": {
      const message = typeof data.message === "string" ? data.message : "Run failed";
      const stoppedByUser = message === "Training stopped by user";
      pushLog(run, { seq, level: "error", message, receivedAt: Date.now() });
      finishRun(run, stoppedByUser ? "stopped" : "failed", stoppedByUser ? null : message, eventTs);
      return;
    }
    case "done": {
      const diagnostics = (data.diagnostics ?? {}) as Record<string, unknown>;
      finishRun(run, diagnostics.stopped === true ? "stopped" : "complete", null, eventTs);
      return;
    }
    default:
      return;
  }
}

let subscribed = false;

/**
 * Subscribe this accumulator to the domain event bus. Idempotent, mirrors
 * `trainingStorage.ensureTrainingMetricRecorder()`.
 */
export function ensureCycleAccumulator(): void {
  if (subscribed) return;
  subscribed = true;
  getEventBus().on("training.event", handleTrainingEvent);
}

function toScoreboards(run: CycleRunState): CycleSnapshot["scoreboards"] {
  return {
    running: run.runningScoreboard,
    folds: [...run.foldScoreboards.values()].sort((a, b) => (a.foldIndex ?? 0) - (b.foldIndex ?? 0)),
    final: run.finalScoreboard,
  };
}

function toSnapshot(run: CycleRunState): CycleSnapshot {
  return {
    modelId: run.modelId,
    modelType: run.modelType,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    lastSequence: run.lastSequence,
    plan: run.plan,
    cursor: run.cursor,
    bars: run.bars,
    trades: [...run.trades.values()].sort((a, b) => a.tradeNumber - b.tradeNumber),
    scoreboards: toScoreboards(run),
    epochs: run.epochs,
    trials: [...run.trials.values()].sort((a, b) => (a.foldIndex ?? -1) - (b.foldIndex ?? -1) || a.trial - b.trial),
    parameters: [...run.parameters.values()].sort((a, b) => (a.foldIndex ?? -1) - (b.foldIndex ?? -1)),
    logs: run.logs,
  };
}

/** `GET /api/training/cycle/:modelId` — the panel/chart rebuild source after a reload. */
export function getCycleSnapshot(modelId: string): CycleSnapshot | null {
  const run = runs.get(modelId);
  return run ? toSnapshot(run) : null;
}

/** `GET /api/training/cycle` — the 5 most recently started tracked runs, newest first. */
export function listCycleRuns(): CycleRunSummary[] {
  return [...runs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((run) => ({
      modelId: run.modelId,
      modelType: run.modelType,
      symbol: run.plan?.symbol ?? null,
      timeframe: run.plan?.timeframe ?? null,
      modelFamily: run.plan?.modelFamily ?? null,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      barCount: run.bars.timestamps.length,
      tradeCount: run.trades.size,
    }));
}

/** Test hook — clears all tracked run state and the subscription flag. */
export function resetCycleAccumulatorForTests(): void {
  runs.clear();
  subscribed = false;
}
