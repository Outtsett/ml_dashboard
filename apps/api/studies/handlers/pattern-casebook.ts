/**
 * Pattern casebook: the 2026-09-15 candlestick-pattern findings restated as
 * dated MNQ trades in ticks and dollars, each beside random bars traded the
 * same way. Replaced datalake/notebooks/findings_casebook.py.
 *
 * Reads the casebook landed by packages/ml-engine/src/studies/pattern_casebook/build.py
 * (derived_study_pattern_casebook_<table>) and, for the candles around a
 * trade and the random bars, datalake's next-candles datasets
 * (derived_mnq_next_candles_<timeframe>). One route, five parts, so moving
 * one control refetches only its section:
 *
 *   part=overview       run information, the 22 findings, the 60 last-move rules, the dashboard's MNQ cost
 *   part=sides          every pattern side of one timeframe and year, repriced at `cost`
 *   part=case           trade number `step` of a pattern side (or of as many random bars) with its candles
 *   part=distribution   section 2: histogram shares, running dollars against random draws, eight numbers
 *   part=columns        section 5: every column of the selected firing table profiled
 *
 * Net dollars are (gross ticks - cost) x dollars per tick at the `cost` asked
 * for (default: the casebook's own 5.6022 ticks). Random bars are drawn with a
 * seeded generator here, not numpy's, so the draws are different bars than the
 * notebook's; the random-bar band of section 3 is the build's own.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { LRUCache } from "lru-cache";
import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text } from "../sql";
import type { StudyContext, StudyHandler, StudyLake } from "../types";
import {
  HORIZON, TIMEFRAMES, casebookEightNumbers, eightNumbers, histogramShares, netDollars, numpyHistogram, rankBestFirst,
  repriceSide, runningDollars, sampleWithoutReplacement,
  type CaseBody, type CaseTrade, type ColumnsBody, type DistributionBody, type FindingRow, type LastMoveRule,
  type OverviewBody, type RunInformation, type SideRow, type SidesBody, type WindowCandle,
} from "@shared/studies/pattern-casebook";

const PREFIX = "derived_study_pattern_casebook_";
const VIEWS = {
  run: `${PREFIX}run_information`,
  findings: `${PREFIX}recent_findings`,
  sides: `${PREFIX}pattern_side_dollars`,
  rules: `${PREFIX}last_move_rules`,
  trades: `${PREFIX}pattern_firing_trades`,
} as const;
const CASEBOOK_VIEWS = Object.values(VIEWS);
const candleView = (timeframe: string) => `derived_mnq_next_candles_${timeframe}`;
const WINDOW_BEFORE = 24;
const WINDOW_AFTER = HORIZON;

const query = z.object({
  part: z.enum(["overview", "sides", "case", "distribution", "columns"]).default("overview"),
  timeframe: z.enum(TIMEFRAMES).default("1m"),
  year: z.coerce.number().int().min(2021).max(2025).default(2024),
  candle: z.coerce.number().int().min(1).max(HORIZON).default(1),
  pattern: z.string().regex(/^[a-z0-9]{1,40}$/).default("engulfing"),
  side: z.string().regex(/^[a-z0-9 ,]{1,40}$/).default("bullish"),
  population: z.enum(["pattern", "random"]).default("pattern"),
  order: z.enum(["time", "best", "worst"]).default("time"),
  draw: z.coerce.number().int().min(1).max(1000).default(1),
  step: z.coerce.number().int().min(1).max(10_000_000).default(1),
  cost: z.coerce.number().min(0).max(20).optional(),
  view: z.enum(["net", "gross"]).default("net"),
  span: z.coerce.number().min(90).max(100).default(98),
  lines: z.coerce.number().int().min(5).max(60).default(20),
  bins: z.coerce.number().int().min(10).max(80).default(30),
});
type Query = z.infer<typeof query>;

// ---------------------------------------------------------------- reading

function numberOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function dashboardCostTicks(): number | null {
  try {
    const model = JSON.parse(readFileSync(path.resolve(process.cwd(), "packages/config/cost_model.json"), "utf8")) as Record<string, { total_round_trip?: number; tick_value?: number }>;
    const mnq = model.MNQ;
    if (!mnq?.total_round_trip || !mnq.tick_value) return null;
    return mnq.total_round_trip / mnq.tick_value;
  } catch {
    return null;
  }
}

/** Caches per lake, so a test's fake lake never sees another lake's rows. */
const caches = new WeakMap<StudyLake, { run: LRUCache<string, RunInformation>; firings: LRUCache<string, Firings>; pools: LRUCache<string, Pool> }>();
function cachesFor(lake: StudyLake) {
  let entry = caches.get(lake);
  if (!entry) {
    entry = {
      run: new LRUCache({ max: 1, ttl: 10 * 60_000 }),
      firings: new LRUCache({ max: 12, ttl: 10 * 60_000 }),
      pools: new LRUCache({ max: 4, ttl: 10 * 60_000 }),
    };
    caches.set(lake, entry);
  }
  return entry;
}

