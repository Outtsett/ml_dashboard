import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

/**
 * Contextual pattern labels drawn OUTSIDE the candles.
 *
 * lightweight-charts' own `createSeriesMarkers` centres a marker's text on the
 * bar's x coordinate. A label like "Gravestone Doji (TA-Lib)" is ~150px wide
 * while a 1-minute bar is ~6px, so the text spread across twenty neighbouring
 * bars and painted straight over them. That is what this primitive replaces.
 *
 * The contract, in the user's words: a contextual label goes ABOVE or UNDER the
 * candlestick, never on it. A continuous price-plane overlay — a moving average,
 * a band edge — is exempt and still draws through the candles, because tracing
 * the price IS its meaning.
 *
 * Two layers, both drawn every frame:
 *
 *   PILLS — a named label per firing, anchored clear of every candle it spans
 *     and stacked away from the bar when labels collide. This is the layer the
 *     user asked for: the pattern name, readable, above or below the candle.
 *     As many are drawn as physically fit; the rest are dropped rather than
 *     squeezed, and zooming in frees room for more.
 *
 *   LANE — a thin strip pinned above the volume band, one tick per bar that
 *     fired anything, coloured by net direction with height carrying how many
 *     patterns agreed. This is the complete picture, so a firing whose name did
 *     not fit is still visible. Hovering a bar names everything on it.
 */

/** One pattern firing to draw. */
export interface PatternLabel {
  /** Bar time in chart seconds. */
  time: number;
  /** The bar's high, the anchor for a label placed above. */
  high: number;
  /** The bar's low, the anchor for a label placed below. */
  low: number;
  /** Full display text, e.g. "Gravestone Doji (TA-Lib)". */
  text: string;
  /** 1 prefers below the bar, -1 prefers above. */
  direction: 1 | -1;
  /** Okabe-Ito colour; direction is also carried by position and shape. */
  color: string;
  /**
   * True when this is the pattern the bar matches BEST.
   *
   * Several TA-Lib rules fire on the same candle — a small body with two shadows
   * is simultaneously a Doji, a Spinning Top, a High Wave and a Short Line — so
   * drawing every firing stacked five names on one bar. Only the best match gets
   * a drawn label. The rest still appear in the lane and in the hover readout,
   * so nothing is hidden, it is just no longer all shouted at once.
   */
  isBestMatch: boolean;
}

/** One candle, used to compute the price envelope a label must clear. */
export interface PatternBar {
  time: number;
  high: number;
  low: number;
}

interface PlacedBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** One projected candle: x, and the y of its high and low. */
interface ProjectedBar {
  x: number;
  yHigh: number;
  yLow: number;
}

