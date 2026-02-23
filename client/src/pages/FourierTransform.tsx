import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Waves, Play, Pause, RotateCcw, Zap, CandlestickChart, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type WaveType = 'square' | 'sawtooth' | 'triangle' | 'custom' | 'price';
type TransformMode = 'fourier' | 'hilbert';

interface FourierCoeff {
  freq: number;
  amp: number;
  phase: number;
}

interface InstrumentInfo {
  symbol: string;
  name: string;
  assetType: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fourier helpers
// ─────────────────────────────────────────────────────────────────────────────

function getSyntheticCoefficients(type: Exclude<WaveType, 'price'>, n: number): FourierCoeff[] {
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
function computeDFT(signal: number[], maxTerms: number): { coeffs: FourierCoeff[]; dc: number } {
  const N = signal.length;
  if (N === 0) return { coeffs: [], dc: 0 };

  let dc = 0;
  for (let i = 0; i < N; i++) dc += signal[i];
  dc /= N;

  const bins: FourierCoeff[] = [];
  const halfN = Math.floor(N / 2);

  for (let k = 1; k <= halfN; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += (signal[n] - dc) * Math.cos(angle);
      im -= (signal[n] - dc) * Math.sin(angle);
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
function reconstructSignal(coeffs: FourierCoeff[], dc: number, t: number): number {
  let val = dc;
  for (const { freq, amp, phase } of coeffs) {
    val += amp * Math.cos(freq * t + phase);
  }
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hilbert Transform helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the discrete Hilbert Transform of a real signal via DFT.
 * Returns the analytic signal components: original, hilbert transform,
 * envelope (instantaneous amplitude), and instantaneous phase.
 */
function computeHilbert(signal: number[]): {
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
      re += signal[n] * Math.cos(angle);
      im -= signal[n] * Math.sin(angle);
    }
    reX[k] = re;
    imX[k] = im;
  }

  // Step 2: Build analytic signal in frequency domain
  // H(k) = 0 for DC and Nyquist, 2*X(k) for positive freq, 0 for negative
  const reH: number[] = new Array(N).fill(0);
  const imH: number[] = new Array(N).fill(0);
  const halfN = Math.floor(N / 2);

  // DC
  reH[0] = reX[0];
  imH[0] = imX[0];

  // Positive frequencies: multiply by 2
  for (let k = 1; k < halfN; k++) {
    reH[k] = 2 * reX[k];
    imH[k] = 2 * imX[k];
  }

  // Nyquist (if N is even)
  if (N % 2 === 0) {
    reH[halfN] = reX[halfN];
    imH[halfN] = imX[halfN];
  }

  // Negative frequencies are left as 0

  // Step 3: Inverse DFT to get analytic signal
  const aRe: number[] = new Array(N); // real part = original signal (reconstructed)
  const aIm: number[] = new Array(N); // imaginary part = Hilbert transform

  for (let n = 0; n < N; n++) {
    let re = 0, im = 0;
    for (let k = 0; k < N; k++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += reH[k] * Math.cos(angle) - imH[k] * Math.sin(angle);
      im += reH[k] * Math.sin(angle) + imH[k] * Math.cos(angle);
    }
    aRe[n] = re / N;
    aIm[n] = im / N;
  }

  // Step 4: Compute envelope and instantaneous phase
  const envelope: number[] = new Array(N);
  const instPhase: number[] = new Array(N);
  const instFreq: number[] = new Array(N);

  for (let n = 0; n < N; n++) {
    envelope[n] = Math.sqrt(aRe[n] * aRe[n] + aIm[n] * aIm[n]);
    instPhase[n] = Math.atan2(aIm[n], aRe[n]);
  }

  // Instantaneous frequency = d(phase)/dt, unwrapped
  for (let n = 1; n < N; n++) {
    let dp = instPhase[n] - instPhase[n - 1];
    // Unwrap
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
function detrend(signal: number[]): { detrended: number[]; trend: number[] } {
  const N = signal.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < N; i++) {
    sumX += i;
    sumY += signal[i];
    sumXY += i * signal[i];
    sumX2 += i * i;
  }
  const slope = (N * sumXY - sumX * sumY) / (N * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / N;
  const detrended: number[] = new Array(N);
  const trend: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    trend[i] = slope * i + intercept;
    detrended[i] = signal[i] - trend[i];
  }
  return { detrended, trend };
}

/** Simple moving average smoother */
function smooth(data: number[], window: number): number[] {
  const result: number[] = new Array(data.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < data.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
      if (isFinite(data[j])) { sum += data[j]; count++; }
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Color palette
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = [
  '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa',
  '#f87171', '#2dd4bf', '#c084fc', '#fb923c', '#4ade80',
  '#e879f9', '#38bdf8', '#facc15', '#a3e635', '#f43f5e',
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function FourierTransform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const trailRef = useRef<number[]>([]);

  const [numTerms, setNumTerms] = useState(5);
  const [speed, setSpeed] = useState(1);
  const [waveType, setWaveType] = useState<WaveType>('square');
  const [transformMode, setTransformMode] = useState<TransformMode>('fourier');
  const [playing, setPlaying] = useState(true);
  const [showComponents, setShowComponents] = useState(true);
  const [amplitude, setAmplitude] = useState(100);
  const [customCoeffs, setCustomCoeffs] = useState<FourierCoeff[]>([]);

  // Price mode state
  const [priceSymbol, setPriceSymbol] = useState('ES');
  const [priceTimeframe, setPriceTimeframe] = useState(1440);

  const { data: rawInstruments } = useQuery<InstrumentInfo[]>({
    queryKey: ['/api/instruments'],
  });
  const instruments = useMemo(() =>
    Array.isArray(rawInstruments) ? rawInstruments.sort((a, b) => a.symbol.localeCompare(b.symbol)) : [],
    [rawInstruments]
  );

  // Limit hilbert sample size to prevent UI lag (O(N²) DFT)
  const hilbertLimit = 256;

  const { data: priceData, isLoading: priceLoading } = useQuery<{ close: number }[]>({
    queryKey: ['/api/charts/ohlcv', priceSymbol, priceTimeframe, 'fourier'],
    queryFn: async () => {
      const tfMap: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1d' };
      const tfStr = tfMap[priceTimeframe] || '1d';
      const res = await fetch(`/api/charts/ohlcv?symbol=${priceSymbol}&timeframe=${tfStr}&limit=512`);
      if (!res.ok) throw new Error('Failed to fetch price data');
      const json = await res.json();
      const rows = json?.data ?? json;
      return Array.isArray(rows) ? rows : [];
    },
    enabled: waveType === 'price',
    staleTime: 60_000,
  });

  // DFT on price data
  const priceDFT = useMemo(() => {
    if (waveType !== 'price' || !priceData || priceData.length < 10) return null;
    const closes = priceData
      .map((d: any) => d.adjustedClose ?? d.close)
      .filter((c: number) => c != null && !isNaN(c));
    if (closes.length < 10) return null;
    return { ...computeDFT(closes, numTerms), closes };
  }, [priceData, numTerms, waveType]);

  // Hilbert on price data — detrend first so the transform works on oscillations, not the trend
  const priceHilbert = useMemo(() => {
    if (waveType !== 'price' || transformMode !== 'hilbert' || !priceData || priceData.length < 10) return null;
    const closes = priceData
      .map((d: any) => d.adjustedClose ?? d.close)
      .filter((c: number) => c != null && !isNaN(c));
    if (closes.length < 10) return null;
    const trimmed = closes.length > hilbertLimit ? closes.slice(closes.length - hilbertLimit) : closes;
    const { detrended, trend } = detrend(trimmed);
    const h = computeHilbert(detrended);
    return { ...h, closes: trimmed, detrended, trend };
  }, [priceData, waveType, transformMode]);

  // Hilbert on synthetic signal
  const syntheticHilbert = useMemo(() => {
    if (waveType === 'price' || transformMode !== 'hilbert') return null;
    const N = 256;
    const coeffs = waveType === 'custom' ? customCoeffs : getSyntheticCoefficients(waveType, numTerms);
    if (coeffs.length === 0) return null;
    const signal: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = (2 * Math.PI * i) / N;
      let val = 0;
      for (const { freq, amp, phase } of coeffs) {
        val += amp * Math.sin(freq * t + phase);
      }
      signal.push(val);
    }
    return computeHilbert(signal);
  }, [waveType, transformMode, numTerms, customCoeffs]);

  const regenerateCustom = useCallback(() => {
    setCustomCoeffs(getSyntheticCoefficients('custom', numTerms));
  }, [numTerms]);

  useEffect(() => {
    if (waveType === 'custom' && customCoeffs.length === 0) regenerateCustom();
  }, [waveType, customCoeffs.length, regenerateCustom]);

  useEffect(() => { trailRef.current = []; }, [numTerms, waveType, amplitude, priceSymbol, priceTimeframe, transformMode]);

  // ── Canvas render ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(canvas);

    const draw = () => {
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      ctx.clearRect(0, 0, W, H);

      const isPriceMode = waveType === 'price';
      const isHilbert = transformMode === 'hilbert';

      // ───────────────────────────────────────────────────────────────
      // HILBERT TRANSFORM MODE
      // ───────────────────────────────────────────────────────────────
      if (isHilbert) {
        const hData = isPriceMode ? priceHilbert : syntheticHilbert;

        if (!hData || hData.original.length === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = '14px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            isPriceMode && priceLoading ? 'Loading price data...' : 'Computing Hilbert transform...',
            W / 2, H / 2
          );
          ctx.textAlign = 'left';
          animRef.current = requestAnimationFrame(draw);
          return;
        }

        const N = hData.original.length;
        const margin = { top: 30, right: 20, bottom: 10, left: 60 };
        const insetSize = Math.min(180, W * 0.22);
        const plotW = W - margin.left - margin.right - insetSize - 16;
        const panelCount = 4;
        const gap = 16;
        const panelH = (H - margin.top - margin.bottom - gap * (panelCount - 1)) / panelCount;

        // Smooth instantaneous frequency for display
        const smoothFreq = smooth(hData.instFreq, 7);

        // Compute dominant cycle from median of absolute inst. freq
        const absFreqs = smoothFreq.filter(f => isFinite(f) && Math.abs(f) > 0.005);
        absFreqs.sort((a, b) => Math.abs(b) - Math.abs(a));
        const dominantFreq = absFreqs.length > 0 ? Math.abs(absFreqs[Math.floor(absFreqs.length * 0.25)]) : 0;
        const dominantPeriod = dominantFreq > 0 ? Math.round(1 / dominantFreq) : 0;

        // Animate a sweep line
        const t = timeRef.current;
        const sweepIdx = Math.floor((t * speed * 3) % N);

        // ── Enhanced drawPanel ──
        const drawPanel = (
          panelIdx: number,
          title: string,
          series: { data: number[]; color: string; label: string; width?: number; fill?: string; dashPattern?: number[] }[],
          opts?: { zeroline?: boolean; sweepDot?: boolean; annotation?: string }
        ) => {
          const py = margin.top + panelIdx * (panelH + gap);

          // Find Y range across all series
          let yMin = Infinity, yMax = -Infinity;
          for (const s of series) {
            for (const v of s.data) {
              if (isFinite(v)) {
                if (v < yMin) yMin = v;
                if (v > yMax) yMax = v;
              }
            }
          }
          const yRange = yMax - yMin || 1;
          const padded = yRange * 0.1;
          yMin -= padded;
          yMax += padded;
          const totalRange = yMax - yMin;

          const toX = (i: number) => margin.left + (i / (N - 1)) * plotW;
          const toY = (v: number) => py + panelH - ((v - yMin) / totalRange) * panelH;

          // Panel background with subtle gradient
          const bgGrad = ctx.createLinearGradient(margin.left, py, margin.left, py + panelH);
          bgGrad.addColorStop(0, 'rgba(139, 92, 246, 0.02)');
          bgGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
          bgGrad.addColorStop(1, 'rgba(52, 211, 153, 0.01)');
          ctx.fillStyle = bgGrad;
          ctx.beginPath();
          ctx.roundRect(margin.left - 4, py - 2, plotW + 8, panelH + 4, 6);
          ctx.fill();

          // Panel border (subtle)
          ctx.beginPath();
          ctx.roundRect(margin.left - 4, py - 2, plotW + 8, panelH + 4, 6);
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.06)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Horizontal grid lines
          const gridCount = 4;
          for (let g = 0; g <= gridCount; g++) {
            const gy = py + (g / gridCount) * panelH;
            ctx.beginPath();
            ctx.moveTo(margin.left, gy);
            ctx.lineTo(margin.left + plotW, gy);
            ctx.strokeStyle = 'rgba(255,255,255,0.03)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          // Zero line
          if (opts?.zeroline && yMin < 0 && yMax > 0) {
            const zy = toY(0);
            ctx.beginPath();
            ctx.moveTo(margin.left, zy);
            ctx.lineTo(margin.left + plotW, zy);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Title
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(title, margin.left + 2, py - 7);

          // Annotation (e.g. dominant cycle)
          if (opts?.annotation) {
            ctx.fillStyle = 'rgba(139, 92, 246, 0.15)';
            const tw = ctx.measureText(opts.annotation).width + 12;
            ctx.beginPath();
            ctx.roundRect(margin.left + plotW - tw - 4, py + 4, tw + 8, 18, 4);
            ctx.fill();
            ctx.fillStyle = 'rgba(167, 139, 250, 0.9)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillText(opts.annotation, margin.left + plotW - tw, py + 16);
          }

          // Y-axis labels
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          const yTopVal = yMin + totalRange;
          const yMidVal = yMin + totalRange / 2;
          ctx.fillText(yTopVal.toFixed(isPriceMode ? 1 : 3), margin.left - 6, py + 6);
          ctx.fillText(yMidVal.toFixed(isPriceMode ? 1 : 3), margin.left - 6, py + panelH / 2 + 3);
          ctx.fillText(yMin.toFixed(isPriceMode ? 1 : 3), margin.left - 6, py + panelH);
          ctx.textAlign = 'left';

          // Draw gradient fills first (behind lines)
          for (const s of series) {
            if (!s.fill) continue;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < N; i++) {
              if (!isFinite(s.data[i])) continue;
              const px = toX(i);
              const ppy = toY(s.data[i]);
              if (!started) { ctx.moveTo(px, ppy); started = true; }
              else ctx.lineTo(px, ppy);
            }
            // Close to baseline
            const zeroY = (opts?.zeroline && yMin < 0 && yMax > 0) ? toY(0) : py + panelH;
            ctx.lineTo(toX(N - 1), zeroY);
            ctx.lineTo(toX(0), zeroY);
            ctx.closePath();
            const fillGrad = ctx.createLinearGradient(0, py, 0, py + panelH);
            fillGrad.addColorStop(0, s.fill);
            fillGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = fillGrad;
            ctx.fill();
          }

          // Draw lines with optional glow
          for (const s of series) {
            if (s.dashPattern) {
              ctx.setLineDash(s.dashPattern);
            }

            // Glow pass for thick lines
            if ((s.width ?? 1.5) >= 2) {
              ctx.beginPath();
              let started = false;
              for (let i = 0; i < N; i++) {
                if (!isFinite(s.data[i])) continue;
                const px = toX(i);
                const ppy = toY(s.data[i]);
                if (!started) { ctx.moveTo(px, ppy); started = true; }
                else ctx.lineTo(px, ppy);
              }
              ctx.strokeStyle = s.color;
              ctx.lineWidth = (s.width ?? 1.5) + 3;
              ctx.globalAlpha = 0.15;
              ctx.stroke();
              ctx.globalAlpha = 1;
            }

            // Main line
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < N; i++) {
              if (!isFinite(s.data[i])) continue;
              const px = toX(i);
              const ppy = toY(s.data[i]);
              if (!started) { ctx.moveTo(px, ppy); started = true; }
              else ctx.lineTo(px, ppy);
            }
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.width ?? 1.5;
            ctx.stroke();

            if (s.dashPattern) {
              ctx.setLineDash([]);
            }
          }

          // Legend (right side, compact)
          let lx = margin.left + plotW - series.length * 80;
          for (const s of series) {
            ctx.fillStyle = s.color;
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.fillText(`── ${s.label}`, lx, py - 7);
            lx += 80;
          }

          // Sweep line (full panel height, with glow)
          if (opts?.sweepDot && sweepIdx < N) {
            const sx = toX(sweepIdx);
            // Glow
            ctx.beginPath();
            ctx.moveTo(sx, py);
            ctx.lineTo(sx, py + panelH);
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.08)';
            ctx.lineWidth = 8;
            ctx.stroke();
            // Line
            ctx.beginPath();
            ctx.moveTo(sx, py);
            ctx.lineTo(sx, py + panelH);
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.25)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Sweep dots
            for (const s of series) {
              if (!isFinite(s.data[sweepIdx])) continue;
              const dotY = toY(s.data[sweepIdx]);
              // Outer glow
              ctx.beginPath();
              ctx.arc(sx, dotY, 7, 0, Math.PI * 2);
              ctx.fillStyle = s.color.replace(/[\d.]+\)$/, '0.15)');
              ctx.fill();
              // Inner dot
              ctx.beginPath();
              ctx.arc(sx, dotY, 3.5, 0, Math.PI * 2);
              ctx.fillStyle = s.color;
              ctx.shadowColor = s.color;
              ctx.shadowBlur = 10;
              ctx.fill();
              ctx.shadowBlur = 0;
            }
          }
        };

        // ── Use detrended data for price mode ──
        const signal = isPriceMode && (hData as any).detrended ? (hData as any).detrended : hData.original;
        const hilbert = hData.hilbert;

        // Panel 0: Detrended signal + Hilbert Transform
        drawPanel(0, isPriceMode ? 'DETRENDED PRICE + HILBERT TRANSFORM' : 'SIGNAL + HILBERT TRANSFORM', [
          { data: signal, color: isPriceMode ? 'rgba(251, 191, 36, 0.85)' : 'rgba(167, 139, 250, 0.9)', label: isPriceMode ? 'Detrended' : 'Signal', width: 2, fill: isPriceMode ? 'rgba(251, 191, 36, 0.08)' : 'rgba(167, 139, 250, 0.06)' },
          { data: hilbert, color: 'rgba(244, 114, 182, 0.75)', label: 'Hilbert', width: 1.5 },
        ], { zeroline: true, sweepDot: true });

        // Panel 1: Envelope wrapping the detrended signal
        drawPanel(1, 'INSTANTANEOUS AMPLITUDE (ENVELOPE)', [
          { data: signal, color: isPriceMode ? 'rgba(251, 191, 36, 0.5)' : 'rgba(167, 139, 250, 0.5)', label: isPriceMode ? 'Detrended' : 'Signal', width: 1 },
          { data: hData.envelope, color: 'rgba(52, 211, 153, 0.9)', label: '+Envelope', width: 2.5, fill: 'rgba(52, 211, 153, 0.1)' },
          { data: hData.envelope.map(v => -v), color: 'rgba(52, 211, 153, 0.5)', label: '-Envelope', width: 1.5, dashPattern: [4, 4] },
        ], { zeroline: true, sweepDot: true });

        // Panel 2: Instantaneous Phase
        drawPanel(2, 'INSTANTANEOUS PHASE', [
          { data: hData.instPhase, color: 'rgba(96, 165, 250, 0.9)', label: 'Phase (rad)', width: 2, fill: 'rgba(96, 165, 250, 0.06)' },
        ], { zeroline: true, sweepDot: true });

        // Panel 3: Smoothed Instantaneous Frequency + dominant cycle annotation
        drawPanel(3, isPriceMode ? 'INSTANTANEOUS FREQUENCY (cycles/bar)' : 'INSTANTANEOUS FREQUENCY (cycles/sample)', [
          { data: hData.instFreq, color: 'rgba(248, 113, 113, 0.25)', label: 'Raw', width: 0.8 },
          { data: smoothFreq, color: 'rgba(248, 113, 113, 0.9)', label: 'Smoothed', width: 2, fill: 'rgba(248, 113, 113, 0.06)' },
        ], { zeroline: true, sweepDot: true, annotation: dominantPeriod > 1 ? `≈ ${dominantPeriod} bar cycle` : undefined });

        // ── Enhanced Analytic Signal inset ──
        const insetW = insetSize;
        const insetH = insetSize;
        const insetX = W - insetW - 10;
        const insetY = margin.top;

        // Inset background
        const insetBg = ctx.createLinearGradient(insetX, insetY, insetX + insetW, insetY + insetH);
        insetBg.addColorStop(0, 'rgba(10, 5, 20, 0.85)');
        insetBg.addColorStop(1, 'rgba(15, 10, 30, 0.85)');
        ctx.fillStyle = insetBg;
        ctx.beginPath();
        ctx.roundRect(insetX - 6, insetY - 18, insetW + 12, insetH + 24, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(insetX - 6, insetY - 18, insetW + 12, insetH + 24, 8);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText('ANALYTIC SIGNAL', insetX + 2, insetY - 6);

        // Find range for the detrended/oscillatory signal
        let aMin = Infinity, aMax = -Infinity;
        for (let i = 0; i < N; i++) {
          const r = signal[i], im = hilbert[i];
          if (isFinite(r)) { aMin = Math.min(aMin, r); aMax = Math.max(aMax, r); }
          if (isFinite(im)) { aMin = Math.min(aMin, im); aMax = Math.max(aMax, im); }
        }
        const aRange = aMax - aMin || 1;
        const aCx = insetX + insetW / 2;
        const aCy = insetY + insetH / 2;
        const aScale = (insetW * 0.42) / (aRange / 2);

        // Radial grid
        for (let r = 1; r <= 3; r++) {
          const radius = (r / 3) * (insetW * 0.42);
          ctx.beginPath();
          ctx.arc(aCx, aCy, radius, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.06)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Cross hairs
        ctx.beginPath();
        ctx.moveTo(insetX + 4, aCy);
        ctx.lineTo(insetX + insetW - 4, aCy);
        ctx.moveTo(aCx, insetY + 4);
        ctx.lineTo(aCx, insetY + insetH - 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Axes labels
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Re', insetX + insetW - 12, aCy - 4);
        ctx.fillText('Im', aCx + 4, insetY + 10);
        ctx.textAlign = 'left';

        // Trace path with gradient by time
        const dc = (aMax + aMin) / 2;
        for (let i = 1; i < N; i++) {
          const p1x = aCx + (signal[i - 1] - dc) * aScale;
          const p1y = aCy - hilbert[i - 1] * aScale;
          const p2x = aCx + (signal[i] - dc) * aScale;
          const p2y = aCy - hilbert[i] * aScale;
          const progress = i / N;
          ctx.beginPath();
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2x, p2y);
          ctx.strokeStyle = `rgba(167, 139, 250, ${0.1 + progress * 0.6})`;
          ctx.lineWidth = 0.8 + progress * 1.2;
          ctx.stroke();
        }

        // Current point on analytic signal
        if (sweepIdx < N) {
          const px = aCx + (signal[sweepIdx] - dc) * aScale;
          const py2 = aCy - hilbert[sweepIdx] * aScale;

          // Trail (last 20 points)
          for (let k = Math.max(0, sweepIdx - 20); k < sweepIdx; k++) {
            const kx = aCx + (signal[k] - dc) * aScale;
            const ky = aCy - hilbert[k] * aScale;
            const alpha = (k - (sweepIdx - 20)) / 20;
            ctx.beginPath();
            ctx.arc(kx, ky, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(167, 139, 250, ${alpha * 0.5})`;
            ctx.fill();
          }

          // Line from origin
          ctx.beginPath();
          ctx.moveTo(aCx, aCy);
          ctx.lineTo(px, py2);
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Main dot
          ctx.beginPath();
          ctx.arc(px, py2, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#a78bfa';
          ctx.shadowColor = '#a78bfa';
          ctx.shadowBlur = 16;
          ctx.fill();
          ctx.shadowBlur = 0;

          // Envelope circle
          const env = hData.envelope[sweepIdx];
          if (isFinite(env)) {
            ctx.beginPath();
            ctx.arc(aCx, aCy, env * aScale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(52, 211, 153, 0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Value readouts
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.fillText(`A: ${env?.toFixed(2) ?? '—'}`, insetX + 2, insetY + insetH + 2);
          ctx.fillText(`φ: ${hData.instPhase[sweepIdx]?.toFixed(2) ?? '—'} rad`, insetX + insetW * 0.45, insetY + insetH + 2);
        }

        if (playing) timeRef.current += 0.03;
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // ───────────────────────────────────────────────────────────────
      // FOURIER TRANSFORM MODE (original epicycles visualization)
      // ───────────────────────────────────────────────────────────────
      let coeffs: FourierCoeff[];
      let dc = 0;
      let priceCloses: number[] | null = null;

      if (isPriceMode) {
        if (!priceDFT) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = '14px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(priceLoading ? 'Loading price data...' : 'No price data available', W / 2, H / 2);
          ctx.textAlign = 'left';
          animRef.current = requestAnimationFrame(draw);
          return;
        }
        coeffs = priceDFT.coeffs;
        dc = priceDFT.dc;
        priceCloses = priceDFT.closes;
      } else {
        coeffs = waveType === 'custom' ? customCoeffs : getSyntheticCoefficients(waveType, numTerms);
      }

      if (coeffs.length === 0) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const t = timeRef.current;
      const epicenterX = W * 0.22;
      const epicenterY = H * 0.45;
      const waveStartX = W * 0.42;
      const waveEndX = W * 0.98;
      const waveWidth = waveEndX - waveStartX;
      const spectrumY = H * 0.84;
      const spectrumH = H * 0.12;

      // Scale for price mode
      let scaleFactor = 1;
      if (isPriceMode && priceCloses) {
        const maxCoeffAmp = coeffs.reduce((mx, c) => Math.max(mx, c.amp), 0);
        const availableRadius = Math.min(W * 0.18, H * 0.35);
        scaleFactor = maxCoeffAmp > 0 ? availableRadius / maxCoeffAmp : 1;
      }

      // Draw epicycles
      let x = epicenterX;
      let y = epicenterY;

      for (let i = 0; i < coeffs.length; i++) {
        const { freq, amp, phase } = coeffs[i];
        const radius = isPriceMode ? amp * scaleFactor : amp * amplitude;
        const angle = freq * t + phase;
        const color = COLORS[i % COLORS.length];

        ctx.beginPath();
        ctx.arc(x, y, Math.max(radius, 0.5), 0, Math.PI * 2);
        ctx.strokeStyle = `${color}33`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const nx = x + radius * Math.cos(angle);
        const ny = isPriceMode ? y - radius * Math.sin(angle) : y + radius * Math.sin(angle);

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = `${color}aa`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        x = nx;
        y = ny;
      }

      const finalY = y;

      // Connecting line
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(waveStartX, y);
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Trail
      trailRef.current.unshift(finalY);
      const maxTrail = Math.floor(waveWidth);
      if (trailRef.current.length > maxTrail) trailRef.current.length = maxTrail;

      if (trailRef.current.length > 1) {
        ctx.beginPath();
        ctx.moveTo(waveStartX, trailRef.current[0]);
        for (let i = 1; i < trailRef.current.length; i++) {
          ctx.lineTo(waveStartX + i, trailRef.current[i]);
        }
        const grad = ctx.createLinearGradient(waveStartX, 0, waveEndX, 0);
        grad.addColorStop(0, 'rgba(139, 92, 246, 0.9)');
        grad.addColorStop(0.5, 'rgba(52, 211, 153, 0.6)');
        grad.addColorStop(1, 'rgba(52, 211, 153, 0.05)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(waveStartX, trailRef.current[0], 4, 0, Math.PI * 2);
        ctx.fillStyle = '#a78bfa';
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Price mode: original + reconstructed price curves
      if (isPriceMode && priceCloses && priceCloses.length > 2) {
        const N = priceCloses.length;
        const pMin = Math.min(...priceCloses);
        const pMax = Math.max(...priceCloses);
        const pRange = pMax - pMin || 1;
        const chartTop = 30;
        const chartBot = spectrumY - spectrumH - 20;
        const chartH = chartBot - chartTop;

        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const px = waveStartX + (i / (N - 1)) * waveWidth;
          const py = chartBot - ((priceCloses[i] - pMin) / pRange) * chartH;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const tSample = (2 * Math.PI * i) / N;
          const val = reconstructSignal(coeffs, dc, tSample);
          const px = waveStartX + (i / (N - 1)) * waveWidth;
          const py = chartBot - ((val - pMin) / pRange) * chartH;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(251, 191, 36, 0.5)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText('─ ORIGINAL PRICE', waveStartX, chartTop - 5);
        ctx.fillStyle = 'rgba(139, 92, 246, 0.7)';
        ctx.fillText(`─ RECONSTRUCTED (${coeffs.length} terms)`, waveStartX + 140, chartTop - 5);

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(pMax.toFixed(2), waveStartX - 5, chartTop + 4);
        ctx.fillText(pMin.toFixed(2), waveStartX - 5, chartBot + 4);
        ctx.textAlign = 'left';
      }

      // Component waves (synthetic only)
      if (!isPriceMode && showComponents && coeffs.length > 1) {
        for (let ci = 0; ci < Math.min(coeffs.length, 8); ci++) {
          const { freq, amp, phase } = coeffs[ci];
          const color = COLORS[ci % COLORS.length];
          ctx.beginPath();
          for (let px = 0; px < waveWidth; px++) {
            const tt = t - px * 0.02;
            const val = epicenterY + amp * amplitude * Math.sin(freq * tt + phase);
            if (px === 0) ctx.moveTo(waveStartX + px, val);
            else ctx.lineTo(waveStartX + px, val);
          }
          ctx.strokeStyle = `${color}30`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Frequency spectrum
      const displayCoeffs = coeffs.slice(0, Math.min(coeffs.length, 30));
      const barW = Math.max(6, Math.min(30, (waveWidth - 20) / displayCoeffs.length - 4));
      const totalBarWidth = displayCoeffs.length * (barW + 4);
      const specStartX = waveStartX + (waveWidth - totalBarWidth) / 2;

      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(isPriceMode ? 'DOMINANT FREQUENCIES' : 'FREQUENCY SPECTRUM', specStartX, spectrumY - spectrumH - 6);

      ctx.beginPath();
      ctx.moveTo(specStartX - 4, spectrumY);
      ctx.lineTo(specStartX + totalBarWidth + 4, spectrumY);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const maxBarAmp = displayCoeffs.reduce((mx, c) => Math.max(mx, Math.abs(c.amp)), 0.001);

      for (let i = 0; i < displayCoeffs.length; i++) {
        const { freq, amp } = displayCoeffs[i];
        const normAmp = Math.abs(amp) / maxBarAmp;
        const barH = normAmp * spectrumH * 0.9;
        const bx = specStartX + i * (barW + 4);
        const color = COLORS[i % COLORS.length];

        ctx.fillStyle = `${color}15`;
        ctx.fillRect(bx, spectrumY - spectrumH, barW, spectrumH);

        const barGrad = ctx.createLinearGradient(0, spectrumY - barH, 0, spectrumY);
        barGrad.addColorStop(0, `${color}cc`);
        barGrad.addColorStop(1, `${color}44`);
        ctx.fillStyle = barGrad;
        ctx.fillRect(bx, spectrumY - barH, barW, barH);

        ctx.beginPath();
        ctx.moveTo(bx, spectrumY - barH);
        ctx.lineTo(bx + barW, spectrumY - barH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        if (isPriceMode && priceCloses) {
          const period = Math.round(priceCloses.length / freq);
          ctx.fillText(`${period}`, bx + barW / 2, spectrumY + 11);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.font = '7px "JetBrains Mono", monospace';
          ctx.fillText('bars', bx + barW / 2, spectrumY + 19);
        } else {
          ctx.fillText(`${freq}×`, bx + barW / 2, spectrumY + 12);
        }
        ctx.textAlign = 'left';
      }

      // Labels
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText('EPICYCLES', epicenterX - 30, 20);
      if (!isPriceMode) ctx.fillText('COMPOSITE WAVE', waveStartX, 20);

      ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
      ctx.beginPath();
      ctx.roundRect(epicenterX - 35, 28, 70, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#a78bfa';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${coeffs.length} terms`, epicenterX, 41);
      ctx.textAlign = 'left';

      if (playing) timeRef.current += 0.03 * speed;
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animRef.current); obs.disconnect(); };
  }, [numTerms, speed, waveType, transformMode, playing, showComponents, amplitude, customCoeffs, priceDFT, priceHilbert, syntheticHilbert, priceLoading]);

  const reset = () => { timeRef.current = 0; trailRef.current = []; };
  const isPriceMode = waveType === 'price';
  const isHilbert = transformMode === 'hilbert';
  const tfLabels: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 60: '1H', 240: '4H', 1440: '1D' };

  return (
    <div className="p-4 space-y-3 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-linear-to-br from-violet-500/30 to-teal-500/30 flex items-center justify-center">
          <Waves className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold bg-linear-to-r from-white to-white/60 bg-clip-text text-transparent">
            {isHilbert ? 'Hilbert Transform' : 'Fourier Transform'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isHilbert
              ? 'Analytic signal → instantaneous amplitude, phase & frequency'
              : isPriceMode
                ? 'Decompose price into dominant frequency components'
                : 'Any periodic signal = sum of sine waves'}
          </p>
        </div>
        <Badge variant="outline" className="ml-auto text-[10px] border-violet-500/30 text-violet-400">
          {isHilbert ? 'Analytic Signal' : isPriceMode ? 'Price Decomposition' : 'Interactive'}
        </Badge>
      </div>

      {/* Controls */}
      <Card className="glass rounded-2xl gradient-border shrink-0">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Transform mode toggle */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono">TRANSFORM</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={transformMode === 'fourier' ? 'default' : 'ghost'}
                  className={`h-6 px-2.5 text-[10px] font-mono ${
                    transformMode === 'fourier'
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => { setTransformMode('fourier'); reset(); }}
                >
                  Fourier
                </Button>
                <Button
                  size="sm"
                  variant={transformMode === 'hilbert' ? 'default' : 'ghost'}
                  className={`h-6 px-2.5 text-[10px] font-mono ${
                    transformMode === 'hilbert'
                      ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => { setTransformMode('hilbert'); reset(); }}
                >
                  Hilbert
                </Button>
              </div>
            </div>

            {/* Separator */}
            <div className="w-px h-5 bg-white/10" />

            {/* Wave / signal source */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono">SIGNAL</span>
              <div className="flex gap-1">
                {(['square', 'sawtooth', 'triangle', 'custom', 'price'] as WaveType[]).map(w => (
                  <Button
                    key={w}
                    size="sm"
                    variant={waveType === w ? 'default' : 'ghost'}
                    className={`h-6 px-2 text-[10px] font-mono capitalize ${
                      waveType === w
                        ? w === 'price'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                        : 'text-muted-foreground'
                    }`}
                    onClick={() => {
                      setWaveType(w);
                      if (w === 'custom') regenerateCustom();
                      reset();
                    }}
                  >
                    {w === 'price' && <CandlestickChart className="h-3 w-3 mr-1" />}
                    {w}
                  </Button>
                ))}
              </div>
            </div>

            {/* Price controls */}
            {isPriceMode && (
              <>
                <div className="flex items-center gap-2">
                  <Select value={priceSymbol} onValueChange={v => { setPriceSymbol(v); reset(); }}>
                    <SelectTrigger className="h-7 w-[90px] text-[10px] font-mono bg-black/30 border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {instruments.map(inst => (
                        <SelectItem key={inst.symbol} value={inst.symbol} className="text-xs font-mono">
                          {inst.symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-0.5">
                  {Object.entries(tfLabels).map(([mins, label]) => (
                    <Button
                      key={mins}
                      size="sm"
                      variant={priceTimeframe === Number(mins) ? 'default' : 'ghost'}
                      className={`h-5 px-1.5 text-[9px] font-mono ${
                        priceTimeframe === Number(mins)
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'text-muted-foreground'
                      }`}
                      onClick={() => { setPriceTimeframe(Number(mins)); reset(); }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {priceLoading && <Loader2 className="h-3 w-3 animate-spin text-amber-400" />}
              </>
            )}

            {/* Terms slider (Fourier mode) */}
            {!isHilbert && (
              <div className="flex items-center gap-2 min-w-[150px]">
                <span className="text-[10px] text-muted-foreground font-mono">TERMS</span>
                <Slider
                  value={[numTerms]}
                  onValueChange={([v]) => {
                    setNumTerms(v);
                    if (waveType === 'custom') regenerateCustom();
                    if (isPriceMode) reset();
                  }}
                  min={1}
                  max={isPriceMode ? 50 : 20}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs font-mono text-violet-400 w-6 text-right">{numTerms}</span>
              </div>
            )}

            {/* Speed */}
            <div className="flex items-center gap-2 min-w-[100px]">
              <span className="text-[10px] text-muted-foreground font-mono">SPD</span>
              <Slider
                value={[speed]}
                onValueChange={([v]) => setSpeed(v)}
                min={0.1}
                max={3}
                step={0.1}
                className="flex-1"
              />
              <span className="text-xs font-mono text-teal-400 w-6 text-right">{speed.toFixed(1)}×</span>
            </div>

            {/* Amplitude (synthetic fourier only) */}
            {!isPriceMode && !isHilbert && (
              <div className="flex items-center gap-2 min-w-[100px]">
                <span className="text-[10px] text-muted-foreground font-mono">AMP</span>
                <Slider
                  value={[amplitude]}
                  onValueChange={([v]) => setAmplitude(v)}
                  min={30}
                  max={200}
                  step={5}
                  className="flex-1"
                />
                <span className="text-xs font-mono text-amber-400 w-6 text-right">{amplitude}</span>
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-1 ml-auto">
              {!isPriceMode && !isHilbert && (
                <Button
                  size="sm" variant="ghost"
                  className={`h-7 w-7 p-0 ${showComponents ? 'text-teal-400' : 'text-muted-foreground'}`}
                  onClick={() => setShowComponents(v => !v)}
                  title="Toggle component waves"
                >
                  <Zap className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPlaying(v => !v)}>
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Canvas */}
      <Card className="glass rounded-2xl gradient-border flex-1 min-h-0 overflow-hidden">
        <CardHeader className="py-1.5 px-4 border-b border-white/5 shrink-0">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Waves className="h-3 w-3 text-violet-400" />
            {isHilbert ? (
              <>
                Hilbert Transform — {isPriceMode ? `${priceSymbol} @ ${tfLabels[priceTimeframe]}` : `${waveType} wave`}
                <span className="ml-auto text-[10px] text-muted-foreground/60">
                  z(t) = x(t) + iH[x(t)]  →  A(t)e^(iφ(t))
                </span>
              </>
            ) : isPriceMode ? (
              <>
                <CandlestickChart className="h-3 w-3 text-amber-400" />
                {priceSymbol} @ {tfLabels[priceTimeframe]} — {numTerms} components
                {priceDFT && (
                  <Badge variant="outline" className="ml-2 text-[9px] border-amber-500/30 text-amber-400">
                    {priceDFT.closes.length} bars → DFT
                  </Badge>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground/60">
                  Price(t) = DC + Σ Aₖ cos(2πfₖt + φₖ)
                </span>
              </>
            ) : (
              <>
                {waveType.charAt(0).toUpperCase() + waveType.slice(1)} Wave — {numTerms} harmonics
                <span className="ml-auto text-[10px] text-muted-foreground/60">
                  {waveType === 'square' ? 'f(t) = Σ sin((2k+1)t) / (2k+1)'
                    : waveType === 'sawtooth' ? 'f(t) = Σ sin(kt) / k'
                    : waveType === 'triangle' ? 'f(t) = Σ (-1)^k sin((2k+1)t) / (2k+1)²'
                    : 'f(t) = Σ aₖ sin(kωt + φₖ)'}
                </span>
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex-1 h-full min-h-0">
          <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
        </CardContent>
      </Card>
    </div>
  );
}
