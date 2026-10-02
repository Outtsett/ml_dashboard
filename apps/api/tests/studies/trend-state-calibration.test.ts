/**
 * The trend-state-calibration study: the handler on a fake lake (default recipe,
 * a refused recipe, a missing view, the sample bars' rung columns), and the two
 * ports of Trading/quant/analytics/trend/trend_state.py held to numbers the Python
 * produced (`_regime_scan` on a 40-bar synthetic case, `RingRegression` on the
 * notebook's 24 stepper prices).
 */

import { describe, expect, it } from "vitest";
import handler, { defaultRecipe, orderRungs, sampleBarColumns } from "../../studies/handlers/trend-state-calibration";
import type { StudyLake } from "../../studies/types";
import {
  RingRegression, STEPPER_PRICES, interpolate, regimeScan, scaledLevels, stepRingBuffer, tauAt,
  type NullQuantileRow, type ThresholdRow,
} from "@shared/studies/trend-state-calibration";

const SPEC = "MNQ_spec_timeframes_shuffle_within_session_type_20250101_20251230_full2025";
const SMOKE = "smoke_run";
const LADDER = "MNQ_minute_ladder_shuffle_within_session_type_20250101_20251230_full2025";

function threshold(rung: string, timeframe: string): ThresholdRow {
  return {
    rung, timeframe, window_bars: 60, session_type: "regular_trading_hours", entry_probability: 0.01, exit_probability: 0.1,
    entry_threshold_scaled_t: 3.7, exit_threshold_scaled_t: 2.2, null_scheme: "shuffle_within_session_type",
  };
}

function fakeLake(options: { views?: boolean } = {}) {
  const sql: string[] = [];
  const lake: StudyLake = {
    async query<T>(statement: string): Promise<T[]> {
      sql.push(statement);
      if (statement.includes("GROUP BY recipe")) return [{ recipe: SPEC }, { recipe: SMOKE }, { recipe: LADDER }] as T[];
      if (statement.includes("_thresholds")) return [threshold("5m_60", "5m"), threshold("1m_60", "1m"), threshold("2h_60", "2h")] as T[];
      if (statement.includes("AS day")) return [{ day: "2025-12-28" }, { day: "2025-12-29" }] as T[];
      if (statement.includes("_sample_bars")) return [{ close_time: 1, close: 25740.5, trend_t_statistic_scaled_1m_60: 1.2, trend_regime_state: 0 }] as T[];
      if (statement.includes("_settings")) return [{ verdict: "not yet usable", usable: false }] as T[];
      return [] as T[];
    },
    async hasView() {
      return options.views ?? true;
    },
    async columns(name) {
      if (name.endsWith("_metrics")) return ["metric", "n", "observation_count"];
      if (name.endsWith("_sample_bars")) {
        return ["close_time", "close", "trend_t_statistic_scaled_1m_16", "trend_t_statistic_1m_60", "trend_t_statistic_scaled_1m_60", "trend_r_squared_5m_60",
          "trend_t_statistic_scaled_5m_60", "trend_slope_log_points_per_bar_2h_60", "trend_t_statistic_scaled_2h_60", "trend_regime_state",
          "trend_regime_session_type", "recipe"];
      }
      return [];
    },
  };
  return { lake, sql };
}

describe("trend-state-calibration handler", () => {
  it("answers the newest non-smoke run, its rungs in ladder order and the last Globex day", async () => {
    const { lake, sql } = fakeLake();
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({}), { lake, notes });
    expect(body.recipe).toBe(SPEC);
    expect(body.rungs).toEqual(["1m_60", "5m_60", "2h_60"]);
    expect(body.day).toBe("2025-12-29");
    expect(body.bars).toHaveLength(1);
    expect(notes).toEqual([]);
    expect(sql.some((statement) => statement.includes("COALESCE(observation_count, n)"))).toBe(true);
    const barsSql = sql.find((statement) => statement.includes("_sample_bars") && statement.includes("epoch_ms"));
    expect(barsSql).toContain("'2025-12-29'");
    expect(barsSql).not.toContain("1m_16");
  });

  it("refuses an unknown recipe or day with a note and falls back", async () => {
    const { lake } = fakeLake();
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ recipe: "nope", day: "2020-01-01" }), { lake, notes });
    expect(body.recipe).toBe(SPEC);
    expect(body.day).toBe("2025-12-29");
    expect(notes).toHaveLength(2);
  });

  it("rejects a recipe that is not a plain name at the query schema", () => {
    expect(handler.query.safeParse({ recipe: "x'; DROP" }).success).toBe(false);
    expect(handler.query.safeParse({ day: "29/12/2025" }).success).toBe(false);
  });

  it("returns an empty body with a note when the dataset is not landed", async () => {
    const { lake } = fakeLake({ views: false });
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({}), { lake, notes });
    expect(body.recipes).toEqual([]);
    expect(body.bars).toEqual([]);
    expect(notes[0]).toContain("derived_trend_state_calibration_settings");
  });

  it("picks helpers the way the notebook did", () => {
    expect(defaultRecipe(["smoke_b", "real_a"])).toBe("real_a");
    expect(defaultRecipe(["smoke_only"])).toBe("smoke_only");
    expect(orderRungs([threshold("30m_60", "30m"), threshold("15m_60", "15m")])).toEqual(["15m_60", "30m_60"]);
    expect(sampleBarColumns(["close", "trend_t_statistic_scaled_1m_16", "trend_t_statistic_scaled_1m_60", "trend_regime_state"], ["1m_60"])).toEqual([
      "close", "trend_t_statistic_scaled_1m_60", "trend_regime_state",
    ]);
  });
});

