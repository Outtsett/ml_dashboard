/**
 * Blueprints — Machine Learning / Self-Supervised Learning.
 *
 * No labels anywhere in this group: every method invents its own training
 * signal from the unlabeled bars themselves (a reconstruction, a comparison
 * between two augmented views, or a masked-and-predicted piece of the
 * input). Several entries are near-siblings by design — BYOL, SimSiam,
 * Barlow Twins and SPR all descend from the same online/target idea — so
 * each diagram calls out the ONE mechanism that makes it different from
 * its neighbors rather than re-explaining the shared scaffold.
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const E = 64; // shared backbone width, matching the hidden_dim used across this corpus's own reference code
const PROJ = 128; // projection-head width used by the contrastive/self-distillation family
const INNER = 4 * E; // 256 — standard transformer feed-forward expansion ratio
const Z = 16; // GAN latent width
const FP = 20; // price/candle-shape share of the 35 features, used by the cross-view entry
const FV = F - FP; // volume/momentum share

const ENCODER_PARAMS = P.conv1d(F, E, 3) + P.conv1d(E, E, 3);
const TRANSFORMER_PARAMS = 2 * P.encoderLayer(E, INNER); // small 2-layer backbone for the ViT-style entries
const PATCH_BARS = 8; // bars per patch when a method tokenizes the window (8 patches of 8 bars)

export const SELF_SUPERVISED_BLUEPRINTS: Record<string, ArchGraph> = {
  // ── Augmentation-Based Methods ──────────────────────────────────────────
  'machine-learning-self-supervised-learning-augmentation-based-methods-denoising-autoencoder': blueprint({
    title: 'Denoising Autoencoder',
    subtitle: 'corrupt → compress to 32 → reconstruct the clean window',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'corrupt', kind: 'stochastic', label: 'Corrupt', sublabel: 'Gaussian σ=0.1 or masking p=0.2',
        column: 1,
        analogy: 'Think of it as smudging noise onto the chart before showing it to the model.',
      },
      {
        id: 'encoder', kind: 'conv', label: 'Encoder', sublabel: `TCN, ${F} → ${E} → 32`,
        outShape: 'B × 32', params: P.conv1d(F, E, 3) + P.conv1d(E, 32, 3), column: 2,
        analogy: 'Think of it as squeezing the 64-bar window down to a 32-number summary that must still contain enough to rebuild the clean chart.',
      },
      {
        id: 'decoder', kind: 'linear', label: 'Decoder', sublabel: `32 → ${E} → ${T}×${F}`,
        inShape: 'B × 32', outShape: `B × ${T} × ${F}`, params: P.linear(32, E) + P.linear(E, T * F), column: 3,
        detail: { 'rebuilds': `the whole ${T}-bar window, which is what the loss is measured against` },
      },
      { id: 'output', kind: 'output', label: 'Reconstructed window', outShape: `B × ${T} × ${F}`, column: 4 },
      {
        id: 'reconCompare', kind: 'compare', label: 'Reconstruction loss', sublabel: 'MSE vs the clean bar', column: 4, lane: 1,
        analogy: 'Think of it as grading the rebuilt chart against the original, undamaged one.',
      },
    ],
    edges: [
      ...chain('input', 'corrupt', 'encoder', 'decoder', 'output'),
      ['decoder', 'reconCompare'],
      ['input', 'reconCompare', 'context', 'reconstruction target'],
    ],
  }),

  'machine-learning-self-supervised-learning-augmentation-based-methods-self-distillation-without-labels': blueprint({
    title: 'Self-Distillation Without Labels',
    subtitle: 'EMA teacher, no negatives — student matches teacher on a different view',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (view 1)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (view 2)', column: 1, lane: 1 },
      {
        id: 'studBackbone', kind: 'conv', label: 'Student backbone', sublabel: `TCN, ${E} filters`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
      },
      {
        id: 'teachBackbone', kind: 'conv', label: 'Teacher backbone', sublabel: 'EMA copy',
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2, lane: 1,
      },
      {
        id: 'studProj', kind: 'linear', label: 'Student projector', sublabel: `Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3,
        analogy: "Think of it as re-describing the backbone's 64 features as a 128-number fingerprint, in the separate space where the two networks are compared — the fingerprint is thrown away after pretraining, the backbone is what is kept.",
      },
      {
        id: 'teachProj', kind: 'linear', label: 'Teacher projector', sublabel: 'EMA copy',
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3, lane: 1,
      },
      {
        id: 'compare', kind: 'compare', label: 'Distillation loss', sublabel: 'D(z_student, z_teacher), stop-grad on teacher',
        column: 4, lane: 1,
        analogy: "Think of it as training the fast student's fingerprint of one view to match the slow teacher's fingerprint of the other view — no labels anywhere in this loss.",
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${PROJ}`, column: 4 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'studBackbone'],
      ['aug2', 'teachBackbone'],
      ['studBackbone', 'studProj'],
      ['teachBackbone', 'teachProj'],
      ['studProj', 'output'],
      ['studProj', 'compare'],
      ['teachProj', 'compare'],
      ['studBackbone', 'teachBackbone', 'context', 'EMA copy'],
      ['studProj', 'teachProj', 'context', 'EMA copy'],
    ],
  }),

  // ── Contrastive Learning ────────────────────────────────────────────────
  'machine-learning-self-supervised-learning-contrastive-learning-barlow-twins': blueprint({
    title: 'Barlow Twins',
    subtitle: 'shared twin encoder · cross-correlation redundancy reduction, λ = 0.005',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (view 1)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (view 2)', column: 1, lane: 1 },
      {
        id: 'backboneA', kind: 'conv', label: 'Encoder + projector', sublabel: `TCN → Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: ENCODER_PARAMS + P.linear(E, PROJ), column: 2,
      },
      {
        id: 'backboneB', kind: 'conv', label: 'Encoder + projector', sublabel: 'identical weights',
        outShape: `B × ${PROJ}`, column: 2, lane: 1, detail: { 'shared with': 'backboneA' },
      },
      {
        id: 'crossCorr', kind: 'compare', label: 'Cross-correlation loss', sublabel: 'batch-normalized Cᵢⱼ = z1ᵀz2 / B',
        column: 3, lane: 1,
        analogy: 'Think of it as demanding each of the 128 fingerprint numbers agree with itself across both views while staying uncorrelated with every OTHER number — squeezing out redundancy instead of comparing to negative examples.',
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${PROJ}`, column: 3 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'backboneA'],
      ['aug2', 'backboneB'],
      ['backboneA', 'crossCorr'],
      ['backboneB', 'crossCorr'],
      ['backboneA', 'output'],
      ['backboneA', 'backboneB', 'context', 'identical weights, two forward passes'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-byol-bootstrap-your-own-latent': blueprint({
    title: 'BYOL (Bootstrap Your Own Latent)',
    subtitle: 'EMA teacher + student predictor, no negatives · τ = 0.99',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (view 1)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (view 2)', column: 1, lane: 1 },
      {
        id: 'studBackbone', kind: 'conv', label: 'Student backbone', sublabel: `TCN, ${E} filters`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
      },
      {
        id: 'teachBackbone', kind: 'conv', label: 'Teacher backbone', sublabel: 'EMA copy',
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2, lane: 1,
      },
      {
        id: 'studProj', kind: 'linear', label: 'Student projector', sublabel: `Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3,
      },
      {
        id: 'teachProj', kind: 'linear', label: 'Teacher projector', sublabel: 'EMA copy',
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3, lane: 1,
      },
      {
        id: 'studPred', kind: 'linear', label: 'Student predictor', sublabel: `Linear ${PROJ} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: P.linear(PROJ, PROJ), column: 4,
        analogy: "Think of it as the student adding one more guess — 'here's what I think the teacher's fingerprint of the OTHER view looks like' — the one asymmetry that keeps this from collapsing to a constant without needing negative examples.",
      },
      {
        id: 'compare', kind: 'compare', label: 'Cosine loss',
        sublabel: '2 − 2·cos(pred, teacher), symmetrized · stop-grad on the teacher',
        inShape: `B × ${PROJ}`, column: 5, lane: 1,
        detail: { 'stop-gradient': 'the teacher branch is detached — without it, and without the predictor, both networks collapse to a constant' },
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 5 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'studBackbone'],
      ['aug2', 'teachBackbone'],
      ['studBackbone', 'studProj'],
      ['teachBackbone', 'teachProj'],
      ['studProj', 'studPred'],
      ['studPred', 'compare'],
      ['teachProj', 'compare'],
      ['studBackbone', 'output'],
      ['studBackbone', 'teachBackbone', 'context', 'EMA copy, τ = 0.99'],
      ['studProj', 'teachProj', 'context', 'EMA copy, τ = 0.99'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-contrastive-learning-simclr-moco': blueprint({
    title: 'Contrastive Learning (SimCLR)',
    subtitle: 'shared encoder · in-batch negatives · InfoNCE, τ = 0.1',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (view 1)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (view 2)', column: 1, lane: 1 },
      {
        id: 'backboneA', kind: 'conv', label: 'Encoder + projector', sublabel: `TCN → Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: ENCODER_PARAMS + P.linear(E, PROJ), column: 2,
      },
      {
        id: 'backboneB', kind: 'conv', label: 'Encoder + projector', sublabel: 'identical weights',
        outShape: `B × ${PROJ}`, column: 2, lane: 1, detail: { 'shared with': 'backboneA' },
      },
      {
        id: 'infoNCE', kind: 'compare', label: 'InfoNCE', sublabel: 'batch supplies the negatives',
        column: 3, lane: 1,
        detail: { 'MoCo variant': 'swaps in-batch negatives for a momentum-encoder queue — see Momentum Contrast (MoCo-v3)' },
        analogy: "Think of it as pulling the two views of the SAME bar's fingerprint close together while pushing every OTHER bar in the batch's fingerprint apart.",
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${PROJ}`, column: 3 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'backboneA'],
      ['aug2', 'backboneB'],
      ['backboneA', 'infoNCE'],
      ['backboneB', 'infoNCE'],
      ['backboneA', 'output'],
      ['backboneA', 'backboneB', 'context', 'identical weights, two forward passes'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-cross-view-prediction': blueprint({
    title: 'Cross-View Prediction',
    subtitle: 'predict one view’s embedding from another’s, no shared weights',
    nodes: [
      { id: 'view1', kind: 'input', label: 'Price-shape view', outShape: `B × ${T} × ${FP}`, column: 0 },
      { id: 'view2', kind: 'input', label: 'Volume/momentum view', outShape: `B × ${T} × ${FV}`, column: 0, lane: 1 },
      {
        id: 'backbone1', kind: 'conv', label: 'View-1 encoder', sublabel: `TCN, ${E} filters`,
        outShape: `B × ${E}`, params: P.conv1d(FP, E, 3) + P.conv1d(E, E, 3), column: 1,
      },
      {
        id: 'backbone2', kind: 'conv', label: 'View-2 encoder', sublabel: `TCN, ${E} filters, separate weights`,
        outShape: `B × ${E}`, params: P.conv1d(FV, E, 3) + P.conv1d(E, E, 3), column: 1, lane: 1,
      },
      {
        id: 'predictor', kind: 'linear', label: 'Cross-view predictor', sublabel: `Linear ${E} → ${E}`,
        outShape: `B × ${E}`, params: P.linear(E, E), column: 2,
        analogy: "Think of it as reading the price-view fingerprint and trying to guess what the volume-view fingerprint of the SAME 64 bars looks like, without ever seeing it.",
      },
      {
        id: 'predCompare', kind: 'compare', label: 'Prediction loss', sublabel: 'MSE vs the real view-2 embedding', column: 3,
        analogy: 'Think of it as grading that guess against the real volume-view fingerprint.',
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 2, lane: 1 },
    ],
    edges: [
      ['view1', 'backbone1'],
      ['view2', 'backbone2'],
      ['backbone1', 'predictor'],
      ['predictor', 'predCompare'],
      ['backbone2', 'predCompare', 'context', 'prediction target'],
      ['backbone1', 'output'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-momentum-contrast-moco-v3': blueprint({
    title: 'Momentum Contrast (MoCo-v3)',
    subtitle: 'momentum encoder + 65,536-entry queue · InfoNCE',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (query)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (key)', column: 1, lane: 1 },
      {
        id: 'onlineEnc', kind: 'conv', label: 'Online encoder', sublabel: `TCN, ${E} filters`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
      },
      {
        id: 'momentumEnc', kind: 'conv', label: 'Momentum encoder', sublabel: 'EMA, m = 0.999',
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2, lane: 1,
        analogy: 'Think of it as a slow-moving twin of the online encoder, nudged only 0.1% toward it each step, that supplies stable fingerprints for the memory bank.',
      },
      {
        id: 'onlineProj', kind: 'linear', label: 'Online projector', sublabel: `Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3,
      },
      {
        id: 'momentumProj', kind: 'linear', label: 'Momentum projector', sublabel: 'EMA copy',
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3, lane: 1,
      },
      {
        id: 'queue', kind: 'memory', label: 'Key queue', sublabel: '65,536 past keys', column: 4, lane: 1,
        detail: {
          'drawn from': 'the spec, which describes the MoCo v1/v2 queue',
          'the published v3': 'drops the queue for large-batch in-batch negatives and adds a prediction head on the query branch',
        },
        analogy: "Think of it as a running memory bank of thousands of past bars' fingerprints kept around purely to serve as negative examples.",
      },
      {
        id: 'infoNCE', kind: 'compare', label: 'InfoNCE', sublabel: 'query vs queue, temperature τ = 0.2',
        inShape: `B × ${PROJ}`, column: 5, lane: 1,
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${PROJ}`, column: 5 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'onlineEnc'],
      ['aug2', 'momentumEnc'],
      ['onlineEnc', 'onlineProj'],
      ['momentumEnc', 'momentumProj'],
      ['momentumProj', 'queue'],
      ['onlineProj', 'infoNCE'],
      ['queue', 'infoNCE'],
      ['onlineProj', 'output'],
      ['onlineEnc', 'momentumEnc', 'context', 'EMA copy, m = 0.999'],
      ['onlineProj', 'momentumProj', 'context', 'EMA copy, m = 0.999'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-patch-level-contrastive-learning-e-g-dino': blueprint({
    title: 'Patch-Level Contrastive Learning (DINO)',
    subtitle: '8 temporal patches · EMA teacher + centering, no negatives',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'patchify', kind: 'embedding', label: 'Patch embedding', sublabel: `8 patches × 8 bars, flattened → ${E}`,
        outShape: `B × 8 × ${E}`, params: P.linear(PATCH_BARS * F, E), column: 1,
        analogy: 'Think of it as chopping the 64-bar window into 8 chunks of 8 bars each, the way a Vision Transformer chops an image into patches.',
      },
      {
        id: 'studTransformer', kind: 'attention', label: 'Student transformer', sublabel: '2 layers, local + global crops',
        inShape: `B × 8 × ${E}`, outShape: `B × ${E}`, params: TRANSFORMER_PARAMS, column: 2,
        detail: { 'output taken from': 'the [CLS] token, so 8 patch tokens in becomes one vector out' },
      },
      {
        id: 'teachTransformer', kind: 'attention', label: 'Teacher transformer', sublabel: 'EMA copy, global crops only',
        outShape: `B × ${E}`, params: TRANSFORMER_PARAMS, column: 2, lane: 1,
      },
      {
        id: 'studProj', kind: 'linear', label: 'Student head', sublabel: `Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3,
      },
      {
        id: 'teachProj', kind: 'linear', label: 'Teacher head + centering',
        sublabel: 'EMA copy · centered on a running mean, then sharpened (τ_t = 0.04)',
        outShape: `B × ${PROJ}`, params: P.linear(E, PROJ), column: 3, lane: 1,
        detail: { 'centering and sharpening': 'pull against each other — centering alone collapses to a uniform output, sharpening alone to one constant class' },
        analogy: "Think of it as the slow teacher's fingerprint also getting re-centered around its own recent average, which is what stops both networks collapsing to the same constant answer without a single negative example.",
      },
      {
        id: 'compare', kind: 'compare', label: 'Cross-entropy',
        sublabel: 'student softmax vs teacher softmax · stop-grad on the teacher',
        inShape: `B × ${PROJ}`, column: 4, lane: 1,
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 4 },
    ],
    edges: [
      ['input', 'patchify'],
      ['patchify', 'studTransformer'],
      ['patchify', 'teachTransformer'],
      ['studTransformer', 'studProj'],
      ['teachTransformer', 'teachProj'],
      ['studProj', 'output'],
      ['studProj', 'compare'],
      ['teachProj', 'compare'],
      ['studTransformer', 'teachTransformer', 'context', 'EMA copy'],
      ['studProj', 'teachProj', 'context', 'EMA copy'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-self-augmented-contrastive-encoder': blueprint({
    title: 'Self-Augmented Contrastive Encoder',
    subtitle: 'a LEARNED augmentation network, not a fixed noise recipe',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'augNet1', kind: 'stochastic', label: 'Learned augmentation',
        sublabel: `Linear ${F} → ${F} per bar, sampled per view · view 1`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, params: P.linear(F, F), column: 1,
        detail: { 'trained, not fixed': 'its weights are updated from the contrastive loss, which is the whole difference from a hand-picked noise recipe' },
        analogy: 'Think of it as a small network that LEARNS which distortions of the chart are hardest-but-fair, instead of using a fixed hand-picked noise recipe.',
      },
      {
        id: 'augNet2', kind: 'stochastic', label: 'Learned augmentation', sublabel: 'shared weights, view 2',
        outShape: `B × ${T} × ${F}`, column: 1, lane: 1, detail: { 'shared with': 'augNet1' },
      },
      {
        id: 'encA', kind: 'conv', label: 'Encoder', sublabel: `TCN, ${E} filters`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
      },
      {
        id: 'encB', kind: 'conv', label: 'Encoder', sublabel: 'shared weights',
        outShape: `B × ${E}`, column: 2, lane: 1, detail: { 'shared with': 'encA' },
      },
      { id: 'infoNCE', kind: 'compare', label: 'InfoNCE', sublabel: 'in-batch negatives', column: 3, lane: 1 },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 3 },
    ],
    edges: [
      ['input', 'augNet1'],
      ['input', 'augNet2'],
      ['augNet1', 'encA'],
      ['augNet2', 'encB'],
      ['encA', 'infoNCE'],
      ['encB', 'infoNCE'],
      ['encA', 'output'],
      ['augNet1', 'augNet2', 'context', 'shared weights'],
      ['encA', 'encB', 'context', 'shared weights'],
      ['infoNCE', 'augNet1', 'context', 'the augmentation network learns from this loss too'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-simsiam': blueprint({
    title: 'SimSiam',
    subtitle: 'identical weights, no EMA — stop-gradient is the only anti-collapse trick',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (view 1)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (view 2)', column: 1, lane: 1 },
      {
        id: 'backbone', kind: 'conv', label: 'Encoder + projector', sublabel: `TCN → Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: ENCODER_PARAMS + P.linear(E, PROJ), column: 2,
      },
      {
        id: 'backboneStop', kind: 'conv', label: 'Encoder + projector', sublabel: 'same weights, gradients stopped',
        outShape: `B × ${PROJ}`, column: 2, lane: 1,
        detail: { 'shared with': 'backbone', gradient: 'detached — this branch never updates from the loss' },
        analogy: 'Think of it as literally the same network as the other branch, not a slow EMA copy, but with its gradients switched off so this branch can never react to the loss.',
      },
      {
        id: 'predictor', kind: 'linear', label: 'Predictor', sublabel: `Linear ${PROJ} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: P.linear(PROJ, PROJ), column: 3,
        analogy: 'Think of it as the one asymmetry: only this branch gets an extra head trying to guess the stopped branch’s answer, and that alone is enough to prevent collapse.',
      },
      { id: 'compare', kind: 'compare', label: 'Negative cosine sim', sublabel: 'symmetrized', column: 4, lane: 1 },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${PROJ}`, column: 4 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'backbone'],
      ['aug2', 'backboneStop'],
      ['backbone', 'predictor'],
      ['predictor', 'compare'],
      ['backboneStop', 'compare'],
      ['predictor', 'output'],
      ['backbone', 'backboneStop', 'context', 'same weights, stop-gradient'],
    ],
  }),

  'machine-learning-self-supervised-learning-contrastive-learning-swav-swapped-assignments': blueprint({
    title: 'SwAV (Swapped Assignments)',
    subtitle: '8 learned prototypes · Sinkhorn-Knopp balancing · swapped prediction',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (view 1)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (view 2)', column: 1, lane: 1 },
      {
        id: 'encA', kind: 'conv', label: 'Encoder + projector', sublabel: `TCN → Linear ${E} → ${PROJ}`,
        outShape: `B × ${PROJ}`, params: ENCODER_PARAMS + P.linear(E, PROJ), column: 2,
      },
      {
        id: 'encB', kind: 'conv', label: 'Encoder + projector', sublabel: 'shared weights',
        outShape: `B × ${PROJ}`, column: 2, lane: 1, detail: { 'shared with': 'encA' },
      },
      {
        id: 'prototypes', kind: 'cluster', label: 'Prototype scores', sublabel: `${PROJ} × 8 prototype matrix C, no bias`,
        outShape: 'B × 8', params: P.linear(PROJ, 8, false), column: 3,
        detail: { 'why no bias': 'C is 8 prototype VECTORS the embedding is dotted against, not an affine layer' },
        analogy: "Think of it as K = 8 learned 'typical chart shapes' that every bar's fingerprint gets scored against.",
      },
      {
        id: 'sinkhorn', kind: 'cluster', label: 'Sinkhorn-Knopp', sublabel: 'balances prototype usage across the batch',
        column: 4,
        analogy: 'Think of it as making sure the 8 typical shapes get used roughly equally often, so the model can’t cheat by mapping every bar to the same one shape.',
      },
      {
        id: 'swapCompare', kind: 'compare', label: 'Swapped cross-entropy', sublabel: 'predict code of view 2 from scores of view 1, and vice versa',
        column: 5,
        analogy: 'Think of it as predicting view 2’s typical-shape code from view 1’s raw scores, and view 1’s code from view 2’s — swapped, so each view has to be informative about the other.',
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${PROJ}`, column: 5, lane: 1 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'encA'],
      ['aug2', 'encB'],
      ['encA', 'prototypes'],
      ['encB', 'prototypes'],
      ['prototypes', 'sinkhorn'],
      ['sinkhorn', 'swapCompare', 'flow', 'codes q'],
      ['prototypes', 'swapCompare', 'flow', 'scores p'],
      ['encA', 'output'],
      ['encA', 'encB', 'context', 'shared weights'],
    ],
  }),

  // ── Latent & Generative ─────────────────────────────────────────────────
  'machine-learning-self-supervised-learning-latent-generative-self-supervised-gans': blueprint({
    title: 'Self-Supervised GANs',
    subtitle: 'shared discriminator backbone · real/fake head + transform-prediction head',
    nodes: [
      { id: 'noise', kind: 'stochastic', label: 'Latent noise z', sublabel: `N(0, I), ${Z}-d`, outShape: `B × ${Z}`, column: 0, lane: 1 },
      {
        id: 'generator', kind: 'linear', label: 'Generator', sublabel: `${Z} → ${E} → ${E} → ${T}×${F}`,
        inShape: `B × ${Z}`, outShape: `B × ${T} × ${F}`,
        params: P.linear(Z, E) + P.linear(E, E) + P.linear(E, T * F), column: 1, lane: 1,
        analogy: 'Think of it as a machine that dreams up a whole fake 64-bar window good enough to fool a trader.',
      },
      { id: 'realInput', kind: 'input', label: 'Real bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'transform', kind: 'stochastic', label: 'Apply a known transform',
        sublabel: 'one of 4: identity · reverse · sign-flip · shuffle',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, column: 1,
        detail: { 'transform id t': 'is kept as the free label the auxiliary head is scored against' },
        analogy: 'Think of it as quietly distorting the real chart one of four known ways before handing it to the analyst, and remembering which way.',
      },
      {
        id: 'sharedEncoder', kind: 'conv', label: 'Shared encoder', sublabel: `TCN, ${E} filters`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
      },
      {
        id: 'auxHead', kind: 'head', label: 'Transform-prediction head', sublabel: `Linear ${E} → 4`,
        inShape: `B × ${E}`, outShape: 'B × 4', params: P.linear(E, 4), column: 3,
        analogy: 'Think of it as the discriminator ALSO having to guess which distortion was applied to the chart — a free self-supervised task that sharpens its features before any label exists.',
      },
      {
        id: 'realFakeHead', kind: 'head', label: 'Real / fake head', sublabel: `Linear ${E} → 1`,
        inShape: `B × ${E}`, outShape: 'B × 1', params: P.linear(E, 1), column: 3, lane: 1,
      },
      {
        id: 'auxCompare', kind: 'compare', label: 'Transform cross-entropy',
        sublabel: 'guessed transform vs the one actually applied', inShape: 'B × 4', column: 4,
      },
      { id: 'advCompare', kind: 'compare', label: 'Adversarial loss', column: 4, lane: 1 },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 5 },
    ],
    edges: [
      ['noise', 'generator'],
      ['generator', 'sharedEncoder'],
      ['realInput', 'transform'],
      ['transform', 'sharedEncoder'],
      ['sharedEncoder', 'auxHead'],
      ['sharedEncoder', 'realFakeHead'],
      ['auxHead', 'auxCompare'],
      ['transform', 'auxCompare', 'context', 'the transform id actually applied'],
      ['realFakeHead', 'advCompare'],
      ['advCompare', 'generator', 'context', 'adversarial gradient, maximize D error'],
      ['sharedEncoder', 'output'],
    ],
  }),

  // ── Masked Modeling ──────────────────────────────────────────────────────
  'machine-learning-self-supervised-learning-masked-modeling-masked-autoencoder-mae': blueprint({
    title: 'Masked Autoencoder (MAE)',
    subtitle: '50% of bars masked · encoder sees only the visible half',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'patchify', kind: 'embedding', label: 'Patch embedding', sublabel: `8 patches × 8 bars → ${E}`,
        outShape: `B × 8 × ${E}`, params: P.linear(PATCH_BARS * F, E), column: 1,
      },
      {
        id: 'mask', kind: 'stochastic', label: 'Mask', sublabel: '50% of patches removed',
        inShape: `B × 8 × ${E}`, outShape: `B × 4 × ${E}`, column: 2,
        analogy: 'Think of it as blacking out half the candles in the window and only showing the model the other half.',
      },
      {
        id: 'visibleEncoder', kind: 'attention', label: 'Visible-patch encoder', sublabel: '2-layer transformer, visible patches only',
        inShape: `B × 4 × ${E}`, outShape: `B × 4 × ${E}`, params: TRANSFORMER_PARAMS, column: 3,
        analogy: "Think of it as the model only having to think about the visible half — cheaper, and it can't cheat by peeking at what's hidden.",
      },
      {
        id: 'maskToken', kind: 'memory', label: 'Mask token', sublabel: 'learnable placeholder, 32-d',
        outShape: 'B × 32', params: P.embedding(1, 32), column: 3, lane: 1,
        analogy: "Think of it as a placeholder blank dropped in wherever a candle was hidden, marking 'something was here' before the decoder tries to fill it in.",
      },
      {
        id: 'decoder', kind: 'attention', label: 'Lightweight decoder', sublabel: `narrower than the encoder: ${E} → 32, all 8 patches`,
        inShape: `B × 8 × 32`, outShape: `B × 8 × ${PATCH_BARS * F}`,
        params: P.linear(E, 32) + P.encoderLayer(32, 64) + P.linear(32, PATCH_BARS * F), column: 4,
        detail: { formula: `linear(${E},32) + encoderLayer(32,64) + linear(32,${PATCH_BARS * F})` },
        analogy: 'Think of it as a junior assistant who only has to fill in the blanks and is thrown away afterwards — the expensive reader is the encoder.',
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × 4 × ${E}`, column: 3, lane: 2 },
      {
        id: 'reconCompare', kind: 'compare', label: 'Reconstruction loss', sublabel: 'MSE on masked patches only', column: 5,
        analogy: 'Think of it as grading the decoder only on the candles it never got to see.',
      },
    ],
    edges: [
      ['input', 'patchify'],
      ['patchify', 'mask'],
      ['mask', 'visibleEncoder'],
      ['visibleEncoder', 'decoder'],
      ['maskToken', 'decoder'],
      ['decoder', 'reconCompare'],
      ['input', 'reconCompare', 'context', 'reconstruction target: the raw masked bars'],
      ['visibleEncoder', 'output'],
    ],
  }),

  'machine-learning-self-supervised-learning-masked-modeling-masked-graph-modeling': blueprint({
    title: 'Masked Graph Modeling',
    subtitle: 'bar-similarity graph · 15-50% of nodes/edges masked',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar features', outShape: `N × ${F}`, column: 0 },
      {
        id: 'graph', kind: 'memory', label: 'Similarity graph', sublabel: 'edges among visible + masked bars',
        column: 0, lane: 1,
      },
      {
        id: 'maskNodes', kind: 'stochastic', label: 'Mask nodes/edges', sublabel: '15-50% ratio', column: 1,
        analogy: 'Think of it as hiding 15-50% of the bars in the similarity graph, and their connections.',
      },
      {
        id: 'gnnEncoder', kind: 'conv', label: 'Graph encoder', sublabel: `${F} → ${E}, visible nodes only`,
        outShape: `N × ${E}`, params: P.linear(F, E), column: 2,
      },
      {
        id: 'decoder', kind: 'linear', label: 'Node/edge decoder', sublabel: `${E} → ${F}, edges via dot product`,
        outShape: `N × ${F}`, params: P.linear(E, F), column: 3,
        analogy: 'Think of it as guessing a hidden bar’s features from its visible neighbors’ fingerprints, and guessing whether a hidden connection existed via a dot product between two fingerprints.',
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `N × ${E}`, column: 3, lane: 1 },
      { id: 'reconCompare', kind: 'compare', label: 'Reconstruction loss', sublabel: 'masked nodes/edges only', column: 4 },
    ],
    edges: [
      ['input', 'maskNodes'],
      ['graph', 'gnnEncoder', 'context', 'neighbor aggregation'],
      ['maskNodes', 'gnnEncoder'],
      ['gnnEncoder', 'decoder'],
      ['decoder', 'reconCompare'],
      ['input', 'reconCompare', 'context', 'reconstruction target'],
      ['gnnEncoder', 'output'],
    ],
  }),

  'machine-learning-self-supervised-learning-masked-modeling-masked-language-modeling-bert-style': blueprint({
    title: 'Masked Language Modeling (BERT-style)',
    subtitle: '4-layer bidirectional encoder · 15% of bars masked',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'embedding', kind: 'embedding', label: 'Bar embedding', sublabel: `Linear ${F} → ${E} + learned positional`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${E}`,
        params: P.linear(F, E) + P.embedding(T, E), column: 1,
        detail: { formula: `linear(${F},${E}) + embedding(${T},${E})`, 'positional table': `one learned vector per slot in the ${T}-bar window` },
        analogy: "Think of it as converting each bar's 35 raw numbers into a 64-number 'token' the transformer can read, the way BERT turns a word into a vector.",
      },
      {
        id: 'mask', kind: 'stochastic', label: 'Mask', sublabel: '15% of bars → the learned [MASK] vector',
        inShape: `B × ${T} × ${E}`, outShape: `B × ${T} × ${E}`, params: P.embedding(1, E), column: 2,
        detail: { 'the [MASK] vector': `is itself learned — one ${E}-wide row, embedding(1,${E})` },
        analogy: 'Think of it as blanking out 15% of the bars with a generic [MASK] placeholder token, the way BERT blanks out 15% of words.',
      },
      {
        id: 'encoderStack', kind: 'attention', label: 'Bidirectional encoder', sublabel: '4 layers · no causal mask',
        outShape: `B × ${T} × ${E}`, params: 4 * P.encoderLayer(E, INNER), column: 3,
        analogy: 'Think of it as every bar’s token looking at every OTHER bar’s token, before AND after it in time, unlike a left-to-right forecaster that can only look backward.',
      },
      {
        id: 'taskHead', kind: 'head', label: 'MLM head', sublabel: `Linear ${E} → ${F}, applied at every position`,
        inShape: `B × ${T} × ${E}`, outShape: `B × ${T} × ${F}`, params: P.linear(E, F), column: 4,
        analogy: 'Think of it as guessing the exact 35 features of a blanked-out bar purely from the bars around it.',
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${T} × ${E}`, column: 4, lane: 1 },
      { id: 'reconCompare', kind: 'compare', label: 'Reconstruction loss', sublabel: 'masked bars only', column: 5 },
    ],
    edges: [
      ['input', 'embedding'],
      ['embedding', 'mask'],
      ['mask', 'encoderStack'],
      ['encoderStack', 'taskHead'],
      ['taskHead', 'reconCompare'],
      ['input', 'reconCompare', 'context', `the original ${F} features, before masking`],
      ['encoderStack', 'output'],
    ],
  }),

  // ── Predictive Representation Learning ──────────────────────────────────
  'machine-learning-self-supervised-learning-predictive-representation-learning-context-prediction-cpc': blueprint({
    title: 'Context Prediction (CPC)',
    subtitle: 'per-bar encoder → GRU context → predict z at t+1..t+3, InfoNCE',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'encoder', kind: 'linear', label: 'Per-bar encoder g_enc', sublabel: `Linear ${F} → ${E}`,
        outShape: `B × ${T} × ${E}`, params: P.linear(F, E), column: 1,
        analogy: 'Think of it as compressing each single bar into a latent summary z_t.',
      },
      {
        id: 'autoregressive', kind: 'recurrent', label: 'Autoregressive context g_ar', sublabel: `GRU, ${E} hidden`,
        outShape: `B × ${E}`, params: P.gru(E, E), column: 2,
        analogy: 'Think of it as a trader building up a running context from everything seen so far, bar by bar.',
      },
      {
        id: 'predictors', kind: 'linear', label: 'k-step predictors f_k', sublabel: '3 bilinear matrices Wₖ, k = 1, 2, 3',
        inShape: `B × ${E}`, outShape: `B × 3 × ${E}`, params: 3 * P.linear(E, E, false), column: 3,
        detail: { 'why no bias': 'fₖ scores a pair as zᵀWₖc — Wₖ is a similarity matrix, not an affine layer' },
        analogy: 'Think of it as trying to guess the latent summary of the bar 1, 2, and 3 steps into the future purely from that running context.',
      },
      {
        id: 'infoNCE', kind: 'compare', label: 'InfoNCE', sublabel: 'density ratio vs negative samples', column: 4,
        analogy: 'Think of it as scoring that guess against the REAL future bar’s summary versus a pile of decoy summaries from other bars, and rewarding the model for picking out the real one.',
      },
      { id: 'output', kind: 'output', label: 'Context c_t', outShape: `B × ${E}`, column: 3, lane: 1 },
    ],
    edges: [
      ['input', 'encoder'],
      ['encoder', 'autoregressive'],
      ['autoregressive', 'predictors'],
      ['predictors', 'infoNCE'],
      ['encoder', 'infoNCE', 'context', 'true future latents + negatives'],
      ['autoregressive', 'output'],
    ],
  }),

  'machine-learning-self-supervised-learning-predictive-representation-learning-predictive-coding-models': blueprint({
    title: 'Predictive Coding Models',
    subtitle: 'error-driven, next-step MSE — not contrastive like CPC',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'encoder', kind: 'linear', label: 'Per-bar encoder', sublabel: `Linear ${F} → ${E}, applied at every bar`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${E}`, params: P.linear(F, E), column: 1,
      },
      {
        id: 'nextEncoder', kind: 'linear', label: 'Per-bar encoder', sublabel: 'same weights, one bar later',
        outShape: `B × ${E}`, column: 1, lane: 1, detail: { 'shared with': 'encoder' },
      },
      {
        id: 'predictor', kind: 'recurrent', label: 'Predictive model', sublabel: `LSTM, ${E} hidden · 4 gates`,
        inShape: `B × ${T} × ${E}`, outShape: `B × ${E}`, params: P.lstm(E, E), column: 2,
        analogy: 'Think of it as an LSTM constantly trying to guess the very next bar’s latent summary from everything so far.',
      },
      {
        id: 'errorModule', kind: 'compare', label: 'Error module', sublabel: 'MSE(predicted, actual next latent)',
        column: 3,
        analogy: "Think of it as the model constantly checking how wrong its last prediction was — and using that error, not a comparison against decoys — to correct the next one.",
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 3, lane: 1 },
    ],
    edges: [
      ['input', 'encoder'],
      ['input', 'nextEncoder'],
      ['encoder', 'predictor'],
      ['predictor', 'errorModule'],
      ['nextEncoder', 'errorModule', 'context', 'actual next latent'],
      ['errorModule', 'predictor', 'context', 'error-driven correction'],
      ['predictor', 'output'],
      ['encoder', 'nextEncoder', 'context', 'shared weights, next timestep'],
    ],
  }),

  'machine-learning-self-supervised-learning-predictive-representation-learning-rotation-prediction-rotnet': blueprint({
    title: 'Rotation Prediction (RotNet)',
    subtitle: 'adapted to bars: predict which of 4 known transforms was applied',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'transform', kind: 'stochastic', label: 'Apply known transform', sublabel: 'identity · reverse · sign-flip · shuffle',
        outShape: `B × ${T} × ${F}`, column: 1,
        analogy: 'Think of it as scrambling the bar window one of four known ways — left alone, played backward, flipped upside-down, or bars shuffled — and only telling the model which recipe was used, never the original.',
      },
      {
        id: 'backbone', kind: 'conv', label: 'Encoder', sublabel: `TCN, ${E} filters`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
      },
      {
        id: 'classHead', kind: 'head', label: 'Transform head', sublabel: `Linear ${E} → 4`,
        outShape: 'B × 4', params: P.linear(E, 4), column: 3,
        analogy: 'Think of it as forcing the model to become good at recognizing what "normal" looks like, since spotting the distortion requires understanding the chart’s real structure first.',
      },
      { id: 'compare', kind: 'compare', label: 'Cross-entropy', sublabel: 'vs the known transform id', column: 4 },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 4, lane: 1 },
    ],
    edges: [
      ['input', 'transform'],
      ['transform', 'backbone'],
      ['backbone', 'classHead'],
      ['classHead', 'compare'],
      ['backbone', 'output'],
    ],
  }),

  'machine-learning-self-supervised-learning-predictive-representation-learning-self-predictive-representations-spr': blueprint({
    title: 'Self-Predictive Representations (SPR)',
    subtitle: 'the general online/target/predictor family — BYOL is its most famous instance',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'aug1', kind: 'stochastic', label: 'Augment (view 1)', column: 1 },
      { id: 'aug2', kind: 'stochastic', label: 'Augment (view 2)', column: 1, lane: 1 },
      {
        id: 'onlineEnc', kind: 'conv', label: 'Online encoder f_θ', sublabel: `TCN, ${E} filters`,
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2,
      },
      {
        id: 'targetEnc', kind: 'conv', label: 'Target encoder f_ξ', sublabel: 'EMA copy',
        outShape: `B × ${E}`, params: ENCODER_PARAMS, column: 2, lane: 1,
      },
      {
        id: 'predictor', kind: 'linear', label: 'Predictor q_θ', sublabel: `Linear ${E} → ${E}`,
        outShape: `B × ${E}`, params: P.linear(E, E), column: 3,
        detail: {
          'BYOL': 'adds a separate projection head before this predictor',
          'SimSiam': 'drops the EMA target, uses stop-gradient instead',
          'Barlow Twins': 'drops the predictor, uses a cross-correlation loss instead',
        },
        analogy: 'Think of it as the one learnable piece translating today’s latent summary into a guess for the target network’s summary of a different view.',
      },
      {
        id: 'compare', kind: 'compare', label: 'MSE', sublabel: 'ẑ′ vs z′ · stop-grad on the target',
        inShape: `B × ${E}`, column: 4, lane: 1,
        detail: { 'stop-gradient': 'the target branch is detached; the EMA update is the only way it moves' },
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 4 },
    ],
    edges: [
      ['input', 'aug1'],
      ['input', 'aug2'],
      ['aug1', 'onlineEnc'],
      ['aug2', 'targetEnc'],
      ['onlineEnc', 'predictor'],
      ['predictor', 'compare'],
      ['targetEnc', 'compare'],
      ['predictor', 'output'],
      ['onlineEnc', 'targetEnc', 'context', 'EMA copy'],
    ],
  }),

  'machine-learning-self-supervised-learning-predictive-representation-learning-transformer-based-self-supervision': blueprint({
    title: 'Transformer-Based Self-Supervision (Data2Vec-style)',
    subtitle: 'student predicts the EMA teacher’s own contextual representations, not raw values',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'patchify', kind: 'embedding', label: 'Patch embedding', sublabel: `8 patches × 8 bars → ${E}`,
        outShape: `B × 8 × ${E}`, params: P.linear(PATCH_BARS * F, E), column: 1,
      },
      { id: 'mask', kind: 'stochastic', label: 'Mask', sublabel: 'a subset of patches, student path only', column: 2 },
      {
        id: 'studentTransformer', kind: 'attention', label: 'Student transformer', sublabel: '2 layers, masked input',
        outShape: `B × ${E}`, params: TRANSFORMER_PARAMS, column: 3,
      },
      {
        id: 'teacherTransformer', kind: 'attention', label: 'Teacher transformer', sublabel: 'EMA copy, full unmasked window',
        inShape: `B × 8 × ${E}`, outShape: `B × ${E}`, params: TRANSFORMER_PARAMS, column: 3, lane: 1,
        detail: { 'the target is': 'the AVERAGE of its top-K layer outputs, instance-normalized — not the last layer, and not the raw bars' },
        analogy: 'Think of it as a slow EMA twin that gets to see the WHOLE unmasked window, producing a rich contextual target for every bar.',
      },
      {
        id: 'pretextHead', kind: 'linear', label: 'Regression head', sublabel: `Linear ${E} → ${E}`,
        outShape: `B × ${E}`, params: P.linear(E, E), column: 4,
        analogy: "Think of it as the student — which only saw the masked window — trying to reconstruct the teacher's rich understanding of the hidden bars, not just their raw prices.",
      },
      {
        id: 'compare', kind: 'compare', label: 'Regression loss',
        sublabel: 'masked positions only · stop-grad on the teacher', inShape: `B × ${E}`, column: 5,
      },
      { id: 'output', kind: 'output', label: 'Pretrained embedding', outShape: `B × ${E}`, column: 4, lane: 1 },
    ],
    edges: [
      ['input', 'patchify'],
      ['patchify', 'mask'],
      ['mask', 'studentTransformer'],
      ['patchify', 'teacherTransformer'],
      ['studentTransformer', 'pretextHead'],
      ['pretextHead', 'compare'],
      ['teacherTransformer', 'compare', 'context', 'target representation, masked positions'],
      ['studentTransformer', 'output'],
      ['studentTransformer', 'teacherTransformer', 'context', 'EMA copy'],
    ],
  }),
};
