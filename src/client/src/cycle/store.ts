/**
 * Model Cycle client state — one run at a time, fed by the run's SSE stream
 * (`connection.ts`) or rebuilt from the server snapshot after a reload.
 *
 * Bars are the hot path: up to tens of thousands, arriving at up to 20 frames
 * a second. They live in mutable columnar arrays (`bars`) that events append to
 * in place, and `barsVersion` increments on every change. The chart keeps its
 * own "rendered through" index and calls `series.update()` for the new tail
 * only; it must never copy or re-set the whole array per frame. React
 * components that only need a count read `barCount`.
 *
 * Everything else (plan, cursor, scoreboards, trades, epochs, trials) is small
 * and replaced immutably, so ordinary selectors re-render on change.
 *
 * Every event is applied at most once: events carry the protocol envelope's
 * `seq`, and anything at or below `lastSequence` is ignored. That is what makes
 * "load snapshot, then attach the stream (which replays its buffer)" safe.
 *
 * Wire contract: `@shared/cycle/schema`.
 */
import { create } from "zustand";

import {
  appendBars,
  emptyBarColumns,
  type CycleBarColumns,
  type CycleBars,
  type CycleCursor,
  type CycleEpoch,
  type CycleEventPayloads,
  type CycleEventType,
  type CycleLogLine,
  type CyclePlan,
  type CycleRunStatus,
  type CycleScoreboard,
  type CycleSnapshot,
  type CycleTrade,
  type CycleTrial,
} from "@shared/cycle/schema";

/** Terminal lines kept in memory. Older lines drop off the top. */
export const CYCLE_LOG_CAPACITY = 20_000;
/** Running-scoreboard samples kept for the tile sparklines. */
export const CYCLE_HISTORY_CAPACITY = 600;

export type CycleClientStatus = "idle" | "starting" | CycleRunStatus;

export interface ScoreboardSample {
  barsEvaluated: number;
  metrics: Record<string, number | null>;
}

export interface CycleState {
  modelId: string | null;
  modelType: string | null;
  status: CycleClientStatus;
  error: string | null;
  lastSequence: number;

  plan: CyclePlan | null;
  cursor: CycleCursor | null;

  /** Mutable columnar bars — read inside effects/rAF, never spread into props. */
  bars: CycleBarColumns;
  barsVersion: number;
  barCount: number;
  /** Bump when the bar store was replaced wholesale (new run, snapshot): consumers re-set their series. */
  barsEpoch: number;

  trades: CycleTrade[];
  running: CycleScoreboard | null;
  folds: CycleScoreboard[];
  final: CycleScoreboard | null;
  history: ScoreboardSample[];
  epochs: CycleEpoch[];
  trials: CycleTrial[];

  /** Mutable ring of terminal lines + a version counter, like `bars`. */
  logs: CycleLogLine[];
  logsVersion: number;

  /** UI preferences for the run on screen. */
  follow: boolean;
  showOnChart: boolean;

  begin: (modelId: string, modelType: string) => void;
  loadSnapshot: (snapshot: CycleSnapshot) => void;
  applyEvent: (type: string, data: unknown) => void;
  fail: (message: string) => void;
  reset: () => void;
  setFollow: (follow: boolean) => void;
  setShowOnChart: (show: boolean) => void;
}

type Setter = (partial: Partial<CycleState>) => void;

function pushLog(state: CycleState, line: CycleLogLine): void {
  state.logs.push(line);
  if (state.logs.length > CYCLE_LOG_CAPACITY) {
    state.logs.splice(0, state.logs.length - CYCLE_LOG_CAPACITY);
  }
}

function normaliseLevel(level: unknown): CycleLogLine["level"] {
  if (level === "error") return "error";
  if (level === "warn" || level === "warning") return "warn";
  if (level === "debug") return "debug";
  return "info";
}

function sequenceOf(data: unknown): number | null {
  if (data && typeof data === "object" && "seq" in data) {
    const seq = (data as { seq?: unknown }).seq;
    if (typeof seq === "number" && Number.isFinite(seq)) return seq;
  }
  return null;
}

function upsertTrade(trades: CycleTrade[], trade: CycleTrade): CycleTrade[] {
  const index = trades.findIndex((existing) => existing.tradeNumber === trade.tradeNumber);
  if (index < 0) return [...trades, trade];
  const next = trades.slice();
  next[index] = trade;
  return next;
}

function upsertTrial(trials: CycleTrial[], trial: CycleTrial): CycleTrial[] {
  const index = trials.findIndex((existing) => existing.trial === trial.trial);
  if (index < 0) return [...trials, trial];
  const next = trials.slice();
  next[index] = trial;
  return next;
}

function upsertFold(folds: CycleScoreboard[], board: CycleScoreboard): CycleScoreboard[] {
  const next = folds.filter((existing) => existing.foldIndex !== board.foldIndex);
  next.push(board);
  next.sort((a, b) => (a.foldIndex ?? 0) - (b.foldIndex ?? 0));
  return next;
}

