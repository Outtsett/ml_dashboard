/**
 * Blueprints — Neural Network Architectures (all groups except Recurrent &
 * Sequential's LSTM, which lives in recurrent.ts).
 *
 * One entry per catalog spec id, stages in data-flow order, every parameter
 * count from `P`. Sized for this repo's DIM: 35 features, 64-bar window,
 * 3 classes.
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const C = DIM.classes;
const D = 64; // reference embedding / attention width for this group
const H = 128; // reference recurrent hidden width (matches recurrent.ts)

export const NEURAL_NETWORK_BLUEPRINTS: Record<string, ArchGraph> = {
  // ── Attention-Based Architectures ─────────────────────────────────────────

  'neural-network-architectures-attention-based-architectures-self-attention-mechanism': blueprint({
    title: 'Self-Attention Mechanism',
    subtitle: `1 transformer block · d_model ${D} · ${T}-bar window`,
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
        outShape: `B × ${T} × ${F}`, column: 0,
        analogy: 'Think of it as the last 64 candles laid on a table, one after another.',
      },
      {
        id: 'embed', kind: 'linear', label: 'Feature embedding', sublabel: `Linear ${F} → ${D}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${D}`, params: P.linear(F, D), column: 1,
      },
      {
        id: 'posenc', kind: 'positional', label: 'Positional encoding', sublabel: 'fixed sinusoidal, per bar-index',
        outShape: `${T} × ${D}`, column: 1, lane: 1,
        analogy: 'Think of it as writing the bar number on each candle, since attention alone cannot tell candle 3 from candle 30.',
      },
      {
        id: 'attn', kind: 'attention', label: 'Multi-head self-attention', sublabel: `Q,K,V from the same tape · 4 heads`,
        inShape: `B × ${T} × ${D}`, outShape: `B × ${T} × ${D}`, params: P.attention(D), column: 2,
        detail: { 'formula': 'packed QKV linear (d → 3d) + output projection (d → d)', 'scaling': `1 / sqrt(${D})` },
        analogy: 'Think of it as every candle asking every other candle "how relevant are you to me right now" and blending their answers by how strongly they agree.',
      },
      {
        id: 'norm1', kind: 'norm', label: 'Add & norm', sublabel: 'residual around attention',
        inShape: `B × ${T} × ${D}`, outShape: `B × ${T} × ${D}`, params: P.norm(D), column: 3,
      },
      {
        id: 'ffn', kind: 'linear', label: 'Position-wise feed-forward', sublabel: `${D} → ${4 * D} → ${D}`,
        inShape: `B × ${T} × ${D}`, outShape: `B × ${T} × ${D}`, params: P.feedForward(D, 4 * D), column: 4,
      },
      {
        id: 'norm2', kind: 'norm', label: 'Add & norm', sublabel: 'residual around feed-forward',
        inShape: `B × ${T} × ${D}`, outShape: `B × ${T} × ${D}`, params: P.norm(D), column: 5,
      },
      {
        id: 'pool', kind: 'pool', label: 'Mean pool', sublabel: 'average over the 64 bars',
        inShape: `B × ${T} × ${D}`, outShape: `B × ${D}`, column: 6,
      },
      {
        id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${D} → ${C}`,
        inShape: `B × ${D}`, outShape: `B × ${C}`, params: P.linear(D, C), column: 7,
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', sublabel: 'softmax probabilities', outShape: `B × ${C}`, column: 8 },
    ],
    edges: [
      ...chain('input', 'embed', 'attn', 'norm1', 'ffn', 'norm2', 'pool', 'head', 'output'),
      ['posenc', 'attn', 'context', 'add before attention'],
      ['embed', 'norm1', 'residual', 'skip around attention'],
      ['norm1', 'norm2', 'residual', 'skip around feed-forward'],
    ],
  }),

  'neural-network-architectures-attention-based-architectures-slot-attention-network': blueprint({
    title: 'Slot Attention Network',
    subtitle: `5 slots · slot dim ${D} · 3 routing iterations`,
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
        outShape: `B × ${T} × ${F}`, column: 0,
      },
      {
        id: 'encoder', kind: 'linear', label: 'Feature backbone', sublabel: `Linear ${F} → ${D}, per bar`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${D}`, params: P.linear(F, D), column: 1,
        analogy: 'Think of it as rewriting every candle\'s 35 readings into one common 64-number vocabulary before the cards start bidding for them.',
      },
      {
        id: 'slots', kind: 'memory', label: '5 learnable slots', sublabel: `K=5 × slot dim ${D}, learned init broadcast over the batch`,
        outShape: `B × 5 × ${D}`, params: P.embedding(5, D), column: 1, lane: 1,
        analogy: 'Think of it as 5 blank index cards, each about to claim ownership of one recurring pattern in the window — a trend leg, a pullback, a range, a spike, a reversal.',
      },
      {
        id: 'norm', kind: 'norm', label: 'Slot LayerNorm', sublabel: 'applied before every iteration',
        inShape: `B × 5 × ${D}`, outShape: `B × 5 × ${D}`, params: P.norm(D), column: 2,
      },
      {
        id: 'attn', kind: 'attention', label: 'Slot ← bar cross-attention', sublabel: 'competitive softmax over slots',
        inShape: `B × 5 × ${D} queries · B × ${T} × ${D} keys/values`, outShape: `B × 5 × ${D}`,
        params: 3 * P.linear(D, D), column: 3,
        detail: { 'query': '5 slots', 'key / value': `${T} bars`, 'normalisation': 'softmax over the 5 slots, not over the bars' },
        analogy: 'Think of it as each index card asking the whole tape "which bars belong to me", with the bars split up among the cards rather than shared freely.',
      },
      {
        id: 'gru_update', kind: 'gate', label: 'GRU slot update', sublabel: 'iterate 3×',
        inShape: `B × 5 × ${D}`, outShape: `B × 5 × ${D}`, params: P.gru(D, D), column: 4,
        analogy: 'Think of it as each card rewriting its notes after hearing which bars answered it, then asking again — 3 rounds until the cards stop changing their minds.',
      },
      { id: 'pool', kind: 'reshape', label: 'Flatten slots', sublabel: `5 × ${D} → ${5 * D}`, inShape: `B × 5 × ${D}`, outShape: `B × ${5 * D}`, column: 5 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${5 * D} → ${C}`, inShape: `B × ${5 * D}`, outShape: `B × ${C}`, params: P.linear(5 * D, C), column: 6 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 7 },
    ],
    edges: [
      ['input', 'encoder', 'flow'],
      ['encoder', 'attn', 'flow', 'keys / values'],
      ['slots', 'norm', 'flow'],
      ['norm', 'attn', 'flow', 'queries'],
      ['attn', 'gru_update', 'flow'],
      ['gru_update', 'slots', 'context', 'write updated slots (× 3 iterations)'],
      ['gru_update', 'pool', 'flow'],
      ['pool', 'head', 'flow'],
      ['head', 'output', 'flow'],
    ],
  }),

  'neural-network-architectures-attention-based-architectures-transformer-encoder-decoder': blueprint({
    title: 'Transformer (Encoder-Decoder)',
    subtitle: `d_model ${D} · single encoder + decoder layer`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Source bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'enc_embed', kind: 'linear', label: 'Source embedding', sublabel: `Linear ${F} → ${D}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${D}`, params: P.linear(F, D), column: 1,
      },
      {
        id: 'posenc', kind: 'positional', label: 'Positional encoding', sublabel: 'fixed sinusoidal, per bar-index',
        outShape: `${T} × ${D}`, column: 1, lane: 2,
        analogy: 'Think of it as stamping the bar number onto every candle, because attention on its own would read the window as an unordered bag of bars.',
      },
      {
        id: 'enc_attn', kind: 'attention', label: 'Encoder self-attention', sublabel: '+ residual & norm',
        inShape: `B × ${T} × ${D}`, outShape: `B × ${T} × ${D}`, params: P.attention(D) + P.norm(D), column: 2,
      },
      {
        id: 'enc_ffn', kind: 'linear', label: 'Encoder feed-forward', sublabel: '+ residual & norm — the "memory"',
        inShape: `B × ${T} × ${D}`, outShape: `B × ${T} × ${D}`, params: P.feedForward(D, 4 * D) + P.norm(D), column: 3,
        analogy: 'Think of it as a research desk reading the whole source tape once and writing a summary memo that the decision-maker will keep consulting.',
      },
      {
        id: 'dec_query', kind: 'embedding', label: 'Decode query', sublabel: 'single learnable start token',
        outShape: `B × ${D}`, params: P.embedding(1, D), column: 1, lane: 1,
      },
      {
        id: 'dec_self_attn', kind: 'attention', label: 'Decoder self-attention', sublabel: 'masked, + residual & norm',
        inShape: `B × ${D}`, outShape: `B × ${D}`, params: P.attention(D) + P.norm(D), column: 2, lane: 1,
      },
      {
        id: 'cross_attn', kind: 'attention', label: 'Encoder-decoder cross-attention', sublabel: `query from the decoder · keys/values B × ${T} × ${D} from the encoder`,
        inShape: `B × ${D}`, outShape: `B × ${D}`, params: P.attention(D) + P.norm(D), column: 3, lane: 1,
        analogy: 'Think of it as the decision-maker re-reading the research memo before committing, weighting whichever part of it matters for right now.',
      },
      { id: 'dec_ffn', kind: 'linear', label: 'Decoder feed-forward', sublabel: '+ residual & norm', inShape: `B × ${D}`, outShape: `B × ${D}`, params: P.feedForward(D, 4 * D) + P.norm(D), column: 4, lane: 1 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${D} → ${C}`, inShape: `B × ${D}`, outShape: `B × ${C}`, params: P.linear(D, C), column: 5 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 6 },
    ],
    edges: [
      ...chain('input', 'enc_embed', 'enc_attn', 'enc_ffn'),
      ...chain('dec_query', 'dec_self_attn', 'cross_attn', 'dec_ffn'),
      ['posenc', 'enc_attn', 'context', 'added to the source embedding'],
      ['enc_ffn', 'cross_attn', 'context', 'memory keys / values'],
      ['dec_ffn', 'head', 'flow'],
      ['head', 'output', 'flow'],
    ],
  }),

  'neural-network-architectures-attention-based-architectures-vision-transformer-vit': blueprint({
    title: 'Vision Transformer (ViT)',
    subtitle: `8 patches of 8 bars · d_model ${D}`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'patchify', kind: 'reshape', label: 'Patchify', sublabel: '8 patches of 8 bars each',
        inShape: `B × ${T} × ${F}`, outShape: 'B × 8 × 280', column: 1,
        analogy: 'Think of it as cutting the 64-candle chart into 8 blocks of 8 candles, the way a swing trader eyeballs a chart in chunks rather than one candle at a time.',
      },
      { id: 'patch_embed', kind: 'linear', label: 'Patch embedding', sublabel: `Linear 280 → ${D}`, outShape: `B × 8 × ${D}`, params: P.linear(8 * F, D), column: 2 },
      { id: 'cls_token', kind: 'embedding', label: '[CLS] token', sublabel: 'learnable, prepended', outShape: `1 × ${D}`, params: P.embedding(1, D), column: 2, lane: 1 },
      { id: 'pos_embed', kind: 'embedding', label: 'Positional embedding', sublabel: '9 positions (8 patches + CLS)', outShape: `9 × ${D}`, params: P.embedding(9, D), column: 2, lane: 2 },
      { id: 'concat', kind: 'fusion', label: 'Prepend CLS + add position', outShape: `B × 9 × ${D}`, column: 3 },
      {
        id: 'encoder', kind: 'attention', label: 'Transformer encoder layer', sublabel: '4 heads · self-attn + FFN + 2 norms',
        outShape: `B × 9 × ${D}`, params: P.encoderLayer(D, 4 * D), column: 4,
        analogy: 'Think of it as each of the 8 chunks comparing notes with every other chunk (and with a dedicated "summary" chunk) before anyone commits to a read of the whole chart.',
      },
      { id: 'cls_pool', kind: 'pool', label: 'Take [CLS] output', sublabel: 'the one token that attended to everything', outShape: `B × ${D}`, column: 5 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${D} → ${C}`, outShape: `B × ${C}`, params: P.linear(D, C), column: 6 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 7 },
    ],
    edges: [
      ...chain('input', 'patchify', 'patch_embed', 'concat', 'encoder', 'cls_pool', 'head', 'output'),
      ['cls_token', 'concat', 'flow'],
      ['pos_embed', 'concat', 'context', 'add positional embedding'],
    ],
  }),

  // ── Convolutional Networks ────────────────────────────────────────────────

  'neural-network-architectures-convolutional-networks-convolutional-neural-network-cnn': blueprint({
    title: 'Convolutional Neural Network (CNN)',
    subtitle: '1D convolutions over the bar axis · 2 conv-pool stages',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'reshape', kind: 'reshape', label: 'Channels-first', sublabel: `${F} channels × ${T} steps`, outShape: `B × ${F} × ${T}`, column: 1 },
      {
        id: 'conv1', kind: 'conv', label: 'Conv1d block 1', sublabel: `${F} → 64 channels, kernel 5`,
        outShape: `B × 64 × ${T}`, params: P.conv1d(F, 64, 5), column: 2,
        analogy: 'Think of it as a 5-bar magnifying glass sliding along the tape, flagging local shapes like a rejection wick or a 3-bar squeeze wherever they occur.',
      },
      { id: 'pool1', kind: 'pool', label: 'Max-pool', sublabel: 'kernel 2 · 64 → 32 steps', outShape: 'B × 64 × 32', column: 3 },
      { id: 'conv2', kind: 'conv', label: 'Conv1d block 2', sublabel: '64 → 128 channels, kernel 5', outShape: 'B × 128 × 32', params: P.conv1d(64, 128, 5), column: 4 },
      { id: 'pool2', kind: 'pool', label: 'Max-pool', sublabel: 'kernel 2 · 32 → 16 steps', outShape: 'B × 128 × 16', column: 5 },
      { id: 'flatten', kind: 'reshape', label: 'Flatten', sublabel: '128 × 16 → 2048', outShape: 'B × 2048', column: 6 },
      { id: 'fc1', kind: 'linear', label: 'Dense', sublabel: 'Linear 2048 → 64', outShape: 'B × 64', params: P.linear(128 * 16, 64), column: 7 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`, outShape: `B × ${C}`, params: P.linear(64, C), column: 8 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 9 },
    ],
    edges: chain('input', 'reshape', 'conv1', 'pool1', 'conv2', 'pool2', 'flatten', 'fc1', 'head', 'output'),
  }),

  'neural-network-architectures-convolutional-networks-densenet-densely-connected-cnn': blueprint({
    title: 'DenseNet (Densely Connected CNN)',
    subtitle: '1 dense block, 3 layers · growth rate 16',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'reshape', kind: 'reshape', label: 'Channels-first', sublabel: `${F} channels × ${T} steps`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${F} × ${T}`, column: 1,
      },
      {
        id: 'stem', kind: 'conv', label: 'Stem conv', sublabel: `${F} → 32 channels, kernel 3`,
        inShape: `B × ${F} × ${T}`, outShape: `B × 32 × ${T}`, params: P.conv1d(F, 32, 3), column: 2,
      },
      {
        id: 'dense1', kind: 'conv', label: 'Dense layer 1', sublabel: 'BN·ReLU·Conv 32 → 16 (growth k=16)',
        inShape: `B × 32 × ${T}`, outShape: `B × 16 × ${T}`, params: P.norm(32) + P.conv1d(32, 16, 3), column: 3,
        analogy: 'Think of it as a new analyst who reads everything every earlier analyst wrote (32 channels) and adds exactly 16 fresh notes of their own, rather than starting from a blank page.',
      },
      {
        id: 'dense2', kind: 'conv', label: 'Dense layer 2', sublabel: 'BN·ReLU·Conv 48 → 16',
        inShape: `B × 48 × ${T} (stem 32 ⊕ dense1 16)`, outShape: `B × 16 × ${T}`,
        params: P.norm(48) + P.conv1d(48, 16, 3), column: 4,
      },
      {
        id: 'dense3', kind: 'conv', label: 'Dense layer 3', sublabel: 'BN·ReLU·Conv 64 → 16 · block output 80ch',
        inShape: `B × 64 × ${T} (stem 32 ⊕ dense1 16 ⊕ dense2 16)`, outShape: `B × 80 × ${T}`,
        params: P.norm(64) + P.conv1d(64, 16, 3), column: 5,
        detail: { 'block output': '80 = 32 stem + 16 + 16 + 16 — every layer\'s output is kept, none is replaced' },
      },
      {
        id: 'transition', kind: 'conv', label: 'Transition', sublabel: '1×1 conv 80 → 40 (compression 0.5)',
        inShape: `B × 80 × ${T}`, outShape: `B × 40 × ${T}`, params: P.conv1d(80, 40, 1), column: 6,
      },
      { id: 'pool_global', kind: 'pool', label: 'Global average pool', inShape: `B × 40 × ${T}`, outShape: 'B × 40', column: 7 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 40 → ${C}`, inShape: 'B × 40', outShape: `B × ${C}`, params: P.linear(40, C), column: 8 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 9 },
    ],
    edges: [
      ...chain('input', 'reshape', 'stem', 'dense1', 'dense2', 'dense3', 'transition', 'pool_global', 'head', 'output'),
      ['stem', 'dense2', 'context', 'concatenated feature reuse'],
      ['stem', 'dense3', 'context', 'concatenated feature reuse'],
      ['dense1', 'dense3', 'context', 'concatenated feature reuse'],
    ],
  }),

  'neural-network-architectures-convolutional-networks-residual-neural-network-resnet': blueprint({
    title: 'Residual Neural Network (ResNet)',
    subtitle: '3 residual stages · 64 → 128 → 256 channels',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'reshape', kind: 'reshape', label: 'Channels-first', sublabel: `${F} channels × ${T} steps`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${F} × ${T}`, column: 1,
      },
      {
        id: 'stem', kind: 'conv', label: 'Stem conv', sublabel: `${F} → 64 channels, kernel 7`,
        inShape: `B × ${F} × ${T}`, outShape: `B × 64 × ${T}`, params: P.conv1d(F, 64, 7), column: 2,
      },
      {
        id: 'res1_conv', kind: 'conv', label: 'Residual block 1 · F(x)', sublabel: '2× (conv3 + BN), 64 → 64',
        inShape: `B × 64 × ${T}`, outShape: `B × 64 × ${T}`, params: 2 * P.conv1d(64, 64, 3) + 2 * P.norm(64), column: 3,
        analogy: 'Think of it as a layer that is only allowed to propose a CORRECTION to the price read it was handed, never to throw that read away and start over.',
      },
      {
        id: 'res1_add', kind: 'fusion', label: 'Add shortcut', sublabel: 'y = x + F(x), identity — no projection needed',
        inShape: `B × 64 × ${T}`, outShape: `B × 64 × ${T}`, column: 4,
        analogy: 'Think of it as filing the correction on top of the original read, so the original survives untouched if the correction turns out to be worthless.',
      },
      {
        id: 'res2_conv', kind: 'conv', label: 'Residual block 2 · F(x)', sublabel: 'conv3 64 → 128 + BN, conv3 128 → 128 + BN',
        inShape: `B × 64 × ${T}`, outShape: `B × 128 × ${T}`,
        params: P.conv1d(64, 128, 3) + P.norm(128) + P.conv1d(128, 128, 3) + P.norm(128), column: 5,
      },
      {
        id: 'res2_proj', kind: 'conv', label: 'Projected shortcut', sublabel: '1×1 conv 64 → 128',
        inShape: `B × 64 × ${T}`, outShape: `B × 128 × ${T}`, params: P.conv1d(64, 128, 1), column: 5, lane: 1,
        analogy: 'Think of it as re-denominating the original read into the wider units this stage works in, so it can still be added back rather than dropped.',
      },
      {
        id: 'res2_add', kind: 'fusion', label: 'Add shortcut', sublabel: 'y = 1×1-conv(x) + F(x)',
        inShape: `B × 128 × ${T}`, outShape: `B × 128 × ${T}`, column: 6,
      },
      {
        id: 'res3_conv', kind: 'conv', label: 'Residual block 3 · F(x)', sublabel: 'conv3 128 → 256 + BN, conv3 256 → 256 + BN',
        inShape: `B × 128 × ${T}`, outShape: `B × 256 × ${T}`,
        params: P.conv1d(128, 256, 3) + P.norm(256) + P.conv1d(256, 256, 3) + P.norm(256), column: 7,
      },
      {
        id: 'res3_proj', kind: 'conv', label: 'Projected shortcut', sublabel: '1×1 conv 128 → 256',
        inShape: `B × 128 × ${T}`, outShape: `B × 256 × ${T}`, params: P.conv1d(128, 256, 1), column: 7, lane: 1,
      },
      {
        id: 'res3_add', kind: 'fusion', label: 'Add shortcut', sublabel: 'y = 1×1-conv(x) + F(x)',
        inShape: `B × 256 × ${T}`, outShape: `B × 256 × ${T}`, column: 8,
      },
      { id: 'pool_global', kind: 'pool', label: 'Global average pool', inShape: `B × 256 × ${T}`, outShape: 'B × 256', column: 9 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 256 → ${C}`, inShape: 'B × 256', outShape: `B × ${C}`, params: P.linear(256, C), column: 10 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 11 },
    ],
    edges: [
      ...chain('input', 'reshape', 'stem', 'res1_conv', 'res1_add'),
      ['stem', 'res1_add', 'residual', 'identity shortcut, x carried around F(x)'],
      ['res1_add', 'res2_conv', 'flow'],
      ['res1_add', 'res2_proj', 'flow'],
      ['res2_conv', 'res2_add', 'flow'],
      ['res2_proj', 'res2_add', 'residual', 'projected shortcut — channels change'],
      ['res2_add', 'res3_conv', 'flow'],
      ['res2_add', 'res3_proj', 'flow'],
      ['res3_conv', 'res3_add', 'flow'],
      ['res3_proj', 'res3_add', 'residual', 'projected shortcut — channels change'],
      ...chain('res3_add', 'pool_global', 'head', 'output'),
    ],
  }),

  'neural-network-architectures-convolutional-networks-u-net': blueprint({
    title: 'U-Net',
    subtitle: 'per-bar labelling · 2 down / 2 up stages with skip connections',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
        outShape: `B × ${T} × ${F}`, column: 0,
      },
      {
        id: 'reshape', kind: 'reshape', label: 'Channels-first', sublabel: `${F} channels × ${T} steps`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${F} × ${T}`, column: 1,
      },
      {
        id: 'enc1', kind: 'conv', label: 'Encoder block 1', sublabel: `${F} → 32ch, 2× conv3 (B × 32 × 64) then pool2`,
        inShape: `B × ${F} × ${T}`, outShape: 'B × 32 × 32',
        params: P.conv1d(F, 32, 3) + P.norm(32) + P.conv1d(32, 32, 3) + P.norm(32), column: 2,
        detail: { 'skip tapped at': 'B × 32 × 64 — the pre-pool activations, not the pooled output' },
      },
      {
        id: 'enc2', kind: 'conv', label: 'Encoder block 2', sublabel: '32 → 64ch, 2× conv3 (B × 64 × 32) then pool2',
        inShape: 'B × 32 × 32', outShape: 'B × 64 × 16',
        params: P.conv1d(32, 64, 3) + P.norm(64) + P.conv1d(64, 64, 3) + P.norm(64), column: 3,
        detail: { 'skip tapped at': 'B × 64 × 32 — the pre-pool activations, not the pooled output' },
      },
      {
        id: 'bottleneck', kind: 'conv', label: 'Bottleneck', sublabel: '64 → 128ch, 2× conv3, no pooling',
        inShape: 'B × 64 × 16', outShape: 'B × 128 × 16',
        params: P.conv1d(64, 128, 3) + P.norm(128) + P.conv1d(128, 128, 3) + P.norm(128), column: 4,
        analogy: 'Think of it as the point where the model has compressed the whole 64-bar window down to its coarsest read of "what regime is this" before it starts zooming back in per bar.',
      },
      {
        id: 'dec2', kind: 'conv', label: 'Decoder block 2', sublabel: 'upsample 16→32 + concat enc2 (192ch) → 64ch',
        inShape: 'B × 192 × 32 (128 upsampled ⊕ 64 skip)', outShape: 'B × 64 × 32',
        params: P.conv1d(128 + 64, 64, 3) + P.norm(64) + P.conv1d(64, 64, 3) + P.norm(64), column: 5,
      },
      {
        id: 'dec1', kind: 'conv', label: 'Decoder block 1', sublabel: 'upsample 32→64 + concat enc1 (96ch) → 32ch',
        inShape: 'B × 96 × 64 (64 upsampled ⊕ 32 skip)', outShape: 'B × 32 × 64',
        params: P.conv1d(64 + 32, 32, 3) + P.norm(32) + P.conv1d(32, 32, 3) + P.norm(32), column: 6,
        analogy: 'Think of it as the model refusing to hand back a per-bar answer without re-checking it against the fine-grained candle shapes it saw on the way in, not just the compressed summary.',
      },
      {
        id: 'head', kind: 'head', label: 'Per-bar classifier', sublabel: `1×1 conv, 32 → ${C} classes per bar`,
        inShape: `B × 32 × ${T}`, outShape: `B × ${C} × ${T}`, params: P.conv1d(32, C, 1), column: 7,
      },
      { id: 'output', kind: 'output', label: 'Per-bar zone label', sublabel: 'support / resistance / neutral, one per bar', outShape: `B × ${T} × ${C}`, column: 8 },
    ],
    edges: [
      ...chain('input', 'reshape', 'enc1', 'enc2', 'bottleneck', 'dec2', 'dec1', 'head', 'output'),
      ['enc1', 'dec1', 'context', 'skip: concat 32ch pre-pool features (B × 32 × 64)'],
      ['enc2', 'dec2', 'context', 'skip: concat 64ch pre-pool features (B × 64 × 32)'],
    ],
  }),

  // ── Feedforward & MLPs ────────────────────────────────────────────────────

  'neural-network-architectures-feedforward-mlps-feedforward-neural-network-fnn': blueprint({
    title: 'Feedforward Neural Network (FNN)',
    subtitle: 'flattened 64-bar window · 3 dense layers',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'flatten', kind: 'reshape', label: 'Flatten window', sublabel: `${T} × ${F} → ${T * F}`, outShape: `B × ${T * F}`, column: 1,
        analogy: 'Think of it as laying all 64 candles end to end into one long row of numbers — the network no longer knows which number came from which bar, only the values themselves.',
      },
      { id: 'fc1', kind: 'linear', label: 'Dense 1', sublabel: `Linear ${T * F} → 256`, outShape: 'B × 256', params: P.linear(T * F, 256), column: 2 },
      { id: 'fc2', kind: 'linear', label: 'Dense 2', sublabel: 'Linear 256 → 128', outShape: 'B × 128', params: P.linear(256, 128), column: 3 },
      { id: 'drop', kind: 'dropout', label: 'Dropout', sublabel: 'p = 0.2', outShape: 'B × 128', column: 4 },
      { id: 'fc3', kind: 'linear', label: 'Dense 3', sublabel: 'Linear 128 → 64', outShape: 'B × 64', params: P.linear(128, 64), column: 5 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`, outShape: `B × ${C}`, params: P.linear(64, C), column: 6 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 7 },
    ],
    edges: chain('input', 'flatten', 'fc1', 'fc2', 'drop', 'fc3', 'head', 'output'),
  }),

  'neural-network-architectures-feedforward-mlps-multilayer-perceptron-mlp': blueprint({
    title: 'Multilayer Perceptron (MLP)',
    subtitle: 'latest bar only, no window · 3 dense layers',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Latest bar', sublabel: `1 bar × ${F} features (not the window)`,
        outShape: `B × ${F}`, column: 0,
        analogy: 'Think of it as a trader who looks at only the current candle\'s stats — no chart history — and has to judge the market from that snapshot alone.',
      },
      { id: 'fc1', kind: 'linear', label: 'Dense 1', sublabel: `Linear ${F} → 64`, outShape: 'B × 64', params: P.linear(F, 64), column: 1 },
      { id: 'fc2', kind: 'linear', label: 'Dense 2', sublabel: 'Linear 64 → 32', outShape: 'B × 32', params: P.linear(64, 32), column: 2 },
      { id: 'fc3', kind: 'linear', label: 'Dense 3', sublabel: 'Linear 32 → 16', outShape: 'B × 16', params: P.linear(32, 16), column: 3 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 16 → ${C}`, outShape: `B × ${C}`, params: P.linear(16, C), column: 4 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5 },
    ],
    edges: chain('input', 'fc1', 'fc2', 'fc3', 'head', 'output'),
  }),

  // ── Generative & Latent Models ────────────────────────────────────────────

  'neural-network-architectures-generative-latent-models-autoencoder-ae': blueprint({
    title: 'Autoencoder (AE)',
    subtitle: 'reconstruction-based anomaly score · latent dim 16',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'flatten', kind: 'reshape', label: 'Flatten window', sublabel: `${T} × ${F} → ${T * F}`, outShape: `B × ${T * F}`, column: 1 },
      { id: 'enc1', kind: 'linear', label: 'Encoder', sublabel: `Linear ${T * F} → 128`, outShape: 'B × 128', params: P.linear(T * F, 128), column: 2 },
      {
        id: 'latent', kind: 'linear', label: 'Latent bottleneck z', sublabel: 'Linear 128 → 16', outShape: 'B × 16',
        params: P.linear(128, 16), column: 3,
        analogy: 'Think of it as forcing the whole 64-bar window through a keyhole only 16 numbers wide — only the market\'s most essential shape survives the squeeze.',
      },
      { id: 'dec1', kind: 'linear', label: 'Decoder', sublabel: 'Linear 16 → 128', outShape: 'B × 128', params: P.linear(16, 128), column: 4 },
      { id: 'recon', kind: 'linear', label: 'Reconstruction', sublabel: `Linear 128 → ${T * F}`, outShape: `B × ${T * F}`, params: P.linear(128, T * F), column: 5 },
      {
        id: 'compare', kind: 'compare', label: 'Reconstruction error', sublabel: 'MSE(input, reconstruction)',
        outShape: 'B × 1', column: 6,
        analogy: 'Think of it as measuring how much of the window got LOST going through that keyhole — a window that reconstructs cleanly looks like ones the model has seen before; one that doesn\'t is the anomaly.',
      },
      { id: 'output', kind: 'output', label: 'Anomaly score', sublabel: 'higher = more unfamiliar window', outShape: 'B × 1', column: 7 },
    ],
    edges: [
      ...chain('input', 'flatten', 'enc1', 'latent', 'dec1', 'recon'),
      ['recon', 'compare', 'flow'],
      ['flatten', 'compare', 'context', 'compared against the original window'],
      ['compare', 'output', 'flow'],
    ],
  }),

  'neural-network-architectures-generative-latent-models-neural-ordinary-differential-equation-neural-ode': blueprint({
    title: 'Neural Ordinary Differential Equation (Neural ODE)',
    subtitle: 'continuous-time hidden state · RK4 solver',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'first_bar', kind: 'reshape', label: 'Initial observation x(t₀)', sublabel: 'the window\'s first bar — the rest supply the times to integrate to',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${F}`, column: 1,
        analogy: 'Think of it as marking where the market stood when the window opened, then letting the model work out the path from there rather than reading each candle in turn.',
      },
      {
        id: 'encoder', kind: 'linear', label: 'Initial state encoder', sublabel: `Linear ${F} → 64, gives h(t₀)`,
        inShape: `B × ${F}`, outShape: 'B × 64', params: P.linear(F, 64), column: 2,
      },
      {
        id: 'odefunc', kind: 'recurrent', label: 'Dynamics function f(h, t)', sublabel: '2-layer MLP on [h ; t], returns dh/dt not h',
        inShape: 'B × 65 ([h 64 ; t 1])', outShape: 'B × 64', params: P.linear(64 + 1, 64) + P.linear(64, 64), column: 3,
        detail: { input: '64 state values plus the scalar time t', returns: 'dh/dt, the same width as h' },
        analogy: 'Think of it as a rule for HOW the market state drifts moment to moment, rather than a rule for what the state IS at each bar — the solver applies this rule over and over between bars.',
      },
      {
        id: 'solver', kind: 'memory', label: 'ODE solver (RK4)', sublabel: 'integrates h(t₀) → h(t₆₄) in fixed RK4 steps, 4 evaluations of f per step',
        inShape: 'B × 64', outShape: 'B × 64', column: 4,
        analogy: 'Think of it as replaying the dynamics function in tiny increments to trace out a smooth path between bars, instead of jumping straight from one bar\'s state to the next.',
      },
      { id: 'decoder', kind: 'linear', label: 'Readout projection', sublabel: 'Linear 64 → 64', inShape: 'B × 64', outShape: 'B × 64', params: P.linear(64, 64), column: 5 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`, inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 6 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 7 },
    ],
    edges: [
      ...chain('input', 'first_bar', 'encoder', 'odefunc', 'solver', 'decoder', 'head', 'output'),
      ['solver', 'odefunc', 'context', 're-evaluates f at every solver step'],
    ],
  }),

  'neural-network-architectures-generative-latent-models-variational-autoencoder-vae': blueprint({
    title: 'Variational Autoencoder (VAE)',
    subtitle: 'probabilistic latent space · latent dim 16',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'flatten', kind: 'reshape', label: 'Flatten window', sublabel: `${T} × ${F} → ${T * F}`, outShape: `B × ${T * F}`, column: 1 },
      { id: 'enc', kind: 'linear', label: 'Encoder trunk', sublabel: `Linear ${T * F} → 128`, outShape: 'B × 128', params: P.linear(T * F, 128), column: 2 },
      { id: 'mu', kind: 'linear', label: 'Latent mean μ', sublabel: 'Linear 128 → 16', outShape: 'B × 16', params: P.linear(128, 16), column: 3 },
      { id: 'logvar', kind: 'linear', label: 'Latent log-variance', sublabel: 'Linear 128 → 16', outShape: 'B × 16', params: P.linear(128, 16), column: 3, lane: 1 },
      {
        id: 'sample', kind: 'stochastic', label: 'Reparameterised sample', sublabel: 'z = μ + ε·σ, ε ~ N(0,1)',
        outShape: 'B × 16', column: 4,
        analogy: 'Think of it as the model not just picking one "most likely" market state, but drawing from a cloud of plausible states around its best guess — every forward pass sees a slightly different draw.',
      },
      { id: 'dec1', kind: 'linear', label: 'Decoder', sublabel: 'Linear 16 → 128', outShape: 'B × 128', params: P.linear(16, 128), column: 5 },
      { id: 'recon', kind: 'linear', label: 'Reconstruction', sublabel: `Linear 128 → ${T * F}`, outShape: `B × ${T * F}`, params: P.linear(128, T * F), column: 6 },
      {
        id: 'compare', kind: 'compare', label: 'ELBO', sublabel: 'reconstruction error + KL(q(z|x) ‖ N(0,1))',
        outShape: 'B × 1', column: 7,
        analogy: 'Think of it as two competing pressures: reproduce the window faithfully, but also keep the latent cloud close to a plain bell curve so new market states can be GENERATED by sampling, not just memorised.',
      },
      { id: 'output', kind: 'output', label: 'Reconstruction / generated window', outShape: `B × ${T * F}`, column: 8 },
    ],
    edges: [
      ...chain('input', 'flatten', 'enc'),
      ['enc', 'mu', 'flow'],
      ['enc', 'logvar', 'flow'],
      ['mu', 'sample', 'flow'],
      ['logvar', 'sample', 'flow'],
      ...chain('sample', 'dec1', 'recon'),
      ['recon', 'compare', 'flow'],
      ['flatten', 'compare', 'context', 'compared against the original window'],
      ['compare', 'output', 'flow'],
    ],
  }),

  // ── Graph Neural Networks ─────────────────────────────────────────────────

  'neural-network-architectures-graph-neural-networks-graph-attention-network-gat': blueprint({
    title: 'Graph Attention Network (GAT)',
    subtitle: 'bars as nodes · 4-head then 1-head attention layer',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window as graph nodes', sublabel: `${T} nodes × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'adjacency', kind: 'memory', label: 'Neighbour graph', sublabel: 'k-nearest bars by feature similarity, fixed per window',
        outShape: `${T} × ${T} sparse`, column: 0, lane: 1,
        analogy: 'Think of it as drawing lines between bars that LOOK alike, even if they are far apart in time — bar 2 can be a neighbour of bar 50 if both are sharp rejection wicks.',
      },
      {
        id: 'gat1', kind: 'attention', label: 'GAT layer 1', sublabel: '4 heads · 16-dim each',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × 64`, params: 4 * (P.linear(F, 16, false) + P.linear(2 * 16, 1, false)), column: 1,
        analogy: 'Think of it as each bar listening only to its declared neighbours, and — unlike plain self-attention — deciding by how much to trust each one, not just averaging them.',
      },
      { id: 'gat2', kind: 'attention', label: 'GAT layer 2', sublabel: '1 head · 64-dim', inShape: `B × ${T} × 64`, outShape: `B × ${T} × 64`, params: P.linear(64, 64, false) + P.linear(128, 1, false), column: 2 },
      { id: 'pool', kind: 'pool', label: 'Graph readout', sublabel: `mean over the ${T} nodes`, inShape: `B × ${T} × 64`, outShape: 'B × 64', column: 3 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`, inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 4 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5 },
    ],
    edges: [
      ['input', 'gat1', 'flow'],
      ['adjacency', 'gat1', 'context', 'which bar-pairs may attend'],
      ['adjacency', 'gat2', 'context', 'which bar-pairs may attend'],
      ...chain('gat1', 'gat2', 'pool', 'head', 'output'),
    ],
  }),

  'neural-network-architectures-graph-neural-networks-graph-convolutional-network-gcn': blueprint({
    title: 'Graph Convolutional Network (GCN)',
    subtitle: 'bars as nodes · normalised-adjacency convolution, 2 layers',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window as graph nodes', sublabel: `${T} nodes × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'adjacency', kind: 'memory', label: 'Normalised adjacency', sublabel: 'D^-1/2 (A+I) D^-1/2, fixed, no parameters',
        outShape: `${T} × ${T}`, column: 0, lane: 1,
        analogy: 'Think of it as a fixed rulebook for how much each bar\'s reading should bleed into its neighbours\' — unlike GAT, no attention decides this per-input, it is the same rulebook every time.',
      },
      { id: 'gcn1', kind: 'conv', label: 'GCN layer 1', sublabel: `ÂXW · Linear ${F} → 64, no bias`, inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × 64`, params: P.linear(F, 64, false), column: 1 },
      { id: 'gcn2', kind: 'conv', label: 'GCN layer 2', sublabel: 'ÂXW · Linear 64 → 64, no bias', inShape: `B × ${T} × 64`, outShape: `B × ${T} × 64`, params: P.linear(64, 64, false), column: 2 },
      { id: 'pool', kind: 'pool', label: 'Graph readout', sublabel: `mean over the ${T} nodes`, inShape: `B × ${T} × 64`, outShape: 'B × 64', column: 3 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`, inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 4 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5 },
    ],
    edges: [
      ['input', 'gcn1', 'flow'],
      ['adjacency', 'gcn1', 'context', 'normalised neighbour weighting'],
      ['adjacency', 'gcn2', 'context', 'normalised neighbour weighting'],
      ...chain('gcn1', 'gcn2', 'pool', 'head', 'output'),
    ],
  }),

  'neural-network-architectures-graph-neural-networks-graph-neural-network-gnn': blueprint({
    title: 'Graph Neural Network (GNN)',
    subtitle: 'bars as nodes · 3 rounds of message passing',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window as graph nodes', sublabel: `${T} nodes × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'adjacency', kind: 'memory', label: 'Neighbour graph', sublabel: 'fixed structural input, no parameters',
        outShape: `${T} × ${T} sparse`, column: 0, lane: 1,
      },
      {
        id: 'mp1', kind: 'conv', label: 'Message pass 1', sublabel: `mean-aggregate + Linear ${F} → 64`, inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × 64`, params: P.linear(F, 64), column: 1,
        analogy: 'Think of it as each bar collecting the average reading of its neighbours, then updating its own view in light of that — one round of "what is everyone near me seeing".',
      },
      { id: 'mp2', kind: 'conv', label: 'Message pass 2', sublabel: 'mean-aggregate + Linear 64 → 64', inShape: `B × ${T} × 64`, outShape: `B × ${T} × 64`, params: P.linear(64, 64), column: 2 },
      { id: 'mp3', kind: 'conv', label: 'Message pass 3', sublabel: 'mean-aggregate + Linear 64 → 64', inShape: `B × ${T} × 64`, outShape: `B × ${T} × 64`, params: P.linear(64, 64), column: 3 },
      { id: 'readout', kind: 'pool', label: 'Graph readout', sublabel: `sum over the ${T} nodes`, inShape: `B × ${T} × 64`, outShape: 'B × 64', column: 4 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`, inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 5 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 6 },
    ],
    edges: [
      ['input', 'mp1', 'flow'],
      ['adjacency', 'mp1', 'context', 'neighbours to aggregate'],
      ['adjacency', 'mp2', 'context', 'neighbours to aggregate'],
      ['adjacency', 'mp3', 'context', 'neighbours to aggregate'],
      ...chain('mp1', 'mp2', 'mp3', 'readout', 'head', 'output'),
    ],
  }),

  // ── Memory & Routing Architectures ────────────────────────────────────────

  'neural-network-architectures-memory-routing-architectures-hypernetwork': blueprint({
    title: 'Hypernetwork',
    subtitle: 'context-conditioned weight generation for a Linear(35→64) target',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'context', kind: 'input', label: 'Regime context', sublabel: '8 features, e.g. realised volatility, session, trend strength',
        outShape: 'B × 8', column: 0, lane: 1,
      },
      {
        id: 'hyper_net', kind: 'linear', label: 'Hypernetwork', sublabel: 'MLP: context → target-network weights',
        inShape: 'B × 8', outShape: `B × ${F * D + D}`, params: P.linear(8, 32) + P.linear(32, F * D + D), column: 1,
        detail: { output: `${F * D + D} = weights + bias of the target's Linear(${F} → ${D})`, note: 'this network never sees the price window' },
        analogy: 'Think of it as a head trader who, before the session starts, writes today\'s rulebook based on the overnight volatility regime — a different rulebook for a calm Tuesday than for an NFP morning.',
      },
      {
        id: 'target_net', kind: 'linear', label: 'Target network', sublabel: `Linear ${F} → ${D} per bar, weights supplied per-input`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${D}`, column: 2,
        detail: { weights: `${F * D + D} values generated by the hypernetwork, NOT stored as learned parameters of this node` },
        analogy: 'Think of it as the junior trader who follows whatever rulebook was handed to them, never writing their own — swap the context and this exact same node behaves like a different model.',
      },
      { id: 'pool', kind: 'pool', label: 'Mean pool', sublabel: `average over the ${T} bars`, inShape: `B × ${T} × ${D}`, outShape: `B × ${D}`, column: 3 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${D} → ${C}, static`, inShape: `B × ${D}`, outShape: `B × ${C}`, params: P.linear(D, C), column: 4 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 5 },
    ],
    edges: [
      ['input', 'target_net', 'flow', 'processed with generated weights'],
      ['context', 'hyper_net', 'flow'],
      ['hyper_net', 'target_net', 'context', 'W = h(context), injected not learned'],
      ['target_net', 'pool', 'flow'],
      ['pool', 'head', 'flow'],
      ['head', 'output', 'flow'],
    ],
  }),

  'neural-network-architectures-memory-routing-architectures-mixture-of-experts': blueprint({
    title: 'Mixture of Experts (MoE)',
    subtitle: '4 experts · dense gating (no top-k sparsity shown)',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'flatten', kind: 'reshape', label: 'Flatten window', sublabel: `${T} × ${F} → ${T * F}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T * F}`, column: 1,
      },
      {
        id: 'gate', kind: 'gate', label: 'Gating network', sublabel: `Linear ${T * F} → 4, softmax`,
        inShape: `B × ${T * F}`, outShape: 'B × 4', params: P.linear(T * F, 4), column: 2,
        analogy: 'Think of it as a dispatcher who looks at the current window and decides which specialist desk — trend, range, breakout, reversal — should handle it, and by how much.',
      },
      { id: 'expert1', kind: 'linear', label: 'Expert 1', sublabel: `Linear ${T * F} → 64`, inShape: `B × ${T * F}`, outShape: 'B × 64', params: P.linear(T * F, 64), column: 3, lane: 0 },
      { id: 'expert2', kind: 'linear', label: 'Expert 2', sublabel: `Linear ${T * F} → 64`, inShape: `B × ${T * F}`, outShape: 'B × 64', params: P.linear(T * F, 64), column: 3, lane: 1 },
      { id: 'expert3', kind: 'linear', label: 'Expert 3', sublabel: `Linear ${T * F} → 64`, inShape: `B × ${T * F}`, outShape: 'B × 64', params: P.linear(T * F, 64), column: 3, lane: 2 },
      { id: 'expert4', kind: 'linear', label: 'Expert 4', sublabel: `Linear ${T * F} → 64`, inShape: `B × ${T * F}`, outShape: 'B × 64', params: P.linear(T * F, 64), column: 3, lane: 3 },
      {
        id: 'combine', kind: 'fusion', label: 'Weighted combine', sublabel: 'Σ gate_i · expert_i(x)', inShape: 'B × 64 per expert', outShape: 'B × 64', column: 4,
        analogy: 'Think of it as blending all 4 desks\' opinions, weighted by how much the dispatcher trusted each one for this particular window.',
      },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`, inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 5 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 6 },
    ],
    edges: [
      ['input', 'flatten', 'flow'],
      ['flatten', 'gate', 'flow'],
      ['flatten', 'expert1', 'flow'],
      ['flatten', 'expert2', 'flow'],
      ['flatten', 'expert3', 'flow'],
      ['flatten', 'expert4', 'flow'],
      ['gate', 'combine', 'context', 'mixing weights'],
      ['expert1', 'combine', 'flow'],
      ['expert2', 'combine', 'flow'],
      ['expert3', 'combine', 'flow'],
      ['expert4', 'combine', 'flow'],
      ['combine', 'head', 'flow'],
      ['head', 'output', 'flow'],
    ],
  }),

  'neural-network-architectures-memory-routing-architectures-neural-turing-machine': blueprint({
    title: 'Neural Turing Machine',
    subtitle: '32 slots × 20-wide memory · LSTM controller',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'controller', kind: 'recurrent', label: 'LSTM controller', sublabel: 'reads [bar, previous read vector] each step',
        outShape: 'B × 64', params: P.lstm(F + 20, 64), column: 1,
        analogy: 'Think of it as the trader\'s working attention: it reads the current bar plus whatever it just pulled from memory, and decides what to do next.',
      },
      {
        id: 'head_params', kind: 'linear', label: 'Head parameters', sublabel: 'key, strength, gate, shift, sharpen, erase, add',
        outShape: 'B × 66', params: P.linear(64, 3 * 20 + 6), column: 2,
      },
      {
        id: 'addressing', kind: 'attention', label: 'Content + location addressing', sublabel: 'cosine similarity → interpolate → shift → sharpen',
        outShape: 'B × 32', column: 3,
        analogy: 'Think of it as flipping through the notebook for the page that looks most like today\'s setup, by CONTENT — not by "the page from 40 bars ago", but by "the page that looked like this".',
      },
      {
        id: 'memory', kind: 'memory', label: 'Memory matrix', sublabel: '32 slots × 20 values',
        outShape: '32 × 20', column: 3, lane: 1,
        detail: { slots: '32 × 20 = 640 values, external STATE carried across the window — not a learned weight matrix' },
        analogy: 'Think of it as the trader\'s notebook of structural levels — last week\'s swing high, the opening-range width — held separately from working attention so it survives hundreds of bars undiluted.',
      },
      { id: 'read_write', kind: 'gate', label: 'Read / erase-add write', sublabel: 'r_t = Σ w·M · M ← M⊙(1-w·e) + w·a', outShape: 'B × 20', column: 4 },
      { id: 'head_out', kind: 'head', label: 'Output projection', sublabel: `Linear (64+20) → ${C}, [controller ; read]`, outShape: `B × ${C}`, params: P.linear(64 + 20, C), column: 5 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 6 },
    ],
    edges: [
      ...chain('input', 'controller', 'head_params', 'addressing'),
      ['memory', 'addressing', 'context', 'cosine similarity against current contents'],
      ['addressing', 'read_write', 'flow'],
      ['memory', 'read_write', 'context', 'read / write target'],
      ['read_write', 'memory', 'context', 'erase + add update'],
      ['read_write', 'controller', 'context', 'read vector feeds next step'],
      ['controller', 'head_out', 'flow'],
      ['read_write', 'head_out', 'flow'],
      ['head_out', 'output', 'flow'],
    ],
  }),

  // ── Recurrent & Sequential Models (excl. LSTM, which lives in recurrent.ts) ─

  'neural-network-architectures-recurrent-sequential-models-attention-based-rnn': blueprint({
    title: 'Attention-Based RNN',
    subtitle: `GRU encoder, ${H} units · attention over all ${T} states`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'encoder', kind: 'recurrent', label: 'GRU encoder', sublabel: `${H} units, states h_1 … h_${T}`,
        outShape: `B × ${T} × ${H}`, params: P.gru(F, H), column: 1,
        analogy: 'Think of it as a trader reading bar by bar and keeping a running notepad — but unlike a plain RNN, nothing forces the final verdict to rely only on the LAST page of that notepad.',
      },
      {
        id: 'align', kind: 'attention', label: 'Alignment scores', sublabel: `scaled bilinear e_i = qᵀ W_a h_i / √${H}, q = h_${T}`,
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T}`, params: P.linear(H, H, false), column: 2,
        detail: { 'learned part': `W_a, one ${H} × ${H} matrix with no bias — the scaling and the softmax have nothing to learn` },
        analogy: 'Think of it as the model pointing back at whichever earlier bar — the session high that got rejected, the volume spike that started the move — actually mattered for this call.',
      },
      {
        id: 'context_vec', kind: 'fusion', label: 'Context vector', sublabel: 'softmax-weighted sum of all encoder states',
        inShape: `B × ${T} weights · B × ${T} × ${H} states`, outShape: `B × ${H}`, column: 3,
      },
      {
        id: 'out_proj', kind: 'linear', label: 'Output projection', sublabel: `Linear ${2 * H} → ${H} on [context ; query]`,
        inShape: `B × ${2 * H}`, outShape: `B × ${H}`, params: P.linear(2 * H, H), column: 4,
      },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${H} → ${C}`, inShape: `B × ${H}`, outShape: `B × ${C}`, params: P.linear(H, C), column: 5 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 6 },
    ],
    edges: [
      ...chain('input', 'encoder', 'align', 'context_vec', 'out_proj', 'head', 'output'),
      ['encoder', 'context_vec', 'context', `weighted sum over all ${T} encoder states`],
      ['encoder', 'out_proj', 'context', `query h_${T} concatenated with the context vector`],
    ],
  }),

  'neural-network-architectures-recurrent-sequential-models-gated-recurrent-unit-gru': blueprint({
    title: 'Gated Recurrent Unit (GRU)',
    subtitle: `2 stacked layers · ${H} hidden units · ${T}-bar window`,
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
        outShape: `B × ${T} × ${F}`, column: 0,
      },
      {
        id: 'gru1', kind: 'recurrent', label: 'GRU layer 1', sublabel: `${H} units · update + reset gates`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${H}`, params: P.gru(F, H), column: 1,
        detail: { 'update / reset': '2 gates (no separate output gate, no cell state)', 'hidden units': H, formula: '3·H·(F + H + 2)' },
        analogy: 'Think of it as the same notepad-reading trader as an LSTM, but who merges "what to forget" and "what to write" into a single decision — one update gate instead of two — which is cheaper and, on noisy price data, often generalises just as well.',
      },
      {
        id: 'hidden_state', kind: 'memory', label: 'Carried hidden state', sublabel: 'single vector, no separate cell state',
        outShape: `B × ${H}`, column: 1, lane: 1,
        analogy: 'Think of it as the WHOLE notepad, unlike LSTM which keeps a separate long-term ledger — GRU writes everything, including long-term memory, onto the one page it carries forward.',
      },
      { id: 'drop', kind: 'dropout', label: 'Dropout', sublabel: 'between layers, p = 0.2', inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, column: 2 },
      {
        id: 'gru2', kind: 'recurrent', label: 'GRU layer 2', sublabel: `${H} units · update + reset gates`,
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, params: P.gru(H, H), column: 3,
        detail: { 'hidden units': H, formula: '3·H·(H + H + 2)' },
      },
      { id: 'last', kind: 'pool', label: 'Last hidden state', sublabel: 'h at the final bar', inShape: `B × ${T} × ${H}`, outShape: `B × ${H}`, column: 4 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${H} → ${C}`, inShape: `B × ${H}`, outShape: `B × ${C}`, params: P.linear(H, C), column: 5 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', sublabel: 'softmax probabilities', outShape: `B × ${C}`, column: 6 },
    ],
    edges: [
      ...chain('input', 'gru1', 'drop', 'gru2', 'last', 'head', 'output'),
      ['gru1', 'hidden_state', 'context', 'write'],
      ['hidden_state', 'gru1', 'context', 'read at next bar'],
    ],
  }),

  'neural-network-architectures-recurrent-sequential-models-recurrent-neural-network-rnn': blueprint({
    title: 'Recurrent Neural Network (RNN)',
    subtitle: `2 stacked layers · ${H} hidden units · ${T}-bar window, the baseline before LSTM/GRU`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'rnn1', kind: 'recurrent', label: 'RNN layer 1', sublabel: `${H} units · h_t = tanh(W_xh x_t + W_hh h_(t-1))`,
        outShape: `B × ${T} × ${H}`, params: P.rnn(F, H), column: 1,
        detail: { formula: 'H·(F + H + 2)', limitation: 'gradient scales with the product of W_hh across all 64 steps — vanishes or explodes without gates' },
        analogy: 'Think of it as the plain, ungated version of the LSTM\'s notepad trader: every new bar overwrites the running summary directly, with no gate deciding what to keep — cheap, but it forgets distant bars fast.',
      },
      { id: 'drop', kind: 'dropout', label: 'Dropout', sublabel: 'between layers, p = 0.2', outShape: `B × ${T} × ${H}`, column: 2 },
      { id: 'rnn2', kind: 'recurrent', label: 'RNN layer 2', sublabel: `${H} units`, outShape: `B × ${T} × ${H}`, params: P.rnn(H, H), column: 3 },
      { id: 'last', kind: 'pool', label: 'Last hidden state', sublabel: 'h at the final bar', outShape: `B × ${H}`, column: 4 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${H} → ${C}`, outShape: `B × ${C}`, params: P.linear(H, C), column: 5 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 6 },
    ],
    edges: chain('input', 'rnn1', 'drop', 'rnn2', 'last', 'head', 'output'),
  }),

  // ── Specialized & Modular Networks ────────────────────────────────────────

  'neural-network-architectures-specialized-modular-networks-capsule-network': blueprint({
    title: 'Capsule Network',
    subtitle: '32 primary capsules (dim 8) → 3 class capsules (dim 16), 3 routing iterations',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'reshape', kind: 'reshape', label: 'Channels-first', sublabel: `${F} channels × ${T} steps`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${F} × ${T}`, column: 1,
      },
      {
        id: 'conv_stem', kind: 'conv', label: 'Conv stem', sublabel: `${F} → 256 channels, kernel 9`,
        inShape: `B × ${F} × ${T}`, outShape: `B × 256 × ${T}`, params: P.conv1d(F, 256, 9), column: 2,
      },
      {
        id: 'primary_caps', kind: 'conv', label: 'Primary capsules', sublabel: 'conv 256 → 256, reshaped to 32 capsules × 8-dim, squashed',
        inShape: `B × 256 × ${T}`, outShape: 'B × 32 × 8', params: P.conv1d(256, 256, 9), column: 3,
        analogy: 'Think of it as 32 little detectors, each outputting not just "I fired" but a small vector — its length says how confident it is that its motif (a rejection wick, a squeeze) is present, its direction encodes the motif\'s exact pose.',
      },
      {
        id: 'routing_transform', kind: 'linear', label: 'Pose transform', sublabel: `one learned W_ij (16 × 8) for each of the 32 × ${C} capsule pairs`,
        inShape: 'B × 32 × 8', outShape: `B × 32 × ${C} × 16`, params: 32 * C * P.linear(8, 16, false), column: 4,
        detail: { count: `32 × ${C} × 16 × 8 — a separate part-to-whole matrix per pair, never one shared projection` },
      },
      {
        id: 'routing_iterate', kind: 'attention', label: 'Routing by agreement', sublabel: '3 iterations of softmax + weighted sum + squash — no learned weights',
        inShape: `B × 32 × ${C} × 16`, outShape: `B × ${C} × 16`, column: 5,
        detail: { 'coupling coefficients': 'c_ij is computed at inference by iterated agreement, not learned by gradient descent' },
        analogy: 'Think of it as each of the 32 detectors voting for which higher-level "setup" it belongs to, and votes that AGREE with each other get amplified over 3 rounds — unlike max-pooling, no vote is thrown away, only reweighted.',
      },
      { id: 'output', kind: 'output', label: 'Class capsules', sublabel: 'norm = presence probability per class', outShape: `B × ${C} × 16`, column: 6 },
    ],
    edges: chain('input', 'reshape', 'conv_stem', 'primary_caps', 'routing_transform', 'routing_iterate', 'output'),
  }),

  'neural-network-architectures-specialized-modular-networks-dual-pathway-network': blueprint({
    title: 'Dual-Pathway Network',
    subtitle: 'fast pathway (native 1-min bars) + slow pathway (8-bar resample), lateral fusion',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'fast_proj', kind: 'linear', label: 'Fast pathway projection', sublabel: `Linear ${F} → 16 per bar (thin, kept low-capacity), channels-first`,
        inShape: `B × ${T} × ${F}`, outShape: `B × 16 × ${T}`, params: P.linear(F, 16), column: 1,
      },
      {
        id: 'slow_pool', kind: 'pool', label: 'Slow pathway resample', sublabel: `8:1 average pool, ${T} → 8 bars`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${F} × 8`, column: 1, lane: 1,
        analogy: 'Think of it as stepping back from the 1-minute chart to an 8-minute chart of the SAME window, to see the trend a scalper\'s screen hides.',
      },
      { id: 'fast_enc', kind: 'conv', label: 'Fast encoder', sublabel: 'Conv1d 16 → 16, kernel 3 (reaction)', inShape: `B × 16 × ${T}`, outShape: `B × 16 × ${T}`, params: P.conv1d(16, 16, 3), column: 2 },
      {
        id: 'slow_enc', kind: 'conv', label: 'Slow encoder', sublabel: `Conv1d ${F} → 128, kernel 3 (context)`, inShape: `B × ${F} × 8`, outShape: 'B × 128 × 8',
        params: P.conv1d(F, 128, 3), column: 2, lane: 1,
        analogy: 'Think of it as a second, wider analyst reading the coarse chart for trend context, so the thin fast analyst beside them never has to do both jobs at once.',
      },
      { id: 'fast_pool', kind: 'pool', label: 'Fast global pool', sublabel: `mean over ${T} steps`, inShape: `B × 16 × ${T}`, outShape: 'B × 16', column: 3 },
      {
        id: 'lateral', kind: 'fusion', label: 'Lateral fusion', sublabel: `fast resampled ${T}→8, projected 16 → 128 & added into slow`,
        inShape: 'B × 128 × 8', outShape: 'B × 128 × 8', params: P.linear(16, 128, false), column: 3, lane: 1,
        analogy: 'Think of it as the fast analyst occasionally leaning over to tell the slow analyst "something just spiked" — a cross-talk channel, not a full merge, and only in this one direction.',
      },
      { id: 'slow_global', kind: 'pool', label: 'Slow global pool', sublabel: 'mean over the 8 coarse steps', inShape: 'B × 128 × 8', outShape: 'B × 128', column: 4, lane: 1 },
      { id: 'fuse_head', kind: 'fusion', label: 'Concat pooled branches', sublabel: '[slow 128 ; fast 16] → 144', inShape: 'B × 128 + B × 16', outShape: 'B × 144', column: 5 },
      { id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 144 → ${C}`, inShape: 'B × 144', outShape: `B × ${C}`, params: P.linear(16 + 128, C), column: 6 },
      { id: 'output', kind: 'output', label: 'Down · flat · up', outShape: `B × ${C}`, column: 7 },
    ],
    edges: [
      ['input', 'fast_proj', 'flow'],
      ['input', 'slow_pool', 'flow'],
      ['fast_proj', 'fast_enc', 'flow'],
      ['slow_pool', 'slow_enc', 'flow'],
      ['fast_enc', 'lateral', 'context', 'resampled fast features injected into slow'],
      ['slow_enc', 'lateral', 'flow'],
      ['fast_enc', 'fast_pool', 'flow'],
      ['lateral', 'slow_global', 'flow'],
      ['slow_global', 'fuse_head', 'flow'],
      ['fast_pool', 'fuse_head', 'flow'],
      ['fuse_head', 'head', 'flow'],
      ['head', 'output', 'flow'],
    ],
  }),

  'neural-network-architectures-specialized-modular-networks-siamese-network': blueprint({
    title: 'Siamese Network',
    subtitle: 'weight-tied encoder · one shared parameter set, applied twice',
    nodes: [
      { id: 'window_a', kind: 'input', label: 'Anchor window', sublabel: 'the current 64-bar setup', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'window_b', kind: 'input', label: 'Candidate window', sublabel: 'a historical 64-bar window from the index',
        outShape: `B × ${T} × ${F}`, column: 0, lane: 1,
        analogy: 'Think of it as pulling up a past chart that MIGHT resemble today\'s and asking the same trained eye to judge both.',
      },
      {
        id: 'encoder', kind: 'recurrent', label: 'Shared encoder', sublabel: `GRU ${F} → 64 · ONE parameter set, applied to both windows`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × 64`, params: P.gru(F, 64), column: 1,
        detail: { 'weight tying': 'the anchor and candidate pass through the IDENTICAL weights — this is one node, traversed twice, not two' },
        analogy: 'Think of it as one trained eye looking at both charts in turn, rather than two different eyes that might disagree about what matters.',
      },
      { id: 'embed_a', kind: 'pool', label: 'Anchor embedding', sublabel: `mean over the ${T} encoder states`, inShape: `B × ${T} × 64`, outShape: 'B × 64', column: 2 },
      { id: 'embed_b', kind: 'pool', label: 'Candidate embedding', sublabel: `mean over the ${T} encoder states`, inShape: `B × ${T} × 64`, outShape: 'B × 64', column: 2, lane: 1 },
      {
        id: 'distance', kind: 'compare', label: 'Embedding distance', sublabel: 'Euclidean, contrastive / triplet loss at train time',
        outShape: 'B × 1', column: 3,
        analogy: 'Think of it as measuring how far apart the two charts land in "trader-relevant" space — not in raw price, but in the abstract sense of "does the market do the same thing next".',
      },
      { id: 'output', kind: 'output', label: 'Similarity score', sublabel: 'small distance = same forward outcome, historically', outShape: 'B × 1', column: 4 },
    ],
    edges: [
      ['window_a', 'encoder', 'flow', 'pass 1: anchor'],
      ['window_b', 'encoder', 'flow', 'pass 2: candidate'],
      ['encoder', 'embed_a', 'flow'],
      ['encoder', 'embed_b', 'flow'],
      ['embed_a', 'distance', 'flow'],
      ['embed_b', 'distance', 'flow'],
      ['distance', 'output', 'flow'],
    ],
  }),

  'neural-network-architectures-specialized-modular-networks-spiking-neural-network-snn': blueprint({
    title: 'Spiking Neural Network (SNN)',
    subtitle: 'leaky integrate-and-fire · rate-coded input · surrogate-gradient training',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`, outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'encode_spikes', kind: 'stochastic', label: 'Rate-coded spike encoding', sublabel: 'each feature value → Bernoulli firing probability',
        outShape: `B × ${T} × ${F} binary`, column: 1,
        analogy: 'Think of it as converting each bar\'s numbers into a stream of coin-flips whose odds match the number — a big move fires often, a quiet bar barely fires at all.',
      },
      {
        id: 'lif1', kind: 'gate', label: 'LIF layer 1', sublabel: `synapse Linear ${F} → 128 · leak + threshold + reset`,
        inShape: `B × ${T} × ${F} binary`, outShape: `B × ${T} × 128 spikes`, params: P.linear(F, 128, false), column: 2,
        analogy: 'Think of it as a trader who only reacts once enough small moves have accumulated to cross their attention threshold — then resets and starts accumulating again.',
      },
      {
        id: 'membrane', kind: 'memory', label: 'Membrane potential', sublabel: 'U(t) = βU(t−1) + input − threshold·spike',
        outShape: 'B × 128', column: 2, lane: 1,
        detail: { 'decay β': 'the leak — carried state, not a learned weight', reset: 'subtracted the moment the threshold is crossed' },
        analogy: 'Think of it as a pressure gauge that bleeds down between bars and only trips an alarm when enough pressure builds, then drops back to zero.',
      },
      { id: 'lif2', kind: 'gate', label: 'LIF layer 2', sublabel: 'synapse Linear 128 → 128 · leak + threshold + reset', inShape: `B × ${T} × 128 spikes`, outShape: `B × ${T} × 128 spikes`, params: P.linear(128, 128, false), column: 3 },
      {
        id: 'readout', kind: 'head', label: 'Membrane readout', sublabel: `Linear 128 → ${C}, accumulated over the ${T} steps (non-spiking)`,
        inShape: `B × ${T} × 128 spikes`, outShape: `B × ${C}`, params: P.linear(128, C, false), column: 4,
      },
      { id: 'output', kind: 'output', label: 'Down · flat · up', sublabel: 'plus the full spike raster, plottable against the chart', outShape: `B × ${C}`, column: 5 },
    ],
    edges: [
      ...chain('input', 'encode_spikes', 'lif1', 'lif2', 'readout', 'output'),
      ['lif1', 'membrane', 'context', 'integrate + reset'],
      ['membrane', 'lif1', 'context', 'leaked potential carried to the next step'],
    ],
  }),
};
