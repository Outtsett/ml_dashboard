/**
 * The Model Cycle run drawn ON the Market chart.
 *
 * The run used to replace the chart: the Market page swapped `TradingChart` out
 * for a second, hand-rolled lightweight-charts instance (`CycleChart.tsx`), and
 * everything the market chart does — indicator panes, support/resistance,
 * zigzag, the toolbar's chart toggles, the published window every other surface
 * reads — went with it. This hook is the other half of that decision: the run
 * becomes a source of marks on the ONE chart, and the run's pure maths
 * (`chartModel.ts`, where all of it is tested) is reused as it stands.
 *
 * What the run owns here, and nothing else:
 *  - the fold/active span bands, the test cursor, the on-candle prediction
 *    glyphs, the hover label-move segment and the focus flash, drawn by
 *    `CycleBandsPrimitive` attached to the market chart's candle series;
 *  - the price model's forecast line;
 *  - "follow the model", and the focus jumps a folds or trades table row asks for;
 *  - the crosshair readout, the one thing the market chart's own HUD cannot
 *    express (it knows OHLC, not what the model predicted on this bar).
 *
 * What it deliberately does NOT own: the candles, the panels, or the markers.
 * Those travel as ordinary props — the bars through the chart's `data` prop, the
 * panels through the layout's `extraPanels`, the trades through the chart's
 * single markers plugin — which is what keeps every derived layer (the 151
 * indicators, support/resistance) on the same bars the model read.
 *
 * There is one visual element of the old training chart that does not survive:
 * the prediction strip, the 8%-tall confidence histogram along the bottom of the
 * candle pane. The market chart's volume histogram already occupies that band
 * (`volumeScaleMargins`), and two overlays in 18% of the pane overprint each
 * other. Nothing is lost — the glyph carries the direction, the `P(up)` panel
 * carries the confidence at full height, and the readout gives the exact number.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type LogicalRange,
} from "lightweight-charts";
import type { CyclePlan } from "@shared/cycle/schema";

import { CycleBandsPrimitive } from "./chartBands";
import { useCycleStore, type CycleState } from "./store";
import {
  appendForecast,
  barIndexAtOrBefore,
  buildBands,
  centreRange,
  drawnRunBars,
  emptyForecastTrack,
  forecastHeadIndex,
  forecastOnlyReadout,
  followSpanRange,
  followTestRange,
  followWidth,
  INSPECT_PUBLISH_INTERVAL_MILLISECONDS,
  nextPinnedTimestamp,
  rangesDiffer,
  readoutAt,
  spanToLogical,
  tickDecimals,
  TrailingThrottle,
  CYCLE_COLORS,
  type BarReadout,
  type DrawnShape,
  type ForecastOnlyReadout,
  type ForecastTrack,
  type LogicalSpan,
} from "./chartModel";

/** Span follow (training / validating / tuning) moves the view at most this often. */
const SPAN_FOLLOW_INTERVAL_MILLISECONDS = 250;
/** A visible-range change within this long of a wheel or drag is the user's, and turns follow off. */
const GESTURE_WINDOW_MILLISECONDS = 800;
const FOCUS_FLASH_MILLISECONDS = 1500;
/**
 * The chart applies the run's bars on its own frame, so a pass often lands while
 * the series still holds the market's own bars. Come back this often to re-frame
 * once it has them — bounded, because a chart that never does must not spin.
 */
const FOLLOW_RETRY_INTERVAL_MILLISECONDS = 60;
const FOLLOW_RETRY_MAXIMUM_ATTEMPTS = 40;

export interface RunHoverState {
  /** The hovered candle; null when hovering the forecast line ahead of the newest candle. */
  readout: BarReadout | null;
  /** A forecast point whose bar has not arrived yet. */
  forecastOnly: ForecastOnlyReadout | null;
  /** Crosshair x in chart pixels. */
  x: number;
  /** Place the readout to the left of the crosshair (it is on the right half). */
  placeLeft: boolean;
}

/** The chart, its candle series and its DOM node — everything a primitive needs to attach. */
export interface RunOverlayTarget {
  chart: IChartApi;
  candleSeries: ISeriesApi<"Candlestick">;
  container: HTMLElement;
}

