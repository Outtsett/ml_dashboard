/**
 * The crossover-strategy study: the pure compute against the numbers the
 * analytics package itself (crossovers.crossover, pandas) printed for the same
 * 80 closes, the causality guard with its failing negative, and the handler on
 * a fake lake (naive and ratio SQL, the landed record, a missing view, the
 * query schema).
 *
 * Expected values below come from running, on these closes,
 *   crossovers.crossover.backtest / ann_factor / _sharpe / _max_drawdown
 * and the notebook's own pandas lines for MACD(3,6,4) and RSI(5) on the frame.
 */

import { describe, expect, it } from "vitest";
import handler, { buildCrossoverBody, costPresets } from "../../studies/handlers/crossover-strategy";
import {
  exponentialMovingAverage,
  macdCrossings,
  macdSeries,
  monthlyReturns,
  positionFlips,
  ratioBackAdjust,
  relativeStrengthIndex,
  runCrossover,
  seriesSplit,
  simpleMovingAverage,
  splitSharpe,
  statisticsOf,
  thinSeries,
  tradeSpells,
  tradeStatistics,
  drawdownEpisodes,
  positionChangeCount,
  type CrossoverSettings,
  type PriceBars,
} from "@shared/studies/crossover-strategy";
import type { StudyLake } from "../../studies/types";

const CLOSES = [18000.21, 18008.36, 18015.71, 18012.65, 18010.86, 18007.7, 18011.12, 18010.78, 18015.26, 18004.18, 18013.58, 18013.0, 18017.08, 18016.26, 18013.99, 18016.76, 18021.71, 18020.5, 18019.58, 18023.69, 18018.47, 18009.39, 18011.76, 18007.73, 17996.21, 17991.33, 17988.52, 17981.36, 17972.41, 17972.63, 17978.01, 17976.61, 17972.15, 17974.46, 17978.76, 17976.96, 17980.23, 17986.49, 17985.25, 17980.37, 17982.45, 17983.94, 17990.53, 17982.82, 17978.85, 17973.82, 17963.42, 17964.18, 17967.34, 17962.91, 17971.23, 17976.16, 17979.92, 17982.33, 17988.07, 17980.07, 17983.76, 17987.37, 17976.77, 17978.85, 17977.35, 17982.04, 17979.4, 17979.29, 17981.35, 17976.09, 17979.68, 17979.05, 17982.01, 17978.88, 17985.4, 17989.03, 17987.96, 17991.75, 17999.31, 18010.06, 18000.61, 18005.91, 18008.7, 18008.14];
const START_SECONDS = 1717372800;

function barsOf(closes: number[], start = START_SECONDS, step = 300): PriceBars {
  return {
    timestampSeconds: closes.map((_, i) => start + i * step),
    open: [...closes],
    high: [...closes],
    low: [...closes],
    close: [...closes],
    volume: closes.map(() => 1),
  };
}

const SETTINGS: CrossoverSettings = { fastKind: "ema", slowKind: "sma", fastPeriod: 3, slowPeriod: 8, mode: "long_short", costPointsPerSide: 0.7 };

describe("averages and indicators against pandas", () => {
  it("EMA is seeded on the first value, SMA is unknown until the window fills", () => {
    const ema = exponentialMovingAverage([10, 12, 14], 3);
    expect(Array.from(ema)).toEqual([10, 11, 12.5]);
    const sma = simpleMovingAverage([1, 2, 3, 4], 3);
    expect(Number.isNaN(sma[0])).toBe(true);
    expect(Number.isNaN(sma[1])).toBe(true);
    expect(Array.from(sma.slice(2))).toEqual([2, 3]);
  });

  it("MACD(3,6,4) and RSI(5) on the frame equal the notebook's pandas lines", () => {
    const frame = CLOSES.slice(1);
    const macd = macdSeries(frame, 3, 6, 4);
    const last = frame.length - 1;
    expect(macd.macd[last]).toBeCloseTo(3.1770748037051817, 9);
    expect(macd.signalLine[last]).toBeCloseTo(3.6460910326222686, 9);
    expect(macd.histogram[last]).toBeCloseTo(-0.46901622891708694, 9);
    const rsi = relativeStrengthIndex(frame, 5);
    expect(Number.isNaN(rsi[4])).toBe(true);
    expect(rsi[5]).toBeCloseTo(77.90117875673694, 9);
    expect(rsi[6]).toBeCloseTo(76.52957231134539, 9);
    expect(rsi[30]).toBeCloseTo(25.824606787998178, 9);
    expect(rsi[last]).toBeCloseTo(70.8463464048573, 9);
    expect(macdCrossings(macd.macd, macd.signalLine, 0, last).longs.length + macdCrossings(macd.macd, macd.signalLine, 0, last).shorts.length).toBe(26);
  });
});

