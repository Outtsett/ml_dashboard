import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

import { findBarIndex, type CycleBarColumns } from "@shared/cycle/schema";

import { CYCLE_COLORS, spanToLogical, withAlpha, type BandLayout } from "./chartModel";

/**
 * Canvas layer of the Model Cycle chart, attached to the candlestick series.
 *
 * Draws, on pane 0:
 *  - BEHIND the candles: the fold spans (training sky, validation yellow, test
 *    walk orange, earlier folds' test walks very faint) and the ACTIVE block the
 *    model is fitting / validating / tuning right now (reddish-purple);
 *  - IN FRONT: each band's label pill along the top edge, the dashed test
 *    cursor ("model is here"), the label-correctness row just above the
 *    prediction strip, and the brief highlight a table row's "show on chart"
 *    asks for.
 *
 * Why correctness is drawn here and not as a series: a label resolves
 * `labelHorizonBars` AFTER its bar was drawn, and lightweight-charts' `update()`
 * only rewrites the LAST point cheaply (`historicalUpdate` re-processes the
 * series). The primitive instead reads `columns.correct` at draw time for the
 * visible bars only, so a resolved label costs nothing until it is on screen.
 *
 * Geometry goes through LOGICAL indices (`logicalToCoordinate`), never
 * `timeToCoordinate`: a span edge that is off-screen still has a coordinate,
 * so a partly visible span is clamped instead of vanishing. Only bars the
 * chart has drawn (`renderedCount`) are ever covered.
 */

const FONT_FAMILY = "'JetBrains Mono', monospace";
const LABEL_FONT = `11px ${FONT_FAMILY}`;
const LABEL_HEIGHT = 17;
const LABEL_PADDING = 6;
const LABEL_GAP = 3;
/** Below the DOM legend line at the top-left of the chart. */
const LABEL_TOP = 28;
const SWATCH_SIZE = 7;
const EDGE_MARGIN = 4;
const PILL_BACKGROUND = "rgba(11, 15, 22, 0.86)";
const PILL_TEXT = "#E8ECF1";
const CORRECTNESS_ROW_HEIGHT = 8;
const CORRECTNESS_GAP = 3;
const FLASH_FILL = withAlpha(CYCLE_COLORS.yellow, 0.28);

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

interface PixelSpan {
  left: number;
  right: number;
}

class BandsRenderer implements IPrimitivePaneRenderer {
  private readonly _source: CycleBandsPrimitive;
  private readonly _layer: "behind" | "front";

  public constructor(source: CycleBandsPrimitive, layer: "behind" | "front") {
    this._source = source;
    this._layer = layer;
  }

  public draw(target: CanvasRenderingTarget2D): void {
    const chart = this._source.chart;
    const columns = this._source.columns;
    if (!chart || !columns || this._source.renderedCount === 0) return;
    target.useMediaCoordinateSpace((scope) => {
      const context = scope.context;
      const width = scope.mediaSize.width;
      const height = scope.mediaSize.height;
      context.save();
      if (this._layer === "behind") this._drawFills(context, chart, columns, width, height);
      else {
        this._drawCorrectness(context, chart, columns, width, height);
        this._drawFlash(context, chart, columns, height);
        this._drawCursor(context, chart, columns, width, height);
        this._drawLabels(context, chart, columns, width);
      }
      context.restore();
    });
  }

  /** Pixel extent of a time span over the drawn bars, clamped to the pane; null when off-screen or empty. */
  private _pixelSpan(chart: IChartApi, timestamps: readonly number[], start: number, end: number, width: number): PixelSpan | null {
    const logical = spanToLogical(timestamps, start, end);
    if (!logical) return null;
    const lastDrawn = this._source.renderedCount - 1;
    const to = Math.min(logical.to, lastDrawn + 0.5);
    if (to <= logical.from) return null;
    const timeScale = chart.timeScale();
    // Convert the first and last BAR (integer logical indices) and widen by
    // half a bar. lightweight-charts 5.1's logicalToCoordinate returns 0 for a
    // fractional index such as `first - 0.5` (measured 2026-09-25: 23357.5 →
    // 0 while 23500 → 280 px), which collapsed every band to zero width, so no
    // band or band label was ever drawn.
    const firstBar = Math.ceil(logical.from);
    const lastBar = Math.floor(to);
    if (lastBar < firstBar) return null;
    const xFirst = timeScale.logicalToCoordinate(firstBar as Logical);
    const xLast = timeScale.logicalToCoordinate(lastBar as Logical);
    if (xFirst === null || xLast === null) return null;
    const halfBar = timeScale.options().barSpacing / 2;
    const x1 = xFirst - halfBar;
    const x2 = xLast + halfBar;
    const left = Math.max(0, Math.min(x1, x2));
    const right = Math.min(width, Math.max(x1, x2));
    if (right <= 0 || left >= width || right - left < 0.5) return null;
    return { left, right };
  }