async function runInformation(lake: StudyLake): Promise<RunInformation | null> {
  const cache = cachesFor(lake).run;
  const hit = cache.get("run");
  if (hit) return hit;
  const rows = await lake.query<RunInformation>(
    `SELECT * EXCLUDE (recipe, built_at), epoch_ms(built_at) AS built_at_milliseconds FROM ${ident(VIEWS.run)} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  cache.set("run", row);
  return row;
}

/** One pattern side's firings in one timeframe and year, in time order. */
interface Firings {
  tradeDirection: 1 | -1;
  patternCandleCount: number;
  timestamps: number[];
  contracts: string[];
  closes: number[];
  entries: number[];
  exits: number[][]; // [k - 1][row]
  gross: number[][]; // [k - 1][row]
}

async function firings(lake: StudyLake, q: Query): Promise<Firings> {
  const key = `${q.timeframe}|${q.pattern}|${q.side}|${q.year}`;
  const cache = cachesFor(lake).firings;
  const hit = cache.get(key);
  if (hit) return hit;
  const ks = Array.from({ length: HORIZON }, (_, index) => index + 1);
  const rows = await lake.query<Record<string, unknown>>(`
    SELECT trade_direction, pattern_candle_count, epoch_ms(bar_timestamp) AS bar_timestamp_milliseconds, contract_symbol,
           pattern_close_price, entry_price_next_candle_open,
           ${ks.map((k) => `exit_price_candle_${k}_close, gross_ticks_candle_${k}`).join(", ")}
    FROM ${ident(VIEWS.trades)}
    WHERE timeframe = ${text(q.timeframe)} AND pattern = ${text(q.pattern)} AND side = ${text(q.side)}
      AND calendar_year = ${num(q.year)}
    ORDER BY bar_timestamp`);
  const out: Firings = {
    tradeDirection: rows[0]?.trade_direction === "short" ? -1 : 1,
    patternCandleCount: Math.max(1, numberOf(rows[0]?.pattern_candle_count) || 1),
    timestamps: rows.map((row) => numberOf(row.bar_timestamp_milliseconds)),
    contracts: rows.map((row) => String(row.contract_symbol)),
    closes: rows.map((row) => numberOf(row.pattern_close_price)),
    entries: rows.map((row) => numberOf(row.entry_price_next_candle_open)),
    exits: ks.map((k) => rows.map((row) => numberOf(row[`exit_price_candle_${k}_close`]))),
    gross: ks.map((k) => rows.map((row) => numberOf(row[`gross_ticks_candle_${k}`]))),
  };
  cache.set(key, out);
  return out;
}

/** Every usable candle of one timeframe and year with its trade to the close of candle k (the notebook's `_year_candles`). */
interface Pool {
  timestamps: Float64Array;
  contracts: string[];
  closes: Float64Array;
  entries: Float64Array;
  exits: Float64Array;
  longGross: Float64Array;
}

async function pool(lake: StudyLake, q: Query, tickSize: number): Promise<Pool> {
  const key = `${q.timeframe}|${q.year}|${q.candle}`;
  const cache = cachesFor(lake).pools;
  const hit = cache.get(key);
  if (hit) return hit;
  const price = (column: string) =>
    `round((close + CAST(${ident(column)} AS DOUBLE) * average_range_10_bars) / ${num(tickSize)}) * ${num(tickSize)}`;
  const rows = await lake.query<Record<string, unknown>>(`
    SELECT * FROM (
      SELECT epoch_ms("timestamp") AS timestamp_milliseconds, contract_symbol, close,
             ${price("next_candle_1_open_from_close_in_average_ranges")} AS entry_price,
             ${price(`next_candle_${q.candle}_close_from_close_in_average_ranges`)} AS exit_price
      FROM ${ident(candleView(q.timeframe))}
      WHERE "year" BETWEEN ${num(q.year - 1)} AND ${num(q.year + 1)} AND year(trading_day) = ${num(q.year)}
        AND average_range_10_bars IS NOT NULL AND control_signed_body IS NOT NULL
    ) WHERE entry_price IS NOT NULL AND exit_price IS NOT NULL AND NOT isnan(exit_price)
    ORDER BY timestamp_milliseconds`);
  const count = rows.length;
  const out: Pool = {
    timestamps: new Float64Array(count),
    contracts: new Array<string>(count),
    closes: new Float64Array(count),
    entries: new Float64Array(count),
    exits: new Float64Array(count),
    longGross: new Float64Array(count),
  };
  rows.forEach((row, index) => {
    out.timestamps[index] = numberOf(row.timestamp_milliseconds);
    out.contracts[index] = String(row.contract_symbol);
    out.closes[index] = numberOf(row.close);
    out.entries[index] = numberOf(row.entry_price);
    out.exits[index] = numberOf(row.exit_price);
    out.longGross[index] = (numberOf(row.exit_price) - numberOf(row.entry_price)) / tickSize;
  });
  cache.set(key, out);
  return out;
}

interface Trades {
  timestamps: number[];
  contracts: string[];
  closes: number[];
  entries: number[];
  exits: number[];
  gross: number[];
}

/** The firings that have an exit at candle k (the notebook's `firings_at_k`). */
function firingsAtK(all: Firings, k: number): Trades {
  const out: Trades = { timestamps: [], contracts: [], closes: [], entries: [], exits: [], gross: [] };
  const gross = all.gross[k - 1] ?? [];
  const exits = all.exits[k - 1] ?? [];
  gross.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    out.timestamps.push(all.timestamps[index] as number);
    out.contracts.push(all.contracts[index] as string);
    out.closes.push(all.closes[index] as number);
    out.entries.push(all.entries[index] as number);
    out.exits.push(exits[index] as number);
    out.gross.push(value);
  });
  return out;
}

/** As many random usable bars of the same year as there are firings, traded the pattern's way (seed = draw). */
function randomTrades(source: Pool, size: number, direction: 1 | -1, seed: number): Trades {
  const picked = sampleWithoutReplacement(source.timestamps.length, size, seed);
  return {
    timestamps: picked.map((index) => source.timestamps[index] as number),
    contracts: picked.map((index) => source.contracts[index] as string),
    closes: picked.map((index) => source.closes[index] as number),
    entries: picked.map((index) => source.entries[index] as number),
    exits: picked.map((index) => source.exits[index] as number),
    gross: picked.map((index) => direction * (source.longGross[index] as number)),
  };
}

// ---------------------------------------------------------------- parts

async function overview(context: StudyContext): Promise<OverviewBody> {
  const empty: OverviewBody = { run: null, findings: [], rules: [], dashboardCostTicks: dashboardCostTicks() };
  if ((await missingViews(context, [VIEWS.run, VIEWS.findings, VIEWS.rules])).length > 0) return empty;
  const [run, findings, rules] = await Promise.all([
    runInformation(context.lake),
    context.lake.query<FindingRow>(`
      SELECT CAST(finding_date AS VARCHAR) AS finding_date, repository, area, finding, result, verdict, in_trader_terms,
             where_to_see_it, computed_source
      FROM ${ident(VIEWS.findings)} ORDER BY finding_date DESC, repository`),
    context.lake.query<LastMoveRule>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.rules)} ORDER BY timeframe, rule, period`),
  ]);
  return { run, findings, rules, dashboardCostTicks: empty.dashboardCostTicks };
}

