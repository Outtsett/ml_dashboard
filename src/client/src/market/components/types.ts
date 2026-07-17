import type { CandlestickData, LogicalRange, Time } from 'lightweight-charts';
import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";
import type { SupportResistanceLevel, ZigZagPoint } from '@/market/lib/chart_overlays';
import type { TradeMarker, PredictionMarker } from '@/shared/contexts/UnifiedDashboardContext';
import type { StitchedOHLCVBar } from '@shared/ohlcv';

// ── Core data type ─────────────────────────────────────────────────────────

/** OHLCV bar data (stitching is transparent) */
export type OhlcvData = StitchedOHLCVBar;

// ── Marker types ───────────────────────────────────────────────────────────

export interface LabelMarker {
  timestamp: number;
  label: number | null;
  close?: number;
}

// ── Component API ──────────────────────────────────────────────────────────

export interface TradingChartHandle {
  setVisibleLogicalRange: (range: LogicalRange) => void;
  getVisibleLogicalRange: () => LogicalRange | null;
}

export interface TradingChartProps {
  data: OhlcvData[];
  symbol: string;
  isFutures: boolean;
  timeframe?: number;
  onLoadMore?: (direction: 'left' | 'right', timestamp: number) => void;
  onPrefetch?: (direction: 'left' | 'right', edgeTimestamp: number) => void;
  isLoadingMore?: boolean;
  hasMoreLeft?: boolean;
  hasMoreRight?: boolean;
  labelMarkers?: LabelMarker[];
  indicatorOverlays?: IndicatorOverlay[];
  onVisibleLogicalRangeChange?: (range: LogicalRange) => void;
  showTimeAxis?: boolean;
  supportResistanceLevels?: SupportResistanceLevel[];
  zigZagPoints?: ZigZagPoint[];
  swingZigZagPoints?: ZigZagPoint[];
  tradeMarkers?: TradeMarker[];
  /** Fired with `TradeMarker.id` when the user clicks on (or near) a rendered trade marker. */
  onTradeMarkerClick?: (markerId: string) => void;
  predictionMarkers?: PredictionMarker[];
  isReplayActive?: boolean;
  regimeColorMap?: Map<number, number>;
  trainTestSplitTime?: number;
}

// ── Internal hook types ────────────────────────────────────────────────────

/** Crosshair HUD data */
export interface PriceInfo {
  open: number;
  high: number;
  low: number;
  close: number;
  time: string;
  // Anatomy
  body_magnitude?: number;
  upper_wick_pct?: number;
  lower_wick_pct?: number;
  is_bullish?: boolean;
}

/** Per-candle anatomy metrics */
export interface CandleAnatomy {
  body_magnitude: number;
  upper_wick_pct: number;
  lower_wick_pct: number;
  is_bullish: boolean;
}

/** Processed chart-ready data */
export interface ProcessedChartData {
  candles: CandlestickData<Time>[];
  volumes: { time: Time; value: number; color: string }[];
  /** Maps epoch-seconds → active contract symbol (for futures rollover HUD) */
  activeContractMap?: Map<number, string>;
  /** Maps epoch-seconds → candle anatomy data */
  anatomyMap?: Map<number, CandleAnatomy>;
}