// Produced by trend_state._regime_scan (numba) on this input, allow_short True and False.
const SCAN = {
  scaled: [[null, null, null], [null, null, null], [-0.591, -3.499, -0.716], [2.998, -3.256, -1.097], [2.694, -3.977, -2.236], [2.272, -3.457, -2.494], [3.307, -3.672, -2.468], [4.976, -3.084, -3.013], [4.779, -2.5, -0.923], [4.488, -2.763, 0.159], [3.53, null, 1.112], [4.157, -2.979, 1.836], [1.103, -1.876, 0.8], [-0.7, -1.578, 1.556], [-1.18, -2.74, 1.584], [-1.237, -1.222, 2.392], [-1.028, -0.022, 2.17], [-2.027, 0.609, 2.799], [-2.259, -0.236, 3.046], [-4.953, 0.509, 3.577], [null, null, null], [-5.905, -1.621, 1.548], [-5.139, -0.373, -0.783], [-5.677, -0.018, -1.441], [-3.959, -1.305, -1.058], [-5.091, 0.214, -1.081], [-5.493, -1.642, 0.735], [-4.68, -0.828, 1.964], [-4.303, -1.519, 1.1], [-5.167, -0.039, -0.477], [-5.811, -0.386, -0.235], [-5.19, -1.735, -2.103], [-5.195, -0.424, -1.285], [-4.962, -0.767, -0.969], [-5.224, 0.116, -1.827], [-5.079, -0.004, -1.24], [-4.837, 2.75, 0.379], [-3.22, 0.548, 0.011], [-3.878, 1.123, -2.45], [-2.609, 2.275, -3.856]],
  session: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2],
  entry: [[3.0, 3.5, 4.0], [2.5, 3.0, 3.5], [3.2, 3.2, 3.2]],
  exit: [[1.5, 1.8, 2.0], [1.2, 1.5, 1.7], [1.6, 1.6, 1.6]],
  state: [0, 0, -1, -1, -1, -1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
  stateLongOnly: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  winner: [-1, -1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
  entryEvidence: [null, null, 1.3996, 1.3024, 1.5908, 1.3828, 1.4688, 1.421714286, 1.365428571, 1.282285714, 1.008571429, 1.187714286, 0.625333333, 0.526, 0.782857143, 0.7475, 0.678125, 0.8746875, 0.951875, 1.23825, null, 1.968333333, 1.713, 1.892333333, 1.319666667, 1.697, 1.831, 1.56, 1.229428571, 1.476285714, 1.660285714, 1.482857143, 1.484285714, 1.417714286, 1.492571429, 1.26975, 1.20925, 0.805, 0.9695, 1.205],
  exitEvidence: [null, null, null, 2.713333333, 3.314166667, 2.880833333, 3.06, null, null, 2.493333333, 1.961111111, 2.309444444, 0.612777778, null, null, null, null, null, null, null, null, null, 3.426, 3.784666667, 2.639333333, 3.394, 3.662, 3.12, 2.390555556, 2.870555556, 3.228333333, 2.883333333, 2.886111111, 2.756666667, 2.902222222, 2.5395, 2.4185, 1.61, 1.939, 2.41],
};

function expectSeries(actual: number[], expected: Array<number | null>) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    if (value === null) expect(Number.isNaN(actual[index])).toBe(true);
    else expect(actual[index]).toBeCloseTo(value, 8);
  });
}

