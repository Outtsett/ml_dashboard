/**
 * The bars the run walked, above its terminal: candles, the model's trades on
 * them, and a highlight on the bar a terminal line names. Clicking a bar
 * reports its time so the terminal can scroll to the lines logged on it.
 */
import { useEffect, useRef } from "react";
import { CandlestickSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";

import { candleSeriesOptions, createChartOptions } from "@/market/components/chartConfig";
import type { CycleTrade } from "@shared/cycle/schema";
import type { RunBar } from "@/runs/api";
import { formatBarTime } from "@/runs/barTime";

const LONG = "#E69F00";
const SHORT = "#0072B2";
const FOCUS = "#F0E442";

export function RunBarsChart({
  bars,
  trades,
  focusTime,
  onBarClick,
}: {
  bars: RunBar[];
  trades: CycleTrade[];
  /** Epoch seconds of the bar a terminal line named; the chart scrolls to it and marks it. */
  focusTime: number | null;
  onBarClick: (seconds: number) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const drawnRef = useRef(0);
  const onBarClickRef = useRef(onBarClick);
  onBarClickRef.current = onBarClick;

  // one chart per mount
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const base = createChartOptions();
    const chart = createChart(element, {
      ...base,
      autoSize: true,
      timeScale: { ...base.timeScale, rightOffset: 4, timeVisible: true, secondsVisible: false },
      localization: { timeFormatter: (time: Time) => formatBarTime(Number(time)) },
    });
    const candles = chart.addSeries(CandlestickSeries, candleSeriesOptions(2, 0.25));
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeClick((event) => {
      if (event.time !== undefined) onBarClickRef.current(Number(event.time));
    });
    chartRef.current = chart;
    candlesRef.current = candles;
    markersRef.current = markers;
    drawnRef.current = 0;
    return () => {
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // bars arrive in time order and only grow; a shorter list is a different run
  useEffect(() => {
    const candles = candlesRef.current;
    const chart = chartRef.current;
    if (!candles || !chart) return;
    if (bars.length < drawnRef.current) drawnRef.current = 0;
    const toCandle = (bar: RunBar) => ({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    if (drawnRef.current === 0) {
      candles.setData(bars.map(toCandle));
      if (bars.length > 0) chart.timeScale().fitContent();
    } else {
      for (let index = drawnRef.current; index < bars.length; index += 1) candles.update(toCandle(bars[index]!));
    }
    drawnRef.current = bars.length;
  }, [bars]);

  // trade entries and exits, plus the focused bar
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    const list: SeriesMarker<Time>[] = [];
    for (const trade of trades) {
      const long = trade.side === "long";
      list.push({
        time: trade.entryTimestamp as UTCTimestamp,
        position: long ? "belowBar" : "aboveBar",
        shape: long ? "arrowUp" : "arrowDown",
        color: long ? LONG : SHORT,
        text: `#${trade.tradeNumber} ${long ? "long" : "short"}`,
      });
      if (trade.exitTimestamp !== null) {
        list.push({
          time: trade.exitTimestamp as UTCTimestamp,
          position: long ? "aboveBar" : "belowBar",
          shape: "circle",
          color: long ? LONG : SHORT,
          text: trade.netProfitUsd === null ? `#${trade.tradeNumber} exit` : `#${trade.tradeNumber} ${trade.netProfitUsd >= 0 ? "+" : "-"}$${Math.abs(trade.netProfitUsd).toFixed(0)}`,
        });
      }
    }
    if (focusTime !== null) {
      list.push({ time: focusTime as UTCTimestamp, position: "inBar", shape: "square", color: FOCUS, text: "◆ log line" });
    }
    list.sort((a, b) => Number(a.time) - Number(b.time));
    markers.setMarkers(list);
  }, [trades, focusTime]);

  // scroll to the focused bar with room on both sides
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || focusTime === null || bars.length === 0) return;
    const index = bars.findIndex((bar) => bar.time >= focusTime);
    if (index < 0) return;
    const half = 60;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, index - half), to: Math.min(bars.length - 1, index + half) });
  }, [focusTime, bars]);

  return (
    <div className="relative h-full w-full" data-testid="run-bars-chart">
      <div ref={container} className="h-full w-full" />
      {bars.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
          Bars appear as the model walks them.
        </div>
      )}
    </div>
  );
}
