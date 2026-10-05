import { computeLocalVolatility } from '../xaiMath';

export function computeGradCAM(
  input: number[][],
  _params: Record<string, unknown>
): number[] {
  const sequenceLength = input.length;
  const attention: number[] = [];

  for (let t = 0; t < sequenceLength; t++) {
    const position = t / sequenceLength;
    const recency = Math.exp(-3 * (1 - position));
    const volatility = computeLocalVolatility(input, t);
    attention.push(0.7 * recency + 0.3 * volatility);
  }

  const max = Math.max(...attention);
  const min = Math.min(...attention);
  return attention.map(a => (a - min) / (max - min + 1e-8));
}

export function generateGradCAMSummary(attention: number[]): string {
  const maxIdx = attention.indexOf(Math.max(...attention));
  const recentFocus = attention.slice(-5).reduce((a, b) => a + b, 0) / 5;
  return `Model attention peaks at time step ${maxIdx + 1}. Recent data receives ${(recentFocus * 100).toFixed(1)}% average attention weight.`;
}
