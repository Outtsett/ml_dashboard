/**
 * The detail panel: the brushed span as candles (orange up, blue down) on a
 * price axis that can be logarithmic, with the bar-to-bar log return in basis
 * points in a pane beneath. Rebuilt when its inputs change (at most a few
 * thousand bars, the brush picks the timeframe for about the target count).
 */

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, HistogramSeries, PriceScaleMode, createChart, createTextWatermark,
  type IChartApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { createChartOptions } from "@/market/components/chartConfig";
import { OKABE } from "@/studies/kit";
import type { DetailCandle } from "@shared/studies/eurusd-reactivity";

function seconds(timestamp: number): UTCTimestamp {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

export function DetailChart({
  candles, logScale, showVolume, timeframe, height = 420,
}: {
  candles: readonly DetailCandle[];
  logScale: boolean;
  showVolume: boolean;
  timeframe: string;
  height?: number;
}) {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || candles.length === 0) return;
    const base = createChartOptions();
    const chart: IChartApi = createChart(element, {
      ...base,
      autoSize: true,
      timeScale: { ...base.timeScale, rightOffset: 2, timeVisible: timeframe !== "1d", enableConflation: false },
      rightPriceScale: {
        ...base.rightPriceScale,
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.06, bottom: 0.06 },
      },
      localization: {
        timeFormatter: (time: Time) => `${new Date(Number(time) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`,
      },
    });

    const price = chart.addSeries(CandlestickSeries, {
      upColor: OKABE.orange, downColor: OKABE.blue, borderUpColor: OKABE.orange, borderDownColor: OKABE.blue,
      wickUpColor: "#d4d4d4", wickDownColor: "#d4d4d4", priceLineVisible: false,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    }, 0);
    price.setData(candles.map((bar) => ({ time: seconds(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));

    const returns = chart.addSeries(HistogramSeries, {
      priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    }, 1);
    returns.setData(candles.map((bar) => (
      bar.log_return_basis_points === null
        ? { time: seconds(bar.time) }
        : { time: seconds(bar.time), value: bar.log_return_basis_points, color: bar.log_return_basis_points >= 0 ? OKABE.orange : OKABE.blue }
    )));

    const titles: Array<[number, string]> = [[1, "log return, basis points ▲ up · ▼ down"]];
    if (showVolume) {
      const volume = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" } }, 2);
      volume.setData(candles.map((bar) => ({ time: seconds(bar.time), value: bar.volume, color: bar.close >= bar.open ? `${OKABE.orange}aa` : `${OKABE.blue}aa` })));
      titles.push([2, "volume, ticks"]);
    }

    const panes = chart.panes();
    panes.forEach((pane, index) => pane.setStretchFactor(index === 0 ? 5 : 1.4));
    for (const [index, title] of titles) {
      const target = panes[index];
      if (target) createTextWatermark(target, { horzAlign: "left", vertAlign: "top", lines: [{ text: title, color: "rgba(255,255,255,0.5)", fontSize: 10 }] });
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, logScale, showVolume, timeframe]);

  return <div ref={container} className="w-full min-w-0" style={{ height }} />;
}