async function sides(q: Query, context: StudyContext, run: RunInformation, cost: number): Promise<SidesBody> {
  const ks = Array.from({ length: HORIZON }, (_, index) => index + 1);
  const [rows, shares] = await Promise.all([
    context.lake.query<SideRow>(`
      SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.sides)}
      WHERE timeframe = ${text(q.timeframe)} AND calendar_year = ${num(q.year)}
      ORDER BY pattern, side, candle`),
    context.lake.query<Record<string, unknown>>(`
      SELECT pattern, side,
        ${ks.map((k) => `avg(CASE WHEN gross_ticks_candle_${k} IS NULL OR isnan(gross_ticks_candle_${k}) THEN NULL
                          WHEN gross_ticks_candle_${k} - ${num(cost)} > 0 THEN 1.0 ELSE 0.0 END) AS share_${k}`).join(",\n        ")}
      FROM ${ident(VIEWS.trades)}
      WHERE timeframe = ${text(q.timeframe)} AND calendar_year = ${num(q.year)}
      GROUP BY pattern, side`),
  ]);
  const shareOf = new Map<string, Record<string, unknown>>();
  for (const row of shares) shareOf.set(`${row.pattern}|${row.side}`, row);
  return {
    costTicks: cost,
    rows: rows.map((row) => {
      const share = shareOf.get(`${row.pattern}|${row.side}`)?.[`share_${row.candle}`];
      return repriceSide(row, run.round_trip_cost_ticks, cost, run.dollars_per_tick, share === null || share === undefined ? null : numberOf(share));
    }),
  };
}

