import type { Bar, IndicatorPoint } from "../math_primitives";
import {
  sma,
  ema,
  wilderSmooth,
  rollingMax,
  rollingMin,
  toPoints,
  roc,
  percentRank,
} from "../math_primitives";
import { rsiFromValues, fillNulls } from "./utils";

/**
 * Connors RSI: (RSI(close, rsiP) + RSI(streak, streakP) + percentRank(close, rankP)) / 3.
 */
export function calcCRSI(
  bars: Bar[],
  rsiP = 3,
  streakP = 2,
  rankP = 100,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const streak: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i]! > closes[i - 1]!) {
      streak[i] = streak[i - 1]! > 0 ? streak[i - 1]! + 1 : 1;
    } else if (closes[i]! < closes[i - 1]!) {
      streak[i] = streak[i - 1]! < 0 ? streak[i - 1]! - 1 : -1;
    } else {
      streak[i] = 0;
    }
  }

  const rsiClose = rsiFromValues(closes, rsiP);
  const rsiStreak = rsiFromValues(streak, streakP);
  const pRank = percentRank(closes, rankP);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const rc = rsiClose[i];
    const rs = rsiStreak[i];
    const pr = pRank[i];
    if (rc != null && rs != null && pr != null) {
      result[i] = (rc + rs + pr) / 3;
    }
  }
  return toPoints(result, bars);
}

export function calcFisher(
  bars: Bar[],
  period = 9,
): { fisher: IndicatorPoint[]; trigger: IndicatorPoint[] } {
  const empty = { fisher: [] as IndicatorPoint[], trigger: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const n = bars.length;
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const hl2 = bars.map(b => (b.high + b.low) / 2);

  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const fisherArr: (number | null)[] = new Array(n).fill(null);
  const triggerArr: (number | null)[] = new Array(n).fill(null);

  let prevValue = 0;
  let prevFisher = 0;

  for (let i = 0; i < n; i++) {
    if (hh[i] == null || ll[i] == null) continue;
    const maxH = hh[i]!;
    const minL = ll[i]!;
    const range = maxH - minL;
    let x: number;
    if (range === 0) {
      x = 0;
    } else {
      x = 2 * ((hl2[i]! - minL) / range) - 1;
    }
    x = Math.max(-0.999, Math.min(0.999, x));
    const value = 0.5 * (x + prevValue);
    const clampedValue = Math.max(-0.999, Math.min(0.999, value));
    const fisher = 0.5 * Math.log((1 + clampedValue) / (1 - clampedValue)) + 0.5 * prevFisher;

    fisherArr[i] = fisher;
    triggerArr[i] = prevFisher;

    prevValue = value;
    prevFisher = fisher;
  }

  return {
    fisher: toPoints(fisherArr, bars),
    trigger: toPoints(triggerArr, bars),
  };
}

export function calcKST(
  bars: Bar[],
  roc1 = 10,
  roc2 = 15,
  roc3 = 20,
  roc4 = 30,
  sma1 = 10,
  sma2 = 10,
  sma3 = 10,
  sma4 = 15,
  signalP = 9,
): { kst: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { kst: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const r1 = fillNulls(roc(closes, roc1));
  const r2 = fillNulls(roc(closes, roc2));
  const r3 = fillNulls(roc(closes, roc3));
  const r4 = fillNulls(roc(closes, roc4));

  const s1 = sma(r1, sma1);
  const s2 = sma(r2, sma2);
  const s3 = sma(r3, sma3);
  const s4 = sma(r4, sma4);

  const kstArr: (number | null)[] = new Array(n).fill(null);
  const minReq = Math.max(roc1 + sma1, roc2 + sma2, roc3 + sma3, roc4 + sma4) - 1;
  for (let i = 0; i < n; i++) {
    if (i >= minReq && s1[i] != null && s2[i] != null && s3[i] != null && s4[i] != null) {
      kstArr[i] = 1 * s1[i]! + 2 * s2[i]! + 3 * s3[i]! + 4 * s4[i]!;
    }
  }

  const kstFilled = fillNulls(kstArr);
  const sig = sma(kstFilled, signalP);
  const sigResult: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (kstArr[i] != null && sig[i] != null && i >= minReq + signalP - 1) {
      sigResult[i] = sig[i]!;
    }
  }

  return {
    kst: toPoints(kstArr, bars),
    signal: toPoints(sigResult, bars),
  };
}

export function calcQQE(
  bars: Bar[],
  rsiPeriod = 14,
  smoothFactor = 5,
  qqeFactor = 4.236,
): { qqe: IndicatorPoint[]; rsiSmooth: IndicatorPoint[]; upper: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = {
    qqe: [] as IndicatorPoint[],
    rsiSmooth: [] as IndicatorPoint[],
    upper: [] as IndicatorPoint[],
    lower: [] as IndicatorPoint[],
  };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const rsiArr = rsiFromValues(closes, rsiPeriod);
  const rsiFilled = fillNulls(rsiArr);
  const rsiSmooth = ema(rsiFilled, smoothFactor);

  const rsiSmoothFilled = fillNulls(rsiSmooth);
  const absDiff: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    absDiff[i] = Math.abs(rsiSmoothFilled[i]! - rsiSmoothFilled[i - 1]!);
  }

  const atrRsi = wilderSmooth(absDiff, rsiPeriod * 2 - 1);
  const atrRsiFilled = fillNulls(atrRsi);
  const maAtrRsi = wilderSmooth(atrRsiFilled, rsiPeriod * 2 - 1);

  const qqeArr: (number | null)[] = new Array(n).fill(null);
  const upperArr: (number | null)[] = new Array(n).fill(null);
  const lowerArr: (number | null)[] = new Array(n).fill(null);

  let longBand = 0;
  let shortBand = 0;
  let prevTrend = 0;

  for (let i = 0; i < n; i++) {
    if (rsiSmooth[i] == null || maAtrRsi[i] == null) continue;
    const rs = rsiSmooth[i]!;
    const dar = maAtrRsi[i]! * qqeFactor;

    const newShortBand = rs + dar;
    const newLongBand = rs - dar;

    if (i > 0 && rsiSmooth[i - 1] != null) {
      const prevRs = rsiSmooth[i - 1]!;
      if (prevRs > longBand && rs > longBand) {
        longBand = Math.max(longBand, newLongBand);
      } else {
        longBand = newLongBand;
      }
      if (prevRs < shortBand && rs < shortBand) {
        shortBand = Math.min(shortBand, newShortBand);
      } else {
        shortBand = newShortBand;
      }
    } else {
      longBand = newLongBand;
      shortBand = newShortBand;
    }

    let trend: number;
    if (rs > shortBand) {
      trend = 1;
    } else if (rs < longBand) {
      trend = -1;
    } else {
      trend = prevTrend;
    }

    const qqeLine = trend === 1 ? longBand : shortBand;
    qqeArr[i] = qqeLine;
    upperArr[i] = shortBand;
    lowerArr[i] = longBand;

    prevTrend = trend;
  }

  return {
    qqe: toPoints(qqeArr, bars),
    rsiSmooth: toPoints(rsiSmooth, bars),
    upper: toPoints(upperArr, bars),
    lower: toPoints(lowerArr, bars),
  };
}

