/**
 * Client-side overlay indicator calculators.
 *
 * Overlay indicators (SMA, EMA, Bollinger Bands, etc.) must be computed from
 * raw OHLCV data because server-side indicator tables stored z-scored
 * (normalized) values that cannot be plotted on a price chart.
 *
 * Each calculator takes an array of close prices and returns an array of
 * the same length, with leading nulls where insufficient data exists.
 */

// ─── Core math primitives ────────────────────────────────────────────────────

function calcSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i]! - values[i - period]!;
    result[i] = sum / period;
  }
  return result;
}

function calcEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  result[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

function calcWMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - period + 1 + j]! * (j + 1);
    }
    result[i] = sum / denom;
  }
  return result;
}

function calcDEMA(values: number[], period: number): (number | null)[] {
  const ema1 = calcEMA(values, period);
  const ema1Numbers = ema1.map(v => v ?? 0);
  const ema2 = calcEMA(ema1Numbers, period);
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (ema1[i] !== null && ema2[i] !== null) {
      result[i] = 2 * ema1[i]! - ema2[i]!;
    }
  }
  return result;
}

function calcTEMA(values: number[], period: number): (number | null)[] {
  const ema1 = calcEMA(values, period);
  const ema1Numbers = ema1.map(v => v ?? 0);
  const ema2 = calcEMA(ema1Numbers, period);
  const ema2Numbers = ema2.map(v => v ?? 0);
  const ema3 = calcEMA(ema2Numbers, period);
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (ema1[i] !== null && ema2[i] !== null && ema3[i] !== null) {
      result[i] = 3 * ema1[i]! - 3 * ema2[i]! + ema3[i]!;
    }
  }
  return result;
}

function calcKAMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  const fastSC = 2 / (2 + 1);  // fast EMA period=2
  const slowSC = 2 / (30 + 1); // slow EMA period=30
  let kama = values[period - 1]!;
  result[period - 1] = kama;
  for (let i = period; i < values.length; i++) {
    const direction = Math.abs(values[i]! - values[i - period]!);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(values[j]! - values[j - 1]!);
    }
    const er = volatility !== 0 ? direction / volatility : 0;
    const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
    kama = kama + sc * (values[i]! - kama);
    result[i] = kama;
  }
  return result;
}

function calcTRIMA(values: number[], period: number): (number | null)[] {
  // Triangular MA = SMA of SMA
  const sma1 = calcSMA(values, Math.ceil((period + 1) / 2));
  const sma1Numbers = sma1.map(v => v ?? 0);
  return calcSMA(sma1Numbers, Math.floor((period + 1) / 2));
}

function calcT3(values: number[], period: number): (number | null)[] {
  // T3 with default vfactor=0.7
  const vf = 0.7;
  const c1 = -(vf ** 3);
  const c2 = 3 * vf ** 2 + 3 * vf ** 3;
  const c3 = -6 * vf ** 2 - 3 * vf - 3 * vf ** 3;
  const c4 = 1 + 3 * vf + vf ** 3 + 3 * vf ** 2;

  const e1 = calcEMA(values, period);
  const e1n = e1.map(v => v ?? 0);
  const e2 = calcEMA(e1n, period);
  const e2n = e2.map(v => v ?? 0);
  const e3 = calcEMA(e2n, period);
  const e3n = e3.map(v => v ?? 0);
  const e4 = calcEMA(e3n, period);
  const e4n = e4.map(v => v ?? 0);
  const e5 = calcEMA(e4n, period);
  const e5n = e5.map(v => v ?? 0);
  const e6 = calcEMA(e5n, period);

  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (e3[i] !== null && e4[i] !== null && e5[i] !== null && e6[i] !== null) {
      result[i] = c1 * e6[i]! + c2 * e5[i]! + c3 * e4[i]! + c4 * e3[i]!;
    }
  }
  return result;
}

function calcMidpoint(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j]! > hi) hi = values[j]!;
      if (values[j]! < lo) lo = values[j]!;
    }
    result[i] = (hi + lo) / 2;
  }
  return result;
}

function calcMidprice(
  highs: number[], lows: number[], period: number,
): (number | null)[] {
  const result: (number | null)[] = new Array(highs.length).fill(null);
  if (highs.length < period) return result;
  for (let i = period - 1; i < highs.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j]! > hi) hi = highs[j]!;
      if (lows[j]! < lo) lo = lows[j]!;
    }
    result[i] = (hi + lo) / 2;
  }
  return result;
}

