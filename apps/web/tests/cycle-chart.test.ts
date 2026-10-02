/**
 * Model Cycle chart — the pure half (`apps/web/src/cycle/chartModel.ts`):
 * bar → series mapping, incremental render bookkeeping, fold/active bands,
 * on-candle prediction glyphs, the price model's forecast line, trade markers,
 * follow ranges, the crosshair readout, and a benchmark that the per-chunk
 * mapping cost does not grow with the bars already drawn.
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
  appendForecast,
  emptyForecastTrack,
  FOLLOW_FORECAST_PADDING_BARS,
  forecastHeadIndex,
  forecastOnlyReadout,
  GLYPH_FAINT_ALPHA,
  GLYPH_SOLID_MINIMUM_ALPHA,
  GLYPH_SPACER_COLOR,
  glyphSize,
  glyphTriangle,
  madeForecastAt,
  predictionGlyphAt,
  targetForecastAt,
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
  boxesOverlap,
  formatBarTime,
  formatTickPrice,
  glyphBox,
  hoverPriceGeometry,
  INSPECT_PUBLISH_INTERVAL_MILLISECONDS,
  labelMoveAt,
  logicalIndexOfTime,
  nextPinnedTimestamp,
  placePriceTexts,
  PRICE_TEXT_MAXIMUM_ROWS,
  PRICE_TEXT_MINIMUM_BAR_SPACING,
  priceTextBox,
  readoutLabelTone,
  rollAdjustmentAt,
  tradeAtNextOpen,
  tradeEnteredAt,
  TrailingThrottle,
  type PriceTextCandidate,
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
  trading: { longOnly: false, holdingBars: 6, stopLossTicks: 0, takeProfitTicks: 0, contracts: 1 },
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

describe("on-candle prediction glyphs", () => {
  /** Bars 1..4 processed: up, down, no call, up — labels resolved right, wrong, (none), unresolved. */
  function glyphColumns(): CycleBarColumns {
    const columns = columnsWith(
      barsEvent("context", 0, 1, 0),
      barsEvent("processed", 1, 4, 0, {
        probabilityUp: [0.9, 0.2, 0.5, 0.6],
        predictedDirection: [1, -1, 0, 1],
        position: [1, -1, 0, 1],
        equityUsd: [0, 0, 0, 0],
      }),
    );
    appendBars(columns, {
      ...barsEvent("processed", 0, 0, 0),
      resolved: { timestamps: [barTime(1), barTime(2), barTime(3)], actualDirection: [1, 1, 1], correct: [true, false, null] },
    });
    return columns;
  }

  it("puts an up call below the candle in orange and a down call above it in blue", () => {
    const columns = glyphColumns();
    expect(predictionGlyphAt(columns, 1)).toMatchObject({ side: "below", color: CYCLE_COLORS.up });
    expect(predictionGlyphAt(columns, 2)).toMatchObject({ side: "above", color: CYCLE_COLORS.down });
  });

  it("draws nothing for context bars and bars with no directional call", () => {
    const columns = glyphColumns();
    expect(predictionGlyphAt(columns, 0)).toBeNull();
    expect(predictionGlyphAt(columns, 3)).toBeNull();
  });

  it("fills by the resolved label: solid right, hollow wrong, faint not known yet", () => {
    const columns = glyphColumns();
    const right = predictionGlyphAt(columns, 1)!;
    expect(right.fill).toBe("solid");
    // Confidence |0.9 − 0.5| × 2 = 0.8 lifts the alpha above the solid floor.
    expect(right.alpha).toBeCloseTo(GLYPH_SOLID_MINIMUM_ALPHA + (1 - GLYPH_SOLID_MINIMUM_ALPHA) * 0.8, 10);
    expect(predictionGlyphAt(columns, 2)).toMatchObject({ fill: "hollow", alpha: 1 });
    expect(predictionGlyphAt(columns, 4)).toMatchObject({ fill: "faint", alpha: GLYPH_FAINT_ALPHA });
    // A correct low-confidence call stays clearly more opaque than an unknown one.
    expect(GLYPH_SOLID_MINIMUM_ALPHA).toBeGreaterThan(GLYPH_FAINT_ALPHA + 0.2);
  });

  it("treats a move inside the threshold (resolved, not scored) as faint", () => {
    const columns = glyphColumns();
    appendBars(columns, { ...barsEvent("processed", 0, 0, 0), resolved: { timestamps: [barTime(4)], actualDirection: [0], correct: [null] } });
    expect(predictionGlyphAt(columns, 4)).toMatchObject({ fill: "faint" });
  });

  it("scales with bar spacing between 4 and 10 pixels and hides below 3 pixels", () => {
    expect(glyphSize(2.9)).toBeNull();
    expect(glyphSize(0)).toBeNull();
    expect(glyphSize(Number.NaN)).toBeNull();
    expect(glyphSize(3)).toBe(4);
    expect(glyphSize(8)).toBeCloseTo(6.4, 10);
    expect(glyphSize(40)).toBe(10);
  });

  it("places the triangle a gap beyond the wick, apex toward the candle", () => {
    const below = glyphTriangle("below", 100, 200, 10, 3);
    expect(below.apex).toEqual({ x: 100, y: 203 });
    expect(below.baseLeft).toEqual({ x: 95, y: 212 });
    expect(below.baseRight).toEqual({ x: 105, y: 212 });
    const above = glyphTriangle("above", 100, 50, 10, 3);
    expect(above.apex).toEqual({ x: 100, y: 47 });
    expect(above.baseLeft.y).toBe(38);
    // No part of an up glyph above the low; no part of a down glyph below the high.
    expect(Math.min(below.apex.y, below.baseLeft.y)).toBeGreaterThan(200);
    expect(Math.max(above.apex.y, above.baseLeft.y)).toBeLessThan(50);
  });
});