async function candleWindow(lake: StudyLake, timeframe: string, timestamp: number, contract: string): Promise<WindowCandle[]> {
  const year = new Date(timestamp).getUTCFullYear();
  const columns = `epoch_ms("timestamp") AS timestamp_milliseconds, contract_symbol, CAST(trading_day AS VARCHAR) AS trading_day, open, high, low, close`;
  const scope = `"year" BETWEEN ${num(year - 1)} AND ${num(year + 1)}`;
  const at = `make_timestamptz(${num(Math.round(timestamp) * 1000)})`;
  const rows = await lake.query<Record<string, unknown>>(`
    SELECT * FROM (SELECT ${columns} FROM ${ident(candleView(timeframe))} WHERE ${scope} AND "timestamp" <= ${at}
                   ORDER BY "timestamp" DESC LIMIT ${num(WINDOW_BEFORE + 1)})
    UNION ALL
    SELECT * FROM (SELECT ${columns} FROM ${ident(candleView(timeframe))} WHERE ${scope} AND "timestamp" > ${at}
                   ORDER BY "timestamp" LIMIT ${num(WINDOW_AFTER)})`);
  const ordered = rows
    .map((row) => ({
      timestamp_milliseconds: numberOf(row.timestamp_milliseconds),
      trading_day: String(row.trading_day),
      open: numberOf(row.open),
      high: numberOf(row.high),
      low: numberOf(row.low),
      close: numberOf(row.close),
      contract_symbol: String(row.contract_symbol),
    }))
    .sort((a, b) => a.timestamp_milliseconds - b.timestamp_milliseconds);
  const signal = ordered.findIndex((row) => row.timestamp_milliseconds === timestamp);
  const anchor = signal >= 0 ? signal : ordered.filter((row) => row.timestamp_milliseconds <= timestamp).length - 1;
  // positions come from the whole frame in time order (the notebook's bar numbers), then other contracts drop out
  const candles: WindowCandle[] = [];
  ordered.forEach((row, index) => {
    if (row.contract_symbol !== contract) return;
    candles.push({
      bars_from_signal: index - anchor, timestamp_milliseconds: row.timestamp_milliseconds, trading_day: row.trading_day,
      open: row.open, high: row.high, low: row.low, close: row.close,
    });
  });
  return candles;
}

