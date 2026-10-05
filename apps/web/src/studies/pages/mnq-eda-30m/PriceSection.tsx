/**
 * Section 1: the price series. Candles with volume under them, the volume
 * coloured by the sign of the bar's close against the previous close (the
 * notebook's rule). Up is a hollow orange candle, down a filled blue one, so
 * the sign never rests on colour alone. The notebook drew all 78,615 bars in
 * one plotly figure; here the window is a control, and a coarser bucket
 * (hour, four hours, trading day, week) shows the whole history.
 */

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, createChart, type Time, type UTCTimestamp } from "lightweight-charts";
import { CANDLE_DOWN_COLOR, CANDLE_UP_COLOR, VOLUME_DOWN_FILL, VOLUME_UP_FILL, candleSeriesOptions, createChartOptions } from "@/market/components/chartConfig";
import { ControlBar, Finding, Section, SegmentControl, SliderControl, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyControls } from "@/studies/kit";
import type { CandleColumns, PriceBody } from "@shared/studies/mnq-eda-30m";
import { useSection, type SeriesChoice } from "./use";

function CandleChart({ candles, height }: { candles: CandleColumns; height: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || candles.time.length === 0) return;
    const chart = createChart(element, { ...createChartOptions(), autoSize: true });
    const price = chart.addSeries(CandlestickSeries, { ...candleSeriesOptions(2, 0.25), upColor: "rgba(0, 0, 0, 0)" });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const indexByTime = new Map<number, number>();
    const candleData: Array<{ time: Time; open: number; high: number; low: number; close: number }> = [];
    const volumeData: Array<{ time: Time; value: number; color: string }> = [];
    let previous = Number.NEGATIVE_INFINITY;
    candles.time.forEach((time, index) => {
      if (time <= previous) return;
      previous = time;
      indexByTime.set(time, index);
      candleData.push({ time: time as Time, open: candles.open[index] as number, high: candles.high[index] as number, low: candles.low[index] as number, close: candles.close[index] as number });
      volumeData.push({ time: time as Time, value: candles.volume[index] as number, color: (candles.sign[index] as number) >= 0 ? VOLUME_UP_FILL : VOLUME_DOWN_FILL });
    });
    price.setData(candleData);
    volume.setData(volumeData);
    const frameLatest = () => {
      if (candleData.length > 0) {
        const visible = Math.min(250, candleData.length);
        const start = candleData[candleData.length - visible];
        const end = candleData[candleData.length - 1];
        if (start && end) {
          chart.timeScale().setVisibleRange({ from: start.time as UTCTimestamp, to: end.time as UTCTimestamp });
        }
      }
    };
    frameLatest();

    const onMove = (param: { time?: Time }) => setHover(param.time === undefined ? null : (indexByTime.get(param.time as number) ?? null));
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [candles, height]);

  return (
    <div className="space-y-1">
      <div className="relative">
        <div ref={containerRef} style={{ height }} className="w-full min-w-0" data-testid="mnq-price-chart" />
        {hover !== null && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-neutral-700 bg-neutral-950/90 px-2 py-1 font-mono text-[10px] leading-4 text-neutral-200">
            <div>{fmtTime((candles.time[hover] as number) * 1000)} wall clock</div>
            <div>
              open {fmt(candles.open[hover], 2)} · high {fmt(candles.high[hover], 2)} · low {fmt(candles.low[hover], 2)} · close {fmt(candles.close[hover], 2)}
            </div>
            <div>volume {fmtInt(candles.volume[hover])} · {(candles.sign[hover] as number) > 0 ? "▲ close above the previous close" : (candles.sign[hover] as number) < 0 ? "▼ close below the previous close" : "– no change"}</div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: CANDLE_UP_COLOR }}>▲ hollow orange candle = close above the previous close</span> ·{" "}
        <span style={{ color: CANDLE_DOWN_COLOR }}>▼ filled blue candle = below</span>. Volume bars take the same colour. Times are the lake&apos;s stamps: Pacific wall clock stored as UTC.
      </p>
    </div>
  );
}

const BUCKET_OPTIONS = [
  { value: "native", label: "each bar" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "1d", label: "trading day" },
  { value: "1w", label: "week" },
] as const;

export function PriceSection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({ priceBucket: "native", priceBars: 800, pricePosition: 1000 });
  const { query, notes, body, unavailable } = useSection<PriceBody>("price", choice, controls);
  const last = body ? body.candles.time.length - 1 : -1;

  return (
    <Section title="2 · Price series" question={`MNQ ${choice.timeframe} open, high, low, close and volume. Slide the window through the history or widen the bucket to see all of it.`}>
      <div className="space-y-2">
        <ControlBar onReset={reset}>
          <SegmentControl label="Bucket" value={controls.priceBucket} options={BUCKET_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => set("priceBucket", v)} hint="Aggregates bars into open = first, high = max, low = min, close = last, volume = sum. A bucket no longer than the bar is the bar itself." />
          <SliderControl label="Candles shown" value={controls.priceBars} min={50} max={3000} step={10} onChange={(v) => set("priceBars", v)} />
          <SliderControl label="Window ends at" value={controls.pricePosition} min={0} max={1000} step={5} onChange={(v) => set("pricePosition", v)} format={(v) => `${(v / 10).toFixed(1)}% of history`} hint="Scrub the window through the series; 100% is the latest bar" />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : (
            <>
              <Finding>
                {fmtInt(body.candles.time.length)} of {fmtInt(body.bucketCount)} {body.bucket === "native" ? `${choice.timeframe} bars` : `${body.bucket} buckets`}, from {fmtTime((body.candles.time[0] as number) * 1000)} to {fmtTime((body.candles.time[last] as number) * 1000)}; closes between {fmt(Math.min(...body.candles.low), 2)} and {fmt(Math.max(...body.candles.high), 2)} points in this window.
              </Finding>
              <CandleChart candles={body.candles} height={420} />
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
