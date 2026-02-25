/**
 * XAI Types
 *
 * Shared types and constants for the Explainable AI service.
 */

import type { XAIMethodKey } from '@shared/mlTaxonomy';

export interface FeatureContribution {
  feature: string;
  value: number;
  contribution: number;
  direction: 'positive' | 'negative';
}

export interface CalibrationBin {
  binMid: number;
  accuracy: number;
  count: number;
}

export interface CounterfactualExample {
  changes: Array<{ feature: string; from: number; to: number }>;
  newPrediction: number | string;
  distance: number;
}

export interface XAIConfig {
  method: XAIMethodKey;
  params: Record<string, unknown>;
}

export interface PredictionWithExplanation {
  prediction: {
    class: number;
    confidence: number;
    probabilities: number[];
    direction: 'up' | 'down' | 'neutral';
  };
  explanation: import('@shared/mlTaxonomy').XAIExplanation;
}

export const FEATURE_NAMES = [
  'open', 'high', 'low', 'close', 'volume',
  'returns_1', 'returns_5', 'returns_10',
  'volatility_5', 'volatility_10', 'volatility_20',
  'rsi_14', 'momentum_10', 'sma_ratio_20',
  'volume_ratio_5', 'atr_14', 'bb_position',
  'macd_signal', 'price_range', 'body_ratio'
];
