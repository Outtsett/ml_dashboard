/**
 * Chart companion: the bars the Market chart shows, plus warm-up bars before
 * them, in one columnar response. Replaced notebooks/chart_companion.py, whose
 * `lake.dashboard.chart_bars` did this over HTTP against /api/charts/ohlcv.
 *
 * Two ways to name the bars:
 *   - a range (`startMs` and `endMs`, the chart's visible range in its own
 *     stamps; `lastBarMs` for a futures root so the roll adjustment matches the
 *     one the chart drew): the visible bars are those inside it;
 *   - none: the newest `visibleBars` bars ("latest").
 * Either way `warmupBars` earlier bars come first so a causal statistic starts
 * full on the first visible bar. The statistics themselves are computed by the
 * page from packages/shared/src/studies/chart-companion.ts.
 *
 * Bars come through the chart's own readers (marketData.ts: the lake's
 * timeframe views; a futures root is the front-month stitch, ratio-adjusted as
 * the chart draws it, zero-volume padding dropped). The readers are reached
 * through a `BarLoader`, so a test hands the handler a fake.
 */

import { z } from "zod";
import { isValidSymbol } from "@shared/validation";
import { isFuturesRoot } from "../../infrastructure/lib/futures";
import { normalizeTimestamp } from "../../infrastructure/lib/normalize";
import { ident, text } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler, StudyLake } from "../types";
import {
  COMPANION_TIMEFRAMES, MAX_BARS_PER_REQUEST, TIMEFRAME_MILLISECONDS, WARMUP_BARS_DEFAULT, clockLabel, emptyBody,
  type ChartCompanionBody, type CompanionTimeframe,
} from "@shared/studies/chart-companion";

const TIMEFRAME_VIEW: Record<CompanionTimeframe, string> = {
  "1m": "ohlcv_1m", "5m": "ohlcv_5m", "15m": "ohlcv_15m", "30m": "ohlcv_30m",
  "1h": "ohlcv_1h_v", "4h": "ohlcv_4h", "1d": "ohlcv_1d", "1w": "ohlcv_1w",
};

const FOUR_DAYS_MILLISECONDS = 4 * 24 * 60 * 60 * 1000;
const READ_ATTEMPTS = 5;

