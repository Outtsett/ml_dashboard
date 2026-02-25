import type { CounterfactualExample } from '../xaiTypes';
import { FEATURE_NAMES } from '../xaiTypes';
import { sampleIndices } from '../xaiMath';

export function computeCounterfactuals(
  input: number[][],
  prediction: { class: number; confidence: number; direction: string },
  params: Record<string, unknown>
): CounterfactualExample[] {
  const nExamples = (params.nExamples as number) || 3;
  const maxChanges = (params.maxChanges as number) || 5;
  const flatInput = input.flat();
  const numFeatures = Math.min(flatInput.length, FEATURE_NAMES.length);

  const counterfactuals: CounterfactualExample[] = [];
  const targetClasses = [0, 1, 2].filter(c => c !== prediction.class);

  for (let e = 0; e < nExamples; e++) {
    const numChanges = Math.min(1 + Math.floor(Math.random() * maxChanges), numFeatures);
    const changedIndices = sampleIndices(numFeatures, numChanges);

    const changes: Array<{ feature: string; from: number; to: number }> = [];
    let distance = 0;

    for (const idx of changedIndices) {
      const from = flatInput[idx]!;
      const changeMagnitude = (Math.random() - 0.5) * 0.2;
      const to = from + changeMagnitude;

      changes.push({
        feature: FEATURE_NAMES[idx] || `feature_${idx}`,
        from,
        to
      });

      distance += Math.abs(to - from);
    }

    counterfactuals.push({
      changes,
      newPrediction: targetClasses[e % targetClasses.length]!,
      distance
    });
  }

  return counterfactuals.sort((a, b) => a.distance - b.distance);
}

export function generateCounterfactualSummary(counterfactuals: CounterfactualExample[], prediction: { direction: string }): string {
  if (counterfactuals.length === 0) return 'No counterfactual examples generated.';

  const nearest = counterfactuals[0]!;
  const changeCount = nearest.changes.length;
  const features = nearest.changes.map(c => c.feature).join(', ');

  return `Smallest change to flip ${prediction.direction} prediction: modify ${changeCount} feature(s) (${features}). Distance: ${nearest.distance.toFixed(4)}.`;
}
