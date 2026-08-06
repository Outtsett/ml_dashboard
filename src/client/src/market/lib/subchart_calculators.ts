/**
 * Client-side subchart indicator calculators.
 * 
 * This file acts as a barrel file for modularized subchart calculators
 * and provides computeSubchart() — a column-name dispatcher for legacy
 * TA-Lib–style column names (e.g. RSI_14, MACD_12_26_9, ATR_14).
 */

export * from './calculators/math_primitives';
export * from './calculators/subchart/momentum';
export * from './calculators/subchart/trend';
export * from './calculators/subchart/volatility';
export * from './calculators/subchart/volume';
export * from './calculators/subchart/statistics';
export * from './calculators/subchart/performance';
export * from './calculators/subchart/cycle';

import { type Bar, type IndicatorPoint, toPoints } from './calculators/math_primitives';
import {
  calcRSI, calcMACD, calcStochastic, calcStochasticFast, calcStochRSI,
  calcCCI, calcWilliamsR, calcMomentum, calcROC, calcROCP, calcROCR,
  calcROCR100, calcCMO, calcMFI, calcAPO, calcPPO, calcBOP,
  calcUltimateOscillator, calcTRIX,
} from './calculators/subchart/momentum';
import {
  calcDirectionalMovement, calcADXR, calcAroon, calcAroonOsc,
} from './calculators/subchart/trend';
import { calcTrueRange, calcATR, calcNATR } from './calculators/subchart/volatility';
import { calcOBV, calcAD, calcADOSC } from './calculators/subchart/volume';
import {
  calcStdDev as calcSubStdDev, calcVariance, calcLinregSlope,
  calcLinregAngle, calcLinregIntercept,
} from './calculators/subchart/statistics';

/**
 * Parse a legacy column name (e.g. "RSI_14", "MACD_12_26_9") and compute
 * the indicator from raw OHLCV bars. Returns null for unrecognized names.
 */
