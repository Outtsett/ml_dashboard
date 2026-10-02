/**
 * The study's candle chart on lightweight-charts: candles (orange up, blue
 * down), price-level indicator overlays, TA-Lib pattern markers, shaded bars,
 * the direction-label strip, volume and one pane per indicator group. The
 * whole chart is rebuilt when its inputs change (at most 1,500 bars).
 */

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers, createTextWatermark,
  type IChartApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { createChartOptions } from "@/market/components/chartConfig";
import { OKABE } from "@/studies/kit";

export interface CandleBar {
  bar_index: number;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  direction_binary?: number | null;
  exclusion_reason?: string | null;
  values?: Record<string, number | null>;
}

export interface CandleMarker {
  bar_index: number;
  shape: "arrowUp" | "arrowDown" | "square" | "circle";
  position: "aboveBar" | "belowBar" | "inBar";
  color: string;
  text?: string;
}

export const OVERLAY_COLORS = [OKABE.sky, OKABE.vermillion, OKABE.purple, OKABE.green, OKABE.yellow, OKABE.grey, "#f5f5f5"];
export const OVERLAY_STYLES = [LineStyle.Solid, LineStyle.Dashed, LineStyle.Dotted, LineStyle.LargeDashed, LineStyle.SparseDotted];
export const PANEL_COLORS = [OKABE.orange, OKABE.blue, OKABE.vermillion, OKABE.sky];

