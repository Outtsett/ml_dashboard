import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WaveType, TransformMode, FourierCoeff, InstrumentInfo, PriceCandle } from "./types";
import {
  getSyntheticCoefficients, computeDFT,
  computeHilbert, detrend, reconstructSignal
} from "./math";
import { minutesToApiKey } from "@/market/lib/timeframes";
import { chartApi, instrumentApi } from "@/infrastructure/api/api_service";

export function useFourierState() {
  const timeRef = useRef(0);
  const trailRef = useRef<number[]>([]);

  const [numTerms, setNumTerms] = useState(10); // Increased default terms
  const [speed, setSpeed] = useState(1);
  const [waveType, setWaveType] = useState<WaveType>("price");
  const [transformMode, setTransformMode] = useState<TransformMode>("fourier");
  const [playing, setPlaying] = useState(true);
  const [showComponents, setShowComponents] = useState(true);
  const [amplitude, setAmplitude] = useState(100);
  const [customCoeffs, setCustomCoeffs] = useState<FourierCoeff[]>([]);

  const [priceSymbol, setPriceSymbol] = useState("MNQ");
  const [priceTimeframe, setPriceTimeframe] = useState(60);

  const { data: rawInstruments } = useQuery<InstrumentInfo[]>({
    queryKey: ["/api/instruments"],
    queryFn: () => instrumentApi.getAll(),
  });
  const instruments = useMemo(() =>
    Array.isArray(rawInstruments) ? rawInstruments.sort((a, b) => a.symbol.localeCompare(b.symbol)) : [],
    [rawInstruments]
  );

  const hilbertLimit = 512; // Increased limit

  const { data: priceData, isLoading: priceLoading } = useQuery<PriceCandle[]>({
    queryKey: ["/api/charts/ohlcv", priceSymbol, priceTimeframe, "fourier-overhaul"],
    queryFn: async () => {
      const tfStr = minutesToApiKey(priceTimeframe);
      try {
        const data = await chartApi.getOhlcv({
          symbol: priceSymbol,
          timeframe: tfStr,
          limit: "1024", // Massive data for better resolution
          order: "asc"
        });
        const rows = Array.isArray(data) ? data : (data as { data?: unknown })?.data;
        return (Array.isArray(rows) ? rows : []) as PriceCandle[];
      } catch (err) {
        console.error("Fourier price fetch failed:", err);
        return [];
      }
    },
    enabled: waveType === "price",
    staleTime: 60_000,
  });

  // --- DFT Processing ---
  const priceDFT = useMemo(() => {
    if (waveType !== "price" || !priceData || priceData.length < 10) return null;

    const validData = priceData.filter((d) => {
      const c = d.adjustedClose ?? d.close;
      return c != null && !isNaN(c);
    });

    if (validData.length < 10) return null;
    const rawCloses = validData.map((d) => d.adjustedClose ?? d.close);
    
    // Detrending is essential for Fourier
    const { detrended, trend } = detrend(rawCloses);
    const result = computeDFT(detrended, 50); // Compute more bins, we'll pick top terms later
    
    // Create visualization series
    const N = detrended.length;
    const analysisSeries = detrended.map((val, i) => {
      const recon = reconstructSignal(result.coeffs.slice(0, numTerms), result.dc, (2 * Math.PI * i) / N);
      return {
        index: i,
        timestamp: validData[i]?.timestamp,
        input: val,
        reconstructed: recon,
        residual: val - recon,
        trend: trend[i],
        original: rawCloses[i]
      };
    });

    // Spectrum series (Amplitude vs Period)
    const spectrumSeries = result.coeffs
      .map(c => ({
        freq: c.freq,
        period: Number((N / c.freq).toFixed(1)),
        amp: c.amp,
        power: c.amp * c.amp,
        phase: c.phase
      }))
      .filter(s => s.period < N / 2 && s.period > 2) // Filter out DC and Nyquist noise
      .sort((a, b) => b.amp - a.amp);

    return { 
      ...result, 
      analysisSeries, 
      spectrumSeries,
      dominantPeriod: spectrumSeries[0]?.period || 0
    };
  }, [priceData, numTerms, waveType]);

  // --- Hilbert Processing ---
  const priceHilbert = useMemo(() => {
    if (waveType !== "price" || transformMode !== "hilbert" || !priceData || priceData.length < 10) return null;
    
    const validData = priceData.filter((d) => {
      const c = d.adjustedClose ?? d.close;
      return c != null && !isNaN(c);
    });

    const rawCloses = validData.map((d) => d.adjustedClose ?? d.close);
    const trimmed = rawCloses.length > hilbertLimit ? rawCloses.slice(rawCloses.length - hilbertLimit) : rawCloses;
    const { detrended, trend } = detrend(trimmed);
    const h = computeHilbert(detrended);
    
    const N = detrended.length;
    const hilbertSeries = detrended.map((val, i) => ({
      index: i,
      timestamp: validData[validData.length - N + i]?.timestamp,
      signal: val,
      transformed: h.hilbert[i],
      envelope: h.envelope[i],
      phase: h.instPhase[i],
      freq: h.instFreq[i]
    }));

    return { ...h, hilbertSeries, trend };
  }, [priceData, waveType, transformMode]);

  const syntheticHilbert = useMemo(() => {
    if (waveType === "price" || transformMode !== "hilbert") return null;
    const N = 256;
    const coeffs = waveType === "custom" ? customCoeffs : getSyntheticCoefficients(waveType, numTerms);
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
    setCustomCoeffs(getSyntheticCoefficients("custom", numTerms));
  }, [numTerms]);

  useEffect(() => {
    if (waveType === "custom" && customCoeffs.length === 0) regenerateCustom();
  }, [waveType, customCoeffs.length, regenerateCustom]);

  useEffect(() => { trailRef.current = []; }, [numTerms, waveType, amplitude, priceSymbol, priceTimeframe, transformMode]);

  const reset = () => { timeRef.current = 0; trailRef.current = []; };
  const isPriceMode = waveType === "price";
  const isHilbert = transformMode === "hilbert";

  return {
    timeRef, trailRef,
    numTerms, setNumTerms,
    speed, setSpeed,
    waveType, setWaveType,
    transformMode, setTransformMode,
    playing, setPlaying,
    showComponents, setShowComponents,
    amplitude, setAmplitude,
    customCoeffs,
    priceSymbol, setPriceSymbol,
    priceTimeframe, setPriceTimeframe,
    instruments,
    priceLoading,
    priceDFT,
    priceHilbert,
    syntheticHilbert,
    regenerateCustom,
    reset,
    isPriceMode,
    isHilbert
  };
}
