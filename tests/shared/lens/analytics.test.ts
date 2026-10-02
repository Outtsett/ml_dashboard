/**
 * The Model Lens analytics (packages/shared/src/lens/analytics.ts) against real records.
 *
 * Both committed fixtures are real models: the daily MNQ XGBoost direction
 * classifier (its trainer's diagnostics.json holds 78 trades, 47 long and 31
 * short, +$15,972.60) and a 5-minute Model Cycle run. Each is evaluated by the
 * shared compute, its whole record is laid out as bars exactly as GET /bars
 * serves them, and the analytics are checked two ways: against the model's own
 * recorded numbers where one exists, and against the definition each number
 * claims (break-even rate, calibration error, Kelly, the threshold search),
 * recomputed here by hand from the same trades.
 */

import { describe, expect, it } from "vitest";
import { OverlaySetSchema } from "@shared/chartLink";
import {
  ANALYTICS_KELLY_CAP,
  ANALYTICS_KELLY_FRACTION,
  ANALYTICS_MINIMUM_SEGMENT_TRADES,
  ANALYTICS_THRESHOLD_GRID,
  buildLensChartOverlaySet,
  computeLensAnalytics,
  describeAge,
  lensChartSource,
  lensChartTrades,
  seriesFromBars,
  trueUtcSeconds,
} from "@shared/lens/analytics";
import {
  buildBarWindow,
  clampLensParams,
  evaluateLens,
  simulateTrades,
  resolveRange,
  type LensBar,
  type LensEvaluation,
  type LensTrade,
  type LensManifest,
  type LensSeries,
} from "@shared/lens/index";
import {
  CYCLE_RUN_FIXTURE,
  DAILY_CLASSIFIER_FIXTURE,
  loadLensManifest,
  loadLensSeries,
  readClassifierDiagnostics,
} from "./load";

interface Loaded {
  manifest: LensManifest;
  series: LensSeries;
  evaluation: LensEvaluation;
  bars: LensBar[];
}

async function load(directory: string): Promise<Loaded> {
  const manifest = loadLensManifest(directory);
  const series = await loadLensSeries(directory, manifest);
  const params = clampLensParams({}, manifest);
  const evaluation = evaluateLens(series, null, manifest, params);
  const bars = buildBarWindow(series, null, manifest, params, { startRowIndex: 0, endRowIndex: manifest.barCount - 1 }, 5000).bars;
  return { manifest, series, evaluation, bars };
}

/** A clock far past the record, so the latest prediction is old. */
const LATE_NOW_SECONDS = Date.UTC(2026, 8, 29) / 1000;

