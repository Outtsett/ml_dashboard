/**
 * Model Cycle chart — the pure half (`src/client/src/cycle/chartModel.ts`):
 * bar → series mapping, incremental render bookkeeping, fold/active bands,
 * trade markers, follow ranges, the crosshair readout, and a benchmark that
 * the per-chunk mapping cost does not grow with the bars already drawn.
 */
import { describe, expect, it } from "vitest";

import {
  appendBars,
  emptyBarColumns,
  type CycleBarColumns,
  type CycleBars,
  type CycleCursor,
  type CyclePlan,
  type CycleTrade,
} from "@shared/cycle/schema";
import {
  activeSpanLabel,
  advanceRendered,
  BAND_FILLS,
  buildBands,
  buildTradeMarkers,
  candlePointAt,
  CONTEXT_ALPHA,
  CYCLE_COLORS,
  followSpanRange,
  followTestRange,
  followWidth,
  formatSignedUsd,
  mapBars,
  planRender,
  readoutAt,
  spanToLogical,
  stripColor,
  stripPointAt,
  tickDecimals,
  withAlpha,
  type RenderedBars,
} from "@/cycle/chartModel";

const FIVE_MINUTES = 300;
const START = 1_735_700_000;

function barsEvent(
  role: "context" | "processed",
  from: number,
  count: number,
  foldIndex: number | null,
  extra: Partial<CycleBars> = {},
): CycleBars {
  const timestamps = Array.from({ length: count }, (_, i) => START + (from + i) * FIVE_MINUTES);
  const close = timestamps.map((_, i) => 100 + ((from + i) % 7) - 3);
  const event: CycleBars = {
    role,
    foldIndex,
    timestamps,
    open: close.map((value) => value - 0.5),
    high: close.map((value) => value + 1),
    low: close.map((value) => value - 1),
    close,
    volume: close.map(() => 10),
    ...extra,
  };
  if (role === "processed" && !extra.probabilityUp) {
    event.probabilityUp = timestamps.map((_, i) => ((from + i) % 10) / 10);
    event.predictedDirection = event.probabilityUp.map((p) => ((p ?? 0.5) > 0.55 ? 1 : (p ?? 0.5) < 0.45 ? -1 : 0));
    event.position = event.predictedDirection.map((d) => d);
    event.equityUsd = timestamps.map((_, i) => (from + i) * 1.5 - 20);
  }
  return event;
}

function columnsWith(...events: CycleBars[]): CycleBarColumns {
  const columns = emptyBarColumns();
  for (const event of events) appendBars(columns, event);
  return columns;
}

function barTime(index: number): number {
  return START + index * FIVE_MINUTES;
}

const PLAN: CyclePlan = {
  symbol: "MNQ",
  timeframe: "5m",
  modelFamily: "xgboost",
  modelLabel: "XGBoost",
  parameters: {},
  device: "cpu",
  deviceName: null,
  dataStart: barTime(0),
  dataEnd: barTime(999),
  barCount: 1000,
  barsPerYear: 70_000,
  featureNames: ["return_1"],
  labelHorizonBars: 6,
  labelThresholdTicks: 0,
  purgeBars: 6,
  embargoBars: 0,
  costModel: { tickSize: 0.25, tickValueUsd: 0.5, pointValueUsd: 2, costPerSideUsd: 1.4, roundTripCostUsd: 2.8, source: "cost_model.json" },
  trading: { entryProbability: 0.55, longOnly: false, holdingBars: 6, stopLossTicks: 0, takeProfitTicks: 0, contracts: 1 },
  tuning: null,
  folds: [
    {
      foldIndex: 0,
      trainStart: barTime(0),
      trainEnd: barTime(199),
      validationStart: barTime(200),
      validationEnd: barTime(249),
      testStart: barTime(250),
      testEnd: barTime(349),
      trainBarCount: 200,
      validationBarCount: 50,
      testBarCount: 100,
    },
    {
      foldIndex: 1,
      trainStart: barTime(100),
      trainEnd: barTime(299),
      validationStart: barTime(300),
      validationEnd: barTime(349),
      testStart: barTime(350),
      testEnd: barTime(449),
      trainBarCount: 200,
      validationBarCount: 50,
      testBarCount: 100,
    },
  ],
  barsPerSecond: 40,
  startPaused: false,
  artifactDirectory: "data/models/x",
};

