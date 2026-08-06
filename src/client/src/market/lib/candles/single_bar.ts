import { 
  Bar, 
  bodySize, 
  upperWick, 
  lowerWick, 
  range, 
  isBullish, 
  isBearish, 
  isDoji, 
  trendDirection,
  avgBodySize
} from './helpers';

export function detectDoji(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  if (isDoji(bar) && range(bar) > 0) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

export function detectDragonflyDoji(bars: Bar[], i: number): number {
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

export function detectGravestoneDoji(bars: Bar[], i: number): number {
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

export function detectLongLeggedDoji(bars: Bar[], i: number): number {
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

export function detectHammer(bars: Bar[], i: number): number {
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

export function detectInvertedHammer(bars: Bar[], i: number): number {
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

export function detectShootingStar(bars: Bar[], i: number): number {
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

export function detectHangingMan(bars: Bar[], i: number): number {
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

export function detectMarubozu(bars: Bar[], i: number): number {
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

export function detectSpinningTop(bars: Bar[], i: number): number {
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

export function detectHighWave(bars: Bar[], i: number): number {
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

export function detectClosingMarubozu(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  if (body < r * 0.6) return 0;
  if (isBullish(bar)) {
    // No upper wick (close == high) — closing marubozu bullish
    if (upperWick(bar) <= r * 0.02) return 100;
  } else if (isBearish(bar)) {
    // No lower wick (close == low) — closing marubozu bearish
    if (lowerWick(bar) <= r * 0.02) return -100;
  }
  return 0;
}

export function detectLongLine(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const body = bodySize(bar);
  if (body === 0) return 0;
  const avg = avgBodySize(bars, i);
  if (avg === 0) return 0;
  // Body > 3x average body
  if (body > avg * 3) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

export function detectShortLine(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const body = bodySize(bar);
  const avg = avgBodySize(bars, i);
  if (avg === 0) return 0;
  // Body < average body / 3
  if (body < avg / 3 && body > 0) {
    return isBullish(bar) ? 100 : -100;
  }
  return 0;
}

export function detectRickshawMan(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Doji with very long equal shadows, body near center of range
  if (body <= r * 0.1 && lw >= r * 0.35 && uw >= r * 0.35) {
    // Shadows roughly equal
    const shadowRatio = Math.min(lw, uw) / Math.max(lw, uw);
    if (shadowRatio >= 0.6) {
      return isBullish(bar) ? 100 : -100;
    }
  }
  return 0;
}

export function detectTakuri(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  const lw = lowerWick(bar);
  const uw = upperWick(bar);
  // Dragonfly doji variant: very long lower shadow (>= 3x body), tiny upper shadow
  if (body <= r * 0.15 && lw >= body * 3 && lw >= r * 0.6 && uw <= r * 0.1) {
    const trend = trendDirection(bars, i);
    if (trend === 'down') return 100;
  }
  return 0;
}

export function detectBeltHold(bars: Bar[], i: number): number {
  const bar = bars[i]!;
  const r = range(bar);
  if (r === 0) return 0;
  const body = bodySize(bar);
  if (body < r * 0.6) return 0;
  if (isBullish(bar)) {
    // Bullish belt hold: opens at low (no lower shadow), strong close
    if (lowerWick(bar) <= r * 0.02) {
      const trend = trendDirection(bars, i);
      if (trend === 'down') return 100;
    }
  } else if (isBearish(bar)) {
    // Bearish belt hold: opens at high (no upper shadow), strong close down
    if (upperWick(bar) <= r * 0.02) {
      const trend = trendDirection(bars, i);
      if (trend === 'up') return -100;
    }
  }
  return 0;
}