export function calcRVGI(
  bars: Bar[],
  period = 10,
  signalP = 4,
): { rvgi: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { rvgi: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const n = bars.length;

  const num: number[] = new Array(n).fill(0);
  const den: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    num[i] = bars[i]!.close - bars[i]!.open;
    const hl = bars[i]!.high - bars[i]!.low;
    den[i] = hl === 0 ? 1e-10 : hl;
  }

  const smoothNum: number[] = new Array(n).fill(0);
  const smoothDen: number[] = new Array(n).fill(0);
  for (let i = 3; i < n; i++) {
    smoothNum[i] = (num[i]! + 2 * num[i - 1]! + 2 * num[i - 2]! + num[i - 3]!) / 6;
    smoothDen[i] = (den[i]! + 2 * den[i - 1]! + 2 * den[i - 2]! + den[i - 3]!) / 6;
  }

  const ratio: number[] = new Array(n).fill(0);
  for (let i = 3; i < n; i++) {
    ratio[i] = smoothDen[i] !== 0 ? smoothNum[i]! / smoothDen[i]! : 0;
  }
  const rvgiArr = sma(ratio, period);

  const rvgiFilled = fillNulls(rvgiArr);
  const sigArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 3; i < n; i++) {
    if (rvgiArr[i] != null && rvgiArr[i - 1] != null && rvgiArr[i - 2] != null && rvgiArr[i - 3] != null) {
      sigArr[i] = (rvgiFilled[i]! + 2 * rvgiFilled[i - 1]! + 2 * rvgiFilled[i - 2]! + rvgiFilled[i - 3]!) / 6;
    }
  }

  return {
    rvgi: toPoints(rvgiArr, bars),
    signal: toPoints(sigArr, bars),
  };
}

