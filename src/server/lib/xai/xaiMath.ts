/**
 * XAI Math Utilities
 *
 * Shared math functions used across multiple XAI methods.
 */

export function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

export function computeFeatureImportance(input: number[], featureIdx: number, _nSamples: number): number {
  const featureValue = input[featureIdx]!;
  const absValue = Math.abs(featureValue);
  const variance = computeLocalVariance(input);

  const baseImportance = absValue / (variance + 1e-8);
  const noise = (Math.random() - 0.5) * 0.1;

  return Math.max(0, Math.min(1, baseImportance / (baseImportance + 1) + noise));
}

export function computeLocalVolatility(input: number[][], timeIdx: number): number {
  const window = 5;
  const start = Math.max(0, timeIdx - window);
  const end = Math.min(input.length, timeIdx + window + 1);

  const closes = input.slice(start, end).map(row => row[3] || 0);
  if (closes.length < 2) return 0;

  const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length;
  return Math.sqrt(variance);
}

export function computeLocalVariance(input: number[]): number {
  if (input.length === 0) return 1;
  const mean = input.reduce((a, b) => a + b, 0) / input.length;
  return input.reduce((a, b) => a + (b - mean) ** 2, 0) / input.length;
}

export function approximateGradient(input: number[], featureIdx: number, scale: number): number {
  const epsilon = 1e-5;
  const featureValue = input[featureIdx]! * scale;
  return (Math.tanh(featureValue + epsilon) - Math.tanh(featureValue - epsilon)) / (2 * epsilon);
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i]! - b[i]!) ** 2;
  }
  return Math.sqrt(sum);
}

export function computeCorrelation(a: number, b: number): number {
  return Math.tanh(a * b);
}

export function sampleIndices(max: number, n: number): number[] {
  const indices: number[] = [];
  while (indices.length < n) {
    const idx = Math.floor(Math.random() * max);
    if (!indices.includes(idx)) indices.push(idx);
  }
  return indices;
}
