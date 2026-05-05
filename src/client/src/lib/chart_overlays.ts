/**
 * Client-side chart overlay computations: Support/Resistance levels and microstructure.
 * These run in the browser on visible OHLCV data â€” no server round-trip.
 */

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  /** Number of touches / tests of this level */
  touches: number;
  /** Strength 0-1 (normalized touches) */
  strength: number;
  /** First timestamp (seconds) this level was established */
  firstTime: number;
  /** Last timestamp (seconds) this level was tested */
  lastTime: number;
}

export interface ZigZagPoint {
  time: number; // seconds
  value: number;
  type: 'high' | 'low';
}

export interface ZigZagSegment {
  time: number;
  value: number;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Support & Resistance
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface OhlcBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Detect microstructure highs and lows using a lookback window.
 */
function findStructuralPivots(bars: OhlcBar[], lookback: number = 5): { highs: { time: number; price: number }[]; lows: { time: number; price: number }[] } {
  const highs: { time: number; price: number }[] = [];
  const lows: { time: number; price: number }[] = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (bars[i]!.high <= bars[i - j]!.high || bars[i]!.high <= bars[i + j]!.high) {
        isHigh = false;
      }
      if (bars[i]!.low >= bars[i - j]!.low || bars[i]!.low >= bars[i + j]!.low) {
        isLow = false;
      }
    }

    if (isHigh) highs.push({ time: bars[i]!.time, price: bars[i]!.high });
    if (isLow) lows.push({ time: bars[i]!.time, price: bars[i]!.low });
  }

  return { highs, lows };
}

/**
 * Cluster nearby price levels to find significant S/R zones.
 * Uses a tolerance band based on average range.
 */
function clusterLevels(
  points: { time: number; price: number }[],
  type: 'support' | 'resistance',
  tolerance: number,
): SupportResistanceLevel[] {
  if (points.length === 0) return [];

  // Sort by price
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: { prices: number[]; times: number[] }[] = [];

  let currentCluster = { prices: [sorted[0]!.price], times: [sorted[0]!.time] };

  for (let i = 1; i < sorted.length; i++) {
    const avg = currentCluster.prices.reduce((a, b) => a + b, 0) / currentCluster.prices.length;
    if (Math.abs(sorted[i]!.price - avg) <= tolerance) {
      currentCluster.prices.push(sorted[i]!.price);
      currentCluster.times.push(sorted[i]!.time);
    } else {
      clusters.push(currentCluster);
      currentCluster = { prices: [sorted[i]!.price], times: [sorted[i]!.time] };
    }
  }
  clusters.push(currentCluster);

  // Only keep clusters with 2+ touches
  const significant = clusters.filter(c => c.prices.length >= 2);
  if (significant.length === 0) return [];

  const maxTouches = Math.max(...significant.map(c => c.prices.length));

  return significant.map(c => ({
    price: c.prices.reduce((a, b) => a + b, 0) / c.prices.length,
    type,
    touches: c.prices.length,
    strength: c.prices.length / maxTouches,
    firstTime: Math.min(...c.times),
    lastTime: Math.max(...c.times),
  }));
}

/**
 * Compute support and resistance levels from OHLCV bars.
 * @param bars - Array of {time (sec), open, high, low, close}
 * @param lookback - microstructure detection window (default 5)
 * @param maxLevels - Max S/R lines to return (default 10)
 */
export function computeSupportResistance(
  bars: OhlcBar[],
  lookback: number = 5,
  maxLevels: number = 10,
): SupportResistanceLevel[] {
  if (bars.length < lookback * 2 + 1) return [];

  const { highs, lows } = findStructuralPivots(bars, lookback);

  // Tolerance = 0.5 Ã— average true range
  let atrSum = 0;
  for (let i = 1; i < bars.length; i++) {
    atrSum += Math.max(
      bars[i]!.high - bars[i]!.low,
      Math.abs(bars[i]!.high - bars[i - 1]!.close),
      Math.abs(bars[i]!.low - bars[i - 1]!.close),
    );
  }
  const avgTR = atrSum / (bars.length - 1);
  const tolerance = avgTR * 0.5;

  const resistance = clusterLevels(highs, 'resistance', tolerance);
  const support = clusterLevels(lows, 'support', tolerance);

  // Merge and sort by strength (touches), keep top N
  const all = [...resistance, ...support]
    .sort((a, b) => b.touches - a.touches)
    .slice(0, maxLevels);

  return all;
}


// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// microstructure
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Compute microstructure turning points.
 * @param bars - OHLCV bars sorted by time
 * @param threshold - If > 0, used as a fixed % threshold. If 0, auto-computed from ATR.
 */
export function computeZigZag(
  bars: OhlcBar[],
  threshold: number = 0,
): ZigZagPoint[] {
  if (bars.length < 3) return [];

  // Auto-compute threshold from ATR if not specified or 0
  let thresholdRatio: number;
  if (threshold > 0) {
    thresholdRatio = threshold / 100;
  } else {
    // Compute average true range as % of price
    let atrSum = 0;
    let priceSum = 0;
    for (let i = 1; i < bars.length; i++) {
      atrSum += Math.max(
        bars[i]!.high - bars[i]!.low,
        Math.abs(bars[i]!.high - bars[i - 1]!.close),
        Math.abs(bars[i]!.low - bars[i - 1]!.close),
      );
      priceSum += bars[i]!.close;
    }
    const avgTR = atrSum / (bars.length - 1);
    const avgPrice = priceSum / (bars.length - 1);
    // Threshold = ~2x ATR as % of price â€” catches intermediate swings on intraday
    // (was 5x, which only showed weekly-scale moves on 30m charts)
    thresholdRatio = Math.max((avgTR * 2) / avgPrice, 0.0005); // floor at 0.05%
  }
  const points: ZigZagPoint[] = [];

  // Initialize with first bar
  let lastHigh = bars[0]!.high;
  let lastHighTime = bars[0]!.time;
  let lastLow = bars[0]!.low;
  let lastLowTime = bars[0]!.time;
  let direction: 'up' | 'down' | null = null;

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!;

    if (direction === null) {
      // Determine initial direction
      if (bar.high > lastHigh && (bar.high - lastLow) / lastLow >= thresholdRatio) {
        direction = 'up';
        points.push({ time: lastLowTime, value: lastLow, type: 'low' });
        lastHigh = bar.high;
        lastHighTime = bar.time;
      } else if (bar.low < lastLow && (lastHigh - bar.low) / bar.low >= thresholdRatio) {
        direction = 'down';
        points.push({ time: lastHighTime, value: lastHigh, type: 'high' });
        lastLow = bar.low;
        lastLowTime = bar.time;
      } else {
        if (bar.high > lastHigh) { lastHigh = bar.high; lastHighTime = bar.time; }
        if (bar.low < lastLow) { lastLow = bar.low; lastLowTime = bar.time; }
      }
    } else if (direction === 'up') {
      if (bar.high > lastHigh) {
        // Continue up
        lastHigh = bar.high;
        lastHighTime = bar.time;
      }
      if ((lastHigh - bar.low) / lastHigh >= thresholdRatio) {
        // Reversal down
        points.push({ time: lastHighTime, value: lastHigh, type: 'high' });
        direction = 'down';
        lastLow = bar.low;
        lastLowTime = bar.time;
      }
    } else {
      // direction === 'down'
      if (bar.low < lastLow) {
        // Continue down
        lastLow = bar.low;
        lastLowTime = bar.time;
      }
      if ((bar.high - lastLow) / lastLow >= thresholdRatio) {
        // Reversal up
        points.push({ time: lastLowTime, value: lastLow, type: 'low' });
        direction = 'up';
        lastHigh = bar.high;
        lastHighTime = bar.time;
      }
    }
  }

  // Add the final point
  if (direction === 'up') {
    points.push({ time: lastHighTime, value: lastHigh, type: 'high' });
  } else if (direction === 'down') {
    points.push({ time: lastLowTime, value: lastLow, type: 'low' });
  }

  return points;
}

