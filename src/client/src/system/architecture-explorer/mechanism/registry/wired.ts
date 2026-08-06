/**
 * WIRED runners — the models this repo genuinely trains.
 *
 * These have no markdown spec in the algo_models corpus because they are not
 * literature entries: they are real code here. `specPath` therefore cites the
 * source file, and every stage below was read from it. `repoRunner` is null
 * throughout — for these, and only these, what the animation shows IS what
 * pressing Run would execute.
 *
 * Hand-written (`curation: 'curated'`), not produced by
 * scripts/build_mechanism_registry.py, which has no markdown to extract here.
 *
 * Deliberately absent: `primitives_cnn+multi_head`. Its trainer lives in a
 * sibling repo that is not on this disk, so there is no source to read. It
 * stays unresearched and the UI states that, rather than being described from
 * guesswork — the same refusal graph/derive.ts already makes for it.
 */

import type { MechanismSpec } from './types';

export const WIRED: MechanismSpec[] = [
  {
    catalogKey: 'xgboost+direction_classifier',
    name: 'XGBoost Direction Classifier',
    archetype: 'tree-route',
    provenance: 'schematic',
    specPath: 'src/ml/xgb_classifier/main.py',
    analogy:
      'Think of it as a room of junior analysts, each hired only to correct the ' +
      'mistakes the room has made so far; the call is the running total of their votes.',
    stages: [
      { id: 'features', role: 'input', label: 'Feature vector', detail: '35 engineered features per bar' },
      { id: 'tree', role: 'transform', label: 'Boosted tree', detail: 'hist method, device=cuda' },
      { id: 'residual', role: 'update', label: 'Fit next tree to residuals', detail: 'gradient + hessian' },
      { id: 'sum', role: 'score', label: 'Sum leaf values', detail: 'across all boosting rounds' },
      { id: 'logit', role: 'output', label: 'Direction logit' },
    ],
    beats: [
      {
        id: 'boost',
        at: 'residual',
        label: 'each tree fixes the last',
        detail:
          'Trees are not independent as in a random forest — each one is fitted to the ' +
          'gradient of the loss left over by the ensemble so far, which is what makes this boosting.',
      },
      {
        id: 'hist',
        at: 'tree',
        label: 'histogram split finding',
        detail:
          'Continuous features are bucketed into a histogram so split search is over bins ' +
          'rather than raw values — the reason this trains on GPU at this speed.',
      },
      {
        id: 'leafsum',
        at: 'sum',
        label: 'additive, not averaged',
        detail:
          'The prediction is the SUM of every tree’s leaf value plus the base score, so ' +
          'later trees can make small corrections to earlier ones.',
      },
    ],
    repoRunner: null,
    kernelId: null,
    curation: 'curated',
  },

  {
    catalogKey: 'transformer_2s+range_classifier',
    name: 'Two-Stream Transformer + Range-Bucket (HPO)',
    archetype: 'attention-match',
    provenance: 'schematic',
    specPath: 'src/ml/blocks/encoder.py',
    analogy:
      'Think of it as two traders reading the same tape — one watching price, one watching ' +
      'volume — who compare notes before either commits to a view.',
    stages: [
      { id: 'window', role: 'input', label: 'Bar window', detail: 'price and volume channels' },
      { id: 'price', role: 'transform', label: 'Price stream', detail: 'projected to d_model' },
      { id: 'volume', role: 'transform', label: 'Volume stream', detail: 'projected to d_model' },
      { id: 'attn', role: 'transform', label: 'Self-attention', detail: 'per stream, multi-head' },
      { id: 'fuse', role: 'latent', label: 'Fuse streams' },
      { id: 'head', role: 'output', label: 'Range-bucket head' },
    ],
    beats: [
      {
        id: 'twostream',
        at: 'volume',
        label: 'two separate streams',
        detail:
          'Price and volume are encoded independently before fusion, so the model can learn ' +
          'volume structure that price alone would wash out.',
      },
      {
        id: 'attention',
        at: 'attn',
        label: 'every bar weighs every other',
        detail:
          'Attention lets any bar in the window condition on any other regardless of distance, ' +
          'which a convolution’s fixed kernel cannot do.',
      },
      {
        id: 'bucket',
        at: 'head',
        label: 'range buckets, not a point',
        detail:
          'The head predicts which range bucket the next bar falls in, turning a regression ' +
          'into a calibrated classification.',
      },
    ],
    repoRunner: null,
    kernelId: null,
    curation: 'curated',
  },

  {
    catalogKey: 'transformer_tiny+direction_classifier',
    name: 'Tiny Transformer + Daily Direction (HPO)',
    archetype: 'attention-match',
    provenance: 'schematic',
    specPath: 'src/ml/blocks/encoder.py',
    analogy:
      'Think of it as the two-stream reader shrunk to a pocket size — same reading habit, ' +
      'far fewer notes, so it cannot memorise the tape.',
    stages: [
      { id: 'window', role: 'input', label: 'Daily bar window' },
      { id: 'proj', role: 'transform', label: 'Linear projection', detail: 'raw channels to d_model' },
      { id: 'attn', role: 'transform', label: 'Self-attention block' },
      { id: 'pool', role: 'latent', label: 'Pool over time' },
      { id: 'head', role: 'output', label: 'Direction head', detail: 'binary up/down' },
    ],
    beats: [
      {
        id: 'small',
        at: 'proj',
        label: 'deliberately small',
        detail:
          'Low width and depth are the regularizer: on daily bars there are few samples, so ' +
          'capacity is the thing most likely to cause overfitting.',
      },
      {
        id: 'pooled',
        at: 'pool',
        label: 'pooled, not last-token',
        detail:
          'The sequence is pooled over time before the head, so no single bar dominates the decision.',
      },
    ],
    repoRunner: null,
    kernelId: null,
    curation: 'curated',
  },

  {
    catalogKey: 'temporal_fusion_transformer+direction_classifier',
    name: 'Temporal Fusion Transformer (direction)',
    archetype: 'attention-match',
    provenance: 'schematic',
    specPath: 'src/ml/blocks/tft.py',
    analogy:
      'Think of it as an analyst who first decides which indicators are worth reading today, ' +
      'then reads the tape in order, then checks which moments mattered.',
    stages: [
      { id: 'inputs', role: 'input', label: 'Feature window' },
      { id: 'vsn', role: 'transform', label: 'Variable Selection Network', detail: 'per-feature gating weights' },
      { id: 'lstm', role: 'transform', label: 'LSTM encoder', detail: 'local sequential structure' },
      { id: 'grn', role: 'transform', label: 'Gated Residual Network', detail: 'GLU + skip' },
      { id: 'imha', role: 'score', label: 'Interpretable multi-head attention' },
      { id: 'head', role: 'output', label: 'Direction head' },
    ],
    beats: [
      {
        id: 'vsn',
        at: 'vsn',
        label: 'it chooses its own inputs',
        detail:
          'The Variable Selection Network emits a softmax weight per feature per step, so the ' +
          'model reports which inputs it actually used — the interpretability the name promises.',
      },
      {
        id: 'glu',
        at: 'grn',
        label: 'gated skip connections',
        detail:
          'Gated Residual Networks let the model route around a block entirely when it is not ' +
          'useful, so depth costs little when the extra capacity is not needed.',
      },
      {
        id: 'attn',
        at: 'imha',
        label: 'attention you can read',
        detail:
          'Heads share value projections so the attention weights aggregate into a single ' +
          'per-timestep importance that is meaningful to plot.',
      },
    ],
    repoRunner: null,
    kernelId: null,
    curation: 'curated',
  },

  {
    catalogKey: 'temporal-fusion-transformer',
    name: 'Temporal Fusion Transformer',
    archetype: 'attention-match',
    provenance: 'schematic',
    specPath: 'src/ml/blocks/tft.py',
    analogy:
      'Think of it as an analyst who first decides which indicators are worth reading today, ' +
      'then reads the tape in order, then checks which moments mattered.',
    stages: [
      { id: 'inputs', role: 'input', label: 'Feature window' },
      { id: 'vsn', role: 'transform', label: 'Variable Selection Network' },
      { id: 'lstm', role: 'transform', label: 'LSTM encoder' },
      { id: 'grn', role: 'transform', label: 'Gated Residual Network' },
      { id: 'imha', role: 'score', label: 'Interpretable multi-head attention' },
      { id: 'head', role: 'output', label: 'Prediction head' },
    ],
    beats: [
      {
        id: 'vsn',
        at: 'vsn',
        label: 'it chooses its own inputs',
        detail:
          'A softmax weight per feature per step means the model reports which inputs it used.',
      },
      {
        id: 'lstm',
        at: 'lstm',
        label: 'LSTM before attention',
        detail:
          'Local order is captured recurrently first, so attention is left to model the long-range ' +
          'relationships rather than basic sequence structure.',
      },
    ],
    repoRunner: null,
    kernelId: null,
    curation: 'curated',
  },

  {
    catalogKey: 'voting-composite',
    name: 'Voting Ensemble (Composite)',
    archetype: 'ensemble-route',
    provenance: 'schematic',
    specPath: 'src/templates/architectures/composite_voting.py.j2',
    analogy:
      'Think of it as polling several traders and taking the show of hands — no one of them ' +
      'has to be right, only the majority.',
    stages: [
      { id: 'features', role: 'input', label: 'Feature vector' },
      { id: 'members', role: 'transform', label: 'Member models', detail: 'each predicts independently' },
      { id: 'vote', role: 'score', label: 'Aggregate votes', detail: 'hard majority or soft mean' },
      { id: 'out', role: 'output', label: 'Ensemble prediction' },
    ],
    beats: [
      {
        id: 'independent',
        at: 'members',
        label: 'members never see each other',
        detail:
          'Each member is fitted on the same data independently; the ensemble gains only from ' +
          'their errors being uncorrelated.',
      },
      {
        id: 'softhard',
        at: 'vote',
        label: 'soft beats hard when calibrated',
        detail:
          'Soft voting averages predicted probabilities rather than labels, which preserves ' +
          'confidence — but only helps if the members are calibrated.',
      },
    ],
    repoRunner: null,
    kernelId: null,
    curation: 'curated',
  },

  {
    catalogKey: 'multimodal-composite',
    name: 'Multimodal Encoder Fusion (Composite)',
    archetype: 'ensemble-route',
    provenance: 'schematic',
    specPath: 'src/templates/architectures/composite_multimodal.py.j2',
    analogy:
      'Think of it as one desk reading the tape, another reading the news, and a third whose ' +
      'only job is to reconcile the two before a call is made.',
    stages: [
      { id: 'modalities', role: 'input', label: 'Separate modalities' },
      { id: 'encoders', role: 'transform', label: 'Per-modality encoders' },
      { id: 'fuse', role: 'latent', label: 'Fusion layer', detail: 'concat / gated / cross-attention' },
      { id: 'head', role: 'output', label: 'Shared head' },
    ],
    beats: [
      {
        id: 'separate',
        at: 'encoders',
        label: 'encode separately first',
        detail:
          'Each modality gets its own encoder so a high-variance channel cannot swamp a ' +
          'low-variance one before either has been represented.',
      },
      {
        id: 'fusion',
        at: 'fuse',
        label: 'fusion choice is the model',
        detail:
          'Concatenation treats modalities as equals; gating lets the model suppress one entirely; ' +
          'cross-attention lets one query the other. The choice, not the encoders, defines behaviour.',
      },
    ],
    repoRunner: null,
    kernelId: null,
    curation: 'curated',
  },
];
