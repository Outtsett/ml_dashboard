/**
 * Slope of price as a trading signal: a rolling linear-regression slope on MNQ
 * bars turned into long / short / flat and backtested against buy and hold.
 * Replaced Trading/quant/model/notebooks/slope_analysis.py.
 *
 * Reads the snapshot bar view for the chosen timeframe (ohlcv_5m for the
 * notebook's 5-minute bars) for the bare root `MNQ`, which the lake stores as
 * raw prices spliced at each contract roll. The contract each bar came from is
 * found by matching the bar to a dated contract's bar at the same instant
 * (open, high, low and close all equal); a change of contract is a roll, and
 * the ratio of the new contract's close to the old one's at the last shared
 * bar before it is the back-adjustment, the same ratio adjustment the Market
 * chart applies (`rollAdjustmentFactors`, marketData.ts). The slopes, signal
 * and both backtests run in TypeScript (packages/shared/src/studies/slope-signal-backtest.ts);
 * the browser gets only aggregated tables and thinned series.
 *
 * Point value and the round-trip cost in points come from packages/config/cost_model.json.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text } from "../sql";
import type { StudyHandler, StudyLake } from "../types";
import {
  NOTEBOOK, TIMEFRAMES, analyse, detectRolls, emptyBody, rollFactors,
  type Bar, type InstrumentInfo, type RollRow, type SlopeParameters, type SlopeStudyBody, type Timeframe,
} from "@shared/studies/slope-signal-backtest";

const SYMBOL = "MNQ";

/** The bar view each timeframe is read from. */
export const TIMEFRAME_VIEWS: Record<Timeframe, string> = {
  "1m": "ohlcv_1m",
  "5m": "ohlcv_5m",
  "15m": "ohlcv_15m",
  "30m": "ohlcv_30m",
  "1h": "ohlcv_1h_v",
};

const VIEWS = Object.values(TIMEFRAME_VIEWS);

/** The newest bars kept when a window is larger than this (a 1-minute window from 2024 is ~650,000). */
export const MAX_BARS = 250_000;

const CONTRACT = /^MNQ[FGHJKMNQUVXZ][0-9]$/;
const CONTRACT_PATTERN = `^${SYMBOL}[FGHJKMNQUVXZ][0-9]$`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface CostEntry {
  point_value?: number;
  tick_size?: number;
  total_round_trip_points?: number;
}

function readInstrument(): InstrumentInfo {
  let entry: CostEntry = {};
  try {
    const model = JSON.parse(readFileSync(path.resolve(process.cwd(), "packages/config/cost_model.json"), "utf8")) as Record<string, CostEntry>;
    entry = model[SYMBOL] ?? {};
  } catch {
    entry = {};
  }
  return {
    symbol: SYMBOL,
    pointValueUsd: entry.point_value ?? 2,
    tickSize: entry.tick_size ?? 0.25,
    roundTripPoints: entry.total_round_trip_points ?? 1.39,
  };
}

const INSTRUMENT = readInstrument();

export const slopeQuery = z.object({
  timeframe: z.enum(TIMEFRAMES).default("5m"),
  start: z.string().regex(DATE).refine((value) => value >= "2023-01-01", { message: "the bar views start in 2023" }).default(NOTEBOOK.start),
  window: z.coerce.number().int().min(3).max(200).default(NOTEBOOK.signalWindow),
  slowWindow: z.coerce.number().int().min(3).max(400).default(NOTEBOOK.slowWindow),
  thresholdMultiplier: z.coerce.number().min(0).max(3).default(NOTEBOOK.thresholdMultiplier),
  costPoints: z.coerce.number().min(0).max(20).default(INSTRUMENT.roundTripPoints),
  longOnly: z.enum(["true", "false"]).default("false"),
  backAdjust: z.enum(["true", "false"]).default("true"),
  slopeUnit: z.enum(["points", "percent"]).default("points"),
  demoStart: z.coerce.number().int().min(0).max(1_000_000).default(NOTEBOOK.demoStart),
  zoomBars: z.coerce.number().int().min(100).max(5000).default(NOTEBOOK.zoomBars),
});

