import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

import { findBarIndex, type CycleBarColumns, type CyclePlan } from "@shared/cycle/schema";

import { regimeStyleOfBar, type RunRegimes } from "./regimes";
import {
  CYCLE_COLORS,
  formatTickPrice,
  glyphSize,
  glyphTriangle,
  hoverPriceGeometry,
  placePriceTexts,
  predictionGlyphAt,
  PRICE_TEXT_MINIMUM_BAR_SPACING,
  spanToLogical,
  withAlpha,
  type BandLayout,
  type PriceTextCandidate,
} from "./chartModel";

/**
 * Canvas layer of the Model Cycle chart, attached to the candlestick series.
 *
 * Draws, on pane 0:
 *  - BEHIND the candles: the fold spans (training sky, validation yellow, test
 *    walk orange, earlier folds' test walks very faint) and the ACTIVE block the
 *    model is fitting / validating / tuning right now (reddish-purple);
 *  - IN FRONT, first: every visible walked candle a regime model spoke for,
 *    repainted in its most likely regime's colour (flat sky, uptrend orange,
 *    downtrend blue; `@shared/runs/regimeDefinitions`) on the candle's own
 *    pixels, so the chart's candle and the regime never disagree by a pixel;
 *  - IN FRONT: each band's label pill along the top edge, the dashed test
 *    cursor ("model is here"), the prediction glyph on every visible test bar
 *    (▲ under the low / ▼ over the high, solid / hollow / faint by label),
 *    the forecast price beside each glyph once bars are 14 px apart or wider,
 *    the hovered bar's label move (a segment from its close to the close
 *    `labelHorizonBars` later) and forecast point, the bar pinned for "Inside
 *    the model", and the brief highlight a table row's "show on chart" asks for.
 *
 * Why the glyphs are drawn here and not as series markers: a glyph's fill
 * changes when its label resolves `labelHorizonBars` AFTER the bar was drawn,
 * and the markers plugin re-lays-out every marker on each `setMarkers`. The
 * primitive instead reads `columns.correct` at draw time for the visible bars
 * only, so a resolved label costs nothing until it is on screen.
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
const FLASH_FILL = withAlpha(CYCLE_COLORS.yellow, 0.28);
const PRICE_TEXT_FONT = `10px ${FONT_FAMILY}`;
const PRICE_TEXT_HEIGHT = 12;
const PRICE_TEXT_BACKGROUND = "rgba(11, 15, 22, 0.72)";
const HOVER_START_RING = "#E8ECF1";
const FORECAST_MARKER_SIZE = 4.5;

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
    if (this._layer === "front" && this._source.regimes !== null && this._source.regimes.byTimestamp.size > 0) {
      target.useBitmapCoordinateSpace((scope) => {
        this._drawRegimeCandles(scope.context, chart, columns, this._source.regimes!, scope.horizontalPixelRatio, scope.verticalPixelRatio, scope.bitmapSize.width);
      });
    }
    target.useMediaCoordinateSpace((scope) => {
      const context = scope.context;
      const width = scope.mediaSize.width;
      const height = scope.mediaSize.height;
      context.save();
      if (this._layer === "behind") this._drawFills(context, chart, columns, width, height);
      else {
        this._drawPinned(context, chart, columns, height);
        this._drawGlyphs(context, chart, columns, width);
        this._drawHover(context, chart, columns);
        this._drawFlash(context, chart, columns, height);
        this._drawCursor(context, chart, columns, width, height);
        this._drawLabels(context, chart, columns, width);
      }
      context.restore();
    });
  }

  /**
   * Every visible walked candle that carries a regime, repainted in the regime's
   * colour: wick from high to low, body from open to close. Drawn in bitmap
   * pixels with the candlestick series' own body width (`candleBodyWidth`), so
   * the repaint covers the chart's candle exactly. The regime is the engine's
   * most likely one at that bar (forward filter); the word and glyph for each
   * colour are in the chart's legend line and the crosshair readout.
   */
  private _drawRegimeCandles(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, regimes: RunRegimes,
    horizontalRatio: number, verticalRatio: number, bitmapWidth: number): void {
    const series = this._source.series;
    if (!series) return;
    const timeScale = chart.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    const first = Math.max(0, Math.floor(range.from));
    const last = Math.min(this._source.renderedCount - 1, Math.ceil(range.to));
    if (last < first) return;
    const bodyWidth = candleBodyWidth(timeScale.options().barSpacing, horizontalRatio);
    const wickWidth = Math.min(bodyWidth, Math.max(1, Math.floor(horizontalRatio)));
    context.save();
    for (let index = first; index <= last; index += 1) {
      const style = regimeStyleOfBar(regimes, columns.timestamps[index]!);
      if (!style) continue;
      const x = timeScale.logicalToCoordinate(index as Logical);
      if (x === null) continue;
      const centre = Math.round(x * horizontalRatio);
      if (centre < -bodyWidth || centre > bitmapWidth + bodyWidth) continue;
      const yHigh = series.priceToCoordinate(columns.high[index]!);
      const yLow = series.priceToCoordinate(columns.low[index]!);
      const yOpen = series.priceToCoordinate(columns.open[index]!);
      const yClose = series.priceToCoordinate(columns.close[index]!);
      if (yHigh === null || yLow === null || yOpen === null || yClose === null) continue;
      const top = Math.round(Math.min(yOpen, yClose) * verticalRatio);
      const bottom = Math.round(Math.max(yOpen, yClose) * verticalRatio);
      const wickTop = Math.round(yHigh * verticalRatio);
      const wickBottom = Math.round(yLow * verticalRatio);
      context.fillStyle = style.color;
      context.fillRect(centre - Math.floor(wickWidth / 2), wickTop, wickWidth, Math.max(1, wickBottom - wickTop + 1));
      context.fillRect(centre - Math.floor(bodyWidth / 2), top, bodyWidth, Math.max(1, bottom - top + 1));
    }
    context.restore();
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
   * The model's call ON each visible test bar: an orange ▲ just under the low
   * (predicts up) or a blue ▼ just over the high (predicts down). Fill carries
   * the resolved label — solid = right, hollow outline = wrong, faint = not
   * known yet (or the move was inside the threshold, not scored) — so it reads
   * without colour. Visible bars only; nothing when bars are too dense.
   */
  private _drawGlyphs(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, width: number): void {
    const series = this._source.series;
    if (!series) return;
    const timeScale = chart.timeScale();
    const size = glyphSize(timeScale.options().barSpacing);
    if (size === null) return;
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    const first = Math.max(0, Math.floor(range.from));
    const last = Math.min(this._source.renderedCount - 1, Math.ceil(range.to));
    if (last < first) return;

    const tickSize = this._source.plan?.costModel.tickSize ?? null;
    const withText = tickSize !== null && timeScale.options().barSpacing >= PRICE_TEXT_MINIMUM_BAR_SPACING;
    const texts: PriceTextCandidate[] = [];
    if (withText) context.font = PRICE_TEXT_FONT;

    context.lineWidth = 1.5;
    context.lineJoin = "round";
    for (let index = first; index <= last; index += 1) {
      const glyph = predictionGlyphAt(columns, index);
      if (!glyph) continue;
      const x = timeScale.logicalToCoordinate(index as Logical);
      if (x === null || x < -size || x > width + size) continue;
      const wick = glyph.side === "below" ? columns.low[index]! : columns.high[index]!;
      const y = series.priceToCoordinate(wick);
      if (y === null) continue;
      if (withText) {
        const forecast = columns.predictedClose[index];
        if (forecast !== null && forecast !== undefined && Number.isFinite(forecast)) {
          const text = formatTickPrice(forecast, tickSize);
          texts.push({ index, side: glyph.side, x, wickY: y, text, textWidth: context.measureText(text).width + 4 });
        }
      }
      const triangle = glyphTriangle(glyph.side, x, y, size);
      context.beginPath();
      context.moveTo(triangle.apex.x, triangle.apex.y);
      context.lineTo(triangle.baseLeft.x, triangle.baseLeft.y);
      context.lineTo(triangle.baseRight.x, triangle.baseRight.y);
      context.closePath();
      context.globalAlpha = glyph.alpha;
      if (glyph.fill === "hollow") {
        context.strokeStyle = glyph.color;
        context.stroke();
      } else {
        context.fillStyle = glyph.color;
        context.fill();
      }
    }
    context.globalAlpha = 1;
    if (texts.length > 0) this._drawPriceTexts(context, columns, texts, size);
  }

  /**
   * The forecast price (tick precision) beyond each glyph: under a ▲, over a
   * ▼, in the glyph's own colour on a dark pill. Texts that would overprint a
   * neighbour move one row out, then are left out (`placePriceTexts`).
   */
  private _drawPriceTexts(context: CanvasRenderingContext2D, columns: CycleBarColumns, texts: PriceTextCandidate[], size: number): void {
    context.font = PRICE_TEXT_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const placed of placePriceTexts(texts, size, PRICE_TEXT_HEIGHT)) {
      const { box } = placed;
      context.fillStyle = PRICE_TEXT_BACKGROUND;
      roundedRect(context, box.left, box.top, box.width, box.height, 2);
      context.fill();
      const direction = columns.predictedDirection[placed.index];
      context.fillStyle = direction === 1 ? CYCLE_COLORS.up : direction === -1 ? CYCLE_COLORS.down : CYCLE_COLORS.neutral;
      context.fillText(placed.text, box.left + box.width / 2, box.top + box.height / 2 + 0.5);
    }
    context.textAlign = "left";
  }

  /**
   * The hovered bar (or, with nothing hovered, the pinned one): a thin segment
   * from its close to the close `labelHorizonBars` later — the move its label
   * is scored on, orange up / blue down — and a reddish-purple diamond at the
   * price model's forecast for that bar, which may sit ahead of the newest
   * candle. Only the diamond while the label is unresolved.
   */
  private _drawHover(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns): void {
    const series = this._source.series;
    const plan = this._source.plan;
    if (!series || !plan) return;
    let index = this._source.hoverIndex;
    if (index === null && this._source.pinnedTimestamp !== null) {
      const pinned = findBarIndex(columns.timestamps, this._source.pinnedTimestamp);
      index = pinned >= 0 ? pinned : null;
    }
    if (index === null) return;
    const geometry = hoverPriceGeometry(columns, index, this._source.renderedCount, plan.labelHorizonBars, this._source.forecastTimes);
    if (!geometry) return;
    const timeScale = chart.timeScale();
    // Whole logical indices only (lightweight-charts 5.1 returns 0 for a fractional one).
    const xStart = timeScale.logicalToCoordinate(geometry.index as Logical);
    const yStart = series.priceToCoordinate(geometry.startClose);
    if (xStart === null || yStart === null) return;

    if (geometry.forecastLogical !== null && geometry.forecastClose !== null) {
      const xForecast = timeScale.logicalToCoordinate(geometry.forecastLogical as Logical);
      const yForecast = series.priceToCoordinate(geometry.forecastClose);
      if (xForecast !== null && yForecast !== null) {
        // A faint dotted guide from the close, so the diamond reads as this bar's forecast.
        context.strokeStyle = withAlpha(CYCLE_COLORS.active, 0.55);
        context.lineWidth = 1;
        context.setLineDash([2, 3]);
        context.beginPath();
        context.moveTo(xStart, yStart);
        context.lineTo(xForecast, yForecast);
        context.stroke();
        context.setLineDash([]);
        const s = FORECAST_MARKER_SIZE;
        context.beginPath();
        context.moveTo(xForecast, yForecast - s);
        context.lineTo(xForecast + s, yForecast);
        context.lineTo(xForecast, yForecast + s);
        context.lineTo(xForecast - s, yForecast);
        context.closePath();
        context.fillStyle = CYCLE_COLORS.active;
        context.fill();
        context.strokeStyle = HOVER_START_RING;
        context.lineWidth = 1;
        context.stroke();
      }
    }

    if (geometry.resolutionIndex !== null && geometry.resolutionClose !== null) {
      const xEnd = timeScale.logicalToCoordinate(geometry.resolutionIndex as Logical);
      const yEnd = series.priceToCoordinate(geometry.resolutionClose);
      if (xEnd !== null && yEnd !== null) {
        const color = geometry.moveSign === 1 ? CYCLE_COLORS.up : geometry.moveSign === -1 ? CYCLE_COLORS.down : CYCLE_COLORS.neutral;
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(xStart, yStart);
        context.lineTo(xEnd, yEnd);
        context.stroke();
        context.fillStyle = color;
        context.beginPath();
        context.arc(xEnd, yEnd, 3, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.strokeStyle = HOVER_START_RING;
    context.lineWidth = 1.25;
    context.beginPath();
    context.arc(xStart, yStart, 3, 0, Math.PI * 2);
    context.stroke();
  }

  /** The bar pinned for "Inside the model": a dashed sky outline over its column. */
  private _drawPinned(context: CanvasRenderingContext2D, chart: IChartApi, columns: CycleBarColumns, height: number): void {
    const time = this._source.pinnedTimestamp;
    if (time === null) return;
    const index = findBarIndex(columns.timestamps, time);
    if (index < 0 || index >= this._source.renderedCount) return;
    const timeScale = chart.timeScale();
    const centre = timeScale.logicalToCoordinate(index as Logical);
    if (centre === null) return;
    const widthPixels = Math.max(6, timeScale.options().barSpacing);
    context.strokeStyle = withAlpha(CYCLE_COLORS.sky, 0.8);
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.strokeRect(centre - widthPixels / 2 + 0.5, 0.5, widthPixels - 1, height - 1);
    context.setLineDash([]);
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

/**
 * The candlestick series' body width in bitmap pixels at `barSpacing` (lightweight-charts'
 * own `optimalCandlestickWidth`, reproduced so a repainted candle lands on the same pixels).
 */
export function candleBodyWidth(barSpacing: number, pixelRatio: number): number {
  if (barSpacing >= 2.5 && barSpacing <= 4) return Math.floor(3 * pixelRatio);
  const coefficient = 1 - (0.2 * Math.atan(Math.max(4, barSpacing) - 4)) / (Math.PI * 0.5);
  const reduced = Math.floor(barSpacing * coefficient * pixelRatio);
  const scaled = Math.floor(barSpacing * pixelRatio);
  return Math.max(Math.floor(pixelRatio), Math.min(reduced, scaled));
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

/** Series primitive for the cycle chart's bands, cursor, prediction glyphs and focus highlight. */
export class CycleBandsPrimitive implements ISeriesPrimitive<Time> {
  public layout: BandLayout = { bands: [], cursor: null };
  /** The store's bar columns, read at draw time (never copied). */
  public columns: CycleBarColumns | null = null;
  /** Bars the series hold: `[0, renderedCount)` of `columns`. */
  public renderedCount = 0;
  public flashTimestamp: number | null = null;
  public chart: IChartApi | null = null;
  /** The candlestick series this primitive is attached to: its price scale places the glyphs. */
  public series: ISeriesApi<SeriesType> | null = null;
  /** The run's plan: tick size for the price text, label horizon for the hover segment. */
  public plan: CyclePlan | null = null;
  /** The forecast line's plotted target times (the chart's forecast track, read at draw time). */
  public forecastTimes: readonly number[] | null = null;
  /** The bar under the crosshair, or null. */
  public hoverIndex: number | null = null;
  /** The bar pinned for "Inside the model" (epoch seconds), or null. */
  public pinnedTimestamp: number | null = null;
  /** The walked bars' most likely regimes (the store's, read at draw time), or null when they are not painted. */
  public regimes: RunRegimes | null = null;

  private _regimesVersion = -1;
  private readonly _paneViews: readonly IPrimitivePaneView[];
  private _requestUpdate: (() => void) | null = null;

  public constructor() {
    this._paneViews = [new BandsPaneView(this, "behind"), new BandsPaneView(this, "front")];
  }

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.chart = null;
    this.series = null;
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

  public setPlan(plan: CyclePlan | null): void {
    this.plan = plan;
    this._requestUpdate?.();
  }

  /** The forecast track's times array; it grows in place, so one call per track is enough. */
  public setForecastTimes(times: readonly number[] | null): void {
    this.forecastTimes = times;
    this._requestUpdate?.();
  }

  public setHover(index: number | null): void {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this._requestUpdate?.();
  }

  public setPinned(timestamp: number | null): void {
    if (timestamp === this.pinnedTimestamp) return;
    this.pinnedTimestamp = timestamp;
    this._requestUpdate?.();
  }

  /** The regimes to paint the walked candles with (null = the chart's own candle colours). */
  public setRegimes(regimes: RunRegimes | null, version: number): void {
    if (regimes === this.regimes && version === this._regimesVersion) return;
    this.regimes = regimes;
    this._regimesVersion = version;
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
