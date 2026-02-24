export type WaveType = 'square' | 'sawtooth' | 'triangle' | 'custom' | 'price';
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
