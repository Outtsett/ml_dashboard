/**
 * Client-side candlestick pattern detection.
 *
 * Computes all major candlestick patterns from raw OHLCV bars in the browser.
 * Eliminates the dependency on talib_features QuestDB table for pattern data,
 * so patterns work for all symbols on all time ranges using the chart's own data.
 *
 * Each detector takes an array of bars and an index, returning:
 *   100  = bullish signal
 *  -100  = bearish signal
 *     0  = no pattern detected
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PatternResult {
  name: string;        // e.g., "CDL_DOJI"
  displayName: string; // e.g., "Doji"
  value: number;       // 100 (bullish), -100 (bearish), or 0
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function bodySize(bar: Bar): number {
  return Math.abs(bar.close - bar.open);
}

function upperWick(bar: Bar): number {
  return bar.high - Math.max(bar.open, bar.close);
}

function lowerWick(bar: Bar): number {
  return Math.min(bar.open, bar.close) - bar.low;
}

function range(bar: Bar): number {
  return bar.high - bar.low;
}

function isBullish(bar: Bar): boolean {
  return bar.close > bar.open;
}

function isBearish(bar: Bar): boolean {
  return bar.close < bar.open;
}

function isDoji(bar: Bar): boolean {
  const r = range(bar);
  if (r === 0) return true;
  return bodySize(bar) <= r * 0.1;
}

function bodyMidpoint(bar: Bar): number {
  return (bar.open + bar.close) / 2;
}

function bodyTop(bar: Bar): number {
  return Math.max(bar.open, bar.close);
}

function bodyBottom(bar: Bar): number {
  return Math.min(bar.open, bar.close);
}

/**
 * Determine trend direction from prior bars.
 * Looks back `lookback` bars and compares average close to current close.
 * Returns 'up', 'down', or 'flat'.
 */
function trendDirection(bars: Bar[], index: number, lookback: number = 5): 'up' | 'down' | 'flat' {
  if (index < lookback) return 'flat';
  let sum = 0;
  for (let i = index - lookback; i < index; i++) {
    sum += bars[i]!.close;
  }
  const avg = sum / lookback;
  const current = bars[index]!.close;
  const threshold = avg * 0.001; // 0.1% dead zone
  if (current > avg + threshold) return 'up';
  if (current < avg - threshold) return 'down';
  return 'flat';
}

/**
 * Check if two prices are approximately equal within a tolerance.
 * Tolerance is relative to the average of the two values.
 */
function approxEqual(a: number, b: number, tolerance: number = 0.001): boolean {
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  if (avg === 0) return true;
  return Math.abs(a - b) / avg <= tolerance;
}

// ─── Single-bar patterns ──────────────────────────────────────────────────────

