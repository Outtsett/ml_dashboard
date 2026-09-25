/**
 * Model Cycle chart — pure functions only.
 *
 * Everything the cycle chart decides that can be decided without a canvas
 * lives here, so it can be tested without lightweight-charts or a DOM:
 *
 *  - mapping store columns to series points (candles, prediction strip,
 *    probability line, equity line), one bar range at a time;
 *  - the "what must be drawn this frame" bookkeeping (append the new tail,
 *    or reset everything when the store was replaced);
 *  - the band list (training / validation / test spans, the active block the
 *    model is working on, the test cursor) from the plan and the cursor;
 *  - trade markers from trade records;
 *  - the visible ranges follow mode asks for;
 *  - the crosshair readout for one bar.
 *
 * The drawing side is `CycleChart.tsx` (series, rAF loop) and `chartBands.ts`
 * (the canvas primitive). Wire contract: `@shared/cycle/schema`.
 */
import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";

import { findBarIndex, type CycleBarColumns, type CycleCursor, type CyclePlan, type CycleTrade } from "@shared/cycle/schema";

// ─── Palette (Okabe-Ito) ────────────────────────────────────────────────────

export const CYCLE_COLORS = {
  /** Up / long / profit. */
  up: "#E69F00",
  /** Down / short / loss. */
  down: "#0072B2",
  /** Training span, probability line. */
  sky: "#56B4E9",
  /** Validation span. */
  yellow: "#F0E442",
  /** A label that resolved wrong. */
  vermillion: "#D55E00",
  /** The block the model is working on right now. */
  active: "#CC79A7",
  /** Neutral: no direction predicted. */
  neutral: "#B8BEC8",
} as const;

/** Alpha of a bar the model has not been tested on (context). */
export const CONTEXT_ALPHA = 0.4;
/** Faintest a prediction-strip bar gets, so a coin-flip prediction is still visible. */
export const STRIP_MINIMUM_ALPHA = 0.25;

/** `#RRGGBB` + alpha → `rgba(r, g, b, a)`. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${red}, ${green}, ${blue}, ${Math.round(clamped * 1000) / 1000})`;
}

// Precomputed per-bar colours: the append path runs per bar, so it must not
// build strings it can look up.
const PROCESSED_UP = CYCLE_COLORS.up;
const PROCESSED_DOWN = CYCLE_COLORS.down;
const CONTEXT_UP = withAlpha(CYCLE_COLORS.up, CONTEXT_ALPHA);
const CONTEXT_DOWN = withAlpha(CYCLE_COLORS.down, CONTEXT_ALPHA);

/** Strip colours bucketed by alpha (0.25..1 in 0.05 steps) so none is built per bar. */
const STRIP_ALPHA_STEPS = 16;
function stripRamp(hex: string): string[] {
  const ramp: string[] = [];
  for (let step = 0; step < STRIP_ALPHA_STEPS; step += 1) {
    ramp.push(withAlpha(hex, STRIP_MINIMUM_ALPHA + ((1 - STRIP_MINIMUM_ALPHA) * step) / (STRIP_ALPHA_STEPS - 1)));
  }
  return ramp;
}
const STRIP_UP_RAMP = stripRamp(CYCLE_COLORS.up);
const STRIP_DOWN_RAMP = stripRamp(CYCLE_COLORS.down);
const STRIP_NEUTRAL_RAMP = stripRamp(CYCLE_COLORS.neutral);

// ─── Series points ──────────────────────────────────────────────────────────

export interface CycleCandlePoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  color: string;
  borderColor: string;
  wickColor: string;
}

export interface WhitespacePoint {
  time: UTCTimestamp;
}

export interface ValuePoint {
  time: UTCTimestamp;
  value: number;
}

export interface ColoredValuePoint extends ValuePoint {
  color: string;
}

export type StripPoint = ColoredValuePoint | WhitespacePoint;
export type LinePoint = ValuePoint | WhitespacePoint;

