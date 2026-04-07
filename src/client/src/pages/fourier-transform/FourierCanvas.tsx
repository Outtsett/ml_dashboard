import React, { useEffect, useRef, useMemo } from 'react';
import { SPECTRUM_COLORS } from './constants';
import { 
  getSyntheticCoefficients, 
  reconstructSignal, 
  smooth 
} from './math';
import type { WaveType, TransformMode, FourierCoeff } from './types';

// Particle definition for insane visuals
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  decay: number;
}

interface FourierCanvasProps {
  numTerms: number;
  speed: number;
  waveType: WaveType;
  transformMode: TransformMode;
  playing: boolean;
  showComponents: boolean;
  amplitude: number;
  customCoeffs: FourierCoeff[];
  priceDFT: any;
  priceHilbert: any;
  syntheticHilbert: any;
  priceLoading: boolean;
  priceSymbol: string;
  priceTimeframe: number;
  timeRef: React.MutableRefObject<number>;
  trailRef: React.MutableRefObject<number[]>;
}

export const FourierCanvas: React.FC<FourierCanvasProps> = ({
  numTerms,
  speed,
  waveType,
  transformMode,
  playing,
  showComponents,
  amplitude,
  customCoeffs,
  priceDFT,
  priceHilbert,
  syntheticHilbert,
  priceLoading,
  priceSymbol,
  priceTimeframe,
  timeRef,
  trailRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  // Pre-calculate expensive math that only depends on incoming data
  const processedHilbert = useMemo(() => {
    const hData = waveType === 'price' ? priceHilbert : syntheticHilbert;
    if (!hData || !hData.original || hData.original.length === 0) return null;

    const smoothFreq = smooth(hData.instFreq, 7);
    const absFreqs = smoothFreq.filter((f: number) => isFinite(f) && Math.abs(f) > 0.005);
    absFreqs.sort((a: number, b: number) => Math.abs(b) - Math.abs(a));
    const dominantFreq = absFreqs.length > 0 ? Math.abs(absFreqs[Math.floor(absFreqs.length * 0.25)]!) : 0;
    const dominantPeriod = dominantFreq > 0 ? Math.round(1 / dominantFreq) : 0;

    return {
      hData,
      smoothFreq,
      dominantPeriod
    };
  }, [priceHilbert, syntheticHilbert, waveType]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let dpr = window.devicePixelRatio || 1;

    let particles: Particle[] = [];

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

      // Dynamic Motion Blur / Dark background
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(5, 5, 8, 0.4)';
      ctx.fillRect(0, 0, W, H);

      const t = timeRef.current;

      // Cyber-grid background
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.05)';
      ctx.lineWidth = 1;
      const offset = (t * 20) % 40;
      ctx.beginPath();
      for(let x = offset; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for(let y = offset; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      // Glowing orb in the center
      const bgGrad = ctx.createRadialGradient(W*0.3, H*0.5, 0, W*0.3, H*0.5, Math.max(W, H)*0.7);
      bgGrad.addColorStop(0, 'rgba(139, 92, 246, 0.12)');
      bgGrad.addColorStop(0.4, 'rgba(52, 211, 153, 0.03)');
      bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      const isPriceMode = waveType === 'price';
      const isHilbert = transformMode === 'hilbert';

      if (isHilbert) {
        if (!processedHilbert) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.font = '14px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            isPriceMode && priceLoading ? 'INITIALIZING QUANTUM DATA...' : 'COMPUTING HILBERT TRANSFORM...',
            W / 2, H / 2
          );
          ctx.textAlign = 'left';
          animRef.current = requestAnimationFrame(draw);
          return;
        }

        const { hData, smoothFreq, dominantPeriod } = processedHilbert;
        const N = hData.original.length;
        const margin = { top: 30, right: 20, bottom: 10, left: 60 };
        const insetSize = Math.min(220, W * 0.25);
        const plotW = W - margin.left - margin.right - insetSize - 20;
        const panelCount = 4;
        const gap = 20;
        const panelH = (H - margin.top - margin.bottom - gap * (panelCount - 1)) / panelCount;

        const sweepIdx = Math.floor((t * speed * 3) % N);

        const drawPanel = (
          panelIdx: number,
          title: string,
          series: { data: number[]; color: string; label: string; width?: number; fill?: string; dashPattern?: number[] }[],
          opts?: { zeroline?: boolean; sweepDot?: boolean; annotation?: string }
        ) => {
          const py = margin.top + panelIdx * (panelH + gap);

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
          const padded = yRange * 0.15;
          yMin -= padded;
          yMax += padded;
          const totalRange = yMax - yMin;

          const toX = (i: number) => margin.left + (i / (N - 1)) * plotW;
          const toY = (v: number) => py + panelH - ((v - yMin) / totalRange) * panelH;

          // Panel background
          const panelBgGrad = ctx.createLinearGradient(margin.left, py, margin.left, py + panelH);
          panelBgGrad.addColorStop(0, 'rgba(139, 92, 246, 0.05)');
          panelBgGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
          panelBgGrad.addColorStop(1, 'rgba(52, 211, 153, 0.02)');
          ctx.fillStyle = panelBgGrad;
          ctx.beginPath();
          ctx.roundRect(margin.left - 4, py - 2, plotW + 8, panelH + 4, 8);
          ctx.fill();

          ctx.beginPath();
          ctx.roundRect(margin.left - 4, py - 2, plotW + 8, panelH + 4, 8);
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.15)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Grid lines
          ctx.beginPath();
          for (let g = 0; g <= 4; g++) {
            const gy = py + (g / 4) * panelH;
            ctx.moveTo(margin.left, gy);
            ctx.lineTo(margin.left + plotW, gy);
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Zero line
          if (opts?.zeroline && yMin < 0 && yMax > 0) {
            const zy = toY(0);
            ctx.beginPath();
            ctx.moveTo(margin.left, zy);
            ctx.lineTo(margin.left + plotW, zy);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Glowing Title
          ctx.shadowBlur = 8;
          ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.fillText(title, margin.left + 2, py - 8);
          ctx.shadowBlur = 0;

          // Annotation
          if (opts?.annotation) {
            ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
            const tw = ctx.measureText(opts.annotation).width + 16;
            ctx.beginPath();
            ctx.roundRect(margin.left + plotW - tw - 4, py + 4, tw + 8, 22, 6);
            ctx.fill();
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(167, 139, 250, 0.8)';
            ctx.fillStyle = 'rgba(167, 139, 250, 1)';
            ctx.font = 'bold 11px "JetBrains Mono", monospace';
            ctx.fillText(opts.annotation, margin.left + plotW - tw, py + 18);
            ctx.shadowBlur = 0;
          }

          // Y-axis labels
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          ctx.fillText((yMin + totalRange).toFixed(isPriceMode ? 1 : 3), margin.left - 8, py + 6);
          ctx.fillText((yMin + totalRange / 2).toFixed(isPriceMode ? 1 : 3), margin.left - 8, py + panelH / 2 + 3);
          ctx.fillText(yMin.toFixed(isPriceMode ? 1 : 3), margin.left - 8, py + panelH);
          ctx.textAlign = 'left';

          // Fills & Lines
          for (const s of series) {
            if (s.fill) {
              ctx.beginPath();
              let started = false;
              for (let i = 0; i < N; i++) {
                if (!isFinite(s.data[i]!)) continue;
                const px = toX(i);
                const ppy = toY(s.data[i]!);
                if (!started) { ctx.moveTo(px, ppy); started = true; }
                else ctx.lineTo(px, ppy);
              }
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

            if (s.dashPattern) ctx.setLineDash(s.dashPattern);

            // Core stroke
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < N; i++) {
              if (!isFinite(s.data[i]!)) continue;
              const px = toX(i);
              const ppy = toY(s.data[i]!);
              if (!started) { ctx.moveTo(px, ppy); started = true; }
              else ctx.lineTo(px, ppy);
            }
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.width ?? 1.5;
            ctx.stroke();

            if (s.dashPattern) ctx.setLineDash([]);
          }

          // Laser Sweep line
          if (opts?.sweepDot && sweepIdx < N) {
            const sx = toX(sweepIdx);
            ctx.beginPath();
            ctx.moveTo(sx, py);
            ctx.lineTo(sx, py + panelH);
            const laserGrad = ctx.createLinearGradient(sx, py, sx, py + panelH);
            laserGrad.addColorStop(0, 'rgba(139, 92, 246, 0)');
            laserGrad.addColorStop(0.5, 'rgba(139, 92, 246, 0.9)');
            laserGrad.addColorStop(1, 'rgba(139, 92, 246, 0)');
            ctx.strokeStyle = laserGrad;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#a78bfa';
            ctx.stroke();
            ctx.shadowBlur = 0;

            for (const s of series) {
              if (!isFinite(s.data[sweepIdx]!)) continue;
              const dotY = toY(s.data[sweepIdx]!);
              ctx.beginPath();
              ctx.arc(sx, dotY, 4, 0, Math.PI * 2);
              ctx.fillStyle = '#fff';
              ctx.shadowColor = s.color;
              ctx.shadowBlur = 15;
              ctx.fill();
              ctx.shadowBlur = 0;
            }
          }
        };

        const signal = isPriceMode && (hData as any).detrended ? (hData as any).detrended : hData.original;
        const hilbert = hData.hilbert;

        drawPanel(0, isPriceMode ? 'DETRENDED PRICE + HILBERT TRANSFORM' : 'SIGNAL + HILBERT TRANSFORM', [
          { data: signal, color: isPriceMode ? 'rgba(251, 191, 36, 1)' : 'rgba(167, 139, 250, 1)', label: isPriceMode ? 'Detrended' : 'Signal', width: 2.5, fill: isPriceMode ? 'rgba(251, 191, 36, 0.15)' : 'rgba(167, 139, 250, 0.15)' },
          { data: hilbert, color: 'rgba(244, 114, 182, 0.9)', label: 'Hilbert', width: 2 },
        ], { zeroline: true, sweepDot: true });

        drawPanel(1, 'INSTANTANEOUS AMPLITUDE (ENVELOPE)', [
          { data: signal, color: isPriceMode ? 'rgba(251, 191, 36, 0.4)' : 'rgba(167, 139, 250, 0.4)', label: isPriceMode ? 'Detrended' : 'Signal', width: 1.5 },
          { data: hData.envelope, color: 'rgba(52, 211, 153, 1)', label: '+Envelope', width: 3, fill: 'rgba(52, 211, 153, 0.2)' },
          { data: hData.envelope.map((v: number) => -v), color: 'rgba(52, 211, 153, 0.7)', label: '-Envelope', width: 2, dashPattern: [6, 6] },
        ], { zeroline: true, sweepDot: true });

        drawPanel(2, 'INSTANTANEOUS PHASE', [
          { data: hData.instPhase, color: 'rgba(96, 165, 250, 1)', label: 'Phase (rad)', width: 2.5, fill: 'rgba(96, 165, 250, 0.15)' },
        ], { zeroline: true, sweepDot: true });

        drawPanel(3, isPriceMode ? 'INSTANTANEOUS FREQUENCY (cycles/bar)' : 'INSTANTANEOUS FREQUENCY (cycles/sample)', [
          { data: hData.instFreq, color: 'rgba(248, 113, 113, 0.3)', label: 'Raw', width: 1 },
          { data: smoothFreq, color: 'rgba(248, 113, 113, 1)', label: 'Smoothed', width: 3, fill: 'rgba(248, 113, 113, 0.15)' },
        ], { zeroline: true, sweepDot: true, annotation: dominantPeriod > 1 ? `â‰ˆ ${dominantPeriod} bar cycle` : undefined });

        // Inset logic (Simplified for perf)
        const insetW = insetSize, insetH = insetSize;
        const insetX = W - insetW - 10, insetY = margin.top;
        ctx.fillStyle = 'rgba(15, 10, 30, 0.95)';
        ctx.beginPath();
        ctx.roundRect(insetX - 10, insetY - 20, insetW + 20, insetH + 30, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const aCx = insetX + insetW / 2, aCy = insetY + insetH / 2;
        ctx.beginPath();
        ctx.moveTo(insetX + 10, aCy); ctx.lineTo(insetX + insetW - 10, aCy);
        ctx.moveTo(aCx, insetY + 10); ctx.lineTo(aCx, insetY + insetH - 10);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.stroke();

        let aMin = Infinity, aMax = -Infinity;
        for (let i = 0; i < N; i++) {
          const r = signal[i]!, im = hilbert[i]!;
          if (isFinite(r)) { aMin = Math.min(aMin, r); aMax = Math.max(aMax, r); }
          if (isFinite(im)) { aMin = Math.min(aMin, im); aMax = Math.max(aMax, im); }
        }
        const aScale = (insetW * 0.42) / ((aMax - aMin || 1) / 2);
        const dc_inset = (aMax + aMin) / 2;

        ctx.beginPath();
        for (let i = 1; i < N; i++) {
          const p1x = aCx + (signal[i - 1] - dc_inset) * aScale;
          const p1y = aCy - hilbert[i - 1]! * aScale;
          const p2x = aCx + (signal[i] - dc_inset) * aScale;
          const p2y = aCy - hilbert[i]! * aScale;
          const progress = i / N;
          const hue = (progress * 360 + t * 50) % 360;
          ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${0.2 + progress * 0.8})`;
          ctx.lineWidth = 1.5 + progress * 2.5;
          ctx.beginPath();
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2x, p2y);
          ctx.stroke();
        }
      } else {
        // FOURIER MODE
        let coeffs: FourierCoeff[];
        let dc = 0;
        let priceCloses: number[] | null = null;
        let rawPriceData: any[] | null = null;

        if (isPriceMode) {
          if (!priceDFT) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = 'bold 16px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(priceLoading ? 'INITIALIZING QUANTUM DATA...' : 'AWAITING FREQUENCY MATRIX...', W / 2, H / 2);
            animRef.current = requestAnimationFrame(draw);
            return;
          }
          coeffs = priceDFT.coeffs;
          dc = priceDFT.dc;
          priceCloses = priceDFT.closes;
          rawPriceData = priceDFT.raw;
        } else {
          coeffs = waveType === 'custom' ? customCoeffs : getSyntheticCoefficients(waveType, numTerms);
        }

        if (coeffs.length === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.font = '14px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('NO COEFFICIENTS GENERATED', W / 2, H / 2);
          animRef.current = requestAnimationFrame(draw);
          return;
        }

        const waveStartX = W * 0.42, waveEndX = W * 0.98, waveWidth = waveEndX - waveStartX;
        const spectrumY = H * 0.84, spectrumH = H * 0.14;
        let epicenterX = W * 0.22, epicenterY = H * 0.45, scaleFactor = 1;

        let pMin = 0, pMax = 1, pRange = 1;
        const chartTop = 40, chartBot = spectrumY - spectrumH - 30, chartH = chartBot - chartTop;

        if (isPriceMode && priceCloses && priceCloses.length > 2) {
          pMin = Math.min(...(rawPriceData ? rawPriceData.map((d: any) => d.low ?? d.close) : priceCloses));
          pMax = Math.max(...(rawPriceData ? rawPriceData.map((d: any) => d.high ?? d.close) : priceCloses));
          pRange = pMax - pMin || 1;
          epicenterY = chartBot - ((dc - pMin) / pRange) * chartH;
          scaleFactor = chartH / pRange;
        } else {
          const maxCoeffAmp = coeffs.reduce((mx, c) => Math.max(mx, c.amp), 0);
          scaleFactor = maxCoeffAmp > 0 ? (Math.min(W * 0.18, H * 0.35) / maxCoeffAmp) : 1;
        }

        let x = epicenterX, y = epicenterY;
        for (let i = 0; i < coeffs.length; i++) {
          const { freq, amp, phase } = coeffs[i]!;
          const radius = isPriceMode ? amp * scaleFactor : amp * amplitude;
          const angle = freq * t + phase;
          const color = SPECTRUM_COLORS[i % SPECTRUM_COLORS.length]!;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(radius, 0.5), 0, Math.PI * 2);
          ctx.strokeStyle = i < 3 ? color : `${color}55`;
          ctx.stroke();
          const nx = x + radius * (isPriceMode ? Math.sin(angle) : Math.cos(angle));
          const ny = y + radius * (isPriceMode ? -Math.cos(angle) : Math.sin(angle));
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(nx, ny);
          ctx.strokeStyle = '#fff';
          ctx.stroke();
          x = nx; y = ny;
        }

        const finalX = x, finalY = y;
        let scanX = waveStartX;
        if (isPriceMode) {
          scanX = waveStartX + ((t % (2 * Math.PI)) / (2 * Math.PI)) * waveWidth;
        }

        if (!isPriceMode) {
          trailRef.current.unshift(finalY);
          if (trailRef.current.length > waveWidth) trailRef.current.length = Math.floor(waveWidth);
          if (trailRef.current.length > 1) {
            ctx.beginPath();
            ctx.moveTo(waveStartX, trailRef.current[0]!);
            for (let i = 1; i < trailRef.current.length; i++) ctx.lineTo(waveStartX + i, trailRef.current[i]!);
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }

        if (isPriceMode && priceCloses) {
          const N = priceCloses.length;
          // Price candles (simplified)
          if (rawPriceData) {
            const candleW = Math.max(1, (waveWidth / N) * 0.6);
            for (let i = 0; i < N; i++) {
              const d = rawPriceData[i];
              const px = waveStartX + (i / (N - 1)) * waveWidth;
              const open = d.open ?? d.close, high = d.high ?? d.close, low = d.low ?? d.close, close = d.adjustedClose ?? d.close;
              const pyHigh = chartBot - ((high - pMin) / pRange) * chartH;
              const pyLow = chartBot - ((low - pMin) / pRange) * chartH;
              const pyOpen = chartBot - ((open - pMin) / pRange) * chartH;
              const pyClose = chartBot - ((close - pMin) / pRange) * chartH;
              ctx.fillStyle = close >= open ? 'rgba(52, 211, 153, 0.45)' : 'rgba(248, 113, 113, 0.45)';
              ctx.fillRect(px - candleW/2, Math.min(pyOpen, pyClose), candleW, Math.max(1, Math.abs(pyOpen - pyClose)));
              ctx.beginPath(); ctx.moveTo(px, pyHigh); ctx.lineTo(px, pyLow); ctx.stroke();
            }
          }
          // Reconstructed signal
          ctx.beginPath();
          for (let i = 0; i < N; i++) {
            const val = reconstructSignal(coeffs, dc, (2 * Math.PI * i) / N);
            const px = waveStartX + (i / (N - 1)) * waveWidth;
            const py = chartBot - ((val - pMin) / pRange) * chartH;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // Spectrum EQ
        const displayCoeffs = coeffs.slice(0, 30);
        const maxBarAmp = displayCoeffs.reduce((mx, c) => Math.max(mx, Math.abs(c.amp)), 0.001);
        const barW = Math.max(8, Math.min(35, (waveWidth - 30) / displayCoeffs.length - 6));
        const specStartX = waveStartX + (waveWidth - (displayCoeffs.length * (barW + 6))) / 2;
        for (let i = 0; i < displayCoeffs.length; i++) {
          const { freq, amp } = displayCoeffs[i]!;
          const barH = (Math.abs(amp) / maxBarAmp) * spectrumH;
          const bx = specStartX + i * (barW + 6);
          ctx.fillStyle = SPECTRUM_COLORS[i % SPECTRUM_COLORS.length]!;
          ctx.fillRect(bx, spectrumY - barH, barW, barH);
        }
      }

      // Particles
      for (let i=particles.length-1; i>=0; i--) {
        const p = particles[i]!;
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.vx *= p.decay; p.vy *= p.decay; p.life++;
        if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
        ctx.fillStyle = p.color; ctx.globalAlpha = 1 - (p.life / p.maxLife);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1.0;

      if (playing) timeRef.current += 0.03 * speed;
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      obs.disconnect();
    };
  }, [numTerms, speed, waveType, transformMode, playing, showComponents, amplitude, customCoeffs, priceDFT, priceHilbert, syntheticHilbert, priceLoading, processedHilbert]);

  return <canvas ref={canvasRef} className="w-full h-full rounded-2xl" style={{ display: 'block' }} />;
};
