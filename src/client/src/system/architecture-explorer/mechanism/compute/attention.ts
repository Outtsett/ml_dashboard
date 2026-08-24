/**
 * Scaled dot-product attention — the real operation.
 *
 *     Attention(Q, K, V) = softmax(Q Kᵀ / sqrt(d_k)) V
 *
 * Every number this returns is genuinely computed from the real bar window: the
 * projections are real matrix multiplies, the scores are real dot products, the
 * softmax is a real softmax, and the output is a real weighted sum of V.
 *
 * SEEDED provenance: the projection matrices Wq/Wk/Wv come from a deterministic
 * hash, not from training — no attention model here has learned weights. So the
 * ARITHMETIC and the STRUCTURE are real and the attention map genuinely reflects
 * which bars this operation relates to which, but the map is not what a trained
 * model would produce, and the UI says so. Seeded rather than random keeps it
 * stable: the same bars always give the same map.
 *
 * This is the same contract graph/nodeflow.ts holds for the forward pass.
 */

import { seededUnit } from './kmeans';

/** Deterministic weight in [-scale, scale]. No Math.random anywhere. */
function w(a: number, b: number, c: number, scale = 1): number {
  return (seededUnit(a, b, c) * 2 - 1) * scale;
}

export interface AttentionResult {
  /** Bars attended over. */
  T: number;
  /** Head width. */
  dk: number;
  /** scores[i][j] = q_i · k_j / sqrt(dk) — pre-softmax. */
  scores: number[][];
  /** attn[i][j] — each ROW sums to 1. This is the picture. */
  attn: number[][];
  /** out[i] = Σ_j attn[i][j] · v_j — the real weighted sum. */
  out: number[][];
  /** Row-wise min/max of `attn`, for colour scaling. */
  attnMax: number;
}

function matmul(X: number[][], W: number[][]): number[][] {
  const n = X.length;
  const inD = W.length;
  const outD = W[0]?.length ?? 0;
  const R: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(outD).fill(0);
    for (let k = 0; k < inD; k++) {
      const x = X[i]![k] ?? 0;
      if (x === 0) continue;
      for (let j = 0; j < outD; j++) row[j]! += x * W[k]![j]!;
    }
    R.push(row);
  }
  return R;
}

function seededMatrix(rows: number, cols: number, salt: number): number[][] {
  const scale = 1 / Math.sqrt(Math.max(rows, 1));
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => w(salt, i, j, scale)),
  );
}

/**
 * Run attention over a real feature window.
 *
 * @param window  T rows of real features (one row per bar).
 * @param dk      head width; defaults to the feature count, capped for legibility.
 */
export function attention(window: number[][], dk?: number, seed = 17): AttentionResult {
  const T = window.length;
  if (T === 0) return { T: 0, dk: 0, scores: [], attn: [], out: [], attnMax: 1 };
  const F = window[0]!.length;
  const d = Math.max(2, Math.min(dk ?? F, 16));

  const Q = matmul(window, seededMatrix(F, d, seed + 1));
  const K = matmul(window, seededMatrix(F, d, seed + 2));
  const V = matmul(window, seededMatrix(F, d, seed + 3));

  const scale = 1 / Math.sqrt(d);
  const scores: number[][] = [];
  for (let i = 0; i < T; i++) {
    const row = new Array<number>(T);
    for (let j = 0; j < T; j++) {
      let s = 0;
      for (let k = 0; k < d; k++) s += Q[i]![k]! * K[j]![k]!;
      row[j] = s * scale;
    }
    scores.push(row);
  }

  // Row-wise softmax, max-subtracted for numerical stability.
  const attn: number[][] = [];
  let attnMax = 0;
  for (let i = 0; i < T; i++) {
    const mx = Math.max(...scores[i]!);
    const ex = scores[i]!.map((s) => Math.exp(s - mx));
    const sum = ex.reduce((a, b) => a + b, 0) || 1;
    const row = ex.map((e) => e / sum);
    for (const v of row) if (v > attnMax) attnMax = v;
    attn.push(row);
  }

  // out = attn · V
  const out: number[][] = [];
  for (let i = 0; i < T; i++) {
    const row = new Array<number>(d).fill(0);
    for (let j = 0; j < T; j++) {
      const a = attn[i]![j]!;
      if (a === 0) continue;
      for (let k = 0; k < d; k++) row[k]! += a * V[j]![k]!;
    }
    out.push(row);
  }

  return { T, dk: d, scores, attn, out, attnMax: attnMax || 1 };
}
