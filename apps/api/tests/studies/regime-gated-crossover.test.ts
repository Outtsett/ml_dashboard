/**
 * The regime-gated crossover study: the bootstrap port against the values the
 * notebook's own Python module (Trading/quant/analytics/latent/robust.py)
 * printed for the same inputs, and the handler on a fake lake (the SQL it
 * writes, the record it returns, the live verdicts and gate, the empty state
 * when nothing is landed, and the router refusing a malformed gate).
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler, { RECIPE, VIEWS, sharedHistogram } from "../../studies/handlers/regime-gated-crossover";
import { createStudiesRouter } from "../../studies/studies.router";
import type { StudyContext, StudyHandler, StudyLake } from "../../studies/types";
import {
  autocovariance, bcaInterval, blockJackknifeMeans, circularBlockMeans, evaluateGate, normalCdf, normalQuantile,
  parseGateChoice, politisWhiteBlockLength, seededRandom, sharpe, sortedQuantile,
  type RegimeGatedCrossoverBody, type TaggedBars,
} from "@shared/studies/regime-gated-crossover";

function series(length: number, value: (t: number) => number): Float64Array {
  return Float64Array.from({ length }, (_, t) => value(t));
}

// d_t = sin(0.37 t) + 0.6 sin(0.013 t) + 0.3 cos(1.7 t) (t mod 7) / 7, t = 0..1999
const persistent = series(2000, (t) => Math.sin(0.37 * t) + 0.6 * Math.sin(0.013 * t) + 0.3 * Math.cos(1.7 * t) * (t % 7) / 7);

describe("bootstrap port matches latent/robust.py", () => {
  it("autocovariance (biased, mean-centred)", () => {
    const expected = [0.6880437787784042, 0.6410571297747676, 0.5381656725147198, 0.40087297279537676, 0.22727728534339894, 0.034500764230135816];
    const actual = autocovariance(persistent, 5);
    expected.forEach((value, lag) => expect(actual[lag]).toBeCloseTo(value, 12));
  });

  it("Politis-White block length, truncated horizon", () => {
    const result = politisWhiteBlockLength(persistent);
    expect(result.lagWindowCount).toBe(5);
    expect(result.maximumLagSearched).toBe(50);
    expect(result.dependenceHorizon).toBe(45);
    expect(result.horizonTruncated).toBe(true);
    expect(result.windowLength).toBe(90);
    expect(result.gHat).toBeCloseTo(643.8709690792898, 8);
    expect(result.spectralDensityAtZero).toBeCloseTo(20.424550129256264, 10);
    expect(result.rawBlockLength).toBeCloseTo(143.92557766156963, 8);
    expect(result.maximumAdmissibleBlockLength).toBe(135);
    expect(result.blockLength).toBe(135);
  });

  it("Politis-White block length, horizon found", () => {
    const raw = series(5000, (t) => ((t * 7919 + ((t * t) % 977)) % 1009) / 1009 - 0.5);
    // numpy.roll(d, 1): the first value borrows the last.
    const values = Float64Array.from(raw, (value, t) => value + 0.5 * (raw[(t - 1 + raw.length) % raw.length] as number));
    const result = politisWhiteBlockLength(values);
    expect(result.dependenceHorizon).toBe(1);
    expect(result.horizonTruncated).toBe(false);
    expect(result.windowLength).toBe(2);
    expect(result.gHat).toBeCloseTo(0.08961292841789142, 10);
    expect(result.rawBlockLength).toBeCloseTo(11.603662899899543, 8);
    expect(result.blockLength).toBe(12);
  });

  it("block jackknife means", () => {
    const jackknife = blockJackknifeMeans(persistent, 50);
    expect(jackknife.length).toBe(40);
    [0.004474703371810993, -0.0031011614422961505, -0.0060174808759896085].forEach((value, i) => expect(jackknife[i]).toBeCloseTo(value, 14));
  });

  it("BCa interval from fixed replicates", () => {
    let average = 0;
    for (const value of persistent) average += value;
    average /= persistent.length;
    const replicates = series(500, (i) => average + 0.02 * Math.sin(i * 0.77) + 0.005 * Math.cos(i * 2.3) + 0.001 * i / 500);
    const interval = bcaInterval(average, replicates, blockJackknifeMeans(persistent, 50));
    expect(interval.bcaLow).toBeCloseTo(-0.013419692569174024, 9);
    expect(interval.bcaHigh).toBeCloseTo(0.03264262835550569, 9);
    expect(interval.percentileLow).toBeCloseTo(-0.013162562770026339, 12);
    expect(interval.percentileHigh).toBeCloseTo(0.03277329909750319, 12);
    expect(interval.biasCorrection).toBeCloseTo(-0.03510000177270885, 10);
    expect(interval.acceleration).toBeCloseTo(-0.0012373376641875067, 12);
    expect(interval.bcaProbabilityLow).toBeCloseTo(0.02092034933817168, 10);
    expect(interval.bcaProbabilityHigh).toBeCloseTo(0.970297932610032, 10);
    expect(interval.fractionAtOrBelowZero).toBeCloseTo(0.346, 12);
  });

  it("normal quantile and distribution function equal scipy's", () => {
    const quantiles = [-3.090232306167813, -1.9599639845400545, -0.5244005127080409, 0, 0.8416212335729143, 1.959963984540054, 3.719016485455709];
    [0.001, 0.025, 0.3, 0.5, 0.8, 0.975, 0.9999].forEach((p, i) => expect(normalQuantile(p)).toBeCloseTo(quantiles[i] as number, 12));
    const cdf = [2.866515718791933e-7, 0.013903447513498595, 0.3820885778110474, 0.5, 0.758036347776927, 0.9750021048517795, 0.9997673709209645, 0.9999999990134123];
    [-5, -2.2, -0.3, 0, 0.7, 1.96, 3.5, 6].forEach((x, i) => expect(normalCdf(x)).toBeCloseTo(cdf[i] as number, 12));
  });

  it("circular block means are unbiased for the mean and reproducible from a seed", () => {
    const first = circularBlockMeans(persistent, 40, 400, seededRandom(3));
    const second = circularBlockMeans(persistent, 40, 400, seededRandom(3));
    expect(Array.from(first)).toEqual(Array.from(second));
    let average = 0;
    for (const value of persistent) average += value;
    average /= persistent.length;
    let replicateMean = 0;
    for (const value of first) replicateMean += value;
    replicateMean /= first.length;
    expect(Math.abs(replicateMean - average)).toBeLessThan(0.01);
  });

  it("numpy's linear quantile and the crossover module's Sharpe", () => {
    expect(sortedQuantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(sortedQuantile([1, 2, 3, 4], 0.1)).toBeCloseTo(1.3, 12);
    expect(sharpe([0.01, -0.02, 0.03, 0.0], 252)).toBeCloseTo((0.005 / Math.sqrt(0.000433333333333) ) * Math.sqrt(252), 6);
    expect(sharpe([0.01, 0.01], 252)).toBe(0);
  });

  it("gate choices", () => {
    expect(parseGateChoice("verdicts", 4)).toBeNull();
    expect(parseGateChoice("none", 4)).toEqual([]);
    expect(parseGateChoice("3,1,9,1", 4)).toEqual([1, 3]);
  });

  it("a gate that keeps every regime is a no-op", () => {
    const bars: TaggedBars = {
      timestamp: series(600, (i) => i),
      netReturn: series(600, (i) => Math.sin(i)),
      testFold: Int32Array.from({ length: 600 }, (_, i) => (i < 300 ? 0 : 1)),
      regime: Int32Array.from({ length: 600 }, (_, i) => i % 2),
    };
    const gate = evaluateGate(bars, [0, 1], Number.NEGATIVE_INFINITY, { minimumBars: 100, blockFloor: 10, replicates: 200, seed: 0, barsPerYear: 1000, source: "chosen" });
    expect(gate.status).toBe("no_op");
    expect(gate.interval).toBeNull();
    expect(gate.folds.map((fold) => fold.barCount)).toEqual([300, 300]);
  });

  it("shared histogram bins keep the tails in the edge bins", () => {
    const bins = sharedHistogram(Float64Array.from([-10, 0.1, 0.2, 0.9, 10]), 0, 1, 4);
    expect(bins.map((bin) => bin.count)).toEqual([3, 0, 0, 2]);
  });
});

// ---------------------------------------------------------------- the handler

const BAR_COUNT = 3000;
const FIVE_MINUTES = 300_000;
const sql: string[] = [];

function taggedRow(i: number) {
  const regime = Math.floor(i / 50) % 3;
  const noise = 0.0005 * Math.sin(i * 1.37) + 0.0003 * Math.cos(i * 0.21);
  return {
    timestamp_milliseconds: i * FIVE_MINUTES,
    net_return: (regime === 1 ? 0.001 : 0) + noise,
    close: 20000 + i,
    position_held: i % 2 ? 1 : -1,
    test_fold: Math.min(5, Math.floor(i / 500)),
    regime: i < 3 ? null : regime,
    shifted_regime: i < 3 ? null : (Math.floor((i + 5) / 50) % 3),
  };
}

const run = {
  regime_count: 3, symbol: "MNQ", window_start: "2024-03-01", window_end: "2025-12-01", fast_period: 5, slow_period: 100,
  fast_kind: "ema", slow_kind: "sma", fold_count: 6, embargo_bars: 100, feature_window_bars: 64, bootstrap_replicates: 2000,
  minimum_bars_for_bootstrap: 500, block_floor_bars: 390, leak_shift_rows: 25, seed: 0, cost_points_per_side: 0.70028,
  annualisation_bars_per_year: 70614.6, one_minute_rows: 15000, five_minute_rows: BAR_COUNT, feature_rows: 14990,
  labelled_one_minute_rows: 14990, net_return_bars: BAR_COUNT, tagged_bar_count: BAR_COUNT - 3, untagged_bar_count: 3,
  mean_transition_diagonal: 0.44, chance_transition_diagonal: 1 / 3, stickiness_check_passes: true, mean_walk_forward_sharpe: 1.5,
  walk_forward_sharpe_check_passes: true, leak_control_maximum_difference: 1e-5, leak_control_check_passes: true,
  resolved_regime_count: 3, resolved_regime_check_passes: true,
};

const fakeLake = (served: boolean): StudyLake => ({
  async query<T>(statement: string): Promise<T[]> {
    sql.push(statement);
    if (statement.includes("ASOF")) return Array.from({ length: BAR_COUNT }, (_, i) => taggedRow(i)) as T[];
    if (statement.includes(VIEWS.features_1m)) return [{ timestamp: 0, regime: 1, size: 0.1, flow: -0.2, log_range: 1, log_volume: 5, next_log_range: 1.1 }] as T[];
    if (statement.startsWith("SELECT regime_count FROM")) return [{ regime_count: 2 }, { regime_count: 3 }, { regime_count: 4 }] as T[];
    if (statement.includes(VIEWS.runs)) return [run] as T[];
    if (statement.includes(VIEWS.folds)) {
      return Array.from({ length: 6 }, (_, fold) => ({
        regime_count: 3, fold, train_end_index: fold * 500, train_bar_count: fold * 500, train_end_timestamp: fold * 500 * FIVE_MINUTES,
        test_start_index: fold * 500, test_end_index: fold * 500 + 500, test_bar_count: 500, test_start_timestamp: fold * 500 * FIVE_MINUTES,
        test_end_timestamp: (fold * 500 + 499) * FIVE_MINUTES, out_of_sample_sharpe: 1, out_of_sample_bar_count: 500,
        training_one_minute_rows: fold * 2500, transition_diagonal_mean: 0.44,
      })) as T[];
    }
    if (statement.includes(VIEWS.verdicts)) return [{ regime: 1, bar_count: 1000, verdict: "trade" }] as T[];
    if (statement.includes(VIEWS.gate)) return [{ trade_regimes: "1", status: "do_not_ship", baseline_sharpe: 1, gated_sharpe: 1.1 }] as T[];
    return [] as T[];
  },
  async hasView() {
    return served;
  },
  async columns() {
    return [];
  },
});

async function runHandler(query: Record<string, string>, served = true): Promise<{ body: RegimeGatedCrossoverBody; notes: string[] }> {
  const context: StudyContext = { lake: fakeLake(served), notes: [] };
  const body = await handler.run(handler.query.parse(query), context);
  return { body, notes: context.notes };
}

describe("regime-gated-crossover handler", () => {
  it("lists every landed view it reads", () => {
    expect(handler.datasets).toContain("derived_study_regime_gated_crossover_labels_1m");
    expect(handler.datasets).toHaveLength(10);
  });

  it("answers an empty body with a note when the study is not landed", async () => {
    const { body, notes } = await runHandler({}, false);
    expect(body.run).toBeNull();
    expect(body.live).toBeNull();
    expect(notes[0]).toContain("derived_study_regime_gated_crossover_runs");
  });

  it("re-tags with the offsets it was given and filters the one recipe", async () => {
    sql.length = 0;
    await runHandler({ regimeCount: "3", labelOffset: "-2", leakOffset: "25", blockFloor: "20", replicates: "300", seed: "4" });
    const asof = sql.find((statement) => statement.includes("ASOF")) ?? "";
    expect(asof).toContain("LAG(regime, 2)");
    expect(asof).toContain("LEAD(regime, 25)");
    expect(asof).toContain(`"recipe" = '${RECIPE}'`);
    expect(asof).toContain("regime_count = 3");
  });

  it("returns the record and recomputes verdicts and the gate", async () => {
    const { body } = await runHandler({ regimeCount: "3", blockFloor: "20", replicates: "300", minimumBars: "200" });
    expect(body.regimeCounts).toEqual([2, 3, 4]);
    expect(body.record.gate?.status).toBe("do_not_ship");
    expect(body.folds).toHaveLength(6);
    const live = body.live;
    expect(live?.settings.untaggedBarCount).toBe(3);
    expect(live?.regimes.map((regime) => regime.regime)).toEqual([0, 1, 2]);
    expect(live?.regimes.find((regime) => regime.regime === 1)?.verdict).toBe("trade");
    expect(live?.regimes.find((regime) => regime.regime === 0)?.verdict).toBe("sit_out");
    expect(live?.regimes[0]?.histogram).toHaveLength(40);
    expect(live?.gate?.tradeRegimes).toEqual([1]);
    expect(live?.gate?.source).toBe("verdicts");
    expect(live?.gate?.folds).toHaveLength(6);
    expect(live?.equity.length).toBeGreaterThan(10);
    expect(body.bars.length).toBeGreaterThan(50);
    expect(body.features).toHaveLength(1);
  });

  it("scores a held-out gate only on bars after the split and decides verdicts before it", async () => {
    const { body } = await runHandler({ regimeCount: "3", blockFloor: "20", replicates: "300", minimumBars: "200", scope: "heldout", splitFold: "3" });
    expect(body.live?.settings.splitTimestamp).toBe(1500 * FIVE_MINUTES);
    expect(body.live?.settings.verdictBarCount).toBe(1500 - 3);
    expect(body.live?.gate?.scoredBarCount).toBe(1500);
    expect(body.live?.gate?.folds.map((fold) => fold.fold)).toEqual([3, 4, 5]);
  });

  it("a chosen gate replaces the verdicts' trade set", async () => {
    const { body } = await runHandler({ regimeCount: "3", blockFloor: "20", replicates: "300", gate: "0,2" });
    expect(body.live?.gate?.tradeRegimes).toEqual([0, 2]);
    expect(body.live?.gate?.source).toBe("chosen");
  });
});

describe("regime-gated-crossover through the router", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use("/api", createStudiesRouter([handler as unknown as StudyHandler], fakeLake(true)));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => {
    server.close();
  });

  it("refuses a gate that is not a list of regimes", async () => {
    expect((await fetch(`${base}/studies/regime-gated-crossover?gate=1;DROP`)).status).toBe(400);
    expect((await fetch(`${base}/studies/regime-gated-crossover?regimeCount=9`)).status).toBe(400);
  });
});