export type SlopeQuery = z.infer<typeof slopeQuery>;

/**
 * The bars with the contract each one came from. `b` is the newest MAX_BARS + 1
 * rows of the bare root from `start`; `k` the dated contracts' bars; a bar's
 * contract is the one whose bar equals it on all four prices (highest volume if
 * two do), or NULL when none does.
 */
export function barsSql(view: string, start: string, limit: number): string {
  const since = `timestamp >= TIMESTAMPTZ ${text(`${start} 00:00:00+00`)}`;
  return [
    `WITH b AS (SELECT timestamp, open, high, low, close, volume FROM ${ident(view)}`,
    `  WHERE symbol = ${text(SYMBOL)} AND ${since} AND close > 0 AND high IS NOT NULL AND low IS NOT NULL AND volume IS NOT NULL`,
    `  ORDER BY timestamp DESC LIMIT ${num(limit)}),`,
    `k AS (SELECT timestamp, symbol, open, high, low, close, volume FROM ${ident(view)}`,
    `  WHERE regexp_matches(symbol, ${text(CONTRACT_PATTERN)}) AND ${since})`,
    `SELECT epoch_ms(b.timestamp) AS t, b.open, b.high, b.low, b.close, b.volume, arg_max(k.symbol, k.volume) AS contract`,
    `FROM b LEFT JOIN k ON k.timestamp = b.timestamp AND k.open = b.open AND k.high = b.high AND k.low = b.low AND k.close = b.close`,
    `GROUP BY b.timestamp, b.open, b.high, b.low, b.close, b.volume ORDER BY b.timestamp`,
  ].join("\n");
}

/** Both contracts' closes at the last instant at or before `atMs` (within a day) that they share. */
export function rollRatioSql(view: string, oldContract: string, newContract: string, atMs: number): string {
  if (!CONTRACT.test(oldContract) || !CONTRACT.test(newContract)) throw new Error("not a dated contract symbol");
  return [
    `SELECT epoch_ms(a.timestamp) AS t, a.close AS old_close, n.close AS new_close`,
    `FROM ${ident(view)} a JOIN ${ident(view)} n ON n.timestamp = a.timestamp`,
    `WHERE a.symbol = ${text(oldContract)} AND n.symbol = ${text(newContract)}`,
    `  AND epoch_ms(a.timestamp) <= ${num(atMs)} AND epoch_ms(a.timestamp) > ${num(atMs - 86_400_000)}`,
    `ORDER BY a.timestamp DESC LIMIT 1`,
  ].join("\n");
}

interface WindowRead {
  at: number;
  view: string;
  bars: Bar[];
  rolls: RollRow[];
  unmatchedBars: number;
  capped: boolean;
  notes: string[];
}

const CACHE_MS = 5 * 60_000;
const CACHE_SIZE = 6;

function toBar(row: Record<string, unknown>): Bar | null {
  const bar = { t: Number(row.t), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume) };
  return Object.values(bar).every(Number.isFinite) ? bar : null;
}

/**
 * A handler with its own short window cache: moving a window, the threshold or
 * the cost re-runs only the TypeScript, not the lake reads.
 */
