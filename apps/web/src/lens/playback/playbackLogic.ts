/**
 * Pure step/decision/attribution logic for PlaybackPanel — no React, no
 * lightweight-charts, so the state machine is testable without a canvas.
 */

import type { LensBar, LensDecision, LensFeatureFamilyKey, LensRegime } from "@shared/lens/types";
import { LENS_QUANTILE_LEVELS } from "@shared/lens/types";

// ── Stepping ────────────────────────────────────────────────────────────────

export interface StepResult {
  /** New cursor index, when the step stayed inside the window. */
  nextIndex: number | null;
  /** True when the step ran off the end of the window and more rows exist after it. */
  reachedWindowEnd: boolean;
  /** True when the step ran off the end of the window and no more rows exist. */
  atRecordEnd: boolean;
}

export function stepForward(cursorIndex: number, barCount: number, hasMoreAfterWindow: boolean): StepResult {
  if (cursorIndex < barCount - 1) return { nextIndex: cursorIndex + 1, reachedWindowEnd: false, atRecordEnd: false };
  if (hasMoreAfterWindow) return { nextIndex: null, reachedWindowEnd: true, atRecordEnd: false };
  return { nextIndex: null, reachedWindowEnd: false, atRecordEnd: true };
}

export function stepBack(cursorIndex: number): number {
  return Math.max(0, cursorIndex - 1);
}

/** Next bar strictly after `fromIndex` whose decision opens a position, or null if none in this window. */
export function findNextTradeEntryIndex(bars: LensBar[], fromIndex: number): number | null {
  for (let i = fromIndex + 1; i < bars.length; i++) {
    const decision = bars[i]!.decision;
    if (decision === "enter_long" || decision === "enter_short") return i;
  }
  return null;
}

// ── Decision + regime in words ─────────────────────────────────────────────

/**
 * Plain-words decision label. `skip` carries no server-side reason, so the
 * bar's resulting position disambiguates the two real causes: already
 * holding a position, or conviction never cleared the threshold.
 */
export function decisionText(decision: LensDecision, position: 1 | 0 | -1): string {
  switch (decision) {
    case "enter_long":
      return "enter long";
    case "enter_short":
      return "enter short";
    case "hold":
      return position === 1 ? "hold — long position open" : position === -1 ? "hold — short position open" : "hold";
    case "exit":
      return "exit position";
    case "flat":
      return "flat — no position";
    case "skip":
      return position !== 0 ? "skip — already in a position" : "skip — conviction below threshold";
  }
}

export function regimeGlyph(regime: LensRegime | null): string {
  if (regime === "bull") return "▲";
  if (regime === "bear") return "▼";
  if (regime === "sideways") return "◆";
  return "–";
}

export function regimeLabel(regime: LensRegime | null): string {
  if (regime === "bull") return "bull";
  if (regime === "bear") return "bear";
  if (regime === "sideways") return "sideways";
  return "unknown";
}

// ── Candle strip ────────────────────────────────────────────────────────────

/** Up to `count` bars ending at (and including) `cursorIndex`, oldest first. */
export function candleStripWindow(bars: LensBar[], cursorIndex: number, count: number): LensBar[] {
  const end = Math.min(bars.length - 1, Math.max(0, cursorIndex));
  const start = Math.max(0, end - count + 1);
  return bars.slice(start, end + 1);
}

// ── Feature attribution ─────────────────────────────────────────────────────

export interface TopFeature {
  name: string;
  family: LensFeatureFamilyKey;
  value: number | null;
  shap: number;
  rank: number;
}

/** Top-N features at one bar by |SHAP|, descending. Null SHAP rows are dropped, never treated as 0. */
export function topFeaturesAtBar(
  names: string[],
  families: LensFeatureFamilyKey[],
  shapRow: Array<number | null>,
  valueRow: Array<number | null>,
  topN: number,
): TopFeature[] {
  const rows: TopFeature[] = [];
  for (let i = 0; i < names.length; i++) {
    const shap = shapRow[i];
    if (shap == null) continue;
    rows.push({ name: names[i]!, family: families[i]!, value: valueRow[i] ?? null, shap, rank: 0 });
  }
  rows.sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));
  const top = rows.slice(0, topN);
  top.forEach((row, i) => (row.rank = i + 1));
  return top;
}

// ── Prediction interval in words ────────────────────────────────────────────

/** [lowIndex, highIndex] into LENS_QUANTILE_LEVELS for a selected coverage. */
const COVERAGE_QUANTILE_INDICES: Record<number, [number, number]> = {
  0.5: [2, 4], // 0.25, 0.75
  0.8: [1, 5], // 0.10, 0.90
  0.9: [0, 6], // 0.05, 0.95
};

export function intervalBasisPointsForCoverage(
  quantiles: number[] | null,
  coverage: number,
): { lowBasisPoints: number; highBasisPoints: number } | null {
  if (!quantiles) return null;
  const indices = COVERAGE_QUANTILE_INDICES[coverage];
  if (!indices) return null;
  const low = quantiles[indices[0]];
  const high = quantiles[indices[1]];
  if (low == null || high == null) return null;
  return { lowBasisPoints: low, highBasisPoints: high };
}

export const COVERAGE_QUANTILE_LEVELS = LENS_QUANTILE_LEVELS;

// ── Realized-vs-interval verdict ────────────────────────────────────────────

export type IntervalLanding = "inside" | "above" | "below";

/** Where the realized price at row t+H actually landed relative to the interval predicted at row t. */
export function intervalLanding(bar: LensBar, targetClose: number): IntervalLanding | null {
  if (bar.intervalLowerPrice == null || bar.intervalUpperPrice == null) return null;
  if (targetClose < bar.intervalLowerPrice) return "below";
  if (targetClose > bar.intervalUpperPrice) return "above";
  return "inside";
}

/** The bar exactly `horizonBars` rows after `bar`, if it is inside the loaded window. */
export function targetBarForHorizon(bars: LensBar[], bar: LensBar, horizonBars: number): LensBar | null {
  return bars.find((b) => b.rowIndex === bar.rowIndex + horizonBars) ?? null;
}