/**
 * Up or down for bar `index`: close against the previous close, the rule the
 * Market chart uses (`useChartSeries.ts`), so the two charts colour the same
 * bar the same way. The first bar falls back to close against open.
 */
export function isUpBar(columns: CycleBarColumns, index: number): boolean {
  const close = columns.close[index]!;
  if (index === 0) return close >= columns.open[index]!;
  return close >= columns.close[index - 1]!;
}

/** Candle for bar `index`: full colour when the model was tested on it, 40% alpha for context. */
export function candlePointAt(columns: CycleBarColumns, index: number): CycleCandlePoint {
  const up = isUpBar(columns, index);
  const processed = columns.role[index] === "processed";
  const color = processed ? (up ? PROCESSED_UP : PROCESSED_DOWN) : up ? CONTEXT_UP : CONTEXT_DOWN;
  return {
    time: columns.timestamps[index]! as UTCTimestamp,
    open: columns.open[index]!,
    high: columns.high[index]!,
    low: columns.low[index]!,
    close: columns.close[index]!,
    color,
    borderColor: color,
    wickColor: color,
  };
}

/** How sure a prediction is: |P(up) − 0.5| × 2, in [0, 1]. Null probability → 0. */
export function predictionConfidence(probabilityUp: number | null): number {
  if (probabilityUp === null || !Number.isFinite(probabilityUp)) return 0;
  return Math.max(0, Math.min(1, Math.abs(probabilityUp - 0.5) * 2));
}

/** Strip colour: hue by predicted direction, alpha by confidence (never below 0.25). */
export function stripColor(direction: 1 | 0 | -1 | null, probabilityUp: number | null): string {
  const confidence = predictionConfidence(probabilityUp);
  const step = Math.round(confidence * (STRIP_ALPHA_STEPS - 1));
  const ramp = direction === 1 ? STRIP_UP_RAMP : direction === -1 ? STRIP_DOWN_RAMP : STRIP_NEUTRAL_RAMP;
  return ramp[step]!;
}

/** Strip point: constant height 1, coloured by the prediction. Context bars are whitespace. */
export function stripPointAt(columns: CycleBarColumns, index: number): StripPoint {
  const time = columns.timestamps[index]! as UTCTimestamp;
  if (columns.role[index] !== "processed") return { time };
  return { time, value: 1, color: stripColor(columns.predictedDirection[index] ?? null, columns.probabilityUp[index] ?? null) };
}

/** P(up) point; whitespace for context bars and missing predictions, which breaks the line there. */
export function probabilityPointAt(columns: CycleBarColumns, index: number): LinePoint {
  const time = columns.timestamps[index]! as UTCTimestamp;
  const value = columns.probabilityUp[index];
  if (columns.role[index] !== "processed" || value === null || value === undefined) return { time };
  return { time, value };
}

/** Equity point (USD); whitespace for context bars. */
export function equityPointAt(columns: CycleBarColumns, index: number): LinePoint {
  const time = columns.timestamps[index]! as UTCTimestamp;
  const value = columns.equityUsd[index];
  if (columns.role[index] !== "processed" || value === null || value === undefined) return { time };
  return { time, value };
}

export interface MappedBars {
  candles: CycleCandlePoint[];
  strip: StripPoint[];
  probability: LinePoint[];
  equity: LinePoint[];
}

/** Map bars `[from, to)` to the four series' points. Cost is proportional to `to − from` only. */
export function mapBars(columns: CycleBarColumns, from: number, to: number): MappedBars {
  const start = Math.max(0, from);
  const end = Math.min(to, columns.timestamps.length);
  const length = Math.max(0, end - start);
  const candles = new Array<CycleCandlePoint>(length);
  const strip = new Array<StripPoint>(length);
  const probability = new Array<LinePoint>(length);
  const equity = new Array<LinePoint>(length);
  for (let offset = 0; offset < length; offset += 1) {
    const index = start + offset;
    candles[offset] = candlePointAt(columns, index);
    strip[offset] = stripPointAt(columns, index);
    probability[offset] = probabilityPointAt(columns, index);
    equity[offset] = equityPointAt(columns, index);
  }
  return { candles, strip, probability, equity };
}

