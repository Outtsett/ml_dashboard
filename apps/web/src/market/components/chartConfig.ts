import { ColorType, type Time } from 'lightweight-charts';

// ── Symbol metadata ────────────────────────────────────────────────────────

// Tick size, tick value and price decimals per futures root, derived from
// `packages/config/contract_specifications.json` (AMP Futures, cross-checked against CME Group).
// Kept exported from here so the chart modules keep their import.
export { futuresTickInfo } from '@shared/instruments';

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
      rightOffset: 8,
      barSpacing: 7,
      minBarSpacing: 0.5,
      fixLeftEdge: false,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: false,
      enableConflation: true,
      conflationThresholdFactor: 1.0,
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
