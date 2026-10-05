/**
 * Figure 1: the candles, a label marker lane per horizon stacked under the
 * price, and, from a few anchor bars, one arrow per horizon running from
 * close[t] to close[t+H]. The label at the anchor is the sign of that arrow.
 *
 * Direction is carried by colour (orange up, blue down) AND shape (arrow up,
 * arrow down) AND line style (solid up, dashed down), never by colour alone.
 * Times are the lake's stamps: Pacific wall clock stored as UTC, so the axis
 * digits are wall clock.
 */

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, LineSeries, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type LogicalRange, type SeriesMarker, type Time,
} from "lightweight-charts";
import { CANDLE_DOWN_COLOR, CANDLE_UP_COLOR, MARKER_NEUTRAL_COLOR, candleSeriesOptions, createChartOptions } from "@/market/components/chartConfig";
import { buildArrows, directionLabelName, horizonWords, laneLevel, type WindowBars } from "@shared/studies/direction-labels-on-candles";
import { fmt, fmtTime } from "@/studies/kit";

export const UP_COLOR = CANDLE_UP_COLOR;
export const DOWN_COLOR = CANDLE_DOWN_COLOR;
const ANCHOR_COLOR = "#e2e8f0";

function labelColor(label: 0 | 1 | null): string {
  return label === 1 ? UP_COLOR : label === 0 ? DOWN_COLOR : MARKER_NEUTRAL_COLOR;
}

export interface DirectionChartProps {
  bars: WindowBars;
  /** Horizons drawn as marker lanes and as arrows (ascending). */
  horizons: readonly number[];
  /** Bar indices the arrow fan starts from. */
  anchors: readonly number[];
  showArrows: boolean;
  showLanes: boolean;
  /** The arrow to draw thicker: an anchor bar index and a horizon. */
  inspect?: { anchorIndex: number; horizon: number } | null;
  height?: number;
}