export function calcTSI(
  bars: Bar[],
  longP = 25,
  shortP = 13,
  signalP = 13,
): { tsi: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { tsi: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const mom: number[] = new Array(n).fill(0);
  const absMom: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    mom[i] = closes[i]! - closes[i - 1]!;
    absMom[i] = Math.abs(mom[i]!);
  }

  const ema1Mom = ema(mom, longP);
  const ema2Mom = ema(fillNulls(ema1Mom), shortP);
  const ema1Abs = ema(absMom, longP);
  const ema2Abs = ema(fillNulls(ema1Abs), shortP);

  const tsiArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const num = ema2Mom[i];
    const den = ema2Abs[i];
    if (num != null && den != null && den !== 0) {
      tsiArr[i] = 100 * num / den;
    }
  }

  const tsiFilled = fillNulls(tsiArr);
  const sigArr = ema(tsiFilled, signalP);
  const sigResult: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (tsiArr[i] != null && sigArr[i] != null) {
      sigResult[i] = sigArr[i]!;
    }
  }

  return {
    tsi: toPoints(tsiArr, bars),
    signal: toPoints(sigResult, bars),
  };
}

export function calcSMI(
  bars: Bar[],
  period = 14,
  smoothP = 3,
  signalP = 3,
): { smi: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { smi: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const n = bars.length;

  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const diffArr: number[] = new Array(n).fill(0);
  const rangeArr: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (hh[i] != null && ll[i] != null) {
      diffArr[i] = closes[i]! - (hh[i]! + ll[i]!) / 2;
      rangeArr[i] = hh[i]! - ll[i]!;
    }
  }

  const smoothDiff1 = ema(diffArr, smoothP);
  const smoothDiff2 = ema(fillNulls(smoothDiff1), smoothP);
  const smoothRange1 = ema(rangeArr, smoothP);
  const smoothRange2 = ema(fillNulls(smoothRange1), smoothP);

  const smiArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const d = smoothDiff2[i];
    const r = smoothRange2[i];
    if (d != null && r != null && r !== 0) {
      smiArr[i] = 100 * d / (0.5 * r);
    }
  }

  const smiFilled = fillNulls(smiArr);
  const sig = ema(smiFilled, signalP);
  const sigResult: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (smiArr[i] != null && sig[i] != null) {
      sigResult[i] = sig[i]!;
    }
  }

  return {
    smi: toPoints(smiArr, bars),
    signal: toPoints(sigResult, bars),
  };
}

export function calcKDJ(
  bars: Bar[],
  period = 9,
  signalP = 3,
): { k: IndicatorPoint[]; d: IndicatorPoint[]; j: IndicatorPoint[] } {
  const empty = { k: [] as IndicatorPoint[], d: [] as IndicatorPoint[], j: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);
  const n = bars.length;

  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const rawK: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (hh[i] != null && ll[i] != null) {
      const range = hh[i]! - ll[i]!;
      rawK[i] = range !== 0 ? ((closes[i]! - ll[i]!) / range) * 100 : 50;
    }
  }

  const kArr = sma(rawK, signalP);
  const kFilled = fillNulls(kArr);
  const dArr = sma(kFilled, signalP);

  const jArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (kArr[i] != null && dArr[i] != null) {
      jArr[i] = 3 * kArr[i]! - 2 * dArr[i]!;
    }
  }

  return {
    k: toPoints(kArr, bars),
    d: toPoints(dArr, bars),
    j: toPoints(jArr, bars),
  };
}

export function calcRSX(bars: Bar[], period = 14): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < 2) return toPoints(result, bars);

  const f10 = Math.ceil(Math.sqrt(period));
  const f18 = 3 / (period + 2);
  const f20 = 1 - f18;

  let f28 = 0, f30 = 0;
  let f38 = 0, f40 = 0, f48 = 0, f50 = 0;
  let f58 = 0, f60 = 0, f68 = 0, f70 = 0;
  let f78 = 0, f80 = 0;

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      f28 = 0;
      f30 = 0;
      continue;
    }

    const mom = closes[i]! - closes[i - 1]!;
    const momAbs = Math.abs(mom);

    f28 = f20 * f28 + f18 * mom;
    f30 = f18 * f28 + f20 * f30;
    const v4 = 1.5 * f28 - 0.5 * f30;

    f38 = f20 * f38 + f18 * momAbs;
    f40 = f18 * f38 + f20 * f40;
    const v8 = 1.5 * f38 - 0.5 * f40;

    f48 = f20 * f48 + f18 * v4;
    f50 = f18 * f48 + f20 * f50;
    const v10 = 1.5 * f48 - 0.5 * f50;

    f58 = f20 * f58 + f18 * v8;
    f60 = f18 * f58 + f20 * f60;
    const v14 = 1.5 * f58 - 0.5 * f60;

    f68 = f20 * f68 + f18 * v10;
    f70 = f18 * f68 + f20 * f70;
    const v18 = 1.5 * f68 - 0.5 * f70;

    f78 = f20 * f78 + f18 * v14;
    f80 = f18 * f78 + f20 * f80;
    const v20 = 1.5 * f78 - 0.5 * f80;

    if (i < f10 || v20 === 0) continue;
    const rsx = Math.max(0, Math.min(100, (v18 / v20 + 1) * 50));
    result[i] = rsx;
  }

  return toPoints(result, bars);
}