describe("forecast line", () => {
  /** Processed bars 0..count−1, bar i forecasting bar i+horizon at close + (i+1)/4. */
  function forecastColumns(count: number, horizon: number): CycleBarColumns {
    const event = barsEvent("processed", 0, count, 0);
    event.predictedClose = event.close.map((close, i) => close + (i + 1) / 4);
    event.forecastTimestamp = event.timestamps.map((_, i) => barTime(i + horizon));
    return columnsWith(event);
  }

  it("plots each forecast at the bar it is for, skipping nulls and context bars", () => {
    const columns = columnsWith(barsEvent("context", 0, 2, 0));
    const processed = barsEvent("processed", 2, 4, 0);
    processed.predictedClose = [110, null, 112, 113];
    processed.forecastTimestamp = [barTime(8), barTime(9), null, barTime(11)];
    appendBars(columns, processed);
    const track = emptyForecastTrack();
    const points = appendForecast(track, columns, 0, columns.timestamps.length);
    expect(points).toEqual([
      { time: barTime(8), value: 110 },
      { time: barTime(11), value: 113 },
    ]);
    expect(track.times).toEqual([barTime(8), barTime(11)]);
    expect(track.sourceByTime.get(barTime(8))).toBe(2);
    expect(track.sourceByTime.get(barTime(11))).toBe(5);
  });

  it("appends only the new bars' forecasts, in increasing time, and a reset starts over", () => {
    const columns = forecastColumns(10, 3);
    const track = emptyForecastTrack();
    const first = appendForecast(track, columns, 0, 6);
    expect(first.map((point) => point.time)).toEqual([3, 4, 5, 6, 7, 8].map(barTime));
    const second = appendForecast(track, columns, 6, 10);
    expect(second.map((point) => point.time)).toEqual([9, 10, 11, 12].map(barTime));
    expect(track.times).toHaveLength(10);
    // Re-appending bars already seen adds nothing: the line only accepts later times.
    expect(appendForecast(track, columns, 4, 10)).toEqual([]);

    const reset = emptyForecastTrack();
    expect(appendForecast(reset, columns, 0, 10)).toHaveLength(10);
    expect(reset.sourceByTime.size).toBe(10);
  });

  it("drops a target time that is not after the previous one", () => {
    const columns = forecastColumns(3, 2);
    columns.forecastTimestamp[1] = barTime(2); // equals bar 0's target
    const points = appendForecast(emptyForecastTrack(), columns, 0, 3);
    expect(points.map((point) => point.time)).toEqual([barTime(2), barTime(4)]);
  });

  it("puts the forecast head the horizon past the newest candle", () => {
    const columns = forecastColumns(10, 3);
    const track = emptyForecastTrack();
    appendForecast(track, columns, 0, 10);
    // Candles 0..9; forecasts reach bar 12 — three time points past the last candle.
    expect(forecastHeadIndex(track, 10, barTime(9))).toBe(12);
    expect(forecastHeadIndex(emptyForecastTrack(), 10, barTime(9))).toBeNull();
    expect(forecastHeadIndex(track, 0, null)).toBeNull();
  });

  it("follow keeps both the cursor and the forecast head in view", () => {
    const withHead = followTestRange(1000, 200, 1006);
    expect(withHead.to).toBe(Math.max(1000 + 12, 1006 + FOLLOW_FORECAST_PADDING_BARS));
    const farHead = followTestRange(1000, 150, 1300);
    expect(farHead.to).toBe(1300 + FOLLOW_FORECAST_PADDING_BARS);
    expect(farHead.from).toBeLessThan(1000);
    expect(followTestRange(1000, 200, null)).toEqual(followTestRange(1000, 200));
  });

  it("reads out the forecast a bar made and the one that targets it, through the map", () => {
    const columns = forecastColumns(10, 3);
    const track = emptyForecastTrack();
    appendForecast(track, columns, 0, 10);
    // Bar 5 is targeted by bar 2's forecast: close[2] + 3/4.
    const target = targetForecastAt(columns, 5, track.sourceByTime)!;
    expect(target.predictedClose).toBe(columns.close[2]! + 0.75);
    expect(target.actualClose).toBe(columns.close[5]);
    expect(target.errorPoints).toBeCloseTo(columns.close[2]! + 0.75 - columns.close[5]!, 10);
    expect(target.madeAtText).toBe(readoutAt(columns, 2)!.timeText);
    expect(targetForecastAt(columns, 1, track.sourceByTime)).toBeNull(); // nothing forecast bar 1
    expect(targetForecastAt(columns, 5, null)).toBeNull();

    // Bar 5 forecasts bar 8, which is in the store: the error is known.
    expect(madeForecastAt(columns, 5, 0.25)).toEqual({
      predictedClose: columns.close[5]! + 1.5,
      targetTimeText: readoutAt(columns, 8)!.timeText,
      predictedMovePoints: 1.5,
      actualClose: columns.close[8],
      errorPoints: columns.close[5]! + 1.5 - columns.close[8]!,
      errorTicks: (columns.close[5]! + 1.5 - columns.close[8]!) / 0.25,
    });
    // Bar 8 forecasts bar 11, not in the store yet: no error, and no ticks without a tick size.
    expect(madeForecastAt(columns, 8)).toMatchObject({ actualClose: null, errorPoints: null, errorTicks: null });
    expect(madeForecastAt(columns, 2)!.errorTicks).toBeNull();

    const readout = readoutAt(columns, 5, track.sourceByTime)!;
    expect(readout.forecastForThisBar).toEqual(target);
    expect(readout.forecastMadeHere?.predictedClose).toBe(columns.close[5]! + 1.5);
    expect(readoutAt(columns, 5)!.forecastForThisBar).toBeNull();

    // Past the newest candle: bar 9's forecast of bar 12.
    expect(forecastOnlyReadout(columns, barTime(12), track.sourceByTime)).toMatchObject({ predictedClose: columns.close[9]! + 2.5 });
    expect(forecastOnlyReadout(columns, barTime(13), track.sourceByTime)).toBeNull();
  });
});

