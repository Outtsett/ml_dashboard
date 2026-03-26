import type { CandlestickData, LogicalRange, Time } from 'lightweight-charts';
import type { IndicatorOverlay } from '@/hooks/useIndicatorData';
import type { SupportResistanceLevel, ZigZagPoint } from '@/lib/chart_overlays';
import type { TradeMarker, PredictionMarker } from '@/contexts/UnifiedDashboardContext';
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
}

/** Processed chart-ready data */
export interface ProcessedChartData {
  candles: CandlestickData<Time>[];
  volumes: { time: Time; value: number; color: string }[];
}
