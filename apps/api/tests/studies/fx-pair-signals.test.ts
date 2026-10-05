/**
 * The fx-pair-signals study: the handler's SQL run for real on an in-memory
 * DuckDB whose tables carry the lake views' names and columns (recipe pinning,
 * the notebook's group-bys, screen filters and criterion, the redundancy
 * threshold, the missing-view degradation, query refusal), plus the shared
 * pure computations (hour ratio, participation ratio steps, mechanical share),
 * and the page rendered to a string from that body so every section's code runs.
 */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler, { VIEWS, querySchema } from "../../studies/handlers/fx-pair-signals";
import { plainRow } from "../../studies/sql";
import type { StudyLake } from "../../studies/types";
import Page from "@/studies/pages/fx-pair-signals/Page";
import { DEFAULTS, serverControls } from "@/studies/pages/fx-pair-signals/controls";
import {
  EMPTY_WIRE, SPREAD_STATISTICS, cividis, decodeBody, divergingColour, fromColumnar, hourRatio, mechanicalShare, median, participationSteps,
  toColumnar,
} from "@shared/studies/fx-pair-signals";

const RECIPE = "forexmodel_pair_results_2026_09_09";
const OLD = "forexmodel_pair_results_2026_01_01";
const PAIRS = ["AUDUSD", "EURUSD", "USDJPY"];

let instance: DuckDBInstance;

async function run(sql: string) {
  const connection = await instance.connect();
  try {
    return (await connection.runAndReadAll(sql)).getRowObjectsJS().map((row) => plainRow(row as Record<string, unknown>));
  } finally {
    connection.closeSync();
  }
}

