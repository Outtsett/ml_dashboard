import { 
  Bar, 
  bodySize, 
  bodyTop,
  bodyBottom,
  bodyMidpoint,
  range, 
  isBullish, 
  isBearish, 
  isDoji, 
  isMarubozu,
  trendDirection,
  approxEqual
} from './helpers';

export function detectBullishEngulfing(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (isBearish(prev) && isBullish(curr) &&
      curr.open <= prev.close && curr.close >= prev.open) {
    return 100;
  }
  return 0;
}

export function detectBearishEngulfing(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (isBullish(prev) && isBearish(curr) &&
      curr.open >= prev.close && curr.close <= prev.open) {
    return -100;
  }
  return 0;
}

export function detectBullishHarami(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (isBearish(prev) && isBullish(curr) &&
      bodySize(prev) > bodySize(curr) &&
      curr.open >= prev.close && curr.close <= prev.open) {
    return 100;
  }
  return 0;
}

export function detectBearishHarami(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (isBullish(prev) && isBearish(curr) &&
      bodySize(prev) > bodySize(curr) &&
      curr.open <= prev.close && curr.close >= prev.open) {
    return -100;
  }
  return 0;
}

export function detectPiercingLine(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (isBearish(prev) && isBullish(curr) &&
      curr.open < prev.low &&
      curr.close > bodyMidpoint(prev) &&
      curr.close < prev.open) {
    return 100;
  }
  return 0;
}

export function detectDarkCloudCover(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (isBullish(prev) && isBearish(curr) &&
      curr.open > prev.high &&
      curr.close < bodyMidpoint(prev) &&
      curr.close > prev.open) {
    return -100;
  }
  return 0;
}

export function detectTweezerTop(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (approxEqual(prev.high, curr.high) &&
      isBullish(prev) && isBearish(curr)) {
    const trend = trendDirection(bars, i - 1);
    if (trend === 'up') return -100;
  }
  return 0;
}

export function detectTweezerBottom(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (approxEqual(prev.low, curr.low) &&
      isBearish(prev) && isBullish(curr)) {
    const trend = trendDirection(bars, i - 1);
    if (trend === 'down') return 100;
  }
  return 0;
}

export function detectDojiStar(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isDoji(curr)) return 0;
  const prevBody = bodySize(prev);
  if (prevBody < range(prev) * 0.5) return 0;
  if (isBullish(prev)) {
    if (bodyBottom(curr) > bodyTop(prev)) return -100;
  } else if (isBearish(prev)) {
    if (bodyTop(curr) < bodyBottom(prev)) return 100;
  }
  return 0;
}

export function detectCounterattack(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  const prevBody = bodySize(prev);
  const currBody = bodySize(curr);
  if (prevBody < range(prev) * 0.5 || currBody < range(curr) * 0.5) return 0;
  if (isBearish(prev) && isBullish(curr) && approxEqual(prev.close, curr.close, 0.003)) {
    return 100;
  }
  if (isBullish(prev) && isBearish(curr) && approxEqual(prev.close, curr.close, 0.003)) {
    return -100;
  }
  return 0;
}

export function detectHomingPigeon(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isBearish(prev) || !isBearish(curr)) return 0;
  if (curr.open <= prev.open && curr.close >= prev.close &&
      bodySize(curr) < bodySize(prev)) {
    const trend = trendDirection(bars, i);
    if (trend === 'down') return 100;
  }
  return 0;
}

export function detectMatchingLow(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isBearish(prev) || !isBearish(curr)) return 0;
  if (approxEqual(prev.close, curr.close, 0.002)) {
    const trend = trendDirection(bars, i);
    if (trend === 'down') return 100;
  }
  return 0;
}

export function detectKicking(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isMarubozu(prev) || !isMarubozu(curr)) return 0;
  if (isBearish(prev) && isBullish(curr)) {
    if (curr.open > prev.open) return 100;
  }
  if (isBullish(prev) && isBearish(curr)) {
    if (curr.open < prev.open) return -100;
  }
  return 0;
}

export function detectKickingByLength(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isMarubozu(prev) || !isMarubozu(curr)) return 0;
  if (isBullish(prev) === isBullish(curr)) return 0;
  if (isBearish(prev) && isBullish(curr) && curr.open <= prev.open) return 0;
  if (isBullish(prev) && isBearish(curr) && curr.open >= prev.open) return 0;
  const prevLen = bodySize(prev);
  const currLen = bodySize(curr);
  if (currLen > prevLen) {
    return isBullish(curr) ? 100 : -100;
  } else {
    return isBullish(prev) ? 100 : -100;
  }
}

export function detectInNeck(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isBearish(prev) || !isBullish(curr)) return 0;
  if (bodySize(prev) < range(prev) * 0.5) return 0;
  if (curr.open < prev.low) {
    const diff = curr.close - prev.close;
    const prevR = range(prev);
    if (diff >= 0 && diff <= prevR * 0.05) return -100;
  }
  return 0;
}

export function detectOnNeck(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isBearish(prev) || !isBullish(curr)) return 0;
  if (bodySize(prev) < range(prev) * 0.5) return 0;
  if (curr.open < prev.low) {
    if (approxEqual(curr.close, prev.low, 0.003)) return -100;
  }
  return 0;
}

export function detectSeparatingLines(bars: Bar[], i: number): number {
  if (i < 1) return 0;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!approxEqual(prev.open, curr.open, 0.002)) return 0;
  if (isBearish(prev) && isBullish(curr)) {
    if (bodySize(curr) > range(curr) * 0.5) return 100;
  }
  if (isBullish(prev) && isBearish(curr)) {
    if (bodySize(curr) > range(curr) * 0.5) return -100;
  }
  return 0;
}

export function detectGapSideSideWhite(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const prev = bars[i - 1]!;
  const curr = bars[i]!;
  if (!isBullish(prev) || !isBullish(curr)) return 0;
  if (!approxEqual(bodySize(prev), bodySize(curr), 0.3)) return 0;
  if (!approxEqual(prev.open, curr.open, 0.005)) return 0;
  if (prev.low > first.high) return 100;
  if (prev.high < first.low) return -100;
  return 0;
}