export function computeSubchart(
  column: string,
  bars: { timestamp: number; open: number; high: number; low: number; close: number; volume?: number }[],
): IndicatorPoint[] | null {
  if (bars.length === 0) return null;

  const calcBars: Bar[] = bars.map(b => ({
    timestamp: b.timestamp, open: b.open, high: b.high,
    low: b.low, close: b.close, volume: b.volume,
  }));
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const col = column.toUpperCase();

  let values: (number | null)[] | null = null;

  // ── Momentum ───────────────────────────────────────────────────────
  const rsiM = col.match(/^RSI_(\d+)$/);
  if (rsiM) values = calcRSI(closes, +rsiM[1]!);

  const macdM = col.match(/^MACD(?:_(\d+)_(\d+)_(\d+))?$/);
  if (!values && macdM) {
    const r = calcMACD(closes, +(macdM[1] ?? 12), +(macdM[2] ?? 26), +(macdM[3] ?? 9));
    values = r.macd;
  }
  if (!values && col.match(/^MACDSIGNAL/)) {
    const r = calcMACD(closes, 12, 26, 9);
    values = r.signal;
  }
  if (!values && col.match(/^MACDHIST/)) {
    const r = calcMACD(closes, 12, 26, 9);
    values = r.histogram;
  }

  const stochKM = col.match(/^STOCH_K_(\d+)_(\d+)_(\d+)$/);
  if (!values && stochKM) {
    const r = calcStochastic(highs, lows, closes, +stochKM[1]!, +stochKM[2]!, +stochKM[3]!);
    values = r.k;
  }
  const stochDM = col.match(/^STOCH_D_(\d+)_(\d+)_(\d+)$/);
  if (!values && stochDM) {
    const r = calcStochastic(highs, lows, closes, +stochDM[1]!, +stochDM[2]!, +stochDM[3]!);
    values = r.d;
  }

  const stochfKM = col.match(/^STOCHF_K_(\d+)_(\d+)$/);
  if (!values && stochfKM) {
    const r = calcStochasticFast(highs, lows, closes, +stochfKM[1]!, +stochfKM[2]!);
    values = r.k;
  }

  const stochrsiM = col.match(/^STOCHRSI_(\d+)$/);
  if (!values && stochrsiM) {
    const period = +stochrsiM[1]!;
    const r = calcStochRSI(closes, period, period, 3, 3);
    values = r.k;
  }

  const cciM = col.match(/^CCI_(\d+)$/);
  if (!values && cciM) values = calcCCI(highs, lows, closes, +cciM[1]!);

  const willrM = col.match(/^WILLR_(\d+)$/);
  if (!values && willrM) values = calcWilliamsR(highs, lows, closes, +willrM[1]!);

  const momM = col.match(/^MOM_(\d+)$/);
  if (!values && momM) values = calcMomentum(closes, +momM[1]!);

  const rocM = col.match(/^ROC_(\d+)$/);
  if (!values && rocM) values = calcROC(closes, +rocM[1]!);

  const rocpM = col.match(/^ROCP_(\d+)$/);
  if (!values && rocpM) values = calcROCP(closes, +rocpM[1]!);

  const rocrM = col.match(/^ROCR_(\d+)$/);
  if (!values && rocrM) values = calcROCR(closes, +rocrM[1]!);

  const rocr100M = col.match(/^ROCR100_(\d+)$/);
  if (!values && rocr100M) values = calcROCR100(closes, +rocr100M[1]!);

  const cmoM = col.match(/^CMO_(\d+)$/);
  if (!values && cmoM) values = calcCMO(closes, +cmoM[1]!);

  const mfiM = col.match(/^MFI_(\d+)$/);
  if (!values && mfiM) values = calcMFI(highs, lows, closes, bars.map(b => b.volume ?? 0), +mfiM[1]!);

  const apoM = col.match(/^APO_(\d+)_(\d+)$/);
  if (!values && apoM) values = calcAPO(closes, +apoM[1]!, +apoM[2]!);

  const ppoM = col.match(/^PPO_(\d+)_(\d+)$/);
  if (!values && ppoM) values = calcPPO(closes, +ppoM[1]!, +ppoM[2]!);

  if (!values && col === 'BOP') values = calcBOP(bars.map(b => b.open), highs, lows, closes);

  const ultoM = col.match(/^ULTOSC_(\d+)_(\d+)_(\d+)$/);
  if (!values && ultoM) values = calcUltimateOscillator(highs, lows, closes, +ultoM[1]!, +ultoM[2]!, +ultoM[3]!);

  const trixM = col.match(/^TRIX_(\d+)$/);
  if (!values && trixM) values = calcTRIX(closes, +trixM[1]!);

  // ── Trend ──────────────────────────────────────────────────────────
  const adxM = col.match(/^ADX_(\d+)$/);
  if (!values && adxM) {
    const r = calcDirectionalMovement(highs, lows, closes, +adxM[1]!);
    values = r.adx;
  }
  const plusDIM = col.match(/^PLUS_DI_(\d+)$/);
  if (!values && plusDIM) {
    const r = calcDirectionalMovement(highs, lows, closes, +plusDIM[1]!);
    values = r.plusDI;
  }
  const minusDIM = col.match(/^MINUS_DI_(\d+)$/);
  if (!values && minusDIM) {
    const r = calcDirectionalMovement(highs, lows, closes, +minusDIM[1]!);
    values = r.minusDI;
  }

  const adxrM = col.match(/^ADXR_(\d+)$/);
  if (!values && adxrM) {
    const dm = calcDirectionalMovement(highs, lows, closes, +adxrM[1]!);
    values = calcADXR(dm.adx, +adxrM[1]!);
  }

  const aroonUpM = col.match(/^AROON_UP_(\d+)$/);
  if (!values && aroonUpM) {
    const r = calcAroon(highs, lows, +aroonUpM[1]!);
    values = r.up;
  }
  const aroonDnM = col.match(/^AROON_DOWN_(\d+)$/);
  if (!values && aroonDnM) {
    const r = calcAroon(highs, lows, +aroonDnM[1]!);
    values = r.down;
  }

  const aroonOscM = col.match(/^AROONOSC_(\d+)$/);
  if (!values && aroonOscM) values = calcAroonOsc(highs, lows, +aroonOscM[1]!);

  // ── Volatility ─────────────────────────────────────────────────────
  if (!values && col === 'TRANGE') values = calcTrueRange(highs, lows, closes);

  const atrM = col.match(/^ATR_(\d+)$/);
  if (!values && atrM) values = calcATR(highs, lows, closes, +atrM[1]!);

  const natrM = col.match(/^NATR_(\d+)$/);
  if (!values && natrM) values = calcNATR(highs, lows, closes, +natrM[1]!);

  // ── Volume ─────────────────────────────────────────────────────────
  if (!values && col === 'OBV') values = calcOBV(closes, bars.map(b => b.volume ?? 0));
  if (!values && col === 'AD') values = calcAD(highs, lows, closes, bars.map(b => b.volume ?? 0));

  const adoscM = col.match(/^ADOSC_(\d+)_(\d+)$/);
  if (!values && adoscM) values = calcADOSC(highs, lows, closes, bars.map(b => b.volume ?? 0), +adoscM[1]!, +adoscM[2]!);

  // ── Statistics ─────────────────────────────────────────────────────
  const stddevM = col.match(/^STDDEV_(\d+)$/);
  if (!values && stddevM) values = calcSubStdDev(closes, +stddevM[1]!);

  const varM = col.match(/^VAR_(\d+)$/);
  if (!values && varM) values = calcVariance(closes, +varM[1]!);

  const slopeM = col.match(/^LINEARREG_SLOPE_(\d+)$/);
  if (!values && slopeM) values = calcLinregSlope(closes, +slopeM[1]!);

  const angleM = col.match(/^LINEARREG_ANGLE_(\d+)$/);
  if (!values && angleM) values = calcLinregAngle(closes, +angleM[1]!);

  const interceptM = col.match(/^LINEARREG_INTERCEPT_(\d+)$/);
  if (!values && interceptM) values = calcLinregIntercept(closes, +interceptM[1]!);

  if (!values) return null;

  return toPoints(values, calcBars);
}