describe("the crossover strategy against crossovers.crossover", () => {
  const bars = barsOf(CLOSES);
  const run = runCrossover(bars, SETTINGS);
  const split = seriesSplit(bars, run, 0.7);

  it("reproduces the per-bar net return, final equity and maximum drawdown", () => {
    expect(run.netReturn.length).toBe(CLOSES.length - 1);
    const head = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -3.88656e-5, 0.0002487399, -0.0006927939, -0.0005998201, -3.21979e-5, 0.0002265031];
    head.forEach((value, i) => expect(run.netReturn[i]).toBeCloseTo(value, 9));
    const tail = [0.0005972451, -0.0005247067, 0.0002944345, 0.0001549491, -3.10961e-5];
    tail.forEach((value, i) => expect(run.netReturn[run.netReturn.length - tail.length + i]).toBeCloseTo(value, 9));
    const statistics = statisticsOf(run.netReturn, run.equity, run.drawdown, run.timestampSeconds, split);
    expect(statistics.finalEquity).toBeCloseTo(1.0005253570398391, 12);
    expect(statistics.maximumDrawdown).toBeCloseTo(-0.002141750676018628, 12);
  });

  it("reproduces the annualisation and the in-sample, out-of-sample and full Sharpe", () => {
    expect(split.annualisation).toBeCloseTo(106523.54430379746, 6);
    const sharpes = splitSharpe(run.netReturn, split);
    expect(sharpes.full).toBeCloseTo(7.415694861945087, 9);
    expect(sharpes.inSample).toBeCloseTo(9.016402010383958, 9);
    expect(sharpes.outOfSample).toBeCloseTo(3.6702489282869744, 9);
  });

  it("counts position changes the way the sweep counts trades", () => {
    expect(positionChangeCount(run)).toBe(11);
  });

  it("long_only and the SMA-over-EMA ordering match too", () => {
    const longOnly = runCrossover(bars, { ...SETTINGS, mode: "long_only" });
    expect(longOnly.equity[longOnly.equity.length - 1]).toBeCloseTo(1.0001711910359785, 12);
    const mixed = runCrossover(bars, { ...SETTINGS, fastKind: "sma", slowKind: "ema", fastPeriod: 4, slowPeriod: 12 });
    expect(mixed.equity[mixed.equity.length - 1]).toBeCloseTo(1.000946660596257, 12);
  });

  it("trade factors (flat spells included) multiply to the final equity exactly", () => {
    const { spells, flatFactor } = tradeSpells(run);
    const product = spells.reduce((acc, spell) => acc * spell.factor, flatFactor);
    expect(product).toBeCloseTo(run.equity[run.equity.length - 1] as number, 12);
    const statistics = tradeStatistics(spells);
    expect(statistics.count).toBe(spells.length);
    expect(statistics.longCount + statistics.shortCount).toBe(statistics.count);
    expect((statistics.winRate ?? 0) >= 0 && (statistics.winRate ?? 0) <= 1).toBe(true);
  });
});

describe("no lookahead", () => {
  it("the first 70% of the bars give the same equity prefix as the whole series", () => {
    const cut = Math.floor(CLOSES.length * 0.7);
    const whole = runCrossover(barsOf(CLOSES), SETTINGS);
    const prefix = runCrossover(barsOf(CLOSES.slice(0, cut)), SETTINGS);
    for (let k = 0; k < prefix.equity.length; k += 1) expect(prefix.equity[k]).toBeCloseTo(whole.equity[k] as number, 12);
  });

  it("a rule that traded the same bar's signal (no shift) would differ, so the guard can fail", () => {
    const whole = runCrossover(barsOf(CLOSES), SETTINGS);
    let leaked = 1;
    for (let k = 0; k < whole.netReturn.length; k += 1) leaked *= 1 + (whole.position[k] as number) * (whole.barReturn[k] as number) - (whole.costFraction[k] as number);
    expect(Math.abs(leaked - (whole.equity[whole.equity.length - 1] as number))).toBeGreaterThan(1e-4);
    // and the held position really is last bar's decision
    for (let k = 1; k < whole.position.length; k += 1) expect(whole.heldPosition[k]).toBe(whole.position[k - 1]);
  });
});

