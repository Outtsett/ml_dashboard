/**
 * Blueprints — Machine Learning / Supervised Learning (classical, non-ensemble-boosted).
 *
 * Six methods with almost no shared shape: a lazy lookup (k-NN), a small dense
 * network (MLP), a closed-form generative classifier (Naive Bayes), and three
 * tree-growers (CART, a single classification tree, and a randomized-tree
 * ensemble). Only the MLP has real learned weights — the rest either store no
 * trainable parameters at all (structural, threshold-based decisions) or store
 * closed-form statistics computed in one pass, which is stated in `detail`
 * rather than dressed up as a gradient-trained parameter count.
 */

import type { ArchGraph } from '../types';
import type { NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const C = DIM.classes;

function barFeaturesNode(column: number, lane = 0): NodeSpec {
  return {
    id: 'input', kind: 'input', label: 'Bar features', sublabel: `${F} indicators, this bar`,
    outShape: `B × ${F}`, column, lane,
    analogy: 'Think of it as glancing at this bar\'s 35 indicator readings the instant it closes — no history beyond what those trailing statistics already carry.',
  };
}

function standardizeNode(column: number, lane = 0): NodeSpec {
  return {
    id: 'standardize', kind: 'norm', label: 'Standardize', sublabel: 'causal rolling z-score, per feature',
    inShape: `B × ${F}`, outShape: `B × ${F}`, column, lane,
  };
}

export const SUPERVISED_CLASSICAL_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── K-Nearest Neighbors ────────────────────────────────────────────────

  'machine-learning-supervised-learning-k-nearest-neighbors-k-nn': blueprint({
    title: 'K-Nearest Neighbors (k-NN)',
    subtitle: 'k=15 · Euclidean distance · 50,000-bar reference set',
    nodes: [
      barFeaturesNode(0),
      standardizeNode(1),
      {
        id: 'reference_set', kind: 'memory', label: 'Stored reference set', sublabel: '50,000 historical bars × 35 features',
        outShape: `N × ${F}`, column: 1, lane: 1,
        detail: { stored: 'every past labeled bar, plus the spatial index (KD-tree) over them', note: 'this IS the model — nothing is fit, only indexed' },
        analogy: 'Think of it as a trader\'s notebook of every past setup, filed so the most similar one can be pulled up instantly.',
      },
      {
        id: 'distance', kind: 'compare', label: 'Distance to every reference point', sublabel: 'Minkowski, p=2 (Euclidean)',
        column: 2,
        analogy: 'Think of it as measuring how far today\'s bar sits from every bar ever filed away, in 35-dimensional indicator space.',
      },
      {
        id: 'neighbor_select', kind: 'compare', label: 'k-nearest selection', sublabel: 'k=15 smallest distances',
        column: 3,
      },
      {
        id: 'vote', kind: 'pool', label: 'Distance-weighted vote', sublabel: 'ŷ = argmax_c Σ w_i·1[y_i=c], w_i=1/d',
        column: 4,
        analogy: 'Think of it as polling the 15 most similar historical bars and letting the closest ones speak loudest about what happened next.',
      },
      { id: 'output', kind: 'output', label: 'Predicted class + confidence', sublabel: 'vote fraction among the k neighbors', outShape: `B × ${C}`, column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'distance', 'neighbor_select', 'vote', 'output'),
      ['reference_set', 'distance', 'context', 'every stored point is a candidate neighbor'],
    ],
  }),

  // ─── Multi-Layer Perceptron (classical, sklearn-style) ─────────────────

  'machine-learning-supervised-learning-neural-models-multi-layer-perceptron-mlp': blueprint({
    title: 'Multi-Layer Perceptron (MLP)',
    subtitle: `${F} → 64 → 32 → ${C}, ReLU, dropout 0.2`,
    nodes: [
      barFeaturesNode(0),
      {
        id: 'hidden1', kind: 'linear', label: 'Hidden layer 1', sublabel: `${F} → 64, ReLU`,
        inShape: `B × ${F}`, outShape: 'B × 64', params: P.linear(F, 64), column: 1,
        analogy: 'Think of it as 64 analysts each forming their own weighted read of the 35 indicators, then discarding any opinion that comes out negative.',
      },
      { id: 'drop', kind: 'dropout', label: 'Dropout', sublabel: 'p = 0.2, training only', inShape: 'B × 64', outShape: 'B × 64', column: 2 },
      {
        id: 'hidden2', kind: 'linear', label: 'Hidden layer 2', sublabel: '64 → 32, ReLU',
        inShape: 'B × 64', outShape: 'B × 32', params: P.linear(64, 32), column: 3,
        analogy: 'Think of it as a second panel that only reads the first panel\'s 64 opinions, looking for a smaller set of higher-order patterns among them.',
      },
      {
        id: 'head', kind: 'head', label: 'Output head', sublabel: `Linear 32 → ${C}`,
        inShape: 'B × 32', outShape: `B × ${C}`, params: P.linear(32, C), column: 4,
      },
      { id: 'output', kind: 'output', label: 'Class probabilities', sublabel: 'softmax', outShape: `B × ${C}`, column: 5 },
    ],
    edges: chain('input', 'hidden1', 'drop', 'hidden2', 'head', 'output'),
  }),

  // ─── Naive Bayes ─────────────────────────────────────────────────────────

  'machine-learning-supervised-learning-probabilistic-models-naive-bayes': blueprint({
    title: 'Naive Bayes',
    subtitle: 'Gaussian, 3 classes — closed-form, single training pass',
    nodes: [
      barFeaturesNode(0),
      {
        id: 'priors', kind: 'memory', label: 'Class priors P(c)', sublabel: 'empirical class frequency', outShape: `${C}`,
        params: DIM.classes, column: 0, lane: 1,
        detail: { formula: 'DIM.classes — one prior probability per class' },
      },
      {
        id: 'gaussian_params', kind: 'memory', label: 'Per-feature Gaussian parameters', sublabel: 'mean + variance, per class per feature',
        outShape: `${C} × ${F} × 2`, params: DIM.features * DIM.classes * 2, column: 1, lane: 1,
        detail: { formula: 'DIM.features · DIM.classes · 2 — a mean and a variance per feature, per class' },
        analogy: 'Think of it as a cheat-sheet per regime: for each of the 35 indicators, just its average value and how much it wobbles when that regime holds.',
      },
      {
        id: 'likelihood', kind: 'compare', label: 'Per-feature log-likelihood', sublabel: 'Gaussian density, one term per feature',
        column: 2,
      },
      {
        id: 'posterior', kind: 'compare', label: 'Posterior score', sublabel: 'log P(c) + Σⱼ log P(xⱼ|c)',
        column: 3,
        analogy: 'Think of it as adding up 35 small pieces of evidence for each of the 3 candidate classes, then trusting whichever class the evidence points to hardest.',
      },
      { id: 'output', kind: 'output', label: 'Predicted class + posterior', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'likelihood', 'flow'],
      ['gaussian_params', 'likelihood', 'context', 'supplies μ, σ² per class per feature'],
      ['likelihood', 'posterior', 'flow'],
      ['priors', 'posterior', 'context', 'weights the likelihood by how common each class is'],
      ['posterior', 'output', 'flow'],
    ],
  }),

  // ─── Classification And Regression Trees (CART) ─────────────────────────

  'machine-learning-supervised-learning-tree-based-models-classification-and-regression-trees-cart': blueprint({
    title: 'Classification And Regression Trees (CART)',
    subtitle: 'grow to min_samples_leaf=20, then cost-complexity prune',
    nodes: [
      barFeaturesNode(0),
      {
        id: 'split_search', kind: 'compare', label: 'Split search', sublabel: 'every feature × threshold, impurity reduction',
        column: 1,
        analogy: 'Think of it as auditioning every possible yes/no question about the 35 indicators and keeping only the one that best separates winners from losers.',
      },
      {
        id: 'tree_growth', kind: 'tree', label: 'Recursive growth', sublabel: 'binary splits to a stopping rule',
        column: 2,
        detail: { stopping: 'max depth, min samples per leaf/split, min impurity decrease', note: 'grown deliberately oversized before pruning' },
      },
      {
        id: 'pruning', kind: 'compare', label: 'Cost-complexity pruning', sublabel: 'C_α(T) = Σ|t|·I(t) + α|T|',
        column: 3,
        analogy: 'Think of it as trimming back any branch of the tree whose extra accuracy doesn\'t earn back the complexity it costs.',
      },
      {
        id: 'leaf', kind: 'head', label: 'Leaf value', sublabel: 'class distribution (Gini) or mean ȳ_t (MSE)',
        column: 4,
      },
      { id: 'output', kind: 'output', label: 'Class probabilities or predicted value', column: 5 },
    ],
    edges: [
      ...chain('input', 'split_search', 'tree_growth', 'pruning', 'leaf', 'output'),
      ['tree_growth', 'split_search', 'context', 'recurse: search again at every new child node'],
    ],
  }),

  // ─── Decision Tree Classifier ─────────────────────────────────────────────

  'machine-learning-supervised-learning-tree-based-models-decision-tree-classifier': blueprint({
    title: 'Decision Tree Classifier',
    subtitle: 'max_depth=6 · Gini impurity · class_weight=balanced',
    nodes: [
      barFeaturesNode(0),
      {
        id: 'class_weights', kind: 'memory', label: 'Class weights', sublabel: 'inverse class frequency, optional balancing',
        column: 0, lane: 1,
      },
      {
        id: 'split_search', kind: 'compare', label: 'Split search', sublabel: 'Gini or entropy, best of `max_features` candidates',
        column: 1,
        analogy: 'Think of it as testing every candidate threshold on every indicator and picking the single question that most cleanly separates the classes.',
      },
      {
        id: 'tree_growth', kind: 'tree', label: 'Recursive growth', sublabel: 'binary splits to depth 6',
        column: 2,
      },
      {
        id: 'leaf_probs', kind: 'head', label: 'Leaf class proportions', sublabel: 'p_c(t) = n_c,t / n_t',
        column: 3,
        analogy: 'Think of it as the tree finally landing on a small group of past bars that all asked "yes" to the same chain of questions, and reporting how that group actually split between up, flat and down.',
      },
      { id: 'output', kind: 'output', label: 'Predicted class + probabilities', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ...chain('input', 'split_search', 'tree_growth', 'leaf_probs', 'output'),
      ['class_weights', 'split_search', 'context', 'reweights impurity to avoid starving a rare class'],
      ['tree_growth', 'split_search', 'context', 'recurse at every new child node'],
    ],
  }),

  // ─── Extra Trees Regressor ─────────────────────────────────────────────────

  'machine-learning-supervised-learning-tree-based-models-extra-trees-regressor': blueprint({
    title: 'Extra Trees Regressor',
    subtitle: 'M=400 extremely randomized trees · depth ≤ 12 · no bootstrap',
    nodes: [
      barFeaturesNode(0),
      {
        id: 'random_subset', kind: 'stochastic', label: 'Random feature + threshold draw', sublabel: '`max_features` candidates, threshold ~ Uniform(range)',
        column: 1,
        analogy: 'Think of it as each tree flipping a coin on which indicator to look at, and where to draw the cutoff line, instead of carefully searching for the single best split.',
      },
      {
        id: 'trees', kind: 'tree', label: 'M randomized trees', sublabel: 'M=400, depth ≤ 12, each on the full training set',
        column: 2,
        detail: { bootstrap: 'off by default — randomization comes only from feature/threshold draws, not row resampling' },
      },
      {
        id: 'leaf_means', kind: 'memory', label: 'Leaf mean targets', sublabel: 'one stored mean per leaf, per tree',
        column: 3,
      },
      {
        id: 'ensemble_avg', kind: 'ensemble', label: 'Ensemble average', sublabel: 'ŷ(x) = (1/M) Σ ŷ_m(x)',
        column: 4,
        analogy: 'Think of it as polling 400 independently-guessing analysts and trusting only their average — any single guess is nearly worthless, but the crowd\'s mean is remarkably stable.',
      },
      { id: 'output', kind: 'output', label: 'Continuous forecast', sublabel: 'forward return or realized range', outShape: 'B × 1', column: 5 },
    ],
    edges: [
      ...chain('input', 'random_subset', 'trees', 'leaf_means', 'ensemble_avg', 'output'),
      ['trees', 'random_subset', 'context', 'redraw a fresh random threshold at every node, every tree'],
    ],
  }),
};
