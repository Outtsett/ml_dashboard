/**
 * Symbol Mapping — single source of truth for symbol → ticker conversions.
 *
 * Maps internal symbols (ES, MES, EURUSD, etc.) to external API ticker formats.
 * Eliminates the 3x duplication that existed in routes/news.ts.
 */

/** Maps internal symbols to Yahoo Finance RSS tickers */
export const YAHOO_TICKER_MAP: Record<string, string> = {
  // CME Equity Index Futures
  'ES': 'ES=F', 'MES': 'ES=F',
  'NQ': 'NQ=F', 'MNQ': 'NQ=F',
  'RTY': 'RTY=F', 'M2K': 'RTY=F',
  // CBOT Dow Futures
  'YM': 'YM=F', 'MYM': 'YM=F',
  // Forex pairs
  'EURUSD': 'EURUSD=X', 'USDJPY': 'USDJPY=X', 'GBPUSD': 'GBPUSD=X',
  'AUDUSD': 'AUDUSD=X', 'USDCAD': 'USDCAD=X', 'USDCHF': 'USDCHF=X',
  'NZDUSD': 'NZDUSD=X', 'EURJPY': 'EURJPY=X', 'GBPJPY': 'GBPJPY=X',
  'EURGBP': 'EURGBP=X', 'AUDJPY': 'AUDJPY=X', 'EURAUD': 'EURAUD=X',
  'EURCHF': 'EURCHF=X', 'AUDNZD': 'AUDNZD=X', 'GBPAUD': 'GBPAUD=X',
} as const;

/** Maps internal symbols to Alpha Vantage API tickers */
export const ALPHA_VANTAGE_TICKER_MAP: Record<string, string> = {
  'ES': 'SPY', 'MES': 'SPY',
  'NQ': 'QQQ', 'MNQ': 'QQQ',
  'RTY': 'IWM', 'M2K': 'IWM',
  'YM': 'DIA', 'MYM': 'DIA',
  'EURUSD': 'FOREX:EUR', 'USDJPY': 'FOREX:JPY', 'GBPUSD': 'FOREX:GBP',
  'AUDUSD': 'FOREX:AUD', 'USDCAD': 'FOREX:CAD', 'USDCHF': 'FOREX:CHF',
  'NZDUSD': 'FOREX:NZD', 'EURJPY': 'FOREX:EUR', 'GBPJPY': 'FOREX:GBP',
  'EURGBP': 'FOREX:EUR', 'AUDJPY': 'FOREX:AUD', 'EURAUD': 'FOREX:EUR',
  'EURCHF': 'FOREX:EUR', 'AUDNZD': 'FOREX:AUD', 'GBPAUD': 'FOREX:GBP',
  'GBPCHF': 'FOREX:GBP', 'CADJPY': 'FOREX:CAD',
} as const;

export function getYahooTicker(symbol: string): string {
  return YAHOO_TICKER_MAP[symbol] || symbol;
}

export function getAlphaVantageTicker(symbol: string): string {
  return ALPHA_VANTAGE_TICKER_MAP[symbol] || symbol;
}
