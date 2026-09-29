/**
 * `src/shared/analytics/compute.ts` — the four analytics layers.
 *
 * The properties that make the numbers trustworthy: trailing statistics are
 * causal (a bar's state does not change when later bars are added), session
 * gaps stay out of distributions and forward windows, news is named a cause
 * only when its tone matches the move, and the prescription stays flat when
 * no side beats its costs.
 */
import { describe, expect, it } from "vitest";
import {
  actionOutcome,
  analyse,
  buildFrame,
  forwardSamples,
  isSessionOpen,
  newsBetween,
  pickRun,
  prescribe,
  sessionDay,
  wilson,
} from "../../src/shared/analytics/compute";
import type { AnalyticsBar, AnalyticsCost, AnalyticsNewsItem, ModelRunSummary } from "../../src/shared/analytics/types";

const MINUTE = 60_000;
const START = Date.UTC(2025, 10, 3, 7, 0); // a Monday

/** A deterministic random walk on a 5-minute grid, with an optional hole. */
function walk(count: number, options: { gapAt?: number; gapMinutes?: number; seed?: number } = {}): AnalyticsBar[] {
  let state = options.seed ?? 7;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const bars: AnalyticsBar[] = [];
  let close = 20_000;
  let time = START;
  for (let i = 0; i < count; i += 1) {
    if (i === options.gapAt) time += (options.gapMinutes ?? 600) * MINUTE;
    const open = close;
    close = open + (random() - 0.5) * 8;
    bars.push({ timestamp: time, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 100 + Math.floor(random() * 50) });
    time += 5 * MINUTE;
  }
  return bars;
}

const COST: AnalyticsCost = { pointValueUsd: 2, roundTripCostUsd: 2.78, roundTripCostPoints: 1.39, tickSize: 0.25, source: "test" };

describe("wilson", () => {
  it("brackets the proportion and stays inside [0, 1]", () => {
    const p = wilson(50, 100);
    expect(p.value).toBe(0.5);
    expect(p.low!).toBeLessThan(0.5);
    expect(p.high!).toBeGreaterThan(0.5);
    expect(wilson(0, 10).low).toBeGreaterThanOrEqual(0);
    expect(wilson(10, 10).high).toBeLessThanOrEqual(1);
    expect(wilson(0, 0).value).toBeNull();
  });

  it("widens to the independent evidence when windows overlap", () => {
    const naive = wilson(525, 1000);
    const honest = wilson(525, 1000, 1000 / 12);
    expect(honest.value).toBe(naive.value);
    expect((honest.high! - honest.low!) / (naive.high! - naive.low!)).toBeGreaterThan(3);
    expect(honest.effectiveTotal).toBeCloseTo(83.33, 1);
  });
});

describe("the per-bar frame", () => {
  it("is causal: a bar's z-score, volatility and trend do not change when later bars arrive", () => {
    const bars = walk(1500);
    const short = buildFrame(bars.slice(0, 900));
    const long = buildFrame(bars);
    for (let i = 0; i < 900; i += 1) {
      expect(long.zScore[i]).toBe(short.zScore[i]);
      expect(long.volatility[i]).toBe(short.volatility[i]);
      expect(long.trend[i]).toBe(short.trend[i]);
    }
  });

  it("leaves warm-up rows unknown, never zero", () => {
    const frame = buildFrame(walk(700));
    expect(frame.zScore.slice(0, 100).every((value) => value === null)).toBe(true);
    expect(frame.volatility[10]).toBeNull();
    expect(frame.trend[10]).toBeNull();
  });

  it("flags the return across a session gap and keeps it out of forward windows", () => {
    const frame = buildFrame(walk(1000, { gapAt: 600, gapMinutes: 900 }));
    expect(frame.gapBefore[600]).toBe(true);
    expect(frame.gapMinutes[600]).toBeCloseTo(905, 0);
    const horizon = 10;
    const samples = forwardSamples(frame, horizon);
    // bars 590..599 would cross the gap; they are dropped
    expect(samples.length).toBe(1000 - horizon - horizon);
  });
});