describe("trade markers beside prediction glyphs", () => {
  it("reserves the glyph's slot with an invisible spacer so the trade arrow lands beyond it", () => {
    const up = Array.from({ length: 20 }, () => 1 as const);
    const columns = columnsWith(
      barsEvent("processed", 0, 20, 0, {
        probabilityUp: up.map(() => 0.8),
        predictedDirection: up,
        position: up,
        equityUsd: up.map(() => 0),
      }),
    );
    // Long entry below bar 5 (the same side as its ▲ glyph); long exit above bar 9 (no glyph above).
    const trades = [trade({ tradeNumber: 1, entryTimestamp: barTime(5), status: "closed", exitTimestamp: barTime(9), netProfitUsd: 3 })];
    const { markers } = buildTradeMarkers(trades, barTime(19), columns);
    expect(markers.map((marker) => [marker.time, marker.position, marker.color])).toEqual([
      [barTime(5), "belowBar", GLYPH_SPACER_COLOR],
      [barTime(5), "belowBar", CYCLE_COLORS.up],
      [barTime(9), "aboveBar", CYCLE_COLORS.up],
    ]);
    // Without columns the markers are unchanged.
    expect(buildTradeMarkers(trades, barTime(19)).markers).toHaveLength(2);
  });
});

// ─── WP10: price on the labels ──────────────────────────────────────────────