function cursor(partial: Partial<CycleCursor>): CycleCursor {
  return {
    phase: "training",
    foldIndex: 1,
    foldCount: 2,
    spanStart: null,
    spanEnd: null,
    barTimestamp: null,
    barIndex: null,
    barCount: null,
    epoch: null,
    epochCount: null,
    batch: null,
    batchCount: null,
    stepUnit: null,
    trial: null,
    trialCount: null,
    phaseFraction: 0,
    overallFraction: 0,
    barsPerSecond: 40,
    paused: false,
    elapsedSeconds: 0,
    ...partial,
  };
}

function trade(partial: Partial<CycleTrade>): CycleTrade {
  return {
    tradeNumber: 1,
    foldIndex: 0,
    side: "long",
    status: "open",
    contracts: 1,
    entryTimestamp: barTime(260),
    entryPrice: 100,
    exitTimestamp: null,
    exitPrice: null,
    barsHeld: 0,
    probabilityUpAtEntry: 0.6,
    grossProfitUsd: null,
    costUsd: null,
    netProfitUsd: null,
    exitReason: null,
    ...partial,
  };
}

describe("candle mapping", () => {
  it("draws processed bars in full Okabe-Ito colour and context bars at 40% alpha", () => {
    const columns = columnsWith(barsEvent("context", 0, 3, 0), barsEvent("processed", 3, 3, 0));
    const contextBar = candlePointAt(columns, 1);
    const processedBar = candlePointAt(columns, 4);
    const upContext = withAlpha(CYCLE_COLORS.up, CONTEXT_ALPHA);
    const downContext = withAlpha(CYCLE_COLORS.down, CONTEXT_ALPHA);
    expect([upContext, downContext]).toContain(contextBar.color);
    expect([CYCLE_COLORS.up, CYCLE_COLORS.down]).toContain(processedBar.color);
    expect(contextBar.wickColor).toBe(contextBar.color);
    expect(processedBar.borderColor).toBe(processedBar.color);
    expect(processedBar.time).toBe(barTime(4));
    expect(upContext).toBe("rgba(230, 159, 0, 0.4)");
  });

  it("decides up/down by close against the previous close, like the Market chart", () => {
    const columns = columnsWith(barsEvent("processed", 0, 2, 0));
    columns.close[0] = 100;
    columns.open[1] = 101;
    columns.close[1] = 100.5; // below its own open, above the previous close
    expect(candlePointAt(columns, 1).color).toBe(CYCLE_COLORS.up);
    columns.close[1] = 99.75;
    expect(candlePointAt(columns, 1).color).toBe(CYCLE_COLORS.down);
  });
});

describe("prediction strip", () => {
  it("colours by predicted direction and fades by confidence, never below 0.25 alpha", () => {
    expect(stripColor(1, 1)).toBe("rgba(230, 159, 0, 1)");
    expect(stripColor(-1, 0)).toBe("rgba(0, 114, 178, 1)");
    expect(stripColor(1, 0.5)).toBe("rgba(230, 159, 0, 0.25)");
    // Confidence 0.04 lands in the first alpha bucket above the floor.
    expect(stripColor(0, 0.52)).toBe("rgba(184, 190, 200, 0.3)");
    expect(stripColor(null, null)).toBe(withAlpha(CYCLE_COLORS.neutral, 0.25));
  });

  it("is a constant-height point for processed bars and whitespace for context bars", () => {
    const columns = columnsWith(
      barsEvent("context", 0, 1, 0),
      barsEvent("processed", 1, 1, 0, {
        probabilityUp: [0.8],
        predictedDirection: [1],
        position: [1],
        equityUsd: [0],
      }),
    );
    expect(stripPointAt(columns, 0)).toEqual({ time: barTime(0) });
    const point = stripPointAt(columns, 1);
    expect(point).toMatchObject({ time: barTime(1), value: 1 });
    expect("color" in point && point.color).toBe(stripColor(1, 0.8));
  });

  it("maps a range to four aligned series with whitespace where the model has not predicted", () => {
    const columns = columnsWith(barsEvent("context", 0, 4, 0), barsEvent("processed", 4, 4, 0));
    const mapped = mapBars(columns, 2, 6);
    expect(mapped.candles.map((point) => point.time)).toEqual([barTime(2), barTime(3), barTime(4), barTime(5)]);
    expect(mapped.probability[0]).toEqual({ time: barTime(2) });
    expect(mapped.probability[2]).toEqual({ time: barTime(4), value: 0.4 });
    expect(mapped.equity[3]).toEqual({ time: barTime(5), value: 5 * 1.5 - 20 });
    expect(mapBars(columns, 6, 100).candles).toHaveLength(2);
  });
});