function calcStdDev(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (values[j]! - mean) ** 2;
    result[i] = Math.sqrt(sqSum / period);
  }
  return result;
}

function calcLinearReg(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = values[i - period + 1 + j]!;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / period;
    // Linear regression value at the last point in the window
    result[i] = intercept + slope * (period - 1);
  }
  return result;
}

function calcTSF(values: number[], period: number): (number | null)[] {
  // Time Series Forecast = linear regression projected 1 step forward
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = values[i - period + 1 + j]!;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / period;
    result[i] = intercept + slope * period; // one step ahead
  }
  return result;
}

// ─── Parabolic SAR ──────────────────────────────────────────────────────────

function calcParabolicSAR(
  highs: number[], lows: number[], closes: number[],
): (number | null)[] {
  const n = highs.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < 2) return result;

  const afStart = 0.02, afStep = 0.02, afMax = 0.2;
  let isLong = closes[1]! > closes[0]!;
  let af = afStart;
  let ep = isLong ? highs[0]! : lows[0]!;
  let sar = isLong ? lows[0]! : highs[0]!;

  result[0] = sar;

  for (let i = 1; i < n; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (isLong) {
      // Clamp SAR below the prior two lows
      if (i >= 2) sar = Math.min(sar, lows[i - 1]!, lows[i - 2]!);
      else sar = Math.min(sar, lows[i - 1]!);

      if (lows[i]! < sar) {
        // Reversal to short
        isLong = false;
        sar = ep;
        ep = lows[i]!;
        af = afStart;
      } else {
        if (highs[i]! > ep) {
          ep = highs[i]!;
          af = Math.min(af + afStep, afMax);
        }
      }
    } else {
      // Clamp SAR above the prior two highs
      if (i >= 2) sar = Math.max(sar, highs[i - 1]!, highs[i - 2]!);
      else sar = Math.max(sar, highs[i - 1]!);

      if (highs[i]! > sar) {
        // Reversal to long
        isLong = true;
        sar = ep;
        ep = highs[i]!;
        af = afStart;
      } else {
        if (lows[i]! < ep) {
          ep = lows[i]!;
          af = Math.min(af + afStep, afMax);
        }
      }
    }

    result[i] = sar;
  }
  return result;
}

// ─── Hilbert Transform Trendline ─────────────────────────────────────────────

function calcHTTrendline(values: number[]): (number | null)[] {
  // Simplified: use a weighted moving average as approximation
  // The real HT is extremely complex (Ehlers' algorithm) — approximate with WMA(4)
  return calcWMA(values, 4);
}

// ─── Overlay column name → calculator dispatch ──────────────────────────────

export interface OverlayPoint {
  time: number;   // epoch seconds
  value: number;
}

/**
 * Parse an overlay display name and compute its values from OHLCV bars.
 * Returns null if the column name is not a recognized overlay indicator
 * or if there's insufficient data.
 *
 * Display name examples:
 *   SMA_30, EMA_30, WMA_30, DEMA_30, TEMA_30, T3_5, KAMA_10, TRIMA_30,
 *   BBU_5_2_0, BBM_5_2_0, BBL_5_2_0, MIDPOINT_14, MIDPRICE_14,
 *   PSAR, PSAREXT, LINREG_20, TSF_20, MA_30, HT_TRENDLINE
 */
