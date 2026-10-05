/**
 * Crossover strategy: the always-in EMA(5) over SMA(100) rule on MNQ 5-minute
 * bars, after cost, with the price window, MACD and RSI the notebook drew and
 * the authoritative sweep and reality check it only quoted. Replaced
 * Trading/quant/analytics/notebooks/crossover_visualization.py.
 *
 * Live part: the bars are read from the dashboard's DuckDB views
 * (ohlcv_<timeframe>, the bare-root symbol exactly as the notebook read it, or
 * the ratio back-adjusted front month) and the strategy, equity, drawdown,
 * trades, MACD and RSI are computed here with packages/shared/src/studies/crossover-strategy.ts,
 * so every control on the page moves the numbers. Landed part: the sweep,
 * walk-forward, block bootstrap and Deflated Sharpe Ratio come from
 * packages/ml-engine/src/studies/crossover_strategy/build.py (derived_study_crossover_strategy_*),
 * which runs the analytics package's own modules once.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { histogram } from "@shared/analytics/compute";
import {
  LANDED_VIEWS,
  MAXIMUM_TERMS,
  NOTEBOOK_SETTINGS,
  columnSummaries,
  drawdownEpisodes,
  drawdownOf,
  macdCrossings,
  macdSeries,
  monthlyReturns,
  nullableRange,
  positionChangeCount,
  positionFlips,
  ratioBackAdjust,
  relativeStrengthIndex,
  runCrossover,
  seriesSplit,
  statisticsOf,
  thinSeries,
  tradeSpells,
  tradeStatistics,
  type CandleWindow,
  type CostPreset,
  type CrossoverBody,
  type CrossoverParameters,
  type FrameColumns,
  type LandedRecord,
  type LandedRun,
  type PriceBars,
} from "@shared/studies/crossover-strategy";
import { ident, text } from "../sql";
import type { StudyContext, StudyHandler } from "../types";
import { missingViews } from "../views";

const SYMBOLS = ["MNQ", "MES", "NQ", "ES"] as const;
const TIMEFRAME_VIEWS = new Map<string, string>([
  ["1m", "ohlcv_1m"],
  ["5m", "ohlcv_5m"],
  ["15m", "ohlcv_15m"],
  ["30m", "ohlcv_30m"],
]);
const MAXIMUM_BARS = 1_200_000;
const MAXIMUM_CANDLES = 4_000;
const CHART_POINTS = 2_400;
const CACHE_MILLISECONDS = 10 * 60_000;

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "not a calendar date");

const query = z
  .object({
    symbol: z.enum(SYMBOLS).default(NOTEBOOK_SETTINGS.symbol),
    timeframe: z.enum(["1m", "5m", "15m", "30m"]).default("5m"),
    series: z.enum(["naive", "ratio"]).default("naive"),
    windowStart: calendarDate.default(NOTEBOOK_SETTINGS.windowStart),
    windowEnd: calendarDate.default(NOTEBOOK_SETTINGS.windowEnd),
    fastKind: z.enum(["ema", "sma"]).default(NOTEBOOK_SETTINGS.fastKind),
    slowKind: z.enum(["ema", "sma"]).default(NOTEBOOK_SETTINGS.slowKind),
    fastPeriod: z.coerce.number().int().min(2).max(400).default(NOTEBOOK_SETTINGS.fastPeriod),
    slowPeriod: z.coerce.number().int().min(3).max(1000).default(NOTEBOOK_SETTINGS.slowPeriod),
    mode: z.enum(["long_short", "long_only"]).default("long_short"),
    costSource: z.enum(["notebook", "dashboard", "custom", "none"]).default("notebook"),
    customCost: z.coerce.number().min(0).max(10).default(0.7),
    candleStart: calendarDate.default(NOTEBOOK_SETTINGS.candleStart),
    candleEnd: calendarDate.default(NOTEBOOK_SETTINGS.candleEnd),
    macdFast: z.coerce.number().int().min(2).max(100).default(NOTEBOOK_SETTINGS.macdFast),
    macdSlow: z.coerce.number().int().min(3).max(200).default(NOTEBOOK_SETTINGS.macdSlow),
    macdSignal: z.coerce.number().int().min(2).max(100).default(NOTEBOOK_SETTINGS.macdSignal),
    rsiPeriod: z.coerce.number().int().min(2).max(100).default(NOTEBOOK_SETTINGS.rsiPeriod),
    trainFraction: z.coerce.number().min(0.5).max(0.9).default(NOTEBOOK_SETTINGS.trainFraction),
    bins: z.coerce.number().int().min(10).max(80).default(30),
  })
  .refine((value) => value.windowStart <= value.windowEnd, { message: "windowStart is after windowEnd", path: ["windowStart"] })
  .refine((value) => value.candleStart <= value.candleEnd, { message: "candleStart is after candleEnd", path: ["candleStart"] });

type Query = z.infer<typeof query>;

// ------------------------------------------------------------------ costs

interface CostEntry {
  total_round_trip?: number;
  point_value?: number;
}

function readCostFile(relative: string): Record<string, CostEntry> | null {
  try {
    return JSON.parse(readFileSync(path.resolve(process.cwd(), relative), "utf8")) as Record<string, CostEntry>;
  } catch {
    return null;
  }
}

const COST_FILES = {
  notebook: { file: "Trading/quant/model/src/config/cost_model.json", label: "the notebook's cost model" },
  dashboard: { file: "packages/config/cost_model.json", label: "the dashboard's cost_model.json" },
} as const;

/** total_round_trip (USD) / point_value (USD per point) / 2: points charged on each side of a trade. */
export function costPresets(symbol: string): CostPreset[] {
  const presets: CostPreset[] = [];
  for (const source of ["notebook", "dashboard"] as const) {
    const entry = readCostFile(COST_FILES[source].file)?.[symbol];
    if (!entry || !entry.total_round_trip || !entry.point_value) continue;
    presets.push({
      source,
      label: COST_FILES[source].label,
      costPointsPerSide: entry.total_round_trip / entry.point_value / 2,
      roundTripUsd: entry.total_round_trip,
      pointValueUsd: entry.point_value,
      file: COST_FILES[source].file,
    });
  }
  return presets;
}