const FONT_SIZE_PIXELS = 11;
const FONT = `${FONT_SIZE_PIXELS}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
const COUNT_FONT = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const PADDING_HORIZONTAL = 5;
const PADDING_VERTICAL = 3;
/** Clear space between the price envelope and the nearest label edge. */
const GAP_FROM_CANDLE = 12;
const GAP_BETWEEN_LABELS = 3;
const TRIANGLE_SIZE = 5;
const EDGE_MARGIN = 4;
/** Widest half-label expected; bars this far off-pane can still sit under one. */
const MAX_LABEL_HALF_WIDTH = 140;

/** Height of the reserved marker lane in dense mode. */
const LANE_HEIGHT = 16;
/** Width of one bar's tick in the lane. */
const LANE_TICK_WIDTH = 3;
/** Firings on one bar that saturate the tick height. */
const LANE_TICK_SATURATION = 6;

const BULLISH_COLOR = '#E69F00';
const BEARISH_COLOR = '#0072B2';
const MIXED_COLOR = '#CC79A7';
const PILL_BACKGROUND = 'rgba(11, 15, 22, 0.92)';

function boxesIntersect(a: PlacedBox, b: PlacedBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
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

class PatternLabelRenderer implements IPrimitivePaneRenderer {
  private readonly _source: PatternLabelPrimitive;
  private readonly _chart: IChartApi;
  private readonly _series: ISeriesApi<'Candlestick', Time>;

  public constructor(
    source: PatternLabelPrimitive,
    chart: IChartApi,
    series: ISeriesApi<'Candlestick', Time>,
  ) {
    this._source = source;
    this._chart = chart;
    this._series = series;
  }

  public draw(target: CanvasRenderingTarget2D): void {
    if (this._source.labels.length === 0) return;

    target.useMediaCoordinateSpace((scope) => {
      const context = scope.context;
      const paneHeight = scope.mediaSize.height;
      const paneWidth = scope.mediaSize.width;

      context.save();
      context.font = FONT;
      context.textBaseline = 'middle';

      const visibleBars = this._projectVisibleBars(paneWidth);
      const visibleLabels = this._visibleLabels();

      // Both, always, because they answer different questions and the user asked
      // for the names.
      //
      // The LANE is the complete picture: one tick per bar that fired anything,
      // so nothing is hidden no matter how dense the chart gets. The PILLS are
      // the readable part: as many named labels as physically fit above or below
      // the candles without covering them.
      //
      // An earlier version switched between the two and showed only the lane
      // once more than 28 firings were in view. On a daily chart that is always,
      // so the chart carried a nameless strip and the labels the user actually
      // asked for never appeared. Drawing the lane first also gives the pills a
      // floor to stack against, so they can never cover it.
      const laneTop = this._drawLane(context, visibleLabels, visibleBars, paneWidth, paneHeight);
      this._drawPills(context, visibleLabels, visibleBars, paneWidth, laneTop);

      context.restore();
    });
  }

  // ── Sparse mode: a named pill per firing ────────────────────────────────

  private _drawPills(
    context: CanvasRenderingContext2D,
    labels: readonly PatternLabel[],
    visibleBars: readonly ProjectedBar[],
    paneWidth: number,
    laneTop: number,
  ): void {
    const timeScale = this._chart.timeScale();
    const placedBelow: PlacedBox[] = [];
    const placedAbove: PlacedBox[] = [];
    // Stop short of the lane so a pill never covers the density strip. A label
    // that will not fit is DROPPED, not squeezed in: the lane still records that
    // the bar fired, so nothing is lost, and zooming in frees room for the name.
    const floorY = laneTop - GAP_BETWEEN_LABELS;

    for (const label of labels) {
      // One name per candle. The others are in the lane and on hover.
      if (!label.isBestMatch) continue;

      const x = timeScale.timeToCoordinate(label.time as unknown as Time);
      if (x === null) continue;

      const textWidth = context.measureText(label.text).width;
      const boxWidth = textWidth + PADDING_HORIZONTAL * 2;
      const boxHeight = FONT_SIZE_PIXELS + PADDING_VERTICAL * 2;
      const left = x - boxWidth / 2;
      const right = left + boxWidth;
      if (right < 0 || left > paneWidth) continue;

      const attempt = (side: 1 | -1): PlacedBox | null => {
        const sideAnchor = this._series.priceToCoordinate(side === 1 ? label.low : label.high);
        if (sideAnchor === null) return null;

        // A pill is far wider than a bar, so anchoring on this bar's own extreme
        // would still drop it on the neighbours it spans. Clear the whole
        // envelope under the pill instead.
        const envelopeY = this._envelopeCoordinate(visibleBars, left, right, side);
        const startY = envelopeY === null
          ? sideAnchor
          : (side === 1 ? Math.max(sideAnchor, envelopeY) : Math.min(sideAnchor, envelopeY));

        const placedSide = side === 1 ? placedBelow : placedAbove;
        const step = boxHeight + GAP_BETWEEN_LABELS;
        let top = side === 1
          ? startY + GAP_FROM_CANDLE
          : startY - GAP_FROM_CANDLE - boxHeight;

        let box: PlacedBox = { left, right, top, bottom: top + boxHeight };
        let collided = true;
        let guard = 0;
        while (collided && guard < 64) {
          collided = false;
          for (const existing of placedSide) {
            if (boxesIntersect(box, existing)) {
              collided = true;
              // Only ever further from the bar, so a label can never drift back
              // into the candle span it was placed to clear.
              top += side === 1 ? step : -step;
              box = { left, right, top, bottom: top + boxHeight };
              break;
            }
          }
          guard += 1;
        }

        if (box.top < EDGE_MARGIN) return null;
        if (box.bottom > floorY) return null;
        return box;
      };

      const opposite: 1 | -1 = label.direction === 1 ? -1 : 1;
      let side: 1 | -1 = label.direction;
      let box = attempt(side);
      if (box === null) {
        side = opposite;
        box = attempt(side);
      }
      if (box === null) continue;

      const anchorY = this._series.priceToCoordinate(side === 1 ? label.low : label.high);
      if (anchorY === null) continue;

      (side === 1 ? placedBelow : placedAbove).push(box);
      this._drawConnector(context, x, anchorY, box, side, label.color);
      this._drawPill(context, box, label.text, label.color);
    }
  }

  private _drawConnector(
    context: CanvasRenderingContext2D,
    x: number,
    anchorY: number,
    box: PlacedBox,
    side: 1 | -1,
    color: string,
  ): void {
    context.strokeStyle = color;
    context.globalAlpha = 0.45;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, side === 1 ? anchorY + TRIANGLE_SIZE : anchorY - TRIANGLE_SIZE);
    context.lineTo(x, side === 1 ? box.top : box.bottom);
    context.stroke();
    context.globalAlpha = 1;

    // Direction triangle against the candle: shape reinforces colour so
    // direction survives a deuteranopic reading.
    context.fillStyle = color;
    context.beginPath();
    if (side === 1) {
      context.moveTo(x, anchorY + 2);
      context.lineTo(x - TRIANGLE_SIZE, anchorY + 2 + TRIANGLE_SIZE);
      context.lineTo(x + TRIANGLE_SIZE, anchorY + 2 + TRIANGLE_SIZE);
    } else {
      context.moveTo(x, anchorY - 2);
      context.lineTo(x - TRIANGLE_SIZE, anchorY - 2 - TRIANGLE_SIZE);
      context.lineTo(x + TRIANGLE_SIZE, anchorY - 2 - TRIANGLE_SIZE);
    }
    context.closePath();
    context.fill();
  }

  private _drawPill(
    context: CanvasRenderingContext2D,
    box: PlacedBox,
    text: string,
    color: string,
  ): void {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    context.fillStyle = PILL_BACKGROUND;
    roundedRectPath(context, box.left, box.top, width, height, 3);
    context.fill();
    context.strokeStyle = color;
    context.globalAlpha = 0.7;
    context.lineWidth = 1;
    roundedRectPath(context, box.left, box.top, width, height, 3);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.fillText(text, box.left + PADDING_HORIZONTAL, box.top + height / 2);
  }

  // ── Dense mode: a reserved lane of per-bar ticks ────────────────────────

  private _drawLane(
    context: CanvasRenderingContext2D,
    labels: readonly PatternLabel[],
    visibleBars: readonly ProjectedBar[],
    paneWidth: number,
    paneHeight: number,
  ): number {
    const timeScale = this._chart.timeScale();

    // Pinned directly above the volume band rather than floating under the
    // lowest low, so it does not jump while panning and so the pills above it
    // get a stable floor to stack against.
    void visibleBars;
    const volumeTop = paneHeight * (1 - this._source.reservedBottomFraction);
    let laneTop = volumeTop - LANE_HEIGHT - EDGE_MARGIN;
    if (laneTop < EDGE_MARGIN) laneTop = EDGE_MARGIN;
    const laneCentre = laneTop + LANE_HEIGHT / 2;

    // Group by bar: a bar that fired eight patterns gets one tick, not eight.
    const byTime = new Map<number, { bullish: number; bearish: number; texts: string[] }>();
    for (const label of labels) {
      let entry = byTime.get(label.time);
      if (!entry) {
        entry = { bullish: 0, bearish: 0, texts: [] };
        byTime.set(label.time, entry);
      }
      if (label.direction === 1) entry.bullish += 1;
      else entry.bearish += 1;
      // Best match first, so the hover list reads as "this, and also these".
      if (label.isBestMatch) entry.texts.unshift(`${label.text}  (best match)`);
      else entry.texts.push(label.text);
    }

    // Lane backdrop, so ticks read as one band rather than floating specks.
    context.fillStyle = 'rgba(255, 255, 255, 0.03)';
    context.fillRect(0, laneTop, paneWidth, LANE_HEIGHT);

    context.font = COUNT_FONT;
    context.textAlign = 'center';

    for (const [time, entry] of byTime) {
      const x = timeScale.timeToCoordinate(time as unknown as Time);
      if (x === null || x < -LANE_TICK_WIDTH || x > paneWidth + LANE_TICK_WIDTH) continue;

      const total = entry.bullish + entry.bearish;
      const color = entry.bullish > 0 && entry.bearish > 0
        ? MIXED_COLOR
        : (entry.bullish > 0 ? BULLISH_COLOR : BEARISH_COLOR);

      // Tick height carries how many patterns agreed on this bar.
      const fill = Math.min(1, total / LANE_TICK_SATURATION);
      const tickHeight = 4 + fill * (LANE_HEIGHT - 6);
      context.fillStyle = color;
      context.globalAlpha = 0.85;
      context.fillRect(
        x - LANE_TICK_WIDTH / 2,
        laneCentre - tickHeight / 2,
        LANE_TICK_WIDTH,
        tickHeight,
      );
      context.globalAlpha = 1;
    }

    // Names for the bar under the crosshair — nothing is lost, it is on demand.
    const hovered = this._source.hoveredTime;
    if (hovered === null) return laneTop;
    const entry = byTime.get(hovered);
    const hoveredX = timeScale.timeToCoordinate(hovered as unknown as Time);
    if (!entry || hoveredX === null) return laneTop;

    context.font = FONT;
    context.textAlign = 'left';
    const lines = entry.texts.slice(0, 8);
    const hiddenCount = entry.texts.length - lines.length;
    if (hiddenCount > 0) lines.push(`+${hiddenCount} more`);

    let widest = 0;
    for (const line of lines) widest = Math.max(widest, context.measureText(line).width);
    const boxWidth = widest + PADDING_HORIZONTAL * 2;
    const lineHeight = FONT_SIZE_PIXELS + 4;
    const boxHeight = lines.length * lineHeight + PADDING_VERTICAL * 2;

    let left = hoveredX + 10;
    if (left + boxWidth > paneWidth - EDGE_MARGIN) left = hoveredX - 10 - boxWidth;
    if (left < EDGE_MARGIN) left = EDGE_MARGIN;
    let top = laneTop - boxHeight - 6;
    if (top < EDGE_MARGIN) top = laneTop + LANE_HEIGHT + 6;

    context.fillStyle = PILL_BACKGROUND;
    roundedRectPath(context, left, top, boxWidth, boxHeight, 4);
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    context.lineWidth = 1;
    roundedRectPath(context, left, top, boxWidth, boxHeight, 4);
    context.stroke();

    context.fillStyle = '#E8ECF1';
    lines.forEach((line, index) => {
      context.fillText(
        line,
        left + PADDING_HORIZONTAL,
        top + PADDING_VERTICAL + lineHeight * index + lineHeight / 2,
      );
    });

    return laneTop;
  }

  // ── Geometry helpers ────────────────────────────────────────────────────

  /** Labels whose bar the time scale is currently showing. */
  private _visibleLabels(): PatternLabel[] {
    const visible = this._chart.timeScale().getVisibleRange();
    if (!visible) return [];
    const from = visible.from as unknown as number;
    const to = visible.to as unknown as number;
    const out: PatternLabel[] = [];
    for (const label of this._source.labels) {
      if (label.time < from || label.time > to) continue;
      out.push(label);
    }
    return out;
  }

  /**
   * Project the bars the time scale is showing into pixel space.
   *
   * Bounded by the visible range: a 50,000-bar chart would otherwise pay 50,000
   * coordinate conversions every frame.
   */
  private _projectVisibleBars(paneWidth: number): ProjectedBar[] {
    const timeScale = this._chart.timeScale();
    const visible = timeScale.getVisibleRange();
    if (!visible) return [];
    const from = visible.from as unknown as number;
    const to = visible.to as unknown as number;

    const projected: ProjectedBar[] = [];
    for (const bar of this._source.bars) {
      if (bar.time < from || bar.time > to) continue;
      const x = timeScale.timeToCoordinate(bar.time as unknown as Time);
      if (x === null || x < -MAX_LABEL_HALF_WIDTH || x > paneWidth + MAX_LABEL_HALF_WIDTH) continue;
      const yHigh = this._series.priceToCoordinate(bar.high);
      const yLow = this._series.priceToCoordinate(bar.low);
      if (yHigh === null || yLow === null) continue;
      projected.push({ x, yHigh, yLow });
    }
    return projected;
  }

  /**
   * The y a label must clear to miss every candle it spans.
   *
   * For a label below, the LARGEST y among lows in range (y grows downward, so
   * the largest y is the lowest price). For one above, the smallest y among
   * highs. Null when no bar falls under the label.
   */
  private _envelopeCoordinate(
    bars: readonly ProjectedBar[],
    left: number,
    right: number,
    direction: 1 | -1,
  ): number | null {
    let result: number | null = null;
    for (const bar of bars) {
      if (bar.x < left || bar.x > right) continue;
      if (direction === 1) {
        if (result === null || bar.yLow > result) result = bar.yLow;
      } else {
        if (result === null || bar.yHigh < result) result = bar.yHigh;
      }
    }
    return result;
  }
}

class PatternLabelPaneView implements IPrimitivePaneView {
  private readonly _source: PatternLabelPrimitive;

  public constructor(source: PatternLabelPrimitive) {
    this._source = source;
  }

  public zOrder(): 'top' {
    return 'top';
  }

  public renderer(): IPrimitivePaneRenderer | null {
    const chart = this._source.chart;
    const series = this._source.series;
    if (!chart || !series) return null;
    return new PatternLabelRenderer(this._source, chart, series);
  }
}

/**
 * Series primitive drawing contextual pattern labels outside the candles.
 *
 * Attach once to the candlestick series, then feed it bars, labels and the
 * crosshair time; it redraws through `requestUpdate`.
 */
export class PatternLabelPrimitive implements ISeriesPrimitive<Time> {
  public labels: readonly PatternLabel[] = [];
  public bars: readonly PatternBar[] = [];
  /** Bar time under the crosshair, or null. Drives the dense-mode name readout. */
  public hoveredTime: number | null = null;
  /**
   * Fraction of pane height reserved at the bottom for another series. The
   * volume histogram shares this pane and a label must never cover it.
   */
  public reservedBottomFraction = 0;
  public chart: IChartApi | null = null;
  public series: ISeriesApi<'Candlestick', Time> | null = null;

  private readonly _paneViews: IPrimitivePaneView[];
  private _requestUpdate: (() => void) | null = null;

  public constructor() {
    this._paneViews = [new PatternLabelPaneView(this)];
  }

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick', Time>;
    this._requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.chart = null;
    this.series = null;
    this._requestUpdate = null;
  }

  public setLabels(labels: readonly PatternLabel[]): void {
    this.labels = labels;
    this._requestUpdate?.();
  }

  /**
   * The candles a label must clear. Separate from `setLabels` because the bar
   * set changes on every data load while the firing set changes only when the
   * user toggles a pattern.
   */
  public setBars(bars: readonly PatternBar[]): void {
    this.bars = bars;
    this._requestUpdate?.();
  }

  public setHoveredTime(time: number | null): void {
    if (this.hoveredTime === time) return;
    this.hoveredTime = time;
    this._requestUpdate?.();
  }

  /**
   * The same array instance every call. lightweight-charts caches pane views by
   * reference, so a fresh array here would invalidate on every frame.
   */
  public paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  public updateAllViews(): void {
    // Nothing to precompute: the renderer reads coordinates at draw time, which
    // is what keeps labels pinned to their bars through pan and zoom.
  }
}
