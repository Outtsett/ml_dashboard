import type { FeatureContribution } from '../xaiTypes';
import { computeCorrelation } from '../xaiMath';

export function computeFeatureInteractions(
  input: number[][],
  prediction: { class: number; confidence: number },
  params: Record<string, unknown>
): FeatureContribution[] {
  const topK = (params.topK as number) || 10;
  const flatInput = input.flat();
  const numFeatures = flatInput.length;

  const interactions: Array<{ pair: string; strength: number }> = [];

  for (let i = 0; i < Math.min(topK, numFeatures); i++) {
    for (let j = i + 1; j < Math.min(topK, numFeatures); j++) {
      const correlation = computeCorrelation(flatInput[i]!, flatInput[j]!);
      const interactionStrength = Math.abs(correlation) * (Math.abs(flatInput[i]!) + Math.abs(flatInput[j]!));
      interactions.push({
        pair: `f${i} \u00d7 f${j}`,
        strength: interactionStrength
      });
    }
  }

  return interactions
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10)
    .map(int => ({
      feature: int.pair,
      value: int.strength,
      contribution: int.strength,
      direction: 'positive' as const
    }));
}

export function generateInteractionSummary(contributions: FeatureContribution[]): string {
  const top3 = contributions.slice(0, 3).map(c => c.feature);
  return `Strongest feature interactions: ${top3.join('; ')}. These feature pairs have synergistic effects on model output.`;
}
