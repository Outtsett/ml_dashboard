/**
 * Draws notebook levels, shaded time zones and vertical lines on the Market
 * chart (the data comes from useNotebookOverlays.ts).
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
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { NotebookDrawings, NotebookVerticalLine, NotebookZone } from "@/market/lib/useNotebookOverlays";

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
    const x = (index: number) => timeScale.timeToCoordinate(times[index]! as Time);
    target.useMediaCoordinateSpace((scope) => {
      const context = scope.context;
      const height = scope.mediaSize.height;
      context.save();
      if (this.layer === "behind") {
        for (const zone of this.source.zones) this.drawZone(context, zone, x, half, height);
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

export class NotebookDrawingsPrimitive implements ISeriesPrimitive<Time> {
  public chart: IChartApi | null = null;
  public times: readonly number[] = [];
  public zones: NotebookZone[] = [];
  public verticalLines: NotebookVerticalLine[] = [];
  private requestUpdate: (() => void) | null = null;
  private readonly views: readonly IPrimitivePaneView[] = [new DrawingsPaneView(this, "behind"), new DrawingsPaneView(this, "front")];

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  public set(times: readonly number[], zones: NotebookZone[], verticalLines: NotebookVerticalLine[]): void {
    this.times = times;
    this.zones = zones;
    this.verticalLines = verticalLines;
    this.requestUpdate?.();
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  public updateAllViews(): void {
    // Coordinates are read at draw time.
  }
}

const LINE_STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;

/** Keeps the notebook drawings on the candle series, re-attaching when the chart is rebuilt. */
export function useNotebookDrawings(
  candleSeriesRef: React.MutableRefObject<ISeriesApi<SeriesType> | null>,
  candleTimes: readonly number[],
  drawings: NotebookDrawings | undefined,
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
    primitiveRef.current?.set(candleTimes, drawings?.zones ?? [], drawings?.verticalLines ?? []);

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
  }, [series, candleTimes, drawings]);

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