describe("incremental render bookkeeping", () => {
  const store = (columns: CycleBarColumns, epoch: number, version: number, rendered: RenderedBars | null) => ({
    epoch,
    version,
    count: columns.timestamps.length,
    timestampAtRenderedEnd: rendered && rendered.count > 0 ? (columns.timestamps[rendered.count - 1] ?? null) : null,
  });

  it("resets on the first frame, appends only the new tail after, and advances the rendered count", () => {
    const columns = columnsWith(barsEvent("context", 0, 10, 0));
    let rendered: RenderedBars | null = null;
    let snapshot = store(columns, 1, 1, rendered);
    let plan = planRender(rendered, snapshot);
    expect(plan).toEqual({ kind: "reset", count: 10 });
    rendered = advanceRendered(rendered, snapshot, plan, columns.timestamps);
    expect(rendered).toEqual({ epoch: 1, version: 1, count: 10, lastTimestamp: barTime(9) });

    appendBars(columns, barsEvent("processed", 10, 5, 0));
    snapshot = store(columns, 1, 2, rendered);
    plan = planRender(rendered, snapshot);
    expect(plan).toEqual({ kind: "append", from: 10, to: 15 });
    rendered = advanceRendered(rendered, snapshot, plan, columns.timestamps);
    expect(rendered.count).toBe(15);

    snapshot = store(columns, 1, 2, rendered);
    expect(planRender(rendered, snapshot)).toEqual({ kind: "none" });
  });

  it("refreshes (no append) when only resolved labels changed the version", () => {
    const columns = columnsWith(barsEvent("processed", 0, 10, 0));
    const rendered: RenderedBars = { epoch: 1, version: 1, count: 10, lastTimestamp: barTime(9) };
    appendBars(columns, {
      ...barsEvent("processed", 0, 0, 0),
      resolved: { timestamps: [barTime(2)], actualDirection: [1], correct: [true] },
    });
    expect(planRender(rendered, store(columns, 1, 2, rendered))).toEqual({ kind: "refresh" });
  });

  it("resets when the epoch changes (new run or snapshot)", () => {
    const columns = columnsWith(barsEvent("context", 0, 10, 0));
    const rendered: RenderedBars = { epoch: 1, version: 5, count: 10, lastTimestamp: barTime(9) };
    expect(planRender(rendered, store(columns, 2, 1, rendered))).toEqual({ kind: "reset", count: 10 });
  });

  it("resets when the count went backwards or a drawn bar's timestamp no longer matches", () => {
    const shorter = columnsWith(barsEvent("context", 0, 4, 0));
    const rendered: RenderedBars = { epoch: 1, version: 5, count: 10, lastTimestamp: barTime(9) };
    expect(planRender(rendered, store(shorter, 1, 6, rendered))).toEqual({ kind: "reset", count: 4 });

    const replaced = columnsWith(barsEvent("context", 100, 12, 0));
    expect(planRender(rendered, store(replaced, 1, 6, rendered))).toEqual({ kind: "reset", count: 12 });
  });
});

