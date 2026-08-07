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

export interface XAIExplanation {
  method: string;
  timestamp: number;
  prediction: {
    class: number | string;
    confidence: number;
    probabilities?: number[];
  };
  featureContributions?: FeatureContribution[];
  attentionWeights?: number[];
  calibration?: {
    expectedConfidence: number;
    actualAccuracy: number;
    reliabilityDiagram: CalibrationBin[];
  };
  counterfactuals?: CounterfactualExample[];
  summary: string;
}

export interface XAIMethod {
  id: string;
  name: string;
  description: string;
  category: string;
  output: string;
  complexity: string;
  params: Array<{
    id: string;
    name: string;
    type: string;
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
  }>;
}

export interface ExplainableAIProps {
  symbol: string;
  modelId?: number;
}

export const COMPLEXITY_COLORS: Record<string, string> = {
  low: "bg-[hsl(var(--data-pos)/0.2)] text-[hsl(var(--data-pos))] border-[hsl(var(--data-pos)/0.3)]",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high: "bg-[hsl(var(--data-neg)/0.2)] text-[hsl(var(--data-neg))] border-[hsl(var(--data-neg)/0.3)]",
};