describe("lens analytics — daily XGBoost direction classifier (committed fixture)", () => {
  it("rebuilds the record from its bars and re-simulates exactly the evaluator's trades", async () => {
    const { manifest, series, evaluation, bars } = await load(DAILY_CLASSIFIER_FIXTURE);
    const rebuilt = seriesFromBars(bars, manifest) as LensSeries;
    expect(rebuilt).not.toBeNull();
    const range = resolveRange(rebuilt, evaluation.params);
    const original = simulateTrades(series, evaluation.params, resolveRange(series, evaluation.params)).trades;
    const again = simulateTrades(rebuilt, evaluation.params, range).trades;
    expect(again.map((trade) => trade.netUsd)).toEqual(original.map((trade) => trade.netUsd));

    const analytics = computeLensAnalytics({ evaluation, manifest, bars, nowSeconds: LATE_NOW_SECONDS });
    expect(analytics.happened.tradesBasis).toBe("all 78 trades, re-simulated over every bar with the lens rule");
    // A partial record is refused rather than silently moving every row-level number.
    expect(seriesFromBars(bars.slice(1), manifest)).toBeNull();
  });

  it("What happened: the sentence, the eight numbers and the sides are the model's own record", async () => {
    const { manifest, evaluation, bars } = await load(DAILY_CLASSIFIER_FIXTURE);
    const diagnostics = readClassifierDiagnostics(DAILY_CLASSIFIER_FIXTURE);
    const recorded = diagnostics.pnl_curve.trade_pnl_dollars;
    const recordedTotal = recorded.reduce((sum, net) => sum + net, 0);
    const analytics = computeLensAnalytics({ evaluation, manifest, bars, nowSeconds: LATE_NOW_SECONDS });
    const happened = analytics.happened;

    expect(happened.summarySentence).toContain(
      `Over 427 test bars the model took ${recorded.length} trades and made $${recordedTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} after costs`,
    );
    expect(happened.summarySentence).toContain("after costs of 5.6 ticks per round trip is above the 42.9% it needed to break even");

    // Break-even: p* = (average gross loss + cost) / (average gross win + average gross loss).
    const trades = lensChartTrades({ evaluation, manifest, bars });
    const cost = manifest.cost.roundTripPoints * manifest.cost.pointValueUsd;
    const right = trades.filter((trade) => trade.grossUsd > 0);
    const wrong = trades.filter((trade) => trade.grossUsd <= 0);
    const averageWin = right.reduce((sum, trade) => sum + trade.grossUsd, 0) / right.length;
    const averageLoss = wrong.reduce((sum, trade) => sum - trade.grossUsd, 0) / wrong.length;
    expect(happened.breakEvenHitRate).toBeCloseTo((averageLoss + cost) / (averageWin + averageLoss), 12);
    expect(happened.directionRight?.value).toBeCloseTo(right.length / trades.length, 12);

    expect(happened.tradeNetSummary.count).toBe(recorded.length);
    expect(happened.tradeNetSummary.mean).toBeCloseTo(recordedTotal / recorded.length, 6);
    expect(happened.tradeNetSummary.minimum).toBeCloseTo(Math.min(...recorded), 6);
    expect(happened.tradeNetSummary.maximum).toBeCloseTo(Math.max(...recorded), 6);
    expect(happened.tradeNetSummary.kurtosis).not.toBeNull();
    expect(happened.tradeNetHistogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(recorded.length);

    const [long, short] = happened.sides;
    expect(long?.tradeCount).toBe(diagnostics.pnl_curve.n_long);
    expect(short?.tradeCount).toBe(diagnostics.pnl_curve.n_short);
    expect((long?.totalNetUsd ?? 0) + (short?.totalNetUsd ?? 0)).toBeCloseTo(recordedTotal, 6);
    for (const side of happened.sides) {
      expect(side.winRate?.low ?? 0).toBeLessThanOrEqual(side.winRate?.value ?? 0);
      expect(side.winRate?.high ?? 1).toBeGreaterThanOrEqual(side.winRate?.value ?? 1);
    }

    // The drawdown walks every bar and lands on the headline's figure, with dates.
    expect(happened.drawdown.maximumDrawdownUsd).toBeCloseTo(evaluation.headline.maxDrawdownUsd, 9);
    expect(happened.drawdown.troughTimestampSeconds).not.toBeNull();
    expect(happened.drawdown.sentence).toMatch(/^The deepest drawdown was -\$[\d,]+\.\d\d, from a peak on \d{4}-\d\d-\d\d to a trough on \d{4}-\d\d-\d\d/);
    expect(happened.equity.differenceUsd).toBeCloseTo(evaluation.headline.totalNetUsd - (evaluation.headline.buyHoldNetUsd as number), 9);
  });

  it("Why: deciles, calibration and loss causes follow their stated definitions", async () => {
    const { manifest, evaluation, bars } = await load(DAILY_CLASSIFIER_FIXTURE);
    const why = computeLensAnalytics({ evaluation, manifest, bars, nowSeconds: LATE_NOW_SECONDS }).why;

    expect(why.byHour.segments).toHaveLength(0);
    expect(why.byHour.reason).toBe("each bar is a whole day, so the hour of the session does not apply");

    const labelled = bars.filter((bar) => bar.label !== null && bar.probabilityUp !== null).length;
    expect(why.byConfidence.deciles).toHaveLength(10);
    expect(why.byConfidence.deciles.reduce((sum, decile) => sum + decile.rowCount, 0)).toBe(labelled);
    for (const decile of why.byConfidence.deciles) {
      expect(decile.probabilityLow).toBeLessThanOrEqual(decile.probabilityHigh);
      if (decile.directionHitRate === null) expect(decile.reason).toMatch(/independent outcomes/);
    }

    const reliability = evaluation.scatter.reliability;
    const total = reliability.reduce((sum, bin) => sum + bin.count, 0);
    const expected = reliability.reduce(
      (sum, bin) => (bin.count > 0 ? sum + (bin.count / total) * Math.abs((bin.meanProbability as number) - (bin.observedUpRate as number)) : sum),
      0,
    );
    expect(why.calibration.expectedCalibrationError).toBeCloseTo(expected, 12);

    expect(why.lossCauses.length).toBeGreaterThan(0);
    expect(why.lossCauses.length).toBeLessThanOrEqual(3);
    for (let index = 1; index < why.lossCauses.length; index += 1) {
      expect(why.lossCauses[index - 1]?.lossUsd ?? 0).toBeGreaterThanOrEqual(why.lossCauses[index]?.lossUsd ?? 0);
    }
    const costs = why.lossCauses.find((cause) => cause.cause === "costs");
    expect(costs?.lossUsd).toBeCloseTo(78 * 2.8, 9);
    for (const cause of why.lossCauses) {
      expect(cause.sampleSize).toBeGreaterThanOrEqual(ANALYTICS_MINIMUM_SEGMENT_TRADES);
      expect(cause.sentence).toMatch(/\$[\d,]+\.\d\d/);
    }
    // Regime rows reuse regime.ts and hide a mean resting on fewer than the minimum trades.
    for (const row of why.byRegime.rows) {
      if (row.tradeCount < ANALYTICS_MINIMUM_SEGMENT_TRADES) {
        expect(row.meanTradeNetUsd).toBeNull();
        expect(row.meanReason).toContain(`only ${row.tradeCount} trade`);
      }
    }
  });

  it("What comes next: the last bar with a probability, its interval, its age", async () => {
    const { manifest, evaluation, bars } = await load(DAILY_CLASSIFIER_FIXTURE);
    const lastPredicted = [...bars].reverse().find((bar) => bar.probabilityUp !== null) as LensBar;
    const old = computeLensAnalytics({ evaluation, manifest, bars, nowSeconds: LATE_NOW_SECONDS }).next;
    expect(old.latest?.rowIndex).toBe(lastPredicted.rowIndex);
    expect(old.latest?.probabilityUp).toBeCloseTo(lastPredicted.probabilityUp as number, 12);
    expect(old.latest?.isOld).toBe(true);
    // Futures stamps are Pacific wall clock: the age is measured from the true-UTC instant (8 h later in December).
    expect(old.latest?.ageSeconds).toBeCloseTo(LATE_NOW_SECONDS - trueUtcSeconds(lastPredicted.timestampSeconds, "futures"), 6);
    expect(trueUtcSeconds(lastPredicted.timestampSeconds, "futures") - lastPredicted.timestampSeconds).toBe(8 * 3600);
    // The record holds the bar 5 rows after the last prediction, so it resolved inside the record.
    expect(old.sentences[0]).toContain(
      `(${describeAge(LATE_NOW_SECONDS - trueUtcSeconds(lastPredicted.timestampSeconds, "futures"))} ago; the record already holds the bar 5 bars later`,
    );
    if (lastPredicted.predictedQuantilesBasisPoints) {
      const quantiles = lastPredicted.predictedQuantilesBasisPoints;
      expect(old.interval?.lowerBasisPoints).toBeCloseTo(quantiles[0] as number, 5);
      expect(old.interval?.upperBasisPoints).toBeCloseTo(quantiles[6] as number, 5);
      expect(old.interval?.lowerPrice).toBeCloseTo(lastPredicted.close * Math.exp((quantiles[0] as number) / 1e4), 6);
    } else {
      expect(old.interval).toBeNull();
      expect(old.intervalReason).toMatch(/no conformal interval/);
    }

    // A minute after the bar, but the record already holds the bar 5 rows later: resolved, whatever the clock says.
    const resolvedNow = trueUtcSeconds(lastPredicted.timestampSeconds, "futures") + 60;
    const resolved = computeLensAnalytics({ evaluation, manifest, bars, nowSeconds: resolvedNow }).next;
    expect(resolved.latest?.isOld).toBe(true);
    expect(resolved.latest?.ageText).toBe("60 seconds");

    // Blank the probabilities after an earlier row so the bar horizon rows later is not in the record:
    // a minute after it (true UTC), the forecast may still be live.
    const liveIndex = bars.length - 3;
    const blanked = bars.map((bar, index) =>
      index > liveIndex ? { ...bar, probabilityUp: null } : index === liveIndex ? { ...bar, probabilityUp: 0.3 } : bar,
    );
    const liveBar = blanked[liveIndex] as LensBar;
    const fresh = computeLensAnalytics({
      evaluation,
      manifest,
      bars: blanked,
      nowSeconds: trueUtcSeconds(liveBar.timestampSeconds, "futures") + 60,
    }).next;
    expect(fresh.latest?.rowIndex).toBe(liveBar.rowIndex);
    expect(fresh.latest?.isOld).toBe(false);
    expect(fresh.latest?.ageText).toBe("60 seconds");
    expect(fresh.sentences[0]).toContain("possibly still inside the 5-bar horizon");
  });

  it("What comes next: the drift alarm is on only when its last firing is inside the rolling trade window", async () => {
    const { manifest, evaluation, bars } = await load(DAILY_CLASSIFIER_FIXTURE);
    const tradeCount = evaluation.headline.tradeCount;
    const withAlarm = (tradeIndex: number): LensEvaluation => ({
      ...evaluation,
      rolling: {
        ...evaluation.rolling,
        drift: { ...evaluation.rolling.drift, alarms: [{ timestampSeconds: 0, tradeIndex, statistic: 1, direction: "deterioration" }] },
      },
    });
    const recent = computeLensAnalytics({ evaluation: withAlarm(tradeCount - 1), manifest, bars, nowSeconds: LATE_NOW_SECONDS });
    expect(recent.next.drift.alarmOn).toBe(true);
    expect(recent.toDo.recommendation.rules.find((rule) => rule.name === "drift_alarm")?.triggered).toBe(true);
    const window = evaluation.rolling.windowTrades;
    const early = computeLensAnalytics({ evaluation: withAlarm(tradeCount - 1 - window), manifest, bars, nowSeconds: LATE_NOW_SECONDS });
    expect(early.next.drift.alarmOn).toBe(false);
    expect(early.next.drift.tradesSinceLastAlarm).toBe(window);
  });

  it("What to do: the threshold search, conviction buckets, Kelly and the rules", async () => {
    const { manifest, series, evaluation, bars } = await load(DAILY_CLASSIFIER_FIXTURE);
    const toDo = computeLensAnalytics({ evaluation, manifest, bars, nowSeconds: LATE_NOW_SECONDS }).toDo;
    const search = toDo.thresholdSearch;
    expect(search.grid.map((point) => point.threshold)).toEqual([...ANALYTICS_THRESHOLD_GRID]);
    const current = search.grid.find((point) => point.threshold === 0.55);
    expect(current?.tradeCount).toBe(evaluation.headline.tradeCount);
    expect(current?.totalNetUsd).toBeCloseTo(evaluation.headline.totalNetUsd, 6);
    const eligible = search.grid.filter((point) => point.tradeCount >= ANALYTICS_MINIMUM_SEGMENT_TRADES);
    const bestMean = Math.max(...eligible.map((point) => point.meanTradeNetUsd as number));
    expect(search.best?.meanTradeNetUsd.value).toBeCloseTo(bestMean, 9);
    const bestTrades = simulateTrades(series, { ...evaluation.params, threshold: search.best?.threshold as number }, resolveRange(series, evaluation.params)).trades;
    expect(search.best?.meanTradeNetUsd.n).toBe(bestTrades.length);
    expect(search.best?.meanTradeNetUsd.ciLow ?? Infinity).toBeLessThanOrEqual(bestMean);
    expect(search.best?.meanTradeNetUsd.ciHigh ?? -Infinity).toBeGreaterThanOrEqual(bestMean);
    expect(search.warning).toMatch(/^Chosen on the same rows it is scored on/);

    const bucketRows = toDo.convictionBuckets.buckets.reduce((sum, bucket) => sum + bucket.rowCount, 0);
    const predictedWithForward = bars.filter((bar, index) => bar.probabilityUp !== null && index + manifest.horizonBars < bars.length).length;
    expect(bucketRows).toBe(predictedWithForward);
    for (const bucket of toDo.convictionBuckets.buckets) {
      if (bucket.meanNetUsd === null) expect(bucket.reason).not.toBeNull();
    }

    const kelly = toDo.kelly;
    const p = kelly.winShare as number;
    const b = kelly.payoffRatio as number;
    expect(kelly.fullKellyFraction).toBeCloseTo(p - (1 - p) / b, 12);
    expect(kelly.suggestedFraction).toBeCloseTo(Math.min(ANALYTICS_KELLY_CAP, Math.max(0, (p - (1 - p) / b) * ANALYTICS_KELLY_FRACTION)), 12);

    const rules = toDo.recommendation.rules;
    expect(rules.map((rule) => rule.name)).toEqual([
      "record_loaded",
      "enough_trades",
      "edge_negative",
      "edge_unproven",
      "signal_expired",
      "signal_below_threshold",
      "drift_alarm",
      "kelly_not_positive",
    ]);
    const deciding = rules.find((rule) => rule.triggered);
    expect(toDo.recommendation.decidingRule).toBe(deciding?.name ?? "none");
    expect(toDo.recommendation.verdict).toBe(deciding?.verdictWhenTriggered ?? "trade");
    // Every trade here is old: whatever the edge, the current signal has expired.
    expect(rules.find((rule) => rule.name === "signal_expired")?.triggered).toBe(true);
    expect(toDo.recommendation.verdict).not.toBe("trade");
  });

  it("without the bars every row-level view gives its reason instead of a value", async () => {
    const { manifest, evaluation } = await load(DAILY_CLASSIFIER_FIXTURE);
    const analytics = computeLensAnalytics({ evaluation, manifest, bars: null, barsReason: "still loading", nowSeconds: LATE_NOW_SECONDS });
    expect(analytics.recordNote).toBe("still loading");
    expect(analytics.happened.tradesBasis).toBe("the evaluation's 78 trades");
    expect(analytics.happened.sides[0]?.directionHitRate).toBeNull();
    expect(analytics.happened.sides[0]?.directionReason).toBe("still loading");
    expect(analytics.next.available).toBe(false);
    expect(analytics.next.sentences[0]).toBe("The latest prediction is not stated: still loading.");
    expect(analytics.toDo.thresholdSearch.reason).toBe("still loading");
    expect(analytics.toDo.recommendation.verdict).toBe("gather_more_data");
    expect(analytics.toDo.recommendation.decidingRule).toBe("record_loaded");
    // The trade-level numbers do not need the bars and are still stated.
    expect(analytics.happened.tradeNetSummary.count).toBe(78);
    expect(analytics.happened.drawdown.basis).toMatch(/equity points/);
  });

  it("without the bars, a transport-capped trade list feeds no trade statistic (the headline totals are never mixed with a subset)", async () => {
    const { manifest, evaluation } = await load(DAILY_CLASSIFIER_FIXTURE);
    const capped: LensEvaluation = {
      ...evaluation,
      trades: [...evaluation.trades.slice(0, 10), ...evaluation.trades.slice(-10)],
      tradesTruncated: true,
    };
    const analytics = computeLensAnalytics({ evaluation: capped, manifest, bars: null, barsReason: "the record has more than 60,000 bars", nowSeconds: LATE_NOW_SECONDS });
    expect(analytics.happened.tradesBasis).toMatch(/capped at 20 of 78 for transport/);
    expect(analytics.happened.summarySentence).toMatch(/^Over \d[\d,]* test bars the model took 78 trades and (made|lost) .* how often it was right is not stated/);
    expect(analytics.happened.summarySentence).not.toMatch(/right \d/);
    expect(analytics.happened.tradeNetSummary.count).toBe(0);
    expect(analytics.toDo.kelly.suggestedFraction).toBeNull();
    expect(analytics.toDo.kelly.reason).toMatch(/only 0 trades/);
  });

  it("marks one common window of the latest trades on the chart, so every entry keeps its exit", () => {
    const base = { entryRowIndex: 0, exitRowIndex: 1, entryPrice: 1, exitPrice: 1, probabilityUp: 0.6, grossUsd: 0, netUsd: 0, cumulativeNetUsd: 0, regime: null };
    const trades = Array.from({ length: 6000 }, (_, index) => ({
      ...base,
      direction: index % 3 === 0 ? -1 : 1,
      entryTimestampSeconds: 1_700_000_000 + index * 600,
      exitTimestampSeconds: 1_700_000_000 + index * 600 + 300,
    })) as unknown as LensTrade[];
    const set = buildLensChartOverlaySet("probe", { symbol: "MNQ", timeframe: "5m" }, trades, {
      firstTimestampSeconds: 1_700_000_000,
      lastTimestampSeconds: 1_700_000_000 + 6000 * 600,
    });
    const markerTimes = (id: string) => {
      const overlay = set.overlays.find((entry) => entry.id === id);
      return overlay && overlay.kind === "marker" ? overlay.markers.map((marker) => marker.time) : [];
    };
    const entries = [...markerTimes("long_entries"), ...markerTimes("short_entries")].sort((a, b) => a - b);
    const exits = markerTimes("exits");
    expect(entries.length).toBe(2000);
    expect(exits.length).toBe(2000);
    expect(entries[0]).toBe((trades[4000]?.entryTimestampSeconds as number) * 1000);
    expect(Math.min(...exits)).toBe((trades[4000]?.exitTimestampSeconds as number) * 1000);
  });

  it("builds a Market chart overlay the chart link accepts, for the model's own symbol and timeframe", async () => {
    const { manifest, evaluation, bars } = await load(DAILY_CLASSIFIER_FIXTURE);
    const trades = lensChartTrades({ evaluation, manifest, bars });
    const set = buildLensChartOverlaySet(manifest.modelId, manifest, trades, evaluation.range);
    expect(OverlaySetSchema.safeParse(set).success).toBe(true);
    expect(set.source).toBe(`model_lens:${manifest.modelId}`);
    expect(set.source).toBe(lensChartSource(manifest.modelId));
    expect(set.symbol).toBe("MNQ");
    expect(set.timeframe).toBe("1d");
    const zone = set.overlays.find((overlay) => overlay.kind === "zone");
    expect(zone && zone.kind === "zone" ? zone.zones[0] : null).toEqual({
      start: evaluation.range.firstTimestampSeconds * 1000,
      end: evaluation.range.lastTimestampSeconds * 1000,
      text: "lens test bars",
    });
    const longs = set.overlays.find((overlay) => overlay.id === "long_entries");
    const shorts = set.overlays.find((overlay) => overlay.id === "short_entries");
    expect(longs && longs.kind === "marker" ? longs.markers.length : 0).toBe(47);
    expect(shorts && shorts.kind === "marker" ? shorts.markers.length : 0).toBe(31);
    const firstLong = trades.find((trade) => trade.direction === 1);
    expect(longs && longs.kind === "marker" ? longs.markers[0]?.time : 0).toBe((firstLong?.entryTimestampSeconds as number) * 1000);
  });
});

describe("lens analytics — 5-minute Model Cycle run (committed fixture)", () => {
  it("groups by hour on the bars' own clock and gates every thin slice", async () => {
    const { manifest, evaluation, bars } = await load(CYCLE_RUN_FIXTURE);
    const analytics = computeLensAnalytics({ evaluation, manifest, bars, nowSeconds: LATE_NOW_SECONDS });
    expect(analytics.why.byHour.reason).toBeNull();
    expect(analytics.why.byHour.clock).toMatch(/Pacific/);
    const labelled = bars.filter((bar) => bar.label !== null && bar.probabilityUp !== null).length;
    expect(analytics.why.byHour.segments.reduce((sum, segment) => sum + segment.labelledRowCount, 0)).toBe(labelled);
    expect(analytics.why.byHour.segments.reduce((sum, segment) => sum + segment.tradeCount, 0)).toBe(evaluation.headline.tradeCount);
    for (const segment of [...analytics.why.byHour.segments, ...analytics.why.byWeekday.segments]) {
      if (segment.tradeCount < ANALYTICS_MINIMUM_SEGMENT_TRADES) {
        expect(segment.winRate).toBeNull();
        expect(segment.meanTradeNetUsd).toBeNull();
        expect(segment.tradeReason).toBe(`only ${segment.tradeCount} trade${segment.tradeCount === 1 ? "" : "s"}; at least 20 are needed`);
      }
      if (segment.directionHitRate === null) expect(segment.directionReason).not.toBeNull();
    }
    expect(analytics.happened.summarySentence).toMatch(/^Over 493 test bars the model took \d+ trades? and (made|lost)/);
    expect(analytics.why.attribution.available).toBe(evaluation.attribution.available);
    expect(analytics.toDo.kelly.reason ?? "").toMatch(evaluation.headline.tradeCount < 30 ? /only \d+ trades?; at least 30/ : /.*/);
  });
});
