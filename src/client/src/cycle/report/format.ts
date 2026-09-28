/**
 * Formatting for the in-depth metric tables: every row says its own unit and
 * better direction (src/shared/cycle/report.ts), so one function renders any
 * metric. Money that is a size (better = lower: a drawdown, a cost) is shown
 * unsigned, as the scoreboard does; every other USD figure keeps its sign.
 * `null` renders "—", never 0.
 */
import type { ReportMetricRow } from "@shared/cycle/report";
import { formatCount, formatPercent, formatUsd, formatUsdMagnitude, UNDEFINED_METRIC_TEXT } from "@/cycle/format";

type Unit = ReportMetricRow["unit"];
type Better = ReportMetricRow["better"];

function decimals(value: number): number {
  const size = Math.abs(value);
  if (size >= 100) return 1;
  if (size >= 1) return 2;
  return 4;
}

export function formatReportValue(unit: Unit, value: number | null | undefined, better: Better = "none"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNDEFINED_METRIC_TEXT;
  switch (unit) {
    case "usd":
      return better === "lower" ? formatUsdMagnitude(value) : formatUsd(value);
    case "fraction":
      return formatPercent(value, 1);
    case "probability":
    case "correlation":
      return value.toFixed(3);
    case "count":
      return formatCount(value);
    case "points":
      return `${value.toFixed(2)} pt`;
    case "bars":
      return `${Number.isInteger(value) ? formatCount(value) : value.toFixed(1)} bars`;
    case "days":
      return `${value.toFixed(1)} days`;
    default:
      return value.toFixed(decimals(value));
  }
}

/** "up" / "down" tone for money that is profit-like (better = higher); null otherwise. */
export function profitTone(row: Pick<ReportMetricRow, "unit" | "better" | "value">): "up" | "down" | null {
  if (row.unit !== "usd" || row.better !== "higher" || row.value === null) return null;
  return row.value > 0 ? "up" : row.value < 0 ? "down" : null;
}

export const BETTER_GLYPH: Record<Better, string> = { higher: "↑", lower: "↓", closer_to_zero: "→0", none: "" };
export const BETTER_WORDS: Record<Better, string> = {
  higher: "Higher is better.", lower: "Lower is better.", closer_to_zero: "Closer to zero is better.", none: "",
};

export const FAMILY_TITLES: Record<string, string> = {
  coverage: "Coverage", classification: "Classification", probability: "Probability", calibration: "Calibration",
  baseline: "Baselines", price_forecast: "Price forecast", returns: "Returns", risk_adjusted: "Risk-adjusted",
  drawdown: "Drawdown", trades: "Trades", exposure: "Exposure", costs: "Costs",
};

/** The tooltip of a metric cell: what it is, how it is computed, its sample and why it is undefined. */
export function metricTooltip(row: ReportMetricRow): string {
  const parts = [`${row.label}: ${row.definition}`, `Formula: ${row.formula}.`];
  if (BETTER_WORDS[row.better]) parts.push(BETTER_WORDS[row.better]);
  if (row.sampleCount !== null) parts.push(`Sample: ${formatCount(row.sampleCount)}.`);
  if (row.note) parts.push(row.value === null ? `Undefined: ${row.note}.` : `Note: ${row.note}.`);
  return parts.join(" ");
}

export function foldLabel(foldIndex: number | null): string {
  return foldIndex === null ? "Run" : `Fold ${foldIndex + 1}`;
}
