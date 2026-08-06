import { 
  Bar, 
  bodySize, 
  range, 
  isBullish, 
  isBearish, 
  isDoji, 
  isMarubozu,
  bodyTop,
  bodyBottom,
  bodyMidpoint,
  upperWick
} from './helpers';

// ─── Four-bar patterns ──────────────────────────────────────────────────

export function detect3LineStrike(bars: Bar[], i: number): number {
  if (i < 3) return 0;
  const b1 = bars[i - 3]!;
  const b2 = bars[i - 2]!;
  const b3 = bars[i - 1]!;
  const b4 = bars[i]!;
  // Bullish: 3 consecutive bearish candles + 4th bullish engulfs all 3
  if (isBearish(b1) && isBearish(b2) && isBearish(b3) &&
      b2.close < b1.close && b3.close < b2.close) {
    if (isBullish(b4) && b4.open <= b3.close && b4.close >= b1.open) {
      return 100;
    }
  }
  // Bearish: 3 consecutive bullish candles + 4th bearish engulfs all 3
  if (isBullish(b1) && isBullish(b2) && isBullish(b3) &&
      b2.close > b1.close && b3.close > b2.close) {
    if (isBearish(b4) && b4.open >= b3.close && b4.close <= b1.open) {
      return -100;
    }
  }
  return 0;
}

export function detectConcealBabySwallow(bars: Bar[], i: number): number {
  if (i < 3) return 0;
  const b1 = bars[i - 3]!;
  const b2 = bars[i - 2]!;
  const b3 = bars[i - 1]!;
  const b4 = bars[i]!;
  // 4 black candles
  if (!isBearish(b1) || !isBearish(b2) || !isBearish(b3) || !isBearish(b4)) return 0;
  // First two are marubozu (no shadows)
  if (!isMarubozu(b1) || !isMarubozu(b2)) return 0;
  // Third: opens with gap down, has upper wick that reaches into b2 body
  if (b3.open >= b2.close) return 0;
  if (b3.high < bodyBottom(b2)) return 0;
  // Fourth: opens above third's high and closes below third's low (engulfs third entirely)
  if (b4.open >= b3.high && b4.close <= b3.low) return 100;
  return 0;
}

export function detectHikkake(bars: Bar[], i: number): number {
  if (i < 4) return 0;
  const insideParent = bars[i - 4]!;
  const insideBar = bars[i - 3]!;
  const breakout = bars[i - 2]!;
  // const confirm1 = bars[i - 1]!;
  const confirm2 = bars[i]!;
  if (insideBar.high >= insideParent.high || insideBar.low <= insideParent.low) return 0;
  if (breakout.low < insideBar.low) {
    if (confirm2.close > insideParent.high) return 100;
  }
  if (breakout.high > insideBar.high) {
    if (confirm2.close < insideParent.low) return -100;
  }
  return 0;
}

export function detectHikkakeMod(bars: Bar[], i: number): number {
  if (i < 5) return 0;
  const insideParent = bars[i - 5]!;
  const insideBar = bars[i - 4]!;
  const breakout = bars[i - 3]!;
  const retrace1 = bars[i - 2]!;
  const retrace2 = bars[i - 1]!;
  const confirm = bars[i]!;
  if (insideBar.high >= insideParent.high || insideBar.low <= insideParent.low) return 0;
  if (breakout.low < insideBar.low) {
    if (retrace1.close > insideBar.low && retrace2.close > insideBar.low) {
      if (confirm.close > insideParent.high) return 100;
    }
  }
  if (breakout.high > insideBar.high) {
    if (retrace1.close < insideBar.high && retrace2.close < insideBar.high) {
      if (confirm.close < insideParent.low) return -100;
    }
  }
  return 0;
}

// ─── Five-bar patterns ──────────────────────────────────────────────────

export function detectAbandonedBaby(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (!isDoji(second)) return 0;
  if (isBearish(first) && isBullish(third)) {
    if (second.high < first.low && second.high < third.low) {
      if (third.close > bodyMidpoint(first)) return 100;
    }
  }
  if (isBullish(first) && isBearish(third)) {
    if (second.low > first.high && second.low > third.high) {
      if (third.close < bodyMidpoint(first)) return -100;
    }
  }
  return 0;
}

