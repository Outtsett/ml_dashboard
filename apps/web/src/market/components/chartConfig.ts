import { ColorType, type Time } from 'lightweight-charts';

// ── Symbol metadata ────────────────────────────────────────────────────────

// Tick size, tick value and price decimals per futures root, derived from
// `packages/config/contract_specifications.json` (AMP Futures, cross-checked against CME Group).
// Kept exported from here so the chart modules keep their import.
import { futuresTickInfo } from '@shared/instruments';
export { futuresTickInfo };

// ── Viewport ───────────────────────────────────────────────────────────────

/** Densest legible candle spacing; caps zoom-out (≈ pane width in bars). */
export const MIN_BAR_SPACING_PX = 1;
/** Bars framed on first load / symbol or timeframe change. */
export const DEFAULT_VISIBLE_BARS = 250;
/**
 * Empty bar-widths kept to the right of the newest candle. This is what "pinned
 * to the most recent candle" means, so it is the anchor every re-frame reads
 * instead of each site inventing its own.
 */
export const DEFAULT_RIGHT_OFFSET = 8;

/**
 * The ONE definition of "show the most recent bars, ending at the newest candle".
 *
 * `to` is the right edge of the pane in logical space; the newest candle is
 * `rightOffset` bars inside it, so the range is right-aligned rather than
 * flush. Every site that frames the latest bars goes through this, because the
 * five hand-rolled versions disagreed with each other by a bar and with the
 * subchart's own right offset by three.
 *
 * @param totalBars Bar count held by the series; the newest index is `totalBars - 1`.
 * @param visibleBars Bars the range should span end to end.
 */
export function latestBarRange(
  totalBars: number,
  visibleBars: number = DEFAULT_VISIBLE_BARS,
  rightOffset: number = DEFAULT_RIGHT_OFFSET,
    ): { from: number; to: number } {
  const newest = Math.max(0, totalBars - 1);
  const to = newest + rightOffset;
  return { from: Math.max(-rightOffset, to - Math.max(1, visibleBars)), to };
}

export const forexPipInfo: Record<string, { pipLocation: number; pipValue: number; decimals: number }> = {
  EURUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  AUDUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  NZDUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDCAD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  EURJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  GBPJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  AUDJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  CADJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  EURGBP: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  EURAUD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  EURCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  AUDNZD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPAUD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
};

/**
 * Price precision for a forex pair. Pairs outside the table used to fall back
 * to 5 decimals regardless of quote currency, which mis-scaled every unlisted
 * JPY cross; the quote currency decides instead.
 */
export function forexPrecision(symbol: string): { decimals: number; minMove: number } {
  const listed = forexPipInfo[symbol.toUpperCase()];
  if (listed) return { decimals: listed.decimals, minMove: listed.pipValue };
  return symbol.toUpperCase().endsWith('JPY')
    ? { decimals: 3, minMove: 0.001 }
    : { decimals: 5, minMove: 0.00001 };
}

/** Strip futures contract suffix (e.g. "MNQH25" → "MNQ", "ESZ2024" → "ES") */
export function getBaseSymbol(symbol: string): string {
  return symbol.replace(/[A-Z]\d{1,2}$/, '').replace(/\d{4}$/, '');
}

/**
 * Is this symbol a futures root? The tick registry is the answer — a root it
 * holds is priced in ticks, anything else is a forex pair or an equity.
 *
 * Needed where the symbol does not come from the toolbar's asset-type
 * selection: a Model Cycle plan names its own instrument, and its prices must be
 * formatted as ticks whether or not the toolbar is currently on futures.
 */
export function isFuturesSymbol(symbol: string): boolean {
  return futuresTickInfo[getBaseSymbol(symbol.toUpperCase())] !== undefined;
}

// ── Regime colors ──────────────────────────────────────────────────────────

export const REGIME_FILLS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
  '#9C27B0', '#00BCD4', '#FFEB3B', '#795548',
  '#607D8B', '#F44336', '#8BC34A', '#3F51B5',
  '#FF5722', '#009688', '#CDDC39', '#673AB7',
  '#FFC107', '#03A9F4', '#FF4081', '#00E676',
];