function seconds(timestamp: number): UTCTimestamp {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

/** Group the chosen panel columns: MACD's three lines share one pane, everything else gets its own. */
export function panelGroups(columns: readonly string[]): string[][] {
  const macd = columns.filter((column) => column.startsWith("macd_") && !column.startsWith("macdext") && !column.startsWith("macdfix"));
  const single = columns.filter((column) => !macd.includes(column));
  return [...(macd.length ? [macd] : []), ...single.map((column) => [column])];
}

export function CandleChart({
  bars, overlays = [], groups = [], markers = [], bands = [], showVolume = true, strip = false, height = 560, onHover,
}: {
  bars: readonly CandleBar[];
  overlays?: readonly string[];
  groups?: ReadonlyArray<readonly string[]>;
  markers?: readonly CandleMarker[];
  bands?: ReadonlyArray<{ bar_index: number; color: string }>;
  showVolume?: boolean;
  strip?: boolean;
  height?: number;
  onHover?: (barIndex: number | null) => void;
}) {
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
      rightPriceScale: { ...base.rightPriceScale, scaleMargins: { top: 0.06, bottom: 0.06 } },
      localization: { timeFormatter: (time: Time) => new Date(Number(time) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" },
    });
    const timeOf = new Map<number, UTCTimestamp>(bars.map((bar) => [bar.bar_index, seconds(bar.timestamp)]));
    const indexOf = new Map<number, number>(bars.map((bar) => [seconds(bar.timestamp), bar.bar_index]));

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: OKABE.orange, downColor: OKABE.blue, borderUpColor: OKABE.orange, borderDownColor: OKABE.blue,
      wickUpColor: "#d4d4d4", wickDownColor: "#d4d4d4", priceLineVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.25 },
    }, 0);
    candles.setData(bars.map((bar) => ({ time: seconds(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));

    if (bands.length) {
      const shade = chart.addSeries(HistogramSeries, {
        priceScaleId: "bands", priceLineVisible: false, lastValueVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }),
      }, 0);
      shade.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      const byBar = new Map(bands.map((band) => [band.bar_index, band.color]));
      shade.setData(bars.map((bar) => (byBar.has(bar.bar_index) ? { time: seconds(bar.timestamp), value: 1, color: byBar.get(bar.bar_index) } : { time: seconds(bar.timestamp) })));
    }

    overlays.forEach((column, index) => {
      const color = OVERLAY_COLORS[index % OVERLAY_COLORS.length] as string;
      const isSar = column.startsWith("sar");
      const line = chart.addSeries(LineSeries, {
        color, lineWidth: isSar ? 1 : 2, lineStyle: OVERLAY_STYLES[index % OVERLAY_STYLES.length], title: column,
        // A parabolic SAR jumps sides when it flips; a line through it draws strokes that are not in the data.
        lineVisible: !isSar, pointMarkersVisible: isSar, pointMarkersRadius: 1.5,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      }, 0);
      line.setData(bars.map((bar) => {
        const value = bar.values?.[column];
        return value === null || value === undefined ? { time: seconds(bar.timestamp) } : { time: seconds(bar.timestamp), value };
      }));
    });

    const priceMarkers: SeriesMarker<Time>[] = [];
    for (const marker of markers) {
      const time = timeOf.get(marker.bar_index);
      if (time === undefined) continue;
      priceMarkers.push({ time, shape: marker.shape, position: marker.position, color: marker.color, text: marker.text, size: 0.8 });
    }
    priceMarkers.sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(candles, priceMarkers);

    let pane = 1;
    const titles: Array<[number, string]> = [];
    if (strip) {
      const label = chart.addSeries(LineSeries, { color: "rgba(0,0,0,0)", lineVisible: false, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      label.setData(bars.map((bar) => ({ time: seconds(bar.timestamp), value: 0 })));
      createSeriesMarkers(label, bars.map((bar) => ({
        time: seconds(bar.timestamp),
        position: "inBar" as const,
        shape: bar.direction_binary === 1 ? ("arrowUp" as const) : bar.direction_binary === 0 ? ("arrowDown" as const) : ("circle" as const),
        color: bar.direction_binary === 1 ? OKABE.orange : bar.direction_binary === 0 ? OKABE.blue : OKABE.grey,
        size: 0.6,
      })));
      titles.push([pane, "direction label h bars ahead: ▲ higher · ▼ lower · ● excluded"]);
      pane += 1;
    }
    if (showVolume) {
      const volume = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" } }, pane);
      volume.setData(bars.map((bar) => ({ time: seconds(bar.timestamp), value: bar.volume ?? 0, color: bar.close >= bar.open ? OKABE.orange : OKABE.blue })));
      titles.push([pane, "volume (contracts)"]);
      pane += 1;
    }
    for (const group of groups) {
      let colorIndex = 0;
      for (const column of group) {
        if (column.includes("histogram")) {
          const histogram = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: column }, pane);
          histogram.setData(bars.map((bar) => {
            const value = bar.values?.[column];
            return value === null || value === undefined
              ? { time: seconds(bar.timestamp) }
              : { time: seconds(bar.timestamp), value, color: value >= 0 ? `${OKABE.orange}aa` : `${OKABE.blue}aa` };
          }));
        } else {
          const line = chart.addSeries(LineSeries, {
            color: PANEL_COLORS[colorIndex % PANEL_COLORS.length], lineWidth: 1,
            lineStyle: colorIndex === 0 ? LineStyle.Solid : LineStyle.Dashed, title: column,
            priceLineVisible: false, lastValueVisible: true,
          }, pane);
          colorIndex += 1;
          line.setData(bars.map((bar) => {
            const value = bar.values?.[column];
            return value === null || value === undefined ? { time: seconds(bar.timestamp) } : { time: seconds(bar.timestamp), value };
          }));
        }
      }
      titles.push([pane, group.join(" / ")]);
      pane += 1;
    }
    const panes = chart.panes();
    panes.forEach((entry, index) => entry.setStretchFactor(index === 0 ? 6 : strip && index === 1 ? 0.45 : 1.3));
    for (const [index, title] of titles) {
      const target = panes[index];
      if (target) createTextWatermark(target, { horzAlign: "left", vertAlign: "top", lines: [{ text: title, color: "rgba(255,255,255,0.5)", fontSize: 10 }] });
    }
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((parameter) => {
      if (parameter.time === undefined) {
        hoverRef.current?.(null);
        return;
      }
      hoverRef.current?.(indexOf.get(Number(parameter.time)) ?? null);
    });
    return () => chart.remove();
  }, [bars, overlays, groups, markers, bands, showVolume, strip]);

  return <div ref={container} className="w-full min-w-0" style={{ height }} />;
}
