/**
 * Client-side candlestick pattern detection.
 *
 * Computes all major candlestick patterns from raw OHLCV bars in the browser.
 * This file acts as the primary API for pattern detection.
 */

import { PATTERN_DETECTORS } from './candles/registry';
import { Bar } from './candles/helpers';
import { toTimeSec } from './calculators/math_primitives';

export interface PatternResult {
  name: string;        // e.g., "CDL_DOJI"
  displayName: string; // e.g., "Doji"
  value: number;       // 100 (bullish), -100 (bearish), or 0
}

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
 */
export function scanPatterns(
  bars: { timestamp: number; open: number; high: number; low: number; close: number }[],
  selectedPatterns?: string[],
): Map<string, { time: number; value: number }[]> {
  const result = new Map<string, { time: number; value: number }[]>();

  const detectors = selectedPatterns
    ? PATTERN_DETECTORS.filter(d => selectedPatterns.includes(d.name))
    : PATTERN_DETECTORS;

  if (detectors.length === 0 || bars.length === 0) return result;

  for (const detector of detectors) {
    result.set(detector.name, []);
  }

  for (let i = 0; i < bars.length; i++) {
    const timeSec = toTimeSec(bars[i]!.timestamp);

    for (const detector of detectors) {
      const value = detector.detect(bars as Bar[], i);
      if (value !== 0) {
        result.get(detector.name)!.push({ time: timeSec, value });
      }
    }
  }

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
