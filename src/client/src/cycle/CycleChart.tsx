/**
 * The price chart that follows a Model Cycle run.
 *
 * Drawn only from the bars the model process has emitted, in the order it read
 * them: context bars (the model has not been tested there) at 40% alpha,
 * processed test bars in full colour, a prediction strip under the candles,
 * P(up) and equity panes, trade markers, the fold spans and the block the model
 * is working on right now, and a dashed test cursor.
 *
 * Performance is the design constraint. The store's bars are mutable columns
 * (tens of thousands, arriving at up to 20 frames a second), so this component
 * never reads them during render. A controller subscribes to the store outside
 * React, coalesces every change into one requestAnimationFrame, and per frame
 * calls `series.update()` for the NEW bars only (`planRender` in chartModel.ts
 * decides append vs full reset). Labels that resolve on bars already drawn are
 * drawn by the bands primitive at draw time (see chartBands.ts for why).
 *
 * `CycleChart` takes no props and reads `useCycleStore`; `CycleChartArea` adds
 * the "Back to market chart" bar the Market page shows above it.
 */
import { useEffect, useRef, useState } from "react";
import {
  BaselineSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type Time,
} from "lightweight-charts";

import { createChartOptions } from "@/market/components/chartConfig";
import type { CyclePlan, CycleTrade } from "@shared/cycle/schema";

import { CycleBandsPrimitive } from "./chartBands";
import {
  advanceRendered,
  barIndexAtOrBefore,
  buildBands,
  buildTradeMarkers,
  centreRange,
  CYCLE_COLORS,
  followSpanRange,
  followTestRange,
  followWidth,
  formatSignedUsd,
  mapBars,
  phaseWord,
  planRender,
  rangesDiffer,
  readoutAt,
  spanToLogical,
  tickDecimals,
  withAlpha,
  type BarReadout,
  type LogicalSpan,
  type RenderedBars,
} from "./chartModel";
import { useCycleStore, type CycleState } from "./store";

/** Pane heights, percent: candles / P(up) / equity. */
const PANE_STRETCH = [62, 19, 19] as const;
/** Top margin of the prediction strip's own price scale: the strip is the bottom 8% of pane 0. */
const STRIP_TOP_FRACTION = 0.92;
/** Span follow (training / validating / tuning) moves the view at most this often. */
const SPAN_FOLLOW_INTERVAL_MILLISECONDS = 250;
/** A visible-range change within this long of a wheel or drag is the user's, and turns follow off. */
const GESTURE_WINDOW_MILLISECONDS = 800;
const FOCUS_FLASH_MILLISECONDS = 1500;

interface HoverState {
  readout: BarReadout;
  /** Crosshair x in chart pixels. */
  x: number;
  /** Place the readout to the left of the crosshair (it is on the right half). */
  placeLeft: boolean;
}

interface ControllerHandlers {
  onHover: (hover: HoverState | null) => void;
}

/** Owns the lightweight-charts instance and the store → series pipeline. Not React. */
class CycleChartController {
  private readonly container: HTMLDivElement;
  private readonly handlers: ControllerHandlers;
  private readonly chart: IChartApi;
  private readonly candles: ISeriesApi<"Candlestick">;
  private readonly strip: ISeriesApi<"Histogram">;
  private readonly probability: ISeriesApi<"Line">;
  private readonly equity: ISeriesApi<"Baseline">;
  private readonly markers: ISeriesMarkersPluginApi<Time>;
  private readonly bands = new CycleBandsPrimitive();
  private readonly unsubscribe: () => void;

  private rendered: RenderedBars | null = null;
  private frameHandle: number | null = null;
  private renderedPlan: CyclePlan | null = null;
  private renderedCursor: CycleState["cursor"] = null;
  private renderedTrades: CycleTrade[] | null = null;
  private pendingMarkerTimestamp: number | null = null;
  private priceLines: IPriceLine[] = [];

  private followWasOn = false;
  private lastSpanKey = "";
  /** Entry threshold from the plan; the P(up) axis always keeps both entry lines in view. */
  private entryProbability = 0.55;
  private lastSpanFollowAt = 0;
  private spanFollowTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set when a throttled span follow is due; the next frame applies it. */
  private spanFollowDue = false;
  private programmatic = false;
  private gestureUntil = 0;
  private dragging = false;

