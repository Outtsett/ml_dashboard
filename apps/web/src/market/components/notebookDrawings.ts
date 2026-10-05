/**
 * Draws levels, shaded time zones, vertical lines and price bands (support /
 * resistance clouds) on the Market chart: the chart's own S/R zones and what a
 * notebook or script sent through the chart link (useNotebookOverlays.ts).
 *
 * Levels are the series' own price lines. Zones and vertical lines are one
 * series primitive, read at draw time so they stay pinned through pan and zoom.
 * A time is snapped to the bar that contains it — the chart only has
 * coordinates for its own bars — and a zone that starts or ends outside the
 * loaded bars is clipped to them, never dropped.
 */

import { useEffect, useRef } from "react";
import {
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type ISeriesPrimitiveAxisView,
  type Logical,
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { NotebookBand, NotebookDrawings, NotebookVerticalLine, NotebookZone } from "@/market/lib/useNotebookOverlays";

/** The index of the last bar at or before `seconds`, or -1. Exported for tests. */
export function barIndexAtOrBefore(times: readonly number[], seconds: number): number {
  let low = 0;
  let high = times.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (times[middle]! <= seconds) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** A zone as the bar indices it covers, clipped to the loaded bars; null when it
 *  lies wholly outside them. Exported for tests. */
export function zoneBarSpan(times: readonly number[], startMs: number, endMs: number): { first: number; last: number } | null {
  if (times.length === 0) return null;
  const startSeconds = Math.floor(startMs / 1000);
  const endSeconds = Math.floor(endMs / 1000);
  if (endSeconds < times[0]! || startSeconds > times[times.length - 1]!) return null;
  const first = Math.max(0, barIndexAtOrBefore(times, startSeconds));
  const last = Math.max(first, barIndexAtOrBefore(times, endSeconds));
  return { first, last };
}

/** Thinnest a price band may render. Below this a zone reads as a flat price line, not a region. */
const MIN_BAND_HEIGHT_PX = 4;

function translucent(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(colour);
  if (!hex) return colour;
  return `rgba(${parseInt(hex[1]!, 16)}, ${parseInt(hex[2]!, 16)}, ${parseInt(hex[3]!, 16)}, ${alpha})`;
}

class DrawingsRenderer implements IPrimitivePaneRenderer {
  public constructor(private readonly source: NotebookDrawingsPrimitive, private readonly layer: "behind" | "front") {}

  public draw(target: CanvasRenderingTarget2D): void {
    const chart = this.source.chart;
    const times = this.source.times;
    if (!chart || times.length === 0) return;
    const timeScale = chart.timeScale();
    const half = Math.max(1, timeScale.options().barSpacing / 2);
    // Logical coordinates give a position for a bar that is scrolled off screen too (a band or zone
    // that started before the visible range still spans it); timeToCoordinate would return null.
    const x = (index: number) => timeScale.logicalToCoordinate(index as Logical);
    target.useMediaCoordinateSpace((scope) => {
      const context = scope.context;
      const height = scope.mediaSize.height;
      context.save();
      if (this.layer === "behind") {
        for (const zone of this.source.zones) this.drawZone(context, zone, x, half, height);
        for (const band of this.source.bands) this.drawBand(context, band, x, half, scope.mediaSize.width);
      } else {
        for (const line of this.source.verticalLines) this.drawVertical(context, line, x, height);
      }
      context.restore();
    });
  }

  private drawZone(context: CanvasRenderingContext2D, zone: NotebookZone, x: (index: number) => number | null, half: number, height: number): void {
    const span = zoneBarSpan(this.source.times, zone.startMs, zone.endMs);
    if (!span) return;
    const left = x(span.first);
    const right = x(span.last);
    if (left === null || right === null) return;
    context.fillStyle = translucent(zone.color, 0.14);
    context.fillRect(left - half, 0, right - left + 2 * half, height);
    context.fillStyle = zone.color;
    context.font = "10px ui-sans-serif, system-ui, sans-serif";
    context.fillText(zone.label, left - half + 3, 12);
  }

  /** A cloud: the bars the band spans (to the last bar when open-ended) between its two prices. */
  private drawBand(context: CanvasRenderingContext2D, band: NotebookBand, x: (index: number) => number | null, half: number, width: number): void {
    const series = this.source.series;
    const times = this.source.times;
    if (!series || times.length === 0) return;
    const endMs = band.endMs ?? times[times.length - 1]! * 1000;
    const span = zoneBarSpan(times, band.startMs, endMs);
    if (!span) return;
    const left = x(span.first);
    const right = band.endMs === null ? width : x(span.last);
    const top = series.priceToCoordinate(band.top);
    const bottom = series.priceToCoordinate(band.bottom);
    if (left === null || right === null || top === null || bottom === null) return;
    // A tight zone (top ≈ bottom) used to collapse to a 1px stroke that read as a flat price line
    // spanning weeks. Grow it symmetrically about its centre to a minimum readable thickness.
    const rawHeight = Math.abs(bottom - top);
    const h = Math.max(MIN_BAND_HEIGHT_PX, rawHeight);
    const y = (top + bottom) / 2 - h / 2;

    const fillAlpha = band.opacity ?? 0.22;
    context.fillStyle = translucent(band.color, fillAlpha);
    context.fillRect(left - half, y, right - left + 2 * half, h);
    // Edge strokes only when the zone has real height; on a degenerate zone they re-create the line.
    if (rawHeight >= MIN_BAND_HEIGHT_PX) {
      const strokeAlpha = band.opacity !== undefined ? Math.min(1, band.opacity + 0.3) : 0.5;
      context.strokeStyle = translucent(band.color, strokeAlpha);
      context.lineWidth = 1;
      context.strokeRect(left - half + 0.5, y + 0.5, right - left + 2 * half - 1, h - 1);
    }
    // Axis-labelled bands carry their tag on the price scale (BandAxisView) — never over candles.
    if (band.axisLabel) return;
    context.fillStyle = band.color;
    context.font = "10px ui-sans-serif, system-ui, sans-serif";
    context.fillText(band.label, left - half + 3, y - 3 < 10 ? y + h + 11 : y - 3);
  }

  private drawVertical(context: CanvasRenderingContext2D, line: NotebookVerticalLine, x: (index: number) => number | null, height: number): void {
    const index = barIndexAtOrBefore(this.source.times, Math.floor(line.timeMs / 1000));
    if (index < 0) return;
    const position = x(index);
    if (position === null) return;
    context.strokeStyle = line.color;
    context.setLineDash([4, 3]);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(Math.round(position) + 0.5, 0);
    context.lineTo(Math.round(position) + 0.5, height);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = line.color;
    context.font = "10px ui-sans-serif, system-ui, sans-serif";
    context.fillText(line.label, position + 4, height - 6);
  }
}

class DrawingsPaneView implements IPrimitivePaneView {
  private readonly rendererInstance: DrawingsRenderer;
  public constructor(source: NotebookDrawingsPrimitive, private readonly layer: "behind" | "front") {
    this.rendererInstance = new DrawingsRenderer(source, layer);
  }
  public zOrder(): PrimitivePaneViewZOrder {
    return this.layer === "behind" ? "bottom" : "top";
  }
  public renderer(): IPrimitivePaneRenderer {
    return this.rendererInstance;
  }
}

/**
 * A band's tag on the right price scale, at the band's centre price. This is where S/R zones are
 * labelled — the axis is the one strip of the chart that never holds candles.
 */
class BandAxisView implements ISeriesPrimitiveAxisView {
  public constructor(private readonly y: number, private readonly label: string, private readonly colour: string) {}
  public coordinate(): number { return this.y; }
  public text(): string { return this.label; }
  public textColor(): string { return "#ffffff"; }
  public backColor(): string { return this.colour; }
  public visible(): boolean { return true; }
  public tickVisible(): boolean { return false; }
}

export class NotebookDrawingsPrimitive implements ISeriesPrimitive<Time> {
  public chart: IChartApi | null = null;
  public series: ISeriesApi<SeriesType> | null = null;
  public times: readonly number[] = [];
  public zones: NotebookZone[] = [];
  public verticalLines: NotebookVerticalLine[] = [];
  public bands: NotebookBand[] = [];
  private requestUpdate: (() => void) | null = null;
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private readonly views: readonly IPrimitivePaneView[] = [new DrawingsPaneView(this, "behind"), new DrawingsPaneView(this, "front")];

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<SeriesType>;
    this.requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  public set(times: readonly number[], zones: NotebookZone[], verticalLines: NotebookVerticalLine[], bands: NotebookBand[] = []): void {
    this.times = times;
    this.zones = zones;
    this.verticalLines = verticalLines;
    this.bands = bands;
    this.requestUpdate?.();
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  public priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  public updateAllViews(): void {
    // Pane coordinates are read at draw time; axis tags are positioned here, once per frame.
    const series = this.series;
    if (!series) { this.axisViews = []; return; }
    const views: ISeriesPrimitiveAxisView[] = [];
    for (const band of this.bands) {
      if (!band.axisLabel) continue;
      const y = series.priceToCoordinate((band.top + band.bottom) / 2);
      if (y === null) continue; // centre is off the visible price range
      views.push(new BandAxisView(y, band.axisLabel, band.color));
    }
    this.axisViews = views;
  }
}

const LINE_STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;

/** Keeps the drawings on the candle series, re-attaching when the chart is rebuilt. `extraBands` are
 *  the chart's own clouds (the S/R zones) drawn beside whatever the chart link sent. */
export function useNotebookDrawings(
  candleSeriesRef: React.MutableRefObject<ISeriesApi<SeriesType> | null>,
  candleTimes: readonly number[],
  drawings: NotebookDrawings | undefined,
  extraBands: NotebookBand[] = [],
): void {
  const primitiveRef = useRef<NotebookDrawingsPrimitive | null>(null);
  const attachedToRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const series = candleSeriesRef.current;

  useEffect(() => {
    if (!series) return;
    if (attachedToRef.current !== series) {
      primitiveRef.current = new NotebookDrawingsPrimitive();
      series.attachPrimitive(primitiveRef.current);
      attachedToRef.current = series;
      priceLinesRef.current = [];
    }
    primitiveRef.current?.set(candleTimes, drawings?.zones ?? [], drawings?.verticalLines ?? [], [...(drawings?.bands ?? []), ...extraBands]);

    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // the series was rebuilt; its lines went with it
      }
    }
    priceLinesRef.current = (drawings?.levels ?? []).map((level) =>
      series.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: LINE_STYLE[level.style],
        axisLabelVisible: true,
        title: level.label,
      }),
    );
  }, [series, candleTimes, drawings, extraBands]);

  useEffect(() => () => {
    const attached = attachedToRef.current;
    if (!attached) return;
    try {
      if (primitiveRef.current) attached.detachPrimitive(primitiveRef.current);
      for (const line of priceLinesRef.current) attached.removePriceLine(line);
    } catch {
      // chart already disposed
    }
  }, []);
}