function resolveCost(parameters: Query, presets: readonly CostPreset[], notes: string[]): number {
  if (parameters.costSource === "none") return 0;
  if (parameters.costSource === "custom") return parameters.customCost;
  const preferred = presets.find((preset) => preset.source === parameters.costSource);
  if (preferred) return preferred.costPointsPerSide;
  const fallback = presets[0];
  if (fallback) {
    notes.push(`${parameters.symbol} has no entry in ${COST_FILES[parameters.costSource].file}; the cost used is ${fallback.label}.`);
    return fallback.costPointsPerSide;
  }
  notes.push(`No cost model lists ${parameters.symbol}; the run is charged no cost. Pick a custom cost.`);
  return 0;
}

// -------------------------------------------------------------------- bars

interface LoadedBars {
  bars: PriceBars;
  symbols: string[];
}

const barCache = new Map<string, { at: number; value: LoadedBars }>();

function windowPredicate(parameters: Query): string {
  return (
    `timestamp >= TIMESTAMPTZ ${text(`${parameters.windowStart} 00:00:00+00`)} ` +
    `AND timestamp <= TIMESTAMPTZ ${text(`${parameters.windowEnd} 00:00:00+00`)} ` +
    "AND open IS NOT NULL AND high IS NOT NULL AND low IS NOT NULL AND close IS NOT NULL AND close > 0"
  );
}

function barsSql(parameters: Query, view: string): string {
  const columns = "open, high, low, close, volume";
  if (parameters.series === "naive") {
    return (
      `SELECT CAST(epoch(timestamp) AS BIGINT) AS t, symbol, ${columns} FROM ${ident(view)} ` +
      `WHERE symbol = ${text(parameters.symbol)} AND ${windowPredicate(parameters)} ORDER BY timestamp LIMIT ${MAXIMUM_BARS + 1}`
    );
  }
  // The highest-volume outright contract at each timestamp (spreads and the bare-root splice excluded).
  return (
    `SELECT t, symbol, ${columns} FROM (` +
    `SELECT CAST(epoch(timestamp) AS BIGINT) AS t, symbol, ${columns}, ` +
    "row_number() OVER (PARTITION BY timestamp ORDER BY volume DESC, symbol DESC) AS volume_rank " +
    `FROM ${ident(view)} WHERE root = ${text(parameters.symbol)} AND symbol NOT LIKE '%-%' AND symbol <> ${text(parameters.symbol)} ` +
    `AND ${windowPredicate(parameters)}) WHERE volume_rank = 1 ORDER BY t LIMIT ${MAXIMUM_BARS + 1}`
  );
}