// ── Utilities ──────────────────────────────────────────────────────────────

/** Deduplicate & sort series data by time (last-write-wins for dupes) */
export function dedupByTime<T extends { time: Time }>(arr: T[]): T[] {
  const map = new Map<number, T>();
  for (const item of arr) map.set(item.time as number, item);
  const result: T[] = [];
  map.forEach(v => result.push(v));
  return result.sort((a, b) => (a.time as number) - (b.time as number));
}

// ── Chart creation options ─────────────────────────────────────────────────

export function createChartOptions() {
  return {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: 'rgba(255, 255, 255, 0.6)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(139, 92, 246, 0.05)' },
      horzLines: { color: 'rgba(139, 92, 246, 0.05)' },
    },
    crosshair: {
      mode: 1 as const,
      vertLine: {
        color: 'rgba(139, 92, 246, 0.5)',
        width: 1 as const,
        style: 2,
        labelBackgroundColor: 'rgba(139, 92, 246, 0.9)',
      },
      horzLine: {
        color: 'rgba(139, 92, 246, 0.5)',
        width: 1 as const,
        style: 2,
        labelBackgroundColor: 'rgba(139, 92, 246, 0.9)',
      },
    },
    rightPriceScale: {
      borderColor: 'rgba(139, 92, 246, 0.2)',
      scaleMargins: { top: 0.05, bottom: 0.15 },
      autoScale: true,
    },
    timeScale: {
      borderColor: 'rgba(139, 92, 246, 0.2)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: DEFAULT_RIGHT_OFFSET,
      barSpacing: 7,
      // 1px per bar is the densest a candle stays legible. 0.5px + conflation let a 1m chart
      // zoom out to all 50k loaded bars (~2 months), merging candles into an unreadable smear.
      // Wider context belongs on a higher timeframe, not a compressed 1m one.
      minBarSpacing: MIN_BAR_SPACING_PX,
      fixLeftEdge: false,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: false,
      enableConflation: false,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true, kineticScroll: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      axisPressedMouseMove: true, shiftDragMeasure: true, timeScaleShift: true, kineticScroll: true,
      mouseWheel: true,
      pinch: true,
    },
  };
}

// Okabe-Ito colorblind-safe (deuteranopia): up = orange, down = blue.
// Direction is close-vs-previous-close, applied per bar in useChartSeries.
export const CANDLE_UP_COLOR = '#E69F00';
export const CANDLE_DOWN_COLOR = '#0072B2';
export const VOLUME_UP_FILL = 'rgba(230, 158, 0, 0.4)';
export const VOLUME_DOWN_FILL = 'rgba(0, 114, 178, 0.4)';

// Marker palette shares the candle up/down hues so an arrow reads the same
// direction as the bar it sits on. Neutral is Okabe-Ito reddish-purple, which
// stays distinct from both orange and blue under deuteranopia.
export const MARKER_NEUTRAL_COLOR = '#CC79A7';
export const PREDICTION_UP_FILL = 'rgba(230, 158, 0, 0.5)';
export const PREDICTION_DOWN_FILL = 'rgba(0, 114, 178, 0.5)';
export const PREDICTION_NEUTRAL_FILL = 'rgba(204, 121, 167, 0.35)';

export const candleSeriesOptions = (decimals: number, minMove: number) => ({
  upColor: CANDLE_UP_COLOR,
  downColor: CANDLE_DOWN_COLOR,
  borderUpColor: CANDLE_UP_COLOR,
  borderDownColor: CANDLE_DOWN_COLOR,
  wickUpColor: CANDLE_UP_COLOR,
  wickDownColor: CANDLE_DOWN_COLOR,
  priceFormat: {
    type: 'price' as const,
    precision: decimals,
    minMove,
  },
});

export const volumeSeriesOptions = {
  color: 'rgba(139, 92, 246, 0.3)',
  priceFormat: { type: 'volume' as const },
  priceScaleId: '',
};

export const volumeScaleMargins = { top: 0.82, bottom: 0 };
