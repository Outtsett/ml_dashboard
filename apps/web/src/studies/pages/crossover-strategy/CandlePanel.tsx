/**
 * Panel 1 of the notebook on lightweight-charts: candles with a marker at every
 * MACD crossing of its signal line, the MACD line, signal and histogram beneath,
 * and the RSI with its 30 / 50 / 70 lines. Optionally the crossover rule's own
 * two lines and the bars where it flipped, so the two signals can be counted
 * side by side.
 *
 * Direction is carried by colour (orange up, blue down) AND shape (arrow up,
 * arrow down; a circle for a crossover flip) AND position (below the bar for
 * long, above for short). The axis digits are the lake's stamps, which for
 * futures are Pacific wall clock stored as UTC.
 */

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers, createTextWatermark,
  type IChartApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { CANDLE_DOWN_COLOR, CANDLE_UP_COLOR, candleSeriesOptions, createChartOptions } from "@/market/components/chartConfig";
import { OKABE, fmt, fmtTime } from "@/studies/kit";
import type { CandleWindow } from "@shared/studies/crossover-strategy";

function seconds(value: number): UTCTimestamp {
  return value as UTCTimestamp;
}

function linePoints(times: number[], values: Array<number | null>) {
  return times.map((time, i) => {
    const value = values[i];
    return value === null || value === undefined ? { time: seconds(time) } : { time: seconds(time), value };
  });
}

export interface CandlePanelProps {
  candles: CandleWindow;
  showMacdMarkers: boolean;
  showCrossover: boolean;
  fastLabel: string;
  slowLabel: string;
  height?: number;
}