/**
 * Convert microstructure points to a line series format for lightweight-charts.
 */
export function zigZagToLineSeries(points: ZigZagPoint[]): ZigZagSegment[] {
  return points.map(p => ({ time: p.time, value: p.value }));
}


// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// microstructure microstructure (every microstructure high/low, no filtering)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Compute a raw microstructure microstructure that captures EVERY microstructure high and low,
 * alternating between them. No minimum-move threshold â€” this shows
 * every single zig and zag in the price action.
 *
 * Uses a bar-by-bar directional tracking approach: tracks whether
 * price is currently moving up or down and records turning points
 * whenever direction reverses.
 *
 * @param bars - OHLCV bars sorted by time
 */
export function computeMicroStructure(
  bars: OhlcBar[],
): ZigZagPoint[] {
  if (bars.length < 3) return [];

  const points: ZigZagPoint[] = [];

  // Track the current extreme in each direction
  let lastHigh = bars[0]!.high;
  let lastHighTime = bars[0]!.time;
  let lastLow = bars[0]!.low;
  let lastLowTime = bars[0]!.time;

  // Determine initial direction from first two bars
  let direction: 'up' | 'down' | null = null;
  if (bars[1]!.high > bars[0]!.high) {
    direction = 'up';
    lastHigh = bars[1]!.high;
    lastHighTime = bars[1]!.time;
    points.push({ time: bars[0]!.time, value: bars[0]!.low, type: 'low' });
  } else if (bars[1]!.low < bars[0]!.low) {
    direction = 'down';
    lastLow = bars[1]!.low;
    lastLowTime = bars[1]!.time;
    points.push({ time: bars[0]!.time, value: bars[0]!.high, type: 'high' });
  }

  for (let i = 2; i < bars.length; i++) {
    const bar = bars[i]!;

    if (direction === null) {
      // Still determining direction
      if (bar.high > lastHigh) {
        direction = 'up';
        points.push({ time: lastLowTime, value: lastLow, type: 'low' });
        lastHigh = bar.high;
        lastHighTime = bar.time;
      } else if (bar.low < lastLow) {
        direction = 'down';
        points.push({ time: lastHighTime, value: lastHigh, type: 'high' });
        lastLow = bar.low;
        lastLowTime = bar.time;
      } else {
        if (bar.high > lastHigh) { lastHigh = bar.high; lastHighTime = bar.time; }
        if (bar.low < lastLow) { lastLow = bar.low; lastLowTime = bar.time; }
      }
    } else if (direction === 'up') {
      if (bar.high >= lastHigh) {
        // Continue up â€” extend the current high
        lastHigh = bar.high;
        lastHighTime = bar.time;
      } else if (bar.low < bars[i - 1]!.low) {
        // Reversal: bar made a lower low than previous bar â†’ we were going up, now going down
        // Record the high point
        points.push({ time: lastHighTime, value: lastHigh, type: 'high' });
        direction = 'down';
        lastLow = bar.low;
        lastLowTime = bar.time;
      }
    } else {
      // direction === 'down'
      if (bar.low <= lastLow) {
        // Continue down â€” extend the current low
        lastLow = bar.low;
        lastLowTime = bar.time;
      } else if (bar.high > bars[i - 1]!.high) {
        // Reversal: bar made a higher high than previous bar â†’ we were going down, now going up
        // Record the low point
        points.push({ time: lastLowTime, value: lastLow, type: 'low' });
        direction = 'up';
        lastHigh = bar.high;
        lastHighTime = bar.time;
      }
    }
  }

  // Add the final point
  if (direction === 'up') {
    points.push({ time: lastHighTime, value: lastHigh, type: 'high' });
  } else if (direction === 'down') {
    points.push({ time: lastLowTime, value: lastLow, type: 'low' });
  }

  return points;
}

