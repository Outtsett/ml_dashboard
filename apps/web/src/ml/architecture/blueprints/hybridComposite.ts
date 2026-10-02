/**
 * Blueprints — Hybrid & Composite Architectures.
 *
 * One entry per catalog spec id, stages in data-flow order, every parameter
 * count from `P`. Follows the depth, style and structure of `recurrent.ts`
 * (the reference group).
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const C = DIM.classes;

// ─── Classical Hybrids ──────────────────────────────────────────────────────

const rnnCnnHybrid: ArchGraph = blueprint({
  title: 'RNN-CNN Hybrid',
  subtitle: `Conv1d feature extractor · LSTM sequence reader · ${T}-bar window`,
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
      outShape: `B × ${T} × ${F}`, column: 0,
      analogy: 'Think of it as the last 64 candles laid out left to right, each with its 35 measurements.',
    },
    {
      id: 'reshape', kind: 'reshape', label: 'Channels-first', sublabel: `${F} channels × ${T} steps`,
      inShape: `B × ${T} × ${F}`, outShape: `B × ${F} × ${T}`, column: 1,
    },
    {
      id: 'conv', kind: 'conv', label: 'Conv1d feature extractor', sublabel: '64 channels · kernel 3',
      inShape: `B × ${F} × ${T}`, outShape: `B × 64 × ${T}`, params: P.conv1d(F, 64, 3), column: 2,
      detail: { channels: `${F} → 64`, kernel: 3, formula: 'channelsOut·channelsIn·kernel + channelsOut' },
      analogy: 'Think of it as 64 pattern-matchers sliding across the candles at once, each hunting one shape like a doji or a gap.',
    },
    {
      id: 'pool1', kind: 'pool', label: 'Max pool', sublabel: 'stride 2',
      inShape: `B × 64 × ${T}`, outShape: `B × 64 × ${T / 2}`, column: 3,
    },
    {
      id: 'steps', kind: 'reshape', label: 'Back to steps-first', sublabel: `${T / 2} steps × 64 channels`,
      inShape: `B × 64 × ${T / 2}`, outShape: `B × ${T / 2} × 64`, column: 4,
    },
    {
      id: 'lstm', kind: 'recurrent', label: 'LSTM sequence reader', sublabel: '128 units · 4 gates',
      inShape: `B × ${T / 2} × 64`, outShape: `B × ${T / 2} × 128`, params: P.lstm(64, 128), column: 5,
      detail: { 'hidden units': 128, formula: '4·H·(64 + H + 2)' },
      analogy: 'Think of it as a trader reading the pattern-matcher output bar by bar, carrying forward whatever mattered.',
    },
    {
      id: 'last', kind: 'pool', label: 'Last hidden state', sublabel: 'h at the final pooled step',
      inShape: `B × ${T / 2} × 128`, outShape: 'B × 128', column: 6,
    },
    {
      id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 128 → ${C}`,
      inShape: 'B × 128', outShape: `B × ${C}`, params: P.linear(128, C), column: 7,
    },
    {
      id: 'output', kind: 'output', label: 'Down · flat · up', sublabel: 'softmax probabilities',
      outShape: `B × ${C}`, column: 8,
    },
  ],
  edges: chain('input', 'reshape', 'conv', 'pool1', 'steps', 'lstm', 'last', 'head', 'output'),
});

const stackedEnsembleModel: ArchGraph = blueprint({
  title: 'Stacked Ensemble Model',
  subtitle: '3 level-0 base learners · linear level-1 meta-model',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
      analogy: 'Think of it as the same bar handed to three different traders at once, each using their own method.',
    },
    {
      id: 'gbt', kind: 'ensemble', label: 'Gradient-boosted trees', sublabel: '300 trees · depth 6',
      inShape: `B × ${F}`, outShape: 'B × 1', column: 1, lane: 0,
      detail: { trees: 300, 'max depth': 6, stored: 'split thresholds and leaf values, not dense weights' },
      analogy: 'Think of it as one trader who only trades threshold rules, like "go long when RSI crosses 70".',
    },
    {
      id: 'linreg', kind: 'linear', label: 'Linear model', sublabel: `Linear ${F} → 1`,
      inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 1,
      analogy: 'Think of it as a trader with one simple rule blending all 35 readings by fixed weights.',
    },
    {
      id: 'mlp', kind: 'linear', label: 'Small MLP', sublabel: `${F} → 64 → 1`,
      inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 64) + P.linear(64, 1), column: 1, lane: 2,
    },
    {
      id: 'stack', kind: 'fusion', label: 'Out-of-fold stack', sublabel: 'concat 3 base predictions',
      inShape: 'B × 1, B × 1, B × 1', outShape: 'B × 3', column: 2,
      detail: { 'why out-of-fold': 'each base prediction is made on a fold the base learner did not see, or the meta-model learns the base learners\' memorized answers' },
      analogy: 'Think of it as writing down each specialist\'s call only for the days they were not allowed to look at.',
    },
    {
      id: 'meta', kind: 'linear', label: 'Meta-model', sublabel: 'Linear 3 → 1',
      inShape: 'B × 3', outShape: 'B × 1', params: P.linear(3, 1), column: 3,
      analogy: 'Think of it as a head trader listening to all three specialists and weighting each by how well its calls have paid off.',
    },
    {
      id: 'output', kind: 'output', label: 'Blended prediction', outShape: 'B × 1', column: 4,
    },
  ],
  edges: [
    ['input', 'gbt'], ['input', 'linreg'], ['input', 'mlp'],
    ['gbt', 'stack'], ['linreg', 'stack'], ['mlp', 'stack'],
    ...chain('stack', 'meta', 'output'),
  ],
});

// ─── Composite Controllers & Planners ──────────────────────────────────────

const hybridDifferentiablePlanner: ArchGraph = blueprint({
  title: 'Hybrid Differentiable Planner',
  subtitle: 'learned latent dynamics · relaxed plan search · receding horizon',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
      outShape: `B × ${T} × ${F}`, column: 0,
    },
    {
      id: 'encoder', kind: 'recurrent', label: 'Latent encoder', sublabel: 'LSTM, last hidden = z',
      inShape: `B × ${T} × ${F}`, outShape: 'B × 32', params: P.lstm(F, 32), column: 1,
      analogy: 'Think of it as compressing the last 64 candles into one short note describing what the market is doing.',
    },
    {
      id: 'candidates', kind: 'stochastic', label: 'Candidate plan sampler', sublabel: 'N = 64 plans × H = 8 positions',
      inShape: 'B × 32', outShape: 'B × 64 × 8', column: 2,
      detail: {
        'candidate plans': 64,
        horizon: 8,
        gradient: 'the plans are sampled constants — gradient reaches the networks through each plan\'s value, not through the plan itself',
      },
      analogy: 'Think of it as throwing 64 different what-if trade plans at the wall before picking one.',
    },
    {
      id: 'transition', kind: 'recurrent', label: 'Transition rollout', sublabel: 'GRU cell, unrolled H = 8 steps',
      inShape: 'B × 64 × 8 × (32 + 1)', outShape: 'B × 64 × 8 × 32', params: P.gru(33, 32), column: 3,
      detail: { inputs: 'latent (32) + that step\'s position (1)', formula: '3·H·(33 + H + 2)', weights: 'one cell, shared across the 8 unrolled steps' },
      analogy: 'Think of it as walking every what-if plan forward candle by candle, updating the market read as the plan trades it.',
    },
    {
      id: 'reward', kind: 'linear', label: 'Reward head', sublabel: 'per step: return minus turnover cost',
      inShape: 'B × 64 × 8 × 33', outShape: 'B × 64 × 8', params: P.linear(33, 1), column: 4,
      analogy: 'Think of it as marking each candle of each plan to market, charging the commission and slippage every time the position changes.',
    },
    {
      id: 'planvalue', kind: 'pool', label: 'Discounted plan value', sublabel: 'sum over the 8 steps, discount gamma',
      inShape: 'B × 64 × 8', outShape: 'B × 64', column: 5,
      analogy: 'Think of it as totalling what each what-if plan would have earned over the whole horizon, after costs.',
    },
    {
      id: 'planscore', kind: 'compare', label: 'Softmax plan weights', sublabel: 'temperature tau over the 64 plan values',
      inShape: 'B × 64', outShape: 'B × 64', column: 6,
      analogy: 'Think of it as ranking the 64 what-if plans by how much profit each would have made, then leaning toward the best ones instead of committing to just one.',
    },
    {
      id: 'softplan', kind: 'fusion', label: 'Soft plan blend', sublabel: 'weight-average the candidates\' first position',
      inShape: 'B × 64, B × 64 × 8', outShape: 'B × 1', column: 7,
    },
    {
      id: 'output', kind: 'output', label: 'Next-bar position', sublabel: 'in [-1, 1], first action of the plan',
      outShape: 'B × 1', column: 8,
      analogy: 'Think of it as trading only tomorrow\'s step of the plan and throwing the rest away, because the plan gets redrawn on the next candle.',
    },
  ],
  edges: [
    ...chain('input', 'encoder', 'candidates', 'transition', 'reward', 'planvalue', 'planscore', 'softplan', 'output'),
    ['encoder', 'transition', 'context', 'initial latent z'],
    ['candidates', 'reward', 'context', 'position at each step'],
    ['candidates', 'softplan', 'context', 'first position of each plan'],
  ],
});

const treeBoostedNeuralEmbedding: ArchGraph = blueprint({
  title: 'Tree-Boosted Neural Embedding',
  subtitle: 'frozen GBT leaves as a learned categorical feature space',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'trees', kind: 'ensemble', label: 'Boosted trees', sublabel: '100 trees · depth 6, frozen after fitting',
      inShape: `B × ${F}`, outShape: 'B × 100 (leaf id)', column: 1,
      detail: {
        trees: 100,
        'max depth': 6,
        'leaves/tree ≤': '2^6 = 64',
        stored: 'split thresholds and leaf values, not dense weights — and frozen, so nothing here is trained by the neural stage',
      },
      analogy: 'Think of it as 100 traders, each drawing one threshold rule on the 35 features, and recording which bucket today falls in rather than their verdict.',
    },
    {
      id: 'leafidx', kind: 'reshape', label: 'Leaf index matrix', sublabel: 'cached once per fold, integer valued',
      inShape: 'B × 100 (leaf id)', outShape: 'B × 100 (int)', column: 2,
    },
    {
      id: 'embed', kind: 'embedding', label: 'Leaf embedding table', sublabel: '6,400 entries × 8-d, one table per tree',
      inShape: 'B × 100 (int)', outShape: 'B × 800', params: P.embedding(6400, 8), column: 3,
      detail: { entries: '100 trees × 64 leaves = 6,400', width: 8, formula: 'entries · width' },
      analogy: 'Think of it as giving each of the 6,400 possible tree-buckets its own short numeric tag the network can learn to place near similarly-behaving buckets.',
    },
    {
      id: 'concat', kind: 'fusion', label: 'Concat embeddings + features', sublabel: `800 + ${F}`,
      inShape: `B × 800, B × ${F}`, outShape: `B × ${800 + F}`, column: 4,
    },
    {
      id: 'head', kind: 'linear', label: 'Neural head', sublabel: `${800 + F} → 64 → ${C}`,
      inShape: `B × ${800 + F}`, outShape: `B × ${C}`, params: P.linear(800 + F, 64) + P.linear(64, C), column: 5,
    },
    {
      id: 'output', kind: 'output', label: 'Class probabilities', outShape: `B × ${C}`, column: 6,
    },
  ],
  edges: [
    ...chain('input', 'trees', 'leafidx', 'embed', 'concat', 'head', 'output'),
    ['input', 'concat', 'flow', 'continuous features, kept alongside the leaf buckets'],
  ],
});

// ─── Generative-Discriminative Hybrids ─────────────────────────────────────

const autoencoderGanFusion: ArchGraph = blueprint({
  title: 'Autoencoder-GAN Fusion',
  subtitle: 'VAE encoder/decoder trained jointly against an adversarial discriminator',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Real bar window', sublabel: `${T} bars × ${F} features`,
      outShape: `B × ${T} × ${F}`, column: 0,
    },
    {
      id: 'flatten', kind: 'reshape', label: 'Flatten window', sublabel: `${T} × ${F} → ${T * F}`,
      inShape: `B × ${T} × ${F}`, outShape: `B × ${T * F}`, column: 1,
    },
    {
      id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `Linear ${T * F} → 64 (mu ‖ log-var)`,
      inShape: `B × ${T * F}`, outShape: 'B × 64', params: P.linear(T * F, 64), column: 2,
      detail: { 'latent width': 32, outputs: 'mean (32) and log-variance (32), stacked' },
      analogy: 'Think of it as compressing the bar window into its essential shape, and saying how sure it is of each part of that shape.',
    },
    {
      id: 'latentz', kind: 'stochastic', label: 'Latent sample z', sublabel: 'reparameterize: z = mu + sigma·eps',
      inShape: 'B × 64', outShape: 'B × 32', column: 3,
      analogy: 'Think of it as adding a pinch of randomness to that shape so the model can imagine variations on it.',
    },
    {
      id: 'decoder', kind: 'linear', label: 'Decoder / generator', sublabel: `Linear 32 → ${T * F}`,
      inShape: 'B × 32', outShape: `B × ${T * F}`, params: P.linear(32, T * F), column: 4, lane: 0,
      analogy: 'Think of it as rebuilding the whole candle window from that short note, and doubling as the forger the skeptic has to catch.',
    },
    {
      id: 'kl', kind: 'compare', label: 'KL to prior', sublabel: 'latent regularizer against N(0, I)',
      inShape: 'B × 64', column: 4, lane: 2,
      analogy: 'Think of it as a rule keeping the model\'s shorthand for the market tidy, so notes that sit near each other describe markets that behave alike.',
    },
    {
      id: 'recon', kind: 'compare', label: 'Reconstruction loss', sublabel: 'MSE(x, x_hat)',
      inShape: `B × ${T * F}, B × ${T * F}`, column: 5, lane: 0,
      analogy: 'Think of it as checking how closely the rebuilt candles match the originals.',
    },
    {
      id: 'disc', kind: 'compare', label: 'Discriminator', sublabel: 'real vs generated, sigmoid',
      inShape: `B × ${T * F}`, outShape: 'B × 1', params: P.linear(T * F, 64) + P.linear(64, 1), column: 5, lane: 1,
      analogy: 'Think of it as a skeptical second trader whose only job is telling real candles from the model\'s invented ones.',
    },
    {
      id: 'output', kind: 'output', label: 'Generated / reconstructed window', outShape: `B × ${T * F}`, column: 6,
    },
  ],
  edges: [
    ['input', 'flatten'], ['flatten', 'encoder'], ['encoder', 'latentz'], ['latentz', 'decoder'], ['decoder', 'output'],
    ['encoder', 'kl'],
    ['flatten', 'recon'], ['decoder', 'recon'],
    ['flatten', 'disc'], ['decoder', 'disc'],
    ['disc', 'decoder', 'context', 'adversarial gradient'],
    ['recon', 'decoder', 'context', 'reconstruction gradient'],
    ['kl', 'encoder', 'context', 'latent regularizer gradient'],
  ],
});

const bayesianNeuralHybridModel: ArchGraph = blueprint({
  title: 'Bayesian-Neural Hybrid Model',
  subtitle: 'variational weight distributions · Monte Carlo predictive uncertainty',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'backbone', kind: 'linear', label: 'Feature backbone', sublabel: `Linear ${F} → 64`,
      inShape: `B × ${F}`, outShape: 'B × 64', params: P.linear(F, 64), column: 1,
    },
    {
      id: 'bayes', kind: 'stochastic', label: 'Bayesian linear layer', sublabel: 'weight ~ N(mu, sigma^2), reparameterized',
      inShape: 'B × 64', outShape: `B × ${C}`, params: 2 * P.linear(64, C), column: 2,
      detail: { 'learned params': 'mean + log-variance per weight and bias', formula: '2 · linear(64 → 3)' },
      analogy: 'Think of it as every synapse in the last layer holding not one number but a small range of guesses, admitting how sure it is.',
    },
    {
      id: 'mcsample', kind: 'stochastic', label: 'Monte Carlo sampling', sublabel: 'K = 20 forward passes',
      inShape: `B × ${C}`, outShape: `K × B × ${C}`, column: 3,
    },
    {
      id: 'aggregate', kind: 'pool', label: 'Predictive aggregate', sublabel: 'mean & variance over K samples',
      inShape: `K × B × ${C}`, outShape: `B × ${C} (×2)`, column: 4,
      analogy: 'Think of it as asking the model the same question 20 times and reporting both its average answer and how much its answers disagreed.',
    },
    {
      id: 'output', kind: 'output', label: 'Prediction ± uncertainty', outShape: `B × ${C} mean, B × ${C} variance`, column: 5,
    },
  ],
  edges: [
    ...chain('input', 'backbone', 'bayes', 'mcsample', 'aggregate', 'output'),
    ['mcsample', 'bayes', 'context', 'resample weights each pass'],
  ],
});

// ─── Graph & Attention Hybrids ──────────────────────────────────────────────

const gnnReinforcementLearnerHybrid: ArchGraph = blueprint({
  title: 'GNN + Reinforcement Learner Hybrid',
  subtitle: 'instrument-graph message passing feeds an actor-critic',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Instrument graph state', sublabel: `N instruments × ${F} features + adjacency`,
      outShape: `B × N × ${F}`, column: 0,
    },
    {
      id: 'gnnlayer', kind: 'fusion', label: 'GNN message passing', sublabel: 'mean-aggregate neighbours, 1 layer',
      inShape: `B × N × ${F}`, outShape: 'B × N × 64', params: P.linear(F, 64) + P.linear(64, 64), column: 1,
      detail: { message: `linear(${F} → 64)`, update: 'linear(64 → 64)', aggregator: 'mean over neighbours' },
      analogy: 'Think of it as each instrument asking its neighbours — the pairs and contracts sharing its currency or index — what they\'re doing right now, and blending the answers in.',
    },
    {
      id: 'embedding', kind: 'pool', label: 'Graph state embedding', sublabel: 'pooled over nodes → RL state',
      inShape: 'B × N × 64', outShape: 'B × 64', column: 2,
      analogy: 'Think of it as boiling the whole board of instruments down to one description of the market the agent is trading into.',
    },
    {
      id: 'actor', kind: 'head', label: 'Policy head (actor)', sublabel: `Linear 64 → ${C}`,
      inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 3, lane: 0,
      analogy: 'Think of it as the part of the agent that decides whether to buy, hold or sell right now.',
    },
    {
      id: 'critic', kind: 'head', label: 'Value head (critic)', sublabel: 'Linear 64 → 1',
      inShape: 'B × 64', outShape: 'B × 1', params: P.linear(64, 1), column: 3, lane: 1,
      analogy: 'Think of it as a second voice estimating how good the current position is — used only to steady the actor\'s training, never traded on directly.',
    },
    {
      id: 'output', kind: 'output', label: 'Trading action', sublabel: 'softmax over actor logits',
      outShape: `B × ${C}`, column: 4,
    },
  ],
  edges: [
    ...chain('input', 'gnnlayer', 'embedding'),
    ['embedding', 'actor'], ['embedding', 'critic'], ['actor', 'output'],
    ['critic', 'actor', 'context', 'advantage baseline'],
  ],
});

const graphAugmentedLstm: ArchGraph = blueprint({
  title: 'Graph-Augmented LSTM',
  subtitle: 'shared per-instrument LSTM · one graph-mixing pass at the final step',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Panel bar window', sublabel: `N instruments × ${T} bars × ${F} features + adjacency`,
      outShape: `N × ${T} × ${F}`, column: 0,
      detail: { adjacency: 'shared currency leg or index complex, or trailing correlation thresholded inside the fold' },
      analogy: 'Think of it as every instrument on the board getting the same 64-candle treatment, plus a map of which ones move together.',
    },
    {
      id: 'lstm', kind: 'recurrent', label: 'Per-node LSTM (shared)', sublabel: '128 units · 4 gates',
      inShape: `N × ${T} × ${F}`, outShape: `N × ${T} × 128`, params: P.lstm(F, 128), column: 1,
      analogy: 'Think of it as running the same reader on every instrument\'s own candles, in parallel, using the exact same notepad rules for all of them.',
    },
    {
      id: 'cell', kind: 'memory', label: 'Cell state (per node)', sublabel: 'additive carry, bar to bar',
      outShape: 'N × 128', column: 1, lane: 1,
    },
    {
      id: 'lasthidden', kind: 'pool', label: 'Last hidden per node', sublabel: 'h at the final bar',
      inShape: `N × ${T} × 128`, outShape: 'N × 128', column: 2,
    },
    {
      id: 'graphconv', kind: 'fusion', label: 'Graph convolution', sublabel: 'normalized adjacency, 1 layer, ReLU',
      inShape: 'N × 128', outShape: 'N × 128', params: P.linear(128, 128, false), column: 3,
      detail: { formula: 'A_hat · H · W_g, no bias', adjacency: 'self-loops + degree normalized' },
      analogy: 'Think of it as each instrument then checking in with its currency- or index-linked neighbours and blending its own read with theirs.',
    },
    {
      id: 'head', kind: 'head', label: 'Per-node direction head', sublabel: `Linear 128 → ${C}`,
      inShape: 'N × 128', outShape: `N × ${C}`, params: P.linear(128, C), column: 4,
    },
    {
      id: 'output', kind: 'output', label: 'Down · flat · up, per instrument', outShape: `N × ${C}`, column: 5,
    },
  ],
  edges: [
    ...chain('input', 'lstm', 'lasthidden', 'graphconv', 'head', 'output'),
    ['lstm', 'cell', 'context', 'write'],
    ['cell', 'lstm', 'context', 'read at next bar'],
  ],
});

const latentAttentionDecisionGraph: ArchGraph = blueprint({
  title: 'Latent Attention Decision Graph',
  subtitle: 'K = 8 induced latents · attention-derived graph · differentiable routing',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
      outShape: `B × ${T} × ${F}`, column: 0,
    },
    {
      id: 'barenc', kind: 'linear', label: 'Bar encoder', sublabel: `Linear ${F} → 64 + positional`,
      inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × 64`, params: P.linear(F, 64), column: 1,
      detail: { positional: 'sinusoidal — fixed, so it adds nothing to the count' },
    },
    {
      id: 'crossattn', kind: 'attention', label: 'Latent cross-attention', sublabel: `K = 8 inducing latents attend into ${T} bars`,
      inShape: `B × ${T} × 64`, outShape: 'B × 8 × 64', params: P.attention(64) + P.embedding(8, 64), column: 2,
      detail: { cost: 'O(K·L·d) instead of O(L^2·d)', latents: 8, 'learned latent array': '8 × 64, the queries themselves are parameters' },
      analogy: 'Think of it as squeezing the whole 64-bar story down into 8 short summary notes, each written by looking across every candle at once.',
    },
    {
      id: 'latentmp', kind: 'attention', label: 'Latent graph message passing', sublabel: 'R = 2 rounds among the 8 latents',
      inShape: 'B × 8 × 64', outShape: 'B × 8 × 64', params: P.attention(64) + P.feedForward(64, 128) + P.norm(64), column: 3,
      detail: { rounds: 2, weights: 'shared across the 2 rounds', adjacency: 'softmax of latent-to-latent scores, recomputed each forward pass' },
      analogy: 'Think of it as those 8 notes comparing themselves to each other and updating, so a "low volatility" note can be pulled toward a "trend up" note when they\'re related.',
    },
    {
      id: 'pool', kind: 'pool', label: 'Mean pool latents', sublabel: '8 latents → 1 vector',
      inShape: 'B × 8 × 64', outShape: 'B × 64', column: 4,
    },
    {
      id: 'routing', kind: 'gate', label: 'Decision graph routing', sublabel: '3 softmax gates route probability mass to 4 leaves',
      inShape: 'B × 64', outShape: 'B × 4', params: 3 * P.linear(64, 2), column: 5,
      detail: { 'internal nodes': 3, leaves: 4, 'per gate': 'linear(64 → 2), one logit per child', 'mass': 'leaf mass is the product of the gates along its path' },
      analogy: 'Think of it as the pooled note walking down a fork in the road, at each fork getting a percentage vote for "go left" vs "go right" based on what it read.',
    },
    {
      id: 'leaves', kind: 'head', label: 'Leaf logit mixture', sublabel: '4 leaves, each carrying its own action logits',
      inShape: 'B × 4', outShape: `B × ${C}`, params: P.linear(4, C, false), column: 6,
      detail: { formula: 'sum over leaves of leaf mass × that leaf\'s logits', bias: 'none — the mass already sums to 1' },
      analogy: 'Think of it as each end of the decision tree holding a standing call, and the answer being those calls mixed by how much of the decision reached each one.',
    },
    {
      id: 'output', kind: 'output', label: 'Leaf-mixture prediction', outShape: `B × ${C}`, column: 7,
    },
  ],
  edges: chain('input', 'barenc', 'crossattn', 'latentmp', 'pool', 'routing', 'leaves', 'output'),
});

const transformerGnnHybrid: ArchGraph = blueprint({
  title: 'Transformer-GNN Hybrid',
  subtitle: 'causal temporal attention per instrument · message passing across instruments',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Panel bar window', sublabel: `N instruments × ${T} bars × ${F} features + adjacency`,
      outShape: `N × ${T} × ${F}`, column: 0,
      detail: { adjacency: 'edge list over instruments, estimated inside the fold', masking: 'the time axis is causally masked, the graph axis is not' },
    },
    {
      id: 'proj', kind: 'linear', label: 'Feature projection', sublabel: `Linear ${F} → 64`,
      inShape: `N × ${T} × ${F}`, outShape: `N × ${T} × 64`, params: P.linear(F, 64), column: 1,
    },
    {
      id: 'attn', kind: 'attention', label: 'Causal self-attention', sublabel: 'per instrument, masked lower-triangular',
      inShape: `N × ${T} × 64`, outShape: `N × ${T} × 64`, params: P.encoderLayer(64, 256), column: 2,
      detail: { mask: 'bar j is visible to bar i only when j ≤ i', 'feed-forward inner': 256 },
      analogy: 'Think of it as a pair reading its own last 64 candles, always looking backward, never ahead.',
    },
    {
      id: 'laststep', kind: 'pool', label: 'Final-bar representation', sublabel: 'one vector per instrument',
      inShape: `N × ${T} × 64`, outShape: 'N × 64', column: 3,
      analogy: 'Think of it as asking each instrument for its read only once the newest candle has closed.',
    },
    {
      id: 'mp', kind: 'fusion', label: 'Graph message passing', sublabel: 'mean-aggregate over instrument neighbours',
      inShape: 'N × 64', outShape: 'N × 64', params: P.linear(64, 64) + P.linear(128, 64), column: 4,
      detail: { message: 'linear(64 → 64) per neighbour', aggregator: 'mean over neighbours', update: 'linear(128 → 64) on [own state ‖ aggregate]' },
      analogy: 'Think of it as that pair checking what its currency-linked or index-linked neighbours are doing on this very bar.',
    },
    {
      id: 'fused', kind: 'fusion', label: 'LayerNorm(h + message passing)', sublabel: 'residual sum, then normalize',
      inShape: 'N × 64, N × 64', outShape: 'N × 64', params: P.norm(64), column: 5,
      analogy: 'Think of it as blending the pair\'s own history with what its neighbours just did into one combined read.',
    },
    {
      id: 'head', kind: 'head', label: 'Per-node direction head', sublabel: `Linear 64 → ${C}`,
      inShape: 'N × 64', outShape: `N × ${C}`, params: P.linear(64, C), column: 6,
    },
    {
      id: 'output', kind: 'output', label: 'Per-instrument prediction', outShape: `N × ${C}`, column: 7,
    },
  ],
  edges: [
    ...chain('input', 'proj', 'attn', 'laststep', 'mp', 'fused', 'head', 'output'),
    ['laststep', 'fused', 'residual', 'the instrument\'s own read, kept beside its neighbours\''],
  ],
});

// ─── Multi-Modal & Temporal Fusion ──────────────────────────────────────────

const attentionWeightedForecastStack: ArchGraph = blueprint({
  title: 'Attention-Weighted Forecast Stack',
  subtitle: '3 base forecasters blended by a learned, context-conditioned attention weight',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
      outShape: `B × ${T} × ${F}`, column: 0,
    },
    {
      id: 'lstm', kind: 'recurrent', label: 'LSTM forecaster', sublabel: '64 units → 1 forecast',
      inShape: `B × ${T} × ${F}`, outShape: 'B × 1', params: P.lstm(F, 64) + P.linear(64, 1), column: 2, lane: 0,
      detail: { formula: `4·H·(${F} + H + 2) + linear(64 → 1) on the final hidden state` },
      analogy: 'Think of it as a trader reading the candles in order and calling the next one.',
    },
    {
      id: 'channels', kind: 'reshape', label: 'Channels-first', sublabel: `${F} channels × ${T} steps`,
      inShape: `B × ${T} × ${F}`, outShape: `B × ${F} × ${T}`, column: 1, lane: 1,
    },
    {
      id: 'cnn', kind: 'conv', label: 'CNN forecaster', sublabel: '64 channels, kernel 3 → global max pool → 1 forecast',
      inShape: `B × ${F} × ${T}`, outShape: 'B × 1', params: P.conv1d(F, 64, 3) + P.linear(64, 1), column: 2, lane: 1,
      detail: { channels: `${F} → 64`, kernel: 3, pooling: 'max over the time axis, then linear(64 → 1)' },
      analogy: 'Think of it as a pattern-matcher scanning the window for the shape that usually precedes a move, and calling from the strongest match.',
    },
    {
      id: 'lags', kind: 'reshape', label: 'Close lag vector', sublabel: 'last 5 log returns',
      inShape: `B × ${T} × ${F}`, outShape: 'B × 5', column: 1, lane: 2,
    },
    {
      id: 'arima', kind: 'linear', label: 'ARIMA forecaster', sublabel: 'AR(5) coefficients',
      inShape: 'B × 5', outShape: 'B × 1', params: P.linear(5, 1), column: 2, lane: 2,
      detail: { note: 'fit per fold by least squares, not backprop — tiny beside the neural branches' },
      analogy: 'Think of it as the textbook baseline that just extrapolates the last five moves.',
    },
    {
      id: 'context', kind: 'reshape', label: 'Newest bar features', sublabel: 'conditioning row for the weights',
      inShape: `B × ${T} × ${F}`, outShape: `B × ${F}`, column: 1, lane: 3,
    },
    {
      id: 'stack', kind: 'fusion', label: 'Stack base forecasts', sublabel: 'concat 3 scalar forecasts',
      inShape: 'B × 1, B × 1, B × 1', outShape: 'B × 3', column: 3,
    },
    {
      id: 'attnw', kind: 'attention', label: 'Attention weights', sublabel: 'softmax over 3 forecasters, conditioned on the newest bar',
      inShape: `B × 3, B × ${F}`, outShape: 'B × 3', params: P.linear(3 + F, 3), column: 4,
      detail: { inputs: `the 3 forecasts plus the ${F} current features`, normalization: 'softmax, so the three weights sum to 1' },
      analogy: 'Think of it as a head trader deciding, bar by bar, how much to trust the LSTM reader, the CNN pattern-matcher, and the classic statistical model.',
    },
    {
      id: 'blend', kind: 'fusion', label: 'Weighted blend', sublabel: 'y_hat = sum(alpha_k · yhat_k)',
      inShape: 'B × 3, B × 3', outShape: 'B × 1', column: 5,
    },
    {
      id: 'output', kind: 'output', label: 'Blended forecast', outShape: 'B × 1', column: 6,
    },
  ],
  edges: [
    ['input', 'lstm'], ...chain('input', 'channels', 'cnn'), ...chain('input', 'lags', 'arima'),
    ['input', 'context'],
    ['lstm', 'stack'], ['cnn', 'stack'], ['arima', 'stack'],
    ['stack', 'attnw'], ['context', 'attnw', 'context', 'conditioning features'],
    ['stack', 'blend'], ['attnw', 'blend'],
    ['blend', 'output'],
  ],
});

const hierarchicalTaskOrientedAgent: ArchGraph = blueprint({
  title: 'Hierarchical Task-Oriented Agent',
  subtitle: 'high-level subgoal policy over low-level trading actions',
  nodes: [
    {
      id: 'priceIn', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
      outShape: `B × ${T} × ${F}`, column: 0, lane: 0,
    },
    {
      id: 'newsIn', kind: 'input', label: 'Headline embeddings', sublabel: '20 headlines × 768-d',
      outShape: 'B × 20 × 768', column: 0, lane: 1,
    },
    {
      id: 'priceEnc', kind: 'recurrent', label: 'Price encoder', sublabel: 'LSTM, last hidden',
      inShape: `B × ${T} × ${F}`, outShape: 'B × 64', params: P.lstm(F, 64), column: 1, lane: 0,
    },
    {
      id: 'newsEnc', kind: 'linear', label: 'News encoder', sublabel: 'pretrained embeddings, pooled → 64-d',
      inShape: 'B × 20 × 768', outShape: 'B × 64', params: P.linear(768, 64), column: 1, lane: 1,
    },
    {
      id: 'fusion', kind: 'fusion', label: 'Multi-modal fusion', sublabel: 'concat(128) → Linear 128 → 64',
      inShape: 'B × 64, B × 64', outShape: 'B × 64', params: P.linear(128, 64), column: 2,
    },
    {
      id: 'highlevel', kind: 'gate', label: 'High-level policy (subgoals)', sublabel: 'accumulate · hold · reduce · exit',
      inShape: 'B × 64', outShape: 'B × 4', params: P.linear(64, 4), column: 3,
      analogy: 'Think of it as a desk head deciding the broad plan for the next stretch of bars — build a position, hold, trim, or get flat.',
    },
    {
      id: 'lowlevel', kind: 'head', label: 'Low-level policy (actions)', sublabel: 'state + subgoal → action',
      inShape: 'B × 64, B × 4', outShape: `B × ${C}`, params: P.linear(68, C), column: 4,
      detail: { inputs: 'fused state (64) concatenated with the one-hot subgoal (4)' },
      analogy: 'Think of it as the trader on the desk who actually clicks buy or sell, but only within whatever plan the desk head just set.',
    },
    {
      id: 'output', kind: 'output', label: 'Trading action', outShape: `B × ${C}`, column: 5,
    },
  ],
  edges: [
    ...chain('priceIn', 'priceEnc'), ...chain('newsIn', 'newsEnc'),
    ['priceEnc', 'fusion'], ['newsEnc', 'fusion'],
    ...chain('fusion', 'highlevel', 'lowlevel', 'output'),
    ['fusion', 'lowlevel', 'flow', 'fused state, conditioned on the subgoal'],
  ],
});

const multiModalReasoningAgent: ArchGraph = blueprint({
  title: 'Multi-Modal Reasoning Agent',
  subtitle: 'price, news and neighbour-market encoders fused by cross-modal attention, then reasoned over',
  nodes: [
    {
      id: 'priceIn', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
      outShape: `B × ${T} × ${F}`, column: 0, lane: 0,
    },
    {
      id: 'newsIn', kind: 'input', label: 'Headline embeddings', sublabel: '20 headlines × 768-d',
      outShape: 'B × 20 × 768', column: 0, lane: 1,
    },
    {
      id: 'graphIn', kind: 'input', label: 'Related-instrument snapshot', sublabel: '5 correlated instruments',
      outShape: `B × 5 × ${F}`, column: 0, lane: 2,
    },
    {
      id: 'priceEnc', kind: 'recurrent', label: 'Price encoder', sublabel: 'LSTM, last hidden',
      inShape: `B × ${T} × ${F}`, outShape: 'B × 64', params: P.lstm(F, 64), column: 1, lane: 0,
    },
    {
      id: 'newsEnc', kind: 'linear', label: 'News encoder', sublabel: 'pretrained embeddings, pooled → 64-d',
      inShape: 'B × 20 × 768', outShape: 'B × 64', params: P.linear(768, 64), column: 1, lane: 1,
    },
    {
      id: 'graphEnc', kind: 'attention', label: 'Neighbour-market encoder', sublabel: 'attention pooling over 5 neighbours',
      inShape: `B × 5 × ${F}`, outShape: 'B × 64', params: P.linear(F, 64) + P.attention(64), column: 1, lane: 2,
    },
    {
      id: 'fusion', kind: 'attention', label: 'Cross-modal attention fusion', sublabel: 'price, news and neighbours attend to each other',
      inShape: 'B × 3 × 64', outShape: 'B × 64', params: P.attention(64), column: 2,
      analogy: 'Think of it as three analysts — one reading price, one reading headlines, one watching related markets — comparing notes and deciding which one\'s read matters most right now.',
    },
    {
      id: 'reasoning', kind: 'compare', label: 'Reasoning module', sublabel: 'MLP + rule-consistency check over the fused state',
      inShape: 'B × 64', outShape: 'B × 64', params: P.linear(64, 64), column: 3,
      detail: { variant: 'the neuro-symbolic reasoner; the RL-policy and probabilistic reasoners are the other two forms of this stage', 'rule check': 'fixed, non-learned — only the MLP carries weights' },
      analogy: 'Think of it as a final gut-check: does this fused read actually agree with itself, or is one modality pulling against the other two?',
    },
    {
      id: 'head', kind: 'head', label: 'Decision policy', sublabel: `Linear 64 → ${C}`,
      inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 4,
    },
    {
      id: 'output', kind: 'output', label: 'Trading action', outShape: `B × ${C}`, column: 5,
    },
  ],
  edges: [
    ...chain('priceIn', 'priceEnc'), ...chain('newsIn', 'newsEnc'), ...chain('graphIn', 'graphEnc'),
    ['priceEnc', 'fusion'], ['newsEnc', 'fusion'], ['graphEnc', 'fusion'],
    ...chain('fusion', 'reasoning', 'head', 'output'),
  ],
});

const spatiotemporalFusionNetwork: ArchGraph = blueprint({
  title: 'Spatiotemporal Fusion Network',
  subtitle: 'spatial GNN branch and temporal LSTM branch blended by a learned gate',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Panel bar window + adjacency', sublabel: `N instruments × ${T} bars × ${F} features`,
      outShape: `N × ${T} × ${F}`, column: 0,
      analogy: 'Think of it as the whole board of instruments over the same 64 candles, plus a map of which ones move together.',
    },
    {
      id: 'spatial', kind: 'fusion', label: 'Spatial GNN', sublabel: 'mean-aggregate over instrument graph, per bar',
      inShape: `N × ${T} × ${F}`, outShape: `N × ${T} × 64`, params: P.linear(F, 64) + P.linear(64, 64), column: 1, lane: 0,
    },
    {
      id: 'temporal', kind: 'recurrent', label: 'Temporal LSTM', sublabel: 'per-node recurrence across 64 bars',
      inShape: `N × ${T} × ${F}`, outShape: `N × ${T} × 64`, params: P.lstm(F, 64), column: 1, lane: 1,
    },
    {
      id: 'gatefuse', kind: 'gate', label: 'Gated fusion', sublabel: 'sigmoid gate blends spatial & temporal',
      inShape: `N × ${T} × 128`, outShape: `N × ${T} × 64`, params: P.linear(128, 64), column: 2,
      detail: { gate: 'sigmoid(linear(128 → 64)) on [spatial ‖ temporal]', blend: 'gate · spatial + (1 − gate) · temporal' },
      analogy: 'Think of it as a dial that decides, bar by bar, whether the instrument\'s own recent history or its neighbours\' current behaviour should drive the call.',
    },
    {
      id: 'laststep', kind: 'pool', label: 'Final-bar state', sublabel: 'one vector per instrument',
      inShape: `N × ${T} × 64`, outShape: 'N × 64', column: 3,
    },
    {
      id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear 64 → ${C}`,
      inShape: 'N × 64', outShape: `N × ${C}`, params: P.linear(64, C), column: 4,
    },
    {
      id: 'output', kind: 'output', label: 'Per-instrument prediction', outShape: `N × ${C}`, column: 5,
    },
  ],
  edges: [
    ['input', 'spatial'], ['input', 'temporal'],
    ['spatial', 'gatefuse'], ['temporal', 'gatefuse'],
    ...chain('gatefuse', 'laststep', 'head', 'output'),
  ],
});

// ─── Neuro-Symbolic Systems ─────────────────────────────────────────────────

const differentiableLogicLayer: ArchGraph = blueprint({
  title: 'Differentiable Logic Layer',
  subtitle: 'learned predicates combined by soft AND / OR / NOT, trained end to end',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'backbone', kind: 'linear', label: 'Neural backbone', sublabel: `Linear ${F} → 64`,
      inShape: `B × ${F}`, outShape: 'B × 64', params: P.linear(F, 64), column: 1,
    },
    {
      id: 'predicates', kind: 'compare', label: 'Rule predicates', sublabel: '6 learned probes, sigmoid → [0,1]',
      inShape: 'B × 64', outShape: 'B × 6', params: P.linear(64, 6), column: 2,
      analogy: 'Think of it as 6 yes/no trading rules — like "RSI is overbought" — each restated as a number between 0 and 1 instead of a hard true/false.',
    },
    {
      id: 'logiccomp', kind: 'gate', label: 'Logic composition', sublabel: 'AND = product, OR = x+y-xy, NOT = 1-x',
      inShape: 'B × 6', outShape: 'B × 2', column: 3,
      analogy: 'Think of it as combining those 6 readings with AND / OR / NOT into higher-level verdicts, like "overbought AND rising volume".',
    },
    {
      id: 'taskhead', kind: 'head', label: 'Task head + logic constraint', sublabel: 'concat(h, logic outputs) → classes',
      inShape: 'B × 64, B × 2', outShape: `B × ${C}`, params: P.linear(66, C), column: 4,
      detail: { inputs: 'the 64-wide embedding concatenated with the 2 logic verdicts' },
    },
    {
      id: 'output', kind: 'output', label: 'Class probabilities', outShape: `B × ${C}`, column: 5,
    },
  ],
  edges: [
    ...chain('input', 'backbone', 'predicates', 'logiccomp', 'taskhead', 'output'),
    ['backbone', 'taskhead', 'residual', 'embedding h, kept beside the logic verdicts'],
  ],
});

const metaLearnedSymbolicRouter: ArchGraph = blueprint({
  title: 'Meta-Learned Symbolic Router',
  subtitle: '3 symbolic rules, weighted by a context-conditioned meta-router',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'rule1', kind: 'linear', label: 'Trend rule', sublabel: `Linear ${F} → 1`,
      inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 0,
      detail: { form: 'the rule is written as a differentiable score, so its threshold is learned rather than hand-set' },
      analogy: 'Think of it as the trend rule every desk knows, with the exact level it fires at learned from the tape instead of copied from a textbook.',
    },
    {
      id: 'rule2', kind: 'linear', label: 'Volatility rule', sublabel: `Linear ${F} → 1`,
      inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 1,
    },
    {
      id: 'rule3', kind: 'linear', label: 'Momentum rule', sublabel: `Linear ${F} → 1`,
      inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 2,
    },
    {
      id: 'router', kind: 'gate', label: 'Meta-router', sublabel: `Linear ${F} → 3, softmax`,
      inShape: `B × ${F}`, outShape: 'B × 3', params: P.linear(F, 3), column: 1, lane: 3,
      analogy: 'Think of it as a dispatcher who, bar by bar, decides how much to trust each of the three trading rules given current conditions.',
    },
    {
      id: 'blend', kind: 'fusion', label: 'Weighted rule blend', sublabel: 'y = sum(w_k · r_k(x))',
      inShape: 'B × 1, B × 1, B × 1, B × 3', outShape: 'B × 1', column: 2,
      detail: { inputs: 'the 3 rule scores and the router\'s 3 softmax weights' },
    },
    {
      id: 'output', kind: 'output', label: 'Blended decision', outShape: 'B × 1', column: 3,
    },
  ],
  edges: [
    ['input', 'rule1'], ['input', 'rule2'], ['input', 'rule3'], ['input', 'router'],
    ['rule1', 'blend'], ['rule2', 'blend'], ['rule3', 'blend'], ['router', 'blend'],
    ['blend', 'output'],
  ],
});

const neuroSymbolicModel: ArchGraph = blueprint({
  title: 'Neuro-Symbolic Model',
  subtitle: 'a learned backbone and a fixed, hand-authored rule bank fused before the head',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'backbone', kind: 'linear', label: 'Neural backbone', sublabel: `Linear ${F} → 64`,
      inShape: `B × ${F}`, outShape: 'B × 64', params: P.linear(F, 64), column: 1, lane: 0,
      analogy: 'Think of it as the network forming its own read of the 35 features.',
    },
    {
      id: 'rulebank', kind: 'compare', label: 'Symbolic rule bank', sublabel: '5 hand-authored predicates on raw features',
      inShape: `B × ${F}`, outShape: 'B × 5', column: 1, lane: 1,
      detail: { rules: 'RSI > 70, MACD cross, ATR spike, volume spike, MA cross', weights: 'none — fixed, non-learned' },
      analogy: 'Think of it as a fixed rulebook of textbook trading signals running alongside the network, never learning, just always checking.',
    },
    {
      id: 'concat', kind: 'fusion', label: 'Concat h + rule outputs', sublabel: '64 + 5',
      inShape: 'B × 64, B × 5', outShape: 'B × 69', column: 2,
    },
    {
      id: 'head', kind: 'linear', label: 'Classification head', sublabel: `Linear 69 → ${C}`,
      inShape: 'B × 69', outShape: `B × ${C}`, params: P.linear(69, C), column: 3,
      analogy: 'Think of it as a final judge who reads both the network\'s learned hunch and the rulebook\'s checklist before deciding.',
    },
    {
      id: 'output', kind: 'output', label: 'Class probabilities', outShape: `B × ${C}`, column: 4,
    },
  ],
  edges: [
    ['input', 'backbone'], ['input', 'rulebank'],
    ['backbone', 'concat'], ['rulebank', 'concat'],
    ...chain('concat', 'head', 'output'),
  ],
});

const probabilisticProgramDeepNet: ArchGraph = blueprint({
  title: 'Probabilistic Program + DeepNet',
  subtitle: 'deep encoder feeds a small structured probabilistic program, marginalized by Monte Carlo',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'encoder', kind: 'linear', label: 'Deep encoder', sublabel: `Linear ${F} → 32 (mu, log-var, 16-d latent)`,
      inShape: `B × ${F}`, outShape: 'B × 32', params: P.linear(F, 32), column: 1,
    },
    {
      id: 'latentsample', kind: 'stochastic', label: 'Latent sample z', sublabel: 'reparameterize, dim = 16 · S = 10 draws',
      inShape: 'B × 32', outShape: 'S × B × 16', column: 2,
      analogy: 'Think of it as drawing ten plausible "hidden market states" consistent with what the network currently believes, instead of committing to one.',
    },
    {
      id: 'probprogram', kind: 'compare', label: 'Probabilistic program', sublabel: 'p(y | z, x) via structured relations among latents',
      inShape: `S × B × 16, B × ${F}`, outShape: `S × B × ${C}`, params: P.linear(16 + F, C), column: 3,
      detail: {
        'learned parameters': `linear(${16 + F} → ${C}) mapping the latent draw and the raw features to class logits`,
        stochasticity: 'lives in the latent draw, not in extra weights — the program itself adds no sampling parameters',
      },
      analogy: 'Think of it as a small set of textbook probability rules relating the hidden state to the outcome, instead of a black-box network doing that step.',
    },
    {
      id: 'marginalize', kind: 'pool', label: 'Monte Carlo marginalize', sublabel: 'average over S = 10 latent draws',
      inShape: `S × B × ${C}`, outShape: `B × ${C}`, column: 4,
      analogy: 'Think of it as averaging the ten answers so no single lucky guess about the hidden state drives the call.',
    },
    {
      id: 'output', kind: 'output', label: 'p(y | x) estimate', outShape: `B × ${C}`, column: 5,
    },
  ],
  edges: [
    ...chain('input', 'encoder', 'latentsample', 'probprogram', 'marginalize', 'output'),
    ['input', 'probprogram', 'flow', 'raw features x, read directly by the program'],
  ],
});

const residualLearningOverRules: ArchGraph = blueprint({
  title: 'Residual Learning over Rules',
  subtitle: 'a neural network learns only the correction a fixed rule combination gets wrong',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'predicates', kind: 'compare', label: 'Rule predicates', sublabel: 'RSI > 70, MA cross, ATR spike, volume spike — K = 4',
      inShape: `B × ${F}`, outShape: 'B × 4', column: 1,
      analogy: 'Think of it as the textbook rules — RSI, moving-average cross, and so on — giving their usual verdict, unweighted by any training.',
    },
    {
      id: 'combiner', kind: 'linear', label: 'Weighted rule combine', sublabel: 'r(x) = sum(w_k · predicate_k)',
      inShape: 'B × 4', outShape: 'B × 1', params: P.linear(4, 1), column: 2, lane: 0,
      analogy: 'Think of it as weighting those textbook signals by how well each has actually worked historically.',
    },
    {
      id: 'residual', kind: 'linear', label: 'Neural residual f_theta(x)', sublabel: `${F} → 64 → 1`,
      inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 64) + P.linear(64, 1), column: 2, lane: 1,
      analogy: 'Think of it as a second model whose only job is explaining the part of the outcome the textbook rules got wrong.',
    },
    {
      id: 'sum', kind: 'fusion', label: 'y_hat = r(x) + f_theta(x)', sublabel: 'elementwise add',
      inShape: 'B × 1, B × 1', outShape: 'B × 1', column: 3,
    },
    {
      id: 'output', kind: 'output', label: 'Blended prediction', outShape: 'B × 1', column: 4,
    },
  ],
  edges: [
    ...chain('input', 'predicates', 'combiner'),
    ['input', 'residual'],
    ['combiner', 'sum'], ['residual', 'sum'],
    ['sum', 'output'],
  ],
});

const ruleAugmentedNeuralNet: ArchGraph = blueprint({
  title: 'Rule-Augmented Neural Net',
  subtitle: 'a rule bank gates and constrains the network\'s raw output',
  nodes: [
    {
      id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
      outShape: `B × ${F}`, column: 0,
    },
    {
      id: 'backbone', kind: 'linear', label: 'Neural backbone', sublabel: `Linear ${F} → 64`,
      inShape: `B × ${F}`, outShape: 'B × 64', params: P.linear(F, 64), column: 1,
      analogy: 'Think of it as the network forming its own raw call from the 35 features, with no rules involved yet.',
    },
    {
      id: 'head', kind: 'head', label: 'Neural head', sublabel: `Linear 64 → ${C}`,
      inShape: 'B × 64', outShape: `B × ${C}`, params: P.linear(64, C), column: 2, lane: 0,
    },
    {
      id: 'ruleeval', kind: 'compare', label: 'Rule evaluation r_k(x)', sublabel: '3 constraints read off the feature row',
      inShape: `B × ${F}`, outShape: 'B × 3', column: 2, lane: 1,
      detail: {
        rules: 'no-long-if-trend-down, no-new-position-in-high-volatility, session-time filter',
        weights: 'none — the constraints are hand-authored and fixed',
        'why the raw row': 'trend, volatility and session are features, not things the 64-wide embedding can be read back for',
      },
      analogy: 'Think of it as checking the network\'s hunch against a short list of hard constraints before anything gets traded.',
    },
    {
      id: 'gate', kind: 'gate', label: 'Output constraint gate', sublabel: 'y = g(y_neural, {r_k}; omega)',
      inShape: `B × ${C}, B × 3`, outShape: `B × ${C}`, params: P.linear(C + 3, C), column: 3,
      analogy: 'Think of it as a compliance check sitting after the network\'s raw call, allowed to veto or dampen a trade that breaks a hard rule like "never go long below the 200-bar average while it\'s falling".',
    },
    {
      id: 'output', kind: 'output', label: 'Constrained prediction', outShape: `B × ${C}`, column: 4,
    },
  ],
  edges: [
    ...chain('input', 'backbone', 'head'),
    ['input', 'ruleeval'],
    ['head', 'gate'], ['ruleeval', 'gate'],
    ['gate', 'output'],
  ],
});

// ─── Registry ────────────────────────────────────────────────────────────────

export const HYBRID_COMPOSITE_BLUEPRINTS: Record<string, ArchGraph> = {
  'hybrid-composite-architectures-classical-hybrids-rnn-cnn-hybrid': rnnCnnHybrid,
  'hybrid-composite-architectures-classical-hybrids-stacked-ensemble-model': stackedEnsembleModel,
  'hybrid-composite-architectures-composite-controllers-planners-hybrid-differentiable-planner': hybridDifferentiablePlanner,
  'hybrid-composite-architectures-composite-controllers-planners-tree-boosted-neural-embedding': treeBoostedNeuralEmbedding,
  'hybrid-composite-architectures-generative-discriminative-hybrids-autoencoder-gan-fusion': autoencoderGanFusion,
  'hybrid-composite-architectures-generative-discriminative-hybrids-bayesian-neural-hybrid-model': bayesianNeuralHybridModel,
  'hybrid-composite-architectures-graph-attention-hybrids-gnn-reinforcement-learner': gnnReinforcementLearnerHybrid,
  'hybrid-composite-architectures-graph-attention-hybrids-graph-augmented-lstm': graphAugmentedLstm,
  'hybrid-composite-architectures-graph-attention-hybrids-latent-attention-decision-graph': latentAttentionDecisionGraph,
  'hybrid-composite-architectures-graph-attention-hybrids-transformer-gnn-hybrid': transformerGnnHybrid,
  'hybrid-composite-architectures-multi-modal-temporal-fusion-attention-weighted-forecast-stack': attentionWeightedForecastStack,
  'hybrid-composite-architectures-multi-modal-temporal-fusion-hierarchical-task-oriented-agent': hierarchicalTaskOrientedAgent,
  'hybrid-composite-architectures-multi-modal-temporal-fusion-multi-modal-reasoning-agent': multiModalReasoningAgent,
  'hybrid-composite-architectures-multi-modal-temporal-fusion-spatiotemporal-fusion-network': spatiotemporalFusionNetwork,
  'hybrid-composite-architectures-neuro-symbolic-systems-differentiable-logic-layer': differentiableLogicLayer,
  'hybrid-composite-architectures-neuro-symbolic-systems-meta-learned-symbolic-router': metaLearnedSymbolicRouter,
  'hybrid-composite-architectures-neuro-symbolic-systems-neuro-symbolic-model': neuroSymbolicModel,
  'hybrid-composite-architectures-neuro-symbolic-systems-probabilistic-program-deepnet': probabilisticProgramDeepNet,
  'hybrid-composite-architectures-neuro-symbolic-systems-residual-learning-over-rules': residualLearningOverRules,
  'hybrid-composite-architectures-neuro-symbolic-systems-rule-augmented-neural-net': ruleAugmentedNeuralNet,
};