// ─── Incremental render bookkeeping ─────────────────────────────────────────

/** What the chart has drawn so far. */
export interface RenderedBars {
  /** `barsEpoch` the series were last reset for. */
  epoch: number;
  /** Bars drawn: `[0, count)` of the store's columns. */
  count: number;
  /** `barsVersion` last seen. */
  version: number;
  /** Timestamp of bar `count − 1` as drawn, or null when nothing is drawn. */
  lastTimestamp: number | null;
}

/** What the store holds now. */
export interface StoreBars {
  epoch: number;
  version: number;
  count: number;
  /** The store's timestamp at index `rendered.count − 1` (null if out of range). */
  timestampAtRenderedEnd: number | null;
}

export type RenderPlan =
  | { kind: "none" }
  /** setData from scratch with bars `[0, count)`. */
  | { kind: "reset"; count: number }
  /** series.update() for bars `[from, to)`. */
  | { kind: "append"; from: number; to: number }
  /** Nothing new to append, but labels resolved on drawn bars: redraw the correctness row. */
  | { kind: "refresh" };

/**
 * Decide this frame's work. A different epoch, a count that went backwards,
 * or a drawn bar whose timestamp no longer matches the store means the store
 * was replaced under us: reset. Otherwise append the new tail, or refresh when
 * only the version moved (resolved labels).
 */
export function planRender(rendered: RenderedBars | null, store: StoreBars): RenderPlan {
  if (rendered === null || rendered.epoch !== store.epoch || store.count < rendered.count) {
    return { kind: "reset", count: store.count };
  }
  if (rendered.count > 0 && store.timestampAtRenderedEnd !== rendered.lastTimestamp) {
    return { kind: "reset", count: store.count };
  }
  if (store.count > rendered.count) return { kind: "append", from: rendered.count, to: store.count };
  if (store.version !== rendered.version) return { kind: "refresh" };
  return { kind: "none" };
}

/** Bookkeeping after carrying out `plan`. */
export function advanceRendered(
  rendered: RenderedBars | null,
  store: StoreBars,
  plan: RenderPlan,
  timestamps: readonly number[],
): RenderedBars {
  const countAfter = plan.kind === "reset" ? plan.count : plan.kind === "append" ? plan.to : (rendered?.count ?? 0);
  return {
    epoch: store.epoch,
    version: store.version,
    count: countAfter,
    lastTimestamp: countAfter > 0 ? (timestamps[countAfter - 1] ?? null) : null,
  };
}

// ─── Index search ───────────────────────────────────────────────────────────

