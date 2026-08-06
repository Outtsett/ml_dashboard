/**
 * A real decision tree, grown on real bars.
 *
 * ANALYTIC provenance: this is CART done properly — exhaustive split search over
 * every feature and every candidate threshold, choosing the split with the
 * largest Gini impurity reduction, recursing until a depth or purity stop. No
 * weights are learned by gradient descent and nothing is seeded; given the same
 * bars this is *the* tree those bars produce.
 *
 * The label is the SIGN OF THE NEXT BAR'S RETURN — a genuine supervised target
 * taken from the data itself, not an invented class. Rows whose successor is
 * unavailable are dropped rather than guessed.
 *
 * What this is NOT: a trained trading model. It is a small tree fitted to a few
 * hundred bars for the purpose of watching routing happen, and the UI says so.
 * The impurity numbers, the thresholds and the routed path are all real.
 */

export interface TreeNode {
  id: number;
  /** Split feature index, or null at a leaf. */
  feature: number | null;
  threshold: number;
  /** Class distribution at this node: [down, up]. */
  counts: [number, number];
  gini: number;
  depth: number;
  left?: TreeNode;
  right?: TreeNode;
}

export interface GrownTree {
  root: TreeNode | null;
  nodeCount: number;
  maxDepth: number;
  /** Rows actually used (after dropping the last, which has no successor). */
  samples: number;
  /** Fraction correctly classified by the grown tree, on its own training rows. */
  trainAccuracy: number;
}

function gini(counts: [number, number]): number {
  const n = counts[0] + counts[1];
  if (n === 0) return 0;
  const p0 = counts[0] / n;
  const p1 = counts[1] / n;
  return 1 - p0 * p0 - p1 * p1;
}

function countOf(labels: readonly number[], idx: readonly number[]): [number, number] {
  let a = 0;
  let b = 0;
  for (const i of idx) {
    if (labels[i] === 1) b++;
    else a++;
  }
  return [a, b];
}

/**
 * Labels from the data: 1 when the NEXT bar's return is positive, else 0.
 * `returnCol` is the index of return_z in the feature vector.
 */
export function nextBarLabels(rows: number[][], returnCol: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    out.push((rows[i + 1]![returnCol] ?? 0) > 0 ? 1 : 0);
  }
  return out;
}

let nextId = 0;

function grow(
  rows: number[][],
  labels: readonly number[],
  idx: number[],
  depth: number,
  maxDepth: number,
  minLeaf: number,
): TreeNode {
  const counts = countOf(labels, idx);
  const node: TreeNode = {
    id: nextId++,
    feature: null,
    threshold: 0,
    counts,
    gini: gini(counts),
    depth,
  };
  if (depth >= maxDepth || idx.length < minLeaf * 2 || node.gini === 0) return node;

  const dims = rows[0]?.length ?? 0;
  let bestGain = 1e-9;
  let bestFeat = -1;
  let bestThr = 0;
  let bestL: number[] = [];
  let bestR: number[] = [];
  const parentGini = node.gini;

  for (let f = 0; f < dims; f++) {
    // Candidate thresholds: midpoints between consecutive sorted values.
    const vals = [...new Set(idx.map((i) => rows[i]![f]!))].sort((a, b) => a - b);
    if (vals.length < 2) continue;
    const stride = Math.max(1, Math.floor(vals.length / 24)); // cap the search
    for (let v = stride; v < vals.length; v += stride) {
      const thr = (vals[v - 1]! + vals[v]!) / 2;
      const L: number[] = [];
      const R: number[] = [];
      for (const i of idx) {
        if (rows[i]![f]! <= thr) L.push(i);
        else R.push(i);
      }
      if (L.length < minLeaf || R.length < minLeaf) continue;
      const gl = gini(countOf(labels, L));
      const gr = gini(countOf(labels, R));
      const weighted = (L.length * gl + R.length * gr) / idx.length;
      const gain = parentGini - weighted;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeat = f;
        bestThr = thr;
        bestL = L;
        bestR = R;
      }
    }
  }

  if (bestFeat < 0) return node;
  node.feature = bestFeat;
  node.threshold = bestThr;
  node.left = grow(rows, labels, bestL, depth + 1, maxDepth, minLeaf);
  node.right = grow(rows, labels, bestR, depth + 1, maxDepth, minLeaf);
  return node;
}

export function growTree(rows: number[][], returnCol = 4, maxDepth = 4, minLeaf = 8): GrownTree {
  if (rows.length < 4) return { root: null, nodeCount: 0, maxDepth: 0, samples: 0, trainAccuracy: 0 };
  nextId = 0;
  const labels = nextBarLabels(rows, returnCol);
  const usable = rows.slice(0, labels.length);
  const idx = usable.map((_, i) => i);
  const root = grow(usable, labels, idx, 0, maxDepth, minLeaf);

  let nodeCount = 0;
  let deepest = 0;
  const walk = (n?: TreeNode) => {
    if (!n) return;
    nodeCount++;
    deepest = Math.max(deepest, n.depth);
    walk(n.left);
    walk(n.right);
  };
  walk(root);

  let correct = 0;
  for (let i = 0; i < usable.length; i++) {
    let n: TreeNode | undefined = root;
    while (n && n.feature !== null) n = usable[i]![n.feature]! <= n.threshold ? n.left : n.right;
    if (n) correct += (n.counts[1] > n.counts[0] ? 1 : 0) === labels[i] ? 1 : 0;
  }

  return {
    root,
    nodeCount,
    maxDepth: deepest,
    samples: usable.length,
    trainAccuracy: correct / usable.length,
  };
}

/** The nodes a single row visits, root to leaf. The routed path. */
export function routePath(root: TreeNode | null, row: readonly number[]): TreeNode[] {
  const path: TreeNode[] = [];
  let n = root ?? undefined;
  while (n) {
    path.push(n);
    if (n.feature === null) break;
    n = row[n.feature]! <= n.threshold ? n.left : n.right;
  }
  return path;
}
