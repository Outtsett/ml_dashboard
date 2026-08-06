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
  upperWick,
  lowerWick,
  trendDirection,
  approxEqual
} from './helpers';

export function detectMorningStar(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
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

export function detectEveningStar(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
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

export function detectThreeWhiteSoldiers(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
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

export function detectThreeBlackCrows(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
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

export function detectThreeInsideUp(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (isBearish(first) && isBullish(second) &&
      bodySize(first) > bodySize(second) &&
      second.open >= first.close && second.close <= first.open &&
      isBullish(third) && third.close > first.open) {
    return 100;
  }
  return 0;
}

export function detectThreeInsideDown(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (isBullish(first) && isBearish(second) &&
      bodySize(first) > bodySize(second) &&
      second.open <= first.close && second.close >= first.open &&
      isBearish(third) && third.close < first.open) {
    return -100;
  }
  return 0;
}

export function detect2Crows(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (!isBullish(first) || bodySize(first) < range(first) * 0.5) return 0;
  if (!isBearish(second)) return 0;
  if (second.open <= first.close) return 0;
  if (!isBearish(third)) return 0;
  if (third.open < bodyBottom(second) || third.open > bodyTop(second)) return 0;
  if (third.close < bodyBottom(first) || third.close > bodyTop(first)) return 0;
  const trend = trendDirection(bars, i - 2);
  if (trend === 'up') return -100;
  return 0;
}

export function detect3Outside(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (isBearish(first) && isBullish(second) &&
      second.open <= first.close && second.close >= first.open &&
      isBullish(third) && third.close > second.close) {
    return 100;
  }
  if (isBullish(first) && isBearish(second) &&
      second.open >= first.close && second.close <= first.open &&
      isBearish(third) && third.close < second.close) {
    return -100;
  }
  return 0;
}

export function detectMorningDojiStar(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  const firstBody = bodySize(first);
  const firstRange = range(first);
  if (firstRange === 0) return 0;
  if (!isBearish(first) || firstBody < firstRange * 0.3) return 0;
  if (!isDoji(second)) return 0;
  if (bodyTop(second) >= bodyBottom(first)) return 0;
  if (!isBullish(third) || third.close <= bodyMidpoint(first)) return 0;
  return 100;
}

export function detectEveningDojiStar(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  const firstBody = bodySize(first);
  const firstRange = range(first);
  if (firstRange === 0) return 0;
  if (!isBullish(first) || firstBody < firstRange * 0.3) return 0;
  if (!isDoji(second)) return 0;
  if (bodyBottom(second) <= bodyTop(first)) return 0;
  if (!isBearish(third) || third.close >= bodyMidpoint(first)) return 0;
  return -100;
}

export function detectIdentical3Crows(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (!isBearish(first) || !isBearish(second) || !isBearish(third)) return 0;
  if (second.close >= first.close || third.close >= second.close) return 0;
  if (!approxEqual(second.open, first.close, 0.003)) return 0;
  if (!approxEqual(third.open, second.close, 0.003)) return 0;
  if (bodySize(first) < range(first) * 0.5 ||
      bodySize(second) < range(second) * 0.5 ||
      bodySize(third) < range(third) * 0.5) return 0;
  return -100;
}

export function detectAdvanceBlock(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (!isBullish(first) || !isBullish(second) || !isBullish(third)) return 0;
  if (second.close <= first.close || third.close <= second.close) return 0;
  const b1 = bodySize(first);
  const b2 = bodySize(second);
  const b3 = bodySize(third);
  if (b2 >= b1 || b3 >= b2) return 0;
  const u1 = upperWick(first);
  const u2 = upperWick(second);
  const u3 = upperWick(third);
  if (u2 <= u1 || u3 <= u2) return 0;
  const trend = trendDirection(bars, i - 2);
  if (trend === 'up') return -100;
  return 0;
}

export function detectStalledPattern(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (!isBullish(first) || !isBullish(second) || !isBullish(third)) return 0;
  if (second.close <= first.close || third.close <= second.close) return 0;
  const b1 = bodySize(first);
  const b2 = bodySize(second);
  const b3 = bodySize(third);
  if (b1 < range(first) * 0.4 || b2 < range(second) * 0.4) return 0;
  if (b3 >= b2 * 0.5) return 0;
  if (upperWick(third) < b3) return 0;
  return -100;
}

export function detectStickSandwich(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (!isBearish(first) || !isBullish(second) || !isBearish(third)) return 0;
  if (!approxEqual(first.close, third.close, 0.003)) return 0;
  if (second.close <= first.close || second.close <= third.close) return 0;
  return 100;
}

export function detect3StarsInSouth(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (!isBearish(first) || !isBearish(second) || !isBearish(third)) return 0;
  if (second.close >= first.close || third.close >= second.close) return 0;
  const b1 = bodySize(first);
  const b2 = bodySize(second);
  const b3 = bodySize(third);
  if (b2 >= b1 || b3 >= b2) return 0;
  if (lowerWick(first) < b1 * 0.5) return 0;
  if (lowerWick(second) >= lowerWick(first)) return 0;
  if (range(third) >= range(first) * 0.5) return 0;
  if (b3 < range(third) * 0.6) return 0;
  const trend = trendDirection(bars, i - 2);
  if (trend === 'down') return 100;
  return 0;
}

export function detectTasukiGap(bars: Bar[], i: number): number {
  if (i < 2) return 0;
  const first = bars[i - 2]!;
  const second = bars[i - 1]!;
  const third = bars[i]!;
  if (isBullish(first) && isBullish(second)) {
    if (second.low > first.high) {
      if (isBearish(third) &&
          third.open >= bodyBottom(second) && third.open <= bodyTop(second) &&
          third.close < second.low && third.close > first.high) {
        return 100;
      }
    }
  }
  if (isBearish(first) && isBearish(second)) {
    if (second.high < first.low) {
      if (isBullish(third) &&
          third.open >= bodyBottom(second) && third.open <= bodyTop(second) &&
          third.close > second.high && third.close < first.low) {
        return -100;
      }
    }
  }
  return 0;
}
