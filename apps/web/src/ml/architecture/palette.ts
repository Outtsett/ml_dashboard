/**
 * Fixed LayerKind → design-token assignment.
 *
 * Tokens are the unitless HSL triplet custom properties from
 * apps/web/src/index.css (--data-cat-1..10). Wrap as
 * `hsl(var(${token}))` in SVG attrs, `hsl(var(${token}) / 0.35)` for alpha.
 *
 * Assignments are FIXED per kind across every model — attention is always
 * --data-cat-1 whether it appears in the TFT, the two-stream transformer,
 * or the generated transformer_seq template. Never index-cycle per model.
 *
 * There are 18 kinds and 10 categorical tokens, so some kinds share a token.
 * Shares were chosen so kinds that CO-OCCUR in the same derived graph get
 * distinct tokens wherever possible; the two documented exceptions are
 * input/output (both --data-cat-9 — I/O terminals deliberately share the
 * neutral data token, and are unambiguous by position + text) and
 * head/positional (--data-cat-8 — single far-apart nodes, always text-labeled).
 * Color is never the sole identity channel: every node carries a kind chip
 * with text, and the legend pairs every dot with a label + count.
 */

import type { LayerKind } from './types';

export interface LayerPaletteEntry {
  /** CSS custom-property name, e.g. '--data-cat-1'. */
  token: string;
  /** Human label shown in kind chips and the legend. */
  label: string;
  /** Short mechanism blurb (tooltip / legend title). */
  blurb: string;
}

export const LAYER_PALETTE: Record<LayerKind, LayerPaletteEntry> = {
  input: {
    token: '--data-cat-9',
    label: 'Input',
    blurb: 'Raw data entering the network — bars, features, rolling windows.',
  },
  embedding: {
    token: '--data-cat-2',
    label: 'Projection',
    blurb: 'Linear map lifting raw channels into the model width.',
  },
  positional: {
    token: '--data-cat-8',
    label: 'Positional',
    blurb: 'Fixed sin/cos bar-index stamp so ordering survives attention.',
  },
  conv: {
    token: '--data-cat-5',
    label: 'Convolution',
    blurb: 'Kernel slid along the time axis — a pattern scanner over recent bars.',
  },
  attention: {
    token: '--data-cat-1',
    label: 'Attention',
    blurb: 'Every bar votes on which other bars matter for it.',
  },
  norm: {
    token: '--data-cat-10',
    label: 'Normalize',
    blurb: 'Re-centers / re-scales activations so training stays stable.',
  },
  dropout: {
    token: '--data-cat-5',
    label: 'Dropout',
    blurb: 'Randomly silences units during training to prevent memorizing.',
  },
  linear: {
    token: '--data-cat-3',
    label: 'Dense',
    blurb: 'Fully-connected transform — the workhorse weight matrix.',
  },
  activation: {
    token: '--data-cat-6',
    label: 'Activation',
    blurb: 'Pointwise non-linearity (GELU, ELU, sigmoid).',
  },
  recurrent: {
    token: '--data-cat-7',
    label: 'Recurrent',
    blurb: 'Reads the window bar-by-bar, carrying a memory state forward.',
  },
  gate: {
    token: '--data-cat-6',
    label: 'Gate',
    blurb: 'Learned on/off valve deciding how much of a signal passes through.',
  },
  fusion: {
    token: '--data-cat-7',
    label: 'Fusion',
    blurb: 'Merges parallel streams into one representation.',
  },
  pool: {
    token: '--data-cat-6',
    label: 'Pool',
    blurb: 'Collapses the time axis into one summary vector.',
  },
  reshape: {
    token: '--data-cat-4',
    label: 'Reshape',
    blurb: 'Rearranges tensor layout — no learned weights.',
  },
  head: {
    token: '--data-cat-8',
    label: 'Head',
    blurb: 'Task-specific output projection (direction / range buckets / reconstruction).',
  },
  output: {
    token: '--data-cat-9',
    label: 'Output',
    blurb: 'What the model hands back — logits, probabilities, scores.',
  },
  tree: {
    token: '--data-cat-3',
    label: 'Tree',
    blurb: 'Axis-aligned split rules fit to the current residual errors.',
  },
  ensemble: {
    token: '--data-cat-2',
    label: 'Ensemble',
    blurb: 'Additive combination of many weak learners.',
  },
  stochastic: {
    token: '--data-cat-6',
    label: 'Sampling',
    blurb: 'A random draw — noise injection, a latent sample, a bootstrap resample.',
  },
  compare: {
    token: '--data-cat-7',
    label: 'Comparison',
    blurb: 'Two things scored against each other — a distance, a similarity, a loss.',
  },
  memory: {
    token: '--data-cat-4',
    label: 'Memory',
    blurb: 'State kept outside the layer stack and read or written by address.',
  },
  cluster: {
    token: '--data-cat-3',
    label: 'Partition',
    blurb: 'Points assigned to groups — centroids, components, neighbourhoods.',
  },
};
