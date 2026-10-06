/** Number and time formatting for the run page. */
import type { CycleRunStatus } from "@shared/cycle/schema";
import type { RunMetricTile, RunMetricUnit, VerdictSeverity } from "@shared/runs/types";

/** Okabe-Ito. Severity never rides on colour alone: every use pairs it with a glyph and a word. */
export const SEVERITY_STYLE: Record<VerdictSeverity, { color: string; glyph: string; label: string }> = {
  critical: { color: "#D55E00", glyph: "✕", label: "Critical" },
  warning: { color: "#F0E442", glyph: "▲", label: "Warning" },
  pass: { color: "#56B4E9", glyph: "✓", label: "Pass" },
};

export const STATUS_STYLE: Record<CycleRunStatus, { color: string; glyph: string; label: string }> = {
  running: { color: "#E69F00", glyph: "●", label: "Running" },
  complete: { color: "#56B4E9", glyph: "✓", label: "Complete" },
  failed: { color: "#D55E00", glyph: "✕", label: "Failed" },
  stopped: { color: "#808A99", glyph: "■", label: "Stopped" },
};

/** One hue per fold, Okabe-Ito order. */
export const FOLD_COLORS = ["#E69F00", "#56B4E9", "#CC79A7", "#F0E442", "#0072B2", "#D55E00", "#009E73"];

export function foldColor(foldIndex: number): string {
  return FOLD_COLORS[foldIndex % FOLD_COLORS.length]!;
}

export function formatValue(value: number | null, unit: RunMetricUnit): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  switch (unit) {
    case "usd": {
      const rounded = Math.round(Math.abs(value)).toLocaleString("en-US");
      return `${value < 0 ? "-" : ""}$${rounded}`;
    }
    case "fraction":
      return `${(value * 100).toFixed(1)}%`;
    case "count":
      return Math.round(value).toLocaleString("en-US");
    case "points":
      return value.toFixed(2);
    case "loss":
      return value.toFixed(4);
    default:
      return value.toFixed(2);
  }
}

export type TileStanding = "beats" | "misses" | "none";

/** Whether a tile's value clears its baseline, in the direction that is good for it. */
export function standingOf(tile: RunMetricTile): TileStanding {
  if (tile.value === null || tile.baseline === null) return "none";
  if (tile.better === "higher") return tile.value > tile.baseline.value ? "beats" : "misses";
  if (tile.better === "lower") return tile.value < tile.baseline.value ? "beats" : "misses";
  // a count with a floor (closed trades): at or above the floor is enough
  return tile.value >= tile.baseline.value ? "beats" : "misses";
}

export function formatClock(milliseconds: number): string {
  return new Date(milliseconds).toLocaleTimeString("en-US", { hour12: false });
}

export function formatStarted(milliseconds: number): string {
  if (!milliseconds) return "";
  return new Date(milliseconds).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

/** `xgboost+walk_forward_cycle` reads as `xgboost`. */
export function shortModelType(modelType: string): string {
  return modelType.replace(/\+walk_forward_cycle$/, "");
}
