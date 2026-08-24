import {
  type Bar,
  type IndicatorPoint,
  ema,
  wma,
  wilderSmooth,
  toPoints,
} from "../math_primitives";

export function calcHMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const halfPeriod = Math.max(1, Math.floor(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const wmaHalf = wma(closes, halfPeriod);
  const wmaFull = wma(closes, period);
  const diff: number[] = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) {
    if (wmaHalf[i] !== null && wmaFull[i] !== null) {
      diff[i] = 2 * wmaHalf[i]! - wmaFull[i]!;
    } else if (wmaHalf[i] !== null) {
      diff[i] = wmaHalf[i]!;
    }
  }
  const hull = wma(diff, sqrtPeriod);
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (wmaFull[i] !== null && hull[i] !== null) {
      result[i] = hull[i]!;
    }
  }
  return toPoints(result, bars);
}

export function calcALMA(bars: Bar[], period: number, offset: number, sigma: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const m = offset * (period - 1);
  const s = period / sigma;
  const weights: number[] = new Array(period);
  let wSum = 0;
  for (let i = 0; i < period; i++) {
    weights[i] = Math.exp(-((i - m) ** 2) / (2 * s * s));
    wSum += weights[i]!;
  }
  for (let i = 0; i < period; i++) weights[i] = weights[i]! / wSum;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * weights[j]!;
    }
    result[i] = sum;
  }
  return toPoints(result, bars);
}

export function calcFWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const fibs: number[] = new Array(period);
  fibs[0] = 1;
  if (period > 1) fibs[1] = 1;
  for (let i = 2; i < period; i++) fibs[i] = fibs[i - 1]! + fibs[i - 2]!;
  let fibSum = 0;
  for (let i = 0; i < period; i++) fibSum += fibs[i]!;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * fibs[j]!;
    }
    result[i] = sum / fibSum;
  }
  return toPoints(result, bars);
}

export function calcPWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const row = period - 1;
  const weights: number[] = new Array(period);
  weights[0] = 1;
  for (let k = 1; k < period; k++) {
    weights[k] = weights[k - 1]! * (row - k + 1) / k;
  }
  let wSum = 0;
  for (let i = 0; i < period; i++) wSum += weights[i]!;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * weights[j]!;
    }
    result[i] = sum / wSum;
  }
  return toPoints(result, bars);
}

export function calcSINWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const weights: number[] = new Array(period);
  let wSum = 0;
  for (let i = 0; i < period; i++) {
    weights[i] = Math.sin(Math.PI * (i + 1) / (period + 1));
    wSum += weights[i]!;
  }
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * weights[j]!;
    }
    result[i] = sum / wSum;
  }
  return toPoints(result, bars);
}

export function calcSWMA(bars: Bar[]): IndicatorPoint[] {
  if (bars.length < 4) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 3; i < n; i++) {
    result[i] = (1 * closes[i - 3]! + 2 * closes[i - 2]! + 2 * closes[i - 1]! + 1 * closes[i]!) / 6;
  }
  return toPoints(result, bars);
}

export function calcVIDYA(bars: Bar[], period: number, cmoPeriod: number): IndicatorPoint[] { 
  if (bars.length === 0 || period < 1 || cmoPeriod < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const startIdx = Math.max(period - 1, cmoPeriod);
  if (n <= startIdx) return [];
  const k = 2 / (period + 1);
  let vidya = closes[startIdx]!;
  result[startIdx] = vidya;
  for (let i = startIdx + 1; i < n; i++) {
    let sumGains = 0;
    let sumLosses = 0;
    for (let j = i - cmoPeriod + 1; j <= i; j++) {
      const d = closes[j]! - closes[j - 1]!;
      if (d > 0) sumGains += d;
      else sumLosses += -d;
    }
    const cmo = (sumGains + sumLosses) !== 0 ? (sumGains - sumLosses) / (sumGains + sumLosses) : 0;
    const alpha = Math.abs(cmo) * k;
    vidya = alpha * closes[i]! + (1 - alpha) * vidya;
    result[i] = vidya;
  }
  return toPoints(result, bars);
}

export function calcVWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sumCV = 0;
    let sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const vol = bars[j]!.volume ?? 0;
      sumCV += bars[j]!.close * vol;
      sumV += vol;
    }
    if (sumV === 0) {
      let sumC = 0;
      for (let j = i - period + 1; j <= i; j++) sumC += bars[j]!.close;
      result[i] = sumC / period;
    } else {
      result[i] = sumCV / sumV;
    }
  }
  return toPoints(result, bars);
}

export function calcHWMA(bars: Bar[], na: number, nb: number, nc: number): IndicatorPoint[] { 
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  let F = closes[0]!;
  let V = 0;
  let A = 0;
  result[0] = F;
  for (let i = 1; i < n; i++) {
    const Fprev = F;
    F = Fprev + V + 0.5 * A;
    V = V + A;
    A = na * (closes[i]! - F) + nb * V + nc * A;
    result[i] = F;
  }
  return toPoints(result, bars);
}

export function calcMCGD(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  let md = closes[0]!;
  result[0] = md;
  for (let i = 1; i < n; i++) {
    const c = closes[i]!;
    if (md === 0) md = c;
    else {
      const ratio = c / md;
      const denom = period * (ratio ** 4);
      if (denom !== 0) md = md + (c - md) / denom;
    }
    result[i] = md;
  }
  return toPoints(result, bars);
}

export function calcJMA(bars: Bar[], period: number, phase: number, power: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  let phaseRatio: number;
  if (phase < -100) phaseRatio = 0.5;
  else if (phase > 100) phaseRatio = 2.5;
  else if (phase < 0) phaseRatio = 1.0 + phase / 200.0;
  else phaseRatio = 1.0 + phase * 1.5 / 100.0;
  const beta = 0.45 * (period - 1) / (0.45 * (period - 1) + 2);
  const alpha = beta ** power;
  let e0 = 0, e1 = 0, e2 = 0, jma = 0, initialized = false;
  for (let i = 0; i < n; i++) {
    const price = closes[i]!;
    if (!initialized) {
      e0 = price; e1 = 0; e2 = 0; jma = price; initialized = true;
      result[i] = jma; continue;
    }
    e0 = (1 - alpha) * price + alpha * e0;
    e1 = (price - e0) * (1 - beta) + beta * e1;
    e2 = (e0 + phaseRatio * e1 - jma) * ((1 - alpha) ** 2) + (alpha ** 2) * e2;
    jma = jma + e2; result[i] = jma;
  }
  for (let i = 0; i < Math.min(period, n); i++) result[i] = null;
  return toPoints(result, bars);
}

export function calcZLMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const ema1 = ema(closes, period);
  const ema1Nums = ema1.map(v => v ?? 0);
  const ema2 = ema(ema1Nums, period);
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (ema1[i] !== null && ema2[i] !== null) result[i] = 2 * ema1[i]! - ema2[i]!;
  }
  return toPoints(result, bars);
}

export function calcRMAOverlay(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const result = wilderSmooth(closes, period);
  return toPoints(result, bars);
}