describe("ratio back-adjustment", () => {
  it("makes the roll bar's return zero and keeps the other returns", () => {
    const bars = barsOf([100, 102, 104, 200, 202, 206]);
    const symbols = ["OLD", "OLD", "OLD", "NEW", "NEW", "NEW"];
    const adjusted = ratioBackAdjust(symbols, bars);
    const returns = adjusted.close.slice(1).map((value, i) => value / (adjusted.close[i] as number) - 1);
    expect(returns[2]).toBeCloseTo(0, 12);
    expect(returns[0]).toBeCloseTo(102 / 100 - 1, 12);
    expect(returns[4]).toBeCloseTo(206 / 202 - 1, 12);
    expect(adjusted.close[5]).toBe(206);
  });
});

describe("drawdown episodes, months, thinning, flips", () => {
  const run = runCrossover(barsOf(CLOSES), SETTINGS);

  it("the deepest episode is the maximum drawdown and ends before its recovery", () => {
    const [deepest] = drawdownEpisodes(run, 3);
    expect(deepest?.depth).toBeCloseTo(-0.002141750676018628, 12);
    expect(deepest?.troughSeconds).toBeGreaterThan(deepest?.peakSeconds ?? 0);
  });

  it("monthly factors multiply back to the equity", () => {
    const months = monthlyReturns(run);
    const product = months.reduce((acc, month) => acc * (1 + month.strategy), 1);
    expect(product).toBeCloseTo(run.equity[run.equity.length - 1] as number, 12);
  });

  it("thinning keeps the last equity and the lowest drawdown of every bucket", () => {
    const thin = thinSeries(run, 10);
    expect(thin.step).toBe(8);
    expect(thin.equity[thin.equity.length - 1]).toBe(run.equity[run.equity.length - 1]);
    expect(Math.min(...thin.drawdown)).toBeCloseTo(Math.min(...Array.from(run.drawdown)), 12);
  });

  it("position flips equal the changes of the decided position", () => {
    const flips = positionFlips(run.position, 0, run.position.length - 1);
    expect(flips.longs.length + flips.shorts.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ handler

function syntheticRows(count: number, symbol = "MNQ") {
  const rows = [];
  let price = 18000;
  for (let i = 0; i < count; i += 1) {
    price += Math.sin(i / 7) * 3 + (i % 5 === 0 ? 1.5 : -0.5);
    rows.push({ t: START_SECONDS + i * 300, symbol, open: price, high: price + 1, low: price - 1, close: price + 0.25, volume: 10 + (i % 4) });
  }
  return rows;
}

function fakeLake(seen: string[], overrides: { missing?: string[] } = {}): StudyLake {
  const missing = new Set(overrides.missing ?? []);
  return {
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      if (sql.includes("derived_study_crossover_strategy_run_information")) return [{ symbol: "MNQ", timeframe: "5m", bar_count: 123733, notebook_pair_in_sample_rank: 2 }] as T[];
      if (sql.includes("derived_study_crossover_strategy_sweep")) return [{ configuration_label: "EMA/SMA", fast_period: 5, slow_period: 100, in_sample_rank: 2 }] as T[];
      if (sql.includes("derived_study_crossover_strategy_reality_check")) return [{ candidate: "notebook_pair", deflated_sharpe_ratio: 0.45 }] as T[];
      if (sql.includes("derived_study_crossover_strategy_walk_forward_folds")) return [] as T[];
      if (sql.includes("derived_study_crossover_strategy_reference_rules")) return [] as T[];
      if (sql.includes('"ohlcv_5m"')) return syntheticRows(600) as T[];
      return [];
    },
    async hasView(name: string) {
      return !missing.has(name);
    },
    async columns() {
      return [];
    },
  };
}

describe("the handler", () => {
  it("lists every lake view it reads", () => {
    expect(handler.slug).toBe("crossover-strategy");
    expect(handler.datasets).toContain("ohlcv_5m");
    expect(handler.datasets).toContain("derived_study_crossover_strategy_sweep");
  });

  it("the defaults are the notebook's settings and cost", () => {
    const parsed = handler.query.parse({});
    expect(parsed).toMatchObject({ symbol: "MNQ", timeframe: "5m", series: "naive", fastKind: "ema", slowKind: "sma", fastPeriod: 5, slowPeriod: 100, windowStart: "2024-03-01", windowEnd: "2025-12-01", costSource: "notebook" });
    const presets = costPresets("MNQ");
    const notebook = presets.find((preset) => preset.source === "notebook");
    expect(notebook?.costPointsPerSide).toBeCloseTo(0.700275, 6);
    expect(presets.find((preset) => preset.source === "dashboard")?.costPointsPerSide).toBeCloseTo(0.695, 6);
  });

  it("refuses a bad date, an inverted window and an unknown symbol", () => {
    expect(handler.query.safeParse({ windowStart: "2024-02-30" }).success).toBe(false);
    expect(handler.query.safeParse({ windowStart: "2025-12-02", windowEnd: "2025-12-01" }).success).toBe(false);
    expect(handler.query.safeParse({ symbol: "MNQ'; DROP" }).success).toBe(false);
    expect(handler.query.safeParse({ fastPeriod: "1" }).success).toBe(false);
  });

  it("reads the bare-root symbol for the naive series and computes the body", async () => {
    const seen: string[] = [];
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ slowPeriod: "30", windowStart: "2024-06-01", candleStart: "2024-06-03", candleEnd: "2024-06-03" }), { lake: fakeLake(seen), notes });
    const barsQuery = seen.find((sql) => sql.includes('"ohlcv_5m"')) ?? "";
    expect(barsQuery).toContain("symbol = 'MNQ'");
    expect(barsQuery).not.toContain("volume_rank");
    expect(body.available).toBe(true);
    expect(body.summary?.loadedBarCount).toBe(600);
    expect(body.summary?.frameRowCount).toBe(599);
    expect(body.parameters.costPointsPerSide).toBeCloseTo(0.700275, 6);
    expect(body.columns.map((column) => column.name)).toContain("relative_strength_index");
    expect(body.columns.length).toBe(19);
    expect(body.landed.sweep).toHaveLength(1);
    expect(body.landed.run?.notebook_pair_in_sample_rank).toBe(2);
    expect(body.trades?.factorProductError).toBeLessThan(1e-9);
    expect(body.candles?.timestampSeconds.length).toBeGreaterThan(0);
    expect(body.candles?.timestampSeconds.length).toBe(body.candles?.macd.length);
    expect(JSON.stringify(body)).not.toContain("NaN");
  });

  it("picks the highest-volume outright contract for the ratio series", async () => {
    const seen: string[] = [];
    await handler.run(handler.query.parse({ series: "ratio", slowPeriod: "30", windowEnd: "2025-11-30" }), { lake: fakeLake(seen), notes: [] });
    const barsQuery = seen.find((sql) => sql.includes('"ohlcv_5m"')) ?? "";
    expect(barsQuery).toContain("root = 'MNQ'");
    expect(barsQuery).toContain("NOT LIKE '%-%'");
    expect(barsQuery).toContain("volume_rank = 1");
  });

  it("charges no cost when asked, and the net equals the gross", async () => {
    const body = await handler.run(handler.query.parse({ costSource: "none", slowPeriod: "30", windowEnd: "2025-11-29" }), { lake: fakeLake([]), notes: [] });
    expect(body.parameters.costPointsPerSide).toBe(0);
    expect(body.summary?.totalCostFraction).toBe(0);
    expect(body.summary?.strategy.finalEquity).toBeCloseTo(body.summary?.grossFinalEquity ?? 0, 12);
  });

  it("answers an empty body with a note when the bars view is missing", async () => {
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ timeframe: "15m", windowEnd: "2025-11-28" }), { lake: fakeLake([], { missing: ["ohlcv_15m"] }), notes });
    expect(body.available).toBe(false);
    expect(body.summary).toBeNull();
    expect(notes.join(" ")).toContain("ohlcv_15m");
  });

  it("degrades to live numbers with a note when the landed record is missing", async () => {
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ slowPeriod: "30", windowEnd: "2025-11-27" }), { lake: fakeLake([], { missing: ["derived_study_crossover_strategy_sweep"] }), notes });
    expect(body.available).toBe(true);
    expect(body.landed.sweep).toEqual([]);
    expect(notes.join(" ")).toContain("derived_study_crossover_strategy_sweep");
  });

  it("fewer than three bars is an empty body, not an error", () => {
    const notes: string[] = [];
    const parameters = { ...handler.query.parse({}), costPointsPerSide: 0.7 };
    const body = buildCrossoverBody(barsOf([1, 2]), parameters, [], { run: null, sweep: [], realityCheck: [], folds: [], referenceRules: [] }, notes);
    expect(body.available).toBe(false);
    expect(notes[0]).toContain("Fewer than three");
  });
});
