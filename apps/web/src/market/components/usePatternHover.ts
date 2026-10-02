import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandlestickData, IChartApi, MouseEventParams, Time } from 'lightweight-charts';
import { snapToCandle } from './useSeriesMarkers';
import type { LabelMarker } from './types';
import {
  confirmedPatternTime,
  parsePatternMarkerId,
  patternHoverInfo,
  type MiniBar,
  type PatternHoverInfo,
} from '@/market/lib/patternHover';
import { PATTERN_CARD_WIDTH } from './PatternHoverCard';

/**
 * Pixels above a marked candle's high and below its low that still count as
 * hovering it. The arrow sits in that gap, and a strict hit on a 9px arrow is
 * hard to land; this makes the candle itself and the space its arrow occupies
 * one target.
 */
const HOVER_SLACK_PX = 36;

/** Rough card height, used only to keep it inside the chart vertically. */
const CARD_HEIGHT_ESTIMATE = 330;

export interface PatternBand {
  left: number;
  width: number;
  height: number;
}

export interface PatternHoverState {
  info: PatternHoverInfo;
  card: { left: number; top: number };
  /** The pattern's bars on the chart, as a horizontal span in pixels. */
  band: PatternBand | null;
}

interface Options {
  chartRef: React.MutableRefObject<IChartApi | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candleSeriesRef: React.MutableRefObject<any>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  labelMarkers: LabelMarker[];
  candles: CandlestickData<Time>[];
  timeframeSec: number;
}

/**
 * Tracks which candlestick-pattern arrow the pointer is on and what to show.
 *
 * lightweight-charts reports the hovered marker as `hoveredObjectId`; the
 * markers carry `patternMarkerId(time)` so the id names the bar directly. The
 * candle under an arrow counts as well — see HOVER_SLACK_PX.
 *
 * State changes only when the hovered bar changes, so moving the pointer
 * across one arrow does not re-render the chart on every mouse event.
 */
