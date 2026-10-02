/**
 * Risk math primitives — cumulative P&L, drawdown, rolling Sharpe, VaR/ES,
 * exposure aggregation, correlation matrices. Centralized so every risk
 * surface (Risk page, Portfolio redesign, Paper) computes from the same
 * canonical definitions.
 *
 * Conventions:
 *   - PnL series ordered chronologically.
 *   - Returns are SIMPLE returns r_t = (V_t - V_{t-1}) / V_{t-1}, not log.
 *   - Sharpe is annualized using a passed-in periods-per-year factor.
 *   - Drawdown is reported as a NEGATIVE fraction (−0.18 = 18% peak-to-trough).
 *
 * These helpers never throw on empty input — they return null / [] so call
 * sites can render empty-state UI without try/catch noise.
 */

import type { Trade } from "@/shared/utils/types";

export interface EquityPoint {
  /** Epoch milliseconds. */
  t: number;
  /** Cumulative P&L (absolute, in account currency). */
  equity: number;
}

export interface DrawdownPoint {
  t: number;
  equity: number;
  /** Running peak equity since inception. */
  peak: number;
  /** Drawdown fraction (≤ 0). −0.18 ⇒ 18% below peak. */
  drawdown: number;
}

/** Build a cumulative P&L (equity) curve from closed trades. */
export function buildEquityCurve(trades: Trade[]): EquityPoint[] {
  const closed = trades
    .filter((t) => t.exitTimestamp != null && t.pnl != null)
    .sort((a, b) => (a.exitTimestamp ?? 0) - (b.exitTimestamp ?? 0));
  let cum = 0;
  const out: EquityPoint[] = [];
  for (const t of closed) {
    cum += t.pnl ?? 0;
    out.push({ t: t.exitTimestamp!, equity: cum });
  }
  return out;
}

/** Compute peak-to-trough drawdown series from an equity curve. */
export function buildDrawdownSeries(curve: EquityPoint[]): DrawdownPoint[] {
  let peak = -Infinity;
  return curve.map((p) => {
    if (p.equity > peak) peak = p.equity;
    const dd = peak === 0 ? 0 : (p.equity - peak) / Math.abs(peak || 1);
    return {
      t: p.t,
      equity: p.equity,
      peak,
      drawdown: dd,
    };
  });
}

/** Maximum drawdown (NEGATIVE fraction). */
export function maxDrawdown(dd: DrawdownPoint[]): number | null {
  if (dd.length === 0) return null;
  let mn = 0;
  for (const p of dd) if (p.drawdown < mn) mn = p.drawdown;
  return mn;
}

/** Compute simple returns from an equity curve. r_t = (E_t − E_{t-1}) / |E_{t-1}|.
 *  When the previous equity is 0, we use the absolute change scaled by 1 unit
 *  to avoid divide-by-zero; this only matters at inception. */
export function returnsFromCurve(curve: EquityPoint[]): number[] {
  if (curve.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < curve.length; i += 1) {
    const prev = curve[i - 1]!.equity;
    const cur = curve[i]!.equity;
    const denom = Math.abs(prev) > 1e-9 ? Math.abs(prev) : 1;
    out.push((cur - prev) / denom);
  }
  return out;
}

/** Sample mean (returns null on empty). */
export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (Bessel-corrected, n-1). Returns null on n<2. */
export function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  if (m == null) return null;
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

/** Annualized Sharpe ratio. Pass periods-per-year ≈ trades/year for trade-level
 *  returns, or 252 for daily. Risk-free rate is per-period (default 0). */
export function sharpe(
  returns: number[],
  periodsPerYear: number,
  rfPerPeriod: number = 0,
): number | null {
  const m = mean(returns);
  const s = stdev(returns);
  if (m == null || s == null || s === 0) return null;
  return ((m - rfPerPeriod) / s) * Math.sqrt(periodsPerYear);
}

/** Sortino ratio — like Sharpe but only downside vol in the denominator. */
export function sortino(
  returns: number[],
  periodsPerYear: number,
  rfPerPeriod: number = 0,
): number | null {
  const m = mean(returns);
  if (m == null) return null;
  const downside: number[] = [];
  for (const r of returns) if (r < rfPerPeriod) downside.push(r - rfPerPeriod);
  if (downside.length < 2) return null;
  const dn = stdev(downside);
  if (dn == null || dn === 0) return null;
  return ((m - rfPerPeriod) / dn) * Math.sqrt(periodsPerYear);
}

