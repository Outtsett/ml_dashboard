/**
 * Blueprints — Machine Learning / Supervised Learning.
 *
 * One entry per catalog spec id, stages in data-flow order, every parameter
 * count from `P`. Classical estimators (boosted trees, forests, linear
 * models, SVM) are computation pipelines — input -> standardize -> the
 * estimator's real stages -> output — not a neural net wearing a costume.
 */

import type { ArchGraph } from '../types';
import type { NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const C = DIM.classes;

// ─── Shared node fragments ──────────────────────────────────────────────────

function inputNode(column: number, lane = 0): NodeSpec {
  return {
    id: 'input', kind: 'input', label: 'Bar features', sublabel: `${F} indicators, this bar`,
    outShape: `B × ${F}`, column, lane,
    analogy: 'Think of it as the trader glancing at this bar\'s 35 indicator readings the instant it closes — no history, just this snapshot.',
  };
}

function standardizeNode(column: number, lane = 0): NodeSpec {
  return {
    id: 'standardize', kind: 'norm', label: 'Standardize', sublabel: 'causal rolling z-score, per feature',
    inShape: `B × ${F}`, outShape: `B × ${F}`, column, lane,
  };
}

// ─── Boosting template (XGBoost, LightGBM, CatBoost, GBM) ──────────────────

export const SUPERVISED_BLUEPRINTS: Record<string, ArchGraph> = {
  'machine-learning-supervised-learning-boosting-methods-xgboost': blueprint({
    title: 'XGBoost',
    subtitle: 'second-order gradient boosting · level-wise trees · L1+L2 leaf regularization',
    nodes: [
      inputNode(0),
      {
        id: 'accum', kind: 'memory', label: 'Running prediction ŷ', sublabel: 'additive raw scores, init = log-odds prior',
        outShape: `B × ${C}`, column: 0, lane: 1,
        analogy: 'Think of it as the running score sheet every tree adds a small correction to — never rewritten, only added to.',
      },
      {
        id: 'gradient', kind: 'compare', label: 'Gradient + Hessian', sublabel: 'gᵢ = ∂L/∂ŷ, hᵢ = ∂²L/∂ŷ² (second-order)',
        inShape: `B × ${C}`, outShape: `B × ${C} × 2`, column: 1, lane: 1,
      },
      {
        id: 'tree', kind: 'tree', label: 'Tree t', sublabel: `level-wise · max depth 6 · one tree per class, so ${C} per round`,
        inShape: `B × ${F}`, outShape: `B × ${C}`, column: 2, lane: 0,
        detail: {
          split: 'Gain = ½[(ΣgL)²/(ΣhL+λ) + (ΣgR)²/(ΣhR+λ) − (Σg)²/(Σh+λ)] − γ',
          'L1 / L2 leaf penalty': 'α, λ shrink leaf weights toward 0',
          trees: '100–1000 rounds (T), learning rate η 0.01–0.3',
        },
        analogy: 'Think of it as the next tree being handed a list of exactly which bars the ensemble is most wrong about, and by how much, then told to fix only those.',
      },
      {
        id: 'ensemble', kind: 'ensemble', label: 'Boosted ensemble', sublabel: 'Σ η·h_t(x), t = 1…T',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 3, lane: 0,
      },
      {
        id: 'activation', kind: 'activation', label: 'Softmax', sublabel: 'raw scores → class probabilities',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 4, lane: 0,
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', sublabel: 'softmax probabilities', outShape: `B × ${C}`, column: 5, lane: 0 },
    ],
    edges: [
      ['input', 'tree', 'flow'],
      ...chain('tree', 'ensemble', 'activation', 'output'),
      ['accum', 'gradient', 'context', 'current ŷ'],
      ['gradient', 'tree', 'context', 'gᵢ, hᵢ — what tree t is fit to'],
      ['ensemble', 'accum', 'context', 'ŷ ← ŷ + η·h_t(x), next t'],
    ],
  }),

  'machine-learning-supervised-learning-boosting-methods-lightgbm': blueprint({
    title: 'LightGBM',
    subtitle: 'histogram-binned · leaf-wise growth · native categorical splits',
    nodes: [
      inputNode(0),
      {
        id: 'accum', kind: 'memory', label: 'Running prediction ŷ', sublabel: 'additive raw scores, init = prior',
        outShape: `B × ${C}`, column: 0, lane: 1,
        analogy: 'Think of it as the running score sheet every tree adds a small correction to — never rewritten, only added to.',
      },
      {
        id: 'histogram', kind: 'reshape', label: 'Histogram bins', sublabel: '~255 bins per feature, continuous → discrete',
        inShape: `B × ${F}`, outShape: `B × ${F}`, column: 1, lane: 0,
      },
      {
        id: 'gradient', kind: 'compare', label: 'Gradient + Hessian', sublabel: 'gᵢ, hᵢ from current ŷ',
        inShape: `B × ${C}`, outShape: `B × ${C} × 2`, column: 1, lane: 1,
      },
      {
        id: 'tree', kind: 'tree', label: 'Tree t', sublabel: 'leaf-wise · splits the leaf with max loss reduction',
        inShape: `B × ${F}`, outShape: `B × ${C}`, column: 2, lane: 0,
        detail: { growth: 'best-leaf-first, not level-by-level → deeper, fewer, more accurate splits', leaves: 'max 31–127', trees: `100–1000 rounds (T), ${C} trees per round` },
        analogy: 'Think of it as a builder who always extends whichever branch of the tree is currently wrong the most, instead of finishing one full floor before starting the next.',
      },
      { id: 'ensemble', kind: 'ensemble', label: 'Boosted ensemble', sublabel: 'Σ η·h_t(x), t = 1…T', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 3, lane: 0 },
      { id: 'activation', kind: 'activation', label: 'Softmax', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 4, lane: 0 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'histogram', 'tree', 'ensemble', 'activation', 'output'),
      ['accum', 'gradient', 'context', 'current ŷ'],
      ['gradient', 'tree', 'context', 'gᵢ, hᵢ — what tree t is fit to'],
      ['ensemble', 'accum', 'context', 'ŷ ← ŷ + η·h_t(x), next t'],
    ],
  }),

  'machine-learning-supervised-learning-boosting-methods-catboost': blueprint({
    title: 'CatBoost',
    subtitle: 'ordered target encoding · symmetric (oblivious) trees',
    nodes: [
      inputNode(0),
      {
        id: 'accum', kind: 'memory', label: 'Running prediction ŷ', sublabel: 'additive raw scores, init = prior',
        outShape: `B × ${C}`, column: 0, lane: 1,
      },
      {
        id: 'ordered_stats', kind: 'embedding', label: 'Ordered target statistics', sublabel: 'categorical → mean-target encoding, permutation-ordered',
        inShape: `B × ${F}`, outShape: `B × ${F}`, column: 1, lane: 0,
        analogy: 'Think of it as encoding "which market regime" the same way a trader would learn it — from regimes seen so far only, never peeking at today\'s outcome to encode today.',
      },
      { id: 'gradient', kind: 'compare', label: 'Ordered gradient', sublabel: 'gᵢ from a model that never saw bar i', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 1, lane: 1 },
      {
        id: 'tree', kind: 'tree', label: 'Symmetric tree t', sublabel: 'oblivious: same split feature+threshold at every node of a level',
        inShape: `B × ${F}`, outShape: `B × ${C}`, column: 2, lane: 0,
        detail: { structure: 'balanced, identical split per depth level → fast, stable', depth: '6–10', trees: `100–1000 rounds (T), ${C} trees per round` },
        analogy: 'Think of it as a decision checklist applied identically to every bar at a given step — bar 500 and bar 5 are asked the exact same question first.',
      },
      { id: 'ensemble', kind: 'ensemble', label: 'Boosted ensemble', sublabel: 'Σ η·h_t(x), t = 1…T', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 3, lane: 0 },
      { id: 'activation', kind: 'activation', label: 'Softmax', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 4, lane: 0 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'ordered_stats', 'tree', 'ensemble', 'activation', 'output'),
      ['accum', 'gradient', 'context', 'current ŷ'],
      ['gradient', 'tree', 'context', 'ordered gᵢ — what tree t is fit to'],
      ['ensemble', 'accum', 'context', 'ŷ ← ŷ + η·h_t(x), next t'],
    ],
  }),

  'machine-learning-supervised-learning-boosting-methods-gradient-boosting-machine-gbm': blueprint({
    title: 'Gradient Boosting Machine (GBM)',
    subtitle: 'canonical staged additive model · first-order gradient · line-search step',
    nodes: [
      inputNode(0),
      { id: 'accum', kind: 'memory', label: 'Running prediction ŷ', sublabel: 'additive raw scores, init = prior', outShape: `B × ${C}`, column: 0, lane: 1 },
      { id: 'gradient', kind: 'compare', label: 'Negative gradient', sublabel: 'rᵢ = −∂L/∂ŷ (pseudo-residual)', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 1, lane: 1 },
      {
        id: 'tree', kind: 'tree', label: 'Tree t', sublabel: 'fits pseudo-residuals, depth 3–8',
        inShape: `B × ${F}`, outShape: `B × ${C}`, column: 2, lane: 0,
        detail: { criterion: 'MSE split on the residual, not the label', trees: `100–1000 rounds (T), ${C} trees per round` },
        analogy: 'Think of it as the simplest version of "the next tree corrects the last one\'s mistakes" — no histogram trick, no ordering trick, just the textbook loop.',
      },
      {
        id: 'line_search', kind: 'compare', label: 'Line search', sublabel: 'γ_t = argmin_γ ΣL(y, ŷ + γ·h_t(x))',
        column: 3, lane: 1,
      },
      { id: 'ensemble', kind: 'ensemble', label: 'Boosted ensemble', sublabel: 'Σ η·γ_t·h_t(x), t = 1…T', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 3, lane: 0 },
      { id: 'activation', kind: 'activation', label: 'Softmax', inShape: `B × ${C}`, outShape: `B × ${C}`, column: 4, lane: 0 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'tree', 'ensemble', 'activation', 'output'),
      ['accum', 'gradient', 'context', 'current ŷ'],
      ['gradient', 'tree', 'context', 'rᵢ — what tree t is fit to'],
      ['tree', 'line_search', 'context', 'how far to step along h_t'],
      ['line_search', 'accum', 'context', 'ŷ ← ŷ + η·γ_t·h_t(x), next t'],
    ],
  }),

  // ─── Calibration & meta-learners ────────────────────────────────────────

  'machine-learning-supervised-learning-calibration-meta-learners-calibrated-classifier': blueprint({
    title: 'Calibrated Classifier',
    subtitle: 'base ensemble + Platt scaling, one-vs-rest',
    nodes: [
      inputNode(0),
      {
        id: 'base', kind: 'tree', label: 'Base ensemble', sublabel: 'e.g. Random Forest, T=100 trees',
        inShape: `B × ${F}`, outShape: `T × (B × ${C})`, column: 1,
        analogy: 'Think of it as a hundred traders each glancing at a random subset of today\'s indicators, then casting a vote.',
      },
      { id: 'vote', kind: 'ensemble', label: 'Vote share', sublabel: 'fraction of trees voting each class', inShape: `T × (B × ${C})`, outShape: `B × ${C}`, column: 2 },
      {
        id: 'platt', kind: 'linear', label: 'Platt scaling', sublabel: 'logistic fit per class: σ(a·s + b)',
        inShape: `B × ${C}`, outShape: `B × ${C}`, params: C * P.linear(1, 1), column: 3,
        detail: { formula: 'C × [1 input, 1 output] = 3 × 2', a: 'learned slope', b: 'learned intercept' },
        analogy: 'Think of it as a translator turning "62% of the trees voted up" into an honest probability — raw vote share is usually over- or under-confident.',
      },
      { id: 'output', kind: 'output', label: 'Calibrated probabilities', outShape: `B × ${C}`, column: 4 },
      {
        id: 'nll_loss', kind: 'compare', label: 'Negative log-likelihood', sublabel: 'on a held-out calibration fold',
        column: 5,
      },
    ],
    edges: [
      ...chain('input', 'base', 'vote', 'platt', 'output'),
      ['output', 'nll_loss', 'context', 'compares to held-out label'],
      ['nll_loss', 'platt', 'context', 'fits a, b via gradient descent'],
    ],
  }),

  // ─── Ensemble methods ───────────────────────────────────────────────────

  'machine-learning-supervised-learning-ensemble-methods-random-forest': blueprint({
    title: 'Random Forest',
    subtitle: 'T bagged trees · random √p feature subset per split · majority vote',
    nodes: [
      inputNode(0, 1),
      {
        id: 'bootstrap_a', kind: 'stochastic', label: 'Bootstrap sample', sublabel: 'resample N rows with replacement',
        inShape: `B × ${F}`, outShape: `B × ${F}`, column: 1, lane: 0,
        analogy: 'Think of it as dealing each tree its own hand of bars, drawn with replacement, so no two trees study quite the same data.',
      },
      { id: 'bootstrap_b', kind: 'stochastic', label: 'Bootstrap sample', sublabel: 'resample N rows with replacement', inShape: `B × ${F}`, outShape: `B × ${F}`, column: 1, lane: 1 },
      { id: 'bootstrap_c', kind: 'stochastic', label: 'Bootstrap sample', sublabel: 'resample N rows with replacement', inShape: `B × ${F}`, outShape: `B × ${F}`, column: 1, lane: 2 },
      { id: 'tree_a', kind: 'tree', label: 'Tree', sublabel: '√35 ≈ 6 random features per split', inShape: `B × ${F}`, outShape: `B × ${C}`, column: 2, lane: 0 },
      { id: 'tree_b', kind: 'tree', label: 'Tree', sublabel: '√35 ≈ 6 random features per split', inShape: `B × ${F}`, outShape: `B × ${C}`, column: 2, lane: 1 },
      { id: 'tree_c', kind: 'tree', label: 'Tree', sublabel: '√35 ≈ 6 random features per split', inShape: `B × ${F}`, outShape: `B × ${C}`, column: 2, lane: 2 },
      {
        id: 'vote', kind: 'ensemble', label: 'Majority vote', sublabel: 'T = 100–500 trees, illustrated here as 3',
        inShape: `T × (B × ${C})`, outShape: `B × ${C}`, column: 3, lane: 1,
        analogy: 'Think of it as the panel calling a show of hands — the class with the most votes across every independently-grown tree wins.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4, lane: 1 },
    ],
    edges: [
      ['input', 'bootstrap_a', 'flow'], ['input', 'bootstrap_b', 'flow'], ['input', 'bootstrap_c', 'flow'],
      ['bootstrap_a', 'tree_a', 'flow'], ['bootstrap_b', 'tree_b', 'flow'], ['bootstrap_c', 'tree_c', 'flow'],
      ['tree_a', 'vote', 'flow'], ['tree_b', 'vote', 'flow'], ['tree_c', 'vote', 'flow'],
      ['vote', 'output', 'flow'],
    ],
  }),

  'machine-learning-supervised-learning-ensemble-methods-stacked-generalization-model': blueprint({
    title: 'Stacked Generalization Model',
    subtitle: 'diverse base learners → out-of-fold meta-features → meta-learner',
    nodes: [
      inputNode(0, 1),
      { id: 'base_rf', kind: 'tree', label: 'Random Forest', sublabel: 'level-0 model A', inShape: `B × ${F}`, outShape: `B × ${C}`, column: 1, lane: 0 },
      { id: 'base_gb', kind: 'tree', label: 'Gradient Boosting', sublabel: 'level-0 model B', inShape: `B × ${F}`, outShape: `B × ${C}`, column: 1, lane: 1 },
      {
        id: 'base_svm', kind: 'compare', label: 'SVM (RBF)', sublabel: 'level-0 model C', inShape: `B × ${F}`, outShape: `B × ${C}`, column: 1, lane: 2,
        analogy: 'Think of it as three analysts with different training — a tree-forest generalist, a boosting specialist, and a margin-based statistician — each producing an independent forecast.',
      },
      {
        id: 'meta_features', kind: 'fusion', label: 'Meta-features', sublabel: `concatenate out-of-fold predictions: 3 models × ${C} classes`,
        inShape: `3 × (B × ${C})`, outShape: `B × ${3 * C}`, column: 2, lane: 1,
      },
      {
        id: 'meta_learner', kind: 'linear', label: 'Meta-learner', sublabel: 'logistic regression over base predictions',
        inShape: `B × ${3 * C}`, outShape: `B × ${C}`, params: P.linear(3 * C, C), column: 3, lane: 1,
        analogy: 'Think of it as a head trader who has learned, from experience, how much to trust each analyst\'s call under which conditions — not just averaging them blindly.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4, lane: 1 },
    ],
    edges: [
      ['input', 'base_rf', 'flow'], ['input', 'base_gb', 'flow'], ['input', 'base_svm', 'flow'],
      ['base_rf', 'meta_features', 'flow'], ['base_gb', 'meta_features', 'flow'], ['base_svm', 'meta_features', 'flow'],
      ...chain('meta_features', 'meta_learner', 'output'),
    ],
  }),

  // ─── Linear models ──────────────────────────────────────────────────────

  'machine-learning-supervised-learning-linear-models-linear-regression': blueprint({
    title: 'Linear Regression',
    subtitle: 'ordinary least squares, closed-form normal equation',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Weighted sum', sublabel: 'ŷ = w·x + b',
        inShape: `B × ${F}`, outShape: `B × 1`, params: P.linear(F, 1), column: 2,
        analogy: 'Think of it as 35 dials, one per indicator, each turned to a fixed weight — the prediction is just their combined reading.',
      },
      { id: 'output', kind: 'output', label: 'Predicted value', sublabel: 'continuous target', outShape: `B × 1`, column: 3 },
      { id: 'loss', kind: 'compare', label: 'Mean squared error', sublabel: '‖y − ŷ‖² / N', column: 4 },
      { id: 'fit', kind: 'compare', label: 'Normal equation', sublabel: 'w = (XᵀX)⁻¹Xᵀy, closed form', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['output', 'loss', 'context', 'compares to label'],
      ['loss', 'fit', 'context'],
      ['fit', 'linear', 'context', 'sets w, b directly'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-ridge-regression': blueprint({
    title: 'Ridge Regression',
    subtitle: 'linear regression + L2 shrinkage',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Weighted sum', sublabel: 'ŷ = w·x + b',
        inShape: `B × ${F}`, outShape: `B × 1`, params: P.linear(F, 1), column: 2,
        detail: { penalty: 'λ‖w‖₂² added to the loss — shrinks every weight toward 0, never to exactly 0' },
        analogy: 'Think of it as the same 35 dials as Linear Regression, but each is gently pulled back toward zero so no single correlated indicator can dominate.',
      },
      { id: 'output', kind: 'output', label: 'Predicted value', outShape: `B × 1`, column: 3 },
      { id: 'loss', kind: 'compare', label: 'Ridge loss', sublabel: '‖y−ŷ‖²/N + λ‖w‖₂²', column: 4 },
      { id: 'fit', kind: 'compare', label: 'Regularized normal equation', sublabel: 'w = (XᵀX + λI)⁻¹Xᵀy', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['output', 'loss', 'context'],
      ['loss', 'fit', 'context'],
      ['fit', 'linear', 'context', 'sets w, b directly'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-lasso-regression': blueprint({
    title: 'Lasso Regression',
    subtitle: 'linear regression + L1 shrinkage → sparsity',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'linear', kind: 'linear', label: 'Weighted sum', sublabel: 'ŷ = w·x + b', inShape: `B × ${F}`, outShape: `B × 1`, params: P.linear(F, 1), column: 2 },
      { id: 'output', kind: 'output', label: 'Predicted value', sublabel: 'continuous target', outShape: `B × 1`, column: 3 },
      { id: 'loss', kind: 'compare', label: 'Lasso loss', sublabel: '‖y−ŷ‖²/2N + λ‖w‖₁', column: 4 },
      { id: 'fit', kind: 'compare', label: 'Coordinate descent', sublabel: 'one coefficient at a time, iterate to convergence', column: 5 },
      {
        id: 'soft_threshold', kind: 'gate', label: 'Soft-threshold the coefficient', sublabel: 'w_j ← sign(w_j)·max(|w_j|−λ, 0)',
        column: 6,
        analogy: 'Think of it as a filter that mutes any indicator whose signal is too weak to beat a threshold — it doesn\'t just turn the dial down, it can turn it fully off.',
      },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['output', 'loss', 'context', 'compares to label'],
      ['loss', 'fit', 'context'],
      ['fit', 'soft_threshold', 'context', 'per-coordinate update'],
      ['soft_threshold', 'linear', 'context', 'w_j can land exactly on 0 — the feature drops out'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-elasticnet-regression': blueprint({
    title: 'ElasticNet Regression',
    subtitle: 'mixes L1 sparsity and L2 shrinkage via α',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'linear', kind: 'linear', label: 'Weighted sum', sublabel: 'ŷ = w·x + b', inShape: `B × ${F}`, outShape: `B × 1`, params: P.linear(F, 1), column: 2 },
      { id: 'output', kind: 'output', label: 'Predicted value', sublabel: 'continuous target', outShape: `B × 1`, column: 3 },
      { id: 'loss', kind: 'compare', label: 'ElasticNet loss', sublabel: '‖y−ŷ‖²/2N + λ[α‖w‖₁ + (1−α)/2‖w‖₂²]', column: 4 },
      { id: 'fit', kind: 'compare', label: 'Coordinate descent', sublabel: 'one coefficient at a time, iterate to convergence', column: 5 },
      {
        id: 'soft_threshold', kind: 'gate', label: 'α-weighted coefficient update', sublabel: 'soft-threshold by λα, then divide by 1 + λ(1−α)',
        column: 6,
        analogy: 'Think of it as Lasso\'s off-switch and Ridge\'s dimmer sharing the same dial — α decides how much each gets to vote.',
      },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['output', 'loss', 'context', 'compares to label'],
      ['loss', 'fit', 'context'],
      ['fit', 'soft_threshold', 'context', 'per-coordinate update'],
      ['soft_threshold', 'linear', 'context', 'L1 half can zero w_j, L2 half only shrinks it'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-bayesian-ridge-regression': blueprint({
    title: 'Bayesian Ridge Regression',
    subtitle: 'posterior mean + coefficient uncertainty, EM-tuned precision',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Posterior mean', sublabel: 'ŷ = μ_w·x',
        inShape: `B × ${F}`, outShape: `B × 1`, params: P.linear(F, 1), column: 2,
        analogy: 'Think of it as Ridge Regression\'s 35 dials, except each dial\'s setting is really the peak of a belief distribution, not a single fixed number.',
      },
      {
        id: 'posterior_cov', kind: 'memory', label: 'Coefficient covariance Σ_w', sublabel: 'carried, refined every EM step',
        outShape: `${F} × ${F}`, column: 2, lane: 1,
        analogy: 'Think of it as the model keeping a confidence range around every dial, not just a best guess — so a prediction ships with "how sure am I".',
      },
      { id: 'output', kind: 'output', label: 'Predicted value ± interval', outShape: `B × 1`, column: 3 },
      { id: 'loss', kind: 'compare', label: 'Neg. log marginal likelihood', column: 4 },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['posterior_cov', 'output', 'context', 'predictive variance xᵀΣ_w x + 1/α — the ± half of the answer'],
      ['output', 'loss', 'context'],
      ['loss', 'linear', 'context', 'EM: update μ_w'],
      ['loss', 'posterior_cov', 'context', 'EM: update Σ_w, α, λ'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-lars-least-angle-regression': blueprint({
    title: 'Least Angle Regression (LARS)',
    subtitle: 'stepwise, adds one feature at a time along the equiangular path',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Weighted sum', sublabel: 'ŷ = w·x + b, w built up one feature at a time',
        inShape: `B × ${F}`, outShape: `B × 1`, params: P.linear(F, 1), column: 2,
        detail: { sparsity: 'only the active set is non-zero — after step k, exactly k of the 35 weights are in play' },
      },
      { id: 'output', kind: 'output', label: 'Predicted value', sublabel: 'continuous target', outShape: `B × 1`, column: 3 },
      {
        id: 'correlate', kind: 'compare', label: 'Correlation with residual', sublabel: 'c_j = x_jᵀr, every feature',
        column: 4,
        analogy: 'Think of it as asking, of the 35 indicators not yet in the model, which one still best explains what\'s left unexplained.',
      },
      { id: 'add_active', kind: 'gate', label: 'Add to active set', sublabel: 'feature with max |c_j| joins', column: 5 },
      {
        id: 'equiangular', kind: 'compare', label: 'Equiangular step', sublabel: 'move w in the direction equidistant to every active feature',
        column: 6,
      },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['output', 'correlate', 'context', 'residual r = y − ŷ'],
      ['correlate', 'add_active', 'context'],
      ['add_active', 'equiangular', 'context'],
      ['equiangular', 'linear', 'context', 'extends w along the path, repeat for the next feature'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-ordinal-regression': blueprint({
    title: 'Ordinal Regression',
    subtitle: 'cumulative logit model — one shared score, ordered thresholds',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Latent score', sublabel: 'z = w·x (no separate bias — thresholds carry it)',
        inShape: `B × ${F}`, outShape: `B × 1`, params: P.linear(F, 1, false), column: 2,
        analogy: 'Think of it as one dial producing a single "how bullish" score, which then gets read against fixed cut lines rather than being classified directly.',
      },
      {
        id: 'thresholds', kind: 'gate', label: 'Ordered thresholds', sublabel: `θ₁ < θ₂ — ${C - 1} learned cut lines for down|flat|up`,
        params: P.linear(0, C - 1), column: 2, lane: 1,
        detail: { formula: `P.linear(0 inputs, ${C - 1} outputs) = ${C - 1} learned offsets`, constraint: 'kept monotonically increasing by reparameterization' },
      },
      {
        id: 'cumulative', kind: 'activation', label: 'Cumulative sigmoid', sublabel: 'P(Y ≤ k | x) = σ(z + θ_k)',
        inShape: `B × 1`, outShape: `B × ${C - 1}`, column: 3,
        analogy: 'Think of it as sliding the score along a ruler with two marked lines and reading off which side of each line it lands on.',
      },
      { id: 'category_probs', kind: 'reshape', label: 'Per-class probability', sublabel: 'difference of adjacent cumulative probabilities', inShape: `B × ${C - 1}`, outShape: `B × ${C}`, column: 4 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5 },
      { id: 'loss', kind: 'compare', label: 'Negative log-likelihood', column: 6 },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'cumulative', 'category_probs', 'output'),
      ['thresholds', 'cumulative', 'context', 'the cut lines θ₁, θ₂'],
      ['output', 'loss', 'context'],
      ['loss', 'linear', 'context', 'gradient update'],
      ['loss', 'thresholds', 'context', 'gradient update, keeps θ ordered'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-probit-regression': blueprint({
    title: 'Probit Regression',
    subtitle: 'Gaussian latent-variable link, one-vs-rest for 3 classes',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Latent score', sublabel: 'z_k = w_k·x + b_k, one-vs-rest',
        inShape: `B × ${F}`, outShape: `B × ${C}`, params: C * P.linear(F, 1), column: 2,
      },
      {
        id: 'phi', kind: 'activation', label: 'Normal CDF Φ', sublabel: 'P(y=1|x) = Φ(z), not the logistic sigmoid',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 3,
        analogy: 'Think of it as Logistic Regression\'s cousin that assumes the noise around each score is bell-curved rather than logistic-shaped — the two curves look almost identical, but Probit\'s comes from a Gaussian error model.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
      { id: 'loss', kind: 'compare', label: 'Negative log-likelihood', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'phi', 'output'),
      ['output', 'loss', 'context'],
      ['loss', 'linear', 'context', 'gradient (Newton-Raphson or LBFGS)'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-quantile-regression': blueprint({
    title: 'Quantile Regression',
    subtitle: '3 independent quantile fits (10th / 50th / 90th), pinball loss',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Per-quantile weighted sum', sublabel: 'ŷ_τ = w_τ·x + b_τ, τ ∈ {0.1, 0.5, 0.9}',
        inShape: `B × ${F}`, outShape: `B × 3`, params: 3 * P.linear(F, 1), column: 2,
        analogy: 'Think of it as fitting three separate lines — a cautious low estimate, a typical estimate, and an optimistic high estimate — instead of one line through the average.',
      },
      { id: 'output', kind: 'output', label: '10th · 50th · 90th percentile', outShape: `B × 3`, column: 3 },
      {
        id: 'loss', kind: 'compare', label: 'Pinball loss', sublabel: 'ρ_τ(u) = u·(τ − 1{u<0}), asymmetric around 0',
        column: 4,
      },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['output', 'loss', 'context'],
      ['loss', 'linear', 'context', 'gradient update, per quantile'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-logistic-regression': blueprint({
    title: 'Logistic Regression',
    subtitle: 'multinomial softmax over 3 classes, L2-regularized',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'linear', kind: 'linear', label: 'Weighted sum', sublabel: 'z = Wx + b, one row of W per class',
        inShape: `B × ${F}`, outShape: `B × ${C}`, params: P.linear(F, C), column: 2,
        analogy: 'Think of it as 3 sets of 35 dials, one set per outcome, each producing a raw "how likely is this outcome" score.',
      },
      { id: 'softmax', kind: 'activation', label: 'Softmax', sublabel: `normalizes the ${C} scores into probabilities that sum to 1`, inShape: `B × ${C}`, outShape: `B × ${C}`, column: 3 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
      { id: 'loss', kind: 'compare', label: 'Cross-entropy', sublabel: '+ λ/2‖w‖₂² (or λ‖w‖₁)', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'softmax', 'output'),
      ['output', 'loss', 'context'],
      ['loss', 'linear', 'context', 'gradient (LBFGS / coordinate descent)'],
    ],
  }),

  'machine-learning-supervised-learning-linear-models-stochastic-gradient-descent-sgd': blueprint({
    title: 'Stochastic Gradient Descent (SGD)',
    subtitle: 'the same linear model, fit one shuffled mini-batch at a time',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'linear', kind: 'linear', label: 'Weighted sum', sublabel: 'z = Wx + b', inShape: `B × ${F}`, outShape: `B × ${C}`, params: P.linear(F, C), column: 2 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 3 },
      { id: 'loss', kind: 'compare', label: 'Log-loss or hinge', sublabel: '+ λ/2‖w‖₂² (or L1)', column: 4 },
      {
        id: 'shuffle', kind: 'stochastic', label: 'Shuffle + mini-batch draw', sublabel: 'a random slice of the dataset, every step',
        column: 5,
        analogy: 'Think of it as never re-grading the whole homework set at once — just one random handful of bars per correction, over and over.',
      },
    ],
    edges: [
      ...chain('input', 'standardize', 'linear', 'output'),
      ['output', 'loss', 'context'],
      ['loss', 'shuffle', 'context'],
      ['shuffle', 'linear', 'context', 'w ← w − η∇L, next mini-batch'],
    ],
  }),

  // ─── Margin-based methods ───────────────────────────────────────────────

  'machine-learning-supervised-learning-margin-based-methods-support-vector-machine-svm': blueprint({
    title: 'Support Vector Machine (SVM)',
    subtitle: 'RBF kernel · maximum margin · soft-margin slack',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'kernel', kind: 'compare', label: 'RBF kernel', sublabel: 'K(xᵢ,xⱼ) = exp(−γ‖xᵢ−xⱼ‖²)',
        inShape: `B × ${F}`, outShape: `B × N_support`, column: 2,
        analogy: 'Think of it as measuring how similar this bar is to every training bar that mattered, instead of drawing one straight dividing line.',
      },
      {
        id: 'decision', kind: 'head', label: 'Decision function', sublabel: 'f(x) = Σ_{i∈SV} αᵢyᵢK(xᵢ,x) + b',
        inShape: `B × N_support`, outShape: `B × ${C}`, column: 3,
        detail: { support_vectors: 'αᵢ nonzero only for support vectors — a sparse solution, count is data-dependent' },
      },
      { id: 'link', kind: 'activation', label: 'Sign / one-vs-rest', sublabel: `sign(f(x)) for binary, argmax for ${C} classes`, inShape: `B × ${C}`, outShape: `B × ${C}`, column: 4 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5 },
      { id: 'loss', kind: 'compare', label: 'Hinge loss', sublabel: 'max-margin QP objective, ½‖w‖² + C·Σξᵢ', column: 6 },
      { id: 'fit', kind: 'compare', label: 'SMO solver', sublabel: 'solves the dual for α, b', column: 7 },
    ],
    edges: [
      ...chain('input', 'standardize', 'kernel', 'decision', 'link', 'output'),
      ['output', 'loss', 'context'],
      ['loss', 'fit', 'context'],
      ['fit', 'decision', 'context', 'sets α, b'],
    ],
  }),
};
