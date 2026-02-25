import type { FeatureContribution } from '../xaiTypes';
import { FEATURE_NAMES } from '../xaiTypes';
import { approximateGradient } from '../xaiMath';

export function computeSaliency(
  input: number[][],
  prediction: { class: number; confidence: number },
  params: Record<string, unknown>
): FeatureContribution[] {
  const absoluteValue = (params.absoluteValue as boolean) ?? true;
  const flatInput = input.flat();
  const numFeatures = Math.min(flatInput.length, FEATURE_NAMES.length);

  const contributions: FeatureContribution[] = [];

  for (let i = 0; i < numFeatures; i++) {
    const gradient = approximateGradient(flatInput, i, 1.0);
    const saliency = absoluteValue ? Math.abs(gradient) : gradient;

    contributions.push({
      feature: FEATURE_NAMES[i] || `feature_${i}`,
      value: flatInput[i]!,
      contribution: saliency,
      direction: gradient >= 0 ? 'positive' : 'negative'
    });
  }

  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function generateSaliencySummary(contributions: FeatureContribution[]): string {
  const top3 = contributions.slice(0, 3).map(c => c.feature);
  return `Model is most sensitive to changes in: ${top3.join(', ')}. Small perturbations to these features significantly affect output.`;
}