describe("bands", () => {
  it("maps a span to a half-bar-widened logical range clamped to the drawn bars", () => {
    const timestamps = Array.from({ length: 20 }, (_, i) => barTime(i));
    expect(spanToLogical(timestamps, barTime(3), barTime(7))).toEqual({ from: 2.5, to: 7.5 });
    expect(spanToLogical(timestamps, barTime(15), barTime(40))).toEqual({ from: 14.5, to: 19.5 });
    expect(spanToLogical(timestamps, barTime(3) + 1, barTime(7) - 1)).toEqual({ from: 3.5, to: 6.5 });
    expect(spanToLogical(timestamps, barTime(30), barTime(40))).toBeNull();
    expect(spanToLogical([], 0, 1)).toBeNull();
  });

  it("draws the current fold's training and validation spans and the active block while training", () => {
    const layout = buildBands(
      PLAN,
      cursor({ phase: "training", foldIndex: 1, spanStart: barTime(120), spanEnd: barTime(180), epoch: 3, epochCount: 20, batch: 120, batchCount: 412, stepUnit: "epoch" }),
      barTime(349),
    );
    const kinds = layout.bands.map((band) => band.kind);
    expect(kinds).toEqual(["previous_test", "training", "validation", "active"]);
    const training = layout.bands.find((band) => band.kind === "training")!;
    expect(training).toMatchObject({ start: barTime(100), end: barTime(299), label: "Training window · fold 2", fill: BAND_FILLS.training });
    expect(layout.bands.find((band) => band.kind === "active")!.label).toBe("Fitting this block — epoch 3/20 batch 120/412");
    expect(layout.bands.find((band) => band.kind === "previous_test")).toMatchObject({ start: barTime(250), end: barTime(349), label: null });
    expect(layout.cursor).toBeNull();
  });

  it("labels the active block by phase and step unit", () => {
    expect(activeSpanLabel(cursor({ phase: "training", stepUnit: "boosting_round", epoch: 120, epochCount: 400 }))).toBe(
      "Boosting round 120/400 — every round sees the whole window",
    );
    expect(activeSpanLabel(cursor({ phase: "validating" }))).toBe("Validating");
    expect(activeSpanLabel(cursor({ phase: "tuning", trial: 2, trialCount: 20 }))).toBe("Tuning block — trial 3/20");
    expect(activeSpanLabel(cursor({ phase: "training", stepUnit: "tree_batch", epoch: 2, epochCount: 6 }))).toMatch(/^Growing trees 2\/6/);
  });

  it("grows the test walk to the cursor and marks where the model is while testing", () => {
    const layout = buildBands(PLAN, cursor({ phase: "testing", foldIndex: 0, barTimestamp: barTime(280), paused: true }), barTime(280));
    const test = layout.bands.find((band) => band.kind === "test")!;
    expect(test).toMatchObject({ start: barTime(250), end: barTime(280), label: "Test walk" });
    expect(layout.bands.some((band) => band.kind === "active")).toBe(false);
    expect(layout.cursor).toEqual({ time: barTime(280), label: "model is here · paused", paused: true });
  });

  it("uses the plan's tuning window when the tuning cursor carries no span", () => {
    const plan: CyclePlan = { ...PLAN, tuning: { trialCount: 20, objective: "sharpe_ratio", innerFoldCount: 2, start: barTime(0), end: barTime(199) } };
    const layout = buildBands(plan, cursor({ phase: "tuning", foldIndex: null, trial: 0, trialCount: 20 }), barTime(199));
    expect(layout.bands).toHaveLength(1);
    expect(layout.bands[0]).toMatchObject({ kind: "active", start: barTime(0), end: barTime(199), label: "Tuning block — trial 1/20" });
  });

  it("after the run ends shows the last fold's full test walk and earlier folds faintly", () => {
    const layout = buildBands(PLAN, cursor({ phase: "complete", foldIndex: null }), barTime(449));
    expect(layout.bands.map((band) => band.kind)).toEqual(["previous_test", "training", "validation", "test"]);
    expect(layout.bands.find((band) => band.kind === "test")).toMatchObject({ start: barTime(350), end: barTime(449) });
  });

  it("draws nothing without a plan", () => {
    expect(buildBands(null, cursor({}), null)).toEqual({ bands: [], cursor: null });
  });
});

describe("trade markers", () => {
  it("builds entry and exit markers with direction, colour and text, sorted by time", () => {
    const trades: CycleTrade[] = [
      trade({ tradeNumber: 2, side: "short", entryTimestamp: barTime(270), status: "closed", exitTimestamp: barTime(275), netProfitUsd: -14.3 }),
      trade({ tradeNumber: 1, side: "long", entryTimestamp: barTime(260), status: "closed", exitTimestamp: barTime(266), netProfitUsd: 26.2 }),
      trade({ tradeNumber: 3, side: "long", entryTimestamp: barTime(275), status: "open" }),
    ];
    const { markers, pendingTimestamp } = buildTradeMarkers(trades, barTime(400));
    expect(pendingTimestamp).toBeNull();
    expect(markers.map((marker) => [marker.time, marker.text])).toEqual([
      [barTime(260), "L1"],
      [barTime(266), "+$26.20"],
      [barTime(270), "S2"],
      [barTime(275), "−$14.30"],
      [barTime(275), "L3"],
    ]);
    expect(markers[0]).toMatchObject({ shape: "arrowUp", position: "belowBar", color: CYCLE_COLORS.up });
    expect(markers[1]).toMatchObject({ shape: "circle", position: "aboveBar", color: CYCLE_COLORS.up });
    expect(markers[2]).toMatchObject({ shape: "arrowDown", position: "aboveBar", color: CYCLE_COLORS.down });
    expect(markers[3]).toMatchObject({ shape: "circle", position: "belowBar", color: CYCLE_COLORS.down });
  });

  it("holds back markers whose bar has not been drawn and reports the earliest as pending", () => {
    const trades = [trade({ tradeNumber: 1, entryTimestamp: barTime(260), status: "closed", exitTimestamp: barTime(266), netProfitUsd: 1 })];
    const early = buildTradeMarkers(trades, barTime(262));
    expect(early.markers.map((marker) => marker.text)).toEqual(["L1"]);
    expect(early.pendingTimestamp).toBe(barTime(266));
    expect(buildTradeMarkers(trades, null)).toEqual({ markers: [], pendingTimestamp: barTime(260) });
  });

  it("formats signed dollars with a true minus sign", () => {
    expect(formatSignedUsd(26.2)).toBe("+$26.20");
    expect(formatSignedUsd(-14.3)).toBe("−$14.30");
    expect(formatSignedUsd(0)).toBe("+$0.00");
  });
});

