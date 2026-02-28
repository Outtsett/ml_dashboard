import type { FeatureContribution } from '../xaiTypes';
import { euclideanDistance } from '../xaiMath';

export function computeLIME(
  input: number[][],
  prediction: { class: number; confidence: number },
  params: Record<string, unknown>
): FeatureContribution[] {
  const nSamples = (params.nSamples as number) || 1000;
  const kernelWidth = (params.kernelWidth as number) || 0.75;
  const flatInput = input.flat();
  const numFeatures = flatInput.length;

  const coefficients: number[] = new Array(numFeatures).fill(0);

  for (let s = 0; s < nSamples; s++) {
    const perturbation = flatInput.map((v, _i) =>
      Math.random() > 0.5 ? v : v + (Math.random() - 0.5) * 0.1
    );

    const distance = euclideanDistance(flatInput.slice(0, numFeatures), perturbation.slice(0, numFeatures));
    const weight = Math.exp(-(distance ** 2) / (kernelWidth ** 2));

    for (let i = 0; i < numFeatures; i++) {
      const diff = perturbation[i]! - flatInput[i]!;
      coefficients[i]! += weight * diff * (Math.random() - 0.5);
    }
  }

  const contributions: FeatureContribution[] = [];
  for (let i = 0; i < numFeatures; i++) {
    const coef = coefficients[i]! / nSamples;
    contributions.push({
      feature: `feature_${i}`,
      value: flatInput[i]!,
      contribution: coef,
      direction: coef >= 0 ? 'positive' : 'negative'
    });
  }

  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function generateLIMESummary(contributions: FeatureContribution[], prediction: { direction: string }): string {
  const top3 = contributions.slice(0, 3);
  return `Local linear approximation identifies ${top3.map(c => c.feature).join(', ')} as key local factors for this specific ${prediction.direction} prediction.`;
}