/** Processed bars 0..count−1; bar i forecasts bar i+horizon at close + 1 (target times set). */
function priceColumns(count: number, horizon: number): CycleBarColumns {
  const event = barsEvent("processed", 0, count, 0);
  event.predictedClose = event.close.map((close) => close + 1);
  event.forecastTimestamp = event.timestamps.map((_, i) => barTime(i + horizon));
  return columnsWith(event);
}

/** Resolve the labels of bars `indices` (as the engine does when bar i+h arrives). */
function resolve(columns: CycleBarColumns, indices: number[]): void {
  appendBars(columns, {
    ...barsEvent("processed", 0, 0, 0),
    resolved: { timestamps: indices.map(barTime), actualDirection: indices.map(() => 1 as const), correct: indices.map(() => true) },
  });
}

const PLAN_H3: CyclePlan = { ...PLAN, labelHorizonBars: 3, labelThresholdTicks: 2 };

describe("label move in points, ticks and USD", () => {
  it("measures close[i] → close[i + h] once the label is known", () => {
    const columns = priceColumns(10, 3);
    resolve(columns, [2]);
    const move = labelMoveAt(columns, 2, PLAN_H3)!;
    expect(move.state).toBe("resolved");
    if (move.state !== "resolved") return;
    const points = columns.close[5]! - columns.close[2]!;
    expect(move.startClose).toBe(columns.close[2]);
    expect(move.resolutionClose).toBe(columns.close[5]);
    expect(move.resolutionTimeText).toBe(formatBarTime(barTime(5)));
    expect(move.movePoints).toBe(points);
    expect(move.moveTicks).toBe(points / 0.25);
    // MNQ: $2 per point, one contract.
    expect(move.moveUsdPerContract).toBe(points * 2);
    expect(move.contracts).toBe(1);
    expect(move.moveUsdAllContracts).toBe(points * 2);
    expect(move.horizonBars).toBe(3);
    expect(move.thresholdTicks).toBe(2);
  });

  it("states per contract and multiplies by the contract count", () => {
    const columns = priceColumns(10, 3);
    resolve(columns, [1]);
    const plan: CyclePlan = { ...PLAN_H3, trading: { ...PLAN_H3.trading, contracts: 3 } };
    const move = labelMoveAt(columns, 1, plan)!;
    if (move.state !== "resolved") throw new Error("expected resolved");
    expect(move.contracts).toBe(3);
    expect(move.moveUsdAllContracts).toBeCloseTo(move.moveUsdPerContract * 3, 10);
  });

  it("says when an unresolved label resolves: the forecast target time, else the store, else unknown", () => {
    const columns = priceColumns(10, 3);
    // Bar 8 is unresolved; its forecast is for bar 11 (not in the store yet).
    expect(labelMoveAt(columns, 8, PLAN_H3)).toEqual({
      state: "pending",
      horizonBars: 3,
      resolutionTimeText: formatBarTime(barTime(11)),
      thresholdTicks: 2,
    });
    // No forecast time (no price model): bar 4 + 3 = bar 7 is in the store.
    columns.forecastTimestamp[4] = null;
    expect(labelMoveAt(columns, 4, PLAN_H3)).toMatchObject({ state: "pending", resolutionTimeText: formatBarTime(barTime(7)) });
    // No forecast time and bar i + h not here yet: the time is not known.
    columns.forecastTimestamp[9] = null;
    expect(labelMoveAt(columns, 9, PLAN_H3)).toMatchObject({ state: "pending", resolutionTimeText: null });
  });

  it("is absent for context bars and without a plan", () => {
    const columns = columnsWith(barsEvent("context", 0, 3, 0), barsEvent("processed", 3, 5, 0));
    expect(labelMoveAt(columns, 1, PLAN_H3)).toBeNull();
    expect(readoutAt(columns, 4)!.labelMove).toBeNull();
    expect(readoutAt(columns, 4, null, PLAN_H3)!.labelMove).toMatchObject({ state: "pending" });
  });

  it("colours a wrong label neutral grey (✗ carries it), never vermillion", () => {
    expect(readoutLabelTone("wrong")).toBe(CYCLE_COLORS.neutral);
    expect(readoutLabelTone("wrong")).not.toBe(CYCLE_COLORS.vermillion);
    expect(readoutLabelTone("correct")).toBe(CYCLE_COLORS.sky);
    expect(readoutLabelTone("not resolved yet")).toBeUndefined();
  });

  it("reports whether the model has a price model", () => {
    const columns = priceColumns(5, 3);
    expect(readoutAt(columns, 1)!.hasPriceModel).toBeNull();
    expect(readoutAt(columns, 1, null, PLAN_H3)!.hasPriceModel).toBe(true);
    expect(readoutAt(columns, 1, null, { ...PLAN_H3, hasPriceModel: false })!.hasPriceModel).toBe(false);
  });
});