export function DirectionChart({ bars, horizons, anchors, showArrows, showLanes, inspect = null, height = 520 }: DirectionChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<{ bars: WindowBars; range: LogicalRange | null } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const overlayKey = `${horizons.join(",")}|${anchors.join(",")}|${showArrows}|${showLanes}|${inspect?.anchorIndex ?? ""}:${inspect?.horizon ?? ""}`;

  useEffect(() => {
    const element = containerRef.current;
    const total = bars.close.length;
    if (!element || total === 0) return;

    const chart: IChartApi = createChart(element, { ...createChartOptions(), autoSize: true });
    const lowMinimum = Math.min(...bars.low);
    const highMaximum = Math.max(...bars.high);
    const span = Math.max(highMaximum - lowMinimum, 0.25);
    const laneCount = showLanes ? horizons.length : 0;
    const floor = laneCount > 0 ? laneLevel(lowMinimum, highMaximum, laneCount - 1) - span * 0.03 : lowMinimum - span * 0.02;

    const candles = chart.addSeries(CandlestickSeries, {
      ...candleSeriesOptions(2, 0.25),
      autoscaleInfoProvider: () => ({ priceRange: { minValue: floor, maxValue: highMaximum + span * 0.03 } }),
    });
    const times = bars.timestampSeconds.map((seconds) => seconds as Time);
    candles.setData(times.map((time, i) => ({ time, open: bars.open[i] as number, high: bars.high[i] as number, low: bars.low[i] as number, close: bars.close[i] as number })));

    const markers: SeriesMarker<Time>[] = [];
    if (showLanes) {
      horizons.forEach((horizon, lane) => {
        const price = laneLevel(lowMinimum, highMaximum, lane);
        const labels = bars.directionLabels[String(horizon)] ?? [];
        labels.forEach((label, i) => {
          if (label === null) return;
          markers.push({
            time: times[i] as Time, position: "atPriceMiddle", price,
            shape: label === 1 ? "arrowUp" : "arrowDown", color: labelColor(label), size: 0.5,
          });
        });
        candles.createPriceLine({
          price, color: labelColor(null), lineWidth: 1, lineStyle: LineStyle.Dotted, lineVisible: false,
          axisLabelVisible: true, title: `horizon ${horizon} bars`,
        });
      });
    }

    if (showArrows) {
      for (const arrow of buildArrows(bars, horizons, anchors)) {
        const color = labelColor(arrow.label);
        const highlighted = inspect?.anchorIndex === arrow.anchorIndex && inspect.horizon === arrow.horizon;
        const segment = chart.addSeries(LineSeries, {
          color, lineWidth: highlighted ? 4 : 2, lineStyle: arrow.label === 0 ? LineStyle.Dashed : LineStyle.Solid,
          lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        });
        segment.setData([
          { time: times[arrow.anchorIndex] as Time, value: arrow.fromClose },
          { time: times[arrow.targetIndex] as Time, value: arrow.toClose },
        ]);
        markers.push({
          time: times[arrow.targetIndex] as Time, position: "atPriceMiddle", price: arrow.toClose, shape: "square",
          color, size: highlighted ? 1.6 : 1, text: `+${arrow.horizon}`,
        });
      }
      for (const anchor of anchors) {
        markers.push({
          time: times[anchor] as Time, position: "atPriceMiddle", price: bars.close[anchor] as number,
          shape: "circle", color: ANCHOR_COLOR, size: 1.4,
        });
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(candles, markers);

    const indexByTime = new Map<number, number>();
    bars.timestampSeconds.forEach((seconds, i) => indexByTime.set(seconds, i));
    const onMove = (param: { time?: Time }) => {
      setHoverIndex(param.time === undefined ? null : (indexByTime.get(param.time as number) ?? null));
    };
    chart.subscribeCrosshairMove(onMove);

    const saved = savedRange.current;
    const restore = saved && saved.bars === bars && saved.range ? saved.range : null;
    const frameLatest = () => {
      if (times.length > 0) {
        const visible = Math.min(250, times.length);
        const start = times[times.length - visible];
        const end = times[times.length - 1];
        if (start !== undefined && end !== undefined) {
          chart.timeScale().setVisibleRange({ from: seconds(start as number), to: seconds(end as number) });
        }
      }
    };
    if (restore) chart.timeScale().setVisibleLogicalRange(restore);
    else frameLatest();
    // The container can still be unmeasured when the chart is made: fit once when it first has a width.
    let fitted = restore !== null || element.clientWidth > 0;
    const sizeWatch = new ResizeObserver(() => {
      if (!fitted && element.clientWidth > 0) {
        fitted = true;
        frameLatest();
      }
    });
    sizeWatch.observe(element);

    return () => {
      savedRange.current = { bars, range: chart.timeScale().getVisibleLogicalRange() };
      sizeWatch.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
    // overlayKey stands for horizons, anchors and the overlay switches, whose identities change every render.
  }, [bars, overlayKey, height]);

  const hover = hoverIndex === null ? null : hoverIndex;

  return (
    <div className="space-y-1">
      <div className="relative">
        <div ref={containerRef} style={{ height }} className="w-full" data-testid="direction-chart" />
        {hover !== null && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-neutral-700 bg-neutral-950/90 px-2 py-1 font-mono text-[10px] leading-4 text-neutral-200">
            <div>{fmtTime((bars.timestampSeconds[hover] as number) * 1000)} wall clock</div>
            <div>
              open {fmt(bars.open[hover], 2)} · high {fmt(bars.high[hover], 2)} · low {fmt(bars.low[hover], 2)} · close {fmt(bars.close[hover], 2)}
            </div>
            {horizons.map((horizon) => {
              const label = bars.directionLabels[String(horizon)]?.[hover] ?? null;
              return (
                <div key={horizon} style={{ color: labelColor(label) }}>
                  {label === 1 ? "▲ up (1)" : label === 0 ? "▼ down (0)" : "– unlabeled"} {directionLabelName(horizon)} · {horizonWords(horizon)}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: UP_COLOR }}>▲ orange = up (1)</span> · <span style={{ color: DOWN_COLOR }}>▼ blue = down (0)</span> ·{" "}
        <span style={{ color: ANCHOR_COLOR }}>● anchor bar t</span> · <span>■ close[t+H]</span> · solid arrow = up, dashed arrow = down. Marker lanes sit under the price, one per horizon, in the order listed on the axis.
      </p>
    </div>
  );
}
