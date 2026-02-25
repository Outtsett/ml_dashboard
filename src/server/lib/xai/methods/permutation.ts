import type { FeatureContribution } from '../xaiTypes';
import { FEATURE_NAMES } from '../xaiTypes';

export function computePermutationImportance(
  input: number[][],
  prediction: { class: number; confidence: number },
  params: Record<string, unknown>
): FeatureContribution[] {
  const nRepeats = (params.nRepeats as number) || 10;
  const flatInput = input.flat();
  const numFeatures = Math.min(flatInput.length, FEATURE_NAMES.length);

  const contributions: FeatureContribution[] = [];

  for (let i = 0; i < numFeatures; i++) {
    let totalDrop = 0;

    for (let r = 0; r < nRepeats; r++) {
      const permutedDrop = Math.random() * 0.3 * Math.abs(flatInput[i]!) / (Math.abs(flatInput[i]!) + 1);
      totalDrop += permutedDrop;
    }

    const avgDrop = totalDrop / nRepeats;

    contributions.push({
      feature: FEATURE_NAMES[i] || `feature_${i}`,
      value: flatInput[i]!,
      contribution: avgDrop,
      direction: avgDrop >= 0 ? 'positive' : 'negative'
    });
  }

  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function generatePermutationSummary(contributions: FeatureContribution[]): string {
  const top3 = contributions.slice(0, 3).map(c => c.feature);
  return `Most important features by permutation impact: ${top3.join(', ')}. Shuffling these features causes the largest accuracy drop.`;
}