export function createSlopeHandler(): StudyHandler<typeof slopeQuery, SlopeStudyBody> {
  const cache = new Map<string, WindowRead>();

  async function readWindow(lake: StudyLake, timeframe: Timeframe, start: string): Promise<WindowRead> {
    const key = `${timeframe}|${start}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;

    const view = TIMEFRAME_VIEWS[timeframe];
    const notes: string[] = [];
    const rows = await lake.query<Record<string, unknown>>(barsSql(view, start, MAX_BARS + 1), 120_000);
    const capped = rows.length > MAX_BARS;
    const kept = capped ? rows.slice(rows.length - MAX_BARS) : rows;
    const bars: Bar[] = [];
    const contracts: Array<string | null> = [];
    for (const row of kept) {
      const bar = toBar(row);
      if (!bar) continue;
      bars.push(bar);
      contracts.push(row.contract === null || row.contract === undefined ? null : String(row.contract));
    }
    if (capped) notes.push(`The window holds more than ${MAX_BARS.toLocaleString("en-US")} ${timeframe} bars; the newest ${MAX_BARS.toLocaleString("en-US")} are used.`);
    const first = bars[0];
    if (first && !capped) {
      const firstDate = new Date(first.t).toISOString().slice(0, 10);
      const startMs = Date.parse(`${start}T00:00:00Z`);
      if (first.t - startMs > 4 * 86_400_000) notes.push(`The ${view} view starts on ${firstDate}, later than the requested ${start}.`);
    }

    const unmatchedBars = contracts.filter((contract) => contract === null).length;
    const detected = detectRolls(contracts);
    const rolls: RollRow[] = [];
    if (detected.length > 12) {
      notes.push(`${detected.length} contract changes were found in the window, which is not a roll schedule; no roll adjustment is applied.`);
    } else {
      for (const roll of detected) {
        const previous = bars[roll.index - 1];
        const current = bars[roll.index];
        if (!previous || !current) continue;
        let oldClose: number | null = null;
        let newClose: number | null = null;
        try {
          const ratioRows = await lake.query<{ old_close: number; new_close: number }>(rollRatioSql(view, roll.from, roll.to, previous.t), 60_000);
          const row = ratioRows[0];
          if (row && Number(row.old_close) > 0 && Number(row.new_close) > 0) {
            oldClose = Number(row.old_close);
            newClose = Number(row.new_close);
          }
        } catch (error) {
          notes.push(`Could not read the ${roll.from} to ${roll.to} roll ratio: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (oldClose === null) notes.push(`${roll.from} and ${roll.to} share no bar in the day before the roll; that roll is left unadjusted.`);
        rolls.push({
          barIndex: roll.index,
          timestamp: current.t,
          fromContract: roll.from,
          toContract: roll.to,
          oldClose,
          newClose,
          ratio: oldClose !== null && newClose !== null ? newClose / oldClose : 1,
          rawStepPoints: current.close - previous.close,
        });
      }
    }
    if (unmatchedBars > 0) notes.push(`${unmatchedBars.toLocaleString("en-US")} of ${bars.length.toLocaleString("en-US")} bars matched no dated contract's bar; they keep the contract of the bar before.`);

    const read: WindowRead = { at: Date.now(), view, bars, rolls, unmatchedBars, capped, notes };
    cache.set(key, read);
    while (cache.size > CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return read;
  }

  return {
    slug: "slope-signal-backtest",
    datasets: VIEWS,
    query: slopeQuery,
    cacheSeconds: 600,
    timeoutMs: 180_000,
    async run(query, context) {
      const parameters: SlopeParameters = {
        symbol: SYMBOL,
        timeframe: query.timeframe,
        start: query.start,
        window: query.window,
        slowWindow: query.slowWindow,
        thresholdMultiplier: query.thresholdMultiplier,
        costPoints: query.costPoints,
        longOnly: query.longOnly === "true",
        backAdjust: query.backAdjust === "true",
        slopeUnit: query.slopeUnit,
        demoStart: query.demoStart,
        zoomBars: query.zoomBars,
      };
      const view = TIMEFRAME_VIEWS[query.timeframe];
      if ((await missingViews(context, [view])).length > 0) return emptyBody(parameters, INSTRUMENT);

      const read = await readWindow(context.lake, query.timeframe, query.start);
      context.notes.push(...read.notes);
      if (read.bars.length === 0) {
        context.notes.push(`No ${SYMBOL} bars in ${view} from ${query.start}.`);
        return emptyBody(parameters, INSTRUMENT);
      }
      if (read.bars.length < query.window + 2) {
        context.notes.push(`Only ${read.bars.length} bars from ${query.start}: too few for a ${query.window}-bar slope.`);
      }
      const factors = rollFactors(read.bars.length, read.rolls.map((roll) => ({ index: roll.barIndex, ratio: roll.ratio })));
      context.notes.push("Timestamps are the lake's futures stamps: Pacific wall-clock digits stored as UTC.");
      return analyse({ bars: read.bars, factors, rolls: read.rolls, parameters, instrument: INSTRUMENT, view: read.view, unmatchedBars: read.unmatchedBars });
    },
  };
}

export default createSlopeHandler();