describe("the trade entered at the next bar's open", () => {
  it("links bar i to the trade entered at bar i + 1, kept apart from the label move", () => {
    const columns = priceColumns(10, 3);
    const trades = [
      trade({ tradeNumber: 1, side: "long", entryTimestamp: barTime(3), entryPrice: 101.25, status: "closed", exitTimestamp: barTime(6), exitPrice: 103, netProfitUsd: 0.7 }),
      trade({ tradeNumber: 2, side: "short", entryTimestamp: barTime(6), entryPrice: 102.5, contracts: 2 }),
    ];
    expect(tradeAtNextOpen(columns, 2, trades)).toEqual({
      tradeNumber: 1,
      side: "long",
      contracts: 1,
      entryTimeText: formatBarTime(barTime(3)),
      fillPrice: 101.25,
      status: "closed",
      netProfitUsd: 0.7,
      exitTimeText: formatBarTime(barTime(6)),
      exitPrice: 103,
    });
    // An open trade has no net yet.
    expect(tradeAtNextOpen(columns, 5, trades)).toMatchObject({ tradeNumber: 2, side: "short", contracts: 2, status: "open", netProfitUsd: null });
    // No trade opened at bar 4's open; the last bar has no next bar.
    expect(tradeAtNextOpen(columns, 3, trades)).toBeNull();
    expect(tradeAtNextOpen(columns, 9, trades)).toBeNull();
    const readout = readoutAt(columns, 2, null, PLAN_H3, trades)!;
    expect(readout.tradeAtNextOpen?.tradeNumber).toBe(1);
    expect(readoutAt(columns, 2, null, PLAN_H3)!.tradeAtNextOpen).toBeNull();
  });

  it("finds a trade by entry time with a binary search over thousands", () => {
    const trades = Array.from({ length: 5000 }, (_, i) => trade({ tradeNumber: i + 1, entryTimestamp: barTime(i * 2) }));
    expect(tradeEnteredAt(trades, barTime(4000))?.tradeNumber).toBe(2001);
    expect(tradeEnteredAt(trades, barTime(4001))).toBeNull();
    expect(tradeEnteredAt([], barTime(0))).toBeNull();
  });
});

