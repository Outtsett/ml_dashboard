/**
 * Benjamini-Yekutieli step-up, the false-discovery control that holds under
 * any dependence between the tests: sort the p-values, compare the i-th
 * smallest with q · i / (m · c(m)), where c(m) = 1 + 1/2 + … + 1/m, and
 * reject every test up to the largest rank that passes.
 */

/** c(m): the harmonic number, exactly (the sum, not the log approximation). */
export function harmonicNumber(count: number): number {
  let total = 0;
  for (let index = 1; index <= count; index += 1) total += 1 / index;
  return total;
}

export interface YekutieliStep {
  rank: number;
  pValue: number;
  threshold: number;
  passes: boolean;
}

export interface YekutieliResult {
  testCount: number;
  harmonic: number;
  falseDiscoveryRate: number;
  steps: YekutieliStep[];
  /** Largest rank whose p-value is at or under its threshold; 0 when none. */
  cutoffRank: number;
}

export function benjaminiYekutieli(pValues: readonly number[], falseDiscoveryRate = 0.1): YekutieliResult {
  const sorted = pValues.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const testCount = sorted.length;
  const harmonic = harmonicNumber(testCount);
  const steps = sorted.map((pValue, index) => {
    const rank = index + 1;
    const threshold = (falseDiscoveryRate * rank) / (testCount * harmonic);
    return { rank, pValue, threshold, passes: pValue <= threshold };
  });
  let cutoffRank = 0;
  for (const step of steps) if (step.passes) cutoffRank = step.rank;
  return { testCount, harmonic, falseDiscoveryRate, steps, cutoffRank };
}