export function detectBreakaway(bars: Bar[], i: number): number {
  if (i < 4) return 0;
  const b1 = bars[i - 4]!;
  const b2 = bars[i - 3]!;
  const b3 = bars[i - 2]!;
  const b4 = bars[i - 1]!;
  const b5 = bars[i]!;
  if (isBearish(b1) && bodySize(b1) > range(b1) * 0.5) {
    if (isBearish(b2) && b2.open < b1.close) {
      if (b3.close <= b2.close && b4.close <= b3.close) {
        if (isBullish(b5) && b5.close > b2.open && b5.close < b1.close) {
          return 100;
        }
      }
    }
  }
  if (isBullish(b1) && bodySize(b1) > range(b1) * 0.5) {
    if (isBullish(b2) && b2.open > b1.close) {
      if (b3.close >= b2.close && b4.close >= b3.close) {
        if (isBearish(b5) && b5.close < b2.open && b5.close > b1.close) {
          return -100;
        }
      }
    }
  }
  return 0;
}

export function detectLadderBottom(bars: Bar[], i: number): number {
  if (i < 4) return 0;
  const b1 = bars[i - 4]!;
  const b2 = bars[i - 3]!;
  const b3 = bars[i - 2]!;
  const b4 = bars[i - 1]!;
  const b5 = bars[i]!;
  if (!isBearish(b1) || !isBearish(b2) || !isBearish(b3)) return 0;
  if (b2.close >= b1.close || b3.close >= b2.close) return 0;
  if (!isBearish(b4)) return 0;
  if (upperWick(b4) < bodySize(b4) * 0.5) return 0;
  if (!isBullish(b5)) return 0;
  if (b5.open < bodyTop(b4)) return 0;
  if (b5.close <= b4.high) return 0;
  return 100;
}

export function detectMatHold(bars: Bar[], i: number): number {
  if (i < 4) return 0;
  const b1 = bars[i - 4]!;
  const b2 = bars[i - 3]!;
  const b3 = bars[i - 2]!;
  const b4 = bars[i - 1]!;
  const b5 = bars[i]!;
  if (isBullish(b1) && bodySize(b1) > range(b1) * 0.5) {
    if (bodySize(b2) < bodySize(b1) * 0.5) {
      if (bodySize(b3) < bodySize(b1) * 0.5 &&
          bodySize(b4) < bodySize(b1) * 0.5) {
        if (Math.min(b2.low, b3.low, b4.low) > bodyMidpoint(b1)) {
          if (isBullish(b5) && b5.close > b1.high &&
              bodySize(b5) > range(b5) * 0.5) {
            return 100;
          }
        }
      }
    }
  }
  if (isBearish(b1) && bodySize(b1) > range(b1) * 0.5) {
    if (bodySize(b2) < bodySize(b1) * 0.5) {
      if (bodySize(b3) < bodySize(b1) * 0.5 &&
          bodySize(b4) < bodySize(b1) * 0.5) {
        if (Math.max(b2.high, b3.high, b4.high) < bodyMidpoint(b1)) {
          if (isBearish(b5) && b5.close < b1.low &&
              bodySize(b5) > range(b5) * 0.5) {
            return -100;
          }
        }
      }
    }
  }
  return 0;
}

export function detectRiseFall3Methods(bars: Bar[], i: number): number {
  if (i < 4) return 0;
  const b1 = bars[i - 4]!;
  const b2 = bars[i - 3]!;
  const b3 = bars[i - 2]!;
  const b4 = bars[i - 1]!;
  const b5 = bars[i]!;
  if (isBullish(b1) && bodySize(b1) > range(b1) * 0.5) {
    const allWithin = b2.high <= b1.high && b2.low >= b1.low &&
                      b3.high <= b1.high && b3.low >= b1.low &&
                      b4.high <= b1.high && b4.low >= b1.low;
    if (allWithin &&
        bodySize(b2) < bodySize(b1) * 0.5 &&
        bodySize(b3) < bodySize(b1) * 0.5 &&
        bodySize(b4) < bodySize(b1) * 0.5) {
      if (isBullish(b5) && b5.close > b1.close && bodySize(b5) > range(b5) * 0.4) {
        return 100;
      }
    }
  }
  if (isBearish(b1) && bodySize(b1) > range(b1) * 0.5) {
    const allWithin = b2.high <= b1.high && b2.low >= b1.low &&
                      b3.high <= b1.high && b3.low >= b1.low &&
                      b4.high <= b1.high && b4.low >= b1.low;
    if (allWithin &&
        bodySize(b2) < bodySize(b1) * 0.5 &&
        bodySize(b3) < bodySize(b1) * 0.5 &&
        bodySize(b4) < bodySize(b1) * 0.5) {
      if (isBearish(b5) && b5.close < b1.close && bodySize(b5) > range(b5) * 0.4) {
        return -100;
      }
    }
  }
  return 0;
}
