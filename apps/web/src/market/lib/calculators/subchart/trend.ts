export function calcDirectionalMovement(
  highs: number[], lows: number[], closes: number[], period: number,
): {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
  dx: (number | null)[];
  plusDM: (number | null)[];
  minusDM: (number | null)[];
} {
  const n = closes.length;
  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  const dx: (number | null)[] = new Array(n).fill(null);
  const plusDMOut: (number | null)[] = new Array(n).fill(null);
  const minusDMOut: (number | null)[] = new Array(n).fill(null);

  if (n < period + 1) return { adx, plusDI, minusDI, dx, plusDM: plusDMOut, minusDM: minusDMOut };

  // Raw +DM / -DM / TR
  const rawPlusDM: number[] = new Array(n).fill(0);
  const rawMinusDM: number[] = new Array(n).fill(0);
  const rawTR: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = highs[i]! - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;

    rawPlusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
    rawMinusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;

    rawTR[i] = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    );
  }

  // Initial sums (first `period` values, starting from index 1)
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;
  let smoothTR = 0;

  for (let i = 1; i <= period; i++) {
    smoothPlusDM += rawPlusDM[i]!;
    smoothMinusDM += rawMinusDM[i]!;
    smoothTR += rawTR[i]!;
  }

  // First DI values at index = period
  let pdi = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  let mdi = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
  plusDI[period] = pdi;
  minusDI[period] = mdi;
  plusDMOut[period] = smoothPlusDM;
  minusDMOut[period] = smoothMinusDM;

  let dxVal = (pdi + mdi) !== 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
  dx[period] = dxVal;

  let adxSum = dxVal;

  // Continue Wilder smoothing
  for (let i = period + 1; i < n; i++) {
    smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + rawPlusDM[i]!;
    smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + rawMinusDM[i]!;
    smoothTR = smoothTR - (smoothTR / period) + rawTR[i]!;

    pdi = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    mdi = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

    plusDI[i] = pdi;
    minusDI[i] = mdi;
    plusDMOut[i] = smoothPlusDM;
    minusDMOut[i] = smoothMinusDM;

    dxVal = (pdi + mdi) !== 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
    dx[i] = dxVal;

    if (i < 2 * period) {
      adxSum += dxVal;
    }
  }

  // ADX = Wilder smoothed DX, starting at index 2*period - 1
  if (n > 2 * period - 1) {
    let adxVal = adxSum / period;
    adx[2 * period - 1] = adxVal;

    for (let i = 2 * period; i < n; i++) {
      adxVal = (adxVal * (period - 1) + (dx[i] ?? 0)) / period;
      adx[i] = adxVal;
    }
  }

  return { adx, plusDI, minusDI, dx, plusDM: plusDMOut, minusDM: minusDMOut };
}

export function calcADXR(adxValues: (number | null)[], period: number): (number | null)[] {
  const n = adxValues.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (adxValues[i] !== null && adxValues[i - period] !== null) {
      result[i] = (adxValues[i]! + adxValues[i - period]!) / 2;
    }
  }
  return result;
}

export function calcAroon(
  highs: number[], lows: number[], period: number,
): { up: (number | null)[]; down: (number | null)[] } {
  const n = highs.length;
  const up: (number | null)[] = new Array(n).fill(null);
  const down: (number | null)[] = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    let highIdx = 0;
    let lowIdx = 0;
    let highVal = -Infinity;
    let lowVal = Infinity;

    for (let j = 0; j <= period; j++) {
      const idx = i - period + j;
      if (highs[idx]! >= highVal) { highVal = highs[idx]!; highIdx = j; }
      if (lows[idx]! <= lowVal) { lowVal = lows[idx]!; lowIdx = j; }
    }

    up[i] = (highIdx / period) * 100;
    down[i] = (lowIdx / period) * 100;
  }

  return { up, down };
}

export function calcAroonOsc(
  highs: number[], lows: number[], period: number,
): (number | null)[] {
  const { up, down } = calcAroon(highs, lows, period);
  const n = highs.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (up[i] !== null && down[i] !== null) {
      result[i] = up[i]! - down[i]!;
    }
  }
  return result;
}