const lake: StudyLake = {
  async query<T>(sql: string): Promise<T[]> {
    return (await run(sql)) as T[];
  },
  async hasView(name) {
    const rows = await run(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${name}'`);
    return Number(rows[0]?.n) > 0;
  },
  async columns() {
    return [];
  },
};

const emptyLake: StudyLake = { async query() { return []; }, async hasView() { return false; }, async columns() { return []; } };

function spreadColumns(value: (unit: string, statistic: string) => string): string {
  return ["pips", "basis_points"].flatMap((unit) => SPREAD_STATISTICS.map((statistic) => `${value(unit, statistic)} AS spread_${unit}_${statistic}`)).join(", ");
}

beforeAll(async () => {
  instance = await DuckDBInstance.create(":memory:");
  const pairs = `(VALUES ${PAIRS.map((pair, index) => `('${pair}', ${index + 1})`).join(", ")}) AS p(pair, k)`;
  await run(`CREATE TABLE ${VIEWS.inventory} AS SELECT pair, 1000 * k AS bar_count, TIMESTAMP '2020-01-01' AS first_bar_timestamp,
    TIMESTAMP '2026-08-26' AS last_bar_timestamp, 100 * k AS bars_with_quotes_count, TIMESTAMP '2026-01-05' AS first_quote_timestamp,
    TIMESTAMP '2026-08-26' AS last_quote_timestamp, 0.1 * k AS quote_coverage_ratio, r.recipe FROM ${pairs},
    (VALUES ('${RECIPE}'), ('${OLD}')) AS r(recipe)`);
  await run(`CREATE TABLE ${VIEWS.spread} AS SELECT pair, TIMESTAMP '2026-01-05' AS first_quote_timestamp, TIMESTAMP '2026-08-26' AS last_quote_timestamp,
    ${spreadColumns(() => "1.5 * k")}, '${RECIPE}' AS recipe FROM ${pairs}`);
  // Each pair's hourly median: 1.0 + 0.1 * k, and 4x that in hour 21. The old recipe reads 100 everywhere.
  await run(`CREATE TABLE ${VIEWS.spreadHour} AS SELECT pair, h AS hour_utc,
    ${spreadColumns(() => "CASE WHEN h = 21 THEN 4 * (1.0 + 0.1 * k) ELSE 1.0 + 0.1 * k END")}, '${RECIPE}' AS recipe
    FROM ${pairs}, range(24) AS t(h)
    UNION ALL SELECT pair, h, ${spreadColumns(() => "100.0")}, '${OLD}' FROM ${pairs}, range(24) AS t(h)`);
  await run(`CREATE TABLE ${VIEWS.tradability} AS SELECT pair, tf AS timeframe, 10 AS bar_count, 0.001 AS average_true_range_14_bars_price,
    10.0 AS average_true_range_14_bars_pips, 9.0 AS average_true_range_14_bars_basis_points, 1.0 AS median_spread_pips,
    0.1 AS spread_over_average_true_range, 0.2 AS round_trip_over_average_true_range, 0.2 AS breakeven_move_average_true_ranges,
    2.0 AS breakeven_move_pips, '${RECIPE}' AS recipe FROM ${pairs}, (VALUES ('1m'), ('1d')) AS t(tf)`);
  await run(`CREATE TABLE ${VIEWS.correlation} AS SELECT * FROM (VALUES
    ('1d', 'AUDUSD', 'EURUSD', 'USD', 100, 0.6, 0.55, 0.8, 10, -0.2, 100, true, 1 - 0.2 / 0.6, '${RECIPE}'),
    ('1d', 'AUDUSD', 'USDJPY', 'USD', 100, -0.4, -0.35, -0.6, 10, 0.1, 100, true, 0.75, '${RECIPE}'),
    ('1d', 'EURUSD', 'USDJPY', 'USD', 100, -0.2, -0.2, -0.4, 10, 1.0, 100, false, NULL, '${RECIPE}'))
    AS c(timeframe, pair_a, pair_b, shared_currency, observation_count, correlation_raw_pearson, correlation_raw_spearman,
    correlation_tail_decile, tail_observation_count, correlation_residual_pearson, residual_observation_count, residual_identifiable,
    mechanical_share, recipe)`);
  await run(`CREATE TABLE ${VIEWS.eigen} AS SELECT * FROM (VALUES
    ('1d', 'raw', 1, 2.0, 0.667, 0.667, 50, 1.8, '${RECIPE}'), ('1d', 'raw', 2, 1.0, 0.333, 1.0, 50, 1.8, '${RECIPE}'))
    AS e(timeframe, matrix, component, eigenvalue, variance_share, cumulative_variance_share, observation_count, participation_ratio, recipe)`);
  // 3 pairs x 2 timeframes x 2 targets x 4 features. Range features survive family-wise when k >= 2; direction never family-wise.
  await run(`CREATE TABLE ${VIEWS.screen} AS SELECT pair, tf AS timeframe, target, feature, family, 1000 AS observation_count,
    (CASE WHEN target = 'forward_log_range' THEN 0.1 * k + 0.01 * f ELSE 0.005 * f END) AS spearman_correlation,
    0.004 AS null_95th_percentile_per_feature, 0.15 AS null_95th_percentile_family_wise,
    (CASE WHEN target = 'forward_log_range' THEN 0.1 * k + 0.01 * f ELSE 0.005 * f END) > 0.004 AS survives_per_feature,
    (CASE WHEN target = 'forward_log_range' THEN 0.1 * k + 0.01 * f ELSE 0.005 * f END) > 0.15 AS survives_family_wise,
    '${RECIPE}' AS recipe
    FROM ${pairs}, (VALUES ('1h'), ('1d')) AS t(tf), (VALUES ('forward_log_range'), ('forward_log_return')) AS g(target),
    (VALUES ('log_range', 'shape', 1), ('body_fraction', 'shape', 2), ('volume_zscore', 'volume', 3), ('efficiency_ratio', 'trend', 4)) AS f(feature, family, f)`);
  await run(`CREATE TABLE ${VIEWS.redundancy} AS SELECT * FROM (VALUES
    ('a', 'b', 'average', 'average', 0.99, '${RECIPE}'), ('a', 'c', 'average', 'trend', -0.97, '${RECIPE}'),
    ('b', 'c', 'average', 'trend', 0.5, '${RECIPE}')) AS r(feature_a, feature_b, family_a, family_b, spearman_correlation, recipe)`);
});

afterAll(() => {
  instance?.closeSync();
});

describe("fx-pair-signals handler", () => {
  it("returns the empty body with a note when the tables are not landed", async () => {
    const notes: string[] = [];
    const body = await handler.run(querySchema.parse({}), { lake: emptyLake, notes });
    expect(body).toEqual(EMPTY_WIRE);
    expect(notes[0]).toContain(VIEWS.inventory);
  });

  it("pins the newest recipe and runs the notebook's hour curve (median of each pair's median)", async () => {
    const body = decodeBody(await handler.run(querySchema.parse({}), { lake, notes: [] }));
    expect(body.recipe).toBe(RECIPE);
    expect(body.inventory).toHaveLength(3);
    expect(typeof body.inventory[0]?.first_bar_timestamp).toBe("number");
    expect(body.hourAcrossPairs).toHaveLength(24);
    const hour0 = body.hourAcrossPairs[0]!;
    expect(hour0.median_basis_points).toBeCloseTo(1.2, 12); // median of 1.1, 1.2, 1.3; the old recipe's 100 is excluded
    expect(hour0.pair_count).toBe(3);
    const ratio = hourRatio(body.hourAcrossPairs.map((row) => ({ hour_utc: row.hour_utc, value: row.median_basis_points })));
    expect(ratio.ratio).toBeCloseTo(4, 12);
    expect(ratio.ordinaryHourCount).toBe(20);
  });

  it("aggregates participation, body versus tail, and the unidentifiable pairs", async () => {
    const body = decodeBody(await handler.run(querySchema.parse({}), { lake, notes: [] }));
    expect(body.participation).toEqual([{ timeframe: "1d", matrix: "raw", participation_ratio: 1.8, observation_count: 50 }]);
    const row = body.bodyVersusTail[0]!;
    expect(row.mean_absolute_raw).toBeCloseTo((0.6 + 0.4 + 0.2) / 3, 12);
    expect(row.mean_absolute_residual).toBeCloseTo((0.2 + 0.1 + 1.0) / 3, 12);
    expect(row.pair_combination_count).toBe(3);
    expect(body.unidentifiable.map((r) => `${r.pair_a}/${r.pair_b}`)).toEqual(["EURUSD/USDJPY"]);
  });

  it("builds the survival table and the strongest survivors under the family-wise criterion", async () => {
    const body = decodeBody(await handler.run(querySchema.parse({ topCount: "5" }), { lake, notes: [] }));
    const rangeShape = body.survival.find((r) => r.target === "forward_log_range" && r.family === "shape")!;
    // shape tests on the range target: 3 pairs x 2 timeframes x 2 features = 12; survive when 0.1k + 0.01f > 0.15, i.e. k >= 2 -> 8
    expect(rangeShape.tests).toBe(12);
    expect(rangeShape.survived).toBe(8);
    expect(rangeShape.survival_rate).toBeCloseTo(8 / 12, 12);
    expect(body.survival.filter((r) => r.target === "forward_log_return").every((r) => r.survived === 0)).toBe(true);
    expect(body.strongest).toHaveLength(5);
    expect(body.strongest[0]).toMatchObject({ pair: "USDJPY", feature: "efficiency_ratio", target: "forward_log_range" });
    expect(Math.abs(body.strongest[0]!.spearman_correlation)).toBeGreaterThanOrEqual(Math.abs(body.strongest[4]!.spearman_correlation));
    expect(body.families).toEqual(["shape", "trend", "volume"]);
    expect(body.pairs).toEqual(PAIRS);
  });

  it("filters the screen by pair, timeframe, target and switches the criterion", async () => {
    const body = decodeBody(await handler.run(
      querySchema.parse({ pair: "EURUSD", timeframe: "1h", target: "forward_log_return", criterion: "per_feature" }),
      { lake, notes: [] },
    ));
    expect(body.screenProfile).toHaveLength(4);
    // per-feature null 0.004: direction features with 0.005 f all pass
    expect(body.survival.reduce((sum, r) => sum + r.survived, 0)).toBe(4);
    expect(body.strongest.every((r) => r.pair === "EURUSD" && r.timeframe === "1h")).toBe(true);
  });

  it("builds the heat map at its own timeframe and target, and applies the redundancy threshold", async () => {
    const body = decodeBody(await handler.run(querySchema.parse({ heatmapTimeframe: "1d", redundancyThreshold: "0.98" }), { lake, notes: [] }));
    expect(body.heatmap).toHaveLength(12);
    expect(body.nearDuplicates.map((r) => `${r.feature_a}-${r.feature_b}`)).toEqual(["a-b"]);
    expect(body.redundancy).toHaveLength(3);
    const loose = decodeBody(await handler.run(querySchema.parse({}), { lake, notes: [] }));
    expect(loose.nearDuplicates.map((r) => r.spearman_correlation)).toEqual([0.99, -0.97]);
  });

  it("refuses values outside the query schema", () => {
    expect(querySchema.safeParse({ pair: "EURUSD'; DROP" }).success).toBe(false);
    expect(querySchema.safeParse({ family: "shape OR 1=1" }).success).toBe(false);
    expect(querySchema.safeParse({ timeframe: "constructor" }).success).toBe(false);
    expect(querySchema.safeParse({ topCount: "1000" }).success).toBe(false);
  });
});

describe("fx-pair-signals page", () => {
  it("renders every section from the handler's body", async () => {
    const wire = await handler.run(querySchema.parse({}), { lake, notes: [] });
    const client = new QueryClient();
    client.setQueryData(["study", "fx-pair-signals", serverControls(DEFAULTS)], { slug: "fx-pair-signals", notes: [], data: wire });
    const html = renderToString(createElement(QueryClientProvider, { client }, createElement(Page)));
    for (const heading of ["Coverage", "1 · Spread", "Spread by hour of day", "The ratio that decides tradability", "2 · Correlation", "Body versus tail",
      "The correlation matrix", "3 · Which price-structure features survive", "The strongest survivors", "Near-duplicate features", "Every column"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("4.0x"); // the synthetic hour 21 is four times the ordinary hours
  });

  it("renders the not-landed state from the empty body", () => {
    const client = new QueryClient();
    client.setQueryData(["study", "fx-pair-signals", serverControls(DEFAULTS)], { slug: "fx-pair-signals", notes: ["Not in the lake yet"], data: EMPTY_WIRE });
    const html = renderToString(createElement(QueryClientProvider, { client }, createElement(Page)));
    expect(html).toContain("not in the lake yet");
  });
});

// Opt-in: FX_PAIR_SIGNALS_LIVE=1 runs the handler over the real lake and holds it to the notebook's
// own numbers (19_pair_signals.py's cells run with polars on forexmodel/results, 2026-09-30).
describe.runIf(process.env.FX_PAIR_SIGNALS_LIVE === "1")("fx-pair-signals against the lake (notebook parity)", () => {
  it("reproduces the notebook's headline numbers and renders them", async () => {
    const { lake: realLake } = await import("../../studies/lake");
    const wire = await handler.run(querySchema.parse({}), { lake: realLake, notes: [] });
    const body = decodeBody(wire);
    const ratio = hourRatio(body.hourAcrossPairs.map((row) => ({ hour_utc: row.hour_utc, value: row.median_basis_points })));
    expect(ratio.spike).toBeCloseTo(7.773544657618187, 12);
    expect(ratio.ordinary).toBeCloseTo(1.8472930483332781, 12);
    expect(ratio.ratio).toBeCloseTo(4.208073356109836, 12);
    expect(body.participation.find((row) => row.timeframe === "1d" && row.matrix === "raw")?.participation_ratio).toBeCloseTo(4.256087899426462, 12);
    expect(body.participation.find((row) => row.timeframe === "1d" && row.matrix === "residual")?.participation_ratio).toBeCloseTo(8.59962089798936, 12);
    expect(body.nearDuplicates).toHaveLength(31);
    const survived = (target: string) => body.survival.filter((row) => row.target === target).reduce((sum, row) => sum + row.survived, 0);
    expect(survived("forward_log_range")).toBe(923);
    expect(survived("forward_log_return")).toBe(508);
    expect(body.strongest[0]).toMatchObject({ pair: "EURGBP", timeframe: "15m", feature: "log_range" });
    const client = new QueryClient();
    client.setQueryData(["study", "fx-pair-signals", serverControls(DEFAULTS)], { slug: "fx-pair-signals", notes: [], data: wire });
    const text = renderToString(createElement(QueryClientProvider, { client }, createElement(Page))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const probe of ["NZDUSD ranks", "4.2x", "Two-sided bid/ask exists on", "Volatility is forecastable", "feature pairs correlate above", "Cost per unit of movement"]) {
      const at = text.indexOf(probe);
      console.log(`${probe} => ${at < 0 ? "MISSING" : text.slice(at, at + 240)}`);
      expect(at).toBeGreaterThanOrEqual(0);
    }
  }, 240_000);
});

describe("fx-pair-signals pure computations", () => {
  it("medians like polars (the mean of the two middle values)", () => {
    expect(median([3, 1, 2, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("computes the hour ratio against hours below the cut, and the ordinary-hour range", () => {
    const curve = Array.from({ length: 24 }, (_, hour) => ({ hour_utc: hour, value: hour === 21 ? 8 : hour < 20 ? 2 + (hour % 2) * 0.1 : 3 }));
    const result = hourRatio(curve);
    expect(result.ordinary).toBeCloseTo(2.05, 12);
    expect(result.ratio).toBeCloseTo(8 / 2.05, 12);
    expect(result.ordinaryRange).toBeCloseTo(0.05, 12);
  });

  it("steps the participation ratio to (sum lambda)^2 / sum lambda^2", () => {
    const steps = participationSteps([6.598399031904027, 4.262881624038783, 1, 0.5]);
    const last = steps[steps.length - 1]!;
    const sum = 6.598399031904027 + 4.262881624038783 + 1.5;
    const squares = 6.598399031904027 ** 2 + 4.262881624038783 ** 2 + 1 + 0.25;
    expect(last.runningRatio).toBeCloseTo((sum * sum) / squares, 12);
    expect(participationSteps(Array(18).fill(1)).at(-1)?.runningRatio).toBeCloseTo(18, 12);
  });

  it("computes mechanical share as pair_correlation.py does", () => {
    expect(mechanicalShare(0.6425163286740191, -0.24009141074313844)).toBeCloseTo(0.6263263670845183, 12);
    expect(mechanicalShare(0, 0.1)).toBeNull();
  });

  it("sends large frames column by column and decodes them back to rows", () => {
    const rows = [{ pair: "EURUSD", value: 0.123456789123, count: 7, flag: true }, { pair: "USDJPY", value: -2.5, count: 8, flag: false }];
    const table = toColumnar(rows);
    expect(table.columns).toEqual(["pair", "value", "count", "flag"]);
    expect(table.values.value).toEqual([0.12345679, -2.5]);
    expect(fromColumnar(table)).toEqual([{ ...rows[0], value: 0.12345679 }, rows[1]]);
    expect(fromColumnar(toColumnar([]))).toEqual([]);
  });

  it("colours negative blue and positive orange, never green", () => {
    expect(divergingColour(1)).toBe("rgb(230,159,0)");
    expect(divergingColour(-1)).toBe("rgb(0,114,178)");
    expect(cividis(0)).toBe("rgb(0,32,77)");
  });
});
