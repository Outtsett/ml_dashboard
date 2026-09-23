/**
 * PriceLens — V1 prediction + interval, V2 trade markers, V7 regime ribbon on the candles.
 *
 * Three stacked panes on one time axis (UTC):
 *   0. Candles + the row-t+H interval band + trade markers.
 *   1. Probability of up, with the 0.5 baseline and the long/short threshold.
 *   2. Regime ribbon: +1 bull / -1 bear / 0 sideways.
 *
 * Rendered once via lightweight-charts v5; data updates reuse the series
 * (`setData`), never recreate the chart.
 */

import { useEffect, useRef } from "react";
import {
  volumeSeriesOptions,
  volumeScaleMargins,
  VOLUME_UP_FILL,
  VOLUME_DOWN_FILL,
} from '@/market/components/chartConfig';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from "lightweight-charts";
import type { LensBar, LensBarWindow, LensManifest, LensRegimes, LensTrade } from "@shared/lens/types";
import {
  createChartOptions,
  candleSeriesOptions,
  CANDLE_UP_COLOR,
  CANDLE_DOWN_COLOR,
  MARKER_NEUTRAL_COLOR,
} from "@/market/components/chartConfig";
import { useSeriesMarkers } from "@/market/components/useSeriesMarkers";
import { DATA_COLORS } from "@/shared/theme/dataColors";
import {
  buildIntervalSeries,
  buildRegimeHistogram,
  buildTradeMarkers,
  decimalsFromTick,
} from "./priceLensData";

export interface LensPriceLayers {
  interval: boolean;
  trades: boolean;
  regimes: boolean;
  probability: boolean;
}

export interface PriceLensProps {
  window: LensBarWindow;
  trades: LensTrade[];
  regimes: LensRegimes;
  manifest: LensManifest;
  layers: LensPriceLayers;
  /** rowIndex of the playback cursor; the chart draws a marker/line there. */
  cursorRowIndex: number | null;
  /** Clicking a bar moves the cursor (rowIndex). */
  onCursorChange?: (rowIndex: number) => void;
  /** Fixed pixel height. Omit to fill the parent, which is what a resizable frame gives it. */
  height?: number;
}

interface LegendItemProps {
  color: string;
  label: string;
  dashed?: boolean;
  glyph?: string;
  dim?: boolean;
}