describe("regimeScan (port of trend_state._regime_scan)", () => {
  it("reproduces the Python state, winner and evidence bar for bar", () => {
    const scan = regimeScan(SCAN.scaled, SCAN.session, SCAN.entry, SCAN.exit, true);
    expect(scan.state).toEqual(SCAN.state);
    expect(scan.winner).toEqual(SCAN.winner);
    expectSeries(scan.entryEvidence, SCAN.entryEvidence);
    expectSeries(scan.exitEvidence, SCAN.exitEvidence);
  });

  it("reproduces the long-only state", () => {
    expect(regimeScan(SCAN.scaled, SCAN.session, SCAN.entry, SCAN.exit, false).state).toEqual(SCAN.stateLongOnly);
  });

  it("caps the exit level just under the entry level, as the notebook did", () => {
    const levels = scaledLevels([[3]], [[2.5]], 0.5, 1.5);
    expect(levels.entry[0]?.[0]).toBe(1.5);
    expect(levels.exit[0]?.[0]).toBeCloseTo(1.5 * 0.999, 12);
  });
});

describe("RingRegression (port of trend_state.RingRegression)", () => {
  it("matches the Python sums and statistics through the 24 stepper prices", () => {
    const { rows, buffer } = stepRingBuffer(STEPPER_PRICES, 8, 24);
    const check = (row: (typeof rows)[number] | undefined, expected: number[]) => {
      expect(row).toBeDefined();
      const actual = [row!.bar, row!.sumPrice, row!.sumIndexPrice, row!.sumPriceSquared, row!.slope, row!.intercept, row!.tStatistic, row!.scaledTStatistic, row!.rSquared];
      expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
    };
    expect(Number.isNaN(rows[6]!.slope)).toBe(true);
    check(rows[7], [8, 3.860312081672703, 17.009335275459506, 5.041973476043883, 0.0832914997525011, 100.59224891443282, 0.7780611971443199, 0.2750861743394359, 0.09164942779860252]);
    check(rows[8], [9, 5.656162914494132, 25.71997902353681, 8.267053689789304, 0.1410335434001749, 100.61463311576864, 1.2083954048249603, 0.42723229255319634, 0.19573411523979278]);
    check(rows[23], [24, 9.556926549302858, 4.416400853546676, 34.34887694563073, -0.6912581445003173, 104.01524947777146, -6.485486228216119, -2.2929656456317913, 0.8751600334360755]);
    const expectedBuffer = [104.12011817370386, 104.06250241266365, 102.5612796728628, 101.67174193307783, 100.2300068952861, 100.39491576421142, 99.52746928276771, 100.19873364158941];
    expectedBuffer.forEach((value, index) => expect(buffer[index]).toBeCloseTo(value, 10));
  });

  it("agrees with a direct least-squares fit on the window", () => {
    const regression = new RingRegression(5);
    const prices = [3, 5, 4, 8, 9, 7, 11];
    for (const price of prices) regression.update(price);
    const window = prices.slice(-5);
    const meanIndex = 2;
    const meanPrice = window.reduce((a, b) => a + b, 0) / 5;
    let covariance = 0;
    let variance = 0;
    window.forEach((price, index) => {
      covariance += (index - meanIndex) * (price - meanPrice);
      variance += (index - meanIndex) ** 2;
    });
    expect(regression.statistics().slope).toBeCloseTo(covariance / variance, 12);
  });
});

describe("tauAt (np.interp on the log tail probability)", () => {
  const rows: NullQuantileRow[] = [0.5, 0.9, 0.99, 0.999].map((level, index) => ({
    null_scheme: "s", rung: "1m_60", session_type: "overnight", quantile_level: level, scaled_t_quantile: 1 + index, null_observations: 10,
  }));

  it("hits a table point exactly and interpolates between points on log p", () => {
    expect(tauAt(rows, 0.01)).toBeCloseTo(3, 9);
    const between = 2 + (Math.log(0.05) - Math.log(0.1)) / (Math.log(0.01) - Math.log(0.1)) * (3 - 2);
    expect(tauAt(rows, 0.05)).toBeCloseTo(between, 9);
  });

  it("clamps outside the table like numpy", () => {
    expect(tauAt(rows, 1e-6)).toBe(4);
    expect(interpolate(10, [0, 1], [5, 6])).toBe(6);
  });
});