  private _drawFills(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, width: number, height: number): void {
    for (const band of this._source.layout.bands) {
      const span = this._pixelSpan(chart, columns.timestamps, band.start, band.end, width);
      if (!span) continue;
      context.fillStyle = band.fill;
      context.fillRect(span.left, 0, span.right - span.left, height);
      if (band.kind === "active") {
        // Edges make the block readable even where it sits over a same-hue band.
        context.strokeStyle = withAlpha(band.edge, 0.8);
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(span.left + 0.5, 0);
        context.lineTo(span.left + 0.5, height);
        context.moveTo(span.right - 0.5, 0);
        context.lineTo(span.right - 0.5, height);
        context.stroke();
      }
    }
  }

  private _drawLabels(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, width: number): void {
    context.font = LABEL_FONT;
    context.textBaseline = "middle";
    context.textAlign = "left";
    // The active block first so it always gets the top row.
    const labelled = this._source.layout.bands
      .filter((band) => band.label)
      .sort((a, b) => (a.kind === "active" ? -1 : 0) - (b.kind === "active" ? -1 : 0));
    const placed: { left: number; right: number; row: number }[] = [];
    for (const band of labelled) {
      const span = this._pixelSpan(chart, columns.timestamps, band.start, band.end, width);
      if (!span) continue;
      const text = band.label!;
      const boxWidth = SWATCH_SIZE + LABEL_PADDING * 3 + context.measureText(text).width;
      let left = Math.max(EDGE_MARGIN, span.left + EDGE_MARGIN);
      if (left + boxWidth > width - EDGE_MARGIN) left = Math.max(EDGE_MARGIN, width - EDGE_MARGIN - boxWidth);
      const right = left + boxWidth;
      let row = 0;
      while (placed.some((box) => box.row === row && box.left < right + LABEL_GAP && box.right + LABEL_GAP > left)) row += 1;
      placed.push({ left, right, row });
      const top = LABEL_TOP + row * (LABEL_HEIGHT + LABEL_GAP);

      context.fillStyle = PILL_BACKGROUND;
      roundedRect(context, left, top, boxWidth, LABEL_HEIGHT, 3);
      context.fill();
      context.strokeStyle = withAlpha(band.edge, 0.75);
      context.lineWidth = 1;
      roundedRect(context, left, top, boxWidth, LABEL_HEIGHT, 3);
      context.stroke();
      context.fillStyle = band.edge;
      context.fillRect(left + LABEL_PADDING, top + (LABEL_HEIGHT - SWATCH_SIZE) / 2, SWATCH_SIZE, SWATCH_SIZE);
      context.fillStyle = PILL_TEXT;
      context.fillText(text, left + LABEL_PADDING * 2 + SWATCH_SIZE, top + LABEL_HEIGHT / 2 + 0.5);
    }
  }

  private _barX(chart: IChartApi, columns: CycleBarColumns, time: number): number | null {
    const index = findBarIndex(columns.timestamps, time);
    if (index < 0 || index >= this._source.renderedCount) return null;
    return chart.timeScale().logicalToCoordinate(index as Logical);
  }

  private _drawCursor(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, width: number, height: number): void {
    const mark = this._source.layout.cursor;
    if (!mark) return;
    const x = this._barX(chart, columns, mark.time);
    if (x === null || x < 0 || x > width) return;
    context.strokeStyle = CYCLE_COLORS.active;
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(Math.round(x) + 0.5, 0);
    context.lineTo(Math.round(x) + 0.5, height);
    context.stroke();
    context.setLineDash([]);

    context.font = LABEL_FONT;
    context.textBaseline = "middle";
    const text = mark.paused ? `❚❚ ${mark.label}` : `▶ ${mark.label}`;
    const boxWidth = context.measureText(text).width + LABEL_PADDING * 2;
    // Just below the band labels, to the left of the line so it never covers the newest bar.
    const top = LABEL_TOP + 2 * (LABEL_HEIGHT + LABEL_GAP) + 6;
    let left = x - boxWidth - 6;
    if (left < EDGE_MARGIN) left = x + 6;
    context.fillStyle = PILL_BACKGROUND;
    roundedRect(context, left, top, boxWidth, LABEL_HEIGHT, 3);
    context.fill();
    context.strokeStyle = CYCLE_COLORS.active;
    context.lineWidth = 1;
    roundedRect(context, left, top, boxWidth, LABEL_HEIGHT, 3);
    context.stroke();
    context.fillStyle = PILL_TEXT;
    context.textAlign = "left";
    context.fillText(text, left + LABEL_PADDING, top + LABEL_HEIGHT / 2 + 0.5);
  }