/** First index whose timestamp is ≥ `target` (= length when none). */
export function lowerBound(timestamps: readonly number[], target: number): number {
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timestamps[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** First index whose timestamp is > `target` (= length when none). */
export function upperBound(timestamps: readonly number[], target: number): number {
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timestamps[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Index of the bar at `target`, or of the last bar before it; -1 when `target` precedes every bar. */
export function barIndexAtOrBefore(timestamps: readonly number[], target: number): number {
  const exact = findBarIndex(timestamps, target);
  if (exact >= 0) return exact;
  return upperBound(timestamps, target) - 1;
}

/**
 * A time span as a logical range over the drawn bars: the first bar at or
 * after `start` to the last bar at or before `end`, widened by half a bar each
 * side so the band covers whole candles. Null when no drawn bar falls inside.
 * A span that runs past the last drawn bar is clamped to it — bars the model
 * has not emitted are never painted.
 */
export function spanToLogical(
  timestamps: readonly number[],
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (timestamps.length === 0 || end < start) return null;
  const first = lowerBound(timestamps, start);
  const last = upperBound(timestamps, end) - 1;
  if (first > last || first >= timestamps.length || last < 0) return null;
  return { from: first - 0.5, to: last + 0.5 };
}

// ─── Bands (fold spans, active block, test cursor) ──────────────────────────

export type BandKind = "training" | "validation" | "test" | "previous_test" | "tuning" | "active";

export interface Band {
  kind: BandKind;
  /** Epoch seconds, inclusive. */
  start: number;
  end: number;
  fill: string;
  /** Solid colour for the label text and swatch. */
  edge: string;
  /** Null draws the fill with no label. */
  label: string | null;
  foldIndex: number | null;
}

export interface CursorMark {
  /** The bar just predicted (epoch seconds). */
  time: number;
  label: string;
  paused: boolean;
}

export interface BandLayout {
  bands: Band[];
  cursor: CursorMark | null;
}

export const BAND_FILLS: Record<BandKind, string> = {
  training: withAlpha(CYCLE_COLORS.sky, 0.1),
  validation: withAlpha(CYCLE_COLORS.yellow, 0.15),
  test: withAlpha(CYCLE_COLORS.up, 0.06),
  previous_test: withAlpha(CYCLE_COLORS.up, 0.025),
  tuning: withAlpha(CYCLE_COLORS.active, 0.12),
  active: withAlpha(CYCLE_COLORS.active, 0.25),
};

export const BAND_EDGES: Record<BandKind, string> = {
  training: CYCLE_COLORS.sky,
  validation: CYCLE_COLORS.yellow,
  test: CYCLE_COLORS.up,
  previous_test: CYCLE_COLORS.up,
  tuning: CYCLE_COLORS.active,
  active: CYCLE_COLORS.active,
};

/** Folds are 0-based on the wire and 1-based on screen ("fold 2/3", as the terminal writes them). */
export function foldNumber(foldIndex: number): number {
  return foldIndex + 1;
}

/**
 * Optuna trial numbers are 0-based on the wire (`trial.number`); the screen
 * counts from 1 like the terminal's "[tune trial 3/20]".
 */
export function trialNumber(trial: number): number {
  return trial + 1;
}

function fraction(current: number | null, total: number | null): string {
  if (current === null && total === null) return "";
  return `${current ?? "?"}/${total ?? "?"}`;
}

/** Label for the block the model is working on, by phase and step unit. */
export function activeSpanLabel(cursor: CycleCursor): string {
  if (cursor.phase === "validating") return "Validating";
  if (cursor.phase === "tuning") {
    const trial = cursor.trial === null ? null : trialNumber(cursor.trial);
    return `Tuning block — trial ${fraction(trial, cursor.trialCount)}`;
  }
  if (cursor.phase === "training") {
    const steps = fraction(cursor.epoch, cursor.epochCount);
    switch (cursor.stepUnit) {
      case "boosting_round":
        return `Boosting round ${steps} — every round sees the whole window`;
      case "tree_batch":
        return `Growing trees ${steps} — every tree sees the whole window`;
      case "solver_pass":
        return `Solver pass ${steps} — every pass sees the whole window`;
      default: {
        const batch = cursor.batch !== null || cursor.batchCount !== null ? ` batch ${fraction(cursor.batch, cursor.batchCount)}` : "";
        return `Fitting this block — epoch ${steps}${batch}`;
      }
    }
  }
  return "";
}

/**
 * Bands from the plan and the cursor.
 *
 * The current fold is the cursor's fold, or the last fold once the run has
 * ended. Its training and validation spans are drawn in full; its test span
 * only as far as the model has walked (`cursor.barTimestamp` while testing,
 * the last drawn bar afterwards). Earlier folds keep a very faint test span.
 * The active block (what is being fitted, validated or tuned right now) comes
 * from `cursor.spanStart..spanEnd`, drawn over the fold spans.
 */
export function buildBands(plan: CyclePlan | null, cursor: CycleCursor | null, lastBarTimestamp: number | null): BandLayout {
  const bands: Band[] = [];
  if (!plan) return { bands, cursor: null };

  const ended = cursor === null || cursor.phase === "complete" || cursor.phase === "stopped" || cursor.phase === "failed";
  let currentFold: number | null = cursor?.foldIndex ?? null;
  if (currentFold === null && ended && lastBarTimestamp !== null) {
    // The last fold whose test span has started on the drawn bars.
    for (const fold of plan.folds) {
      if (fold.testStart <= lastBarTimestamp) currentFold = fold.foldIndex;
    }
  }

  const make = (kind: BandKind, start: number, end: number, label: string | null, foldIndex: number | null): Band => ({
    kind,
    start,
    end,
    fill: BAND_FILLS[kind],
    edge: BAND_EDGES[kind],
    label,
    foldIndex,
  });

  for (const fold of plan.folds) {
    if (currentFold === null || fold.foldIndex >= currentFold) continue;
    const end = lastBarTimestamp === null ? fold.testEnd : Math.min(fold.testEnd, lastBarTimestamp);
    if (end >= fold.testStart) bands.push(make("previous_test", fold.testStart, end, null, fold.foldIndex));
  }

  const fold = currentFold === null ? undefined : plan.folds.find((candidate) => candidate.foldIndex === currentFold);
  if (fold) {
    const k = foldNumber(fold.foldIndex);
    bands.push(make("training", fold.trainStart, fold.trainEnd, `Training window · fold ${k}`, fold.foldIndex));
    if (fold.validationEnd >= fold.validationStart && fold.validationBarCount > 0) {
      bands.push(make("validation", fold.validationStart, fold.validationEnd, "Validation", fold.foldIndex));
    }
    let testEnd: number | null = null;
    if (cursor?.phase === "testing" && cursor.barTimestamp !== null) testEnd = Math.min(cursor.barTimestamp, fold.testEnd);
    else if (ended && lastBarTimestamp !== null) testEnd = Math.min(fold.testEnd, lastBarTimestamp);
    if (testEnd !== null && testEnd >= fold.testStart) {
      bands.push(make("test", fold.testStart, testEnd, "Test walk", fold.foldIndex));
    }
  }

  if (cursor && (cursor.phase === "training" || cursor.phase === "validating" || cursor.phase === "tuning")) {
    let start = cursor.spanStart;
    let end = cursor.spanEnd;
    if ((start === null || end === null) && cursor.phase === "tuning" && plan.tuning) {
      start = plan.tuning.start;
      end = plan.tuning.end;
    }
    if (start !== null && end !== null && end >= start) {
      bands.push(make("active", start, end, activeSpanLabel(cursor), cursor.foldIndex));
    }
  }

  let mark: CursorMark | null = null;
  if (cursor && cursor.phase === "testing" && cursor.barTimestamp !== null) {
    mark = {
      time: cursor.barTimestamp,
      label: cursor.paused ? "model is here · paused" : "model is here",
      paused: cursor.paused,
    };
  }
  return { bands, cursor: mark };
}

// ─── Trade markers ──────────────────────────────────────────────────────────

const MINUS = "−";

/** "+$26.20" / "−$14.30" (true minus sign). */
export function formatSignedUsd(value: number): string {
  const sign = value < 0 ? MINUS : "+";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export interface TradeMarkerSet {
  /** Sorted by time; entries and exits for trades whose bar is drawn. */
  markers: SeriesMarker<Time>[];
  /** Earliest marker time not drawn yet because its bar has not arrived; null when none is waiting. */
  pendingTimestamp: number | null;
}

interface MarkerWithOrder {
  marker: SeriesMarker<Time>;
  order: number;
}

/**
 * Markers for every trade: entry — long ▲ below the bar in orange "L<n>",
 * short ▼ above in blue "S<n>"; exit — ● orange for a profit, blue for a loss,
 * with the net result as text, above the bar for a long and below for a short.
 * A marker whose bar has not been drawn yet (`lastDrawnTimestamp`) is held
 * back and reported as pending, so the chart can rebuild once the bar lands.
 */
export function buildTradeMarkers(trades: readonly CycleTrade[], lastDrawnTimestamp: number | null): TradeMarkerSet {
  const collected: MarkerWithOrder[] = [];
  let pending: number | null = null;
  const consider = (time: number, marker: SeriesMarker<Time>, order: number) => {
    if (lastDrawnTimestamp === null || time > lastDrawnTimestamp) {
      pending = pending === null ? time : Math.min(pending, time);
      return;
    }
    collected.push({ marker, order });
  };

  for (const trade of trades) {
    const long = trade.side === "long";
    consider(
      trade.entryTimestamp,
      {
        id: `entry-${trade.tradeNumber}`,
        time: trade.entryTimestamp as UTCTimestamp,
        position: long ? "belowBar" : "aboveBar",
        shape: long ? "arrowUp" : "arrowDown",
        color: long ? CYCLE_COLORS.up : CYCLE_COLORS.down,
        text: `${long ? "L" : "S"}${trade.tradeNumber}`,
      },
      1,
    );
    if (trade.status === "closed" && trade.exitTimestamp !== null) {
      const net = trade.netProfitUsd;
      consider(
        trade.exitTimestamp,
        {
          id: `exit-${trade.tradeNumber}`,
          time: trade.exitTimestamp as UTCTimestamp,
          position: long ? "aboveBar" : "belowBar",
          shape: "circle",
          color: net === null ? CYCLE_COLORS.neutral : net >= 0 ? CYCLE_COLORS.up : CYCLE_COLORS.down,
          text: net === null ? "exit" : formatSignedUsd(net),
        },
        0,
      );
    }
  }

  // Time order is required by the markers plugin; on a shared bar an exit
  // precedes the next entry, which is the order they happened in.
  collected.sort((a, b) => (a.marker.time as number) - (b.marker.time as number) || a.order - b.order);
  return { markers: collected.map((entry) => entry.marker), pendingTimestamp: pending };
}

// ─── Follow ranges ──────────────────────────────────────────────────────────

export const FOLLOW_MINIMUM_BARS = 150;
export const FOLLOW_MAXIMUM_BARS = 400;
export const FOLLOW_DEFAULT_BARS = 250;
/** Empty logical space kept right of the cursor bar while testing. */
export const FOLLOW_RIGHT_PADDING_BARS = 12;

export interface LogicalSpan {
  from: number;
  to: number;
}

/** Visible width to keep while following: the current width clamped to 150..400 bars. */
export function followWidth(currentWidth: number | null): number {
  if (currentWidth === null || !Number.isFinite(currentWidth) || currentWidth <= 0) return FOLLOW_DEFAULT_BARS;
  return Math.max(FOLLOW_MINIMUM_BARS, Math.min(FOLLOW_MAXIMUM_BARS, currentWidth));
}

/** Testing: the cursor bar near the right edge, `width` bars in view. */
export function followTestRange(cursorIndex: number, width: number): LogicalSpan {
  const to = cursorIndex + FOLLOW_RIGHT_PADDING_BARS;
  return { from: to - width, to };
}

/** Training / validating / tuning: the whole active span plus 5% (at least 5 bars) each side. */
export function followSpanRange(fromIndex: number, toIndex: number): LogicalSpan {
  const length = Math.max(1, toIndex - fromIndex);
  const padding = Math.max(5, length * 0.05);
  return { from: fromIndex - padding, to: toIndex + padding };
}

/** A range of `width` bars centred on `index`. */
export function centreRange(index: number, width: number): LogicalSpan {
  return { from: index - width / 2, to: index + width / 2 };
}

/** True when two logical ranges differ by more than a tenth of a bar at either edge. */
export function rangesDiffer(a: LogicalSpan | null, b: LogicalSpan): boolean {
  if (a === null) return true;
  return Math.abs(a.from - b.from) > 0.1 || Math.abs(a.to - b.to) > 0.1;
}

// ─── Crosshair readout ──────────────────────────────────────────────────────

export interface BarReadout {
  index: number;
  timeText: string;
  role: "context" | "processed";
  open: number;
  high: number;
  low: number;
  close: number;
  probabilityUp: number | null;
  predictedDirectionWord: string;
  positionWord: string;
  equityUsd: number | null;
  /** "correct", "wrong", "not scored (inside threshold)", "not resolved yet", or "not tested". */
  labelWord: string;
  /** ✓ / ✗ / – / … so the label reads without colour. */
  labelGlyph: string;
  actualDirectionWord: string | null;
}

/** "2025-11-04 09:35 UTC" — the chart's axis is UTC, so the readout says so. */
export function formatBarTime(epochSeconds: number): string {
  return `${new Date(epochSeconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function directionWord(direction: 1 | 0 | -1 | null | undefined, up: string, down: string, flat: string): string {
  if (direction === 1) return up;
  if (direction === -1) return down;
  if (direction === 0) return flat;
  return "none";
}

export function readoutAt(columns: CycleBarColumns, index: number): BarReadout | null {
  if (index < 0 || index >= columns.timestamps.length) return null;
  const processed = columns.role[index] === "processed";
  const correct = columns.correct[index];
  const actual = columns.actualDirection[index];
  let labelWord: string;
  let labelGlyph: string;
  if (!processed) {
    labelWord = "not tested";
    labelGlyph = "·";
  } else if (correct === true) {
    labelWord = "correct";
    labelGlyph = "✓";
  } else if (correct === false) {
    labelWord = "wrong";
    labelGlyph = "✗";
  } else if (actual !== null && actual !== undefined) {
    labelWord = "not scored (move inside threshold)";
    labelGlyph = "–";
  } else {
    labelWord = "not resolved yet";
    labelGlyph = "…";
  }
  return {
    index,
    timeText: formatBarTime(columns.timestamps[index]!),
    role: processed ? "processed" : "context",
    open: columns.open[index]!,
    high: columns.high[index]!,
    low: columns.low[index]!,
    close: columns.close[index]!,
    probabilityUp: processed ? (columns.probabilityUp[index] ?? null) : null,
    predictedDirectionWord: processed ? directionWord(columns.predictedDirection[index], "up", "down", "no call") : "none",
    positionWord: processed ? directionWord(columns.position[index], "long", "short", "flat") : "none",
    equityUsd: processed ? (columns.equityUsd[index] ?? null) : null,
    labelWord,
    labelGlyph,
    actualDirectionWord: actual === null || actual === undefined ? null : directionWord(actual, "up", "down", "flat"),
  };
}

// ─── Legend words ───────────────────────────────────────────────────────────

const PHASE_WORDS: Record<CycleCursor["phase"], string> = {
  loading: "loading bars",
  tuning: "tuning",
  training: "training",
  validating: "validating",
  testing: "testing bar by bar",
  complete: "complete",
  stopped: "stopped",
  failed: "failed",
};

export function phaseWord(cursor: CycleCursor | null): string {
  if (!cursor) return "waiting for the model";
  const base = PHASE_WORDS[cursor.phase];
  const fold = cursor.foldIndex !== null && cursor.foldCount > 0 ? ` · fold ${foldNumber(cursor.foldIndex)}/${cursor.foldCount}` : "";
  return `${base}${fold}${cursor.paused ? " · paused" : ""}`;
}

/** Decimal places of a tick size (0.25 → 2, 1 → 0, 0.0001 → 4). */
export function tickDecimals(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  let decimals = 0;
  let scaled = tickSize;
  while (decimals < 8 && Math.abs(Math.round(scaled) - scaled) > 1e-9) {
    scaled *= 10;
    decimals += 1;
  }
  return decimals;
}
