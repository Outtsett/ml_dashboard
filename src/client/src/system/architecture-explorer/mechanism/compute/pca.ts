/**
 * Principal Component Analysis, by Jacobi eigendecomposition.
 *
 * ANALYTIC provenance: this is exact. The covariance matrix of the real feature
 * rows is diagonalised by cyclic Jacobi rotations, which converges to the true
 * eigenvectors and eigenvalues of a symmetric matrix. Nothing is seeded, nothing
 * is iterated toward by gradient descent — given these bars, these ARE the
 * principal components and this IS the variance each explains.
 *
 * Why it also serves the autoencoder family: for a linear encoder/decoder under
 * squared error, PCA is the OPTIMAL solution. Projecting onto the top k
 * components and reconstructing gives the lowest reconstruction error any linear
 * autoencoder with a k-dimensional bottleneck can achieve. So an
 * encode/bottleneck/decode animation driven by PCA is not an approximation of
 * the mechanism — it is the mechanism's best case, computed exactly.
 */

export interface PcaResult {
  /** Column means, subtracted before projection. */
  mean: number[];
  /** components[i] = i-th principal axis, unit length, descending by variance. */
  components: number[][];
  /** Eigenvalue per component — the variance along that axis. */
  eigenvalues: number[];
  /** Fraction of total variance explained, per component. */
  explained: number[];
  /** Running total of `explained`. */
  cumulative: number[];
}

function covariance(rows: number[][], mean: number[]): number[][] {
  const n = rows.length;
  const d = mean.length;
  const C = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const r of rows) {
    for (let i = 0; i < d; i++) {
      const di = r[i]! - mean[i]!;
      for (let j = i; j < d; j++) {
        C[i]![j]! += di * (r[j]! - mean[j]!);
      }
    }
  }
  const denom = Math.max(n - 1, 1);
  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      C[i]![j]! /= denom;
      C[j]![i] = C[i]![j]!;
    }
  }
  return C;
}

/**
 * Cyclic Jacobi: repeatedly zero the largest off-diagonal entry with a rotation.
 * Accumulating the rotations gives the eigenvectors; the diagonal converges to
 * the eigenvalues. Standard, exact up to the sweep tolerance.
 */
function jacobiEigen(A: number[][], maxSweeps = 60, tol = 1e-10): { values: number[]; vectors: number[][] } {
  const d = A.length;
  const M = A.map((r) => [...r]);
  // Explicitly number[][]: inferred from the identity initializer it would
  // narrow to (0 | 1)[][] and reject the rotation updates below.
  const V: number[][] = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) off += M[i]![j]! ** 2;
    if (off < tol) break;

    for (let p = 0; p < d - 1; p++) {
      for (let q = p + 1; q < d; q++) {
        const apq = M[p]![q]!;
        if (Math.abs(apq) < 1e-14) continue;
        const theta = (M[q]![q]! - M[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < d; k++) {
          const mkp = M[k]![p]!;
          const mkq = M[k]![q]!;
          M[k]![p] = c * mkp - s * mkq;
          M[k]![q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < d; k++) {
          const mpk = M[p]![k]!;
          const mqk = M[q]![k]!;
          M[p]![k] = c * mpk - s * mqk;
          M[q]![k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < d; k++) {
          const vkp = V[k]![p]!;
          const vkq = V[k]![q]!;
          V[k]![p] = c * vkp - s * vkq;
          V[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = Array.from({ length: d }, (_, i) => M[i]![i]!);
  // Column i of V is the eigenvector for values[i]; return them as rows.
  const vectors = Array.from({ length: d }, (_, i) => V.map((row) => row[i]!));
  return { values, vectors };
}

export function pca(rows: number[][]): PcaResult {
  const n = rows.length;
  const d = rows[0]?.length ?? 0;
  if (n === 0 || d === 0) {
    return { mean: [], components: [], eigenvalues: [], explained: [], cumulative: [] };
  }

  const mean = new Array<number>(d).fill(0);
  for (const r of rows) for (let i = 0; i < d; i++) mean[i]! += r[i]!;
  for (let i = 0; i < d; i++) mean[i]! /= n;

  const { values, vectors } = jacobiEigen(covariance(rows, mean));

  const order = values
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);

  const eigenvalues = order.map((i) => Math.max(values[i]!, 0));
  const components = order.map((i) => {
    const v = vectors[i]!;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  });

  const total = eigenvalues.reduce((a, b) => a + b, 0) || 1;
  const explained = eigenvalues.map((v) => v / total);
  const cumulative: number[] = [];
  explained.reduce((acc, v) => {
    const next = acc + v;
    cumulative.push(next);
    return next;
  }, 0);

  return { mean, components, eigenvalues, explained, cumulative };
}

/** Project one row onto the top k components — the ENCODE half. */
export function encode(row: readonly number[], p: PcaResult, k: number): number[] {
  const centred = row.map((v, i) => v - (p.mean[i] ?? 0));
  return p.components.slice(0, k).map((c) => c.reduce((s, cv, i) => s + cv * centred[i]!, 0));
}

/** Rebuild from the code — the DECODE half. */
export function decode(code: readonly number[], p: PcaResult): number[] {
  const d = p.mean.length;
  const out = [...p.mean];
  for (let j = 0; j < code.length; j++) {
    const c = p.components[j];
    if (!c) break;
    for (let i = 0; i < d; i++) out[i]! += code[j]! * c[i]!;
  }
  return out;
}

/** Mean squared reconstruction error over all rows at bottleneck width k. */
export function reconstructionError(rows: number[][], p: PcaResult, k: number): number {
  if (rows.length === 0) return 0;
  let sum = 0;
  for (const r of rows) {
    const back = decode(encode(r, p, k), p);
    for (let i = 0; i < r.length; i++) sum += (r[i]! - back[i]!) ** 2;
  }
  return sum / (rows.length * (rows[0]?.length ?? 1));
}
