/**
 * Shared number/date formatters used by KPI cells, DenseTable cells, and any
 * surface that needs disciplined display strings. Centralized so 7-digit
 * comma grouping, fixed-decimal display, and signed-percent formatting stay
 * consistent everywhere.
 */

/** Format an integer with thousands separators. Returns `—` for nullish. */
export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.trunc(v).toLocaleString("en-US");
}

/** Format a number to `decimals` places, locale-aware grouping. */
export function fmtNum(
  v: number | null | undefined,
  decimals: number = 2,
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format USD currency with thousands separators and `decimals` decimals. */
export function fmtUsd(
  v: number | null | undefined,
  decimals: number = 2,
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Format a percent. Accepts ratio (0.123) by default; pass `asInteger` for
 *  pre-multiplied (12.3). */
export function fmtPct(
  v: number | null | undefined,
  decimals: number = 2,
  options: { asInteger?: boolean; sign?: boolean } = {},
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const value = options.asInteger ? v : v * 100;
  const sign = options.sign && value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** Format a signed scalar with an explicit + / − prefix. */
export function fmtSigned(
  v: number | null | undefined,
  decimals: number = 2,
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(decimals)}`;
}

/** Format a duration in seconds → `1h 23m 45s` / `45s` / `12m 30s`. */
export function fmtDuration(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return "—";
  const s = Math.floor(secs % 60);
  const m = Math.floor((secs / 60) % 60);
  const h = Math.floor(secs / 3600);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Format an epoch-ms timestamp → relative ("3m ago", "2d ago"). */
export function fmtRelative(epochMs: number | null | undefined): string {
  if (epochMs == null || !Number.isFinite(epochMs) || epochMs <= 0) return "—";
  const diff = Date.now() - epochMs;
  if (diff < 0) return "in future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

/** Format an epoch-ms timestamp → `YYYY-MM-DD HH:MM`. */
export function fmtDateTime(epochMs: number | null | undefined): string {
  if (epochMs == null || !Number.isFinite(epochMs) || epochMs <= 0) return "—";
  const d = new Date(epochMs);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}`;
}

/** Truncate an id / hash to its first `n` chars; `—` for empty/null. */
export function fmtShortId(id: string | null | undefined, n: number = 8): string {
  if (!id) return "—";
  return id.length <= n ? id : id.slice(0, n);
}

/** Pick a +/−/neutral direction from a signed number. */
export function signDirection(v: number | null | undefined): "pos" | "neg" | "neutral" {
  if (v == null || !Number.isFinite(v)) return "neutral";
  if (v > 0) return "pos";
  if (v < 0) return "neg";
  return "neutral";
}