function median(values: number[]): number | null {
  return eightNumbers(values).median;
}

async function caseTrade(q: Query, context: StudyContext, run: RunInformation, cost: number): Promise<CaseBody> {
  const dollarsPerTick = run.dollars_per_tick;
  const all = await firings(context.lake, q);
  const atK = firingsAtK(all, q.candle);
  const base: CaseBody = {
    population: q.population, tradeDirection: all.tradeDirection, patternCandleCount: all.patternCandleCount, tradeCount: 0,
    step: 1, trade: null, window: [], aligned: true, shareNetPositive: null, totalNetDollars: null, medianNetDollars: null,
    costTicks: cost, dollarsPerTick, tickSize: run.tick_size_points,
  };
  if (atK.gross.length === 0) {
    context.notes.push(`No ${q.timeframe} ${q.pattern} (${q.side}) trade in ${q.year} exits at the close of candle ${q.candle}.`);
    return base;
  }
  let trades = atK;
  if (q.population === "random") {
    if ((await missingViews(context, [candleView(q.timeframe)])).length > 0) return base;
    trades = randomTrades(await pool(context.lake, q, run.tick_size_points), atK.gross.length, all.tradeDirection, q.draw);
  }
  const net = trades.gross.map((gross) => netDollars(gross, cost, dollarsPerTick));
  const ranks = rankBestFirst(net);
  const order = trades.timestamps.map((_, index) => index);
  if (q.order === "best") order.sort((a, b) => (net[b] as number) - (net[a] as number) || (trades.timestamps[a] as number) - (trades.timestamps[b] as number));
  else if (q.order === "worst") order.sort((a, b) => (net[a] as number) - (net[b] as number) || (trades.timestamps[a] as number) - (trades.timestamps[b] as number));
  const step = Math.min(q.step, order.length);
  const index = order[step - 1] as number;
  const trade: CaseTrade = {
    bar_timestamp_milliseconds: trades.timestamps[index] as number,
    contract_symbol: trades.contracts[index] as string,
    pattern_close_price: trades.closes[index] as number,
    entry_price: trades.entries[index] as number,
    exit_price: trades.exits[index] as number,
    gross_ticks: trades.gross[index] as number,
    net_ticks: (trades.gross[index] as number) - cost,
    net_dollars: net[index] as number,
    rank_best_first: ranks[index] as number,
  };
  let window: WindowCandle[] = [];
  let aligned = true;
  if ((await missingViews(context, [candleView(q.timeframe)])).length === 0) {
    window = await candleWindow(context.lake, q.timeframe, trade.bar_timestamp_milliseconds, trade.contract_symbol);
    const signal = window.find((candle) => candle.bars_from_signal === 0);
    aligned = signal !== undefined && signal.timestamp_milliseconds === trade.bar_timestamp_milliseconds && signal.close === trade.pattern_close_price;
    if (!aligned) context.notes.push("The lake's candles have moved since the casebook was built: the candle at this trade's time is not the one it was built from. Rebuild the casebook.");
  }
  const positive = net.filter((value) => value > 0).length;
  return {
    ...base,
    tradeCount: order.length,
    step,
    trade,
    window,
    aligned,
    shareNetPositive: positive / net.length,
    totalNetDollars: net.reduce((sum, value) => sum + value, 0),
    medianNetDollars: median(net),
  };
}

