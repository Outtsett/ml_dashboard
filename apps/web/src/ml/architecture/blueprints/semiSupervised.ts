/**
 * Blueprints — Machine Learning / Semi-Supervised Learning.
 *
 * Semi-supervised methods mix a small labeled set with a large unlabeled one.
 * Several of these are training SCHEMES (two branches, a comparison, and a
 * feedback edge that retrains one side from the other) rather than a single
 * forward layer stack — those draw both branches and label the loss/feedback
 * edges explicitly, per the authoring rule.
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const C = DIM.classes;
const E = 64; // shared backbone width — matches the hidden_dim used across this corpus's own reference code
const Z = 16; // latent width for the VAE/GAN-style entries in this group
const FP = 20; // price/candle-shape share of the 35 features, used by the two-view entries
const FV = F - FP; // volume/momentum share of the 35 features

const ENCODER_PARAMS = P.conv1d(F, E, 3) + P.conv1d(E, E, 3);
const HEAD_PARAMS = P.linear(E, C);
const CLASSIFIER_PARAMS = ENCODER_PARAMS + HEAD_PARAMS;

export const SEMI_SUPERVISED_BLUEPRINTS: Record<string, ArchGraph> = {
  // ── Clustering-Based Methods ────────────────────────────────────────────
  'machine-learning-semi-supervised-learning-clustering-based-methods-semi-supervised-clustering': blueprint({
    title: 'Semi-Supervised Clustering',
    subtitle: 'Seeded / constrained K-Means (COP-KMeans) · k = 3 regimes · must-link & cannot-link constraints',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar features', sublabel: `N bars × ${F} features`,
        outShape: `N × ${F}`, column: 0,
        analogy: 'Think of it as every bar written out as one row of 35 measurements, most of them with no label at all.',
      },
      {
        id: 'standardize', kind: 'norm', label: 'Standardize', sublabel: 'z-score each feature',
        inShape: `N × ${F}`, outShape: `N × ${F}`, column: 1,
      },
      {
        id: 'seeds', kind: 'memory', label: 'Seed centroids', sublabel: 'mean of the labeled bars, per regime',
        inShape: `N × ${F}`, outShape: `3 × ${F}`, column: 2, lane: 1,
        detail: {
          'seeded from': 'the handful of bars a trader has already tagged by regime',
          'k': 3,
          'measured in': 'the same standardized space the assignment step uses',
        },
        analogy: "Think of it as a trader hand-marking a few days as 'clearly trending' or 'clearly ranging' before letting the algorithm sort the rest by similarity.",
      },
      {
        id: 'assign', kind: 'cluster', label: 'Nearest-centroid assignment', sublabel: 'every bar → its closest regime',
        inShape: `N × ${F}`, outShape: 'N × 1', column: 3,
        analogy: "Think of it as sorting every bar into the regime bucket whose 'typical bar' it most resembles.",
      },
      {
        id: 'constraint', kind: 'compare', label: 'Constraint check', sublabel: 'must-link / cannot-link',
        inShape: 'N × 1', column: 4, lane: 1,
        detail: { rule: 'two bars a trader already knows are in different regimes may never share a cluster' },
        analogy: 'Think of it as a rule that forbids the algorithm from ever merging two bars the trader has already told it belong apart.',
      },
      {
        id: 'update', kind: 'cluster', label: 'Recompute centroids', sublabel: 'mean of each assigned group',
        inShape: 'N × 1', outShape: `3 × ${F}`, column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Regime assignment', sublabel: '3 clusters', outShape: 'N × 1', column: 5,
      },
    ],
    edges: [
      ['input', 'standardize'],
      ['standardize', 'seeds'],
      ['standardize', 'assign'],
      ['seeds', 'assign'],
      ['assign', 'constraint'],
      ['assign', 'update'],
      ['constraint', 'assign', 'context', 'reject a violating reassignment'],
      ['update', 'assign', 'context', 'reassign against the new centroids, iterate'],
      ['update', 'output'],
    ],
  }),

  // ── Consistency-Based Methods ───────────────────────────────────────────
  'machine-learning-semi-supervised-learning-consistency-based-methods-consistency-regularization-e-g-model-mean-teacher': blueprint({
    title: 'Consistency Regularization (Π-model / Mean Teacher)',
    subtitle: 'student + EMA teacher · consistency MSE · α = 0.99',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
        outShape: `B × ${T} × ${F}`, column: 0,
      },
      {
        id: 'augment', kind: 'stochastic', label: 'Stochastic augmentation', sublabel: 'noise / dropout — an independent draw per pass',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, column: 1,
        detail: { 'student sees': 'x + η', 'teacher sees': 'x + η′, a second independent draw' },
        analogy: 'Think of it as showing the same trader two slightly different renderings of the same chart and asking for the same verdict both times.',
      },
      {
        id: 'studEnc', kind: 'conv', label: 'Student encoder', sublabel: `TCN · ${E} filters`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
        detail: { formula: 'conv1d(F,E,3) + conv1d(E,E,3)' },
      },
      {
        id: 'teachEnc', kind: 'conv', label: 'Teacher encoder', sublabel: 'EMA copy of the student',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2, lane: 1,
        detail: { 'updated by': 'θ_t ← 0.99·θ_t + 0.01·θ_s, never by gradient' },
        analogy: "Think of it as a senior trader whose opinion only ever drifts slowly — 1% of the junior trader's latest view blended in each step — so it never overreacts to one noisy read.",
      },
      {
        id: 'studHead', kind: 'head', label: 'Student head', sublabel: `Linear ${E} → ${C}`,
        inShape: `B × ${E}`, outShape: `B × ${C}`, params: HEAD_PARAMS, column: 3,
      },
      {
        id: 'teachHead', kind: 'head', label: 'Teacher head', sublabel: 'EMA copy',
        inShape: `B × ${E}`, outShape: `B × ${C}`, params: HEAD_PARAMS, column: 3, lane: 1,
      },
      {
        id: 'compare', kind: 'compare', label: 'Consistency loss', sublabel: 'MSE(student, teacher) · stop-grad on teacher',
        column: 4, lane: 1,
        analogy: "Think of it as marking the junior trader down whenever their fast, noisy read disagrees with the senior trader's slow, stable one.",
      },
      {
        id: 'output', kind: 'output', label: 'Down · flat · up', sublabel: 'from the student', outShape: `B × ${C}`, column: 4,
      },
    ],
    edges: [
      ['input', 'augment'],
      ['augment', 'studEnc'],
      ['augment', 'teachEnc'],
      ['studEnc', 'studHead'],
      ['teachEnc', 'teachHead'],
      ['studHead', 'output'],
      ['studHead', 'compare'],
      ['teachHead', 'compare'],
      ['studEnc', 'teachEnc', 'context', 'EMA copy, α = 0.99'],
      ['studHead', 'teachHead', 'context', 'EMA copy, α = 0.99'],
    ],
  }),

  'machine-learning-semi-supervised-learning-consistency-based-methods-fixmatch': blueprint({
    title: 'FixMatch',
    subtitle: 'weak + strong augmentation · one network, shared weights · τ = 0.95',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'weakAug', kind: 'stochastic', label: 'Weak augmentation', sublabel: 'small noise / scaling',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, column: 1,
        analogy: "Think of it as barely touching the chart — a hair of noise — so the model's own read is still reliable enough to trust as a target.",
      },
      {
        id: 'strongAug', kind: 'stochastic', label: 'Strong augmentation', sublabel: 'time warp / frequency mask',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, column: 1, lane: 1,
        analogy: 'Think of it as smudging the chart hard and demanding the model still recognize the same setup.',
      },
      {
        id: 'clsWeak', kind: 'conv', label: 'Classifier f(θ)', sublabel: `TCN ${E} filters → global average pool → head`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${C}`, params: CLASSIFIER_PARAMS, column: 2,
        detail: { formula: 'conv1d(F,E,3) + conv1d(E,E,3) + linear(E,C)' },
      },
      {
        id: 'clsStrong', kind: 'conv', label: 'Classifier f(θ)', sublabel: 'same weights, strong-aug pass',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${C}`, column: 2, lane: 1,
        detail: { 'shared with': 'clsWeak' },
      },
      {
        id: 'pseudoGate', kind: 'compare', label: 'Confidence gate', sublabel: 'τ = 0.95 → hard argmax label, stop-grad',
        inShape: `B × ${C}`, outShape: `B × ${C}`, column: 3,
        detail: { 'kept when': 'max p ≥ 0.95', 'target form': 'one-hot argmax, detached — no gradient flows back down the weak branch' },
        analogy: "Think of it as only accepting the model's own guess as a training target when it is at least 95% sure of it.",
      },
      {
        id: 'lossCompare', kind: 'compare', label: 'Cross-entropy', sublabel: 'pseudo-label vs strong-aug prediction',
        inShape: `B × ${C}`, column: 4,
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4, lane: 1 },
    ],
    edges: [
      ['input', 'weakAug'],
      ['input', 'strongAug'],
      ['weakAug', 'clsWeak'],
      ['strongAug', 'clsStrong'],
      ['clsWeak', 'pseudoGate'],
      ['pseudoGate', 'lossCompare'],
      ['clsStrong', 'lossCompare'],
      ['clsWeak', 'output'],
      ['clsWeak', 'clsStrong', 'context', 'identical weights, two forward passes'],
    ],
  }),

  'machine-learning-semi-supervised-learning-consistency-based-methods-mixmatch': blueprint({
    title: 'MixMatch',
    subtitle: 'K=2 augmentations · sharpen T = 0.5 · MixUp α = 0.75',
    nodes: [
      { id: 'labeledInput', kind: 'input', label: 'Labeled bars', outShape: `B_l × ${T} × ${F}`, column: 0 },
      { id: 'unlabeledInput', kind: 'input', label: 'Unlabeled bars', outShape: `B_u × ${T} × ${F}`, column: 0, lane: 1 },
      {
        id: 'kAug', kind: 'stochastic', label: 'K augmentations', sublabel: 'K = 2 views per bar',
        inShape: `B_u × ${T} × ${F}`, outShape: `B_u × 2 × ${T} × ${F}`, column: 1, lane: 1,
      },
      {
        id: 'clsPseudo', kind: 'conv', label: 'Classifier f(θ)', sublabel: `TCN ${E} filters → global average pool → head`,
        inShape: `B_u × 2 × ${T} × ${F}`, outShape: `B_u × 2 × ${C}`, params: CLASSIFIER_PARAMS, column: 2, lane: 1,
      },
      {
        id: 'sharpen', kind: 'activation', label: 'Average K, then sharpen',
        sublabel: 'q̄ = (1/K)Σₖ pₖ, then q̄^(1/T) / Σ q̄^(1/T), T = 0.5',
        inShape: `B_u × 2 × ${C}`, outShape: `B_u × ${C}`, column: 3, lane: 1,
        detail: { 'why average first': 'averaging the K views is what makes the pseudo-label a consistency target instead of one noisy read' },
        analogy: 'Think of it as averaging two readings of the same chart, then turning that wishy-washy 60/40 result into something closer to a confident 90/10 call before trusting it as a label.',
      },
      {
        id: 'mixup', kind: 'fusion', label: 'MixUp', sublabel: 'λ ~ Beta(0.75, 0.75), on the inputs AND their targets',
        outShape: `B × ${T} × ${F}`, column: 4,
        analogy: 'Think of it as blending a labeled setup and a pseudo-labeled one part-way together, and training the model to predict that same blend of outcomes.',
      },
      {
        id: 'clsMixed', kind: 'conv', label: 'Classifier f(θ)', sublabel: 'same weights, on the mixed batch',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${C}`, column: 5,
        detail: { 'shared with': 'clsPseudo' },
      },
      { id: 'lossCompare', kind: 'compare', label: 'Supervised CE + consistency MSE', column: 6 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 6, lane: 1 },
    ],
    edges: [
      ['unlabeledInput', 'kAug'],
      ['kAug', 'clsPseudo'],
      ['clsPseudo', 'sharpen'],
      ['labeledInput', 'mixup'],
      ['sharpen', 'mixup'],
      ['mixup', 'clsMixed'],
      ['clsMixed', 'lossCompare'],
      ['clsMixed', 'output'],
      ['clsPseudo', 'clsMixed', 'context', 'identical weights, reused on the mixed batch'],
    ],
  }),

  'machine-learning-semi-supervised-learning-consistency-based-methods-virtual-adversarial-training-vat': blueprint({
    title: 'Virtual Adversarial Training (VAT)',
    subtitle: 'ℓ2-bounded adversarial perturbation · ε = 2.0 · KL consistency',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'classifier', kind: 'conv', label: 'Classifier f(θ)', sublabel: `TCN ${E} filters → global average pool → head`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${C}`, params: CLASSIFIER_PARAMS, column: 1,
      },
      {
        id: 'perturb', kind: 'stochastic', label: 'Adversarial perturbation', sublabel: 'power iteration · ‖r‖₂ ≤ 2.0',
        inShape: `B × ${C}`, outShape: `B × ${T} × ${F}`, column: 2,
        detail: { 'r comes from': 'one power iteration on the gradient of KL(f(x) ‖ f(x+r)) — no label is used anywhere' },
        analogy: 'Think of it as nudging the chart in the exact direction that would most confuse the model — without needing to know the right answer.',
      },
      {
        id: 'classifierPerturbed', kind: 'conv', label: 'Classifier f(θ)', sublabel: 'same weights, on x + r',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${C}`, column: 3,
        detail: { 'shared with': 'classifier' },
      },
      {
        id: 'klCompare', kind: 'compare', label: 'KL divergence', sublabel: 'f(x) ‖ f(x + r)', column: 4, lane: 1,
        analogy: 'Think of it as penalizing the model whenever a worst-case nudge to the chart flips its opinion.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'classifier'],
      ['classifier', 'perturb'],
      ['perturb', 'classifierPerturbed', 'flow', 'r'],
      ['input', 'classifierPerturbed', 'flow', 'x'],
      ['classifier', 'klCompare'],
      ['classifierPerturbed', 'klCompare'],
      ['classifier', 'output'],
      ['classifier', 'classifierPerturbed', 'context', 'identical weights, second forward pass'],
    ],
  }),

  // ── Generative & Hybrid Models ──────────────────────────────────────────
  'machine-learning-semi-supervised-learning-generative-hybrid-models-hybrid-generative-discriminative-ssl': blueprint({
    title: 'Hybrid Generative-Discriminative SSL (M1+M2 VAE)',
    subtitle: 'shared encoder · 16-d latent · classification + reconstruction',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'sharedEncoder', kind: 'conv', label: 'Shared encoder', sublabel: `TCN ${E} filters → global average pool`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 1,
      },
      {
        id: 'latent', kind: 'stochastic', label: 'Latent sample z', sublabel: `reparameterized, ${Z}-d`,
        outShape: `B × ${Z}`, params: 2 * P.linear(E, Z), column: 2,
        detail: { 'mean + log-variance heads': `2 × linear(${E},${Z})` },
        analogy: "Think of it as compressing the whole 64-bar chart down to 16 numbers that capture its shape, then adding a pinch of randomness.",
      },
      {
        id: 'klCompare', kind: 'compare', label: 'KL to prior', sublabel: 'regularize toward N(0, I)', column: 2, lane: 1,
      },
      {
        id: 'classifierHead', kind: 'head', label: 'Class head', sublabel: `Linear ${Z} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(Z, C), column: 3,
        analogy: 'Think of it as reading the regime label straight off that compressed shape.',
      },
      {
        id: 'decoder', kind: 'linear', label: 'Decoder', sublabel: `${Z} → ${E} → TCN → ${F}, across all ${T} bars`,
        inShape: `B × ${Z}`, outShape: `B × ${T} × ${F}`,
        params: P.linear(Z, E) + P.conv1d(E, E, 3) + P.conv1d(E, F, 3), column: 3, lane: 1,
        detail: { formula: `linear(${Z},${E}) + conv1d(${E},${E},3) + conv1d(${E},${F},3)` },
        analogy: 'Think of it as redrawing the whole 64-bar window from its compressed shape, so the shape can be checked against the real chart.',
      },
      {
        id: 'reconCompare', kind: 'compare', label: 'Reconstruction loss',
        sublabel: `MSE over the full B × ${T} × ${F} window`, inShape: `B × ${T} × ${F}`, column: 4, lane: 1,
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'sharedEncoder'],
      ['sharedEncoder', 'latent'],
      ['latent', 'klCompare', 'context', 'regularizer, not a feature path'],
      ['latent', 'classifierHead'],
      ['latent', 'decoder'],
      ['classifierHead', 'output'],
      ['decoder', 'reconCompare'],
      ['input', 'reconCompare', 'context', 'reconstruction target'],
    ],
  }),

  'machine-learning-semi-supervised-learning-generative-hybrid-models-ladder-network': blueprint({
    title: 'Ladder Network',
    subtitle: 'noisy + clean encoder · top-down decoder with lateral connections',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'noisyEnc', kind: 'linear', label: 'Noisy encoder', sublabel: `MLP, ${F} → ${E} → ${E}, + Gaussian noise`,
        outShape: `B × ${E}`, params: P.linear(F, E) + P.linear(E, E), column: 1,
        analogy: "Think of it as a trader reading a chart with some static on the line.",
      },
      {
        id: 'cleanEnc', kind: 'linear', label: 'Clean encoder', sublabel: 'same weights, no noise', outShape: `B × ${E}`,
        column: 1, lane: 1, detail: { 'shared with': 'noisyEnc' },
        analogy: 'Think of it as the same trader reading the exact same chart with the static removed — an answer key used only in training.',
      },
      {
        id: 'classHead', kind: 'head', label: 'Class head', sublabel: `Linear ${E} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(E, C), column: 2,
      },
      {
        id: 'decoder', kind: 'linear', label: 'Lateral decoder', sublabel: 'top-down estimate ⊕ noisy features, per layer',
        inShape: `B × ${E}`, outShape: `B × ${T} × ${F}`, params: P.linear(E, E) + P.linear(E, T * F), column: 2, lane: 1,
        analogy: 'Think of it as reconstructing the clean chart from the noisy read plus a top-down best guess, layer by layer.',
      },
      { id: 'denoiseCompare', kind: 'compare', label: 'Denoising cost', sublabel: 'per layer, decoded vs clean', column: 3, lane: 1 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 3 },
    ],
    edges: [
      ['input', 'noisyEnc'],
      ['input', 'cleanEnc'],
      ['noisyEnc', 'classHead'],
      ['noisyEnc', 'decoder'],
      ['classHead', 'output'],
      ['decoder', 'denoiseCompare'],
      ['cleanEnc', 'denoiseCompare', 'context', 'clean target'],
      ['noisyEnc', 'cleanEnc', 'context', 'shared weights, no noise'],
    ],
  }),

  'machine-learning-semi-supervised-learning-generative-hybrid-models-semi-supervised-gan-sgan': blueprint({
    title: 'Semi-Supervised GAN (SGAN)',
    subtitle: 'generator vs shared discriminator · real/fake head + K-class head',
    nodes: [
      {
        id: 'noise', kind: 'stochastic', label: 'Latent noise z', sublabel: `N(0, I), ${Z}-d`, outShape: `B × ${Z}`, column: 0, lane: 1,
      },
      {
        id: 'generator', kind: 'linear', label: 'Generator', sublabel: `${Z} → ${E} → ${E} → ${T}×${F}`,
        inShape: `B × ${Z}`, outShape: `B × ${T} × ${F}`,
        params: P.linear(Z, E) + P.linear(E, E) + P.linear(E, T * F), column: 1, lane: 1,
        detail: { 'final layer': `linear(${E}, ${T}×${F}), reshaped into a ${T}-bar window` },
        analogy: 'Think of it as a machine that dreams up a whole fake 64-bar window good enough to fool a trader.',
      },
      { id: 'realInput', kind: 'input', label: 'Real bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'sharedFeatures', kind: 'conv', label: 'Shared discriminator backbone', sublabel: `TCN ${E} filters → global average pool`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
        analogy: 'Think of it as one analyst who looks at both real and fake charts through the same lens.',
      },
      {
        id: 'realFakeHead', kind: 'head', label: 'Real / fake head', sublabel: `Linear ${E} → 1`,
        outShape: 'B × 1', params: P.linear(E, 1), column: 3, lane: 1,
      },
      {
        id: 'classHead', kind: 'head', label: 'Class head', sublabel: `Linear ${E} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(E, C), column: 3,
        detail: { 'trained on': 'the labeled REAL bars only, by cross-entropy — a fake bar only ever reaches the real/fake head' },
      },
      { id: 'advCompare', kind: 'compare', label: 'Adversarial loss', column: 4, lane: 1 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['noise', 'generator'],
      ['generator', 'sharedFeatures'],
      ['realInput', 'sharedFeatures'],
      ['sharedFeatures', 'realFakeHead'],
      ['sharedFeatures', 'classHead'],
      ['realFakeHead', 'advCompare'],
      ['advCompare', 'generator', 'context', 'adversarial gradient, maximize D error'],
      ['classHead', 'output'],
    ],
  }),

  // ── Graph-Based Methods ─────────────────────────────────────────────────
  'machine-learning-semi-supervised-learning-graph-based-methods-graph-based-semi-supervised-learning': blueprint({
    title: 'Graph-Based Semi-Supervised Learning (GCN)',
    subtitle: 'k-NN similarity graph · 2-layer graph convolution',
    nodes: [
      { id: 'nodeFeatures', kind: 'input', label: 'Bar features', outShape: `N × ${F}`, column: 0 },
      {
        id: 'adjacency', kind: 'memory', label: 'Similarity graph', sublabel: 'Gaussian-kernel edge weights',
        column: 0, lane: 1,
        detail: { 'w_ij': 'exp(−‖x_i − x_j‖² / 2σ²)' },
        analogy: 'Think of it as drawing a line between every pair of bars whose 35 features look alike, thicker for closer matches.',
      },
      {
        id: 'gcn1', kind: 'conv', label: 'Graph conv layer 1', sublabel: `${F} → ${E}, neighbor-averaged + ReLU`,
        inShape: `N × ${F}`, outShape: `N × ${E}`, params: P.linear(F, E), column: 1,
        detail: { 'one layer is': 'ÂXW — normalized neighbor average, then a shared linear map, then ReLU' },
      },
      {
        id: 'gcn2', kind: 'conv', label: 'Graph conv layer 2', sublabel: `${E} → ${E}`,
        outShape: `N × ${E}`, params: P.linear(E, E), column: 2,
        analogy: 'Think of it as each bar borrowing a bit of its neighbors’ features every layer, so label information seeps outward from the few labeled bars.',
      },
      {
        id: 'classHead', kind: 'head', label: 'Class head', sublabel: `Linear ${E} → ${C}`,
        outShape: `N × ${C}`, params: P.linear(E, C), column: 3,
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `N × ${C}`, column: 4 },
    ],
    edges: [
      ['nodeFeatures', 'gcn1'],
      ['adjacency', 'gcn1', 'context', 'neighbor aggregation'],
      ['gcn1', 'gcn2'],
      ['adjacency', 'gcn2', 'context', 'neighbor aggregation'],
      ['gcn2', 'classHead'],
      ['classHead', 'output'],
    ],
  }),

  'machine-learning-semi-supervised-learning-graph-based-methods-label-propagation': blueprint({
    title: 'Label Propagation',
    subtitle: 'row-normalized S = D⁻¹W · labeled rows clamped · α ≈ 0.8',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar features', outShape: `N × ${F}`, column: 0 },
      {
        id: 'graph', kind: 'memory', label: 'Similarity graph', sublabel: 'W, D, S = D⁻¹W',
        column: 1,
        analogy: 'Think of it as drawing a line between every pair of bars whose 35 features look alike.',
      },
      {
        id: 'labelInit', kind: 'memory', label: 'Label matrix Y', sublabel: 'labeled rows one-hot, rest zero',
        column: 1, lane: 1,
        analogy: "Think of it as painting the few labeled bars their true regime color and leaving every other bar blank.",
      },
      {
        id: 'propagate', kind: 'cluster', label: 'Iterative propagation',
        sublabel: 'F ← αSF + (1−α)Y, labeled rows clamped back to Y each round',
        outShape: `N × ${C}`, column: 2,
        detail: {
          'closed form': 'F = (1−α)(I − αS)⁻¹Y',
          'vs Label Spreading': 'row-normalized S = D⁻¹W and a HARD clamp here; Label Spreading uses the symmetric Laplacian and lets a labeled row move',
        },
        analogy: 'Think of it as color bleeding along every line in the graph until the blank bars settle on a color mix from their labeled neighbors.',
      },
      { id: 'argmax', kind: 'head', label: 'Argmax', sublabel: 'no learned weights', column: 3 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `N × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'graph'],
      ['input', 'labelInit'],
      ['graph', 'propagate'],
      ['labelInit', 'propagate'],
      ['propagate', 'argmax'],
      ['argmax', 'output'],
    ],
  }),

  'machine-learning-semi-supervised-learning-graph-based-methods-label-spreading': blueprint({
    title: 'Label Spreading',
    subtitle: 'normalized Laplacian · soft clamping, μ regularized',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar features', outShape: `N × ${F}`, column: 0 },
      {
        id: 'laplacian', kind: 'memory', label: 'Normalized Laplacian', sublabel: 'L̃ = I − D⁻¹ᐟ²WD⁻¹ᐟ²',
        column: 1,
        analogy: 'Think of it as the same similarity graph as Label Propagation, rescaled so no single busy bar dominates the spread.',
      },
      {
        id: 'labelInit', kind: 'memory', label: 'Label matrix Y', sublabel: 'labeled rows one-hot, rest zero',
        column: 1, lane: 1,
      },
      {
        id: 'spread', kind: 'cluster', label: 'Regularized spread', sublabel: 'min_F tr(FᵀL̃F) + μ‖F−Y‖²',
        outShape: `N × ${C}`, column: 2,
        detail: { 'soft clamp': 'μ trades staying near Y against agreeing with neighbors, so even an originally-labeled row can be overwritten' },
        analogy: 'Think of it as letting label color spread everywhere, softly overwriting even the originally-labeled bars if their neighborhood disagrees strongly.',
      },
      { id: 'argmax', kind: 'head', label: 'Argmax', sublabel: 'no learned weights', column: 3 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `N × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'laplacian'],
      ['input', 'labelInit'],
      ['laplacian', 'spread'],
      ['labelInit', 'spread'],
      ['spread', 'argmax'],
      ['argmax', 'output'],
    ],
  }),

  'machine-learning-semi-supervised-learning-graph-based-methods-manifold-regularization': blueprint({
    title: 'Manifold Regularization (LapSVM / LapRLS)',
    subtitle: 'kernel decision function + graph-Laplacian smoothness penalty',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar features', outShape: `N × ${F}`, column: 0 },
      {
        id: 'decisionFn', kind: 'linear', label: 'Decision function', sublabel: 'kernel machine — dual coefficients',
        outShape: 'N × 1', column: 1,
        detail: { 'parameter count': 'scales with the number of support vectors, not a fixed architecture width' },
      },
      {
        id: 'graph', kind: 'memory', label: 'Similarity graph', sublabel: 'Gaussian-kernel edge weights',
        column: 1, lane: 1,
      },
      {
        id: 'margin', kind: 'compare', label: 'Hinge margin', sublabel: 'labeled points only', column: 2,
        analogy: "Think of it as the usual SVM rule: push the boundary as far as possible from the few labeled examples on each side.",
      },
      {
        id: 'manifoldPenalty', kind: 'compare', label: 'Manifold penalty', sublabel: 'Σ w_ij (f(x_i)−f(x_j))²',
        column: 2, lane: 1,
        analogy: 'Think of it as fining the boundary whenever it treats two visually-similar bars very differently, labeled or not.',
      },
      {
        id: 'output', kind: 'output', label: 'Buy · sell', sublabel: 'sign of the decision function',
        outShape: 'N × 1', column: 3,
      },
    ],
    edges: [
      ['input', 'decisionFn'],
      ['input', 'graph'],
      ['decisionFn', 'margin'],
      ['decisionFn', 'manifoldPenalty'],
      ['graph', 'manifoldPenalty', 'context', 'neighbor pairs'],
      ['decisionFn', 'output'],
    ],
  }),

  // ── Multi-View & Co-Training ────────────────────────────────────────────
  'machine-learning-semi-supervised-learning-multi-view-co-training-co-training-dual-view': blueprint({
    title: 'Co-Training (Dual View)',
    subtitle: 'two views, two classifiers, cross pseudo-labeling',
    nodes: [
      { id: 'view1', kind: 'input', label: 'Price-shape view', outShape: `B × ${FP}`, column: 0 },
      { id: 'view2', kind: 'input', label: 'Volume/momentum view', outShape: `B × ${FV}`, column: 0, lane: 1 },
      {
        id: 'cls1', kind: 'linear', label: 'Classifier h₁', sublabel: `Linear ${FP} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(FP, C), column: 1,
      },
      {
        id: 'cls2', kind: 'linear', label: 'Classifier h₂', sublabel: `Linear ${FV} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(FV, C), column: 1, lane: 1,
      },
      { id: 'gate1', kind: 'compare', label: 'Confidence gate', sublabel: 'top-p / top-n from h₁', column: 2 },
      { id: 'gate2', kind: 'compare', label: 'Confidence gate', sublabel: 'top-p / top-n from h₂', column: 2, lane: 1 },
      {
        id: 'vote', kind: 'fusion', label: 'Combine', sublabel: 'average of the two class-probability vectors',
        outShape: `B × ${C}`, column: 3,
        detail: { 'why not a vote': 'two classifiers cannot out-vote each other — the views are combined by averaging their class probabilities' },
        analogy: 'Think of it as averaging how confident each desk is in each direction rather than asking two people to out-vote each other.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['view1', 'cls1'],
      ['view2', 'cls2'],
      ['cls1', 'gate1'],
      ['cls2', 'gate2'],
      ['gate1', 'cls2', 'context', 'pseudo-labels, view1 → view2'],
      ['gate2', 'cls1', 'context', 'pseudo-labels, view2 → view1'],
      ['cls1', 'vote'],
      ['cls2', 'vote'],
      ['vote', 'output'],
    ],
  }),

  'machine-learning-semi-supervised-learning-multi-view-co-training-multi-view-learning': blueprint({
    title: 'Multi-View Learning',
    subtitle: 'per-view encoders fused into one shared prediction',
    nodes: [
      { id: 'priceView', kind: 'input', label: 'Price-shape view', outShape: `B × ${T} × ${FP}`, column: 0 },
      { id: 'volView', kind: 'input', label: 'Volume/momentum view', outShape: `B × ${T} × ${FV}`, column: 0, lane: 1 },
      {
        id: 'priceEnc', kind: 'conv', label: 'Price encoder', sublabel: `TCN ${E} filters → global average pool`,
        outShape: `B × ${E}`, params: P.conv1d(FP, E, 3) + P.conv1d(E, E, 3), column: 1,
      },
      {
        id: 'volEnc', kind: 'conv', label: 'Volume encoder', sublabel: `TCN ${E} filters → global average pool`,
        outShape: `B × ${E}`, params: P.conv1d(FV, E, 3) + P.conv1d(E, E, 3), column: 1, lane: 1,
      },
      {
        id: 'fusion', kind: 'fusion', label: 'View fusion', sublabel: `concat + Linear ${2 * E} → ${E}`,
        outShape: `B × ${E}`, params: P.linear(2 * E, E), column: 2,
        analogy: 'Think of it as combining both views’ summaries into one verdict rather than trusting either view alone.',
      },
      {
        id: 'head', kind: 'head', label: 'Class head', sublabel: `Linear ${E} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(E, C), column: 3,
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['priceView', 'priceEnc'],
      ['volView', 'volEnc'],
      ['priceEnc', 'fusion'],
      ['volEnc', 'fusion'],
      ['fusion', 'head'],
      ['head', 'output'],
    ],
  }),

  // ── Regularization & Theoretical ────────────────────────────────────────
  'machine-learning-semi-supervised-learning-regularization-theoretical-entropy-minimization': blueprint({
    title: 'Entropy Minimization',
    subtitle: 'penalizes low-confidence predictions on unlabeled bars',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'classifier', kind: 'conv', label: 'Classifier f(θ)', sublabel: `TCN ${E} filters → global average pool → head`,
        outShape: `B × ${C}`, params: CLASSIFIER_PARAMS, column: 1,
      },
      { id: 'softmax', kind: 'activation', label: 'Softmax', column: 2 },
      { id: 'supCompare', kind: 'compare', label: 'Cross-entropy', sublabel: 'labeled bars', column: 3 },
      {
        id: 'entropy', kind: 'compare', label: 'Entropy penalty', sublabel: '−Σ p·log p, unlabeled bars',
        column: 3, lane: 1,
        analogy: "Think of it as rewarding a decisive guess — mostly buy, or mostly sell — and penalizing a wishy-washy split, on the assumption regime boundaries don't cut through dense clusters of similar bars.",
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'classifier'],
      ['classifier', 'softmax'],
      ['softmax', 'supCompare'],
      ['softmax', 'entropy'],
      ['softmax', 'output'],
    ],
  }),

  'machine-learning-semi-supervised-learning-regularization-theoretical-semi-supervised-svm-s3vm': blueprint({
    title: 'Semi-Supervised SVM (S3VM / TSVM)',
    subtitle: 'boundary pushed away from ALL points, labeled or not',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar features', outShape: `N × ${F}`, column: 0 },
      {
        id: 'decisionFn', kind: 'linear', label: 'Decision function', sublabel: 'kernel machine — dual coefficients',
        outShape: 'N × 1', column: 1,
        detail: { 'parameter count': 'scales with support vectors, not a fixed architecture width' },
        analogy: 'Think of it as one straight line splitting buy from sell, same as an ordinary SVM.',
      },
      { id: 'marginLabeled', kind: 'compare', label: 'Labeled hinge margin', sublabel: 'y_i(wᵀx_i+b) ≥ 1−ξ', column: 2 },
      {
        id: 'marginUnlabeled', kind: 'compare', label: 'Unlabeled margin', sublabel: '|wᵀx_j+b| ≥ 1−ξ',
        column: 2, lane: 1,
        analogy: "Think of it as also demanding the line stay clear of every UNLABELED bar too, wherever it falls — pushing the line into the emptiest gap between clusters instead of through a crowd.",
      },
      {
        id: 'pseudoAssign', kind: 'compare', label: 'Pseudo-label search', sublabel: 'y_j ∈ {−1,+1} jointly optimized',
        column: 3, lane: 1,
        analogy: 'Think of it as guessing which side each unlabeled bar sits on, refitting the line, then re-guessing — back and forth until it settles.',
      },
      { id: 'output', kind: 'output', label: 'Buy · sell', outShape: 'N × 1', column: 3 },
    ],
    edges: [
      ['input', 'decisionFn'],
      ['decisionFn', 'marginLabeled'],
      ['decisionFn', 'marginUnlabeled'],
      ['marginUnlabeled', 'pseudoAssign'],
      ['pseudoAssign', 'decisionFn', 'context', 'refit boundary against current pseudo-labels, iterate'],
      ['decisionFn', 'output'],
    ],
  }),

  // ── Self-Training & Bootstrapping ───────────────────────────────────────
  'machine-learning-semi-supervised-learning-self-training-bootstrapping-pseudo-labeling': blueprint({
    title: 'Pseudo-Labeling',
    subtitle: 'deep classifier · confident guesses become training targets, τ = 0.9',
    nodes: [
      { id: 'labeledInput', kind: 'input', label: 'Labeled bars', outShape: `B_l × ${T} × ${F}`, column: 0 },
      { id: 'unlabeledInput', kind: 'input', label: 'Unlabeled bars', outShape: `B_u × ${T} × ${F}`, column: 0, lane: 1 },
      {
        id: 'classifier', kind: 'conv', label: 'Classifier f(θ)', sublabel: `TCN ${E} filters → global average pool → head`,
        inShape: `(B_l + B_u) × ${T} × ${F}`, outShape: `(B_l + B_u) × ${C}`,
        params: CLASSIFIER_PARAMS, column: 1,
      },
      {
        id: 'confidence', kind: 'compare', label: 'Confidence gate', sublabel: 'τ = 0.9, on the unlabeled rows', column: 2,
        analogy: "Think of it as only trusting the model's own guess on an unlabeled bar when it's at least 90% sure.",
      },
      {
        id: 'growSet', kind: 'memory', label: 'Grow labeled set', sublabel: 'L ← L ∪ {confident pseudo-labels}',
        column: 3,
        analogy: 'Think of it as the labeled training set slowly growing every round, fed by the model’s own most-confident guesses.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `(B_l + B_u) × ${C}`, column: 4 },
    ],
    edges: [
      ['labeledInput', 'classifier'],
      ['unlabeledInput', 'classifier'],
      ['classifier', 'confidence'],
      ['confidence', 'growSet'],
      ['growSet', 'classifier', 'context', 'retrain on the larger L next round'],
      ['classifier', 'output'],
    ],
  }),

  'machine-learning-semi-supervised-learning-self-training-bootstrapping-self-training-classifier': blueprint({
    title: 'Self-Training Classifier',
    subtitle: 'any base learner · confident guesses promoted into L, τ = 0.9',
    nodes: [
      { id: 'labeledInput', kind: 'input', label: 'Labeled bars', outShape: `B_l × ${F}`, column: 0 },
      { id: 'unlabeledInput', kind: 'input', label: 'Unlabeled bars', outShape: `B_u × ${F}`, column: 0, lane: 1 },
      {
        id: 'classifier', kind: 'linear', label: 'Base classifier', sublabel: `Linear ${F} → ${C}, e.g. logistic regression`,
        inShape: `(B_l + B_u) × ${F}`, outShape: `(B_l + B_u) × ${C}`, params: P.linear(F, C), column: 1,
      },
      { id: 'confidence', kind: 'compare', label: 'Confidence gate', sublabel: 'τ = 0.9, on the unlabeled rows', column: 2 },
      {
        id: 'poolUpdate', kind: 'memory', label: 'Pool update', sublabel: 'promote confident bars: U → L',
        column: 3,
        analogy: 'Think of it as the unlabeled pool shrinking every round as confident guesses get promoted into the labeled set, then the model retraining on the bigger set.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `(B_l + B_u) × ${C}`, column: 4 },
    ],
    edges: [
      ['labeledInput', 'classifier'],
      ['unlabeledInput', 'classifier'],
      ['classifier', 'confidence'],
      ['confidence', 'poolUpdate'],
      ['poolUpdate', 'classifier', 'context', 'retrain on the updated L, U next round'],
      ['classifier', 'output'],
    ],
  }),

  'machine-learning-semi-supervised-learning-self-training-bootstrapping-tri-training': blueprint({
    title: 'Tri-Training',
    subtitle: '3 bootstrapped classifiers · pseudo-label when the other two agree',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Labeled set L + unlabeled pool U',
        outShape: `(B_l + B_u) × ${F}`, column: 0,
      },
      {
        id: 'boot1', kind: 'stochastic', label: 'Bootstrap sample 1', sublabel: 'drawn from L, with replacement',
        inShape: `B_l × ${F}`, outShape: `B_l × ${F}`, column: 1,
        detail: { 'why bootstrap': 'resampling L is the only thing making the three classifiers disagree — they are otherwise the same learner' },
      },
      {
        id: 'boot2', kind: 'stochastic', label: 'Bootstrap sample 2', sublabel: 'drawn from L, with replacement',
        inShape: `B_l × ${F}`, outShape: `B_l × ${F}`, column: 1, lane: 1,
      },
      {
        id: 'boot3', kind: 'stochastic', label: 'Bootstrap sample 3', sublabel: 'drawn from L, with replacement',
        inShape: `B_l × ${F}`, outShape: `B_l × ${F}`, column: 1, lane: 2,
      },
      {
        id: 'cls1', kind: 'linear', label: 'Classifier h₁', sublabel: `Linear ${F} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(F, C), column: 2,
      },
      {
        id: 'cls2', kind: 'linear', label: 'Classifier h₂', sublabel: `Linear ${F} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(F, C), column: 2, lane: 1,
      },
      {
        id: 'cls3', kind: 'linear', label: 'Classifier h₃', sublabel: `Linear ${F} → ${C}`,
        outShape: `B × ${C}`, params: P.linear(F, C), column: 2, lane: 2,
      },
      {
        id: 'agreement', kind: 'compare', label: 'Pairwise agreement', sublabel: 'h_i(x) = h_j(x) → pseudo-label for h_k',
        column: 3,
        analogy: "Think of it as only trusting an unlabeled bar's guessed label when two of the three traders already agree on it — then teaching that lesson to the third.",
      },
      {
        id: 'vote', kind: 'fusion', label: 'Majority vote', sublabel: 'mode(h₁, h₂, h₃)', outShape: `B × ${C}`, column: 4,
        analogy: 'Think of it as the final call going to whichever regime at least two of the three traders agree on.',
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5 },
    ],
    edges: [
      ['input', 'boot1'],
      ['input', 'boot2'],
      ['input', 'boot3'],
      ['boot1', 'cls1'],
      ['boot2', 'cls2'],
      ['boot3', 'cls3'],
      ['cls1', 'agreement'],
      ['cls2', 'agreement'],
      ['cls3', 'agreement'],
      ['agreement', 'cls1', 'context', 'pseudo-label from h₂, h₃ agreement, retrain'],
      ['agreement', 'cls2', 'context', 'pseudo-label from h₁, h₃ agreement, retrain'],
      ['agreement', 'cls3', 'context', 'pseudo-label from h₁, h₂ agreement, retrain'],
      ['cls1', 'vote'],
      ['cls2', 'vote'],
      ['cls3', 'vote'],
      ['vote', 'output'],
    ],
  }),
};
