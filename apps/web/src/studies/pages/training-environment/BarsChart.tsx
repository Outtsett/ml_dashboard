/**
 * The bars the model is training on: candles over a volume pane on
 * lightweight-charts. A rising bar is a hollow orange candle and a falling
 * bar a filled blue one, so direction never rests on colour alone. Times are
 * the lake's stamps (futures: Pacific wall clock stored as UTC). Hovering a
 * bar reports its index and numbers, which is the index the heatmap's bar
 * window is counted in.
 */

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, createChart, type Time, type UTCTimestamp } from "lightweight-charts";
import { VOLUME_DOWN_FILL, VOLUME_UP_FILL, candleSeriesOptions, createChartOptions } from "@/market/components/chartConfig";
import { fmt, fmtInt, fmtTime } from "@/studies/kit";
import type { BarRow } from "@shared/studies/training-environment";

export function BarsChart({ bars, height = 360 }: { bars: readonly BarRow[]; height?: number }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<BarRow | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || bars.length === 0) return;
    const base = createChartOptions();
    const chart = createChart(element, {
      ...base,
      autoSize: true,
      timeScale: { ...base.timeScale, rightOffset: 2, enableConflation: false },
      localization: { timeFormatter: (time: Time) => `${new Date(Number(time) * 1000).toISOString().slice(0, 16).replace("T", " ")} clock` },
    });
    const candles = chart.addSeries(CandlestickSeries, { ...candleSeriesOptions(2, 0.25), upColor: "rgba(0, 0, 0, 0)" });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const seconds = (bar: BarRow) => Math.floor(bar.timestamp_ms / 1000) as UTCTimestamp;
    const byTime = new Map<number, BarRow>();
    const candleData: Array<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }> = [];
    const volumeData: Array<{ time: UTCTimestamp; value: number; color: string }> = [];
    let previous = Number.NEGATIVE_INFINITY;
    for (const bar of bars) {
      const time = seconds(bar);
      if (time <= previous) continue;
      previous = time;
      byTime.set(time, bar);
      candleData.push({ time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      volumeData.push({ time, value: bar.volume, color: bar.close >= bar.open ? VOLUME_UP_FILL : VOLUME_DOWN_FILL });
    }
    candles.setData(candleData);
    volume.setData(volumeData);
    chart.timeScale().fitContent();

    const onMove = (parameter: { time?: Time }) => setHover(parameter.time === undefined ? null : (byTime.get(Number(parameter.time)) ?? null));
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [bars]);

  return (
    <div className="space-y-1">
      <div className="relative">
        <div ref={container} className="w-full min-w-0" style={{ height }} data-testid="training-bars-chart" />
        {hover && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-neutral-700 bg-neutral-950/90 px-2 py-1 font-mono text-[10px] leading-4 text-neutral-200">
            <div>
              bar {fmtInt(hover.bar_index)} · {fmtTime(hover.timestamp_ms)} clock · {hover.close >= hover.open ? "▲ rising (hollow)" : "▼ falling (filled)"}
            </div>
            <div>
              open {fmt(hover.open, 2)} · high {fmt(hover.high, 2)} · low {fmt(hover.low, 2)} · close {fmt(hover.close, 2)} · volume {fmtInt(hover.volume)}
            </div>
          </div>
        )}
      </div>
      <p className="text-[10px] text-neutral-500">
        Rising bars are hollow orange, falling bars filled blue; volume is under them. Stamps are the lake's wall clock (futures: Pacific time stored as UTC).
      </p>
    </div>
  );
}