async function distribution(q: Query, context: StudyContext, run: RunInformation, cost: number): Promise<DistributionBody> {
  const dollarsPerTick = run.dollars_per_tick;
  const back = q.view === "gross" ? cost * dollarsPerTick : 0;
  const empty: DistributionBody = {
    available: false, message: null, view: q.view, costTicks: cost, histogram: [], patternLine: [], randomLines: [], band: null,
    pattern: null, everyBar: null, stats: null,
  };
  const [all, stored] = await Promise.all([
    firings(context.lake, q),
    context.lake.query<SideRow>(`
      SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.sides)}
      WHERE timeframe = ${text(q.timeframe)} AND pattern = ${text(q.pattern)} AND side = ${text(q.side)}
        AND calendar_year = ${num(q.year)} AND candle = ${num(q.candle)}`),
  ]);
  const atK = firingsAtK(all, q.candle);
  const row = stored[0];
  if (atK.gross.length < 2 || !row) {
    return { ...empty, message: `Fewer than ${run.minimum_trades} trades exit at candle ${q.candle} in ${q.year}.` };
  }
  if ((await missingViews(context, [candleView(q.timeframe)])).length > 0) return { ...empty, message: "The next-candles dataset for this timeframe is not in the lake." };
  const everyPool = await pool(context.lake, q, run.tick_size_points);
  const direction = all.tradeDirection;
  const firing = atK.gross.map((gross) => netDollars(gross, cost, dollarsPerTick) + back);
  const every = Array.from(everyPool.longGross, (gross) => netDollars(direction * gross, cost, dollarsPerTick) + back);
  const randomLines = Array.from({ length: q.lines }, (_, draw) => {
    const trades = randomTrades(everyPool, atK.gross.length, direction, 1000 + draw);
    return { draw: draw + 1, points: runningDollars(trades.timestamps, trades.gross.map((gross) => netDollars(gross, cost, dollarsPerTick) + back)) };
  });
  const patternLine = runningDollars(atK.timestamps, firing);
  const priced = repriceSide(row, run.round_trip_cost_ticks, cost, dollarsPerTick, null);
  const shift = back; // before costs every trade gets its round trip back
  const whole = shift * priced.trade_count;
  const last = patternLine[patternLine.length - 1];
  return {
    available: true,
    message: null,
    view: q.view,
    costTicks: cost,
    histogram: histogramShares(firing, every, q.span),
    patternLine,
    randomLines,
    band: last ? { bar_timestamp_milliseconds: last.bar_timestamp_milliseconds, low: priced.random_bars_total_net_dollars_percentile_5 + whole, high: priced.random_bars_total_net_dollars_percentile_95 + whole } : null,
    pattern: casebookEightNumbers(firing),
    everyBar: casebookEightNumbers(every),
    stats: {
      tradeCount: priced.trade_count,
      tradingDaysWithATrade: priced.trading_days_with_a_trade,
      shareMadeMoney: firing.filter((value) => value > 0).length / firing.length,
      meanPerTrade: priced.net_dollars_per_trade_mean + shift,
      medianPerTrade: priced.net_dollars_per_trade_median + shift,
      everyBarPerTrade: priced.every_bar_same_direction_net_dollars_per_trade + shift,
      wholeYear: priced.total_net_dollars + whole,
      perSession: (priced.total_net_dollars + whole) / priced.sessions_in_year,
      roundTripsCost: priced.trade_count * cost * dollarsPerTick,
      randomLow: priced.random_bars_total_net_dollars_percentile_5 + whole,
      randomHigh: priced.random_bars_total_net_dollars_percentile_95 + whole,
      shareOfRandomTotalsAtOrAbovePattern: priced.share_of_random_totals_at_or_above_pattern,
      randomBandMethod: priced.random_band_method,
    },
  };
}

const TEXT_COLUMNS = ["timeframe", "pattern", "side", "claimed_direction", "trade_direction", "sample_split", "contract_symbol"];