export function usePatternHover({
  chartRef,
  candleSeriesRef,
  containerRef,
  labelMarkers,
  candles,
  timeframeSec,
}: Options): PatternHoverState | null {
  const [hover, setHover] = useState<PatternHoverState | null>(null);

  const bars = useMemo((): MiniBar[] => candles.map(c => ({
    time: c.time as number, open: c.open, high: c.high, low: c.low, close: c.close,
  })), [candles]);

  // Bar time -> the firing drawn on it, snapped exactly as useChartMarkers
  // snaps it, so the hover resolves to the same bar the arrow is drawn on.
  const firings = useMemo(() => {
    const byTime = new Map<number, { pattern: string; value: number }>();
    const times = bars.map(b => b.time as number);
    for (const marker of labelMarkers) {
      if (!marker.pattern || marker.label === null || marker.label === undefined) continue;
      const time = snapToCandle(marker.timestamp, times, timeframeSec);
      if (time === null) continue;
      const value = Number(marker.label);
      const existing = byTime.get(time);
      if (!existing || Math.abs(value) > Math.abs(existing.value)) {
        byTime.set(time, { pattern: marker.pattern, value });
      }
    }
    return byTime;
  }, [labelMarkers, bars, timeframeSec]);

  // The handler binds once per chart; everything it reads comes from refs.
  const stateRef = useRef({ bars, firings, hoveredTime: null as number | null });
  stateRef.current.bars = bars;
  stateRef.current.firings = firings;

  // New markers or bars invalidate whatever card is open.
  useEffect(() => {
    stateRef.current.hoveredTime = null;
    setHover(null);
  }, [firings, bars]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const timeScale = chart.timeScale();

    const clear = () => {
      if (stateRef.current.hoveredTime === null) return;
      stateRef.current.hoveredTime = null;
      setHover(null);
    };

    const hitTime = (param: MouseEventParams<Time>): number | null => {
      const { firings: byTime, bars: allBars } = stateRef.current;
      const fromArrow = parsePatternMarkerId(param.hoveredObjectId);
      if (fromArrow !== null && byTime.has(fromArrow)) return fromArrow;

      if (param.time == null || !param.point) return null;
      const time = param.time as number;
      if (!byTime.has(time)) return null;
      const series = candleSeriesRef.current;
      const bar = allBars.find(b => b.time === time);
      if (!series || !bar) return null;
      const highY = series.priceToCoordinate(bar.high);
      const lowY = series.priceToCoordinate(bar.low);
      if (highY == null || lowY == null) return null;
      const y = param.point.y;
      return y >= highY - HOVER_SLACK_PX && y <= lowY + HOVER_SLACK_PX ? time : null;
    };

    const handler = (param: MouseEventParams<Time>) => {
      if (!param.point) { clear(); return; }
      const time = hitTime(param);
      if (time === null) { clear(); return; }
      if (time === stateRef.current.hoveredTime) return;

      const { firings: byTime, bars: allBars } = stateRef.current;
      const firing = byTime.get(time)!;
      const confirmationOf = Math.abs(firing.value) >= 2
        ? confirmedPatternTime(
          Array.from(byTime, ([t, f]) => ({ time: t, value: f.value })),
          time, firing.value, allBars,
        )
        : null;
      const info = patternHoverInfo(firing.pattern, firing.value, time, allBars, confirmationOf ?? time);
      if (!info) { clear(); return; }

      const container = containerRef.current;
      const width = container?.clientWidth ?? 0;
      const height = container?.clientHeight ?? 0;
      const x = timeScale.timeToCoordinate(time as Time) ?? param.point.x;

      // Right of the arrow when it fits, left of it otherwise.
      let left = x + 18;
      if (left + PATTERN_CARD_WIDTH > width - 70) left = x - 18 - PATTERN_CARD_WIDTH;
      left = Math.max(4, left);
      const top = Math.min(Math.max(4, param.point.y - 60), Math.max(4, height - CARD_HEIGHT_ESTIMATE - 4));

      stateRef.current.hoveredTime = time;
      setHover({ info, card: { left, top }, band: patternBand(chart, info) });
    };

    chart.subscribeCrosshairMove(handler);
    // A pan or zoom moves the bars out from under a band drawn in pixels.
    timeScale.subscribeVisibleLogicalRangeChange(clear);
    return () => {
      try {
        chart.unsubscribeCrosshairMove(handler);
        timeScale.unsubscribeVisibleLogicalRangeChange(clear);
      } catch { /* chart disposed */ }
    };
  }, [chartRef, candleSeriesRef, containerRef]);

  return hover;
}

/**
 * The pixel span of the pattern's own bars, edge to edge.
 *
 * Half a bar's spacing is added on each side so the band covers the candles'
 * bodies rather than stopping at their centre lines. The spacing is measured
 * from two neighbouring bars' coordinates rather than read from options, so it
 * is right at whatever zoom the chart is at.
 */
function patternBand(chart: IChartApi, info: PatternHoverInfo): PatternBand | null {
  const timeScale = chart.timeScale();
  const first = info.window.pattern[0]?.time;
  const last = info.window.pattern[info.window.pattern.length - 1]?.time;
  if (first === undefined || last === undefined) return null;
  const firstX = timeScale.timeToCoordinate(first as Time);
  const lastX = timeScale.timeToCoordinate(last as Time);
  if (firstX === null || lastX === null) return null;

  const neighbour = info.window.context[info.window.context.length - 1]?.time
    ?? info.window.pattern[1]?.time;
  const neighbourX = neighbour !== undefined ? timeScale.timeToCoordinate(neighbour as Time) : null;
  const spacing = neighbourX !== null ? Math.abs(firstX - neighbourX) : 8;

  const left = Math.min(firstX, lastX) - spacing / 2;
  const right = Math.max(firstX, lastX) + spacing / 2;
  const plotHeight = chart.paneSize(0).height;
  return { left, width: right - left, height: plotHeight };
}
