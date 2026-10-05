/**
 * Figure 2: the same bars with one strip row per horizon, on the same time
 * axis as the candles. Reading down a column shows how the answer for one bar
 * changes as the label looks further ahead.
 *
 * Up is an orange up-arrow and down is a blue down-arrow (shape plus colour).
 * Every stored horizon is a row, all seven, in the order horizon 1 at the bottom.
 */

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, LineSeries, createChart, createSeriesMarkers,
  type LogicalRange, type SeriesMarker, type Time,
} from "lightweight-charts";
import { candleSeriesOptions, createChartOptions } from "@/market/components/chartConfig";
import { DIRECTION_HORIZONS, directionLabelName, horizonWords, type WindowBars } from "@shared/studies/direction-labels-on-candles";
import { fmt, fmtTime } from "@/studies/kit";
import { DOWN_COLOR, UP_COLOR } from "./DirectionChart";

export function HorizonStrip({ bars, rows = DIRECTION_HORIZONS, height = 480 }: { bars: WindowBars; rows?: readonly number[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<{ bars: WindowBars; range: LogicalRange | null } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const rowsKey = rows.join(",");

  useEffect(() => {
    const element = containerRef.current;
    if (!element || bars.close.length === 0) return;
    const chart = createChart(element, { ...createChartOptions(), autoSize: true });
    const times = bars.timestampSeconds.map((seconds) => seconds as Time);

    const candles = chart.addSeries(CandlestickSeries, candleSeriesOptions(2, 0.25), 0);
    candles.setData(times.map((time, i) => ({ time, open: bars.open[i] as number, high: bars.high[i] as number, low: bars.low[i] as number, close: bars.close[i] as number })));

    // The strip pane: an invisible series carries the time points the markers attach to, and its
    // price axis is labelled with the horizon names instead of numbers.
    const strip = chart.addSeries(
      LineSeries,
      {
        lineVisible: false, pointMarkersVisible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        priceFormat: {
          type: "custom", minMove: 1,
          formatter: (value: number) => {
            const row = Math.round(value);
            return Math.abs(value - row) < 0.02 && row >= 0 && row < rows.length ? `horizon ${rows[row]}` : "";
          },
        },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -0.8, maxValue: rows.length - 0.2 } }),
      },
      1,
    );
    strip.setData(times.map((time) => ({ time, value: (rows.length - 1) / 2 })));
    // One axis label per row, so every horizon is named whatever tick spacing the scale chooses.
    rows.forEach((horizon, row) => {
      strip.createPriceLine({ price: row, color: "#737373", lineWidth: 1, lineVisible: false, axisLabelVisible: true, title: `horizon ${horizon}` });
    });

    const markers: SeriesMarker<Time>[] = [];
    rows.forEach((horizon, row) => {
      (bars.directionLabels[String(horizon)] ?? []).forEach((label, i) => {
        if (label === null) return;
        markers.push({
          time: times[i] as Time, position: "atPriceMiddle", price: row,
          shape: label === 1 ? "arrowUp" : "arrowDown", color: label === 1 ? UP_COLOR : DOWN_COLOR, size: 0.6,
        });
      });
    });
    createSeriesMarkers(strip, markers);

    const panes = chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(4);

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
    // rowsKey stands for the rows array, whose identity is not stable.
  }, [bars, rowsKey, height]);

  return (
    <div className="space-y-1">
      <div className="relative">
        <div ref={containerRef} style={{ height }} className="w-full" data-testid="horizon-strip" />
        {hoverIndex !== null && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-neutral-700 bg-neutral-950/90 px-2 py-1 font-mono text-[10px] leading-4 text-neutral-200">
            <div>
              {fmtTime((bars.timestampSeconds[hoverIndex] as number) * 1000)} wall clock · close {fmt(bars.close[hoverIndex], 2)}
            </div>
            {[...rows].reverse().map((horizon) => {
              const label = bars.directionLabels[String(horizon)]?.[hoverIndex] ?? null;
              return (
                <div key={horizon} style={{ color: label === 1 ? UP_COLOR : label === 0 ? DOWN_COLOR : undefined }}>
                  {label === 1 ? "▲ 1" : label === 0 ? "▼ 0" : "– "} {directionLabelName(horizon)} ({horizonWords(horizon)})
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: UP_COLOR }}>▲ orange = up (1)</span> · <span style={{ color: DOWN_COLOR }}>▼ blue = down (0)</span> · rows run from horizon 1 at the bottom to horizon 1440 at the top.
      </p>
    </div>
  );
}