describe("news", () => {
  const news: AnalyticsNewsItem[] = [
    { articleId: "a", title: "a", seenAt: 1000, score: 0.5 },
    { articleId: "b", title: "b", seenAt: 2000, score: -0.5 },
    { articleId: "c", title: "c", seenAt: 3000, score: null },
  ];
  it("finds articles in a half-open window (from, to]", () => {
    expect(newsBetween(news, 1000, 3000).map((item) => item.articleId)).toEqual(["b", "c"]);
    expect(newsBetween(news, 0, 999)).toEqual([]);
  });

  it("is named the cause of a move only when its tone matches the move", () => {
    const bars = walk(400, { seed: 3 });
    // a clean 6-sigma jump up at bar 300
    const jump = 150;
    for (let i = 300; i < bars.length; i += 1) {
      const bar = bars[i] as AnalyticsBar;
      bars[i] = { ...bar, open: bar.open + jump, high: bar.high + jump, low: bar.low + jump, close: bar.close + jump };
    }
    const at = (bars[300] as AnalyticsBar).timestamp;
    const against = analyse({ bars, news: [{ articleId: "x", title: "bad", seenAt: at - 10 * MINUTE, score: -0.8 }], runs: [], details: new Map(), latestDetail: null, cost: COST, assetClass: "futures", horizon: 6 });
    const withIt = analyse({ bars, news: [{ articleId: "x", title: "good", seenAt: at - 10 * MINUTE, score: 0.8 }], runs: [], details: new Map(), latestDetail: null, cost: COST, assetClass: "futures", horizon: 6 });
    const eventAgainst = against.diagnostic.largestMoves.find((event) => event.timestamp === at);
    const eventWith = withIt.diagnostic.largestMoves.find((event) => event.timestamp === at);
    expect(eventAgainst?.cause).not.toBe("news");
    expect(eventAgainst?.evidence.join(" ")).toContain("opposite to the move");
    expect(eventWith?.cause).toBe("news");
  });

  it("never credits a move to news known after the bar closed", () => {
    const bars = walk(400, { seed: 3 });
    const jump = 150;
    for (let i = 300; i < bars.length; i += 1) {
      const bar = bars[i] as AnalyticsBar;
      bars[i] = { ...bar, open: bar.open + jump, high: bar.high + jump, low: bar.low + jump, close: bar.close + jump };
    }
    const at = (bars[300] as AnalyticsBar).timestamp;
    const late = analyse({ bars, news: [{ articleId: "x", title: "late", seenAt: at + 5 * MINUTE, score: 0.9 }], runs: [], details: new Map(), latestDetail: null, cost: COST, assetClass: "futures", horizon: 6 });
    const event = late.diagnostic.largestMoves.find((row) => row.timestamp === at);
    expect(event?.newsCount).toBe(0);
    expect(event?.cause).not.toBe("news");
  });

  it("compares bars after news only with bars inside the span the news record covers", () => {
    const bars = walk(2000);
    const first = (bars[500] as AnalyticsBar).timestamp;
    const news: AnalyticsNewsItem[] = [
      { articleId: "a", title: "a", seenAt: first, score: 0.1 },
      { articleId: "b", title: "b", seenAt: first + 100 * 5 * MINUTE, score: 0.1 },
    ];
    const result = analyse({ bars, news, runs: [], details: new Map(), latestDetail: null, cost: COST, assetClass: "futures", horizon: 6 });
    // 100 bars between the two articles plus the 60-minute tail: nowhere near all 2,000
    expect(result.diagnostic.newsEffect.coveredBarCount).toBeLessThanOrEqual(115);
    // ...and too few on each side for a ratio: none is given, and the page says why
    expect(result.diagnostic.newsEffect.ratio).toBeNull();
    expect(result.diagnostic.newsEffect.note).toContain("Too few bars");
  });
});

describe("session gaps and opens across timeframes", () => {
  it("treats the hour-long CME break as a gap on 1h bars", () => {
    const hour = 60 * MINUTE;
    const hourly: AnalyticsBar[] = Array.from({ length: 200 }, (_, i) => ({ timestamp: START + i * hour, open: 1, high: 1, low: 1, close: 1 + i, volume: 1 }));
    hourly.splice(100, 1); // one missing hour, as the break leaves
    const frame = buildFrame(hourly);
    expect(frame.gapBefore[100]).toBe(true);
    expect(frame.gapBefore[101]).toBe(false);
  });

  it("credits the cash open to the bar that contains it, at any intraday timeframe", () => {
    expect(isSessionOpen(Date.UTC(2025, 10, 4, 6, 30), "futures", 5 * MINUTE)).toBe(true);
    expect(isSessionOpen(Date.UTC(2025, 10, 4, 6, 0), "futures", 60 * MINUTE)).toBe(true); // 06:00-07:00 contains 06:30
    expect(isSessionOpen(Date.UTC(2025, 10, 4, 7, 0), "futures", 60 * MINUTE)).toBe(false);
    expect(isSessionOpen(Date.UTC(2025, 10, 4, 0, 0), "futures", 86_400_000)).toBe(false); // a daily bar holds every open
    // London opens 08:00 local: 07:00 UTC in summer, 08:00 UTC in winter
    expect(isSessionOpen(Date.UTC(2025, 6, 1, 7, 0), "forex", 5 * MINUTE)).toBe(true);
    expect(isSessionOpen(Date.UTC(2025, 11, 1, 8, 0), "forex", 5 * MINUTE)).toBe(true);
    expect(isSessionOpen(Date.UTC(2025, 11, 1, 7, 0), "forex", 5 * MINUTE)).toBe(false);
  });
});