function applyCycleEvent<T extends CycleEventType>(
  state: CycleState,
  set: Setter,
  type: T,
  payload: CycleEventPayloads[T],
): void {
  switch (type) {
    case "cycle_plan":
      set({ plan: payload as CyclePlan });
      return;
    case "cycle_bars": {
      const appended = appendBars(state.bars, payload as CycleBars);
      const resolvedAny = (payload as CycleBars).resolved !== undefined;
      if (appended > 0 || resolvedAny) {
        set({ barsVersion: state.barsVersion + 1, barCount: state.bars.timestamps.length });
      }
      return;
    }
    case "cycle_cursor":
      set({ cursor: payload as CycleCursor });
      return;
    case "cycle_epoch":
      set({ epochs: [...state.epochs, payload as CycleEpoch] });
      return;
    case "cycle_trial":
      set({ trials: upsertTrial(state.trials, payload as CycleTrial) });
      return;
    case "cycle_trade":
      set({ trades: upsertTrade(state.trades, payload as CycleTrade) });
      return;
    case "cycle_scoreboard": {
      const board = payload as CycleScoreboard;
      if (board.scope === "running") {
        const history =
          state.history.length >= CYCLE_HISTORY_CAPACITY
            ? [...state.history.slice(1), { barsEvaluated: board.barsEvaluated, metrics: board.metrics }]
            : [...state.history, { barsEvaluated: board.barsEvaluated, metrics: board.metrics }];
        set({ running: board, history });
      } else if (board.scope === "fold") {
        set({ folds: upsertFold(state.folds, board) });
      } else {
        set({ final: board });
      }
      return;
    }
  }
}

const CYCLE_TYPES: ReadonlySet<string> = new Set([
  "cycle_plan",
  "cycle_bars",
  "cycle_cursor",
  "cycle_epoch",
  "cycle_trial",
  "cycle_trade",
  "cycle_scoreboard",
]);

function initialRunState(): Omit<
  CycleState,
  "begin" | "loadSnapshot" | "applyEvent" | "fail" | "reset" | "setFollow" | "setShowOnChart" | "follow" | "showOnChart"
> {
  return {
    modelId: null,
    modelType: null,
    status: "idle",
    error: null,
    lastSequence: -1,
    plan: null,
    cursor: null,
    bars: emptyBarColumns(),
    barsVersion: 0,
    barCount: 0,
    barsEpoch: 0,
    trades: [],
    running: null,
    folds: [],
    final: null,
    history: [],
    epochs: [],
    trials: [],
    logs: [],
    logsVersion: 0,
  };
}

export const useCycleStore = create<CycleState>((set, get) => ({
  ...initialRunState(),
  follow: true,
  showOnChart: true,

  begin: (modelId, modelType) => {
    const previousEpoch = get().barsEpoch;
    set({
      ...initialRunState(),
      modelId,
      modelType,
      status: "starting",
      barsEpoch: previousEpoch + 1,
      showOnChart: true,
      follow: true,
    });
  },

  loadSnapshot: (snapshot) => {
    const previousEpoch = get().barsEpoch;
    const history: ScoreboardSample[] = snapshot.scoreboards.running
      ? [{ barsEvaluated: snapshot.scoreboards.running.barsEvaluated, metrics: snapshot.scoreboards.running.metrics }]
      : [];
    set({
      ...initialRunState(),
      modelId: snapshot.modelId,
      modelType: snapshot.modelType,
      status: snapshot.status,
      error: snapshot.error,
      lastSequence: snapshot.lastSequence,
      plan: snapshot.plan,
      cursor: snapshot.cursor,
      bars: snapshot.bars,
      barCount: snapshot.bars.timestamps.length,
      barsVersion: 1,
      barsEpoch: previousEpoch + 1,
      trades: snapshot.trades,
      running: snapshot.scoreboards.running,
      folds: snapshot.scoreboards.folds,
      final: snapshot.scoreboards.final,
      history,
      epochs: snapshot.epochs,
      trials: snapshot.trials,
      logs: snapshot.logs.slice(-CYCLE_LOG_CAPACITY),
      logsVersion: 1,
    });
  },

  applyEvent: (type, data) => {
    const state = get();
    const seq = sequenceOf(data);
    if (seq !== null) {
      if (seq <= state.lastSequence) return;
      set({ lastSequence: seq });
    }

    if (CYCLE_TYPES.has(type)) {
      if (state.status === "starting") set({ status: "running" });
      applyCycleEvent(get(), set, type as CycleEventType, data as CycleEventPayloads[CycleEventType]);
      return;
    }

    const record = (data ?? {}) as Record<string, unknown>;
    switch (type) {
      case "started":
        if (state.status === "starting" || state.status === "idle") set({ status: "running" });
        return;
      case "log": {
        const message = typeof record.message === "string" ? record.message : "";
        if (!message) return;
        pushLog(get(), { seq, level: normaliseLevel(record.level), message, receivedAt: Date.now() });
        set({ logsVersion: get().logsVersion + 1 });
        return;
      }
      case "error": {
        const message = typeof record.message === "string" ? record.message : "Run failed";
        const stoppedByUser = message === "Training stopped by user";
        pushLog(get(), { seq, level: "error", message, receivedAt: Date.now() });
        const details = typeof record.details === "string" && record.details ? record.details : null;
        if (details) pushLog(get(), { seq, level: "error", message: details, receivedAt: Date.now() });
        set({
          status: stoppedByUser ? "stopped" : "failed",
          error: stoppedByUser ? null : message,
          logsVersion: get().logsVersion + 1,
        });
        return;
      }
      case "done": {
        const diagnostics = (record.diagnostics ?? {}) as Record<string, unknown>;
        set({ status: diagnostics.stopped === true ? "stopped" : "complete" });
        return;
      }
      default:
        return;
    }
  },

  fail: (message) => {
    pushLog(get(), { seq: null, level: "error", message, receivedAt: Date.now() });
    set({ status: "failed", error: message, logsVersion: get().logsVersion + 1 });
  },

  reset: () => {
    const previousEpoch = get().barsEpoch;
    set({ ...initialRunState(), barsEpoch: previousEpoch + 1 });
  },

  setFollow: (follow) => set({ follow }),
  setShowOnChart: (showOnChart) => set({ showOnChart }),
}));

/** True while a run is starting or streaming. */
export function isCycleActive(status: CycleClientStatus): boolean {
  return status === "starting" || status === "running";
}