describe("follow ranges and readout", () => {
  it("keeps the cursor near the right edge with 150..400 bars in view", () => {
    expect(followWidth(null)).toBe(250);
    expect(followWidth(50)).toBe(150);
    expect(followWidth(5000)).toBe(400);
    const range = followTestRange(1000, 200);
    expect(range.to - range.from).toBe(200);
    expect(range.to).toBeGreaterThan(1000);
    expect(followSpanRange(100, 300)).toEqual({ from: 90, to: 310 });
  });

  it("reads a bar out in words with a glyph for the label, not colour alone", () => {
    const columns = columnsWith(barsEvent("context", 0, 1, 0), barsEvent("processed", 1, 3, 0));
    appendBars(columns, {
      ...barsEvent("processed", 0, 0, 0),
      resolved: { timestamps: [barTime(1), barTime(2)], actualDirection: [1, -1], correct: [true, false] },
    });
    expect(readoutAt(columns, 0)).toMatchObject({ role: "context", labelWord: "not tested", positionWord: "none" });
    expect(readoutAt(columns, 1)).toMatchObject({ labelWord: "correct", labelGlyph: "✓", actualDirectionWord: "up" });
    expect(readoutAt(columns, 2)).toMatchObject({ labelWord: "wrong", labelGlyph: "✗" });
    expect(readoutAt(columns, 3)).toMatchObject({ labelWord: "not resolved yet" });
    expect(readoutAt(columns, 1)!.timeText).toMatch(/UTC$/);
    expect(readoutAt(columns, 99)).toBeNull();
  });

  it("derives price precision from the tick size", () => {
    expect(tickDecimals(0.25)).toBe(2);
    expect(tickDecimals(1)).toBe(0);
    expect(tickDecimals(0.0001)).toBe(4);
  });
});

describe("per-frame cost", () => {
  it("maps 50,000 bars in chunks of 20 with a per-chunk cost that does not grow with the total", () => {
    const total = 50_000;
    const chunk = 20;
    const run = () => {
      const columns = emptyBarColumns();
      const durations: number[] = [];
      for (let from = 0; from < total; from += chunk) {
        const role = (from / chunk) % 3 === 0 ? "context" : "processed";
        appendBars(columns, barsEvent(role, from, chunk, 0));
        const started = performance.now();
        const mapped = mapBars(columns, from, from + chunk);
        durations.push(performance.now() - started);
        if (mapped.candles.length !== chunk) throw new Error("chunk size");
      }
      return durations;
    };
    run(); // warm the JIT
    const durations = run();
    const window = 250; // chunks = 5,000 bars
    // Medians, so one garbage-collection pause inside a window (the columns
    // themselves keep growing) does not read as a cost that scales with bars.
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const early = median(durations.slice(10, 10 + window));
    const late = median(durations.slice(-window));
    const all = sum(durations) / durations.length;
    console.info(
      `[cycle-chart benchmark] ${durations.length} chunks of ${chunk} bars: mean ${(all * 1000).toFixed(1)} µs/chunk; ` +
        `median over bars 200-5,200: ${(early * 1000).toFixed(1)} µs/chunk; median over the last 5,000 bars: ${(late * 1000).toFixed(1)} µs/chunk; ` +
        `ratio late/early ${(late / early).toFixed(2)}; slowest chunk ${(Math.max(...durations) * 1000).toFixed(0)} µs`,
    );
    // Flat, not growing: allow generous noise on a shared machine.
    expect(late).toBeLessThan(early * 3 + 0.005);
    // And cheap in absolute terms: well under a millisecond per 20-bar frame.
    expect(all).toBeLessThan(1);
  });
});
