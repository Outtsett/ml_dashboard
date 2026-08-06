import type { StitchedOHLCVBar } from "@shared/ohlcv";

// Re-export shared timeframe helpers so existing imports keep working
export { TIMEFRAME_OPTIONS as timeframes, MAX_BARS_IN_MEMORY, getFetchLimit, minutesToApiKey as getApiTimeframe } from "@/market/lib/timeframes";

// Use the shared OHLCV type (stitching is transparent for futures)
export type OhlcvData = StitchedOHLCVBar;

export interface InstrumentInfo {
  symbol: string;
  name: string;
  assetType: string;
  exchange?: string;
}

export interface ChartSymbolInfo {
  symbol: string;
  row_count: number;
  first_bar: string;
  last_bar: string;
}