  private handledFocus: number | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  public constructor(container: HTMLDivElement, handlers: ControllerHandlers) {
    this.container = container;
    this.handlers = handlers;

    const base = createChartOptions();
    this.chart = createChart(container, {
      ...base,
      autoSize: true,
      timeScale: { ...base.timeScale, shiftVisibleRangeOnNewBar: true },
      rightPriceScale: { ...base.rightPriceScale, scaleMargins: { top: 0.14, bottom: 1 - STRIP_TOP_FRACTION + 0.04 } },
    });

    this.candles = this.chart.addSeries(
      CandlestickSeries,
      {
        upColor: CYCLE_COLORS.up,
        downColor: CYCLE_COLORS.down,
        borderUpColor: CYCLE_COLORS.up,
        borderDownColor: CYCLE_COLORS.down,
        wickUpColor: CYCLE_COLORS.up,
        wickDownColor: CYCLE_COLORS.down,
        priceFormat: { type: "price", precision: 2, minMove: 0.25 },
      },
      0,
    );
    this.candles.attachPrimitive(this.bands);
    this.bands.stripTopFraction = STRIP_TOP_FRACTION;

    this.strip = this.chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: "prediction-strip",
        base: 0,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }),
      },
      0,
    );
    this.strip.priceScale().applyOptions({ scaleMargins: { top: STRIP_TOP_FRACTION, bottom: 0 }, visible: false });

    this.probability = this.chart.addSeries(
      LineSeries,
      {
        color: CYCLE_COLORS.sky,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "P(up)",
        priceFormat: { type: "price", precision: 3, minMove: 0.001 },
        // Scale to the probabilities actually drawn plus both entry lines. A
        // fixed 0..1 axis flattened the line into a strip around 0.5, because
        // these models rarely move P(up) more than a few points.
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const range = original()?.priceRange;
          const entry = this.entryProbability;
          const low = Math.min(range?.minValue ?? 0.5, 1 - entry);
          const high = Math.max(range?.maxValue ?? 0.5, entry);
          const pad = Math.max(0.01, (high - low) * 0.08);
          return { priceRange: { minValue: Math.max(0, low - pad), maxValue: Math.min(1, high + pad) } };
        },
      },
      1,
    );

    this.equity = this.chart.addSeries(
      BaselineSeries,
      {
        baseValue: { type: "price", price: 0 },
        topLineColor: CYCLE_COLORS.up,
        topFillColor1: withAlpha(CYCLE_COLORS.up, 0.28),
        topFillColor2: withAlpha(CYCLE_COLORS.up, 0.04),
        bottomLineColor: CYCLE_COLORS.down,
        bottomFillColor1: withAlpha(CYCLE_COLORS.down, 0.04),
        bottomFillColor2: withAlpha(CYCLE_COLORS.down, 0.28),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "Equity",
        priceFormat: { type: "custom", minMove: 0.01, formatter: (price: number) => formatSignedUsd(price) },
      },
      2,
    );

    const panes = this.chart.panes();
    panes.forEach((pane, index) => pane.setStretchFactor(PANE_STRETCH[index] ?? 19));
    const titleColor = "rgba(255, 255, 255, 0.45)";
    if (panes[1]) {
      createTextWatermark(panes[1], {
        horzAlign: "left",
        vertAlign: "top",
        lines: [{ text: "P(up) — the model's probability the next move is up · dashed: entry thresholds", color: titleColor, fontSize: 11 }],
      });
    }
    if (panes[2]) {
      createTextWatermark(panes[2], {
        horzAlign: "left",
        vertAlign: "top",
        lines: [{ text: "Equity, USD net of costs — orange above zero, blue below", color: titleColor, fontSize: 11 }],
      });
    }

    this.markers = createSeriesMarkers(this.candles, []);

    this.chart.subscribeCrosshairMove((param) => {
      const count = this.rendered?.count ?? 0;
      if (!param.point || param.logical === undefined || param.logical === null || count === 0) {
        this.handlers.onHover(null);
        return;
      }
      const index = Math.round(param.logical);
      const readout = index >= 0 && index < count ? readoutAt(useCycleStore.getState().bars, index) : null;
      if (!readout) {
        this.handlers.onHover(null);
        return;
      }
      this.handlers.onHover({ readout, x: param.point.x, placeLeft: param.point.x > this.container.clientWidth / 2 });
    });

    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (this.programmatic) return;
      if (performance.now() > this.gestureUntil) return;
      const state = useCycleStore.getState();
      if (state.follow) state.setFollow(false);
    });

    container.addEventListener("wheel", this.onWheel, { capture: true, passive: true });
    container.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    container.addEventListener("pointermove", this.onPointerMove, { capture: true });
    window.addEventListener("pointerup", this.onPointerUp, { capture: true });

    this.unsubscribe = useCycleStore.subscribe((state, previous) => {
      if (
        state.barsVersion !== previous.barsVersion ||
        state.barsEpoch !== previous.barsEpoch ||
        state.bars !== previous.bars ||
        state.cursor !== previous.cursor ||
        state.plan !== previous.plan ||
        state.trades !== previous.trades ||
        state.follow !== previous.follow ||
        state.focusTimestamp !== previous.focusTimestamp
      ) {
        this.schedule();
      }
    });
    this.schedule();
  }

  public dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    if (this.spanFollowTimer !== null) clearTimeout(this.spanFollowTimer);
    this.container.removeEventListener("wheel", this.onWheel, { capture: true });
    this.container.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.container.removeEventListener("pointermove", this.onPointerMove, { capture: true });
    window.removeEventListener("pointerup", this.onPointerUp, { capture: true });
    this.chart.remove();
  }

  // ── User gestures (what separates a user pan/zoom from our own scrolling) ──

  private readonly onWheel = () => {
    this.gestureUntil = performance.now() + GESTURE_WINDOW_MILLISECONDS;
  };

  private readonly onPointerDown = () => {
    this.dragging = true;
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.dragging && event.buttons !== 0) this.gestureUntil = performance.now() + GESTURE_WINDOW_MILLISECONDS;
  };

  private readonly onPointerUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    // Kinetic scroll keeps moving the range after release.
    this.gestureUntil = Math.max(this.gestureUntil, performance.now() + GESTURE_WINDOW_MILLISECONDS);
  };

  private schedule(): void {
    if (this.disposed || this.frameHandle !== null) return;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private setRange(range: LogicalSpan): void {
    this.programmatic = true;
    try {
      this.chart.timeScale().setVisibleLogicalRange({ from: range.from as Logical, to: range.to as Logical });
    } finally {
      this.programmatic = false;
    }
  }

  // ── One frame ──────────────────────────────────────────────────────────

  private readonly frame = () => {
    this.frameHandle = null;
    if (this.disposed) return;
    const started = performance.now();
    const state = useCycleStore.getState();
    const columns = state.bars;
    const timestamps = columns.timestamps;

    const store = {
      epoch: state.barsEpoch,
      version: state.barsVersion,
      count: timestamps.length,
      timestampAtRenderedEnd: this.rendered && this.rendered.count > 0 ? (timestamps[this.rendered.count - 1] ?? null) : null,
    };
    const plan = planRender(this.rendered, store);
    if (plan.kind === "reset") {
      const mapped = mapBars(columns, 0, plan.count);
      this.candles.setData(mapped.candles);
      this.strip.setData(mapped.strip);
      this.probability.setData(mapped.probability);
      this.equity.setData(mapped.equity);
      this.renderedTrades = null;
      this.lastSpanKey = "";
    } else if (plan.kind === "append") {
      const mapped = mapBars(columns, plan.from, plan.to);
      for (let offset = 0; offset < mapped.candles.length; offset += 1) {
        this.candles.update(mapped.candles[offset]!);
        this.strip.update(mapped.strip[offset]!);
        this.probability.update(mapped.probability[offset]!);
        this.equity.update(mapped.equity[offset]!);
      }
    }
    this.rendered = advanceRendered(this.rendered, store, plan, timestamps);
    const barsChanged = plan.kind === "reset" || plan.kind === "append";
    if (barsChanged) this.bands.setBars(columns, this.rendered.count);
    else if (plan.kind === "refresh") this.bands.refresh();

    if (state.plan !== this.renderedPlan) {
      this.renderedPlan = state.plan;
      this.applyPlan(state.plan);
    }

    const cursorChanged = state.cursor !== this.renderedCursor;
    if (cursorChanged || barsChanged) {
      this.renderedCursor = state.cursor;
      this.bands.setLayout(buildBands(state.plan, state.cursor, this.rendered.lastTimestamp));
    }

    const lastTimestamp = this.rendered.lastTimestamp;
    if (
      state.trades !== this.renderedTrades ||
      (this.pendingMarkerTimestamp !== null && lastTimestamp !== null && lastTimestamp >= this.pendingMarkerTimestamp)
    ) {
      this.renderedTrades = state.trades;
      const set = buildTradeMarkers(state.trades, lastTimestamp);
      this.markers.setMarkers(set.markers);
      this.pendingMarkerTimestamp = set.pendingTimestamp;
    }

    this.applyFocus(state);
    if (state.follow && state.focusTimestamp === null) this.applyFollow(state, barsChanged || cursorChanged);
    this.followWasOn = state.follow;

    const elapsed = performance.now() - started;
    this.container.dataset.renderedBars = String(this.rendered.count);
    this.container.dataset.lastFrameMilliseconds = elapsed.toFixed(2);
  };

  private applyPlan(plan: CyclePlan | null): void {
    for (const line of this.priceLines) this.probability.removePriceLine(line);
    this.priceLines = [];
    if (!plan) return;
    const tick = plan.costModel.tickSize;
    this.candles.applyOptions({ priceFormat: { type: "price", precision: tickDecimals(tick), minMove: tick } });
    const entry = plan.trading.entryProbability;
    this.entryProbability = entry;
    this.priceLines.push(
      this.probability.createPriceLine({
        price: entry,
        color: CYCLE_COLORS.up,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `enter long ≥ ${entry.toFixed(2)}`,
      }),
      this.probability.createPriceLine({
        price: 0.5,
        color: withAlpha(CYCLE_COLORS.neutral, 0.7),
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: "even 0.50",
      }),
    );
    if (!plan.trading.longOnly) {
      this.priceLines.push(
        this.probability.createPriceLine({
          price: 1 - entry,
          color: CYCLE_COLORS.down,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `enter short ≤ ${(1 - entry).toFixed(2)}`,
        }),
      );
    }
  }

  private applyFocus(state: CycleState): void {
    const target = state.focusTimestamp;
    const count = this.rendered?.count ?? 0;
    if (target === null || target === this.handledFocus || count === 0) return;
    this.handledFocus = target;
    const timestamps = state.bars.timestamps;
    const index = Math.max(0, Math.min(count - 1, barIndexAtOrBefore(timestamps, target)));
    const visible = this.chart.timeScale().getVisibleLogicalRange();
    this.setRange(centreRange(index, followWidth(visible ? visible.to - visible.from : null)));
    this.bands.setFlash(timestamps[index] ?? null);
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.handledFocus = null;
      this.bands.setFlash(null);
      const now = useCycleStore.getState();
      if (now.focusTimestamp === target) now.setFocusTimestamp(null);
    }, FOCUS_FLASH_MILLISECONDS);
  }

  private applyFollow(state: CycleState, somethingMoved: boolean): void {
    const count = this.rendered?.count ?? 0;
    if (count === 0) return;
    const justTurnedOn = !this.followWasOn;
    const due = this.spanFollowDue;
    this.spanFollowDue = false;
    if (!somethingMoved && !justTurnedOn && !due) return;
    const timeScale = this.chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    const current: LogicalSpan | null = visible ? { from: visible.from, to: visible.to } : null;
    const width = followWidth(current ? current.to - current.from : null);
    const cursor = state.cursor;
    const timestamps = state.bars.timestamps;

    let target: LogicalSpan | null = null;
    if (!cursor || cursor.phase === "loading") {
      target = followTestRange(count - 1, width);
    } else if (cursor.phase === "testing" && cursor.barTimestamp !== null) {
      const index = Math.min(count - 1, barIndexAtOrBefore(timestamps, cursor.barTimestamp));
      if (index >= 0) target = followTestRange(index, width);
    } else if (cursor.phase === "training" || cursor.phase === "validating" || cursor.phase === "tuning") {
      let start = cursor.spanStart;
      let end = cursor.spanEnd;
      if ((start === null || end === null) && cursor.phase === "tuning" && state.plan?.tuning) {
        start = state.plan.tuning.start;
        end = state.plan.tuning.end;
      }
      if (start === null || end === null) return;
      const key = `${start}:${end}`;
      if (key === this.lastSpanKey && !justTurnedOn) return;
      const now = performance.now();
      const wait = this.lastSpanFollowAt + SPAN_FOLLOW_INTERVAL_MILLISECONDS - now;
      if (wait > 0 && !justTurnedOn && !due) {
        // Throttled: come back when the interval has passed so the latest span is not lost.
        if (this.spanFollowTimer === null) {
          this.spanFollowTimer = setTimeout(() => {
            this.spanFollowTimer = null;
            this.spanFollowDue = true;
            this.schedule();
          }, wait);
        }
        return;
      }
      const logical = spanToLogical(timestamps, start, end);
      if (!logical) return;
      const last = Math.min(logical.to - 0.5, count - 1);
      target = followSpanRange(logical.from + 0.5, last);
      this.lastSpanKey = key;
      this.lastSpanFollowAt = now;
    }
    if (target && rangesDiffer(current, target)) this.setRange(target);
  }
}

