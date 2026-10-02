/**
 * What the page's sections share: the control values (mirrored into the URL),
 * the three data hooks (one per part of the endpoint, so a slider on one part
 * never refetches another), number formatting wide enough for indicator
 * values that run from 1e-5 to 1e7, and the bullish / bearish split of a
 * candlestick column read from its landed histogram.
 */

import { useStudyQuery } from "@/studies/kit";
import {
  DEFAULT_DRAWN_COLUMNS, POINT_BUDGETS, PRESET_KEYS, TIMEFRAMES,
  type CatalogueBody, type CatalogueColumn, type ColumnHistogram, type SeriesBody, type Timeframe, type WideBody,
} from "@shared/studies/talib-indicator-catalogue";

const SLUG = "talib-indicator-catalogue";

export type Controls = {
  tab: string;
  timeframe: string;
  group: string;
  search: string;
  fillMinimum: number;
  fillMaximum: number;
  metric: string;
  order: string;
  logValues: boolean;
  bins: number;
  logCounts: boolean;
  panelOrder: string;
  panelPage: number;
  panelsPerPage: number;
  patternOrder: string;
  patternMeasure: string;
  patternMinimum: number;
  preset: string;
  windowStart: number;
  windowLength: number;
  tablePage: number;
  focus: string;
  draw: string;
  points: number;
  zeroAxis: boolean;
  markRolls: boolean;
  zoomStart: number;
  zoomEnd: number;
};

export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

export const DEFAULTS: Controls = {
  tab: "catalogue",
  timeframe: "1m",
  group: "all",
  search: "",
  fillMinimum: 0,
  fillMaximum: 100,
  metric: "finite_percent",
  order: "descending",
  logValues: false,
  bins: 30,
  logCounts: false,
  panelOrder: "catalogue",
  panelPage: 1,
  panelsPerPage: 24,
  patternOrder: "fires",
  patternMeasure: "bars",
  patternMinimum: 0,
  preset: "starter",
  windowStart: 0,
  windowLength: 500,
  tablePage: 1,
  focus: "close",
  draw: DEFAULT_DRAWN_COLUMNS.join(","),
  points: 5000,
  zeroAxis: false,
  markRolls: true,
  zoomStart: 0,
  zoomEnd: 0,
};

export const TIMEFRAME_LABELS: Record<Timeframe, string> = { "1m": "1 minute", "1h": "1 hour", "4h": "4 hours" };

export function asTimeframe(value: string): Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value) ? (value as Timeframe) : "1m";
}

export function asPreset(value: string): string {
  return PRESET_KEYS.includes(value) ? value : "starter";
}

export function asPointBudget(value: number): number {
  return (POINT_BUDGETS as readonly number[]).includes(value) ? value : 5000;
}

export function useCatalogue(timeframe: Timeframe) {
  return useStudyQuery<CatalogueBody>(SLUG, { part: "catalogue", timeframe });
}

export function useWideWindow(timeframe: Timeframe, preset: string, windowStart: number, windowLength: number, enabled: boolean) {
  return useStudyQuery<WideBody>(SLUG, { part: "wide", timeframe, preset, windowStart, windowLength }, { enabled });
}

export function useLineSeries(timeframe: Timeframe, draw: string, points: number, enabled: boolean) {
  return useStudyQuery<SeriesBody>(SLUG, { part: "series", timeframe, draw, points }, { enabled });
}

/** A value at a readable precision whatever its size (on-balance volume is in millions, a rate of change in ten-thousandths). */
export function fmtValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const size = Math.abs(value);
  if (size >= 1e7 || size < 1e-3) return value.toExponential(2);
  const decimals = size >= 1000 ? 1 : size >= 1 ? 3 : 4;
  return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** Signed log10(1 + |value|): keeps the sign and lets one axis hold values of very different sizes. */
export function signedLog(value: number): number {
  return Math.sign(value) * Math.log10(1 + Math.abs(value));
}

/** The eight numbers of a distribution, in the order the dashboard reports them. */
export const STATISTICS = [
  ["mean", "mean"],
  ["median", "median"],
  ["standard_deviation", "standard deviation"],
  ["skewness", "skewness"],
  ["kurtosis", "kurtosis"],
  ["percentile_25", "25th percentile"],
  ["percentile_75", "75th percentile"],
  ["minimum", "minimum"],
  ["maximum", "maximum"],
] as const satisfies ReadonlyArray<readonly [keyof CatalogueColumn, string]>;

/** "timeperiod 14, nbdevup 2" from the landed parameters JSON; "no parameters" when it is empty. */
export function describeParameters(parametersJson: string): string {
  try {
    const parsed = JSON.parse(parametersJson) as Record<string, unknown>;
    const pieces = Object.entries(parsed).map(([name, value]) => `${name} ${String(value)}`);
    return pieces.length > 0 ? pieces.join(", ") : "no parameters";
  } catch {
    return parametersJson;
  }
}

export function describeColumn(column: CatalogueColumn): string {
  return `${column.column_name}: TA-Lib ${column.talib_function}, output "${column.talib_output}", group ${column.talib_group}, ${describeParameters(column.parameters_json)}, first value after ${column.lookback_bars} bars`;
}

/** Does the column pass the page's shared filters (TA-Lib group, name search, share of bars with a value)? */
export function passesFilters(column: CatalogueColumn, controls: Pick<Controls, "group" | "search" | "fillMinimum" | "fillMaximum">): boolean {
  if (controls.group !== "all" && column.talib_group !== controls.group) return false;
  if (column.finite_percent < controls.fillMinimum || column.finite_percent > controls.fillMaximum) return false;
  const needle = controls.search.trim().toLowerCase();
  return needle === "" || `${column.column_name} ${column.talib_function} ${column.talib_group}`.toLowerCase().includes(needle);
}

export interface PatternFires {
  bullish: number;
  bearish: number;
  /** False when the histogram's signed bins do not add up to the landed nonzero count. */
  exact: boolean;
}

/**
 * A candlestick column holds 0 on a quiet bar, a positive value on a bullish
 * firing and a negative one on a bearish firing. Its landed histogram is
 * equal-width bins from minimum to maximum, so every bin wholly above zero is
 * bullish firings and every bin wholly below zero bearish ones.
 */
export function patternFires(column: CatalogueColumn, histogram: ColumnHistogram | undefined): PatternFires {
  if (!histogram || histogram.counts.length === 0) return { bullish: 0, bearish: 0, exact: column.nonzero_bar_count === 0 };
  const range = histogram.maximum - histogram.minimum;
  if (!(range > 0)) {
    const all = column.nonzero_bar_count;
    return { bullish: histogram.minimum > 0 ? all : 0, bearish: histogram.minimum < 0 ? all : 0, exact: true };
  }
  const width = range / histogram.counts.length;
  const tolerance = range * 1e-9;
  let bullish = 0;
  let bearish = 0;
  histogram.counts.forEach((count, index) => {
    const lower = histogram.minimum + index * width;
    const upper = lower + width;
    if (lower > tolerance) bullish += count;
    else if (upper < -tolerance) bearish += count;
  });
  return { bullish, bearish, exact: bullish + bearish === column.nonzero_bar_count };
}
