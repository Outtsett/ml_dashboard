/**
 * Volatility value to price range: what does v = ln(high − low) mean in
 * points, ticks and dollars on MNQ, from 1m to 1h — and how far do the two
 * corrections (median versus mean, the measured bias) move it? Replaced
 * Trading/quant/model/notebooks/volatility_to_price_range.py.
 *
 * Reads the snapshot bar views the notebook read through core.lake
 * (ohlcv_1m, ohlcv_5m, ohlcv_15m, ohlcv_30m, ohlcv_1h_v; 45m has no view, so
 * it is ohlcv_1m in 45-minute buckets on the same midnight origin as pandas'
 * resample). The EWMA recursion, calibration and fits run in TypeScript on the
 * server (packages/shared/src/studies/volatility-to-price-range.ts); the browser gets
 * only the aggregated tables, capped Q-Q points and a thinned sample per frame.
 * Point value and tick size come from packages/config/cost_model.json.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text, textList } from "../sql";
import type { StudyHandler, StudyLake } from "../types";
import {
  TIMEFRAMES, analyse, emptyBody,
  type Bar, type Instrument, type StudyParameters, type Timeframe, type VolatilityStudyBody,
} from "@shared/studies/volatility-to-price-range";

/** Where each timeframe's bars come from; 45m is bucketed from 1m. */
export const TIMEFRAME_SOURCES: Record<Timeframe, { view: string; bucketMinutes?: number }> = {
  "1m": { view: "ohlcv_1m" },
  "5m": { view: "ohlcv_5m" },
  "15m": { view: "ohlcv_15m" },
  "30m": { view: "ohlcv_30m" },
  "45m": { view: "ohlcv_1m", bucketMinutes: 45 },
  "1h": { view: "ohlcv_1h_v" },
};

const VIEWS = [...new Set(Object.values(TIMEFRAME_SOURCES).map((source) => source.view))];

interface CostEntry {
  point_value?: number;
  tick_size?: number;
  tick_value?: number;
}

function readCostModel(): Record<string, CostEntry> {
  try {
    return JSON.parse(readFileSync(path.resolve(process.cwd(), "packages/config/cost_model.json"), "utf8")) as Record<string, CostEntry>;
  } catch {
    return { MNQ: { point_value: 2, tick_size: 0.25, tick_value: 0.5 } };
  }
}

const COST_MODEL = readCostModel();
const ROOTS = Object.keys(COST_MODEL).filter((key) => /^[A-Z0-9]{1,6}$/.test(key));

function instrumentFor(symbol: string): Instrument {
  const entry = COST_MODEL[symbol] ?? {};
  const pointValue = entry.point_value ?? 2;
  const tickSize = entry.tick_size ?? 0.25;
  return { symbol, pointValue, tickSize, tickValue: entry.tick_value ?? pointValue * tickSize };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const volatilityQuery = z.object({
  symbol: z.string().refine((value) => ROOTS.includes(value), { message: "not a root in cost_model.json" }).default("MNQ"),
  start: z.string().regex(DATE).refine((value) => value >= "2023-01-01", { message: "the bar views start in 2023" }).default("2025-09-25"),
  end: z.union([z.literal(""), z.string().regex(DATE)]).default(""),
  lambda: z.coerce.number().min(0.8).max(0.995).default(0.94),
  bins: z.coerce.number().int().min(5).max(20).default(10),
  lowerQuantile: z.coerce.number().min(0.01).max(0.4).default(0.1),
  sigmaFit: z.enum(["window", "train"]).default("window"),
  trainFraction: z.coerce.number().min(0.3).max(0.9).default(0.7),
  gapRule: z.enum(["true", "false"]).default("false"),
  gapMultiple: z.coerce.number().min(1.5).max(30).default(3),
  qqPoints: z.coerce.number().int().min(100).max(3000).default(1000),
});

export type VolatilityQuery = z.infer<typeof volatilityQuery>;

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The read for one timeframe. Instants are compared with explicit UTC offsets,
 * and times come back as epoch milliseconds. A 45-minute bucket is
 * floor(epoch ms ÷ 2,700,000): 45 minutes divides a day, so the buckets start
 * at every midnight exactly as pandas' resample("45min") does from the first
 * day's midnight. Open, high, low, close follow the resample rules, with the
 * close taken by arg_max over the timestamp (never last()).
 */
export function barsSql(timeframe: Timeframe, symbol: string, start: string, end: string): string {
  const source = TIMEFRAME_SOURCES[timeframe];
  const clauses = [
    `symbol = ${text(symbol)}`,
    `timestamp >= TIMESTAMPTZ ${text(`${start} 00:00:00+00`)}`,
    "close > 0",
    "high IS NOT NULL",
    "low IS NOT NULL",
  ];
  if (end) clauses.push(`timestamp < TIMESTAMPTZ ${text(`${nextDay(end)} 00:00:00+00`)}`);
  const where = clauses.join(" AND ");
  if (source.bucketMinutes) {
    const width = num(source.bucketMinutes * 60_000);
    return `SELECT (epoch_ms(timestamp) // ${width}) * ${width} AS t, max(high) AS high, min(low) AS low, arg_max(close, timestamp) AS close `
      + `FROM ${ident(source.view)} WHERE ${where} GROUP BY 1 ORDER BY 1`;
  }
  return `SELECT epoch_ms(timestamp) AS t, max(high) AS high, min(low) AS low, arg_max(close, timestamp) AS close `
    + `FROM ${ident(source.view)} WHERE ${where} GROUP BY 1 ORDER BY 1`;
}

/** Roots from the cost model that have hourly bars at all (the symbol control offers only these). */
export function availableSymbolsSql(): string {
  return `SELECT DISTINCT symbol FROM ${ident("ohlcv_1h_v")} WHERE symbol IN (${textList(ROOTS)}) ORDER BY symbol`;
}

function sourceLabel(timeframe: Timeframe): string {
  const source = TIMEFRAME_SOURCES[timeframe];
  return source.bucketMinutes ? `${source.view} in ${source.bucketMinutes}-minute buckets` : source.view;
}

function toBars(rows: Array<Record<string, unknown>>): Bar[] {
  const out: Bar[] = [];
  for (const row of rows) {
    const t = Number(row.t);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (Number.isFinite(t) && Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close)) out.push({ t, high, low, close });
  }
  return out;
}