export function CandlePanel({ candles, showMacdMarkers, showCrossover, fastLabel, slowLabel, height = 680 }: CandlePanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    const count = candles.timestampSeconds.length;
    if (!element || count === 0) return;
    const base = createChartOptions();
    const chart: IChartApi = createChart(element, {
      ...base,
      autoSize: true,
      timeScale: { ...base.timeScale, rightOffset: 2, timeVisible: true, enableConflation: false },
      localization: { timeFormatter: (time: Time) => new Date(Number(time) * 1000).toISOString().slice(0, 16).replace("T", " ") },
    });
    const times = candles.timestampSeconds;

    // Pane 0: candles, MACD crossing markers, optionally the crossover's two lines and flips.
    const price = chart.addSeries(CandlestickSeries, candleSeriesOptions(2, 0.25), 0);
    price.setData(times.map((time, i) => ({ time: seconds(time), open: candles.open[i] as number, high: candles.high[i] as number, low: candles.low[i] as number, close: candles.close[i] as number })));
    const markers: SeriesMarker<Time>[] = [];
    if (showMacdMarkers) {
      for (const i of candles.macdLongIndices) markers.push({ time: seconds(times[i] as number), position: "belowBar", shape: "arrowUp", color: CANDLE_UP_COLOR, size: 1 });
      for (const i of candles.macdShortIndices) markers.push({ time: seconds(times[i] as number), position: "aboveBar", shape: "arrowDown", color: CANDLE_DOWN_COLOR, size: 1 });
    }
    if (showCrossover) {
      const fast = chart.addSeries(LineSeries, { color: OKABE.sky, lineWidth: 2, title: fastLabel, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
      fast.setData(linePoints(times, candles.fast));
      const slow = chart.addSeries(LineSeries, { color: OKABE.purple, lineWidth: 2, lineStyle: LineStyle.Dashed, title: slowLabel, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
      slow.setData(linePoints(times, candles.slow));
      for (const i of candles.flipLongIndices) markers.push({ time: seconds(times[i] as number), position: "belowBar", shape: "circle", color: OKABE.yellow, size: 1.3, text: "long" });
      for (const i of candles.flipShortIndices) markers.push({ time: seconds(times[i] as number), position: "aboveBar", shape: "circle", color: OKABE.vermillion, size: 1.3, text: "short" });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(price, markers);

    // Pane 1: histogram, MACD line, signal line, and the same crossing markers on the MACD line.
    const histogram = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: "MACD histogram" }, 1);
    histogram.setData(times.map((time, i) => {
      const value = candles.macdHistogram[i];
      return value === null || value === undefined ? { time: seconds(time) } : { time: seconds(time), value, color: value >= 0 ? `${OKABE.orange}99` : `${OKABE.blue}99` };
    }));
    const macdLine = chart.addSeries(LineSeries, { color: OKABE.sky, lineWidth: 2, title: "MACD", priceLineVisible: false, lastValueVisible: true }, 1);
    macdLine.setData(linePoints(times, candles.macd));
    const signalLine = chart.addSeries(LineSeries, { color: OKABE.purple, lineWidth: 2, lineStyle: LineStyle.Dashed, title: "signal", priceLineVisible: false, lastValueVisible: true }, 1);
    signalLine.setData(linePoints(times, candles.macdSignal));
    macdLine.createPriceLine({ price: 0, color: "#a3a3a3", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "" });
    if (showMacdMarkers) {
      const onLine: SeriesMarker<Time>[] = [
        ...candles.macdLongIndices.map((i) => ({ time: seconds(times[i] as number), position: "inBar" as const, shape: "arrowUp" as const, color: CANDLE_UP_COLOR, size: 0.8 })),
        ...candles.macdShortIndices.map((i) => ({ time: seconds(times[i] as number), position: "inBar" as const, shape: "arrowDown" as const, color: CANDLE_DOWN_COLOR, size: 0.8 })),
      ].sort((a, b) => Number(a.time) - Number(b.time));
      createSeriesMarkers(macdLine, onLine);
    }

    // Pane 2: RSI between 0 and 100 with dashed 30 and 70 and a solid 50.
    const rsi = chart.addSeries(LineSeries, {
      color: OKABE.vermillion, lineWidth: 2, title: "RSI", priceLineVisible: false, lastValueVisible: true,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    }, 2);
    rsi.setData(linePoints(times, candles.relativeStrengthIndex));
    for (const [level, style] of [[70, LineStyle.Dashed], [50, LineStyle.Solid], [30, LineStyle.Dashed]] as const) {
      rsi.createPriceLine({ price: level, color: "#a3a3a3", lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: "" });
    }

    const panes = chart.panes();
    [0.55, 0.24, 0.21].forEach((factor, i) => panes[i]?.setStretchFactor(factor));
    [[1, "MACD line, signal line, histogram (points)"], [2, "relative strength index (0 to 100)"]].forEach(([index, title]) => {
      const pane = panes[index as number];
      if (pane) createTextWatermark(pane, { horzAlign: "left", vertAlign: "top", lines: [{ text: title as string, color: "rgba(255,255,255,0.5)", fontSize: 10 }] });
    });

    const indexByTime = new Map<number, number>(times.map((time, i) => [time, i]));
    const onMove = (param: { time?: Time }) => setHover(param.time === undefined ? null : (indexByTime.get(Number(param.time)) ?? null));
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().fitContent();
    let fitted = element.clientWidth > 0;
    const sizeWatch = new ResizeObserver(() => {
      if (!fitted && element.clientWidth > 0) {
        fitted = true;
        chart.timeScale().fitContent();
      }
    });
    sizeWatch.observe(element);

    return () => {
      sizeWatch.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [candles, showMacdMarkers, showCrossover, fastLabel, slowLabel, height]);

  const at = hover;
  return (
    <div className="space-y-1">
      <div className="relative">
        <div ref={containerRef} style={{ height }} className="w-full min-w-0" data-testid="crossover-candles" />
        {at !== null && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-neutral-700 bg-neutral-950/90 px-2 py-1 font-mono text-[10px] leading-4 text-neutral-200">
            <div>{fmtTime((candles.timestampSeconds[at] as number) * 1000)} wall clock</div>
            <div>open {fmt(candles.open[at], 2)} · high {fmt(candles.high[at], 2)} · low {fmt(candles.low[at], 2)} · close {fmt(candles.close[at], 2)}</div>
            <div>MACD {fmt(candles.macd[at], 3)} · signal {fmt(candles.macdSignal[at], 3)} · histogram {fmt(candles.macdHistogram[at], 3)} · RSI {fmt(candles.relativeStrengthIndex[at], 1)}</div>
            {showCrossover && <div>{fastLabel} {fmt(candles.fast[at], 2)} · {slowLabel} {fmt(candles.slow[at], 2)}</div>}
          </div>
        )}
      </div>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: CANDLE_UP_COLOR }}>▲ orange below the bar = MACD crossed above its signal</span> ·{" "}
        <span style={{ color: CANDLE_DOWN_COLOR }}>▼ blue above the bar = crossed below</span>
        {showCrossover && (
          <>
            {" "}· <span style={{ color: OKABE.yellow }}>● yellow circle = the crossover rule went long</span> ·{" "}
            <span style={{ color: OKABE.vermillion }}>● vermillion circle = it went short</span>
          </>
        )}
        . Candles: orange up, blue down. Hover for exact values.
      </p>
    </div>
  );
}
