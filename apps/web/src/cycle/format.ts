/**
 * Model Cycle formatting helpers — the single place every panel turns a raw
 * number from `useCycleStore` into text a person reads.
 *
 * Conventions (`docs/plans/2026-09-25-model-cycle.md`):
 *  - USD: signed, thousands separators, two decimal places.
 *  - Ratios (Sharpe, profit factor, log loss, ...): two decimal places.
 *  - Fractions (accuracy, win rate, ...): shown as a percentage, one decimal place.
 *  - Counts: plain integers with thousands separators.
 *  - `null` is an undefined metric (too few samples, one class only, no
 *    losing trade, ...) and always renders as "—", never "0".
 *  - Times are epoch SECONDS. The lake stores futures bars in Pacific
 *    wall-clock time written as UTC, so this module shows the stored clock
 *    as UTC rather than converting to the viewer's local zone.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "—" is the one rendering for an undefined metric anywhere in the Model Cycle panels. */
export const UNDEFINED_METRIC_TEXT = "—";

/** Signed USD with thousands separators, e.g. "+$412.60", "-$14.50", "$0.00". */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNDEFINED_METRIC_TEXT;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${usdFormatter.format(Math.abs(value))}`;
}

/** USD magnitude with no sign — for a cost, which is never negative. */
export function formatUsdMagnitude(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNDEFINED_METRIC_TEXT;
  return usdFormatter.format(Math.abs(value));
}

/** A dimensionless ratio (Sharpe, profit factor, log loss, ...), two decimal places. */
export function formatRatio(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNDEFINED_METRIC_TEXT;
  return value.toFixed(decimals);
}

/** A 0..1 fraction shown as a percentage, one decimal place: 0.521 -> "52.1%". */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNDEFINED_METRIC_TEXT;
  return `${(value * 100).toFixed(decimals)}%`;
}

/** An integer count with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNDEFINED_METRIC_TEXT;
  return countFormatter.format(Math.round(value));
}

/** Epoch seconds -> "YYYY-MM-DD HH:mm" in UTC (the lake's stored wall clock). */
export function formatTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(epochSeconds)) return UNDEFINED_METRIC_TEXT;
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

/** Epoch seconds -> "YYYY-MM-DD" in UTC, for compact table cells. */
export function formatDate(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(epochSeconds)) return UNDEFINED_METRIC_TEXT;
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** A millisecond wall-clock timestamp (e.g. `Date.now()`) -> "HH:MM:SS.mmm", local time. */
export function formatClockTime(epochMilliseconds: number | null | undefined): string {
  if (epochMilliseconds === null || epochMilliseconds === undefined || !Number.isFinite(epochMilliseconds)) {
    return UNDEFINED_METRIC_TEXT;
  }
  const date = new Date(epochMilliseconds);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Seconds -> "1h 23m 04s" style, dropping leading zero units. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return UNDEFINED_METRIC_TEXT;
  }
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}
