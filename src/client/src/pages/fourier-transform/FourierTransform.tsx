import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Waves, CandlestickChart } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { WaveType, TransformMode, FourierCoeff, InstrumentInfo } from './types';
import {
  getSyntheticCoefficients, computeDFT,
  computeHilbert, detrend,
} from './math';
import { TF_LABELS } from './constants';
import { minutesToApiKey } from '@/lib/timeframes';
import { chartApi } from '@/lib/api_service';
import { FourierControls } from './FourierControls';
import { FourierCanvas } from './FourierCanvas';
import { HilbertAnalytics } from './HilbertAnalytics';
import { PriceFourierInfo } from './PriceFourierInfo';

export default function FourierTransform() {
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
      const tfStr = minutesToApiKey(priceTimeframe);
      const data = await chartApi.getOhlcv({ symbol: priceSymbol, timeframe: tfStr, limit: '512' });
      const rows = (data as any)?.data ?? data;
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

  // Hilbert on price data
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

  const reset = () => { timeRef.current = 0; trailRef.current = []; };
  const isPriceMode = waveType === 'price';
  const isHilbert = transformMode === 'hilbert';

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
      <FourierControls
        transformMode={transformMode}
        setTransformMode={setTransformMode}
        waveType={waveType}
        setWaveType={setWaveType}
        isPriceMode={isPriceMode}
        isHilbert={isHilbert}
        priceSymbol={priceSymbol}
        setPriceSymbol={setPriceSymbol}
        priceTimeframe={priceTimeframe}
        setPriceTimeframe={setPriceTimeframe}
        priceLoading={priceLoading}
        instruments={instruments}
        numTerms={numTerms}
        setNumTerms={setNumTerms}
        speed={speed}
        setSpeed={setSpeed}
        amplitude={amplitude}
        setAmplitude={setAmplitude}
        showComponents={showComponents}
        setShowComponents={setShowComponents}
        playing={playing}
        setPlaying={setPlaying}
        regenerateCustom={regenerateCustom}
        reset={reset}
      />

      {/* Canvas */}
      <Card className="glass rounded-2xl gradient-border flex-1 min-h-0 overflow-hidden">
        <CardHeader className="py-1.5 px-4 border-b border-white/5 shrink-0">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Waves className="h-3 w-3 text-violet-400" />
            {isHilbert ? (
              <>
                Hilbert Transform — {isPriceMode ? `${priceSymbol} @ ${TF_LABELS[priceTimeframe]}` : `${waveType} wave`}
                <span className="ml-auto text-[10px] text-muted-foreground/60">
                  z(t) = x(t) + iH[x(t)]  →  A(t)e^(iφ(t))
                </span>
              </>
            ) : isPriceMode ? (
              <>
                <CandlestickChart className="h-3 w-3 text-amber-400" />
                {priceSymbol} @ {TF_LABELS[priceTimeframe]} — {numTerms} components
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
          <FourierCanvas
            numTerms={numTerms}
            speed={speed}
            waveType={waveType}
            transformMode={transformMode}
            playing={playing}
            showComponents={showComponents}
            amplitude={amplitude}
            customCoeffs={customCoeffs}
            priceDFT={priceDFT}
            priceHilbert={priceHilbert}
            syntheticHilbert={syntheticHilbert}
            priceLoading={priceLoading}
            priceSymbol={priceSymbol}
            priceTimeframe={priceTimeframe}
            timeRef={timeRef}
            trailRef={trailRef}
          />
        </CardContent>
      </Card>

      {/* Analytics Overlays */}
      {isHilbert && (
        <HilbertAnalytics 
          hData={isPriceMode ? priceHilbert : syntheticHilbert} 
          isPriceMode={isPriceMode} 
        />
      )}
      {!isHilbert && isPriceMode && priceDFT && (
        <PriceFourierInfo 
          priceDFT={priceDFT} 
          numTerms={numTerms} 
        />
      )}
    </div>
  );
}
