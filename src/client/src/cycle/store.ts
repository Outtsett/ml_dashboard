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
  /** A bar a table row asked the chart to jump to (epoch seconds); the chart clears it after scrolling. */
  focusTimestamp: number | null;

  begin: (modelId: string, modelType: string) => void;
  loadSnapshot: (snapshot: CycleSnapshot) => void;
  applyEvent: (type: string, data: unknown) => void;
  /** Apply a batch of events with one state update (what the stream uses). */
  applyEvents: (events: ReadonlyArray<{ type: string; data: unknown }>) => void;
  fail: (message: string) => void;
  reset: () => void;
  setFollow: (follow: boolean) => void;
  setShowOnChart: (show: boolean) => void;
  setFocusTimestamp: (timestamp: number | null) => void;
}

/**
 * The fields an event can change. A batch of events is reduced into one draft
 * and committed with a single `set()`, so React sees one update per batch
 * instead of one per event. `bars` and `logs` are the same mutable arrays as
 * in the store (appended in place); everything else is replaced immutably.
 */
type Draft = Pick<
  CycleState,
  | "status"
  | "error"
  | "lastSequence"
  | "plan"
  | "cursor"
  | "bars"
  | "barsVersion"
  | "barCount"
  | "trades"
  | "running"
  | "folds"
  | "final"
  | "history"
  | "epochs"
  | "trials"
  | "logs"
  | "logsVersion"
>;

function draftOf(state: CycleState): Draft {
  return {
    status: state.status,
    error: state.error,
    lastSequence: state.lastSequence,
    plan: state.plan,
    cursor: state.cursor,
    bars: state.bars,
    barsVersion: state.barsVersion,
    barCount: state.barCount,
    trades: state.trades,
    running: state.running,
    folds: state.folds,
    final: state.final,
    history: state.history,
    epochs: state.epochs,
    trials: state.trials,
    logs: state.logs,
    logsVersion: state.logsVersion,
  };
}

function pushLog(draft: Draft, line: CycleLogLine): void {
  draft.logs.push(line);
  if (draft.logs.length > CYCLE_LOG_CAPACITY) {
    draft.logs.splice(0, draft.logs.length - CYCLE_LOG_CAPACITY);
  }
  draft.logsVersion += 1;
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

function reduceCycleEvent<T extends CycleEventType>(draft: Draft, type: T, payload: CycleEventPayloads[T]): void {
  switch (type) {
    case "cycle_plan":
      draft.plan = payload as CyclePlan;
      return;
    case "cycle_bars": {
      const appended = appendBars(draft.bars, payload as CycleBars);
      const resolvedAny = (payload as CycleBars).resolved !== undefined;
      if (appended > 0 || resolvedAny) {
        draft.barsVersion += 1;
        draft.barCount = draft.bars.timestamps.length;
      }
      return;
    }
    case "cycle_cursor":
      draft.cursor = payload as CycleCursor;
      return;
    case "cycle_epoch":
      draft.epochs = [...draft.epochs, payload as CycleEpoch];
      return;
    case "cycle_trial":
      draft.trials = upsertTrial(draft.trials, payload as CycleTrial);
      return;
    case "cycle_trade":
      draft.trades = upsertTrade(draft.trades, payload as CycleTrade);
      return;
    case "cycle_scoreboard": {
      const board = payload as CycleScoreboard;
      if (board.scope === "running") {
        const sample = { barsEvaluated: board.barsEvaluated, metrics: board.metrics };
        draft.history =
          draft.history.length >= CYCLE_HISTORY_CAPACITY ? [...draft.history.slice(1), sample] : [...draft.history, sample];
        draft.running = board;
      } else if (board.scope === "fold") {
        draft.folds = upsertFold(draft.folds, board);
      } else {
        draft.final = board;
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

/** Fold one event into a draft. Events at or below the draft's sequence are ignored. */
function reduceEvent(draft: Draft, type: string, data: unknown): void {
  const seq = sequenceOf(data);
  if (seq !== null) {
    if (seq <= draft.lastSequence) return;
    draft.lastSequence = seq;
  }

  if (CYCLE_TYPES.has(type)) {
    if (draft.status === "starting") draft.status = "running";
    reduceCycleEvent(draft, type as CycleEventType, data as CycleEventPayloads[CycleEventType]);
    return;
  }

  const record = (data ?? {}) as Record<string, unknown>;
  switch (type) {
    case "started":
      if (draft.status === "starting" || draft.status === "idle") draft.status = "running";
      return;
    case "log": {
      const message = typeof record.message === "string" ? record.message : "";
      if (!message) return;
      pushLog(draft, { seq, level: normaliseLevel(record.level), message, receivedAt: Date.now() });
      return;
    }
    case "error": {
      const message = typeof record.message === "string" ? record.message : "Run failed";
      // The first terminal state wins: after a user stop the killed process's
      // non-zero exit arrives as a second, generic error.
      if (draft.status === "stopped" || draft.status === "complete" || draft.status === "failed") {
        pushLog(draft, { seq, level: "warn", message, receivedAt: Date.now() });
        return;
      }
      const stoppedByUser = message === "Training stopped by user";
      pushLog(draft, { seq, level: "error", message, receivedAt: Date.now() });
      const details = typeof record.details === "string" && record.details ? record.details : null;
      if (details) pushLog(draft, { seq, level: "error", message: details, receivedAt: Date.now() });
      draft.status = stoppedByUser ? "stopped" : "failed";
      draft.error = stoppedByUser ? null : message;
      return;
    }
    case "done": {
      const diagnostics = (record.diagnostics ?? {}) as Record<string, unknown>;
      if (draft.status === "failed" || draft.status === "stopped" || draft.status === "complete") return;
      draft.status = diagnostics.stopped === true ? "stopped" : "complete";
      return;
    }
    default:
      return;
  }
}

function initialRunState(): Omit<
  CycleState,
  | "begin"
  | "loadSnapshot"
  | "applyEvent"
  | "applyEvents"
  | "fail"
  | "reset"
  | "setFollow"
  | "setShowOnChart"
  | "setFocusTimestamp"
  | "follow"
  | "showOnChart"
  | "focusTimestamp"
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
  focusTimestamp: null,

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

  applyEvent: (type, data) => get().applyEvents([{ type, data }]),

  applyEvents: (events) => {
    if (events.length === 0) return;
    const draft = draftOf(get());
    for (const { type, data } of events) reduceEvent(draft, type, data);
    set(draft);
  },

  fail: (message) => {
    const draft = draftOf(get());
    pushLog(draft, { seq: null, level: "error", message, receivedAt: Date.now() });
    draft.status = "failed";
    draft.error = message;
    set(draft);
  },

  reset: () => {
    const previousEpoch = get().barsEpoch;
    set({ ...initialRunState(), barsEpoch: previousEpoch + 1 });
  },

  setFollow: (follow) => set({ follow }),
  setShowOnChart: (showOnChart) => set({ showOnChart }),
  setFocusTimestamp: (focusTimestamp) => set({ focusTimestamp, follow: focusTimestamp === null ? get().follow : false }),
}));

/** True while a run is starting or streaming. */
export function isCycleActive(status: CycleClientStatus): boolean {
  return status === "starting" || status === "running";
}
