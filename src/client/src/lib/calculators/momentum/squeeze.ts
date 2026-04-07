import type { Bar, IndicatorPoint } from "../math_primitives";
import {
  sma,
  ema,
  wilderSmooth,
  stddev,
  trueRange,
  toPoints,
  linregCore,
} from "../math_primitives";

export function calcSqueeze(
  bars: Bar[],
  bbP = 20,
  bbMult = 2,
  kcP = 20,
  kcMult = 1.5,
): { momentum: IndicatorPoint[]; squeeze: IndicatorPoint[] } {
  const empty = { momentum: [] as IndicatorPoint[], squeeze: [] as IndicatorPoint[] };        
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const n = bars.length;

  const bbMid = sma(closes, bbP);
  const bbStd = stddev(closes, bbP);
  const kcMid = ema(closes, kcP);
  const atr = wilderSmooth(tr, kcP);

  const squeezeArr: (number | null)[] = new Array(n).fill(null);
  const delta: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    if (bbMid[i] == null || bbStd[i] == null || kcMid[i] == null || atr[i] == null) continue; 

    const bbUpper = bbMid[i]! + bbMult * bbStd[i]!;
    const bbLower = bbMid[i]! - bbMult * bbStd[i]!;
    const kcUpper = kcMid[i]! + kcMult * atr[i]!;
    const kcLower = kcMid[i]! - kcMult * atr[i]!;

    squeezeArr[i] = (bbLower > kcLower && bbUpper < kcUpper) ? 1 : 0;
    delta[i] = closes[i]! - (bbMid[i]! + kcMid[i]!) / 2;
  }

  const { slope, intercept } = linregCore(delta, kcP);
  const momArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (slope[i] != null && intercept[i] != null && squeezeArr[i] != null) {
      momArr[i] = intercept[i]! + slope[i]! * (kcP - 1);
    }
  }

  return {
    momentum: toPoints(momArr, bars),
    squeeze: toPoints(squeezeArr, bars),
  };
}

export function calcSqueezePro(
  bars: Bar[],
  bbP = 20,
  bbMult = 2,
  kcPn = 20,
  kcMultN = 1,
  kcMultM = 1.5,
  kcMultW = 2,
): { momentum: IndicatorPoint[]; squeeze: IndicatorPoint[] } {
  const empty = { momentum: [] as IndicatorPoint[], squeeze: [] as IndicatorPoint[] };        
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const n = bars.length;

  const bbMid = sma(closes, bbP);
  const bbStd = stddev(closes, bbP);
  const kcMid = ema(closes, kcPn);
  const atr = wilderSmooth(tr, kcPn);

  const squeezeArr: (number | null)[] = new Array(n).fill(null);
  const delta: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    if (bbMid[i] == null || bbStd[i] == null || kcMid[i] == null || atr[i] == null) continue; 

    const bbUpper = bbMid[i]! + bbMult * bbStd[i]!;
    const bbLower = bbMid[i]! - bbMult * bbStd[i]!;

    const kcUpperN = kcMid[i]! + kcMultN * atr[i]!;
    const kcLowerN = kcMid[i]! - kcMultN * atr[i]!;
    const kcUpperM = kcMid[i]! + kcMultM * atr[i]!;
    const kcLowerM = kcMid[i]! - kcMultM * atr[i]!;
    const kcUpperW = kcMid[i]! + kcMultW * atr[i]!;
    const kcLowerW = kcMid[i]! - kcMultW * atr[i]!;

    if (bbLower > kcLowerN && bbUpper < kcUpperN) {
      squeezeArr[i] = 3;
    } else if (bbLower > kcLowerM && bbUpper < kcUpperM) {
      squeezeArr[i] = 2;
    } else if (bbLower > kcLowerW && bbUpper < kcUpperW) {
      squeezeArr[i] = 1;
    } else {
      squeezeArr[i] = 0;
    }

    delta[i] = closes[i]! - (bbMid[i]! + kcMid[i]!) / 2;
  }

  const { slope, intercept } = linregCore(delta, kcPn);
  const momArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (slope[i] != null && intercept[i] != null && squeezeArr[i] != null) {
      momArr[i] = intercept[i]! + slope[i]! * (kcPn - 1);
    }
  }

  return {
    momentum: toPoints(momArr, bars),
    squeeze: toPoints(squeezeArr, bars),
  };
}