function detectDoji(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  if (isDoji(bar) && range(bar) > 0) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

function detectDragonflyDoji(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Doji with long lower wick, virtually no upper wick
  if (body <= r * 0.1 && lw >= r * 0.6 && uw <= r * 0.1) {
    return 100; // bullish
  }
  return 0;
}

function detectGravestoneDoji(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Doji with long upper wick, virtually no lower wick
  if (body <= r * 0.1 && uw >= r * 0.6 && lw <= r * 0.1) {
    return -100; // bearish
  }
  return 0;
}

function detectLongLeggedDoji(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Doji with both wicks long
  if (body <= r * 0.1 && lw >= r * 0.3 && uw >= r * 0.3) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

function detectHammer(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  if (body === 0) return 0;
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Lower wick >= 2x body, upper wick small
  if (lw >= body * 2 && uw <= body * 0.3) {
    // Hammer appears in downtrend
    const trend = trendDirection(bars, i);
    if (trend === 'down') return 100; // bullish reversal
  }
  return 0;
}

function detectInvertedHammer(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  if (body === 0) return 0;
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Upper wick >= 2x body, lower wick small
  if (uw >= body * 2 && lw <= body * 0.3) {
    const trend = trendDirection(bars, i);
    if (trend === 'down') return 100; // bullish reversal
  }
  return 0;
}

function detectShootingStar(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  if (body === 0) return 0;
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Upper wick >= 2x body, lower wick small, appears in uptrend
  if (uw >= body * 2 && lw <= body * 0.3) {
    const trend = trendDirection(bars, i);
    if (trend === 'up') return -100; // bearish reversal
  }
  return 0;
}

function detectHangingMan(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  if (body === 0) return 0;
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Same shape as hammer but in uptrend
  if (lw >= body * 2 && uw <= body * 0.3) {
    const trend = trendDirection(bars, i);
    if (trend === 'up') return -100; // bearish reversal
  }
  return 0;
}

function detectMarubozu(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  // Body >= 95% of range (no/tiny wicks)
  if (body >= r * 0.95) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

function detectSpinningTop(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Small body (< 30% of range), both wicks present
  if (body < r * 0.3 && lw > r * 0.1 && uw > r * 0.1 && !isDoji(bar)) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

function detectHighWave(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  if (body === 0) return 0;
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Small body, very long wicks (both > 2x body)
  if (body < r * 0.25 && lw > body * 2 && uw > body * 2) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

// ─── Two-bar patterns ─────────────────────────────────────────────────────────

function detectBullishEngulfing(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // Previous bar bearish, current bar bullish
  // Current body fully engulfs previous body
  if (isBearish(prev) && isBullish(curr) &&
      curr.open <= prev.close && curr.close >= prev.open) {
    return 100;
  }
  return 0;
}

function detectBearishEngulfing(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // Previous bar bullish, current bar bearish
  // Current body fully engulfs previous body
  if (isBullish(prev) && isBearish(curr) &&
      curr.open >= prev.close && curr.close <= prev.open) {
    return -100;
  }
  return 0;
}

function detectBullishHarami(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // Previous bar bearish with large body, current bar bullish and inside previous body
  if (isBearish(prev) && isBullish(curr) &&
      bodySize(prev) > bodySize(curr) &&
      curr.open >= prev.close && curr.close <= prev.open) {
    return 100;
  }
  return 0;
}

function detectBearishHarami(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // Previous bar bullish with large body, current bar bearish and inside previous body
  if (isBullish(prev) && isBearish(curr) &&
      bodySize(prev) > bodySize(curr) &&
      curr.open <= prev.close && curr.close >= prev.open) {
    return -100;
  }
  return 0;
}

function detectPiercingLine(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // First bar bearish, second bar bullish
  // Second opens below first low, closes above midpoint of first body
  if (isBearish(prev) && isBullish(curr) &&
      curr.open < prev.low &&
      curr.close > bodyMidpoint(prev) &&
      curr.close < prev.open) {
    return 100;
  }
  return 0;
}

function detectDarkCloudCover(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // First bar bullish, second bar bearish
  // Second opens above first high, closes below midpoint of first body
  if (isBullish(prev) && isBearish(curr) &&
      curr.open > prev.high &&
      curr.close < bodyMidpoint(prev) &&
      curr.close > prev.open) {
    return -100;
  }
  return 0;
}

function detectTweezerTop(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // Same highs, first bullish, second bearish (at top of uptrend)
  if (approxEqual(prev.high, curr.high) &&
      isBullish(prev) && isBearish(curr)) {
    const trend = trendDirection(bars, i - 1);
    if (trend === 'up') return -100;
  }
  return 0;
}

function detectTweezerBottom(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  // Same lows, first bearish, second bullish (at bottom of downtrend)
  if (approxEqual(prev.low, curr.low) &&
      isBearish(prev) && isBullish(curr)) {
    const trend = trendDirection(bars, i - 1);
    if (trend === 'down') return 100;
  }
  return 0;
}

// ─── Three-bar patterns ───────────────────────────────────────────────────────

function detectMorningStar(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  // First: bearish with decent body
  // Second: small body (gap down from first)
  // Third: bullish, closes above midpoint of first bar's body
  const firstBody = bodySize(first);
  const secondBody = bodySize(second);
  const firstRange = range(first);
  if (firstRange === 0) return 0;

  if (isBearish(first) &&
      firstBody > firstRange * 0.3 &&
      secondBody < firstBody * 0.5 &&
      bodyTop(second) < bodyBottom(first) &&
      isBullish(third) &&
      third.close > bodyMidpoint(first)) {
    return 100;
  }
  return 0;
}

function detectEveningStar(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  // First: bullish with decent body
  // Second: small body (gap up from first)
  // Third: bearish, closes below midpoint of first bar's body
  const firstBody = bodySize(first);
  const secondBody = bodySize(second);
  const firstRange = range(first);
  if (firstRange === 0) return 0;

  if (isBullish(first) &&
      firstBody > firstRange * 0.3 &&
      secondBody < firstBody * 0.5 &&
      bodyBottom(second) > bodyTop(first) &&
      isBearish(third) &&
      third.close < bodyMidpoint(first)) {
    return -100;
  }
  return 0;
}

function detectThreeWhiteSoldiers(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  // Three consecutive bullish bars with progressively higher closes
  // Each bar opens within the previous bar's body
  if (isBullish(first) && isBullish(second) && isBullish(third) &&
      second.close > first.close && third.close > second.close &&
      second.open >= first.open && second.open <= first.close &&
      third.open >= second.open && third.open <= second.close &&
      bodySize(first) > range(first) * 0.5 &&
      bodySize(second) > range(second) * 0.5 &&
      bodySize(third) > range(third) * 0.5) {
    return 100;
  }
  return 0;
}

function detectThreeBlackCrows(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  // Three consecutive bearish bars with progressively lower closes
  // Each bar opens within the previous bar's body
  if (isBearish(first) && isBearish(second) && isBearish(third) &&
      second.close < first.close && third.close < second.close &&
      second.open <= first.open && second.open >= first.close &&
      third.open <= second.open && third.open >= second.close &&
      bodySize(first) > range(first) * 0.5 &&
      bodySize(second) > range(second) * 0.5 &&
      bodySize(third) > range(third) * 0.5) {
    return -100;
  }
  return 0;
}

function detectThreeInsideUp(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  // Bullish harami (first two bars) + confirmation (third bar closes above first bar's open)
  if (isBearish(first) && isBullish(second) &&
      bodySize(first) > bodySize(second) &&
      second.open >= first.close && second.close <= first.open &&
      isBullish(third) && third.close > first.open) {
    return 100;
  }
  return 0;
}

function detectThreeInsideDown(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  // Bearish harami (first two bars) + confirmation (third bar closes below first bar's open)
  if (isBullish(first) && isBearish(second) &&
      bodySize(first) > bodySize(second) &&
      second.open <= first.close && second.close >= first.open &&
      isBearish(third) && third.close < first.open) {
    return -100;
  }
  return 0;
}

// ─── Pattern registry ─────────────────────────────────────────────────────────

interface PatternDetector {
  name: string;
  displayName: string;
  detect: (bars: Bar[], index: number) => number;
}

const PATTERN_DETECTORS: PatternDetector[] = [
  // Single-bar
  { name: 'CDL_DOJI', displayName: 'Doji', detect: detectDoji },
  { name: 'CDL_DRAGONFLY_DOJI', displayName: 'Dragonfly Doji', detect: detectDragonflyDoji },
  { name: 'CDL_GRAVESTONE_DOJI', displayName: 'Gravestone Doji', detect: detectGravestoneDoji },
  { name: 'CDL_LONGLEGGED_DOJI', displayName: 'Long Legged Doji', detect: detectLongLeggedDoji },
  { name: 'CDL_HAMMER', displayName: 'Hammer', detect: detectHammer },
  { name: 'CDL_INVERTED_HAMMER', displayName: 'Inverted Hammer', detect: detectInvertedHammer },
  { name: 'CDL_SHOOTING_STAR', displayName: 'Shooting Star', detect: detectShootingStar },
  { name: 'CDL_HANGING_MAN', displayName: 'Hanging Man', detect: detectHangingMan },
  { name: 'CDL_MARUBOZU', displayName: 'Marubozu', detect: detectMarubozu },
  { name: 'CDL_SPINNING_TOP', displayName: 'Spinning Top', detect: detectSpinningTop },
  { name: 'CDL_HIGH_WAVE', displayName: 'High Wave', detect: detectHighWave },
  // Two-bar
  { name: 'CDL_ENGULFING_BULL', displayName: 'Bullish Engulfing', detect: detectBullishEngulfing },
  { name: 'CDL_ENGULFING_BEAR', displayName: 'Bearish Engulfing', detect: detectBearishEngulfing },
  { name: 'CDL_HARAMI_BULL', displayName: 'Bullish Harami', detect: detectBullishHarami },
  { name: 'CDL_HARAMI_BEAR', displayName: 'Bearish Harami', detect: detectBearishHarami },
  { name: 'CDL_PIERCING', displayName: 'Piercing Line', detect: detectPiercingLine },
  { name: 'CDL_DARK_CLOUD', displayName: 'Dark Cloud Cover', detect: detectDarkCloudCover },
  { name: 'CDL_TWEEZER_TOP', displayName: 'Tweezer Top', detect: detectTweezerTop },
  { name: 'CDL_TWEEZER_BOTTOM', displayName: 'Tweezer Bottom', detect: detectTweezerBottom },
  // Three-bar
  { name: 'CDL_MORNING_STAR', displayName: 'Morning Star', detect: detectMorningStar },
  { name: 'CDL_EVENING_STAR', displayName: 'Evening Star', detect: detectEveningStar },
  { name: 'CDL_3WHITE_SOLDIERS', displayName: 'Three White Soldiers', detect: detectThreeWhiteSoldiers },
  { name: 'CDL_3BLACK_CROWS', displayName: 'Three Black Crows', detect: detectThreeBlackCrows },
  { name: 'CDL_3INSIDE_UP', displayName: 'Three Inside Up', detect: detectThreeInsideUp },
  { name: 'CDL_3INSIDE_DOWN', displayName: 'Three Inside Down', detect: detectThreeInsideDown },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/** All available pattern names for the UI catalog. */
export const CANDLE_PATTERN_CATALOG: { name: string; displayName: string }[] =
  PATTERN_DETECTORS.map(d => ({ name: d.name, displayName: d.displayName }));

/**
 * Detect all candlestick patterns at a specific bar index.
 * Returns only patterns with non-zero values (i.e., detected patterns).
 */
export function detectAllPatterns(
  bars: Bar[],
  index: number,
): PatternResult[] {
  const results: PatternResult[] = [];
  for (const detector of PATTERN_DETECTORS) {
    const value = detector.detect(bars, index);
    if (value !== 0) {
      results.push({
        name: detector.name,
        displayName: detector.displayName,
        value,
      });
    }
  }
  return results;
}

/**
 * Scan all bars for all candlestick patterns.
 * Returns a Map: pattern name -> array of {time, value} where value != 0.
 *
 * Only includes entries for patterns that were actually selected.
 * If `selectedPatterns` is omitted, scans for all patterns.
 */
export function scanPatterns(
  bars: { timestamp: number; open: number; high: number; low: number; close: number }[],
  selectedPatterns?: string[],
): Map<string, { time: number; value: number }[]> {
  const result = new Map<string, { time: number; value: number }[]>();

  // Determine which detectors to run
  const detectors = selectedPatterns
    ? PATTERN_DETECTORS.filter(d => selectedPatterns.includes(d.name))
    : PATTERN_DETECTORS;

  if (detectors.length === 0 || bars.length === 0) return result;

  // Initialize result arrays
  for (const detector of detectors) {
    result.set(detector.name, []);
  }

  // Scan each bar
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    // Convert timestamp: if in milliseconds (> 1e12), convert to seconds
    const timeSec = bar.timestamp > 1e12
      ? Math.floor(bar.timestamp / 1000)
      : bar.timestamp;

    for (const detector of detectors) {
      const value = detector.detect(bars, i);
      if (value !== 0) {
        result.get(detector.name)!.push({ time: timeSec, value });
      }
    }
  }

  // Remove empty entries
  for (const [key, arr] of result) {
    if (arr.length === 0) {
      result.delete(key);
    }
  }

  return result;
}

/**
 * Get display name for a pattern by its CDL_* name.
 */
export function getPatternDisplayName(name: string): string {
  const detector = PATTERN_DETECTORS.find(d => d.name === name);
  return detector?.displayName ?? name.replace('CDL_', '').replace(/_/g, ' ');
}
