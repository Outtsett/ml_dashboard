import type { FourierCoeff, WaveType } from './types';

export function getSyntheticCoefficients(type: Exclude<WaveType, 'price'>, n: number): FourierCoeff[] {
  const coeffs: FourierCoeff[] = [];
  switch (type) {
    case 'square':
      for (let k = 0; k < n; k++) {
        const i = 2 * k + 1;
        coeffs.push({ freq: i, amp: 1 / i, phase: 0 });
      }
      break;
    case 'sawtooth':
      for (let k = 1; k <= n; k++) {
        coeffs.push({ freq: k, amp: 1 / k, phase: 0 });
      }
      break;
    case 'triangle':
      for (let k = 0; k < n; k++) {
        const i = 2 * k + 1;
        const sign = k % 2 === 0 ? 1 : -1;
        coeffs.push({ freq: i, amp: sign / (i * i), phase: 0 });
      }
      break;
    case 'custom':
      for (let k = 1; k <= n; k++) {
        coeffs.push({
          freq: k,
          amp: Math.random() * 0.5 + 0.1 / k,
          phase: Math.random() * Math.PI * 2,
        });
      }
      break;
  }
  return coeffs;
}

/** Discrete Fourier Transform — returns top N frequency components by amplitude */
export function computeDFT(signal: number[], maxTerms: number): { coeffs: FourierCoeff[]; dc: number } {
  const N = signal.length;
  if (N === 0) return { coeffs: [], dc: 0 };

  let dc = 0;
  for (let i = 0; i < N; i++) dc += signal[i]!;
  dc /= N;

  const bins: FourierCoeff[] = [];
  const halfN = Math.floor(N / 2);

  for (let k = 1; k <= halfN; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += (signal[n]! - dc) * Math.cos(angle);
      im -= (signal[n]! - dc) * Math.sin(angle);
    }
    re /= N;
    im /= N;
    const amp = 2 * Math.sqrt(re * re + im * im);
    const phase = Math.atan2(im, re);
    bins.push({ freq: k, amp, phase });
  }

  bins.sort((a, b) => b.amp - a.amp);
  const top = bins.slice(0, maxTerms);
  top.sort((a, b) => a.freq - b.freq);
  return { coeffs: top, dc };
}

/** Reconstruct signal at position t from DFT coefficients */
export function reconstructSignal(coeffs: FourierCoeff[], dc: number, t: number): number {
  let val = dc;
  for (const { freq, amp, phase } of coeffs) {
    val += amp * Math.cos(freq * t + phase);
  }
  return val;
}

/**
 * Compute the discrete Hilbert Transform of a real signal via DFT.
 * Returns the analytic signal components: original, hilbert transform,
 * envelope (instantaneous amplitude), and instantaneous phase.
 */
export function computeHilbert(signal: number[]): {
  original: number[];
  hilbert: number[];
  envelope: number[];
  instPhase: number[];
  instFreq: number[];
} {
  const N = signal.length;
  if (N === 0) return { original: [], hilbert: [], envelope: [], instPhase: [], instFreq: [] };

  // Step 1: Compute DFT
  const reX: number[] = new Array(N);
  const imX: number[] = new Array(N);
  for (let k = 0; k < N; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += signal[n]! * Math.cos(angle);
      im -= signal[n]! * Math.sin(angle);
    }
    reX[k] = re;
    imX[k] = im;
  }

  // Step 2: Build analytic signal in frequency domain
  const reH: number[] = new Array(N).fill(0);
  const imH: number[] = new Array(N).fill(0);
  const halfN = Math.floor(N / 2);

  // DC
  reH[0] = reX[0]!;
  imH[0] = imX[0]!;

  // Positive frequencies: multiply by 2
  for (let k = 1; k < halfN; k++) {
    reH[k] = 2 * reX[k]!;
    imH[k] = 2 * imX[k]!;
  }

  // Nyquist (if N is even)
  if (N % 2 === 0) {
    reH[halfN] = reX[halfN]!;
    imH[halfN] = imX[halfN]!;
  }

  // Negative frequencies are left as 0

  // Step 3: Inverse DFT to get analytic signal
  const aRe: number[] = new Array(N); // real part = original signal (reconstructed)
  const aIm: number[] = new Array(N); // imaginary part = Hilbert transform

  for (let n = 0; n < N; n++) {
    let re = 0, im = 0;
    for (let k = 0; k < N; k++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += reH[k]! * Math.cos(angle) - imH[k]! * Math.sin(angle);
      im += reH[k]! * Math.sin(angle) + imH[k]! * Math.cos(angle);
    }
    aRe[n] = re / N;
    aIm[n] = im / N;
  }

  // Step 4: Compute envelope and instantaneous phase
  const envelope: number[] = new Array(N);
  const instPhase: number[] = new Array(N);
  const instFreq: number[] = new Array(N);

  for (let n = 0; n < N; n++) {
    envelope[n] = Math.sqrt(aRe[n]! * aRe[n]! + aIm[n]! * aIm[n]!);
    instPhase[n] = Math.atan2(aIm[n]!, aRe[n]!);
  }

  // Instantaneous frequency = d(phase)/dt, unwrapped
  for (let n = 1; n < N; n++) {
    let dp = instPhase[n]! - instPhase[n - 1]!;
    while (dp > Math.PI) dp -= 2 * Math.PI;
    while (dp < -Math.PI) dp += 2 * Math.PI;
    instFreq[n] = dp / (2 * Math.PI); // in cycles per sample
  }
  instFreq[0] = instFreq[1] || 0;

  return {
    original: aRe,
    hilbert: aIm,
    envelope,
    instPhase,
    instFreq,
  };
}

/** Remove linear trend from signal (least-squares fit) */
export function detrend(signal: number[]): { detrended: number[]; trend: number[] } {
  const N = signal.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < N; i++) {
    sumX += i;
    sumY += signal[i]!;
    sumXY += i * signal[i]!;
    sumX2 += i * i;
  }
  const slope = (N * sumXY - sumX * sumY) / (N * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / N;
  const detrended: number[] = new Array(N);
  const trend: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    trend[i] = slope * i + intercept;
    detrended[i] = signal[i]! - trend[i]!;
  }
  return { detrended, trend };
}

/** Simple moving average smoother */
export function smooth(data: number[], window: number): number[] {
  const result: number[] = new Array(data.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < data.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
      if (isFinite(data[j]!)) { sum += data[j]!; count++; }
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  return result;
}