  /**
   * One mark per resolved test bar, in a row just above the prediction strip:
   * correct = sky square, wrong = vermillion ✗, not scored (inside threshold) =
   * grey dot. Shape carries the meaning; colour only reinforces it. Visible
   * bars only.
   */
  private _drawCorrectness(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, width: number, height: number): void {
    const timeScale = chart.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    const first = Math.max(0, Math.floor(range.from));
    const last = Math.min(this._source.renderedCount - 1, Math.ceil(range.to));
    if (last < first) return;

    const stripTop = height * this._source.stripTopFraction;
    const rowBottom = stripTop - CORRECTNESS_GAP;
    const rowTop = rowBottom - CORRECTNESS_ROW_HEIGHT;
    const middle = (rowTop + rowBottom) / 2;
    const x0 = timeScale.logicalToCoordinate(first as Logical);
    const x1 = timeScale.logicalToCoordinate((first + 1) as Logical);
    const spacing = x0 !== null && x1 !== null ? Math.abs(x1 - x0) : 6;
    const dense = spacing < 4;
    const half = Math.max(1, Math.min(3, spacing * 0.35));

    for (let index = first; index <= last; index += 1) {
      if (columns.role[index] !== "processed") continue;
      const actual = columns.actualDirection[index];
      if (actual === null || actual === undefined) continue;
      const x = timeScale.logicalToCoordinate(index as Logical);
      if (x === null || x < -4 || x > width + 4) continue;
      const correct = columns.correct[index];
      if (correct === true) {
        context.fillStyle = CYCLE_COLORS.sky;
        if (dense) context.fillRect(x - 0.5, rowTop, 1, CORRECTNESS_ROW_HEIGHT);
        else context.fillRect(x - half, middle - half, half * 2, half * 2);
      } else if (correct === false) {
        context.strokeStyle = CYCLE_COLORS.vermillion;
        context.fillStyle = CYCLE_COLORS.vermillion;
        if (dense) context.fillRect(x - 0.5, middle, 1, CORRECTNESS_ROW_HEIGHT / 2);
        else {
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(x - half, middle - half);
          context.lineTo(x + half, middle + half);
          context.moveTo(x + half, middle - half);
          context.lineTo(x - half, middle + half);
          context.stroke();
        }
      } else if (!dense) {
        context.fillStyle = withAlpha(CYCLE_COLORS.neutral, 0.7);
        context.beginPath();
        context.arc(x, middle, 1.2, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  private _drawFlash(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, height: number): void {
    const time = this._source.flashTimestamp;
    if (time === null) return;
    const index = findBarIndex(columns.timestamps, time);
    if (index < 0 || index >= this._source.renderedCount) return;
    const timeScale = chart.timeScale();
    // An integer index, widened by the bar spacing: a fractional logical index
    // converts to 0 in lightweight-charts 5.1 (see `_pixelSpan`).
    const centre = timeScale.logicalToCoordinate(index as Logical);
    if (centre === null) return;
    const widthPixels = Math.max(6, timeScale.options().barSpacing);
    context.fillStyle = FLASH_FILL;
    context.fillRect(centre - widthPixels / 2, 0, widthPixels, height);
    context.strokeStyle = CYCLE_COLORS.yellow;
    context.lineWidth = 1;
    context.strokeRect(centre - widthPixels / 2 + 0.5, 0.5, widthPixels - 1, height - 1);
  }
}

class BandsPaneView implements IPrimitivePaneView {
  private readonly _renderer: BandsRenderer;
  private readonly _zOrder: PrimitivePaneViewZOrder;

  public constructor(source: CycleBandsPrimitive, layer: "behind" | "front") {
    this._renderer = new BandsRenderer(source, layer);
    this._zOrder = layer === "behind" ? "bottom" : "top";
  }

  public zOrder(): PrimitivePaneViewZOrder {
    return this._zOrder;
  }

  public renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/** Series primitive for the cycle chart's bands, cursor, correctness row and focus highlight. */
export class CycleBandsPrimitive implements ISeriesPrimitive<Time> {
  public layout: BandLayout = { bands: [], cursor: null };
  /** The store's bar columns, read at draw time (never copied). */
  public columns: CycleBarColumns | null = null;
  /** Bars the series hold: `[0, renderedCount)` of `columns`. */
  public renderedCount = 0;
  /** Top of the prediction strip as a fraction of pane height (its price scale's top margin). */
  public stripTopFraction = 0.92;
  public flashTimestamp: number | null = null;
  public chart: IChartApi | null = null;

  private readonly _paneViews: readonly IPrimitivePaneView[];
  private _requestUpdate: (() => void) | null = null;

  public constructor() {
    this._paneViews = [new BandsPaneView(this, "behind"), new BandsPaneView(this, "front")];
  }

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.chart = null;
    this._requestUpdate = null;
  }

  public setLayout(layout: BandLayout): void {
    this.layout = layout;
    this._requestUpdate?.();
  }

  public setBars(columns: CycleBarColumns, renderedCount: number): void {
    this.columns = columns;
    this.renderedCount = renderedCount;
    this._requestUpdate?.();
  }

  public setFlash(timestamp: number | null): void {
    this.flashTimestamp = timestamp;
    this._requestUpdate?.();
  }

  /** Redraw without changing inputs (labels resolved on drawn bars). */
  public refresh(): void {
    this._requestUpdate?.();
  }

  /** Same array every call: lightweight-charts caches pane views by reference. */
  public paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  public updateAllViews(): void {
    // Coordinates are read at draw time, which keeps bands pinned through pan and zoom.
  }
}
