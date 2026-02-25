import type { ContinuousOHLCVBar } from "@shared/ohlcv";

export const timeframes = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1H", minutes: 60 },
  { label: "4H", minutes: 240 },
  { label: "1D", minutes: 1440 },
  { label: "1W", minutes: 10080 },
];

// Use the shared OHLCV type (with optional activeContract for continuous contracts)
export type OhlcvData = ContinuousOHLCVBar;

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

export const MAX_BARS_IN_MEMORY = 50000;

/** Adaptive fetch limit: scale down for higher timeframes */
export function getFetchLimit(timeframe: number): number {
  if (timeframe <= 1) return 10000;
  if (timeframe <= 5) return 5000;
  if (timeframe <= 15) return 3000;
  if (timeframe <= 30) return 2000;
  if (timeframe <= 60) return 1500;
  if (timeframe <= 240) return 1000;
  if (timeframe <= 1440) return 500;
  return 250;
}

/** Map minutes → API timeframe label (lowercase for QuestDB SAMPLE BY) */
export function getApiTimeframe(timeframe: number): string {
  const map: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d', 10080: '1w' };
  return map[timeframe] || `${timeframe}`;
}
