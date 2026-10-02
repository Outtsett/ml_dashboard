export type WaveType = 'price' | 'square' | 'sawtooth' | 'triangle' | 'custom';
export type TransformMode = 'fourier' | 'hilbert';

export interface FourierCoeff {
  freq: number;
  amp: number;
  phase: number;
}

export interface InstrumentInfo {
  symbol: string;
  name: string;
  assetType: string;
}

/** A single OHLCV bar as read off `/api/charts/ohlcv` for the Fourier price mode. */
export interface PriceCandle {
  timestamp: number;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  adjustedClose?: number;
}

/** Analytic-signal decomposition returned by `computeHilbert`. */
export interface HilbertResult {
  original: number[];
  hilbert: number[];
  envelope: number[];
  instPhase: number[];
  instFreq: number[];
}

/** One point of `priceHilbert.hilbertSeries`, built for the phase-space vector view. */
export interface HilbertSeriesPoint {
  index: number;
  timestamp: number | undefined;
  signal: number;
  transformed: number | undefined;
  envelope: number | undefined;
  phase: number | undefined;
  freq: number | undefined;
}

/** `useFourierState().priceHilbert` — a `HilbertResult` plus the price-mode extras. */
export interface PriceHilbertResult extends HilbertResult {
  hilbertSeries: HilbertSeriesPoint[];
  trend: number[];
}

/** One point of `priceDFT.analysisSeries` (input vs. reconstructed signal). */
export interface DFTAnalysisPoint {
  index: number;
  timestamp: number | undefined;
  input: number;
  reconstructed: number;
  residual: number;
  trend: number | undefined;
  original: number | undefined;
}

/** One point of `priceDFT.spectrumSeries` (amplitude/power by period). */
export interface DFTSpectrumPoint {
  freq: number;
  period: number;
  amp: number;
  power: number;
  phase: number;
}

/** `useFourierState().priceDFT` — DFT coefficients plus the price-mode analysis views. */
export interface PriceDFTResult {
  coeffs: FourierCoeff[];
  dc: number;
  analysisSeries: DFTAnalysisPoint[];
  spectrumSeries: DFTSpectrumPoint[];
  dominantPeriod: number;
}

/**
 * Reads a field that a producing hook does not currently populate, without
 * asserting `any`. Resolves to `undefined` when the key is absent from the
 * object — `PriceDFTResult`/`PriceHilbertResult` deliberately don't declare
 * `raw`/`closes`/`detrended` because `useFourierState` never sets them, so
 * every read through this helper matches the `undefined` the previous
 * `(x as any).field` cast produced. Kept narrow and documented rather than
 * widened to `any`, and not added to the interfaces above because that would
 * misrepresent what the hook actually returns.
 */
export function readVestigialField<T>(obj: object, key: string): T | undefined {
  return key in obj ? ((obj as Record<string, unknown>)[key] as T) : undefined;
}
