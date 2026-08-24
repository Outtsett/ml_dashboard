/**
 * A real forward pass over the sampled neuron view.
 *
 * This computes an ACTUAL value at every node: each node is
 * `tanh(Σ prev_i · w_i + b)`, the genuine neural-network operation — a weighted
 * sum of the previous layer's node values, plus a bias, through an activation.
 * The numbers change layer to layer because they are really computed, not
 * scripted. Feed a window of real close prices in and watch it propagate.
 *
 * HONESTY: the weights are SEEDED (a deterministic hash of layer/i/j), not
 * learned — there is no trained model here. So the arithmetic and the flow are
 * real, but the OUTPUT is not a prediction. The UI says exactly that. Seeded
 * (not Math.random) keeps it stable: the same window + architecture always
 * produces the same numbers, so nothing is fabricated frame to frame.
 */

/** Deterministic hash → weight in [-scale, scale]. No RNG, fully reproducible. */
function seededWeight(a: number, b: number, c: number, scale = 1): number {
  let h = 2166136261 ^ (a * 374761393 + b * 668265263 + c * 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  // Map the unsigned 32-bit hash to [-scale, scale].
  return ((h >>> 0) / 0xffffffff) * 2 * scale - scale;
}

function tanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
}

export interface ForwardPass {
  /** value[layer][node] — the real computed activation at each drawn node. */
  values: number[][];
  /** True input values used (normalized close prices), for the input layer. */
  input: number[];
}

/**
 * Run the pass.
 * @param layerSizes  drawn node count per layer (the sampled view — 4 each).
 * @param closes      real close prices; the window feeding the network.
 */
export function forwardPass(layerSizes: number[], closes: number[]): ForwardPass {
  const values: number[][] = [];
  if (layerSizes.length === 0) return { values, input: [] };

  const first = layerSizes[0]!;

  // Input layer: sample the window to the drawn node count, then z-normalize so
  // the seeded network sees inputs on a sane scale (real prices are ~0.7).
  const sampled: number[] = [];
  for (let i = 0; i < first; i++) {
    const idx = closes.length ? Math.floor((i / first) * closes.length) : 0;
    sampled.push(closes[idx] ?? 0);
  }
  const mean = sampled.reduce((s, v) => s + v, 0) / (sampled.length || 1);
  const sd =
    Math.sqrt(
      sampled.reduce((s, v) => s + (v - mean) ** 2, 0) / (sampled.length || 1),
    ) || 1;
  const input = sampled.map((v) => (v - mean) / sd);
  values.push(input.slice());

  // Propagate: node j of layer l = tanh(Σ_i prev_i · w(l,i,j) + b(l,j)).
  // Xavier-ish scale keeps activations from saturating immediately.
  for (let l = 1; l < layerSizes.length; l++) {
    const prev = values[l - 1]!;
    const size = layerSizes[l]!;
    const scale = 1 / Math.sqrt(prev.length || 1);
    const layer: number[] = [];
    for (let j = 0; j < size; j++) {
      let sum = seededWeight(l, j, 9999, 0.2); // bias
      for (let i = 0; i < prev.length; i++) {
        sum += prev[i]! * seededWeight(l, i, j, 1) * scale;
      }
      layer.push(tanh(sum));
    }
    values.push(layer);
  }

  return { values, input };
}
