/**
 * Blueprints — Generative Models (adversarial, autoregressive, diffusion &
 * score-based, and latent-variable families).
 *
 * Every spec here is normally described over images; every diagram is
 * re-sized onto this repo's own input — a 64-bar window of 35 features
 * (`DIM`) — so a generator produces a synthetic bar window and a
 * discriminator/critic/score network reads a real or synthetic one, never a
 * pixel grid.
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const C = DIM.classes;
const FLAT = T * F;
const H = 128;
const Z = 32;
const EMB = 64;
const CH = 64;
const H2 = 64;
const PATCH = 8;

export const GENERATIVE_BLUEPRINTS: Record<string, ArchGraph> = {
  // ── Adversarial ────────────────────────────────────────────────────────

  'generative-models-adversarial-generative-adversarial-network-gan': blueprint({
    title: 'Generative Adversarial Network (GAN)',
    subtitle: `generator vs discriminator · ${T}-bar synthetic window`,
    nodes: [
      {
        id: 'noise', kind: 'stochastic', label: 'Latent noise', sublabel: `z ~ N(0, I), ${Z}-dim`,
        outShape: `B × ${Z}`, column: 0,
        analogy: "Think of it as a trader's random idea for what tomorrow's session might look like, before it's been checked against anything real.",
      },
      {
        id: 'real_window', kind: 'input', label: 'Real bar window', sublabel: `genuine ${T}-bar session`,
        outShape: `B × ${T} × ${F}`, column: 0, lane: 1,
      },
      {
        id: 'gen_hidden', kind: 'linear', label: 'Generator hidden', sublabel: `Linear ${Z} → ${H}`,
        inShape: `B × ${Z}`, outShape: `B × ${H}`, params: P.linear(Z, H), column: 1,
        analogy: 'Think of it as a rookie trader sketching a full session of fake candles from that one idea.',
      },
      {
        id: 'gen_out', kind: 'linear', label: 'Generator output', sublabel: `Linear ${H} → ${T}×${F}`,
        inShape: `B × ${H}`, outShape: `B × ${T * F}`, params: P.linear(H, FLAT), column: 2,
      },
      {
        id: 'fake_reshape', kind: 'reshape', label: 'Reshape to bars', sublabel: 'flat vector → bar window',
        inShape: `B × ${T * F}`, outShape: `B × ${T} × ${F}`, column: 3,
      },
      {
        id: 'disc_hidden', kind: 'linear', label: 'Discriminator hidden', sublabel: `Linear ${T}×${F} → ${H}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H), column: 4,
        detail: { input: 'shared for real and fake windows', formula: `(T·F)·H + H = ${P.linear(FLAT, H)}` },
        analogy: "Think of it as a risk desk that has seen real sessions before, scoring whether the sketch's candles look genuine.",
      },
      {
        id: 'disc_out', kind: 'head', label: 'Real/fake head', sublabel: `Linear ${H} → 1, sigmoid`,
        inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 5,
      },
      {
        id: 'output', kind: 'output', label: 'Real vs fake', sublabel: 'probability the window is genuine',
        outShape: 'B × 1', column: 6,
      },
    ],
    edges: [
      ...chain('noise', 'gen_hidden', 'gen_out', 'fake_reshape', 'disc_hidden', 'disc_out', 'output'),
      ['real_window', 'disc_hidden', 'flow', 'real window'],
      ['output', 'gen_hidden', 'residual', 'adversarial gradient, generator update only'],
    ],
  }),

  'generative-models-adversarial-conditional-gan-cgan': blueprint({
    title: 'Conditional GAN (cGAN)',
    subtitle: `generator + discriminator conditioned on a ${C}-class label`,
    nodes: [
      {
        id: 'noise', kind: 'stochastic', label: 'Latent noise', sublabel: `z ~ N(0, I), ${Z}-dim`,
        outShape: `B × ${Z}`, column: 0,
      },
      {
        id: 'condition', kind: 'input', label: 'Regime label', sublabel: `one-hot, ${C} classes`,
        outShape: `B × ${C}`, column: 0, lane: 1,
        analogy: 'Think of it as telling the generator up front which regime — down, flat or up — to draw the session for.',
      },
      {
        id: 'real_window', kind: 'input', label: 'Real bar window', sublabel: 'genuine session, matching label',
        outShape: `B × ${T} × ${F}`, column: 0, lane: 2,
      },
      {
        id: 'cond_fuse', kind: 'fusion', label: 'Concatenate z, y', sublabel: `${Z} + ${C} = ${Z + C}`,
        outShape: `B × ${Z + C}`, column: 1,
      },
      {
        id: 'generator', kind: 'linear', label: 'Generator', sublabel: `Linear ${Z + C} → ${H} → ${T}×${F}`,
        inShape: `B × ${Z + C}`, outShape: `B × ${T} × ${F}`,
        params: P.linear(Z + C, H) + P.linear(H, FLAT), column: 2,
        detail: { 'layer 1': `${Z + C} → ${H}`, 'layer 2': `${H} → ${T * F}, reshaped to bars` },
        analogy: 'Think of it as the same rookie trader, now told which regime to sketch before drawing a single candle.',
      },
      {
        id: 'disc_fuse', kind: 'fusion', label: 'Concatenate sample, y', sublabel: `${T}×${F} + ${C}`,
        outShape: `B × ${T * F + C}`, column: 3,
      },
      {
        id: 'discriminator', kind: 'linear', label: 'Discriminator', sublabel: `Linear ${T * F + C} → ${H} → 1`,
        inShape: `B × ${T * F + C}`, outShape: 'B × 1',
        params: P.linear(FLAT + C, H) + P.linear(H, 1), column: 4,
        analogy: 'Think of it as the same risk desk, now also checking that the sketch matches the regime it was told to draw.',
      },
      { id: 'output', kind: 'output', label: 'Real vs fake', sublabel: 'given the label', outShape: 'B × 1', column: 5 },
    ],
    edges: [
      ['noise', 'cond_fuse', 'flow'],
      ['condition', 'cond_fuse', 'flow'],
      ['cond_fuse', 'generator', 'flow'],
      ['generator', 'disc_fuse', 'flow', 'fake window'],
      ['condition', 'disc_fuse', 'flow'],
      ['real_window', 'disc_fuse', 'flow', 'real window'],
      ['disc_fuse', 'discriminator', 'flow'],
      ['discriminator', 'output', 'flow'],
      ['output', 'generator', 'residual', 'adversarial gradient'],
    ],
  }),

  'generative-models-adversarial-cyclegan': blueprint({
    title: 'CycleGAN',
    subtitle: 'unpaired translation: two generators (G, F) and two discriminators (D_X, D_Y), cycle-consistent',
    nodes: [
      {
        id: 'x_window', kind: 'input', label: 'Domain X window', sublabel: 'e.g. raw price session',
        outShape: `B × ${T} × ${F}`, column: 0,
        analogy: "Think of it as this session's raw candles, before any translation.",
      },
      {
        id: 'y_real', kind: 'input', label: 'Domain Y window', sublabel: 'e.g. regime-normalized session',
        outShape: `B × ${T} × ${F}`, column: 0, lane: 2,
      },
      {
        id: 'gen_G', kind: 'linear', label: 'Generator G: X → Y', sublabel: `Linear ${T}×${F} → ${H} → ${T}×${F}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`,
        params: P.linear(FLAT, H) + P.linear(H, FLAT), column: 1,
        analogy: 'Think of it as a translator turning a raw session into the style of a calmer, mean-reverting regime.',
      },
      {
        id: 'disc_Y', kind: 'conv', label: 'Discriminator D_Y', sublabel: `PatchGAN: 2 × Conv1d kernel 4 → one score per ${PATCH / 2}-bar patch`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T / 4} × 1`,
        params: P.conv1d(F, H, 4) + P.conv1d(H, 1, 4), column: 2,
        detail: { 'receptive field': 'local, a short run of bars — never the whole window at once', 'scores per window': T / 4 },
        analogy: 'Think of it as a desk checking whether each short stretch of the translated session looks like the target regime, not the original.',
      },
      {
        id: 'gen_F', kind: 'linear', label: 'Generator F: Y → X', sublabel: `Linear ${T}×${F} → ${H} → ${T}×${F}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`,
        params: P.linear(FLAT, H) + P.linear(H, FLAT), column: 3,
        analogy: 'Think of it as the opposite translator, turning a calm regime session back into raw candles.',
      },
      {
        id: 'cycle_compare', kind: 'compare', label: 'Cycle consistency', sublabel: 'F(G(x)) vs x',
        column: 4,
        analogy: "Think of it as replaying the translation backward and checking you land on the same candles you started with — otherwise the translator invented details instead of genuinely translating them.",
      },
      {
        id: 'disc_X', kind: 'conv', label: 'Discriminator D_X', sublabel: `PatchGAN: 2 × Conv1d kernel 4 → one score per ${PATCH / 2}-bar patch`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T / 4} × 1`,
        params: P.conv1d(F, H, 4) + P.conv1d(H, 1, 4), column: 4, lane: 1,
        analogy: 'Think of it as the mirror-image desk, checking whether a session translated back into raw form still looks like a genuine raw session.',
      },
      { id: 'output', kind: 'output', label: 'Translated + cycle-consistent', sublabel: 'G(x), scored by both desks and by the round trip', column: 5 },
    ],
    edges: [
      ['x_window', 'gen_G', 'flow'],
      ['gen_G', 'disc_Y', 'flow', 'fake y'],
      ['y_real', 'disc_Y', 'flow', 'real y'],
      ['gen_G', 'gen_F', 'flow', 'fake y, fed back for the X → Y → X cycle'],
      ['y_real', 'gen_F', 'flow', 'real y, the mirror Y → X → Y cycle'],
      ['gen_F', 'cycle_compare', 'flow', 'reconstructed x'],
      ['x_window', 'cycle_compare', 'flow', 'real x'],
      ['gen_F', 'disc_X', 'flow', 'fake x = F(y)'],
      ['x_window', 'disc_X', 'flow', 'real x'],
      ['disc_Y', 'output', 'flow'],
      ['disc_X', 'output', 'flow'],
      ['cycle_compare', 'output', 'flow'],
      ['output', 'gen_G', 'residual', 'adversarial (D_Y) + cycle gradient'],
      ['output', 'gen_F', 'residual', 'adversarial (D_X) + cycle gradient'],
    ],
  }),

  'generative-models-adversarial-stylegan': blueprint({
    title: 'StyleGAN',
    subtitle: 'mapping network → style-modulated synthesis, AdaIN + noise injection',
    nodes: [
      { id: 'noise_z', kind: 'stochastic', label: 'Latent noise', sublabel: `z ~ N(0, I), ${Z}-dim`, outShape: `B × ${Z}`, column: 0 },
      {
        id: 'const_input', kind: 'embedding', label: 'Learned constant', sublabel: `starting canvas, ${T / 4} positions × ${CH} channels`,
        outShape: `B × ${T / 4} × ${CH}`, params: P.embedding(T / 4, CH), column: 0, lane: 1,
        detail: { formula: `${T / 4} positions × ${CH} = ${P.embedding(T / 4, CH)}`, note: 'one learned tensor, not derived from z' },
      },
      { id: 'real_window', kind: 'input', label: 'Real bar window', outShape: `B × ${T} × ${F}`, column: 0, lane: 2 },
      {
        id: 'mapping_net', kind: 'linear', label: 'Mapping network', sublabel: `8-layer MLP, z → w (${H}-dim)`,
        inShape: `B × ${Z}`, outShape: `B × ${H}`,
        params: P.linear(Z, H) + 7 * P.linear(H, H), column: 1,
        detail: { layers: '8 (Z→H, then 7×H→H)', formula: `(Z·H + H) + 7·(H² + H) = ${P.linear(Z, H) + 7 * P.linear(H, H)}` },
        analogy: 'Think of it as untangling the raw random draw into a cleaner "style" description before it ever touches a candle.',
      },
      {
        id: 'synthesis_blocks', kind: 'conv', label: 'Synthesis blocks', sublabel: `2 conv blocks, ×2 upsample each, AdaIN from w`,
        inShape: `B × ${T / 4} × ${CH}`, outShape: `B × ${T} × ${CH}`,
        params: P.conv1d(CH, CH, 3) + P.linear(H, 2 * CH) + P.conv1d(CH, CH, 3) + P.linear(H, 2 * CH), column: 2,
        detail: { 'conv per block': `${CH}→${CH}, kernel 3`, 'style projection per block': `w (${H}) → scale+bias (${2 * CH})` },
        analogy: 'Think of it as painting the session bar by bar onto a blank canvas, where the style vector decides the brush at every layer.',
      },
      {
        id: 'noise_inject', kind: 'stochastic', label: 'Per-position noise', sublabel: 'learned per-channel scale, one per block',
        params: 2 * P.linear(CH, 1, false), column: 2, lane: 1,
        detail: { formula: `2 blocks × ${CH} scales (no bias) = ${2 * P.linear(CH, 1, false)}` },
      },
      {
        id: 'gen_out', kind: 'conv', label: 'To bar window', sublabel: `Conv1d ${CH} → ${F}, kernel 1`,
        inShape: `B × ${T} × ${CH}`, outShape: `B × ${T} × ${F}`, params: P.conv1d(CH, F, 1), column: 3,
      },
      {
        id: 'discriminator', kind: 'linear', label: 'Discriminator', sublabel: 'minibatch stddev + spectral norm',
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1', params: P.linear(FLAT, H) + P.linear(H, 1), column: 4,
        detail: { 'minibatch stddev': 'adds no trainable weights', 'spectral norm': 'constrains existing weights, adds none' },
      },
      { id: 'output', kind: 'output', label: 'Real vs fake', outShape: 'B × 1', column: 5 },
    ],
    edges: [
      ['noise_z', 'mapping_net', 'flow'],
      ['const_input', 'synthesis_blocks', 'flow'],
      ['mapping_net', 'synthesis_blocks', 'context', 'AdaIN style modulation, every block'],
      ['noise_inject', 'synthesis_blocks', 'context', 'per-position noise, every block'],
      ['synthesis_blocks', 'gen_out', 'flow'],
      ['gen_out', 'discriminator', 'flow', 'fake window'],
      ['real_window', 'discriminator', 'flow', 'real window'],
      ['discriminator', 'output', 'flow'],
      ['output', 'mapping_net', 'residual', 'adversarial gradient (generator update)'],
    ],
  }),

  'generative-models-adversarial-wasserstein-gan-wgan': blueprint({
    title: 'Wasserstein GAN (WGAN)',
    subtitle: 'generator + 1-Lipschitz critic, linear output (no sigmoid)',
    nodes: [
      { id: 'noise', kind: 'stochastic', label: 'Latent noise', sublabel: `z ~ N(0, I), ${Z}-dim`, outShape: `B × ${Z}`, column: 0 },
      { id: 'real_window', kind: 'input', label: 'Real bar window', outShape: `B × ${T} × ${F}`, column: 0, lane: 1 },
      {
        id: 'generator', kind: 'linear', label: 'Generator', sublabel: `Linear ${Z} → ${H} → ${T}×${F}`,
        inShape: `B × ${Z}`, outShape: `B × ${T} × ${F}`, params: P.linear(Z, H) + P.linear(H, FLAT), column: 1,
        analogy: 'Think of it as a rookie trader sketching a full session of fake candles.',
      },
      {
        id: 'critic_hidden', kind: 'linear', label: 'Critic', sublabel: `Linear ${T}×${F} → ${H} → 1, linear output`,
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1', params: P.linear(FLAT, H) + P.linear(H, 1), column: 2,
        detail: { 'Lipschitz constraint': 'weight clip to [-0.01, 0.01] (WGAN) or gradient penalty (WGAN-GP)', output: 'scalar score, not a probability' },
        analogy: 'Think of it as a risk desk scoring how far a session is from realistic, by how much, not just yes or no.',
      },
      {
        id: 'wasserstein_distance', kind: 'compare', label: 'Wasserstein distance', sublabel: 'critic(real) − critic(fake)',
        column: 3,
        analogy: "Think of it as the gap between the desk's realism score for genuine sessions and for the sketch — training shrinks that gap instead of playing a win/lose game.",
      },
      { id: 'output', kind: 'output', label: 'Distance estimate', outShape: 'B × 1', column: 4 },
    ],
    edges: [
      ['noise', 'generator', 'flow'],
      ['generator', 'critic_hidden', 'flow', 'fake window'],
      ['real_window', 'critic_hidden', 'flow', 'real window'],
      ['critic_hidden', 'wasserstein_distance', 'flow'],
      ['wasserstein_distance', 'output', 'flow'],
      ['output', 'generator', 'residual', 'minimize distance, generator update'],
    ],
  }),

  'generative-models-adversarial-biggan': blueprint({
    title: 'BigGAN',
    subtitle: 'class-conditional generator, skip-z, self-attention, projection discriminator',
    nodes: [
      { id: 'noise', kind: 'stochastic', label: 'Latent noise', sublabel: `z ~ N(0, I), split into per-stage chunks (skip-z)`, outShape: `B × ${Z}`, column: 0 },
      { id: 'class_label', kind: 'input', label: 'Class label', sublabel: `one-hot, ${C} regimes`, outShape: `B × ${C}`, column: 0, lane: 1 },
      { id: 'real_window', kind: 'input', label: 'Real bar window', outShape: `B × ${T} × ${F}`, column: 0, lane: 2 },
      {
        id: 'class_embed', kind: 'embedding', label: 'Class embedding', sublabel: `shared across stages, ${EMB}-dim`,
        inShape: `B × ${C}`, outShape: `B × ${EMB}`, params: P.embedding(C, EMB), column: 1, lane: 1,
      },
      {
        id: 'cond_project', kind: 'fusion', label: 'Skip-z + class condition',
        sublabel: `z chunk (${Z / 2}) ⊕ class embedding (${EMB}) → BatchNorm gains & biases`,
        inShape: `B × ${Z / 2 + EMB}`, outShape: `B × ${2 * H}`, params: P.linear(Z / 2 + EMB, 2 * H), column: 2, lane: 1,
        detail: { 'shared embedding': `one ${EMB}-dim vector per class, reused by every stage`, 'per-stage projection': `${Z / 2 + EMB} → gains + biases (${2 * H})` },
        analogy: 'Think of it as handing every layer both the regime it must draw and a fresh slice of the original idea, so neither is forgotten halfway through the sketch.',
      },
      {
        id: 'gen_block', kind: 'linear', label: 'Generator block', sublabel: `Linear ${Z} → ${T / 4}×${H}, class-conditional BatchNorm`,
        inShape: `B × ${Z}`, outShape: `B × ${T / 4} × ${H}`, params: P.linear(Z, (T / 4) * H), column: 3,
        detail: { normalization: 'class-conditional BatchNorm, gains and biases supplied by cond_project' },
        analogy: 'Think of it as a sketch of the session where every layer is re-tinted by which regime it was told to draw.',
      },
      {
        id: 'self_attn', kind: 'attention', label: 'Self-attention', sublabel: `global structure across the ${T / 4} positions`,
        inShape: `B × ${T / 4} × ${H}`, outShape: `B × ${T / 4} × ${H}`, params: P.attention(H), column: 4,
        analogy: 'Think of it as letting a candle late in the session directly reference an early one, not just its immediate neighbor.',
      },
      {
        id: 'gen_out', kind: 'conv', label: 'Generator output', sublabel: `upsample ×4 + Conv1d ${H} → ${F}, kernel 3`,
        inShape: `B × ${T / 4} × ${H}`, outShape: `B × ${T} × ${F}`, params: P.conv1d(H, F, 3), column: 5,
      },
      {
        id: 'discriminator', kind: 'linear', label: 'Projection discriminator', sublabel: 'spectral-normalized, class projection',
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1',
        params: P.linear(FLAT, H) + P.linear(H, 1) + P.linear(EMB, H), column: 6,
        detail: { 'main path': `${T * F}→${H}→1`, projection: `class_embed (${EMB}) → ${H}, inner-producted with features` },
      },
      { id: 'output', kind: 'output', label: 'Real vs fake', outShape: 'B × 1', column: 7 },
    ],
    edges: [
      ['noise', 'gen_block', 'flow'],
      ['class_label', 'class_embed', 'flow'],
      ['class_embed', 'cond_project', 'flow'],
      ['noise', 'cond_project', 'context', 'skip-z: a chunk of z joins the class embedding at every stage'],
      ['cond_project', 'gen_block', 'context', 'class-conditional BatchNorm gains and biases'],
      ['gen_block', 'self_attn', 'flow'],
      ['self_attn', 'gen_out', 'flow'],
      ['gen_out', 'discriminator', 'flow', 'fake window'],
      ['real_window', 'discriminator', 'flow', 'real window'],
      ['class_embed', 'discriminator', 'context', 'projection: class · features'],
      ['discriminator', 'output', 'flow'],
      ['output', 'gen_block', 'residual', 'adversarial gradient'],
    ],
  }),

  'generative-models-adversarial-adversarial-autoencoder': blueprint({
    title: 'Adversarial Autoencoder (AAE)',
    subtitle: 'encoder/decoder + a discriminator that judges the latent code, not the data',
    nodes: [
      { id: 'input_window', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `Linear ${T}×${F} → ${H} → ${Z}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${Z}`, params: P.linear(FLAT, H) + P.linear(H, Z), column: 1,
        analogy: "Think of it as compressing a session's candles into a short code that also has to look, statistically, like pure noise to a judge.",
      },
      { id: 'prior_sample', kind: 'stochastic', label: 'Prior sample', sublabel: `z ~ N(0, I), ${Z}-dim`, outShape: `B × ${Z}`, column: 1, lane: 1 },
      {
        id: 'decoder', kind: 'linear', label: 'Decoder', sublabel: `Linear ${Z} → ${H} → ${T}×${F}`,
        inShape: `B × ${Z}`, outShape: `B × ${T} × ${F}`, params: P.linear(Z, H) + P.linear(H, FLAT), column: 2,
        analogy: 'Think of it as rebuilding the full session back out of that short code.',
      },
      { id: 'reconstruction', kind: 'output', label: 'Reconstructed window', outShape: `B × ${T} × ${F}`, column: 3 },
      {
        id: 'latent_discriminator', kind: 'linear', label: 'Latent discriminator', sublabel: `Linear ${Z} → ${H} → 1`,
        inShape: `B × ${Z}`, outShape: 'B × 1', params: P.linear(Z, H) + P.linear(H, 1), column: 2, lane: 1,
        analogy: "Think of it as that judge comparing the code's statistics against genuine random noise, not against real candles.",
      },
      { id: 'realness', kind: 'output', label: "Code's realness", sublabel: 'encoded z vs prior z', outShape: 'B × 1', column: 3, lane: 1 },
    ],
    edges: [
      ['input_window', 'encoder', 'flow'],
      ['encoder', 'decoder', 'flow'],
      ['decoder', 'reconstruction', 'flow'],
      ['encoder', 'latent_discriminator', 'flow', 'encoded z'],
      ['prior_sample', 'latent_discriminator', 'flow', 'prior z'],
      ['latent_discriminator', 'realness', 'flow'],
      ['realness', 'encoder', 'residual', 'adversarial gradient, shapes the latent code to match the prior'],
    ],
  }),

  // ── Autoregressive ─────────────────────────────────────────────────────

  'generative-models-autoregressive-autoregressive-model-pixelrnn-pixelcnn': blueprint({
    title: 'Autoregressive Model (PixelRNN, PixelCNN)',
    subtitle: 'causal masked convolutions (PixelCNN); the PixelRNN variant replaces them with recurrent passes over the same causal order',
    nodes: [
      {
        id: 'input_window', kind: 'input', label: 'Bars so far', sublabel: 'previous bars only',
        outShape: `B × ${T} × ${F}`, column: 0,
      },
      {
        id: 'masked_conv1', kind: 'conv', label: 'Masked conv (Mask A)', sublabel: `kernel 3, excludes current bar`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${H}`, params: P.conv1d(F, H, 3), column: 1,
        analogy: 'Think of it as a trader who can only see candles up to right now — masked so there is no peeking at the bar being predicted.',
      },
      {
        id: 'masked_conv2', kind: 'conv', label: 'Masked conv (Mask B)', sublabel: 'kernel 3, receptive field grows',
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, params: P.conv1d(H, H, 3), column: 2,
      },
      {
        id: 'gate_proj', kind: 'gate', label: 'Gated activation', sublabel: 'tanh(filter) · sigmoid(gate)',
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, params: 2 * P.conv1d(H, H, 1), column: 3,
        detail: { filter: `${H}→${H}, kernel 1`, gate: `${H}→${H}, kernel 1`, combine: 'elementwise tanh · sigmoid' },
        analogy: 'Think of it as two overlapping opinions — one saying what to consider, one saying how much to trust it — multiplied together.',
      },
      {
        id: 'head', kind: 'head', label: 'Next-bar head', sublabel: `Linear ${H} → ${F}, applied at every position`,
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${F}`, params: P.linear(H, F), column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Next-bar distribution per position',
        sublabel: 'all positions at once in training, one at a time when generating',
        outShape: `B × ${T} × ${F}`, column: 5,
      },
    ],
    edges: [
      ...chain('input_window', 'masked_conv1', 'masked_conv2', 'gate_proj', 'head', 'output'),
      ['output', 'input_window', 'context', 'append the sampled bar, repeat one position at a time'],
    ],
  }),

  'generative-models-autoregressive-transformer-based-generator-e-g-gpt': blueprint({
    title: 'Transformer-Based Generator (GPT-style)',
    subtitle: `decoder-only, causal self-attention, ${T}-bar context`,
    nodes: [
      { id: 'input_window', kind: 'input', label: 'Bars so far', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'bar_embed', kind: 'embedding', label: 'Bar projection', sublabel: `Linear ${F} → ${H} (continuous bars, not a vocab lookup)`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${H}`, params: P.linear(F, H), column: 1,
        analogy: "Think of it as translating each raw candle into the model's own internal vocabulary of numbers.",
      },
      { id: 'pos_encoding', kind: 'positional', label: 'Positional encoding', sublabel: 'sinusoidal, added elementwise', column: 1, lane: 1 },
      {
        id: 'decoder_block1', kind: 'attention', label: 'Decoder block 1', sublabel: 'masked self-attention + FFN',
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, params: P.encoderLayer(H, H * 4), column: 2,
        detail: { masking: 'causal, lower-triangular', formula: 'attention + feed-forward + 2 · norm' },
        analogy: 'Think of it as every bar in the window looking back — never forward — at every earlier bar to decide what matters right now.',
      },
      {
        id: 'decoder_block2', kind: 'attention', label: 'Decoder block 2', sublabel: 'masked self-attention + FFN',
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, params: P.encoderLayer(H, H * 4), column: 3,
      },
      { id: 'last_token', kind: 'pool', label: 'Last position', sublabel: 'hidden state at the final bar', inShape: `B × ${T} × ${H}`, outShape: `B × ${H}`, column: 4 },
      {
        id: 'head', kind: 'head', label: 'Next-bar head', sublabel: `Linear ${H} → ${F}`,
        inShape: `B × ${H}`, outShape: `B × ${F}`, params: P.linear(H, F), column: 5,
        analogy: 'Think of it as the model finally committing to a guess for the next candle.',
      },
      { id: 'output', kind: 'output', label: 'Next bar', outShape: `B × ${F}`, column: 6 },
    ],
    edges: [
      ['input_window', 'bar_embed', 'flow'],
      ['pos_encoding', 'bar_embed', 'context', 'added once to the projected bars, before the first block'],
      ...chain('bar_embed', 'decoder_block1', 'decoder_block2', 'last_token', 'head', 'output'),
      ['output', 'input_window', 'context', 'append predicted bar, repeat autoregressively'],
    ],
  }),

  // ── Diffusion & score-based ─────────────────────────────────────────────

  'generative-models-diffusion-score-based-diffusion-model': blueprint({
    title: 'Diffusion Model',
    subtitle: 'forward noising + learned reverse denoising, repeated over the whole noise schedule',
    nodes: [
      { id: 'clean_window', kind: 'input', label: 'Clean bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'forward_noise', kind: 'stochastic', label: 'Forward noising', sublabel: `x_t = √ᾱ_t·x₀ + √(1−ᾱ_t)·ε`,
        outShape: `B × ${T} × ${F}`, column: 1,
        analogy: 'Think of it as slowly smearing a real session into pure static over many steps.',
      },
      { id: 'timestep_embed', kind: 'positional', label: 'Timestep embedding', sublabel: 'sinusoidal, step t', column: 1, lane: 1 },
      {
        id: 'denoiser', kind: 'conv', label: 'Denoising network', sublabel: `conv ${F} → ${H} → ${F}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, params: P.conv1d(F, H, 3) + P.conv1d(H, F, 3), column: 2,
        analogy: 'Think of it as a restorer that has learned, at every noise level, what static needs removing to reveal a session underneath.',
      },
      { id: 'denoise_compare', kind: 'compare', label: 'Noise match', sublabel: 'predicted ε vs true ε (training only)', column: 3 },
      { id: 'output', kind: 'output', label: 'Denoised window', sublabel: 'after the full reverse schedule', outShape: `B × ${T} × ${F}`, column: 4 },
    ],
    edges: [
      ['clean_window', 'forward_noise', 'flow', 'add noise, step t'],
      ['forward_noise', 'denoiser', 'flow', 'x_t'],
      ['timestep_embed', 'denoiser', 'context', 'condition on t'],
      ['denoiser', 'denoise_compare', 'flow', 'predicted ε'],
      ['forward_noise', 'denoise_compare', 'flow', 'true ε sampled in the forward step'],
      ['denoiser', 'output', 'flow', 'subtract the predicted noise: one reverse step'],
      ['denoise_compare', 'denoiser', 'residual', 'ε-prediction loss gradient'],
      ['output', 'denoiser', 'context', 're-enter the denoiser at step t−1, until the schedule is exhausted'],
    ],
  }),

  'generative-models-diffusion-score-based-perceptual-loss-generator': blueprint({
    title: 'Perceptual Loss Generator',
    subtitle: 'diffusion denoiser trained with a frozen feature-space loss',
    nodes: [
      { id: 'clean_window', kind: 'input', label: 'Clean bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'forward_noise', kind: 'stochastic', label: 'Forward noising', outShape: `B × ${T} × ${F}`, column: 1 },
      { id: 'timestep_embed', kind: 'positional', label: 'Timestep embedding', column: 1, lane: 1 },
      {
        id: 'denoiser', kind: 'conv', label: 'Denoising network', sublabel: `conv ${F} → ${H} → ${F}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, params: P.conv1d(F, H, 3) + P.conv1d(H, F, 3), column: 2,
      },
      {
        id: 'feature_extractor', kind: 'conv', label: 'Feature extractor', sublabel: 'pretrained, frozen',
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${H}`, column: 3,
        detail: { trainable: '0 — frozen weights, not updated by this model' },
        analogy: 'Think of it as a second, unbiased trader who never learns, whose only job is to describe what a session "feels like" so both the real and denoised versions can be compared on feel, not candle-for-candle.',
      },
      { id: 'perceptual_compare', kind: 'compare', label: 'Feature match', sublabel: 'features(denoised) vs features(real), training only', column: 4 },
      { id: 'output', kind: 'output', label: 'Denoised window', outShape: `B × ${T} × ${F}`, column: 5 },
    ],
    edges: [
      ['clean_window', 'forward_noise', 'flow'],
      ['forward_noise', 'denoiser', 'flow'],
      ['timestep_embed', 'denoiser', 'context', 'condition on t'],
      ['denoiser', 'feature_extractor', 'flow', 'denoised window'],
      ['clean_window', 'feature_extractor', 'flow', 'real window'],
      ['feature_extractor', 'perceptual_compare', 'flow'],
      ['denoiser', 'output', 'flow', 'reverse step, repeated over the schedule'],
      ['perceptual_compare', 'denoiser', 'residual', 'perceptual loss gradient, added to the ε-prediction loss'],
    ],
  }),

  'generative-models-diffusion-score-based-score-based-generative-model': blueprint({
    title: 'Score-Based Generative Model',
    subtitle: 'continuous SDE noising, learned score ∇ₓ log p_t(x)',
    nodes: [
      { id: 'clean_window', kind: 'input', label: 'Clean bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'sde_perturb', kind: 'stochastic', label: 'SDE perturbation', sublabel: 'increasing noise scale σ_t',
        outShape: `B × ${T} × ${F}`, column: 1,
      },
      { id: 'sigma_embed', kind: 'positional', label: 'Noise-scale embedding', column: 1, lane: 1 },
      {
        id: 'score_net', kind: 'conv', label: 'Score network', sublabel: `conv ${F} → ${H} → ${F}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${F}`, params: P.conv1d(F, H, 3) + P.conv1d(H, F, 3), column: 2,
        analogy: 'Think of it as a compass at every noise level, pointing toward "more like a real session."',
      },
      { id: 'score_compare', kind: 'compare', label: 'Score match', sublabel: 'predicted score vs true score of the perturbation kernel', column: 3 },
      {
        id: 'reverse_sde', kind: 'recurrent', label: 'Reverse SDE', sublabel: 'iteratively follows the learned score back to data',
        column: 4,
      },
      { id: 'output', kind: 'output', label: 'Generated window', outShape: `B × ${T} × ${F}`, column: 5 },
    ],
    edges: [
      ['clean_window', 'sde_perturb', 'flow', 'perturb with noise scale σ_t'],
      ['sde_perturb', 'score_net', 'flow'],
      ['sigma_embed', 'score_net', 'context', 'condition on σ_t'],
      ['score_net', 'score_compare', 'flow', 'predicted score'],
      ['sde_perturb', 'score_compare', 'flow', 'true score of the perturbation kernel'],
      ['score_net', 'reverse_sde', 'flow', 'learned score, followed backward in time'],
      ['reverse_sde', 'output', 'flow'],
      ['reverse_sde', 'score_net', 'context', 're-evaluated at every reverse step'],
      ['score_compare', 'score_net', 'residual', 'denoising score-matching gradient'],
    ],
  }),

  'generative-models-diffusion-score-based-unet-generator-used-in-diffusion': blueprint({
    title: 'U-Net Generator (used in diffusion)',
    subtitle: 'encoder-decoder with skip connections, the denoiser itself',
    nodes: [
      { id: 'noisy_window', kind: 'input', label: 'Noisy window', sublabel: 'x_t at diffusion step t', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'timestep_embed', kind: 'positional', label: 'Timestep MLP', sublabel: `sinusoidal → Linear ${EMB} → ${EMB}, then one projection per stage`,
        params: P.linear(EMB, EMB) + P.linear(EMB, CH) + P.linear(EMB, H) + P.linear(EMB, CH) + P.linear(EMB, F),
        column: 0, lane: 1,
        detail: {
          'shared MLP': `${EMB} → ${EMB}`,
          'projection into enc1 / dec2': `${EMB} → ${CH} and ${EMB} → ${F}`,
          'projection into enc2 / dec1': `${EMB} → ${H} and ${EMB} → ${CH}`,
          note: 'the sinusoidal encoding itself has nothing to learn; every count here is a projection into a stage’s own channel width',
        },
        analogy: 'Think of it as stamping "how noisy is this session right now" onto every stage, in whatever units that stage speaks.',
      },
      {
        id: 'enc1', kind: 'conv', label: 'Encoder stage 1', sublabel: `conv ${F} → ${CH}, downsample`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T / 2} × ${CH}`, params: P.conv1d(F, CH, 3), column: 1,
      },
      {
        id: 'enc2', kind: 'conv', label: 'Encoder stage 2', sublabel: `conv ${CH} → ${H}, downsample`,
        inShape: `B × ${T / 2} × ${CH}`, outShape: `B × ${T / 4} × ${H}`, params: P.conv1d(CH, H, 3), column: 2,
      },
      {
        id: 'bottleneck', kind: 'attention', label: 'Bottleneck', sublabel: 'self-attention at lowest resolution',
        inShape: `B × ${T / 4} × ${H}`, outShape: `B × ${T / 4} × ${H}`, params: P.attention(H), column: 3,
        analogy: 'Think of it as the one point where the whole compressed session can attend to itself at once before decoding begins.',
      },
      {
        id: 'dec1', kind: 'conv', label: 'Decoder stage 1', sublabel: `conv ${H * 2} → ${CH}, upsample + skip`,
        inShape: `B × ${T / 4} × ${H * 2}`, outShape: `B × ${T / 2} × ${CH}`, params: P.conv1d(H * 2, CH, 3), column: 4,
      },
      {
        id: 'dec2', kind: 'conv', label: 'Decoder stage 2', sublabel: `conv ${CH * 2} → ${F}, upsample + skip`,
        inShape: `B × ${T / 2} × ${CH * 2}`, outShape: `B × ${T} × ${F}`, params: P.conv1d(CH * 2, F, 3), column: 5,
      },
      { id: 'output', kind: 'output', label: 'Predicted noise ε_θ', sublabel: 'same shape as the input', outShape: `B × ${T} × ${F}`, column: 6 },
    ],
    edges: [
      ...chain('noisy_window', 'enc1', 'enc2', 'bottleneck', 'dec1', 'dec2', 'output'),
      ['timestep_embed', 'enc1', 'context', 'inject t'],
      ['timestep_embed', 'enc2', 'context', 'inject t'],
      ['timestep_embed', 'dec1', 'context', 'inject t'],
      ['timestep_embed', 'dec2', 'context', 'inject t'],
      ['enc2', 'dec1', 'residual', 'skip connection, channel concat'],
      ['enc1', 'dec2', 'residual', 'skip connection, channel concat'],
    ],
  }),

  // ── Energy-based ─────────────────────────────────────────────────────────

  'generative-models-energy-based-model': blueprint({
    title: 'Energy-Based Model',
    subtitle: 'scalar energy net + MCMC negative sampling, contrastive divergence',
    nodes: [
      { id: 'real_window', kind: 'input', label: 'Real bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      { id: 'noise_init', kind: 'stochastic', label: 'Random start', sublabel: 'x⁻₀ ~ N(0, I)', outShape: `B × ${T} × ${F}`, column: 0, lane: 1 },
      {
        id: 'energy_net', kind: 'linear', label: 'Energy network', sublabel: `Linear ${T}×${F} → ${H} → 1`,
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1', params: P.linear(FLAT, H) + P.linear(H, 1), column: 1,
        analogy: 'Think of it as a single dial that reads low for a session shaped like the real market and high for anything else.',
      },
      {
        id: 'langevin_sample', kind: 'stochastic', label: 'Langevin sampling', sublabel: 'K gradient steps down the energy surface',
        outShape: `B × ${T} × ${F}`, column: 2, lane: 1,
        analogy: 'Think of it as nudging a random session downhill on that dial, step by step, until it starts to look plausible.',
      },
      { id: 'energy_compare', kind: 'compare', label: 'Energy gap', sublabel: 'E(real) vs E(negative sample)', column: 2 },
      { id: 'output', kind: 'output', label: 'Energy score', sublabel: 'implicit density, low = plausible', outShape: 'B × 1', column: 3 },
    ],
    edges: [
      ['real_window', 'energy_net', 'flow'],
      ['noise_init', 'langevin_sample', 'flow'],
      ['energy_net', 'langevin_sample', 'context', '∇E steers each Langevin step'],
      ['energy_net', 'energy_compare', 'flow', 'E(real x)'],
      ['langevin_sample', 'energy_compare', 'flow', 'E(negative sample), same energy net'],
      ['energy_compare', 'output', 'flow'],
      ['output', 'energy_net', 'residual', 'contrastive divergence: push down real energy, push up negative energy'],
    ],
  }),

  // ── Latent variable models ────────────────────────────────────────────────

  'generative-models-latent-variable-models-bayesian-generator': blueprint({
    title: 'Bayesian Generator',
    subtitle: 'VAE-shaped encoder/decoder with a distribution over decoder weights',
    nodes: [
      { id: 'input_window', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `Linear ${T}×${F} → ${H} → 2×${Z} (μ, σ)`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${2 * Z}`, params: P.linear(FLAT, H) + P.linear(H, 2 * Z), column: 1,
      },
      {
        id: 'reparam', kind: 'stochastic', label: 'Reparameterize', sublabel: 'z = μ + σ · ε, ε ~ N(0, I)',
        inShape: `B × ${2 * Z}`, outShape: `B × ${Z}`, column: 2,
      },
      {
        id: 'bayesian_weights', kind: 'stochastic', label: 'Decoder weights', sublabel: 'w ~ N(μ_w, σ_w²), resampled every pass',
        column: 2, lane: 2,
        analogy: "Think of it as the decoder itself being uncertain — instead of one fixed set of rules for turning a code into candles, it draws a fresh set from a learned range each time.",
      },
      {
        id: 'decoder', kind: 'linear', label: 'Decoder (Bayesian)', sublabel: `Linear ${Z} → ${H} → ${T}×${F}, mean+variance per weight`,
        inShape: `B × ${Z}`, outShape: `B × ${T} × ${F}`,
        params: 2 * (P.linear(Z, H) + P.linear(H, FLAT)), column: 3,
        detail: { formula: `2 · (Z·H+H + H·(T·F)+T·F), the ×2 stores μ_w and σ_w per weight (Bayes-by-Backprop)` },
      },
      { id: 'prior', kind: 'stochastic', label: 'Priors', sublabel: 'p(z) = N(0, I) and p(w) = N(0, σ²)', column: 1, lane: 1 },
      {
        id: 'kl_terms', kind: 'compare', label: 'KL terms', sublabel: 'q(z|x) ‖ p(z), and q(w) ‖ p(w)', column: 2, lane: 1,
        analogy: 'Think of it as a penalty for both the code and the rulebook wandering further from their defaults than the evidence justifies.',
      },
      { id: 'output', kind: 'output', label: 'Reconstructed window', outShape: `B × ${T} × ${F}`, column: 4 },
    ],
    edges: [
      ...chain('input_window', 'encoder', 'reparam', 'decoder', 'output'),
      ['bayesian_weights', 'decoder', 'context', 'weights resampled from a learned posterior every forward pass'],
      ['encoder', 'kl_terms', 'flow', 'q(z|x): μ, σ'],
      ['prior', 'kl_terms', 'flow', 'p(z), p(w)'],
      ['bayesian_weights', 'kl_terms', 'context', 'q(w): μ_w, σ_w'],
      ['kl_terms', 'encoder', 'residual', 'KL gradient: pulls both posteriors toward their priors'],
      ['output', 'encoder', 'residual', 'reconstruction gradient — the other half of the ELBO'],
    ],
  }),

  'generative-models-latent-variable-models-deep-boltzmann-machine-generator': blueprint({
    title: 'Deep Boltzmann Machine Generator',
    subtitle: 'undirected, bipartite visible/hidden layers, Gibbs sampling',
    nodes: [
      { id: 'visible', kind: 'input', label: 'Visible units', sublabel: 'the bar window itself', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'hidden1', kind: 'stochastic', label: 'Hidden layer 1', sublabel: `${H} binary units`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H), column: 1,
        detail: { formula: `W1 + hidden bias: (T·F)·H + H = ${P.linear(FLAT, H)}`, connectivity: 'undirected, to the visible layer AND to hidden layer 2' },
      },
      {
        id: 'hidden2', kind: 'stochastic', label: 'Hidden layer 2', sublabel: `${H2} binary units`,
        inShape: `B × ${H}`, outShape: `B × ${H2}`, params: P.linear(H, H2), column: 2,
      },
      {
        id: 'meanfield_init', kind: 'stochastic', label: 'Mean-field init', sublabel: 'variational estimate of hidden probabilities',
        column: 3, lane: 1,
      },
      {
        id: 'gibbs_sampling', kind: 'stochastic', label: 'Gibbs sampling', sublabel: 'alternating up/down passes',
        column: 4,
        analogy: 'Think of it as visible candles and hidden features arguing back and forth — each guesses the other, over and over, until they roughly agree.',
      },
      { id: 'output', kind: 'output', label: 'Reconstructed visible', sublabel: 'sample from p(x)', outShape: `B × ${T} × ${F}`, column: 5 },
    ],
    edges: [
      ['visible', 'hidden1', 'flow', 'W1'],
      ['hidden1', 'hidden2', 'flow', 'W2'],
      ['hidden2', 'hidden1', 'context', 'top-down feedback (undirected connections)'],
      ['hidden2', 'meanfield_init', 'flow'],
      ['meanfield_init', 'gibbs_sampling', 'flow'],
      ['hidden1', 'gibbs_sampling', 'context', 'bottom-up, alternated with top-down'],
      ['gibbs_sampling', 'output', 'flow'],
      ['output', 'hidden1', 'residual', 'contrastive divergence; the partition function is intractable and only approximated by sampling'],
    ],
  }),

  'generative-models-latent-variable-models-masked-autoencoder-for-distribution-learning': blueprint({
    title: 'Masked Autoencoder for Distribution Learning',
    subtitle: `${T / PATCH} patches of ${PATCH} bars, 75% masked, visible-only encoder`,
    nodes: [
      { id: 'input_window', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'patchify', kind: 'reshape', label: 'Patchify', sublabel: `${PATCH}-bar patches`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T / PATCH} × ${PATCH * F}`, column: 1,
      },
      {
        id: 'mask', kind: 'stochastic', label: 'Random masking', sublabel: `75% of patches hidden — ${T / PATCH / 4} of ${T / PATCH} left visible`,
        inShape: `B × ${T / PATCH} × ${PATCH * F}`, outShape: `B × ${T / PATCH / 4} × ${PATCH * F}`, column: 2,
        analogy: 'Think of it as covering three-quarters of the session and asking the model to describe the market well enough to redraw what is under the cover.',
      },
      {
        id: 'patch_embed', kind: 'embedding', label: 'Patch projection', sublabel: `Linear ${PATCH * F} → ${H}`,
        inShape: `B × ${T / PATCH / 4} × ${PATCH * F}`, outShape: `B × ${T / PATCH / 4} × ${H}`,
        params: P.linear(PATCH * F, H), column: 3,
      },
      {
        id: 'pos_embed', kind: 'positional', label: 'Positional embedding', sublabel: `fixed sin-cos, one per patch slot (${T / PATCH})`,
        column: 3, lane: 1,
        detail: { trainable: '0 — fixed sin-cos, as in He et al. 2021' },
        analogy: 'Think of it as writing the time of day on every patch, so a covered stretch can still be placed in the session.',
      },
      {
        id: 'encoder_block', kind: 'attention', label: 'Encoder', sublabel: 'transformer, visible patches only',
        inShape: `B × ${T / PATCH / 4} × ${H}`, outShape: `B × ${T / PATCH / 4} × ${H}`,
        params: P.encoderLayer(H, H * 4), column: 4,
      },
      {
        id: 'mask_tokens', kind: 'embedding', label: 'Mask token', sublabel: `one learned vector, broadcast to the ${T / PATCH - T / PATCH / 4} hidden slots`,
        outShape: `B × ${T / PATCH - T / PATCH / 4} × ${H}`, params: P.embedding(1, H), column: 4, lane: 1,
      },
      {
        id: 'decoder_block', kind: 'attention', label: 'Decoder', sublabel: 'lightweight transformer, all patches',
        inShape: `B × ${T / PATCH} × ${H}`, outShape: `B × ${T / PATCH} × ${H}`,
        params: P.encoderLayer(H, H * 2), column: 5,
      },
      {
        id: 'head', kind: 'head', label: 'Reconstruction head', sublabel: `Linear ${H} → ${PATCH * F}`,
        inShape: `B × ${T / PATCH} × ${H}`, outShape: `B × ${T / PATCH} × ${PATCH * F}`,
        params: P.linear(H, PATCH * F), column: 6,
      },
      {
        id: 'output', kind: 'output', label: 'Reconstructed patches', sublabel: 'loss on masked patches only',
        outShape: `B × ${T / PATCH} × ${PATCH * F}`, column: 7,
      },
    ],
    edges: [
      ...chain('input_window', 'patchify', 'mask', 'patch_embed', 'encoder_block', 'decoder_block', 'head', 'output'),
      ['pos_embed', 'patch_embed', 'context', 'added to every visible patch'],
      ['pos_embed', 'decoder_block', 'context', 'added to every slot, visible and masked'],
      ['mask_tokens', 'decoder_block', 'context', 'fills the hidden slots, restoring the full patch sequence'],
    ],
  }),

  'generative-models-latent-variable-models-neural-ode-generator': blueprint({
    title: 'Neural ODE Generator',
    subtitle: 'continuous normalizing flow (FFJORD), exact likelihood via trace estimation',
    nodes: [
      {
        id: 'real_window', kind: 'input', label: 'Real bar window', sublabel: `x = z(1), flattened to the ${Z}-dim flow space`,
        outShape: `B × ${Z}`, column: 0,
      },
      {
        id: 'dynamics_net', kind: 'linear', label: 'Dynamics network', sublabel: `f_θ(z,t): Linear ${Z + 1} → ${H} → ${Z}`,
        inShape: `B × ${Z + 1}`, outShape: `B × ${Z}`,
        params: P.linear(Z + 1, H) + P.linear(H, Z), column: 1,
        detail: { input: `z (${Z} dims) with the current time t appended → ${Z + 1}`, output: 'dz/dt, the same width as z' },
        analogy: "Think of it as the rule for how a point in latent space drifts, moment by moment, on its way to becoming a real session.",
      },
      {
        id: 'ode_solver_reverse', kind: 'recurrent', label: 'Reverse ODE solver', sublabel: 're-applies f_θ from t=1 to t=0',
        column: 2,
      },
      { id: 'probe_vector', kind: 'stochastic', label: 'Hutchinson probe', sublabel: 'v ~ Rademacher', column: 2, lane: 1 },
      {
        id: 'jacobian_trace', kind: 'compare', label: 'Trace estimate', sublabel: 'vᵀ(∂f/∂z)v, accumulated along the trajectory',
        column: 3,
      },
      { id: 'base_density', kind: 'compare', label: 'Base density + correction', sublabel: 'log p(z₀) under N(0,I), minus trace', column: 4 },
      { id: 'output', kind: 'output', label: 'Exact log-likelihood', sublabel: 'log p(x)', column: 5 },
    ],
    edges: [
      ['real_window', 'dynamics_net', 'flow'],
      ['dynamics_net', 'ode_solver_reverse', 'flow'],
      ['probe_vector', 'jacobian_trace', 'flow', 'Hutchinson probe v'],
      ['ode_solver_reverse', 'jacobian_trace', 'flow', 'trajectory z(t)'],
      ['ode_solver_reverse', 'base_density', 'flow', 'z(0), the endpoint of the reverse integration'],
      ['jacobian_trace', 'base_density', 'flow', 'accumulated trace, the log-det correction'],
      ['base_density', 'output', 'flow'],
      ['output', 'dynamics_net', 'residual', 'maximize log p(x); the same f_θ integrated forward from a sampled z(0) generates new data'],
    ],
  }),

  'generative-models-latent-variable-models-normalizing-flow': blueprint({
    title: 'Normalizing Flow',
    subtitle: 'invertible coupling layers, exact likelihood via a triangular Jacobian',
    nodes: [
      { id: 'real_window', kind: 'input', label: 'Real bar window', sublabel: 'x, flattened to latent width', outShape: `B × ${Z}`, column: 0 },
      {
        id: 'coupling1_inv', kind: 'gate', label: 'Coupling layer 1⁻¹', sublabel: `affine, conditions ${Z / 2} dims on the other ${Z / 2}`,
        inShape: `B × ${Z}`, outShape: `B × ${Z}`,
        params: 2 * P.linear(Z / 2, Z / 2), column: 1,
        detail: { formula: `scale net + shift net, each Linear ${Z / 2}→${Z / 2} = ${2 * P.linear(Z / 2, Z / 2)}` },
        analogy: 'Think of it as reading half the features to decide exactly how to rescale and shift the other half — a transform you can always run backward.',
      },
      {
        id: 'permute', kind: 'reshape', label: 'Permute', sublabel: 'swap which half is transformed next',
        inShape: `B × ${Z}`, outShape: `B × ${Z}`, column: 2,
      },
      {
        id: 'coupling2_inv', kind: 'gate', label: 'Coupling layer 2⁻¹', sublabel: 'affine, the other half',
        inShape: `B × ${Z}`, outShape: `B × ${Z}`,
        params: 2 * P.linear(Z / 2, Z / 2), column: 3,
      },
      {
        id: 'jacobian_det', kind: 'compare', label: 'Log-det Jacobian', sublabel: 'triangular, sums the coupling layers’ scale terms',
        column: 4,
        detail: { 'extra learned weights': '0 — reuses the coupling layers’ own scale outputs' },
      },
      { id: 'base_compare', kind: 'compare', label: 'Base density', sublabel: 'log p(z) under N(0, I) + log-det', column: 5 },
      { id: 'output', kind: 'output', label: 'Exact log-likelihood', sublabel: 'log p(x)', column: 6 },
    ],
    edges: [
      ...chain('real_window', 'coupling1_inv', 'permute', 'coupling2_inv', 'jacobian_det', 'base_compare', 'output'),
      ['coupling2_inv', 'base_compare', 'flow', 'z, transformed all the way to base space'],
      ['output', 'coupling1_inv', 'residual', 'exactly invertible: the same layers run forward from a sampled z to generate new x'],
    ],
  }),

  'generative-models-latent-variable-models-variational-autoencoder-vae': blueprint({
    title: 'Variational Autoencoder (VAE)',
    subtitle: 'encoder to μ, σ · reparameterized sample · decoder, KL-regularized',
    nodes: [
      { id: 'input_window', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0 },
      {
        id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `Linear ${T}×${F} → ${H} → 2×${Z} (μ, σ)`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${2 * Z}`, params: P.linear(FLAT, H) + P.linear(H, 2 * Z), column: 1,
        analogy: "Think of it as squeezing a whole session down to a handful of numbers that still capture its shape.",
      },
      {
        id: 'reparam', kind: 'stochastic', label: 'Reparameterize', sublabel: 'z = μ + σ · ε, ε ~ N(0, I)',
        inShape: `B × ${2 * Z}`, outShape: `B × ${Z}`, column: 2,
        analogy: 'Think of it as drawing one plausible version of the session from the range the encoder said it could be in.',
      },
      { id: 'prior', kind: 'stochastic', label: 'Prior', sublabel: 'p(z) = N(0, I)', column: 1, lane: 1 },
      { id: 'kl_compare', kind: 'compare', label: 'KL divergence', sublabel: 'q(z|x) vs p(z)', column: 2, lane: 1 },
      {
        id: 'decoder', kind: 'linear', label: 'Decoder', sublabel: `Linear ${Z} → ${H} → ${T}×${F}`,
        inShape: `B × ${Z}`, outShape: `B × ${T} × ${F}`, params: P.linear(Z, H) + P.linear(H, FLAT), column: 3,
        analogy: 'Think of it as expanding those few numbers back out into a full session of candles.',
      },
      { id: 'output', kind: 'output', label: 'Reconstructed window', outShape: `B × ${T} × ${F}`, column: 4 },
    ],
    edges: [
      ['input_window', 'encoder', 'flow'],
      ['encoder', 'reparam', 'flow'],
      ['reparam', 'decoder', 'flow'],
      ['encoder', 'kl_compare', 'flow', 'q(z|x): μ, σ'],
      ['prior', 'kl_compare', 'flow', 'p(z) = N(0, I)'],
      ['decoder', 'output', 'flow'],
      ['kl_compare', 'encoder', 'residual', 'KL gradient: pulls q(z|x) toward the prior'],
      ['output', 'encoder', 'residual', 'reconstruction gradient — together the two make up the ELBO'],
    ],
  }),
};
