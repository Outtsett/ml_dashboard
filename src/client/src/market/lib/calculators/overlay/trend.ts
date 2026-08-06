import {
  type Bar,
  type IndicatorPoint,
  sma,
  wilderSmooth,
  trueRange,
  toPoints,
} from "../math_primitives";

export function calcSuperTrend(
  bars: Bar[],
  period: number,
  multiplier: number,
): { supertrend: IndicatorPoint[]; direction: IndicatorPoint[] } {
  const empty = { supertrend: [] as IndicatorPoint[], direction: [] as IndicatorPoint[] };    
  if (bars.length === 0 || period < 1) return empty;
  const n = bars.length;
  const tr = trueRange(bars);
  const atr = wilderSmooth(tr, period);
  const stValues: (number | null)[] = new Array(n).fill(null);
  const dirValues: (number | null)[] = new Array(n).fill(null);
  let prevFinalUpper = 0;
  let prevFinalLower = 0;
  let prevSuperTrend = 0;
  let started = false;
  for (let i = 0; i < n; i++) {
    if (atr[i] === null) continue;
    const hl2 = (bars[i]!.high + bars[i]!.low) / 2;
    const basicUpper = hl2 + multiplier * atr[i]!;
    const basicLower = hl2 - multiplier * atr[i]!;
    let finalUpper: number;
    let finalLower: number;
    if (!started) {
      finalUpper = basicUpper; finalLower = basicLower;
      started = true;
    } else {
      finalUpper = (basicUpper < prevFinalUpper || bars[i - 1]!.close > prevFinalUpper) ? basicUpper : prevFinalUpper;
      finalLower = (basicLower > prevFinalLower || bars[i - 1]!.close < prevFinalLower) ? basicLower : prevFinalLower;
    }
    let dir: number;
    if (prevSuperTrend === prevFinalUpper) {
      dir = bars[i]!.close > finalUpper ? 1 : -1;
    } else {
      dir = bars[i]!.close < finalLower ? -1 : 1;
    }
    stValues[i] = dir === 1 ? finalLower : finalUpper;
    dirValues[i] = dir;
    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevSuperTrend = stValues[i]!;
  }
  return {
    supertrend: toPoints(stValues, bars),
    direction: toPoints(dirValues, bars),
  };
}

export function calcHILO(bars: Bar[], highPeriod: number, lowPeriod: number): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const smaH = sma(highs, highPeriod);
  const smaL = sma(lows, lowPeriod);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  let trend = -1;
  for (let i = 0; i < n; i++) {
    if (smaH[i] === null || smaL[i] === null) continue;
    if (bars[i]!.close > smaH[i]!) trend = 1;
    else if (bars[i]!.close < smaL[i]!) trend = -1;
    result[i] = trend === 1 ? smaL[i]! : smaH[i]!;
  }
  return toPoints(result, bars);
}

export function calcSSF(bars: Bar[], period: number, poles: number): IndicatorPoint[] {       
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (poles === 3) {
    const a1 = Math.exp(-Math.PI / period);
    const b1 = 2 * a1 * Math.cos(1.738 * Math.PI / period);
    const c1 = a1 * a1;
    const coef2 = b1 + c1; const coef3 = -(c1 + b1 * c1); const coef4 = c1 * c1;
    const coef1 = 1 - coef2 - coef3 - coef4;
    const filt: number[] = new Array(n).fill(0);
    for (let i = 0; i < Math.min(3, n); i++) filt[i] = closes[i]!;
    for (let i = 3; i < n; i++) {
      filt[i] = coef1 * closes[i]! + coef2 * filt[i - 1]! + coef3 * filt[i - 2]! + coef4 * filt[i - 3]!;
    }
    for (let i = Math.min(period, n); i < n; i++) result[i] = filt[i]!;
  } else {
    const a1 = Math.exp(-Math.SQRT2 * Math.PI / period);
    const b1 = 2 * a1 * Math.cos(Math.SQRT2 * Math.PI / period);
    const c2 = b1; const c3 = -(a1 * a1);
    const c1 = 1 - c2 - c3;
    const filt: number[] = new Array(n).fill(0);
    for (let i = 0; i < Math.min(2, n); i++) filt[i] = closes[i]!;
    for (let i = 2; i < n; i++) {
      filt[i] = c1 * (closes[i]! + closes[i - 1]!) / 2 + c2 * filt[i - 1]! + c3 * filt[i - 2]!;
    }
    for (let i = Math.min(period, n); i < n; i++) result[i] = filt[i]!;
  }
  return toPoints(result, bars);
}
