const FUTURES_BASE_SYMBOLS = ['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM'];

const FOREX_PAIRS = [
  'AUDJPY', 'AUDNZD', 'AUDUSD', 'CADJPY', 'EURAUD', 'EURCHF',
  'EURGBP', 'EURJPY', 'EURUSD', 'GBPAUD', 'GBPCHF', 'GBPJPY',
  'GBPUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY',
];

export function extractSymbolFromFilename(filename: string): string {
  const nameWithoutExt = filename.replace(/\.(csv|zst|parquet|dbn)$/i, '');
  const upperName = nameWithoutExt.toUpperCase();

  // Check forex patterns
  const forexPatterns = [/([A-Z]{3})_([A-Z]{3})/, /([A-Z]{3})([A-Z]{3})/];
  for (const pattern of forexPatterns) {
    const match = upperName.match(pattern);
    if (match) {
      const pair = match[1] + match[2];
      if (FOREX_PAIRS.includes(pair)) return pair;
      const reversed = match[2] + match[1];
      if (FOREX_PAIRS.includes(reversed)) return reversed;
      return pair;
    }
  }

  // Check futures symbols
  for (const sym of FUTURES_BASE_SYMBOLS) {
    if (upperName.includes(sym)) return sym;
  }

  return upperName.split(/[^A-Z0-9]/)[0] || 'UNKNOWN';
}

export function detectAssetType(symbol: string): 'futures' | 'forex' {
  const upper = symbol.toUpperCase();
  if (FUTURES_BASE_SYMBOLS.some(s => upper.startsWith(s))) return 'futures';
  if (FOREX_PAIRS.includes(upper)) return 'forex';
  // Futures contract pattern: base + month code + year digits
  if (/^[A-Z]{2,3}[FGHJKMNQUVXZ]\d{1,2}$/.test(upper)) return 'futures';
  return 'futures'; // default
}
