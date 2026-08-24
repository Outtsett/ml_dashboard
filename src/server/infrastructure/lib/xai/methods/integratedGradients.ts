import type { FeatureContribution } from '../xaiTypes';
import { approximateGradient } from '../xaiMath';

export function computeIntegratedGradients(
  input: number[][],
  prediction: { class: number; confidence: number },
  params: Record<string, unknown>
): FeatureContribution[] {
  const nSteps = (params.nSteps as number) || 50;
  const flatInput = input.flat();
  const numFeatures = flatInput.length;

  const contributions: FeatureContribution[] = [];

  for (let i = 0; i < numFeatures; i++) {
    let integral = 0;
    const featureValue = flatInput[i]!;

    for (let step = 1; step <= nSteps; step++) {
      const alpha = step / nSteps;
      const gradient = approximateGradient(flatInput, i, alpha);
      integral += gradient * (featureValue / nSteps);
    }

    contributions.push({
      feature: `feature_${i}`,
      value: featureValue,
      contribution: integral,
      direction: integral >= 0 ? 'positive' : 'negative'
    });
  }

  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function generateIntegratedGradientsSummary(contributions: FeatureContribution[], prediction: { direction: string }): string {
  const top3 = contributions.slice(0, 3);
  return `Integrated gradients show ${top3.map(c => `${c.feature} (${c.direction})`).join(', ')} as primary contributors to ${prediction.direction} prediction.`;
}