describe("roll-adjusted price note", () => {
  const rolled: CyclePlan = {
    ...PLAN_H3,
    priceAdjustment: {
      method: "panama_additive",
      rolls: [
        { timestamp: barTime(4), fromContract: "MNQU5", toContract: "MNQZ5", gapPoints: 241.75, exact: true },
        { timestamp: barTime(8), fromContract: "MNQZ5", toContract: "MNQH6", gapPoints: 256.75, exact: true },
      ],
    },
  };

  it("adds the gaps of every roll after the bar and names the next one", () => {
    expect(rollAdjustmentAt(rolled, barTime(2))).toEqual({
      shiftPoints: 241.75 + 256.75,
      rollCount: 2,
      nextRollTimeText: formatBarTime(barTime(4)),
      nextRollFromContract: "MNQU5",
      nextRollToContract: "MNQZ5",
    });
    // The roll bar itself is the new contract, as traded relative to later rolls only.
    expect(rollAdjustmentAt(rolled, barTime(4))).toMatchObject({ shiftPoints: 256.75, rollCount: 1, nextRollFromContract: "MNQZ5" });
    expect(rollAdjustmentAt(rolled, barTime(8))).toBeNull();
  });

  it("is absent without an adjustment", () => {
    expect(rollAdjustmentAt(PLAN_H3, barTime(2))).toBeNull();
    expect(rollAdjustmentAt({ ...rolled, priceAdjustment: { method: "none", rolls: [] } }, barTime(2))).toBeNull();
    const columns = priceColumns(10, 3);
    expect(readoutAt(columns, 2, null, rolled)!.rollAdjustment).toMatchObject({ rollCount: 2 });
  });
});