describe("session days", () => {
  it("puts a futures bar after 15:00 Pacific on the next trading date and a weekend on Monday", () => {
    expect(sessionDay(Date.UTC(2025, 10, 4, 15, 30), "futures")).toBe("2025-11-05");
    expect(sessionDay(Date.UTC(2025, 10, 9, 15, 0), "futures")).toBe("2025-11-10"); // Sunday reopen
    expect(sessionDay(Date.UTC(2025, 10, 4, 23, 0), "forex")).toBe("2025-11-04");
  });
});

describe("prescription", () => {
  it("prices a trade after the round trip and stays flat when neither side beats it", () => {
    const moves = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 1 : -1)); // no edge, 1 point either way
    const long = actionOutcome("long", moves, COST);
    expect(long.expectedNetPoints).toBeCloseTo(-1.39, 6);
    expect(long.expectedNetUsd).toBeCloseTo(-2.78, 6);
    const result = prescribe(moves, 12, COST, [], new Map());
    expect(result.recommendations.every((row) => row.action === "flat")).toBe(true);
  });

  it("recommends no trade when the symbol has no cost model", () => {
    const moves = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? -0.0004 : 0.0006));
    const result = prescribe(moves, 12, null, [], new Map());
    expect(result.costPriced).toBe(false);
    expect(result.recommendations.every((row) => row.action === "flat")).toBe(true);
    expect(result.recommendations[0]?.reason).toContain("No cost model");
  });

  it("recommends the side with the edge", () => {
    const moves = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? -4 : 6)); // mostly up, well past costs
    const result = prescribe(moves, 12, COST, [], new Map());
    expect(result.recommendations.find((row) => row.goal === "profit")?.action).toBe("long");
    expect(result.recommendations.find((row) => row.goal === "win_rate")?.action).toBe("long");
    const long = result.actions.find((row) => row.action === "long");
    expect(long?.kellyFraction).toBeGreaterThan(0);
    expect(long?.kellyFraction).toBeLessThanOrEqual(0.25);
  });

  it("picks the run that best serves each goal", () => {
    const base = { recipe: "r", modelLabel: "m", timeframe: "5m", status: "complete", startedAt: 0, accuracy: null, sharpeRatio: null, tradeCount: 50 };
    const runs: ModelRunSummary[] = [
      { ...base, modelId: "a", recipe: "a", netProfitUsd: 100, winRate: 0.4, maximumDrawdownUsd: 200 },
      { ...base, modelId: "b", recipe: "b", netProfitUsd: 50, winRate: 0.7, maximumDrawdownUsd: 20 },
      // three lucky trades win every ranking unless runs need 20+ trades
      { ...base, modelId: "lucky", recipe: "lucky", netProfitUsd: 900, winRate: 1, maximumDrawdownUsd: 1, tradeCount: 3 },
    ];
    expect(pickRun(runs, "profit")?.run.modelId).toBe("a");
    expect(pickRun(runs, "win_rate")?.run.modelId).toBe("b");
    expect(pickRun(runs, "risk")?.run.modelId).toBe("b");
  });
});

describe("the four layers together", () => {
  it("describes the window and summarises every column with all eight numbers", () => {
    const bars = walk(3000);
    const result = analyse({ bars, news: [], runs: [], details: new Map(), latestDetail: null, cost: COST, assetClass: "futures", horizon: 12 });
    expect(result.descriptive.barCount).toBe(3000);
    expect(result.descriptive.returnPercent.count).toBe(2999);
    expect(result.descriptive.returnPercent.kurtosis).not.toBeNull();
    expect(result.predictive.unconditional.sampleCount).toBe(3000 - 12);
    expect(result.predictive.unconditional.probabilityUp.effectiveTotal).toBeCloseTo((3000 - 12) / 12, 6);
    expect(result.prescriptive.asOf).toBe((bars[bars.length - 1] as AnalyticsBar).timestamp);
    expect(result.predictive.byState.reduce((sum, row) => sum + row.sampleCount, 0)).toBeLessThanOrEqual(3000 - 12);
    expect(result.prescriptive.actions.map((row) => row.action)).toEqual(["long", "short", "flat"]);
  });
});