export interface BarRow {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** What the handler needs from the market-data readers. */
export interface BarLoader {
  isFuturesRoot(symbol: string): boolean;
  /** The newest stamp the chart would anchor on for this symbol, or null when it has no bars. */
  anchor(symbol: string, timeframe: CompanionTimeframe): Promise<number | null>;
  /** Bars in [startMs, endMs], ascending, in the chart's stamps. `limit` keeps the newest bars when `newest`, else the oldest. */
  bars(symbol: string, timeframe: CompanionTimeframe, startMs: number, endMs: number, limit: number, newest: boolean): Promise<BarRow[]>;
}

function optionalInteger(minimum: number, maximum: number) {
  return z.preprocess((value) => (value === undefined || value === "" ? undefined : Number(value)), z.number().int().min(minimum).max(maximum).optional());
}

const querySchema = z.object({
  symbol: z.string().trim().toUpperCase().refine(isValidSymbol, "not a symbol"),
  timeframe: z.enum(COMPANION_TIMEFRAMES).default("1m"),
  assetClass: z.enum(["futures", "forex"]).optional(),
  startMs: optionalInteger(0, 4_000_000_000_000),
  endMs: optionalInteger(0, 4_000_000_000_000),
  lastBarMs: optionalInteger(0, 4_000_000_000_000),
  visibleBars: z.preprocess((value) => (value === undefined || value === "" ? undefined : Number(value)), z.number().int().min(10).max(MAX_BARS_PER_REQUEST).default(500)),
  warmupBars: z.preprocess((value) => (value === undefined || value === "" ? undefined : Number(value)), z.number().int().min(0).max(5_000).default(WARMUP_BARS_DEFAULT)),
});
type CompanionQuery = z.infer<typeof querySchema>;

function usable(row: BarRow): boolean {
  return Number.isFinite(row.timestamp) && row.timestamp > 0 && [row.open, row.high, row.low, row.close].every(Number.isFinite);
}

/** Ascending, one row per stamp, unusable rows dropped. */
function tidy(rows: readonly BarRow[]): BarRow[] {
  const byStamp = new Map<number, BarRow>();
  for (const row of rows) {
    if (usable(row)) byStamp.set(row.timestamp, { ...row, volume: Number.isFinite(row.volume) ? row.volume : 0 });
  }
  return [...byStamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function columnar(rows: readonly BarRow[]): ChartCompanionBody["bars"] {
  return {
    timestamps: rows.map((row) => row.timestamp),
    open: rows.map((row) => row.open),
    high: rows.map((row) => row.high),
    low: rows.map((row) => row.low),
    close: rows.map((row) => row.close),
    volume: rows.map((row) => row.volume),
  };
}

export function createChartCompanionHandler(makeLoader: (lake: StudyLake) => BarLoader): StudyHandler<typeof querySchema, ChartCompanionBody> {
  return {
    slug: "chart-companion",
    datasets: [...new Set(Object.values(TIMEFRAME_VIEW))],
    query: querySchema,
    cacheSeconds: 120,
    timeoutMs: 60_000,
    async run(query: CompanionQuery, context) {
      const loader = makeLoader(context.lake);
      const futures = loader.isFuturesRoot(query.symbol);
      const assetClass = query.assetClass ?? (futures ? "futures" : "forex");
      const timeframe = query.timeframe;
      const empty = emptyBody(query.symbol, timeframe, assetClass, query.warmupBars);
      const view = TIMEFRAME_VIEW[timeframe];
      if ((await missingViews(context, [view])).length > 0) return empty;

      const barMilliseconds = TIMEFRAME_MILLISECONDS[timeframe];
      const extra = query.warmupBars;
      const adjustment = futures ? "ratio" : "none";
      let rows: BarRow[] = [];
      let visible: BarRow[] = [];
      let warmup: BarRow[] = [];
      let truncated = false;

      if (query.startMs !== undefined && query.endMs !== undefined) {
        const visibleStart = Math.min(query.startMs, query.endMs);
        const visibleEnd = Math.max(query.startMs, query.endMs);
        // A futures root is read to the chart's last loaded bar: the stitch
        // ratio-adjusts each window so its newest contract is unscaled, and
        // ending where the chart's data ends gives the same adjustment.
        const requestEnd = futures && query.lastBarMs !== undefined ? Math.max(visibleEnd, query.lastBarMs) : visibleEnd;
        // Warm-up: three bar-lengths of look-back per wanted bar (nights and weekends), at least four days, widened up to four times.
        let lookback = extra > 0 ? Math.max(extra * barMilliseconds * 3, FOUR_DAYS_MILLISECONDS) : 0;
        for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
          rows = tidy(await loader.bars(query.symbol, timeframe, Math.max(0, visibleStart - lookback), requestEnd, MAX_BARS_PER_REQUEST, false));
          const before = rows.filter((row) => row.timestamp < visibleStart).length;
          if (extra === 0 || before >= extra || rows.length >= MAX_BARS_PER_REQUEST) break;
          lookback *= 4;
        }
        const last = rows[rows.length - 1];
        truncated = rows.length >= MAX_BARS_PER_REQUEST && last !== undefined && last.timestamp < visibleEnd;
        visible = rows.filter((row) => row.timestamp >= visibleStart && row.timestamp <= visibleEnd);
        warmup = extra > 0 ? rows.filter((row) => row.timestamp < visibleStart).slice(-extra) : [];
      } else {
        if (query.startMs !== undefined || query.endMs !== undefined) {
          context.notes.push("Only one end of a time range was given, so the newest bars are read instead.");
        }
        const anchor = await loader.anchor(query.symbol, timeframe);
        if (anchor === null) {
          context.notes.push(`${query.symbol} has no ${timeframe} bars in the lake.`);
          return empty;
        }
        const wanted = query.visibleBars + extra;
        let span = Math.max(wanted * barMilliseconds * 3, FOUR_DAYS_MILLISECONDS);
        for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
          rows = tidy(await loader.bars(query.symbol, timeframe, Math.max(0, anchor - span), anchor, wanted, true));
          if (rows.length >= wanted) break;
          span *= 4;
        }
        rows = rows.slice(-wanted);
        visible = rows.slice(Math.max(0, rows.length - query.visibleBars));
        warmup = rows.slice(0, rows.length - visible.length);
      }

      if (visible.length === 0) {
        context.notes.push(`The range holds no ${query.symbol} ${timeframe} bars.`);
        return empty;
      }
      if (truncated) {
        context.notes.push(`The read reached the ${MAX_BARS_PER_REQUEST.toLocaleString("en-US")}-bar limit before the end of the range, so the newest bars are missing; narrow the range.`);
      }
      if (warmup.length < extra) {
        context.notes.push(`Only ${warmup.length} of ${extra} warm-up bars exist before the first visible bar, so the first visible bars carry no score.`);
      }
      const all = [...warmup, ...visible];
      return {
        symbol: query.symbol,
        timeframe,
        assetClass,
        adjustment,
        clock: clockLabel(assetClass),
        firstVisibleMs: (visible[0] as BarRow).timestamp,
        lastVisibleMs: (visible[visible.length - 1] as BarRow).timestamp,
        warmupCount: warmup.length,
        visibleCount: visible.length,
        warmupRequested: extra,
        truncated,
        bars: columnar(all),
      };
    },
  };
}

/** The chart's own readers (marketData.ts), loaded when a request arrives so a test never opens the lake. */
function marketDataLoader(lake: StudyLake): BarLoader {
  const toRow = (bar: Record<string, unknown>): BarRow => ({
    timestamp: normalizeTimestamp(bar.timestamp),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume ?? 0),
  });
  return {
    isFuturesRoot,
    async anchor(symbol, timeframe) {
      if (isFuturesRoot(symbol)) {
        const { getFrontMonthAnchor } = await import("../../infrastructure/database/lake/marketData");
        return getFrontMonthAnchor(symbol);
      }
      const rows = await lake.query<{ latest: unknown }>(`SELECT max(timestamp) AS latest FROM ${ident(TIMEFRAME_VIEW[timeframe])} WHERE symbol = ${text(symbol)}`);
      const latest = rows[0]?.latest;
      if (latest === null || latest === undefined) return null;
      const stamp = normalizeTimestamp(latest);
      return Number.isFinite(stamp) && stamp > 0 ? stamp : null;
    },
    async bars(symbol, timeframe, startMs, endMs, limit, newest) {
      const market = await import("../../infrastructure/database/lake/marketData");
      const rows = isFuturesRoot(symbol)
        ? await market.getStitchedOHLCV(symbol, timeframe, startMs, endMs, limit, "ratio")
        : await market.getOHLCVSampleBy(symbol, timeframe, startMs, endMs, limit, newest);
      return (rows as unknown as Array<Record<string, unknown>>).map(toRow);
    },
  };
}

export default createChartCompanionHandler(marketDataLoader);