describe("forecast price text beside the glyphs", () => {
  it("prints the forecast at tick precision", () => {
    expect(formatTickPrice(21234.37, 0.25)).toBe("21234.25");
    expect(formatTickPrice(21234.38, 0.25)).toBe("21234.50");
    expect(formatTickPrice(1.234567, 0.0001)).toBe("1.2346");
    expect(formatTickPrice(4501.2, 1)).toBe("4501");
    expect(PRICE_TEXT_MINIMUM_BAR_SPACING).toBe(14);
  });

  it("puts the text under a ▲ and over a ▼, clear of the glyph, each row further out", () => {
    const size = 10;
    const below = priceTextBox("below", 100, 200, size, 40, 12);
    const belowGlyph = glyphBox("below", 100, 200, size);
    expect(below.top).toBeGreaterThan(belowGlyph.top + belowGlyph.height);
    expect(below.left + below.width / 2).toBe(100);
    expect(boxesOverlap(below, belowGlyph)).toBe(false);

    const above = priceTextBox("above", 100, 50, size, 40, 12);
    const aboveGlyph = glyphBox("above", 100, 50, size);
    expect(above.top + above.height).toBeLessThan(aboveGlyph.top);
    expect(boxesOverlap(above, aboveGlyph)).toBe(false);

    expect(priceTextBox("below", 100, 200, size, 40, 12, 1).top).toBeGreaterThan(below.top + below.height);
    expect(priceTextBox("above", 100, 50, size, 40, 12, 1).top + 12).toBeLessThan(above.top);
  });

  function candidates(spacing: number, count: number): PriceTextCandidate[] {
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      side: i % 3 === 0 ? ("above" as const) : ("below" as const),
      x: 20 + i * spacing,
      wickY: i % 3 === 0 ? 100 : 160 + (i % 2) * 4,
      text: "21234.25",
      textWidth: 48,
    }));
  }

  it("places every text in the first row when bars are wide apart", () => {
    const placed = placePriceTexts(candidates(60, 12), 10, 12);
    expect(placed).toHaveLength(12);
    for (const text of placed) {
      const candidate = candidates(60, 12)[text.index]!;
      expect(text.box).toEqual(priceTextBox(candidate.side, candidate.x, candidate.wickY, 10, 48, 12, 0));
    }
  });

  it("at 14 px never overprints a neighbour or any glyph: staggers a row out, then leaves text out", () => {
    const all = candidates(PRICE_TEXT_MINIMUM_BAR_SPACING, 40);
    const placed = placePriceTexts(all, 10, 12);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(all.length);
    const glyphs = all.map((candidate) => glyphBox(candidate.side, candidate.x, candidate.wickY, 10));
    for (let a = 0; a < placed.length; a += 1) {
      for (const glyph of glyphs) expect(boxesOverlap(placed[a]!.box, glyph)).toBe(false);
      for (let b = a + 1; b < placed.length; b += 1) expect(boxesOverlap(placed[a]!.box, placed[b]!.box)).toBe(false);
    }
    // At most PRICE_TEXT_MAXIMUM_ROWS rows out from each glyph.
    for (const text of placed) {
      const candidate = all[text.index]!;
      const rows = Array.from({ length: PRICE_TEXT_MAXIMUM_ROWS }, (_, row) => priceTextBox(candidate.side, candidate.x, candidate.wickY, 10, 48, 12, row));
      expect(rows).toContainEqual(text.box);
    }
  });
});

describe("hover segment and forecast point", () => {
  it("maps a time to its logical index: a candle's own, or the forecast point past the newest candle", () => {
    const columns = priceColumns(10, 3);
    const track = emptyForecastTrack();
    appendForecast(track, columns, 0, 10);
    expect(logicalIndexOfTime(columns.timestamps, 10, track.times, barTime(4))).toBe(4);
    // Forecast targets reach bar 12: logical indices 10, 11, 12 past the last candle (9).
    expect(logicalIndexOfTime(columns.timestamps, 10, track.times, barTime(12))).toBe(12);
    expect(logicalIndexOfTime(columns.timestamps, 10, track.times, barTime(12))).toBe(forecastHeadIndex(track, 10, barTime(9)));
    expect(logicalIndexOfTime(columns.timestamps, 10, track.times, barTime(13))).toBeNull();
    expect(logicalIndexOfTime(columns.timestamps, 10, null, barTime(11))).toBeNull();
    // Only drawn candles count: with 6 drawn, bar 8 is not on the scale as a candle.
    expect(logicalIndexOfTime(columns.timestamps, 6, [], barTime(8))).toBeNull();
    expect(logicalIndexOfTime(columns.timestamps, 0, track.times, barTime(1))).toBeNull();
  });

  it("draws the label move from close[i] to close[i + h] once resolved, and the forecast point", () => {
    const columns = priceColumns(10, 3);
    resolve(columns, [2]);
    const track = emptyForecastTrack();
    appendForecast(track, columns, 0, 10);
    const geometry = hoverPriceGeometry(columns, 2, 10, 3, track.times)!;
    expect(geometry).toEqual({
      index: 2,
      startClose: columns.close[2],
      resolutionIndex: 5,
      resolutionClose: columns.close[5],
      moveSign: Math.sign(columns.close[5]! - columns.close[2]!),
      forecastLogical: 5,
      forecastClose: columns.close[2]! + 1,
    });
  });

  it("draws only the forecast point while the label is unresolved, even ahead of the candles", () => {
    const columns = priceColumns(10, 3);
    const track = emptyForecastTrack();
    appendForecast(track, columns, 0, 10);
    const geometry = hoverPriceGeometry(columns, 8, 10, 3, track.times)!;
    expect(geometry.resolutionIndex).toBeNull();
    expect(geometry.moveSign).toBeNull();
    expect(geometry.forecastLogical).toBe(11);
    // Resolved but bar i + h not drawn yet: no segment.
    resolve(columns, [4]);
    expect(hoverPriceGeometry(columns, 4, 6, 3, track.times)!.resolutionIndex).toBeNull();
    // Context bars and undrawn bars draw nothing.
    const mixed = columnsWith(barsEvent("context", 0, 3, 0), barsEvent("processed", 3, 3, 0));
    expect(hoverPriceGeometry(mixed, 1, 6, 3, null)).toBeNull();
    expect(hoverPriceGeometry(mixed, 5, 5, 3, null)).toBeNull();
  });
});