interface RunOverlayInput {
  /**
   * Called once with an `attach` function. Whoever owns the chart calls `attach`
   * with the chart as it is built, and with `null` when it is torn down.
   *
   * The overlay attaches imperatively rather than through props because what it
   * draws is not data: a primitive on the candle series, a second series for the
   * forecast, and crosshair/click subscriptions. The run's bars, panels and
   * markers travel as ordinary props (see `useRunChartData`), which is what
   * keeps them on the same bars as every other layer.
   */
  onChartReady: (attach: (target: RunOverlayTarget | null) => void) => void;
}

/** Is a run being shown on the chart? One definition, read from the store by every consumer. */
export function runIsShown(state: Pick<CycleState, "modelId" | "showOnChart">): boolean {
  return state.modelId !== null && state.showOnChart;
}

export function useRunOverlay({ onChartReady }: RunOverlayInput): RunHoverState | null {
  const [hover, setHover] = useState<RunHoverState | null>(null);

  const bandsRef = useRef<CycleBandsPrimitive | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const forecastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const forecastTrackRef = useRef<ForecastTrack>(emptyForecastTrack());
  const drawnCountRef = useRef(0);
  const renderedEpochRef = useRef<number | null>(null);
  const renderedPlanRef = useRef<CyclePlan | null>(null);
  const renderedCursorRef = useRef<CycleState["cursor"]>(null);
  const followWasOnRef = useRef(false);
  const lastSpanKeyRef = useRef("");
  const lastSpanFollowAtRef = useRef(0);
  const programmaticRef = useRef(false);
  const gestureUntilRef = useRef(0);
  const draggingRef = useRef(false);
  const handledFocusRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  /** Set while a throttled span follow is due, so the next pass applies it. */
  const spanFollowDueRef = useRef(false);
  const spanFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Re-checks spent waiting for the chart to hold the run's bars; reset when it moves. */
  const followRetryRef = useRef(0);
  /** True until a pass has seen the run on the chart, so the first one re-frames. */
  const wasHiddenRef = useRef(true);
  /** `render` is defined below `applyFollow`, which schedules it; a ref breaks the cycle. */
  const renderRef = useRef<() => void>(() => {});

  /**
   * Come back shortly while the chart still trails the store, so the frame that
   * pins the view to the newest candle lands on the run's bars and not on the
   * market's. Shares the span-follow timer slot: both schedule one pass, and
   * `spanFollowDueRef` carries whichever framing was waiting.
   */
  const armFollowRetry = useCallback(() => {
    if (spanFollowTimerRef.current !== null) return;
    if (followRetryRef.current >= FOLLOW_RETRY_MAXIMUM_ATTEMPTS) return;
    followRetryRef.current += 1;
    spanFollowTimerRef.current = setTimeout(() => {
      spanFollowTimerRef.current = null;
      renderRef.current();
    }, FOLLOW_RETRY_INTERVAL_MILLISECONDS);
  }, []);

  /** Bars of the RUN the chart is actually holding; the market's own bars count as none. */
  const drawnCount = useCallback((): number => {
    const series = seriesRef.current;
    if (!series) return 0;
    try {
      const data = series.data();
      const drawn: DrawnShape = {
        count: data.length,
        first: data.length > 0 ? (data[0]!.time as number) : null,
        last: data.length > 0 ? (data[data.length - 1]!.time as number) : null,
      };
      return drawnRunBars(drawn, useCycleStore.getState().bars.timestamps);
    } catch {
      return 0;
    }
  }, []);

  const setRange = useCallback((range: LogicalSpan) => {
    const chart = bandsRef.current?.chart;
    if (!chart) return;
    programmaticRef.current = true;
    try {
      chart.timeScale().setVisibleLogicalRange({ from: range.from as Logical, to: range.to as Logical });
    } catch {
      /* the chart was disposed mid-pass */
    } finally {
      programmaticRef.current = false;
    }
  }, []);

  const applyFollow = useCallback((state: CycleState, somethingMoved: boolean) => {
    const bands = bandsRef.current;
    const count = drawnCount();
    if (!bands || count === 0) return;
    const justTurnedOn = !followWasOnRef.current;
    const due = spanFollowDueRef.current;
    spanFollowDueRef.current = false;
    if (!somethingMoved && !justTurnedOn && !due) return;

    const chart = bands.chart;
    if (!chart) return;
    const visible = chart.timeScale().getVisibleLogicalRange();
    const current: LogicalSpan | null = visible ? { from: visible.from, to: visible.to } : null;
    const width = followWidth(current ? current.to - current.from : null);
    const runCursor = state.cursor;
    const timestamps = state.bars.timestamps;
    const forecastHead = forecastHeadIndex(forecastTrackRef.current, count, timestamps[count - 1] ?? null);

    let target: LogicalSpan | null = null;
    if (!runCursor || runCursor.phase === "loading") {
      target = followTestRange(count - 1, width, forecastHead);
    } else if (runCursor.phase === "testing" && runCursor.barTimestamp !== null) {
      const index = Math.min(count - 1, barIndexAtOrBefore(timestamps, runCursor.barTimestamp));
      if (index >= 0) target = followTestRange(index, width, forecastHead);
    } else if (runCursor.phase === "training" || runCursor.phase === "validating" || runCursor.phase === "tuning") {
      let start = runCursor.spanStart;
      let end = runCursor.spanEnd;
      if ((start === null || end === null) && runCursor.phase === "tuning" && state.plan?.tuning) {
        start = state.plan.tuning.start ?? null;
        end = state.plan.tuning.end ?? null;
      }
      if (start === null || end === null) return;
      const key = `${start}:${end}`;
      // A span the chart is already showing is not re-framed: the user panned away
      // mid-span, and follow must not drag them back on the next batch.
      if (key === lastSpanKeyRef.current && !justTurnedOn && !due) return;
      const now = performance.now();
      const wait = lastSpanFollowAtRef.current + SPAN_FOLLOW_INTERVAL_MILLISECONDS - now;
      if (wait > 0 && !justTurnedOn && !due) {
        // Throttled: come back when the interval has passed, so the latest span is
        // applied rather than dropped. Without the timer a due follow would sit
        // waiting for a store change that may never come.
        spanFollowDueRef.current = true;
        if (spanFollowTimerRef.current === null) {
          spanFollowTimerRef.current = setTimeout(() => {
            spanFollowTimerRef.current = null;
            renderRef.current();
          }, wait);
        }
        return;
      }
      const logical = spanToLogical(timestamps, start, end);
      if (!logical) return;
      target = followSpanRange(logical.from + 0.5, Math.min(logical.to - 0.5, count - 1));
      lastSpanKeyRef.current = key;
      lastSpanFollowAtRef.current = now;
    }
    if (target && rangesDiffer(current, target)) setRange(target);
  }, [drawnCount, setRange]);

  const applyFocus = useCallback((state: CycleState) => {
    const bands = bandsRef.current;
    const count = drawnCount();
    if (!bands || !bands.chart) return;
    const target = state.focusTimestamp;
    if (target === null || target === handledFocusRef.current || count === 0) return;
    handledFocusRef.current = target;
    const timestamps = state.bars.timestamps;
    const index = Math.max(0, Math.min(count - 1, barIndexAtOrBefore(timestamps, target)));
    const visible = bands.chart.timeScale().getVisibleLogicalRange();
    setRange(centreRange(index, followWidth(visible ? visible.to - visible.from : null)));
    bands.setFlash(timestamps[index] ?? null);
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      handledFocusRef.current = null;
      bandsRef.current?.setFlash(null);
      const now = useCycleStore.getState();
      if (now.focusTimestamp === target) now.setFocusTimestamp(null);
    }, FOCUS_FLASH_MILLISECONDS);
  }, [drawnCount, setRange]);

  /** One pass of the run's state onto the chart. Runs on every relevant store change. */
  const render = useCallback(() => {
    const bands = bandsRef.current;
    const forecast = forecastRef.current;
    if (!bands || !forecast || !bands.chart) return;
    const state = useCycleStore.getState();
    if (!runIsShown(state)) {
      wasHiddenRef.current = true;
      return;
    }
    if (wasHiddenRef.current) {
      // Shown on the chart for the first time, or shown again after being
      // hidden. Nothing about the run moved, so only this can frame it.
      wasHiddenRef.current = false;
      followWasOnRef.current = false;
      lastSpanKeyRef.current = "";
      armFollowRetry();
    }

    const columns = state.bars;
    const count = columns.timestamps.length;
    // The market pipeline applies bars on its own frame, so this can trail the
    // store by one batch — and before that first application the series still
    // holds the MARKET's bars. A glyph placed on a bar the chart has not plotted
    // yet would be given a coordinate that does not exist, so only the run's own
    // drawn bars count.
    const drawn = Math.min(count, drawnCount());
    const previousDrawn = drawnCountRef.current;
    const barsChanged = drawn !== previousDrawn;
    drawnCountRef.current = drawn;
    bands.setBars(columns, drawn);

    // The chart moving is progress: the re-check budget starts over. While it has
    // not moved, the pass cannot frame anything, so come back and try again.
    if (drawn !== previousDrawn) followRetryRef.current = 0;
    if (state.follow && drawn < count) armFollowRetry();
    if (state.focusTimestamp !== null && drawn === 0) armFollowRetry();

    const epochChanged =
      renderedEpochRef.current !== null && renderedEpochRef.current !== state.barsEpoch;
    if (renderedEpochRef.current === null || epochChanged) {
      // A new run: the forecast track belongs to the old one.
      forecastTrackRef.current = emptyForecastTrack();
      forecast.setData(appendForecast(forecastTrackRef.current, columns, 0, count));
      bands.setForecastTimes(forecastTrackRef.current.times);
      renderedEpochRef.current = state.barsEpoch;
      lastSpanKeyRef.current = "";
      followWasOnRef.current = false;
      bands.refresh();
    } else if (barsChanged) {
      // Only the new bars' forecasts are appended; a reset of the track would
      // re-set the whole line on every batch.
      const from = Math.max(0, previousDrawn - 1);
      for (const point of appendForecast(forecastTrackRef.current, columns, from, count)) {
        forecast.update(point);
      }
      bands.setForecastTimes(forecastTrackRef.current.times);
    } else {
      // No new bars — a label that just resolved changes how a drawn glyph reads.
      bands.refresh();
    }

    if (state.plan !== renderedPlanRef.current) {
      renderedPlanRef.current = state.plan;
      bands.setPlan(state.plan);
      const runPlan = state.plan;
      if (runPlan) {
        const tick = runPlan.costModel.tickSize;
        forecast.applyOptions({
          priceFormat: { type: "price", precision: tickDecimals(tick), minMove: tick },
        });
      }
    }

    const cursorChanged = state.cursor !== renderedCursorRef.current;
    if (cursorChanged || barsChanged) {
      renderedCursorRef.current = state.cursor;
      bands.setLayout(buildBands(state.plan, state.cursor, columns.timestamps[drawn - 1] ?? null));
    }

    bands.setPinned(state.inspectSource === "pinned" ? state.inspectTimestamp : null);

    applyFocus(state);
    if (state.follow && state.focusTimestamp === null) applyFollow(state, barsChanged || cursorChanged);
    followWasOnRef.current = state.follow;
  }, [applyFocus, applyFollow, armFollowRetry, drawnCount]);

  renderRef.current = render;

  // Attach to the chart, and detach from whatever it leaves.
  useEffect(() => {
    const attach = (target: RunOverlayTarget | null) => {
      detachRef.current?.();
      detachRef.current = null;
      bandsRef.current = null;
      seriesRef.current = null;
      forecastRef.current = null;
      drawnCountRef.current = 0;
      renderedEpochRef.current = null;
      renderedPlanRef.current = null;
      renderedCursorRef.current = null;
      lastSpanKeyRef.current = "";
      followWasOnRef.current = false;
      followRetryRef.current = 0;
      wasHiddenRef.current = true;
      if (!target) return;

      const { chart, candleSeries, container } = target;
      const bands = new CycleBandsPrimitive();
      candleSeries.attachPrimitive(bands);
      bandsRef.current = bands;
      seriesRef.current = candleSeries;

      const forecast = chart.addSeries(LineSeries, {
        color: CYCLE_COLORS.active,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "forecast",
        crosshairMarkerVisible: true,
        // The candles set the price scale; a wild forecast runs off-screen instead
        // of stretching the axis and flattening every candle.
        autoscaleInfoProvider: () => null,
      });
      forecastRef.current = forecast;

      // The market chart's own crosshair (its HUD) and the run's are separate
      // subscriptions, which is what lets both readouts coexist on one chart.
      const inspectPublisher = new TrailingThrottle<number>(INSPECT_PUBLISH_INTERVAL_MILLISECONDS, (timestamp) =>
        useCycleStore.getState().setInspect(timestamp, "hover"),
      );
      const onCrosshair = (param: {
        point?: { x: number; y: number };
        logical?: Logical | null;
        time?: unknown;
      }) => {
        const state = useCycleStore.getState();
        const drawn = drawnCount();
        if (!param.point || param.logical === undefined || param.logical === null || drawn === 0 || !runIsShown(state)) {
          // The store keeps the last hovered bar when the pointer leaves the chart.
          bands.setHover(null);
          setHover(null);
          return;
        }
        const index = Math.round(param.logical);
        const columns = state.bars;
        const onCandle = index >= 0 && index < drawn;
        const sources = forecastTrackRef.current.sourceByTime;
        const readout = onCandle ? readoutAt(columns, index, sources, state.plan, state.trades) : null;
        bands.setHover(onCandle ? index : null);
        if (onCandle) inspectPublisher.push(columns.timestamps[index]!);
        // Past the newest candle the only thing there is the forecast line.
        const forecastOnly =
          !readout && index >= drawn && typeof param.time === "number"
            ? forecastOnlyReadout(columns, param.time, sources)
            : null;
        if (!readout && !forecastOnly) {
          setHover(null);
          return;
        }
        setHover({
          readout,
          forecastOnly,
          x: param.point.x,
          placeLeft: param.point.x > container.clientWidth / 2,
        });
      };
      chart.subscribeCrosshairMove(onCrosshair);

      // A visible-range change the user just made turns follow off. Without this,
      // the next arriving bar yanks the view back out from under their hand.
      const onRangeChange = (range: LogicalRange | null) => {
        if (!range || programmaticRef.current) return;
        if (performance.now() > gestureUntilRef.current) return;
        const state = useCycleStore.getState();
        if (state.follow) state.setFollow(false);
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);

      const markGesture = () => {
        gestureUntilRef.current = performance.now() + GESTURE_WINDOW_MILLISECONDS;
      };
      const onPointerDown = () => {
        draggingRef.current = true;
        markGesture();
      };
      const onPointerMove = (event: Event) => {
        const pointer = event as PointerEvent;
        if (draggingRef.current && pointer.buttons !== 0) markGesture();
      };
      const onPointerUp = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        // Kinetic scroll keeps moving the range after the pointer is released.
        markGesture();
      };
      container.addEventListener("wheel", markGesture, { capture: true, passive: true });
      container.addEventListener("pointerdown", onPointerDown, { capture: true });
      container.addEventListener("pointermove", onPointerMove, { capture: true });
      window.addEventListener("pointerup", onPointerUp, { capture: true });

      // A click pins a bar for "Inside the model"; clicking it again unpins.
      const onClick = (param: { logical?: Logical | null }) => {
        const drawn = drawnCount();
        if (param.logical === undefined || param.logical === null || drawn === 0) return;
        const index = Math.round(param.logical);
        if (index < 0 || index >= drawn) return;
        const state = useCycleStore.getState();
        const timestamp = state.bars.timestamps[index];
        if (timestamp === undefined) return;
        state.pinInspect(nextPinnedTimestamp(state.inspectSource, state.inspectTimestamp, timestamp));
      };
      chart.subscribeClick(onClick);

      const unsubscribe = useCycleStore.subscribe((state, previous) => {
        if (
          !runIsShown(state) ||
          state.barsVersion !== previous.barsVersion ||
          state.barsEpoch !== previous.barsEpoch ||
          state.bars !== previous.bars ||
          state.cursor !== previous.cursor ||
          state.plan !== previous.plan ||
          state.trades !== previous.trades ||
          state.follow !== previous.follow ||
          state.showOnChart !== previous.showOnChart ||
          state.focusTimestamp !== previous.focusTimestamp ||
          state.inspectSource !== previous.inspectSource ||
          state.inspectTimestamp !== previous.inspectTimestamp
        ) {
          render();
        }
      });

      const initial = useCycleStore.getState();
      bands.setPinned(initial.inspectSource === "pinned" ? initial.inspectTimestamp : null);
      render();

      detachRef.current = () => {
        unsubscribe();
        inspectPublisher.cancel();
        try { chart.unsubscribeCrosshairMove(onCrosshair); } catch { /* disposed */ }
        try { chart.unsubscribeClick(onClick); } catch { /* disposed */ }
        try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange); } catch { /* disposed */ }
        container.removeEventListener("wheel", markGesture, { capture: true });
        container.removeEventListener("pointerdown", onPointerDown, { capture: true });
        container.removeEventListener("pointermove", onPointerMove, { capture: true });
        window.removeEventListener("pointerup", onPointerUp, { capture: true });
        if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
        if (spanFollowTimerRef.current !== null) clearTimeout(spanFollowTimerRef.current);
        spanFollowTimerRef.current = null;
        spanFollowDueRef.current = false;
        followRetryRef.current = 0;
        setHover(null);
      };
    };

    onChartReady(attach);
    return () => {
      detachRef.current?.();
      detachRef.current = null;
    };
  }, [drawnCount, onChartReady, render]);

  return hover;
}