interface BarRow {
  t: number;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

async function loadBars(parameters: Query, context: StudyContext): Promise<LoadedBars | null> {
  const view = TIMEFRAME_VIEWS.get(parameters.timeframe);
  if (!view) return null;
  const key = [parameters.symbol, parameters.timeframe, parameters.series, parameters.windowStart, parameters.windowEnd].join("|");
  const cached = barCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MILLISECONDS) return cached.value;

  if ((await missingViews(context, [view])).length > 0) return null;
  const rows = await context.lake.query<BarRow>(barsSql(parameters, view), 120_000);
  if (rows.length > MAXIMUM_BARS) {
    context.notes.push(`The window holds more than ${MAXIMUM_BARS.toLocaleString("en-US")} bars; narrow the window or use a coarser timeframe.`);
    return null;
  }
  const loaded: LoadedBars = {
    symbols: rows.map((row) => String(row.symbol)),
    bars: {
      timestampSeconds: rows.map((row) => Number(row.t)),
      open: rows.map((row) => Number(row.open)),
      high: rows.map((row) => Number(row.high)),
      low: rows.map((row) => Number(row.low)),
      close: rows.map((row) => Number(row.close)),
      volume: rows.map((row) => Number(row.volume ?? 0)),
    },
  };
  if (parameters.series === "ratio") loaded.bars = ratioBackAdjust(loaded.symbols, loaded.bars);
  if (barCache.size >= 3) barCache.delete(barCache.keys().next().value as string);
  barCache.set(key, { at: Date.now(), value: loaded });
  return loaded;
}

// ------------------------------------------------------------------ landed

const EMPTY_LANDED: LandedRecord = { run: null, sweep: [], realityCheck: [], folds: [], referenceRules: [] };

async function readLanded(context: StudyContext): Promise<LandedRecord> {
  const views = Object.values(LANDED_VIEWS);
  if ((await missingViews(context, views)).length > 0) return EMPTY_LANDED;
  const read = <T>(view: string, order: string) => context.lake.query<T>(`SELECT * EXCLUDE (recipe) FROM ${ident(view)} ORDER BY ${order}`);
  const [run, sweep, realityCheck, folds, referenceRules] = await Promise.all([
    read<LandedRun>(LANDED_VIEWS.run, "symbol"),
    read<LandedRecord["sweep"][number]>(LANDED_VIEWS.sweep, "in_sample_rank"),
    read<LandedRecord["realityCheck"][number]>(LANDED_VIEWS.realityCheck, "candidate DESC"),
    read<LandedRecord["folds"][number]>(LANDED_VIEWS.folds, "candidate DESC, fold"),
    read<LandedRecord["referenceRules"][number]>(LANDED_VIEWS.referenceRules, "rule"),
  ]);
  return { run: run[0] ?? null, sweep, realityCheck, folds, referenceRules };
}

// -------------------------------------------------------------------- body

function emptyBody(parameters: CrossoverParameters, presets: CostPreset[], landed: LandedRecord): CrossoverBody {
  return { available: false, parameters, costPresets: presets, summary: null, series: null, candles: null, months: [], episodes: [], trades: null, columns: [], landed };
}

function dayStartSeconds(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}