describe("inspection: hover publish and click to pin", () => {
  /** A manual clock and timer queue. */
  function fakeScheduler() {
    let now = 0;
    let nextId = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    return {
      now: () => now,
      setTimer: (callback: () => void, delay: number) => {
        const id = nextId++;
        timers.set(id, { at: now + delay, callback });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer: ReturnType<typeof setTimeout>) => {
        timers.delete(timer as unknown as number);
      },
      advanceTo(time: number) {
        for (;;) {
          const due = [...timers.entries()].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          timers.delete(due[0]);
          now = due[1].at;
          due[1].callback();
        }
        now = time;
      },
    };
  }

  it("publishes at most every 100 ms, and the last bar hovered always goes out", () => {
    const clock = fakeScheduler();
    const published: { at: number; value: number }[] = [];
    const throttle = new TrailingThrottle<number>(INSPECT_PUBLISH_INTERVAL_MILLISECONDS, (value) => published.push({ at: clock.now(), value }), clock.now, clock.setTimer, clock.clearTimer);
    // A pointer sweeping a new bar every 4 ms for one second.
    for (let t = 0; t < 1000; t += 4) {
      clock.advanceTo(t);
      throttle.push(barTime(t / 4));
    }
    clock.advanceTo(2000);
    expect(published[0]).toEqual({ at: 0, value: barTime(0) });
    for (let i = 1; i < published.length; i += 1) expect(published[i]!.at - published[i - 1]!.at).toBeGreaterThanOrEqual(INSPECT_PUBLISH_INTERVAL_MILLISECONDS);
    // Within the first second: no more than 10 publishes.
    expect(published.filter((entry) => entry.at < 1000).length).toBeLessThanOrEqual(10);
    expect(published[published.length - 1]!.value).toBe(barTime(996 / 4));
  });

  it("does not republish the same bar and cancels a pending publish", () => {
    const clock = fakeScheduler();
    const published: number[] = [];
    const throttle = new TrailingThrottle<number>(100, (value) => published.push(value), clock.now, clock.setTimer, clock.clearTimer);
    throttle.push(1);
    clock.advanceTo(500);
    throttle.push(1);
    expect(published).toEqual([1]);
    clock.advanceTo(550);
    throttle.push(2);
    throttle.push(3); // inside the interval after 2
    throttle.cancel();
    clock.advanceTo(1000);
    expect(published).toEqual([1, 2]);
  });

  it("pins the clicked bar, and unpins when the pinned bar is clicked again", () => {
    expect(nextPinnedTimestamp("hover", barTime(3), barTime(5))).toBe(barTime(5));
    expect(nextPinnedTimestamp("cursor", null, barTime(5))).toBe(barTime(5));
    expect(nextPinnedTimestamp("pinned", barTime(5), barTime(5))).toBeNull();
    expect(nextPinnedTimestamp("pinned", barTime(5), barTime(7))).toBe(barTime(7));
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