export function computeOverlay(
  column: string,
  bars: { timestamp: number; open: number; high: number; low: number; close: number }[],
): OverlayPoint[] | null {
  if (bars.length === 0) return null;

  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);

  let values: (number | null)[] | null = null;

  // Match against known overlay patterns
  const col = column.toUpperCase();

  // Simple MA variants: SMA_30, EMA_30, WMA_30, MA_30
  const smaMatch = col.match(/^SMA_(\d+)$/);
  if (smaMatch) {
    values = calcSMA(closes, parseInt(smaMatch[1]!));
  }

  const emaMatch = col.match(/^EMA_(\d+)$/);
  if (!values && emaMatch) {
    values = calcEMA(closes, parseInt(emaMatch[1]!));
  }

  const wmaMatch = col.match(/^WMA_(\d+)$/);
  if (!values && wmaMatch) {
    values = calcWMA(closes, parseInt(wmaMatch[1]!));
  }

  const maMatch = col.match(/^MA_(\d+)$/);
  if (!values && maMatch) {
    values = calcSMA(closes, parseInt(maMatch[1]!)); // MA defaults to SMA
  }

  const demaMatch = col.match(/^DEMA_(\d+)$/);
  if (!values && demaMatch) {
    values = calcDEMA(closes, parseInt(demaMatch[1]!));
  }

  const temaMatch = col.match(/^TEMA_(\d+)$/);
  if (!values && temaMatch) {
    values = calcTEMA(closes, parseInt(temaMatch[1]!));
  }

  const kamaMatch = col.match(/^KAMA_(\d+)$/);
  if (!values && kamaMatch) {
    values = calcKAMA(closes, parseInt(kamaMatch[1]!));
  }

  const t3Match = col.match(/^T3_(\d+)$/);
  if (!values && t3Match) {
    values = calcT3(closes, parseInt(t3Match[1]!));
  }

  const trimaMatch = col.match(/^TRIMA_(\d+)$/);
  if (!values && trimaMatch) {
    values = calcTRIMA(closes, parseInt(trimaMatch[1]!));
  }

  // Bollinger Bands: BBU_5_2_0, BBM_5_2_0, BBL_5_2_0
  // Format: BB[UML]_period_stddev (stddev 2_0 = 2.0)
  const bbMatch = col.match(/^BB([UML])_(\d+)_(\d+)_(\d+)$/);
  if (!values && bbMatch) {
    const band = bbMatch[1]!;
    const period = parseInt(bbMatch[2]!);
    const stdMultWhole = parseInt(bbMatch[3]!);
    const stdMultFrac = parseInt(bbMatch[4]!);
    const stdMult = stdMultWhole + stdMultFrac / 10;
    const smaVals = calcSMA(closes, period);
    const stdVals = calcStdDev(closes, period);
    values = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
      if (smaVals[i] !== null && stdVals[i] !== null) {
        if (band === 'U') values[i] = smaVals[i]! + stdMult * stdVals[i]!;
        else if (band === 'L') values[i] = smaVals[i]! - stdMult * stdVals[i]!;
        else values[i] = smaVals[i]!; // middle band = SMA
      }
    }
  }

  // MIDPOINT_14
  const midpointMatch = col.match(/^MIDPOINT_(\d+)$/);
  if (!values && midpointMatch) {
    values = calcMidpoint(closes, parseInt(midpointMatch[1]!));
  }

  // MIDPRICE_14
  const midpriceMatch = col.match(/^MIDPRICE_(\d+)$/);
  if (!values && midpriceMatch) {
    values = calcMidprice(highs, lows, parseInt(midpriceMatch[1]!));
  }

  // LINREG_20
  const linregMatch = col.match(/^LINREG_(\d+)$/);
  if (!values && linregMatch) {
    values = calcLinearReg(closes, parseInt(linregMatch[1]!));
  }

  // TSF_20
  const tsfMatch = col.match(/^TSF_(\d+)$/);
  if (!values && tsfMatch) {
    values = calcTSF(closes, parseInt(tsfMatch[1]!));
  }

  // PSAR, PSAREXT
  if (!values && (col === 'PSAR' || col === 'PSAREXT')) {
    values = calcParabolicSAR(highs, lows, closes);
  }

  // HT_TRENDLINE
  if (!values && col === 'HT_TRENDLINE') {
    values = calcHTTrendline(closes);
  }

  // MAMA, FAMA — approximated as EMA variants
  if (!values && col === 'MAMA') {
    values = calcEMA(closes, 10); // MAMA approximation
  }
  if (!values && col === 'FAMA') {
    values = calcEMA(closes, 30); // FAMA approximation (slower)
  }

  // AVGPRICE, MEDPRICE, TYPPRICE, WCLPRICE — price transforms, overlay-compatible
  if (!values && col === 'AVGPRICE') {
    values = bars.map(b => (b.open + b.high + b.low + b.close) / 4);
  }
  if (!values && col === 'MEDPRICE') {
    values = bars.map(b => (b.high + b.low) / 2);
  }
  if (!values && col === 'TYPPRICE') {
    values = bars.map(b => (b.high + b.low + b.close) / 3);
  }
  if (!values && col === 'WCLPRICE') {
    values = bars.map(b => (b.high + b.low + 2 * b.close) / 4);
  }

  if (!values) return null;

  // Convert to time-series points, skipping nulls
  const points: OverlayPoint[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && !isNaN(v)) {
      // Convert epoch-ms to epoch-seconds for lightweight-charts
      const timeSec = Math.floor(bars[i]!.timestamp / 1000);
      // Guard: if timestamp is already in seconds (< 1e10), use as-is
      const t = bars[i]!.timestamp > 1e12 ? timeSec : bars[i]!.timestamp;
      points.push({ time: t, value: v });
    }
  }

  return points.length > 0 ? points : null;
}