async function columns(q: Query, context: StudyContext, run: RunInformation, cost: number): Promise<ColumnsBody> {
  const ks = Array.from({ length: HORIZON }, (_, index) => index + 1);
  const rows = await context.lake.query<Record<string, unknown>>(`
    SELECT * EXCLUDE (recipe, bar_timestamp, trading_day),
           epoch_ms(bar_timestamp) AS bar_timestamp_milliseconds, CAST(trading_day AS VARCHAR) AS trading_day,
           ${ks.map((k) => `(gross_ticks_candle_${k} - ${num(cost)}) * ${num(run.dollars_per_tick)} AS net_dollars_candle_${k}`).join(", ")}
    FROM ${ident(VIEWS.trades)}
    WHERE timeframe = ${text(q.timeframe)} AND pattern = ${text(q.pattern)} AND side = ${text(q.side)}
      AND calendar_year = ${num(q.year)}
    ORDER BY bar_timestamp`);
  const body: ColumnsBody = { rowCount: rows.length, constants: [], numeric: [], months: [], tradesPerTradingDay: [], categorical: [], costTicks: cost };
  const first = rows[0];
  if (!first) return body;
  const names = Object.keys(first);
  for (const name of names) {
    const distinct = new Set(rows.map((row) => String(row[name])));
    if (distinct.size === 1) body.constants.push({ column: name, value: String(first[name]) });
  }
  const constant = new Set(body.constants.map((entry) => entry.column));
  for (const name of names) {
    if (constant.has(name) || TEXT_COLUMNS.includes(name) || name === "trading_day" || name === "bar_timestamp_milliseconds") continue;
    const values = rows.map((row) => numberOf(row[name])).filter((value) => Number.isFinite(value));
    if (values.length === 0) continue;
    body.numeric.push({ column: name, bins: numpyHistogram(values, q.bins), summary: eightNumbers(values) });
  }
  const months = new Map<string, number>();
  const days = new Map<string, number>();
  for (const row of rows) {
    const month = new Date(numberOf(row.bar_timestamp_milliseconds)).toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
    const day = String(row.trading_day);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  body.months = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, trades]) => ({ month, trades }));
  body.tradesPerTradingDay = numpyHistogram([...days.values()], Math.min(q.bins, Math.max(1, new Set(days.values()).size))).map((bin) => ({ lower: bin.lower, upper: bin.upper, tradingDays: bin.count }));
  for (const name of TEXT_COLUMNS) {
    if (constant.has(name) || !(name in first)) continue;
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(String(row[name]), (counts.get(String(row[name])) ?? 0) + 1);
    body.categorical.push({ column: name, counts: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, trades]) => ({ value, trades })) });
  }
  return body;
}

// ---------------------------------------------------------------- handler

const handler: StudyHandler<typeof query, unknown> = {
  slug: "pattern-casebook",
  datasets: [...CASEBOOK_VIEWS, ...TIMEFRAMES.map(candleView)],
  query,
  cacheSeconds: 600,
  timeoutMs: 120_000,
  async run(q, context) {
    if (q.part === "overview") return overview(context);
    const needed = q.part === "sides" ? [VIEWS.run, VIEWS.sides, VIEWS.trades] : q.part === "distribution" ? [VIEWS.run, VIEWS.sides, VIEWS.trades] : [VIEWS.run, VIEWS.trades];
    if ((await missingViews(context, needed)).length > 0) return null;
    const run = await runInformation(context.lake);
    if (!run) {
      context.notes.push("The casebook's run information is empty.");
      return null;
    }
    const cost = q.cost ?? run.round_trip_cost_ticks;
    switch (q.part) {
      case "sides":
        return sides(q, context, run, cost);
      case "case":
        return caseTrade(q, context, run, cost);
      case "distribution":
        return distribution(q, context, run, cost);
      case "columns":
        return columns(q, context, run, cost);
      default:
        return null;
    }
  },
};

export default handler;