// ─── React ─────────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  return Number.isInteger(value) ? value.toFixed(2) : value.toFixed(Math.min(5, Math.max(2, String(value).split(".")[1]?.length ?? 2)));
}

function ReadoutBox({ hover }: { hover: HoverState }) {
  const readout = hover.readout;
  const style = hover.placeLeft ? { right: `calc(100% - ${hover.x - 14}px)` } : { left: hover.x + 14 };
  const labelTone =
    readout.labelWord === "correct" ? CYCLE_COLORS.sky : readout.labelWord === "wrong" ? CYCLE_COLORS.vermillion : undefined;
  return (
    <div
      className="pointer-events-none absolute top-24 z-20 min-w-[210px] rounded-md border border-white/15 bg-[rgba(11,15,22,0.92)] px-2.5 py-2 font-mono text-[11px] leading-[1.45] text-foreground/90 shadow-lg"
      style={style}
      data-testid="cycle-chart-readout"
    >
      <div className="text-foreground">{readout.timeText}</div>
      <div className="text-muted-foreground">
        {readout.role === "processed" ? "test bar — the model predicted it" : "context bar — the model was not tested here"}
      </div>
      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
        <span className="text-muted-foreground">open</span>
        <span>{formatPrice(readout.open)}</span>
        <span className="text-muted-foreground">high</span>
        <span>{formatPrice(readout.high)}</span>
        <span className="text-muted-foreground">low</span>
        <span>{formatPrice(readout.low)}</span>
        <span className="text-muted-foreground">close</span>
        <span>{formatPrice(readout.close)}</span>
        {readout.role === "processed" && (
          <>
            <span className="text-muted-foreground">P(up)</span>
            <span>{readout.probabilityUp === null ? "none" : readout.probabilityUp.toFixed(3)}</span>
            <span className="text-muted-foreground">predicts</span>
            <span>
              {readout.predictedDirectionWord === "up" ? "▲ " : readout.predictedDirectionWord === "down" ? "▼ " : ""}
              {readout.predictedDirectionWord}
            </span>
            <span className="text-muted-foreground">position</span>
            <span>{readout.positionWord}</span>
            <span className="text-muted-foreground">equity</span>
            <span>{readout.equityUsd === null ? "none" : formatSignedUsd(readout.equityUsd)}</span>
            <span className="text-muted-foreground">label</span>
            <span style={labelTone ? { color: labelTone } : undefined}>
              {readout.labelGlyph} {readout.labelWord}
              {readout.actualDirectionWord ? ` (moved ${readout.actualDirectionWord})` : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Swatch({ color, border }: { color: string; border?: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color, border: border ? `1px solid ${border}` : undefined }} />;
}

function ChartKey() {
  // Closed by default: open, it covers the newest candles at the top of the pane.
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto rounded-md border border-white/10 bg-[rgba(11,15,22,0.82)] px-2 py-1 text-[10px] leading-[1.5] text-foreground/80">
      <button type="button" className="font-mono text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        {open ? "▾ Key" : "▸ Key"}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          <div>
            <span style={{ color: CYCLE_COLORS.up }}>▲</span> long entry · <span style={{ color: CYCLE_COLORS.down }}>▼</span> short entry
          </div>
          <div>● exit (orange = profit, blue = loss, amount shown)</div>
          <div>strip: orange = predicts up, blue = predicts down, stronger = more confident</div>
          <div>
            <span style={{ color: CYCLE_COLORS.sky }}>■</span> label correct · <span style={{ color: CYCLE_COLORS.vermillion }}>✗</span> label wrong ·
            <span className="text-muted-foreground"> • not scored</span>
          </div>
          <div>faded candles: context, the model was not tested there</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5">
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.sky, 0.35)} border={CYCLE_COLORS.sky} /> training
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.yellow, 0.35)} border={CYCLE_COLORS.yellow} /> validation
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.up, 0.25)} border={CYCLE_COLORS.up} /> test walk
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.active, 0.45)} border={CYCLE_COLORS.active} /> working on now
            </span>
            <span className="flex items-center gap-1">
              <span style={{ color: CYCLE_COLORS.active }}>┊</span> model is here
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The cycle price chart. Takes no props; reads `useCycleStore`. */
export function CycleChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const plan = useCycleStore((state) => state.plan);
  const cursor = useCycleStore((state) => state.cursor);
  const follow = useCycleStore((state) => state.follow);
  const setFollow = useCycleStore((state) => state.setFollow);
  const barCount = useCycleStore((state) => state.barCount);
  const modelType = useCycleStore((state) => state.modelType);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const controller = new CycleChartController(container, { onHover: setHover });
    return () => controller.dispose();
  }, []);

  const legend = [plan?.symbol, plan?.timeframe, plan?.modelLabel ?? modelType].filter(Boolean).join(" · ");

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 overflow-hidden" data-testid="cycle-chart">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute left-2 top-1 z-10 flex items-center gap-2 font-mono text-[11px]">
        <span className="text-foreground/90">{legend || "Model cycle"}</span>
        <span className="text-muted-foreground">·</span>
        <span style={{ color: CYCLE_COLORS.active }}>{phaseWord(cursor)}</span>
        <span className="text-muted-foreground">· {barCount.toLocaleString()} bars read</span>
      </div>

      <div className="absolute right-[72px] top-1 z-10 flex max-w-[360px] flex-col items-end gap-1">
        {follow ? (
          <span className="rounded border border-white/10 bg-[rgba(11,15,22,0.8)] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            ◉ following the model
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="rounded border px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-white/10"
            style={{ borderColor: CYCLE_COLORS.active, background: "rgba(11,15,22,0.9)" }}
            data-testid="cycle-chart-follow"
          >
            ◎ Follow the model
          </button>
        )}
        <ChartKey />
      </div>

      {barCount === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-xs text-muted-foreground">
          Waiting for the model to read its first bars…
        </div>
      )}

      {hover && <ReadoutBox hover={hover} />}
    </div>
  );
}

