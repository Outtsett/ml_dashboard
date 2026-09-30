import type { NotebookDrawings, NotebookMarker } from "@/market/lib/useNotebookOverlays";
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
  /**
   * Bars forward from `timestamp` to the bar this label is about. 0 for a
   * label that describes its own bar. The chart draws the marker there, so an
   * "up" label lands on the candle that actually rose.
   */
  outcomeOffset?: number;
  /**
   * Bare TA-Lib pattern name (e.g. `morningstar`) when this marker is a
   * candlestick-pattern firing. Its presence is what makes the arrow hoverable:
   * the hover card needs to know which pattern, not just which sign.
   */
  pattern?: string;
}

// ── Component API ──────────────────────────────────────────────────────────

export interface TradingChartHandle {
  setVisibleLogicalRange: (range: LogicalRange) => void;
  getVisibleLogicalRange: () => LogicalRange | null;
}

export interface TradingChartProps {
  /**
   * Refetch the bars. Present means the chart gets a right-click menu.
   *
   * Lives here rather than on a toolbar alone because a right-click on the
   * chart is where people reach when the candles have not appeared.
   */
  onReloadBars?: () => void;
  isReloadingBars?: boolean;
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
  /**
   * Time span currently on screen, epoch ms. Distinct from
   * `onVisibleLogicalRangeChange`, which reports bar INDICES and is consumed by
   * the subchart sync. Label previews need wall-clock bounds so they fetch only
   * what the viewport shows.
   */
  onVisibleTimeRangeChange?: (range: { start: number; end: number } | null) => void;
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
  /** Fired with the clicked bar's timestamp (epoch ms): the notebooks' focus bar. */
  onBarClick?: (timestampMs: number) => void;
  /** Markers a notebook drew on this chart (useNotebookOverlays). */
  notebookMarkers?: NotebookMarker[];
  /** Levels, shaded zones and vertical lines a notebook drew (notebookDrawings.ts). */
  notebookDrawings?: NotebookDrawings;
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
