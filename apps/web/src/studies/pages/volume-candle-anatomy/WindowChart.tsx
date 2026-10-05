/**
 * Panel A's chart on lightweight-charts: the candles (orange rising, blue
 * falling) over one pane per reading of the volume bar, all on one shared
 * time axis. Direction is carried by colour AND by sign (the signed pane and
 * the z-score pane sit above or below zero), never by colour alone. The
 * chart is rebuilt when the bars change; hovering a bar reports its index.
 * Times are the lake's stamps, Pacific wall clock stored as UTC.
 */

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, HistogramSeries, createChart, createTextWatermark,
  type IChartApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { CANDLE_DOWN_COLOR, CANDLE_UP_COLOR, candleSeriesOptions, createChartOptions } from "@/market/components/chartConfig";
import { OKABE } from "@/studies/kit";
import type { WindowBar } from "@shared/studies/volume-candle-anatomy";

function seconds(timestamp: number): UTCTimestamp {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function WindowChart({ bars, height = 620, onHover }: { bars: readonly WindowBar[]; height?: number; onHover?: (index: number | null) => void }) {
  const container = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    hoverRef.current = onHover;
  });

  useEffect(() => {
    const element = container.current;
    if (!element || bars.length === 0) return;
    const base = createChartOptions();
    const chart: IChartApi = createChart(element, {
      ...base,
      autoSize: true,
      timeScale: { ...base.timeScale, rightOffset: 2, timeVisible: true, enableConflation: false },
      localization: { timeFormatter: (time: Time) => new Date(Number(time) * 1000).toISOString().slice(0, 16).replace("T", " ") + " clock" },
    });
    const indexOf = new Map<number, number>(bars.map((bar, index) => [seconds(bar.timestamp), index]));
    const directionColor = (bar: WindowBar) => (bar.candle_direction === "rising" ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR);

    const candles = chart.addSeries(CandlestickSeries, {
      ...candleSeriesOptions(2, 0.25),
      wickUpColor: CANDLE_UP_COLOR,
      wickDownColor: CANDLE_DOWN_COLOR,
    }, 0);
    candles.setData(bars.map((bar) => ({ time: seconds(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));

    const titles: string[] = ["price: rising (orange) / falling (blue)"];
    const addPane = (title: string, options: { color: string | ((bar: WindowBar) => string); value: (bar: WindowBar) => number | null; fixed?: [number, number]; format?: "volume" | "price" }) => {
      const pane = titles.length;
      const series = chart.addSeries(HistogramSeries, {
        priceLineVisible: false, lastValueVisible: false,
        priceFormat: options.format === "volume" ? { type: "volume" } : { type: "price", precision: 3, minMove: 0.001 },
        ...(options.fixed ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: options.fixed?.[0] ?? 0, maxValue: options.fixed?.[1] ?? 1 } }) } : {}),
      }, pane);
      series.setData(bars.map((bar) => {
        const value = options.value(bar);
        return finite(value)
          ? { time: seconds(bar.timestamp), value, color: typeof options.color === "string" ? options.color : options.color(bar) }
          : { time: seconds(bar.timestamp) };
      }));
      titles.push(title);
    };
    addPane("volume_contracts (contracts)", { color: OKABE.purple, value: (bar) => bar.volume_contracts, format: "volume" });
    addPane("volume_bar_height_in_window (share of trailing maximum)", { color: OKABE.sky, value: (bar) => bar.volume_bar_height_in_window, fixed: [0, 1.05] });
    addPane("volume_zscore_trailing (coloured by candle direction)", { color: directionColor, value: (bar) => bar.volume_zscore_trailing });
    addPane("volume_rank_trailing (share of the previous 120 bars below)", { color: OKABE.green, value: (bar) => bar.volume_rank_trailing, fixed: [0, 1] });
    addPane("volume_signed_by_candle_direction (above zero rising, below zero falling)", { color: directionColor, value: (bar) => bar.volume_signed_by_candle_direction, format: "volume" });

    const panes = chart.panes();
    panes.forEach((pane, index) => pane.setStretchFactor(index === 0 ? 5 : 1.1));
    titles.forEach((title, index) => {
      const target = panes[index];
      if (target) createTextWatermark(target, { horzAlign: "left", vertAlign: "top", lines: [{ text: title, color: "rgba(255,255,255,0.55)", fontSize: 10 }] });
    });
    const frameLatest = () => {
      if (bars.length > 0) {
        const visible = Math.min(250, bars.length);
        const start = bars[bars.length - visible];
        const end = bars[bars.length - 1];
        if (start && end) {
          chart.timeScale().setVisibleRange({ from: seconds(start.timestamp), to: seconds(end.timestamp) });
        }
      }
    };
    frameLatest();
    chart.subscribeCrosshairMove((parameter) => {
      hoverRef.current?.(parameter.time === undefined ? null : (indexOf.get(Number(parameter.time)) ?? null));
    });
    return () => chart.remove();
  }, [bars]);

  return <div ref={container} className="w-full min-w-0" style={{ height }} />;
}