function LegendItem({ color, label, dashed, glyph, dim }: LegendItemProps) {
  return (
    <span className={dim ? "flex items-center gap-1.5 opacity-40" : "flex items-center gap-1.5"}>
      <span
        className="inline-block h-0.5 w-3.5"
        style={{
          backgroundColor: dashed ? "transparent" : color,
          borderTop: dashed ? `2px dashed ${color}` : undefined,
        }}
        aria-hidden
      />
      {glyph && (
        <span className="font-mono" style={{ color }} aria-hidden>
          {glyph}
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

export function PriceLens({ window: barWindow, trades, manifest, layers, cursorRowIndex, onCursorChange, height }: PriceLensProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const intervalUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const intervalLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const intervalMedianRef = useRef<ISeriesApi<"Line"> | null>(null);
  const probabilitySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const regimeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersPluginRef = useRef<any>(null);
  const baselinePriceLineRef = useRef<IPriceLine | null>(null);
  const longThresholdLineRef = useRef<IPriceLine | null>(null);
  const shortThresholdLineRef = useRef<IPriceLine | null>(null);
  const barsByTimeRef = useRef<Map<number, LensBar>>(new Map());
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  const decimals = decimalsFromTick(manifest.cost.tickSize);
  const minMove = manifest.cost.tickSize > 0 ? manifest.cost.tickSize : Math.pow(10, -decimals);

  // ── Create chart + series once (recreated only if price precision changes) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, createChartOptions());
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, candleSeriesOptions(decimals, minMove), 0);
    candleSeriesRef.current = candleSeries;

    // Volume, constructed exactly as the market chart does it: its own overlay
    // price scale (priceScaleId '') pinned to the bottom band, so it shares the
    // pane without compressing the candles' scale. `LensBar.volume` already
    // arrives from the bars endpoint, so this is client-side only.
    const volumeSeries = chart.addSeries(HistogramSeries, volumeSeriesOptions, 0);
    volumeSeries.priceScale().applyOptions({ scaleMargins: volumeScaleMargins });
    volumeSeriesRef.current = volumeSeries;

    const intervalUpper = chart.addSeries(
      LineSeries,
      {
        color: MARKER_NEUTRAL_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        title: "interval upper",
      },
      0,
    );
    intervalUpperRef.current = intervalUpper;

    const intervalLower = chart.addSeries(
      LineSeries,
      {
        color: MARKER_NEUTRAL_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        title: "interval lower",
      },
      0,
    );
    intervalLowerRef.current = intervalLower;

    const intervalMedian = chart.addSeries(
      LineSeries,
      {
        color: MARKER_NEUTRAL_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        title: "interval median",
      },
      0,
    );
    intervalMedianRef.current = intervalMedian;

    const probabilitySeries = chart.addSeries(
      LineSeries,
      {
        color: DATA_COLORS.warn,
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: false,
        title: "P(up)",
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 1 },
        }),
      },
      1,
    );
    probabilitySeriesRef.current = probabilitySeries;
    baselinePriceLineRef.current = probabilitySeries.createPriceLine({
      price: 0.5,
      color: DATA_COLORS.neutral,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: "0.5",
    });
    longThresholdLineRef.current = probabilitySeries.createPriceLine({
      price: 0.5,
      color: DATA_COLORS.pos,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "long ≥",
    });
    shortThresholdLineRef.current = probabilitySeries.createPriceLine({
      price: 0.5,
      color: DATA_COLORS.neg,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "short ≤",
    });

    const regimeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        base: 0,
        lastValueVisible: false,
        priceLineVisible: false,
      },
      2,
    );
    regimeSeriesRef.current = regimeSeries;

    const panes = chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(2);
    panes[2]?.setStretchFactor(0.8);

    const handleClick = (param: { time?: Time }) => {
      if (param.time == null) return;
      const bar = barsByTimeRef.current.get(param.time as unknown as number);
      if (bar) onCursorChangeRef.current?.(bar.rowIndex);
    };
    chart.subscribeClick(handleClick);

    const resizeObserver = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeClick(handleClick);
      chart.remove();
      chartRef.current = null;
    };
     
  }, [decimals, minMove]);

  // ── Trade markers via the shared plugin-lifecycle hook ──────────────────
  const tradeMarkers = layers.trades
    ? buildTradeMarkers(barWindow.bars, trades, { up: CANDLE_UP_COLOR, down: CANDLE_DOWN_COLOR, neutral: MARKER_NEUTRAL_COLOR })
    : [];
  useSeriesMarkers(markersPluginRef, candleSeriesRef, tradeMarkers);

  // ── Data updates ──────────────────────────────────────────────────────────
  useEffect(() => {
    const bars = barWindow.bars;
    barsByTimeRef.current = new Map(bars.map((bar) => [bar.timestampSeconds, bar]));

    candleSeriesRef.current?.setData(
      bars.map((bar) => ({ time: bar.timestampSeconds as Time, open: bar.open, high: bar.high, low: bar.low, close: bar.close })),
    );

    // A bar with null volume is skipped, not drawn as zero. The lens parquet
    // carries volume as nullable, and a zero bar would read as "nothing traded"
    // rather than "this model's source did not record it".
    volumeSeriesRef.current?.setData(
      bars
        .filter((bar) => bar.volume !== null && Number.isFinite(bar.volume))
        .map((bar) => ({
          time: bar.timestampSeconds as Time,
          value: bar.volume as number,
          color: bar.close >= bar.open ? VOLUME_UP_FILL : VOLUME_DOWN_FILL,
        })),
    );

    const interval = buildIntervalSeries(bars, manifest.horizonBars);
    intervalUpperRef.current?.setData(layers.interval ? interval.upper : []);
    intervalLowerRef.current?.setData(layers.interval ? interval.lower : []);
    intervalMedianRef.current?.setData(layers.interval ? interval.median : []);

    probabilitySeriesRef.current?.setData(
      layers.probability ? bars.map((bar) => ({ time: bar.timestampSeconds as Time, value: bar.probabilityUp })) : [],
    );
    baselinePriceLineRef.current?.applyOptions({ lineVisible: layers.probability });
    longThresholdLineRef.current?.applyOptions({
      price: barWindow.params.threshold,
      lineVisible: layers.probability,
      title: `long ≥ ${barWindow.params.threshold.toFixed(3)}`,
    });
    shortThresholdLineRef.current?.applyOptions({
      price: 1 - barWindow.params.threshold,
      lineVisible: layers.probability,
      title: `short ≤ ${(1 - barWindow.params.threshold).toFixed(3)}`,
    });

    regimeSeriesRef.current?.setData(
      layers.regimes ? buildRegimeHistogram(bars, { bull: DATA_COLORS.pos, bear: DATA_COLORS.neg, sideways: DATA_COLORS.neutral }) : [],
    );
  }, [barWindow, layers.interval, layers.probability, layers.regimes, manifest.horizonBars]);

  // ── Cursor: crosshair pinned to the playback row ─────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;
    if (cursorRowIndex == null) {
      chart.clearCrosshairPosition();
      return;
    }
    const bar = barWindow.bars.find((b) => b.rowIndex === cursorRowIndex);
    if (bar) chart.setCrosshairPosition(bar.close, bar.timestampSeconds as Time, candleSeries);
    else chart.clearCrosshairPosition();
  }, [cursorRowIndex, barWindow]);

  const coveragePercent = Math.round(barWindow.params.intervalCoverage * 100);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="price-lens">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <LegendItem color={CANDLE_UP_COLOR} label="up bar" />
        <LegendItem color={CANDLE_DOWN_COLOR} label="down bar" />
        <LegendItem
          color={MARKER_NEUTRAL_COLOR}
          dashed
          label={`${coveragePercent}% interval for price ${manifest.horizonBars} bars ahead`}
          dim={!layers.interval}
        />
        <LegendItem color={DATA_COLORS.warn} label="P(up)" dim={!layers.probability} />
        <LegendItem color={CANDLE_UP_COLOR} glyph="▲" label="enter long" dim={!layers.trades} />
        <LegendItem color={CANDLE_DOWN_COLOR} glyph="▼" label="enter short" dim={!layers.trades} />
        <LegendItem color={MARKER_NEUTRAL_COLOR} glyph="●" label="exit" dim={!layers.trades} />
        <LegendItem color={DATA_COLORS.pos} glyph="▲" label="bull regime" dim={!layers.regimes} />
        <LegendItem color={DATA_COLORS.neg} glyph="▼" label="bear regime" dim={!layers.regimes} />
        <LegendItem color={DATA_COLORS.neutral} glyph="◆" label="sideways regime" dim={!layers.regimes} />
      </div>
      <div
        ref={containerRef}
        className={height ? undefined : "min-h-0 flex-1"}
        style={height ? { height, width: "100%" } : { width: "100%" }}
        data-testid="price-lens-chart"
      />
      <div className="mt-1 shrink-0 text-[10px] text-muted-foreground">Time axis: UTC</div>
    </div>
  );
}
