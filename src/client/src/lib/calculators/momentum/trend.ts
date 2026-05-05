import type { Bar, IndicatorPoint } from "../math_primitives";
import {
  ema,
  stddev,
  toPoints,
  linregCore,
  rollingMax,
  rollingMin,
} from "../math_primitives";
import { rsiFromValues, fillNulls } from "./utils";

export function calcInertia(
  bars: Bar[],
  period = 20,
  rviPeriod = 14,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const sd = stddev(closes, rviPeriod);
  const sdFilled = fillNulls(sd);
  const rviValues = rsiFromValues(sdFilled, rviPeriod);

  const rviFilled = fillNulls(rviValues);
  const { slope, intercept } = linregCore(rviFilled, period);
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (slope[i] != null && intercept[i] != null && rviValues[i] != null) {
      result[i] = intercept[i]! + slope[i]! * (period - 1);
    }
  }
  return toPoints(result, bars);
}

export function calcSTC(
  bars: Bar[],
  period = 10,
  fastP = 23,
  slowP = 50,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const fastEma = ema(closes, fastP);
  const slowEma = ema(closes, slowP);
  const macdLine: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (fastEma[i] != null && slowEma[i] != null) {
      macdLine[i] = fastEma[i]! - slowEma[i]!;
    }
  }

  const macdHH = rollingMax(macdLine, period);
  const macdLL = rollingMin(macdLine, period);

  const pf: number[] = new Array(n).fill(0);
  let prevPf = 0;
  for (let i = 0; i < n; i++) {
    if (macdHH[i] == null || macdLL[i] == null) continue;
    const range = macdHH[i]! - macdLL[i]!;
    const fastK = range !== 0 ? ((macdLine[i]! - macdLL[i]!) / range) * 100 : prevPf;
    prevPf = prevPf + 0.5 * (fastK - prevPf);
    pf[i] = prevPf;
  }

  const pfHH = rollingMax(pf, period);
  const pfLL = rollingMin(pf, period);

  const stcArr: (number | null)[] = new Array(n).fill(null);
  let prevStc = 0;
  for (let i = 0; i < n; i++) {
    if (pfHH[i] == null || pfLL[i] == null) continue;
    const range = pfHH[i]! - pfLL[i]!;
    const fastK = range !== 0 ? ((pf[i]! - pfLL[i]!) / range) * 100 : prevStc;
    prevStc = prevStc + 0.5 * (fastK - prevStc);
    stcArr[i] = prevStc;
  }

  return toPoints(stcArr, bars);
}
