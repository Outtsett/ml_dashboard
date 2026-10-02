export function calcHTDCPeriod(closes: number[]): (number | null)[] {
  // Simplified approximation: dominant cycle period via autocorrelation
  // Real Hilbert Transform is extremely complex; approximate with windowed cycle detection
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const minPeriod = 6;
  const maxPeriod = 50;
  const window = 50;

  for (let i = window; i < n; i++) {
    let bestCorr = -Infinity;
    let bestPeriod = 20; // default
    for (let p = minPeriod; p <= maxPeriod && i - p >= 0; p++) {
      let corr = 0;
      const count = Math.min(p, i - p);
      for (let j = 0; j < count; j++) {
        corr += (closes[i - j]! - closes[i - p - j]!) ** 2;
      }
      corr = -corr; // minimize squared difference = maximize negative
      if (corr > bestCorr) {
        bestCorr = corr;
        bestPeriod = p;
      }
    }
    result[i] = bestPeriod;
  }
  return result;
}

export function calcHTDCPhase(closes: number[]): (number | null)[] {
  // Simplified: phase as position within dominant cycle
  const dcPeriod = calcHTDCPeriod(closes);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (dcPeriod[i] !== null && dcPeriod[i]! > 0) {
      // Find the last peak within the current dominant cycle
      const p = Math.round(dcPeriod[i]!);
      const start = Math.max(0, i - p);
      let peakIdx = start;
      for (let j = start; j <= i; j++) {
        if (closes[j]! >= closes[peakIdx]!) peakIdx = j;
      }
      const phase = ((i - peakIdx) / p) * 360;
      result[i] = phase % 360;
    }
  }
  return result;
}

export function calcHTTrendMode(closes: number[]): (number | null)[] {
  // 0 = cycle mode, 1 = trend mode
  // Simplified: use DCPeriod stability as proxy
  const dcPeriod = calcHTDCPeriod(closes);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const lookback = 10;

  for (let i = lookback; i < n; i++) {
    if (dcPeriod[i] === null) continue;
    // If DC period is stable (low variance), it's in cycle mode
    let sum = 0, count = 0;
    for (let j = i - lookback; j <= i; j++) {
      if (dcPeriod[j] !== null) { sum += dcPeriod[j]!; count++; }
    }
    if (count < 2) continue;
    const mean = sum / count;
    let variance = 0;
    for (let j = i - lookback; j <= i; j++) {
      if (dcPeriod[j] !== null) variance += (dcPeriod[j]! - mean) ** 2;
    }
    variance /= count;
    // High variance in period = trending, low = cycling
    result[i] = variance > 25 ? 1 : 0;
  }
  return result;
}

export function calcHTSine(closes: number[]): { sine: (number | null)[]; leadsine: (number | null)[] } {
  const dcPhase = calcHTDCPhase(closes);
  const n = closes.length;
  const sine: (number | null)[] = new Array(n).fill(null);
  const leadsine: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (dcPhase[i] !== null) {
      const rad = (dcPhase[i]! * Math.PI) / 180;
      sine[i] = Math.sin(rad);
      leadsine[i] = Math.sin(rad + Math.PI / 4); // 45 degrees ahead
    }
  }
  return { sine, leadsine };
}

export function calcHTPhasor(closes: number[]): { inphase: (number | null)[]; quadrature: (number | null)[] } {
  const dcPhase = calcHTDCPhase(closes);
  const n = closes.length;
  const inphase: (number | null)[] = new Array(n).fill(null);
  const quadrature: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (dcPhase[i] !== null) {
      const rad = (dcPhase[i]! * Math.PI) / 180;
      inphase[i] = Math.cos(rad);
      quadrature[i] = Math.sin(rad);
    }
  }
  return { inphase, quadrature };
}
