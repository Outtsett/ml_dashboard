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
 *
 * Stated simplification, true of all four non-gradient diagrams: a single
 * left-to-right row carries BOTH the fitting procedure and the prediction path,
 * because neither is a layer stack and drawing them apart would need two
 * diagrams. The node where fitting ends and prediction begins is labelled on the
 * edge, so nothing is left implicit.
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
    subtitle: 'k=15 · distance-weighted · Euclidean (p=2) · 50,000-bar reference set',
    nodes: [
      barFeaturesNode(0),
      standardizeNode(1),
      {
        id: 'reference_set', kind: 'memory', label: 'Stored reference set', sublabel: '50,000 historical bars × 35 features',
        outShape: `N × ${F}`, column: 1, lane: 1,
        detail: {
          stored: 'every past labeled bar, standardized with the same trailing statistics as the query',
          'trainable parameters': 'none — nothing is fit; this IS the model',
          index: 'a KD-tree or ball tree prunes only while the feature count is small; over 35 features scikit-learn\'s algorithm="auto" selects the brute-force scan, so the search below is genuinely over all N points',
        },
        analogy: 'Think of it as a trader\'s notebook of every past setup, filed so the most similar one can be pulled up instantly.',
      },
      {
        id: 'distance', kind: 'compare', label: 'Distance to every reference point', sublabel: 'Minkowski, p=2 (Euclidean)',
        inShape: `B × ${F}`, outShape: 'B × N', column: 2,
        analogy: 'Think of it as measuring how far today\'s bar sits from every bar ever filed away, in 35-dimensional indicator space.',
      },
      {
        id: 'neighbor_select', kind: 'compare', label: 'k-nearest selection', sublabel: 'k=15 smallest distances',
        inShape: 'B × N', outShape: 'B × 15', column: 3,
      },
      {
        id: 'vote', kind: 'pool', label: 'Distance-weighted vote', sublabel: 'ŷ = argmax_c Σ w_i·1[y_i=c], w_i = 1/d_i',
        inShape: 'B × 15', outShape: `B × ${C}`, column: 4,
        analogy: 'Think of it as polling the 15 most similar historical bars and letting the closest ones speak loudest about what happened next.',
      },
      {
        id: 'output', kind: 'output', label: 'Predicted class + confidence', sublabel: 'each class\'s share of the neighbors\' inverse-distance weight',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 5,
      },
    ],
    edges: [
      ...chain('input', 'standardize', 'distance', 'neighbor_select', 'vote', 'output'),
      ['reference_set', 'distance', 'context', 'every stored point is a candidate neighbor'],
    ],
  }),

  // ─── Multi-Layer Perceptron (classical, sklearn-style) ─────────────────

  'machine-learning-supervised-learning-neural-models-multi-layer-perceptron-mlp': blueprint({
    title: 'Multi-Layer Perceptron (MLP)',
    subtitle: `${F} → 64 → 32 → ${C}, ReLU, dropout 0.2 — 4,483 trainable parameters`,
    nodes: [
      barFeaturesNode(0),
      {
        id: 'hidden1', kind: 'linear', label: 'Hidden layer 1', sublabel: `${F} → 64, ReLU`,
        inShape: `B × ${F}`, outShape: 'B × 64', params: P.linear(F, 64), column: 1,
        detail: { formula: 'P.linear(35, 64) = 35·64 + 64' },
        analogy: 'Think of it as 64 analysts each forming their own weighted read of the 35 indicators, then discarding any opinion that comes out negative.',
      },
      {
        id: 'drop', kind: 'dropout', label: 'Dropout', sublabel: 'p = 0.2, training only',
        inShape: 'B × 64', outShape: 'B × 64', column: 2,
        detail: {
          'trainable parameters': 'none — dropout only masks activations',
          availability: 'scikit-learn\'s MLPClassifier has no dropout parameter; this stage exists in the PyTorch build of the same network, and the sklearn build regularizes with L2 (alpha) and early stopping instead',
        },
      },
      {
        id: 'hidden2', kind: 'linear', label: 'Hidden layer 2', sublabel: '64 → 32, ReLU',
        inShape: 'B × 64', outShape: 'B × 32', params: P.linear(64, 32), column: 3,
        detail: { formula: 'P.linear(64, 32) = 64·32 + 32' },
        analogy: 'Think of it as a second panel that only reads the first panel\'s 64 opinions, looking for a smaller set of higher-order patterns among them.',
      },
      {
        id: 'head', kind: 'head', label: 'Output head', sublabel: `Linear 32 → ${C}`,
        inShape: 'B × 32', outShape: `B × ${C}`, params: P.linear(32, C), column: 4,
        detail: { formula: 'P.linear(32, 3) = 32·3 + 3' },
      },
      {
        id: 'output', kind: 'output', label: 'Class probabilities', sublabel: 'softmax',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 5,
      },
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
        id: 'priors', kind: 'memory', label: 'Class priors P(c)', sublabel: 'empirical class frequency',
        outShape: `${C}`, params: DIM.classes, column: 0, lane: 1,
        detail: { formula: 'DIM.classes — one prior probability per class', fitted: 'the fraction of training bars in each class, one pass' },
      },
      standardizeNode(1),
      {
        id: 'gaussian_params', kind: 'memory', label: 'Per-feature Gaussian parameters', sublabel: 'mean + variance, per class per feature',
        outShape: `${C} × ${F} × 2`, params: DIM.features * DIM.classes * 2, column: 1, lane: 1,
        detail: {
          formula: 'DIM.features · DIM.classes · 2 — a mean and a variance per feature, per class',
          fitted: 'closed-form maximum likelihood in one pass, not by gradient descent',
        },
        analogy: 'Think of it as a cheat-sheet per regime: for each of the 35 indicators, just its average value and how much it wobbles when that regime holds.',
      },
      {
        id: 'likelihood', kind: 'compare', label: 'Per-feature log-likelihood', sublabel: 'log N(xⱼ | μ_c,ⱼ, σ²_c,ⱼ), one term per feature per class',
        inShape: `B × ${F}`, outShape: `B × ${C} × ${F}`, column: 2,
      },
      {
        id: 'posterior', kind: 'compare', label: 'Posterior score', sublabel: 'log P(c) + Σⱼ log P(xⱼ|c)',
        inShape: `B × ${C} × ${F}`, outShape: `B × ${C}`, column: 3,
        analogy: 'Think of it as adding up 35 small pieces of evidence for each of the 3 candidate classes, then trusting whichever class the evidence points to hardest.',
      },
      {
        id: 'output', kind: 'output', label: 'Predicted class + posterior', sublabel: 'argmax over the 3 scores, normalized',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 4,
      },
    ],
    edges: [
      ...chain('input', 'standardize', 'likelihood'),
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
        inShape: `B × ${F}`, column: 1,
        detail: { objective: 'minimize (|t_L|/|t|)·I(t_L) + (|t_R|/|t|)·I(t_R)', impurity: 'Gini for classification, MSE for regression' },
        analogy: 'Think of it as auditioning every possible yes/no question about the 35 indicators and keeping only the one that best separates winners from losers.',
      },
      {
        id: 'tree_growth', kind: 'tree', label: 'Recursive growth', sublabel: 'binary splits to a stopping rule',
        column: 2,
        detail: { stopping: 'max depth, min samples per leaf/split, min impurity decrease', note: 'grown deliberately oversized before pruning' },
      },
      {
        id: 'pruning', kind: 'compare', label: 'Cost-complexity pruning', sublabel: 'C_α(T) = Σ_{t ∈ leaves} (|t|/N)·I(t) + α·|leaves|',
        column: 3,
        detail: {
          'trainable parameters': 'none — the fitted model is the surviving tree structure plus one value per leaf, not a weight vector',
          selection: 'α chosen along the pruned-subtree sequence; the smallest tree within one standard error of the best',
        },
        analogy: 'Think of it as trimming back any branch of the tree whose extra accuracy doesn\'t earn back the complexity it costs.',
      },
      {
        id: 'route', kind: 'tree', label: 'Route the query', sublabel: 'walk x_j ≤ τ from the root to one leaf',
        outShape: 'B × 1 leaf id', column: 4,
        detail: { inputs: `the pruned tree (flow) and the query bar B × ${F} (context)` },
        analogy: 'Think of it as answering the same short checklist of yes/no questions about today\'s bar until you land in exactly one bucket of past bars.',
      },
      {
        id: 'leaf', kind: 'head', label: 'Leaf value', sublabel: 'class distribution (Gini) or mean ȳ_t (MSE)',
        inShape: 'B × 1 leaf id', column: 5,
      },
      {
        id: 'output', kind: 'output', label: 'Class probabilities or predicted value', column: 6,
      },
    ],
    edges: [
      ...chain('input', 'split_search', 'tree_growth'),
      ['tree_growth', 'pruning', 'flow'],
      ['pruning', 'route', 'flow', 'fitting ends here — everything to the right is prediction'],
      ...chain('route', 'leaf', 'output'),
      ['tree_growth', 'split_search', 'context', 'recurse: search again at every new child node'],
      ['input', 'route', 'context', 'the query bar walks the same thresholds at prediction time'],
    ],
  }),

  // ─── Decision Tree Classifier ─────────────────────────────────────────────

  'machine-learning-supervised-learning-tree-based-models-decision-tree-classifier': blueprint({
    title: 'Decision Tree Classifier',
    subtitle: 'max_depth=6 · Gini impurity · class_weight=balanced',
    nodes: [
      barFeaturesNode(0),
      {
        id: 'class_weights', kind: 'memory', label: 'Class weights', sublabel: 'w_c = n / (C · n_c), inverse class frequency',
        outShape: `${C}`, column: 0, lane: 1,
        detail: { 'trainable parameters': 'none — read off the label counts before the first split', reach: 'the same weights enter the impurity criterion AND the leaf statistics' },
      },
      {
        id: 'split_search', kind: 'compare', label: 'Split search', sublabel: 'Gini or entropy, best of `max_features` candidates',
        inShape: `B × ${F}`, column: 1,
        analogy: 'Think of it as testing every candidate threshold on every indicator and picking the single question that most cleanly separates the classes.',
      },
      {
        id: 'tree_growth', kind: 'tree', label: 'Recursive growth', sublabel: 'binary splits to depth 6',
        column: 2,
        detail: { stopping: 'max_depth=6, min_samples_split=20, min_samples_leaf=10' },
      },
      {
        id: 'route', kind: 'tree', label: 'Route the query', sublabel: 'walk x_j ≤ τ from the root to one leaf',
        outShape: 'B × 1 leaf id', column: 3,
        detail: { inputs: `the grown tree (flow) and the query bar B × ${F} (context)` },
        analogy: 'Think of it as the tree landing on the one small group of past bars that answered "yes" to exactly the same chain of questions today\'s bar does.',
      },
      {
        id: 'leaf_probs', kind: 'head', label: 'Leaf class shares', sublabel: 'p_c(t) = Σ_{i∈t} w_i·1[y_i=c] / Σ_{i∈t} w_i',
        inShape: 'B × 1 leaf id', outShape: `B × ${C}`, column: 4,
        detail: {
          'read as': 'a weight-normalized share, not the raw fraction of bars in the leaf — class_weight=balanced deliberately inflates the rare class, so this is not a calibrated probability',
        },
        analogy: 'Think of it as reading off how that group of past bars actually split between up, flat and down, after rescaling so the rare outcome is not drowned out.',
      },
      {
        id: 'output', kind: 'output', label: 'Predicted class + probabilities', sublabel: 'argmax over the leaf shares',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 5,
      },
    ],
    edges: [
      ...chain('input', 'split_search', 'tree_growth'),
      ['tree_growth', 'route', 'flow', 'fitting ends here — everything to the right is prediction'],
      ...chain('route', 'leaf_probs', 'output'),
      ['class_weights', 'split_search', 'context', 'reweights impurity to avoid starving a rare class'],
      ['class_weights', 'leaf_probs', 'context', 'the same weights normalize the stored leaf counts'],
      ['tree_growth', 'split_search', 'context', 'recurse at every new child node'],
      ['input', 'route', 'context', 'the query bar walks the same thresholds at prediction time'],
    ],
  }),

  // ─── Extra Trees Regressor ─────────────────────────────────────────────────

  'machine-learning-supervised-learning-tree-based-models-extra-trees-regressor': blueprint({
    title: 'Extra Trees Regressor',
    subtitle: 'M=400 extremely randomized trees · depth ≤ 12 · no bootstrap',
    nodes: [
      barFeaturesNode(0),
      {
        id: 'random_subset', kind: 'stochastic', label: 'Random threshold draw', sublabel: 'one cut-point per candidate feature, Uniform over its in-node range',
        inShape: `B × ${F}`, column: 1,
        detail: {
          'max_features': '1.0 — all 35 features are candidates, which is scikit-learn\'s regression default; the randomness comes from the threshold, not the feature subset',
          selection: 'of the candidate (feature, random threshold) pairs, keep the one with the largest variance reduction',
        },
        analogy: 'Think of it as each tree throwing a dart to pick where to draw the cutoff line on each indicator, instead of carefully searching for the single best place.',
      },
      {
        id: 'trees', kind: 'tree', label: 'M randomized trees', sublabel: 'M=400, depth ≤ 12, each on the full training set',
        column: 2,
        detail: {
          bootstrap: 'off — randomization comes only from the threshold draws, not row resampling, which is the defining Extra Trees configuration',
          'trainable parameters': 'none — 400 tree structures plus one stored mean per leaf',
          consequence: 'with bootstrap off there are no out-of-bag rows, so the later block is the only validation',
        },
      },
      {
        id: 'leaf_means', kind: 'memory', label: 'Leaf mean targets', sublabel: 'one stored mean per leaf; a query reads the leaf it lands in, per tree',
        outShape: 'B × M', column: 3,
      },
      {
        id: 'ensemble_avg', kind: 'ensemble', label: 'Ensemble average', sublabel: 'ŷ(x) = (1/M) Σ_m ŷ_m(x)',
        inShape: 'B × M', outShape: 'B × 1', column: 4,
        analogy: 'Think of it as polling 400 independently-guessing analysts and trusting only their average — any single guess is nearly worthless, but the crowd\'s mean is remarkably stable.',
      },
      {
        id: 'output', kind: 'output', label: 'Continuous forecast', sublabel: 'forward return or realized range',
        inShape: 'B × 1', outShape: 'B × 1', column: 5,
      },
    ],
    edges: [
      ...chain('input', 'random_subset', 'trees'),
      ['trees', 'leaf_means', 'flow', 'fitting ends here — everything to the right is prediction'],
      ...chain('leaf_means', 'ensemble_avg', 'output'),
      ['trees', 'random_subset', 'context', 'redraw a fresh random threshold at every node, every tree'],
      ['input', 'leaf_means', 'context', 'the query bar is routed through all 400 trees at prediction time'],
    ],
  }),
};
