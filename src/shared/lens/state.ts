/**
 * Per-bar state of the simulated strategy: what it did on each row, what it
 * held, and what the position was worth as the row closed.
 *
 * Mark-to-market, so the equity curve moves between entry and exit instead of
 * jumping only when a trade closes:
 *   - the round trip cost is charged in full on the ENTRY row;
 *   - every row after the entry, up to and including the exit, adds
 *     (close[t] - close[t-1]) * direction * pointValue;
 *   - cumulative therefore equals "realised trades so far + the open position
 *     marked to this row's close", and lands exactly on the realised total at
 *     each exit row.
 * A position is reported as held on the rows (entry, exit] — at the entry row
 * itself the trade has only just been opened at that row's close, so nothing
 * has been marked yet.
 *
 * A row where the signal fires but no trade opens is `skip`, which is what
 * separates "the model had no opinion" from "the model had an opinion the
 * one-trade-at-a-time rule threw away".
 */

import { tradeCostUsd } from "./simulate";
import type { LensRowRange } from "./series";
import type { LensDecision, LensEvaluationParams, LensSeries, LensTrade } from "./types";

export interface LensBarState {
  /** Indexed by row offset from range.firstRowIndex. */
  decision: LensDecision[];
  position: Int8Array;
  barPnlUsd: Float64Array;
  cumulativeNetUsd: Float64Array;
  drawdownUsd: Float64Array;
  buyHoldCumulativeUsd: Float64Array | null;
  maxDrawdownUsd: number;
  /** Rows holding a position, divided by rows in the range. */
  exposureShare: number;
  /** Rows that are an exit and an entry at once — the entry is what is reported. */
  exitAndEntryRowCount: number;
}

export function computeBarState(
  series: LensSeries,
  params: LensEvaluationParams,
  range: LensRowRange,
  trades: LensTrade[],
): LensBarState {
  const count = Math.max(0, range.barCount);
  const decision: LensDecision[] = new Array<LensDecision>(count).fill("flat");
  const position = new Int8Array(count);
  const barPnlUsd = new Float64Array(count);
  const cumulativeNetUsd = new Float64Array(count);
  const drawdownUsd = new Float64Array(count);

  const close = series.close;
  const pointValue = series.cost.pointValueUsd;
  const cost = tradeCostUsd(series, params);
  const horizon = series.horizonBars;
  const threshold = params.threshold;
  const shortThreshold = 1 - threshold;

  const isEntry = new Uint8Array(count);
  const isExit = new Uint8Array(count);
  let exitAndEntryRowCount = 0;

  for (const trade of trades) {
    const entryOffset = trade.entryRowIndex - range.firstRowIndex;
    const exitOffset = trade.exitRowIndex - range.firstRowIndex;
    if (entryOffset < 0 || exitOffset >= count) continue;
    if (isExit[entryOffset] === 1) exitAndEntryRowCount += 1;
    isEntry[entryOffset] = 1;
    isExit[exitOffset] = 1;
    decision[entryOffset] = trade.direction === 1 ? "enter_long" : "enter_short";
    barPnlUsd[entryOffset] = (barPnlUsd[entryOffset] as number) - cost;
    for (let offset = entryOffset + 1; offset <= exitOffset; offset += 1) {
      const previousClose = close[range.firstRowIndex + offset - 1] as number;
      const currentClose = close[range.firstRowIndex + offset] as number;
      position[offset] = trade.direction;
      barPnlUsd[offset] =
        (barPnlUsd[offset] as number) + (currentClose - previousClose) * trade.direction * pointValue;
      if (offset < exitOffset) decision[offset] = "hold";
    }
  }

  // An exit row that is not also an entry reports the exit; an exit row that is
  // also an entry keeps the entry, because that is the decision taken there.
  for (let offset = 0; offset < count; offset += 1) {
    if (isExit[offset] === 1 && isEntry[offset] === 0) decision[offset] = "exit";
  }

  // A firing signal that produced no trade is a skip: either a position was
  // already open, or the row sits inside the final horizon with no exit bar.
  for (let offset = 0; offset < count; offset += 1) {
    if (isEntry[offset] === 1) continue;
    const probabilityUp = series.probabilityUp[range.firstRowIndex + offset] as number;
    const fires = probabilityUp >= threshold || probabilityUp <= shortThreshold;
    if (!fires) continue;
    if (decision[offset] === "hold" || (decision[offset] === "flat" && offset >= count - horizon)) {
      decision[offset] = "skip";
    }
  }

  let cumulative = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  let holdingRows = 0;
  for (let offset = 0; offset < count; offset += 1) {
    cumulative += barPnlUsd[offset] as number;
    cumulativeNetUsd[offset] = cumulative;
    if (cumulative > peak) peak = cumulative;
    const drawdown = cumulative - peak;
    drawdownUsd[offset] = drawdown;
    if (drawdown < maxDrawdownUsd) maxDrawdownUsd = drawdown;
    if (position[offset] !== 0) holdingRows += 1;
  }

  let buyHoldCumulativeUsd: Float64Array | null = null;
  if (count > 0) {
    buyHoldCumulativeUsd = new Float64Array(count);
    const firstClose = close[range.firstRowIndex] as number;
    for (let offset = 0; offset < count; offset += 1) {
      const current = close[range.firstRowIndex + offset] as number;
      buyHoldCumulativeUsd[offset] = (current - firstClose) * pointValue - cost;
    }
  }

  return {
    decision,
    position,
    barPnlUsd,
    cumulativeNetUsd,
    drawdownUsd,
    buyHoldCumulativeUsd,
    maxDrawdownUsd,
    exposureShare: count > 0 ? holdingRows / count : 0,
    exitAndEntryRowCount,
  };
}
