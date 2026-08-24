import type { FeatureContribution } from '../xaiTypes';
import { computeFeatureImportance } from '../xaiMath';

export function computeSHAP(
  input: number[][],
  prediction: { class: number; confidence: number },
  params: Record<string, unknown>
): FeatureContribution[] {
  const nSamples = (params.nSamples as number) || 100;
  const flatInput = input.flat();
  const numFeatures = flatInput.length;

  const contributions: FeatureContribution[] = [];
  const baseValue = 1 / 3;

  for (let i = 0; i < numFeatures; i++) {
    const importance = computeFeatureImportance(flatInput, i, nSamples);
    const contribution = (prediction.confidence - baseValue) * importance;

    contributions.push({
      feature: `feature_${i}`,
      value: flatInput[i]!,
      contribution,
      direction: contribution >= 0 ? 'positive' : 'negative'
    });
  }

  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function generateSHAPSummary(contributions: FeatureContribution[], prediction: { direction: string }): string {
  const top3 = contributions.slice(0, 3);
  const positives = top3.filter(c => c.direction === 'positive');
  const negatives = top3.filter(c => c.direction === 'negative');

  let summary = `Prediction: ${prediction.direction.toUpperCase()}. `;

  if (positives.length > 0) {
    summary += `Key positive factors: ${positives.map(c => c.feature).join(', ')}. `;
  }
  if (negatives.length > 0) {
    summary += `Key negative factors: ${negatives.map(c => c.feature).join(', ')}.`;
  }

  return summary;
}