/** Historical VaR at confidence c (e.g. 0.99). Returns the NEGATIVE return at
 *  the loss tail — a NEGATIVE number for losses. */
export function historicalVaR(returns: number[], c: number = 0.99): number | null {
  if (returns.length === 0) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - c) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))] ?? null;
}

/** Expected shortfall (CVaR) — mean of returns worse than VaR. */
export function expectedShortfall(returns: number[], c: number = 0.99): number | null {
  if (returns.length === 0) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor((1 - c) * sorted.length));
  return mean(sorted.slice(0, cut));
}

/** Win rate of closed trades — fraction of trades with positive P&L. */
export function winRate(trades: Trade[]): number | null {
  const closed = trades.filter((t) => t.exitTimestamp != null && t.pnl != null);
  if (closed.length === 0) return null;
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  return wins / closed.length;
}

/** Aggregate notional exposure by a key (symbol, side, asset class). */
export function exposureBy<K extends keyof Trade>(
  positions: Pick<Trade, K | "quantity" | "entryPrice">[],
  key: K,
): { name: string; value: number; pct: number }[] {
  const grouped = new Map<string, number>();
  let total = 0;
  for (const p of positions) {
    const k = String(p[key] ?? "—");
    const notional = Math.abs((p.quantity ?? 0) * (p.entryPrice ?? 0));
    grouped.set(k, (grouped.get(k) ?? 0) + notional);
    total += notional;
  }
  if (total === 0) return [];
  return Array.from(grouped.entries())
    .map(([name, value]) => ({ name, value, pct: value / total }))
    .sort((a, b) => b.value - a.value);
}

/** Pearson correlation between two equal-length series. Returns null when
 *  either input is too short, has zero variance, or has length mismatch. */
export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  if (mx == null || my == null) return null;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

/** Build a symmetric symbol × symbol correlation matrix from per-symbol
 *  return series. Returns the matrix as { symbols, m[i][j] } where m[i][j]
 *  is the corr between symbols[i] and symbols[j]; m[i][i] = 1. */
export function correlationMatrix(
  seriesBySymbol: Record<string, number[]>,
): { symbols: string[]; m: (number | null)[][] } {
  const symbols = Object.keys(seriesBySymbol).sort();
  const n = symbols.length;
  const m: (number | null)[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => null),
  );
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      if (i === j) {
        m[i]![j] = 1;
      } else {
        const a = seriesBySymbol[symbols[i]!] ?? [];
        const b = seriesBySymbol[symbols[j]!] ?? [];
        const k = Math.min(a.length, b.length);
        if (k < 2) {
          m[i]![j] = null;
          m[j]![i] = null;
        } else {
          const corr = pearson(a.slice(-k), b.slice(-k));
          m[i]![j] = corr;
          m[j]![i] = corr;
        }
      }
    }
  }
  return { symbols, m };
}

/** Build per-symbol return series from closed trades — uses trade P&L%. */
export function returnSeriesBySymbol(trades: Trade[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const closed = trades
    .filter((t) => t.exitTimestamp != null && t.pnlPct != null)
    .sort((a, b) => (a.exitTimestamp ?? 0) - (b.exitTimestamp ?? 0));
  for (const t of closed) {
    if (!out[t.symbol]) out[t.symbol] = [];
    out[t.symbol]!.push(t.pnlPct! / 100); // pnlPct stored as percent
  }
  return out;
}

/** Rolling Sharpe series — window is in number of returns (e.g. 20, 60, 252). */
export function rollingSharpe(
  returns: number[],
  window: number,
  periodsPerYear: number,
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < returns.length; i += 1) {
    if (i + 1 < window) {
      out.push(null);
      continue;
    }
    const slice = returns.slice(i + 1 - window, i + 1);
    out.push(sharpe(slice, periodsPerYear));
  }
  return out;
}

/** Profit factor — gross profit / |gross loss|. Null when no losing trades. */
export function profitFactor(trades: Trade[]): number | null {
  let win = 0;
  let loss = 0;
  for (const t of trades) {
    const p = t.pnl ?? 0;
    if (p > 0) win += p;
    else if (p < 0) loss += p;
  }
  if (loss === 0) return null;
  return win / Math.abs(loss);
}