const STATUS_WORDS: Record<CycleState["status"], string> = {
  idle: "idle",
  starting: "starting",
  running: "running",
  complete: "complete",
  failed: "failed",
  stopped: "stopped",
};

/** The Market page's swap-in: a slim "Back to market chart" bar above the cycle chart. */
export function CycleChartArea() {
  const plan = useCycleStore((state) => state.plan);
  const modelType = useCycleStore((state) => state.modelType);
  const status = useCycleStore((state) => state.status);
  const setShowOnChart = useCycleStore((state) => state.setShowOnChart);
  const family = plan?.modelLabel ?? plan?.modelFamily ?? modelType ?? "model";
  const instrument = plan ? `${plan.symbol} ${plan.timeframe}` : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="cycle-chart-area">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 py-1 text-[11px]">
        <span style={{ color: CYCLE_COLORS.active }}>▶</span>
        <span className="text-muted-foreground">Showing model cycle run</span>
        <span className="font-mono text-foreground/90">
          {family}
          {instrument ? ` · ${instrument}` : ""}
        </span>
        <span className="text-muted-foreground">({STATUS_WORDS[status]})</span>
        <button
          type="button"
          onClick={() => setShowOnChart(false)}
          className="ml-auto rounded border border-white/15 px-2 py-0.5 text-[11px] text-foreground/90 hover:bg-white/10"
          data-testid="cycle-chart-back"
        >
          ← Back to market chart
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <CycleChart />
      </div>
    </div>
  );
}