/** The notebook's whole computation on loaded bars. Exported for the tests. */
export function buildCrossoverBody(bars: PriceBars, parameters: CrossoverParameters, presets: CostPreset[], landed: LandedRecord, notes: string[]): CrossoverBody {
  if (bars.close.length < 3) {
    notes.push(`Fewer than three ${parameters.timeframe} bars of ${parameters.symbol} between ${parameters.windowStart} and ${parameters.windowEnd}.`);
    return emptyBody(parameters, presets, landed);
  }
  const run = runCrossover(bars, {
    fastKind: parameters.fastKind,
    slowKind: parameters.slowKind,
    fastPeriod: parameters.fastPeriod,
    slowPeriod: parameters.slowPeriod,
    mode: parameters.mode,
    costPointsPerSide: parameters.costPointsPerSide,
  });
  const split = seriesSplit(bars, run, parameters.trainFraction);
  const strategy = statisticsOf(run.netReturn, run.equity, run.drawdown, run.timestampSeconds, split);
  const buyAndHoldDrawdown = drawdownOf(run.buyAndHoldEquity);
  const buyAndHold = statisticsOf(run.barReturn, run.buyAndHoldEquity, buyAndHoldDrawdown, run.timestampSeconds, split);

  const rows = run.netReturn.length;
  let longRows = 0;
  let shortRows = 0;
  let totalCost = 0;
  for (let k = 0; k < rows; k += 1) {
    const held = run.heldPosition[k] as number;
    if (held > 0) longRows += 1;
    else if (held < 0) shortRows += 1;
    totalCost += run.costFraction[k] as number;
  }

  const allEpisodes = drawdownEpisodes(run, Number.MAX_SAFE_INTEGER);
  const { spells, flatFactor } = tradeSpells(run);
  const tradeSummary = tradeStatistics(spells);
  const factorProduct = spells.reduce((product, spell) => product * spell.factor, flatFactor);
  const firstSeconds = bars.timestampSeconds[0] as number;
  const lastSeconds = bars.timestampSeconds[bars.timestampSeconds.length - 1] as number;

  // MACD and RSI on the frame, as the notebook computed them after its dropna.
  const macd = macdSeries(run.close, parameters.macdFast, parameters.macdSlow, parameters.macdSignal);
  const rsi = relativeStrengthIndex(run.close, parameters.rsiPeriod);

  let candles: CandleWindow | null = null;
  const windowFrom = dayStartSeconds(parameters.candleStart);
  const windowTo = dayStartSeconds(parameters.candleEnd) + 86400;
  let from = -1;
  let to = -1;
  for (let k = 0; k < rows; k += 1) {
    const at = run.timestampSeconds[k] as number;
    if (at < windowFrom) continue;
    if (at >= windowTo) break;
    if (from < 0) from = k;
    to = k;
  }
  if (from >= 0) {
    const requested = to - from + 1;
    const clipped = requested > MAXIMUM_CANDLES;
    if (clipped) to = from + MAXIMUM_CANDLES - 1;
    const macdCross = macdCrossings(macd.macd, macd.signalLine, from, to);
    const flips = positionFlips(run.position, from, to);
    // Bars 1..n of the loaded bars are the frame's rows 0..n-1.
    candles = {
      timestampSeconds: run.timestampSeconds.slice(from, to + 1),
      open: bars.open.slice(from + 1, to + 2),
      high: bars.high.slice(from + 1, to + 2),
      low: bars.low.slice(from + 1, to + 2),
      close: bars.close.slice(from + 1, to + 2),
      fast: nullableRange(run.fast, from, to, 4),
      slow: nullableRange(run.slow, from, to, 4),
      macd: nullableRange(macd.macd, from, to, 4),
      macdSignal: nullableRange(macd.signalLine, from, to, 4),
      macdHistogram: nullableRange(macd.histogram, from, to, 4),
      relativeStrengthIndex: nullableRange(rsi, from, to, 3),
      macdLongIndices: macdCross.longs,
      macdShortIndices: macdCross.shorts,
      flipLongIndices: flips.longs,
      flipShortIndices: flips.shorts,
      clipped,
      requestedBarCount: requested,
    };
  } else {
    notes.push(`No bars between ${parameters.candleStart} and ${parameters.candleEnd} inside the loaded window.`);
  }

  const macdPosition = new Float64Array(rows);
  for (let k = 0; k < rows; k += 1) macdPosition[k] = Math.sign((macd.macd[k] as number) - (macd.signalLine[k] as number));
  const frame: FrameColumns = {
    open: { description: "bar open price, points", values: bars.open.slice(1) },
    high: { description: "bar high price, points", values: bars.high.slice(1) },
    low: { description: "bar low price, points", values: bars.low.slice(1) },
    close: { description: "bar close price, points", values: run.close },
    volume: { description: "contracts traded in the bar", values: bars.volume.slice(1) },
    fast_moving_average: { description: `the fast line, ${parameters.fastKind.toUpperCase()}(${parameters.fastPeriod}) of the close, points`, values: run.fast },
    slow_moving_average: { description: `the slow line, ${parameters.slowKind.toUpperCase()}(${parameters.slowPeriod}) of the close, points (unknown until ${parameters.slowPeriod} closes exist)`, values: run.slow },
    position: { description: "position decided at this bar's close: +1 long, -1 short, 0 while a line is unknown", values: run.position },
    bar_return: { description: "close over the previous close minus one, fraction", values: run.barReturn },
    turnover: { description: "absolute change of position at this close (2 is a full flip)", values: run.turnover },
    cost_fraction: { description: "trading cost charged at this close, fraction of price", values: run.costFraction },
    net_return: { description: "position held into this bar times the bar return, minus cost, fraction", values: run.netReturn },
    equity: { description: "compounded net return, starting at 1.0", values: run.equity },
    drawdown: { description: "equity over its running maximum minus one, fraction", values: run.drawdown },
    macd_line: { description: `MACD line, EMA(${parameters.macdFast}) minus EMA(${parameters.macdSlow}) of the close, points`, values: macd.macd },
    macd_signal_line: { description: `EMA(${parameters.macdSignal}) of the MACD line, points`, values: macd.signalLine },
    macd_histogram: { description: "MACD line minus its signal line, points", values: macd.histogram },
    relative_strength_index: { description: `Wilder RSI(${parameters.rsiPeriod}) of the close, 0 to 100 (unknown for the first ${parameters.rsiPeriod} rows)`, values: rsi },
    macd_position: { description: "sign of MACD line minus signal line: +1 above, -1 below", values: macdPosition },
  };

  return {
    available: true,
    parameters,
    costPresets: presets,
    summary: {
      loadedBarCount: bars.close.length,
      frameRowCount: rows,
      firstTimestampSeconds: firstSeconds,
      lastTimestampSeconds: lastSeconds,
      spanDays: (lastSeconds - firstSeconds) / 86400,
      annualisationBarsPerYear: split.annualisation,
      splitTimestampSeconds: split.splitTimestampSeconds,
      strategy,
      buyAndHold,
      grossFinalEquity: run.grossEquity[rows - 1] as number,
      totalCostFraction: totalCost,
      positionChangeCount: positionChangeCount(run),
      longShare: longRows / rows,
      shortShare: shortRows / rows,
      flatShare: (rows - longRows - shortRows) / rows,
      episodesDeeperThan: [-0.1, -0.05, -0.025].map((threshold) => ({ threshold, count: allEpisodes.filter((episode) => episode.depth <= threshold).length })),
    },
    series: thinSeries(run, CHART_POINTS),
    candles,
    months: monthlyReturns(run),
    episodes: allEpisodes.slice(0, 8),
    trades: {
      ...tradeSummary,
      returnHistogram: histogram(spells.map((spell) => spell.factor - 1), parameters.bins),
      factorProductError: Math.abs(factorProduct - strategy.finalEquity),
      flatFactor,
      terms: spells.slice(0, MAXIMUM_TERMS).map((spell) => ({
        startSeconds: run.timestampSeconds[spell.startRow] as number,
        side: spell.side,
        bars: spell.bars,
        factor: Math.round(spell.factor * 1e7) / 1e7,
      })),
      termsClipped: spells.length > MAXIMUM_TERMS,
    },
    columns: columnSummaries(frame, parameters.bins),
    landed,
  };
}

const handler: StudyHandler<typeof query, CrossoverBody> = {
  slug: "crossover-strategy",
  datasets: [...TIMEFRAME_VIEWS.values(), ...Object.values(LANDED_VIEWS)],
  query,
  cacheSeconds: 300,
  timeoutMs: 180_000,
  async run(parameters, context) {
    const presets = costPresets(parameters.symbol);
    const costPointsPerSide = resolveCost(parameters, presets, context.notes);
    const echo: CrossoverParameters = {
      ...parameters,
      costSource: parameters.costSource,
      costPointsPerSide,
    };
    const landed = await readLanded(context);
    const loaded = await loadBars(parameters, context);
    if (!loaded) return emptyBody(echo, presets, landed);
    return buildCrossoverBody(loaded.bars, echo, presets, landed, context.notes);
  },
};

export default handler;