const BAR_CACHE_MS = 5 * 60_000;
const BAR_CACHE_SIZE = 6;

/**
 * A handler with its own short bar cache: moving λ, the bin count or the
 * quantile band re-runs only the TypeScript, not the lake read.
 */
export function createVolatilityHandler(): StudyHandler<typeof volatilityQuery, VolatilityStudyBody> {
  const barCache = new Map<string, { at: number; bars: Partial<Record<Timeframe, Bar[]>> }>();
  let symbolCache: { at: number; symbols: string[] } | null = null;

  async function readSymbols(lake: StudyLake): Promise<string[]> {
    if (symbolCache && Date.now() - symbolCache.at < BAR_CACHE_MS) return symbolCache.symbols;
    const rows = await lake.query<{ symbol: string }>(availableSymbolsSql());
    const symbols = rows.map((row) => String(row.symbol));
    symbolCache = { at: Date.now(), symbols };
    return symbols;
  }

  async function readBars(lake: StudyLake, symbol: string, start: string, end: string): Promise<Partial<Record<Timeframe, Bar[]>>> {
    const key = `${symbol}|${start}|${end}`;
    const hit = barCache.get(key);
    if (hit && Date.now() - hit.at < BAR_CACHE_MS) return hit.bars;
    const entries = await Promise.all(
      TIMEFRAMES.map(async (timeframe) => [timeframe, toBars(await lake.query<Record<string, unknown>>(barsSql(timeframe, symbol, start, end), 90_000))] as const),
    );
    const bars: Partial<Record<Timeframe, Bar[]>> = {};
    for (const [timeframe, rows] of entries) bars[timeframe] = rows;
    barCache.set(key, { at: Date.now(), bars });
    while (barCache.size > BAR_CACHE_SIZE) {
      const oldest = barCache.keys().next().value;
      if (oldest === undefined) break;
      barCache.delete(oldest);
    }
    return bars;
  }

  return {
    slug: "volatility-to-price-range",
    datasets: VIEWS,
    query: volatilityQuery,
    cacheSeconds: 600,
    timeoutMs: 180_000,
    async run(query, context) {
      const instrument = instrumentFor(query.symbol);
      const parameters: StudyParameters = {
        symbol: query.symbol,
        start: query.start,
        end: query.end || null,
        lambda: query.lambda,
        binCount: query.bins,
        lowerQuantile: query.lowerQuantile,
        upperQuantile: 1 - query.lowerQuantile,
        sigmaFit: query.sigmaFit,
        trainFraction: query.trainFraction,
        gapMultiple: query.gapRule === "true" ? query.gapMultiple : null,
        quantilePlotPoints: query.qqPoints,
      };
      if ((await missingViews(context, VIEWS)).length > 0) return emptyBody(instrument, parameters, []);
      if (query.end && query.end < query.start) {
        context.notes.push(`The window ends (${query.end}) before it starts (${query.start}); nothing to read.`);
        return emptyBody(instrument, parameters, []);
      }

      const [availableSymbols, bars] = await Promise.all([readSymbols(context.lake), readBars(context.lake, query.symbol, query.start, query.end)]);
      const sources: Partial<Record<Timeframe, string>> = {};
      for (const timeframe of TIMEFRAMES) sources[timeframe] = sourceLabel(timeframe);
      const body = analyse(bars, { instrument, parameters, availableSymbols, sources });

      const skipped = TIMEFRAMES.filter((timeframe) => !body.timeframes.includes(timeframe));
      if (body.timeframes.length === 0) {
        context.notes.push(`No ${query.symbol} bars in the window ${query.start} to ${query.end || "the latest bar"} in any of the bar views.`);
      } else if (skipped.length > 0) {
        context.notes.push(`Too few ${query.symbol} bars for ${skipped.join(", ")} in this window; those timeframes are left out.`);
      }
      const spans = body.load.map((row) => `${row.timeframe} ${new Date(row.firstBar).toISOString().slice(0, 10)} to ${new Date(row.lastBar).toISOString().slice(0, 10)}`);
      if (new Set(body.load.map((row) => `${row.firstBar}|${new Date(row.lastBar).toISOString().slice(0, 10)}`)).size > 1) {
        context.notes.push(`The timeframes do not cover the same span (${spans.join("; ")}): each view has its own history.`);
      }
      if (parameters.sigmaFit === "window") {
        context.notes.push("Residual σ is fitted over the whole window, as the notebook did; switch σ fit to “first part only” to keep it out of the bars it converts.");
      }
      context.notes.push("Timestamps are the lake's futures stamps: Pacific wall-clock digits stored as UTC.");
      return body;
    },
  };
}

export default createVolatilityHandler();
