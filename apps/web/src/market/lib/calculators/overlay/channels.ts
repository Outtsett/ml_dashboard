import {
  type Bar,
  type IndicatorPoint,
  sma,
  ema,
  wilderSmooth,
  rollingMax,
  rollingMin,
  trueRange,
  toPoints,
} from "../math_primitives";

export function calcKeltnerChannels(
  bars: Bar[],
  emaPeriod: number,
  atrPeriod: number,
  multiplier: number,
): { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = { upper: [] as IndicatorPoint[], middle: [] as IndicatorPoint[], lower: [] as IndicatorPoint[] };
  if (bars.length === 0 || emaPeriod < 1 || atrPeriod < 1) return empty;

  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const atr = wilderSmooth(tr, atrPeriod);
  const mid = ema(closes, emaPeriod);

  const upper: (number | null)[] = new Array(bars.length).fill(null);
  const lower: (number | null)[] = new Array(bars.length).fill(null);
  const middle: (number | null)[] = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i++) {
    if (mid[i] !== null && atr[i] !== null) {
      middle[i] = mid[i]!;
      upper[i] = mid[i]! + multiplier * atr[i]!;
      lower[i] = mid[i]! - multiplier * atr[i]!;
    }
  }

  return {
    upper: toPoints(upper, bars),
    middle: toPoints(middle, bars),
    lower: toPoints(lower, bars),
  };
}

export function calcDonchianChannels(
  bars: Bar[],
  period: number,
): { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = { upper: [] as IndicatorPoint[], middle: [] as IndicatorPoint[], lower: [] as IndicatorPoint[] };
  if (bars.length === 0 || period < 1) return empty;

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const upper: (number | null)[] = new Array(bars.length).fill(null);
  const middle: (number | null)[] = new Array(bars.length).fill(null);
  const lower: (number | null)[] = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i++) {
    if (hh[i] !== null && ll[i] !== null) {
      upper[i] = hh[i]!;
      lower[i] = ll[i]!;
      middle[i] = (hh[i]! + ll[i]!) / 2;
    }
  }

  return {
    upper: toPoints(upper, bars),
    middle: toPoints(middle, bars),
    lower: toPoints(lower, bars),
  };
}

export function calcIchimoku(
  bars: Bar[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouPeriod: number,
): {
  tenkan: IndicatorPoint[];
  kijun: IndicatorPoint[];
  senkouA: IndicatorPoint[];
  senkouB: IndicatorPoint[];
  chikou: IndicatorPoint[];
} {
  const empty = {
    tenkan: [] as IndicatorPoint[],
    kijun: [] as IndicatorPoint[],
    senkouA: [] as IndicatorPoint[],
    senkouB: [] as IndicatorPoint[],
    chikou: [] as IndicatorPoint[],
  };
  if (bars.length === 0) return empty;

  const n = bars.length;
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);

  const hhTenkan = rollingMax(highs, tenkanPeriod);
  const llTenkan = rollingMin(lows, tenkanPeriod);
  const hhKijun = rollingMax(highs, kijunPeriod);
  const llKijun = rollingMin(lows, kijunPeriod);
  const hhSenkou = rollingMax(highs, senkouPeriod);
  const llSenkou = rollingMin(lows, senkouPeriod);

  const tenkanVals: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hhTenkan[i] !== null && llTenkan[i] !== null) {
      tenkanVals[i] = (hhTenkan[i]! + llTenkan[i]!) / 2;
    }
  }

  const kijunVals: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hhKijun[i] !== null && llKijun[i] !== null) {
      kijunVals[i] = (hhKijun[i]! + llKijun[i]!) / 2;
    }
  }

  const senkouBBase: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hhSenkou[i] !== null && llSenkou[i] !== null) {
      senkouBBase[i] = (hhSenkou[i]! + llSenkou[i]!) / 2;
    }
  }

  const tenkan = toPoints(tenkanVals, bars);
  const kijun = toPoints(kijunVals, bars);

  const senkouA: IndicatorPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (tenkanVals[i] !== null && kijunVals[i] !== null) {
      const futureIdx = i + kijunPeriod;
      let ts: number;
      if (futureIdx < n) {
        ts = bars[futureIdx]!.timestamp;
      } else {
        const lastTs = bars[n - 1]!.timestamp;
        const avgSpacing = n > 1 ? (bars[n - 1]!.timestamp - bars[0]!.timestamp) / (n - 1) : 1;
        ts = lastTs + (futureIdx - n + 1) * avgSpacing;
      }
      const time = ts > 1e12 ? Math.floor(ts / 1000) : ts;
      senkouA.push({ time, value: (tenkanVals[i]! + kijunVals[i]!) / 2 });
    }
  }

  const senkouB: IndicatorPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (senkouBBase[i] !== null) {
      const futureIdx = i + kijunPeriod;
      let ts: number;
      if (futureIdx < n) {
        ts = bars[futureIdx]!.timestamp;
      } else {
        const lastTs = bars[n - 1]!.timestamp;
        const avgSpacing = n > 1 ? (bars[n - 1]!.timestamp - bars[0]!.timestamp) / (n - 1) : 1;
        ts = lastTs + (futureIdx - n + 1) * avgSpacing;
      }
      const time = ts > 1e12 ? Math.floor(ts / 1000) : ts;
      senkouB.push({ time, value: senkouBBase[i]! });
    }
  }

  const chikou: IndicatorPoint[] = [];
  for (let i = kijunPeriod; i < n; i++) {
    const pastIdx = i - kijunPeriod;
    const ts = bars[pastIdx]!.timestamp;
    const time = ts > 1e12 ? Math.floor(ts / 1000) : ts;
    chikou.push({ time, value: bars[i]!.close });
  }

  return { tenkan, kijun, senkouA, senkouB, chikou };
}

export function calcAccBands(
  bars: Bar[],
  period: number,
): { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = { upper: [] as IndicatorPoint[], middle: [] as IndicatorPoint[], lower: [] as IndicatorPoint[] };
  if (bars.length === 0 || period < 1) return empty;

  const n = bars.length;
  const upperRaw: number[] = new Array(n);
  const lowerRaw: number[] = new Array(n);
  const closes = bars.map(b => b.close);

  for (let i = 0; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const hl = h + l;
    const bandwidth = hl !== 0 ? 4 * (h - l) / hl : 0;
    upperRaw[i] = h * (1 + bandwidth);
    lowerRaw[i] = l * (1 - bandwidth);
  }

  const upper = sma(upperRaw, period);
  const middle = sma(closes, period);
  const lower = sma(lowerRaw, period);

  return {
    upper: toPoints(upper, bars),
    middle: toPoints(middle, bars),
    lower: toPoints(lower, bars),
  };
}
