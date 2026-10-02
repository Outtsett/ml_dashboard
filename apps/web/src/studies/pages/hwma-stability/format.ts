/** Number formatting for a quantity that can run from 1e-12 to 1e93 on the same page. */

import { fmt } from "@/studies/kit";

/** Ordinary numbers with separators; anything past a billion or below a thousandth in exponent form. */
export function fmtWide(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e9 || magnitude < 1e-3)) return value.toExponential(3);
  return fmt(value, decimals);
}

/** Axis ticks: compact exponent form once the value passes ten million. */
export function fmtTick(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e7) return value.toExponential(1);
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function signed(value: number, decimals = 4): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(decimals)}`;
}

export const PARAMETER_LABELS = {
  na: "na (level correction)",
  nb: "nb (velocity correction)",
  nc: "nc (acceleration correction)",
} as const;

/** Full-word labels for the grid's columns, shown above each panel. */
export const COLUMN_LABELS: Record<string, string> = {
  na: "na, level correction",
  nb: "nb, velocity correction",
  nc: "nc, acceleration correction",
  spectral_radius: "spectral radius",
  bars_emitted: "bars emitted before the bound",
  left_range_at_bar: "bar where it left the data's range",
  emitted_minimum: "lowest value emitted",
  emitted_maximum: "highest value emitted",
  unbounded_minimum: "lowest value, unbounded",
  unbounded_maximum: "highest value, unbounded",
};
