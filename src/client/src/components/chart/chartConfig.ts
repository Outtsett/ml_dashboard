import { ColorType, type Time } from 'lightweight-charts';

// ── Symbol metadata ────────────────────────────────────────────────────────

export const futuresTickInfo: Record<string, { tickSize: number; tickValue: number; decimals: number }> = {
  ES: { tickSize: 0.25, tickValue: 12.50, decimals: 2 },
  MES: { tickSize: 0.25, tickValue: 1.25, decimals: 2 },
  NQ: { tickSize: 0.25, tickValue: 5.00, decimals: 2 },
  MNQ: { tickSize: 0.25, tickValue: 0.50, decimals: 2 },
  RTY: { tickSize: 0.10, tickValue: 5.00, decimals: 2 },
  M2K: { tickSize: 0.10, tickValue: 0.50, decimals: 2 },
  YM: { tickSize: 1.00, tickValue: 5.00, decimals: 0 },
  MYM: { tickSize: 1.00, tickValue: 0.50, decimals: 0 },
};

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
      vertLines: { color: 'rgba(139, 92, 246, 0.08)' },
      horzLines: { color: 'rgba(139, 92, 246, 0.08)' },
    },
    crosshair: {
      mode: 1 as const,
      vertLine: {
        color: 'rgba(139, 92, 246, 0.5)',
        width: 1 as const,
        style: 2,
        labelBackgroundColor: 'rgba(139, 92, 246, 0.8)',
      },
      horzLine: {
        color: 'rgba(139, 92, 246, 0.5)',
        width: 1 as const,
        style: 2,
        labelBackgroundColor: 'rgba(139, 92, 246, 0.8)',
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
      rightOffset: 5,
      barSpacing: 6,
      minBarSpacing: 0.5,
      fixLeftEdge: false,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: false,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  };
}

export const candleSeriesOptions = (decimals: number, minMove: number) => ({
  upColor: '#22c55e',
  downColor: '#ef4444',
  borderUpColor: '#22c55e',
  borderDownColor: '#ef4444',
  wickUpColor: '#22c55e',
  wickDownColor: '#ef4444',
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
