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

/** 
 * Fast Fourier Transform (Cooley-Tukey Radix-2)
 * O(N log N) - massive speedup for large signals
 */
export function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imag[i], imag[j]] = [imag[j]!, imag[i]!];
    }
  }

  // Butterfly computations
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (2 * Math.PI) / len;
    const wlenRe = Math.cos(angle);
    const wlenIm = -Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = real[i + j]!;
        const uIm = imag[i + j]!;
        const vRe = real[i + j + len / 2]! * wRe - imag[i + j + len / 2]! * wIm;
        const vIm = real[i + j + len / 2]! * wIm + imag[i + j + len / 2]! * wRe;
        real[i + j] = uRe + vRe;
        imag[i + j] = uIm + vIm;
        real[i + j + len / 2] = uRe - vRe;
        imag[i + j + len / 2] = uIm - vIm;
        const tmpRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = tmpRe;
      }
    }
  }
}

/** Inverse FFT */
export function ifft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  // Conjugate
  for (let i = 0; i < n; i++) imag[i] = -imag[i]!;
  // Forward FFT
  fft(real, imag);
  // Conjugate and Scale
  for (let i = 0; i < n; i++) {
    real[i] = real[i]! / n;
    imag[i] = -imag[i]! / n;
  }
}

/** Discrete Fourier Transform — returns top N frequency components by amplitude */
export function computeDFT(signal: number[], maxTerms: number): { coeffs: FourierCoeff[]; dc: number } {
  const N = signal.length;
  if (N === 0) return { coeffs: [], dc: 0 };

  // For small N, $O(N^2)$ is fine, but we'll use FFT if N is a power of 2
  const isPowerOf2 = (N & (N - 1)) === 0;
  
  let dc = 0;
  for (let i = 0; i < N; i++) dc += signal[i]!;
  dc /= N;

  const real = new Float64Array(N);
  const imag = new Float64Array(N);
  for (let i = 0; i < N; i++) real[i] = signal[i]! - dc;

  if (isPowerOf2) {
    fft(real, imag);
    const bins: FourierCoeff[] = [];
    for (let k = 1; k <= Math.floor(N / 2); k++) {
      const re = real[k]! / N;
      const im = imag[k]! / N;
      const amp = 2 * Math.sqrt(re * re + im * im);
      const phase = Math.atan2(im, re);
      bins.push({ freq: k, amp, phase });
    }
    bins.sort((a, b) => b.amp - a.amp);
    const top = bins.slice(0, maxTerms);
    top.sort((a, b) => a.freq - b.freq);
    return { coeffs: top, dc };
  } else {
    // Fallback to O(N^2) DFT if not power of 2
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
 * Compute the discrete Hilbert Transform of a real signal via FFT.
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

  const isPowerOf2 = (N & (N - 1)) === 0;
  const real = new Float64Array(N);
  const imag = new Float64Array(N);
  for (let i = 0; i < N; i++) real[i] = signal[i]!;

  if (isPowerOf2) {
    // Step 1: Forward FFT
    fft(real, imag);

    // Step 2: Build analytic signal in frequency domain
    // 0 at negative frequencies, 2*X at positive frequencies
    const halfN = Math.floor(N / 2);
    for (let k = 1; k < halfN; k++) {
      real[k]! *= 2;
      imag[k]! *= 2;
    }
    for (let k = halfN + 1; k < N; k++) {
      real[k] = 0;
      imag[k] = 0;
    }
    // DC and Nyquist stay same

    // Step 3: Inverse FFT
    ifft(real, imag);
  } else {
    // Fallback to O(N^2) if not power of 2
    const reX = new Float64Array(N);
    const imX = new Float64Array(N);
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
    const halfN = Math.floor(N / 2);
    const reH = new Float64Array(N).fill(0);
    const imH = new Float64Array(N).fill(0);
    reH[0] = reX[0]!;
    imH[0] = imX[0]!;
    for (let k = 1; k < halfN; k++) {
      reH[k] = 2 * reX[k]!;
      imH[k] = 2 * imX[k]!;
    }
    if (N % 2 === 0) {
      reH[halfN] = reX[halfN]!;
      imH[halfN] = imX[halfN]!;
    }
    for (let n = 0; n < N; n++) {
      let re = 0, im = 0;
      for (let k = 0; k < N; k++) {
        const angle = (2 * Math.PI * k * n) / N;
        re += reH[k]! * Math.cos(angle) - imH[k]! * Math.sin(angle);
        im += reH[k]! * Math.sin(angle) + imH[k]! * Math.cos(angle);
      }
      real[n] = re / N;
      imag[n] = im / N;
    }
  }

  const envelope = new Array(N);
  const instPhase = new Array(N);
  const instFreq = new Array(N);

  for (let n = 0; n < N; n++) {
    envelope[n] = Math.sqrt(real[n]! * real[n]! + imag[n]! * imag[n]!);
    instPhase[n] = Math.atan2(imag[n]!, real[n]!);
  }

  for (let n = 1; n < N; n++) {
    let dp = instPhase[n]! - instPhase[n - 1]!;
    while (dp > Math.PI) dp -= 2 * Math.PI;
    while (dp < -Math.PI) dp += 2 * Math.PI;
    instFreq[n] = dp / (2 * Math.PI);
  }
  instFreq[0] = instFreq[1] || 0;

  return {
    original: Array.from(real),
    hilbert: Array.from(imag),
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


