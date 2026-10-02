/**
 * Blueprints — Reinforcement Learning / Model-Based RL.
 *
 * One entry per catalog spec id. Model-based RL spans classical local
 * regression (no learned weights), tabular planning (Dyna-Q), deep latent
 * world models (RSSM/Dreamer/PlaNet family), search-based planners (MPC,
 * PETS, MuZero) and sequence-model dynamics (transformers, Neural ODE).
 * Every node draws the algorithm's real computational role: agent AND
 * environment model, with the planning/imagination loop shown as backward
 * 'context' edges, never as another forward 'flow' step.
 */

import type { ArchGraph } from '../types';
import type { NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features; // 35 — features per bar
const A = DIM.classes; // 3 — action count (sell / hold / buy)
const H = 128; // general encoder hidden width
const DET = 200; // RSSM-style deterministic recurrent width
const Z = 32; // stochastic/latent width used by the RSSM-family models
const INNER = 512; // transformer feed-forward inner width
const PLAN = 8; // receding-horizon planning depth, in bars (distinct from the hidden width H)
const J = 5; // imagined rollouts per decision (I2A)

function inputNode(label: string, sublabel: string, outShape: string, column: number, lane = 0): NodeSpec {
  return { id: 'input', kind: 'input', label, sublabel, outShape, column, lane };
}

export const RL_MODEL_BASED_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Classical & MPC Approaches ─────────────────────────────────────────

  'reinforcement-learning-rl-model-based-rl-classical-mpc-approaches-adaptive-local-models-alm': blueprint({
    title: 'Adaptive Local Models (ALM)',
    subtitle: 'locally weighted regression — no global weights, capacity concentrates where queries fall',
    nodes: [
      inputNode('Current State', `${F} features, this bar`, `B × ${F}`, 0),
      {
        id: 'transition_memory', kind: 'memory', label: 'Transition Memory', sublabel: 'every stored (s, a, s\') tuple',
        column: 0, lane: 1,
        analogy: 'Think of it as a trader\'s notebook of every past bar, never thrown away.',
      },
      {
        id: 'candidate_actions', kind: 'stochastic', label: 'Candidate Actions', sublabel: 'K sampled position adjustments',
        outShape: `K × ${A}`, column: 1,
      },
      {
        id: 'kernel_weights', kind: 'compare', label: 'Kernel Weights', sublabel: 'Gaussian distance to query, per stored point',
        column: 2, detail: { weight: 'exp(-(distance / bandwidth)^2) per stored transition' },
        analogy: 'Think of it as flipping back only to the notebook pages that looked like today, weighting the closest matches heaviest.',
      },
      {
        id: 'local_fit', kind: 'head', label: 'Local Weighted Regression', sublabel: 'weighted least squares, refit every query',
        inShape: `N × ${F + A}`, outShape: `B × ${F}`, column: 3,
        detail: {
          coefficients: `${F + A + 1} per query — solved fresh, never a persistent learned weight`,
          'trainable parameters': '0 — the store IS the model',
        },
      },
      {
        id: 'horizon_cost', kind: 'compare', label: 'Horizon Cost (MPC)', sublabel: `discounted reward over ${PLAN} predicted bars, per candidate`,
        outShape: 'K × 1', column: 4,
        detail: { 'drawn as one stage': `the local fit is actually re-solved at each of the ${PLAN} rollout steps` },
      },
      { id: 'output', kind: 'output', label: 'Selected Action', sublabel: 'first action of the best sequence', column: 5 },
    ],
    edges: [
      ['input', 'candidate_actions', 'flow'],
      ['input', 'kernel_weights', 'flow', 'the query point is (state, candidate action)'],
      ['transition_memory', 'kernel_weights', 'flow'],
      ['candidate_actions', 'kernel_weights', 'flow'],
      ['kernel_weights', 'local_fit', 'flow'],
      ['local_fit', 'horizon_cost', 'flow'],
      ['horizon_cost', 'output', 'flow'],
      ['output', 'transition_memory', 'context', 'the realized transition is appended, never discarded'],
      ['output', 'candidate_actions', 'context', 're-plan fresh next bar'],
    ],
  }),

  // ─── Model-Based RL (top-level) ─────────────────────────────────────────

  'reinforcement-learning-rl-model-based-rl-dreamer-v1-v3': blueprint({
    title: 'Dreamer (V1-V3)',
    subtitle: 'RSSM world model + actor-critic trained on imagined latent rollouts',
    nodes: [
      inputNode('Bar Observation', `${F} features, this bar`, `B × ${F}`, 0),
      { id: 'obs_embed', kind: 'linear', label: 'Observation Encoder', outShape: `B × ${H}`, params: P.linear(F, H), column: 1 },
      {
        id: 'deterministic_gru', kind: 'recurrent', label: 'Deterministic State (h)', sublabel: 'GRU, carries context bar to bar',
        outShape: `B × ${DET}`, params: P.gru(Z + A, DET), column: 2,
        analogy: 'Think of it as the trader\'s running memory of the session, updated but never wiped each bar.',
      },
      {
        id: 'posterior_latent', kind: 'stochastic', label: 'Posterior Latent (z)', sublabel: 'sees h and the real bar',
        inShape: `B × ${DET + H}`, outShape: `B × ${Z}`, params: P.linear(DET + H, 2 * Z), column: 3,
        detail: {
          head: `2 × ${Z} — a Gaussian mean and log-variance, the V1 form`,
          'drawn as V1': 'V2/V3 swap this for categorical latents; the head width changes, the stage does not',
        },
      },
      {
        id: 'prior_latent', kind: 'stochastic', label: 'Prior Latent (z-hat)', sublabel: 'sees h only — used to imagine',
        outShape: `B × ${Z}`, params: P.linear(DET, 2 * Z), column: 3, lane: 1,
        analogy: 'Think of it as the trader closing their eyes and guessing the next bar from memory alone — that guess is what lets the agent rehearse thousands of futures without waiting for them to happen.',
      },
      {
        id: 'reward_predictor', kind: 'head', label: 'Reward Predictor', sublabel: 'grounds the latent in real reward',
        inShape: `B × ${DET + Z}`, outShape: 'B × 1',
        params: P.linear(DET + Z, 64) + P.linear(64, 1), column: 4,
      },
      {
        id: 'kl_divergence', kind: 'compare', label: 'KL(posterior || prior)', sublabel: 'KL balancing, free bits',
        column: 4, lane: 1,
        detail: { 'KL balancing': 'alpha pulls the prior to the posterior, 1 - alpha the posterior to the prior' },
      },
      {
        id: 'obs_decoder', kind: 'head', label: 'Observation Decoder', sublabel: 'reconstructs the bar (training only)',
        inShape: `B × ${DET + Z}`, outShape: `B × ${F}`, params: P.linear(DET + Z, H) + P.linear(H, F), column: 4, lane: 2,
      },
      { id: 'actor', kind: 'head', label: 'Actor', sublabel: `policy over ${A} actions`, inShape: `B × ${DET + Z}`, outShape: `B × ${A}`, params: P.linear(DET + Z, H) + P.linear(H, A), column: 5 },
      { id: 'critic', kind: 'head', label: 'Critic', outShape: 'B × 1', params: P.linear(DET + Z, H) + P.linear(H, 1), column: 5, lane: 1 },
      { id: 'output', kind: 'output', label: 'Position Action', outShape: `B × ${A}`, column: 6 },
    ],
    edges: [
      ...chain('input', 'obs_embed', 'deterministic_gru', 'posterior_latent'),
      ['deterministic_gru', 'prior_latent', 'flow'],
      ['posterior_latent', 'reward_predictor', 'flow'],
      ['posterior_latent', 'obs_decoder', 'flow'],
      ['posterior_latent', 'kl_divergence', 'flow'],
      ['prior_latent', 'kl_divergence', 'flow'],
      ['posterior_latent', 'actor', 'flow'],
      ['posterior_latent', 'critic', 'flow'],
      ['actor', 'output', 'flow'],
      ['kl_divergence', 'obs_embed', 'context', 'world-model loss: reconstruction + reward + KL'],
      ['prior_latent', 'actor', 'context', 'in imagination the prior replaces the posterior for H steps'],
      ['critic', 'actor', 'context', 'value gradient backprop through imagined rollout'],
      ['output', 'deterministic_gru', 'context', 'action feeds next imagined step'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-hybrid-imagination-based-agents-hybrid-model-free-model-based-agent': blueprint({
    title: 'Hybrid Model-Free & Model-Based Agent',
    subtitle: 'actor-critic on real transitions, bounded by short model-generated rollouts',
    nodes: [
      inputNode('Current State', `${F} features`, `B × ${F}`, 0),
      { id: 'encoder', kind: 'linear', label: 'Shared Encoder', outShape: `B × ${H}`, params: P.linear(F, H), column: 1 },
      { id: 'actor', kind: 'head', label: 'Actor', sublabel: `${A} position actions`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2 },
      { id: 'critic', kind: 'head', label: 'Critic', outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 1 },
      {
        id: 'replay_buffer', kind: 'memory', label: 'Real Replay Buffer', sublabel: 'refreshed as bars close',
        column: 0, lane: 2,
      },
      {
        id: 'dynamics_model', kind: 'linear', label: 'Learned Dynamics Model', sublabel: 'fit on real transitions only',
        outShape: `B × ${F + 1}`, params: P.linear(F + A, H) + P.linear(H, F + 1), column: 1, lane: 2,
      },
      {
        id: 'simulated_rollout', kind: 'stochastic', label: 'Bounded Simulated Rollout', sublabel: '1-5 steps, capped exposure',
        inShape: `B × ${F + 1}`, column: 2, lane: 2,
        detail: { gate: 'injection stops when measured held-out model error exceeds the threshold' },
        analogy: 'Think of it as a trader taking a handful of practice trades in a mental simulator, never letting the simulator run so long its guesses compound into fantasy.',
      },
      { id: 'output', kind: 'output', label: 'Position Action', outShape: `B × ${A}`, column: 3 },
    ],
    edges: [
      ...chain('input', 'encoder', 'actor', 'output'),
      ['encoder', 'critic', 'flow'],
      ['input', 'replay_buffer', 'context', 'stores real transitions'],
      ['replay_buffer', 'dynamics_model', 'flow'],
      ['dynamics_model', 'simulated_rollout', 'flow'],
      ['simulated_rollout', 'critic', 'context', 'blended into the TD target at the simulated-to-real ratio'],
      ['simulated_rollout', 'actor', 'context', 'the same mixed batch updates the actor'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-hybrid-imagination-based-agents-imagination-augmented-agents-i2a': blueprint({
    title: 'Imagination-Augmented Agents (I2A)',
    subtitle: 'imagined rollouts encoded as a feature, never trusted as a plan',
    nodes: [
      inputNode('Current State', `${F} features`, `B × ${F}`, 0),
      { id: 'free_encoder', kind: 'linear', label: 'Model-Free Encoder', outShape: `B × ${H}`, params: P.linear(F, H), column: 1 },
      {
        id: 'rollout_policy', kind: 'stochastic', label: 'Cheap Rollout Policy', sublabel: 'distilled, imagined actions only',
        outShape: `B × ${A}`, params: P.linear(F, A), column: 1, lane: 1,
      },
      {
        id: 'env_model', kind: 'linear', label: 'Environment Model', sublabel: 'predicts imagined next state + reward',
        outShape: `B × ${F + 1}`, params: P.linear(F + A, H) + P.linear(H, F + 1), column: 2, lane: 1,
      },
      {
        id: 'rollout_encoder', kind: 'recurrent', label: 'Rollout Encoder', sublabel: `LSTM, one summary per imagined trajectory (J = ${J})`,
        inShape: `B × ${J} × tau × ${F + 1}`, outShape: `B × ${J * H}`, params: P.lstm(F + 1, H), column: 3, lane: 1,
        detail: { 'read order': 'the trajectory is read backwards, so the final imagined outcome reaches the summary first' },
        analogy: 'Think of it as a scout who runs several quick, cheap "what if" trades in their head, then reports back only a summary, not the full story.',
      },
      {
        id: 'concat_features', kind: 'fusion', label: 'Feature Concatenation', sublabel: `model-free code + ${J} rollout summaries`,
        outShape: `B × ${(J + 1) * H}`, column: 4,
      },
      { id: 'policy_head', kind: 'head', label: 'Policy Head', inShape: `B × ${(J + 1) * H}`, outShape: `B × ${A}`, params: P.linear((J + 1) * H, A), column: 5 },
      { id: 'value_head', kind: 'head', label: 'Value Head', inShape: `B × ${(J + 1) * H}`, outShape: 'B × 1', params: P.linear((J + 1) * H, 1), column: 5, lane: 1 },
      { id: 'output', kind: 'output', label: 'Position Action', outShape: `B × ${A}`, column: 6 },
    ],
    edges: [
      ['input', 'free_encoder', 'flow'],
      ['input', 'rollout_policy', 'flow'],
      ['rollout_policy', 'env_model', 'flow'],
      ['env_model', 'rollout_encoder', 'flow'],
      ['rollout_encoder', 'concat_features', 'flow'],
      ['free_encoder', 'concat_features', 'flow'],
      ['concat_features', 'policy_head', 'flow'],
      ['concat_features', 'value_head', 'flow'],
      ['policy_head', 'output', 'flow'],
      ['env_model', 'rollout_policy', 'context', 'imagine J trajectories, loop'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-hybrid-imagination-based-agents-world-models-ha-and-schmidhuber': blueprint({
    title: 'World Models (Ha and Schmidhuber)',
    subtitle: 'Vision (VAE) + Memory (MDN-RNN) + a tiny Controller, trained in separate stages',
    nodes: [
      inputNode('Bar Observation', `${F} features`, `B × ${F}`, 0),
      {
        id: 'vae_encoder', kind: 'linear', label: 'Vision Encoder (V)', sublabel: 'compresses the bar to a small code',
        outShape: `B × ${2 * Z}`, params: P.linear(F, H) + P.linear(H, 2 * Z), column: 1,
      },
      {
        id: 'latent_z', kind: 'stochastic', label: 'Latent Code (z)', outShape: `B × ${Z}`, column: 2,
        analogy: 'Think of it as compressing a candle\'s whole shape and context down to a handful of numbers, the way a trader might reduce a chart to "trending, low volatility".',
      },
      { id: 'vae_decoder', kind: 'head', label: 'Vision Decoder', sublabel: 'reconstructs the bar (training only)', outShape: `B × ${F}`, params: P.linear(Z, H) + P.linear(H, F), column: 3, lane: 1 },
      {
        id: 'memory_lstm', kind: 'recurrent', label: 'Memory (M)', sublabel: 'LSTM, mixture-density head', outShape: `B × 256`,
        params: P.lstm(Z + A, 256), column: 3,
      },
      {
        id: 'mixture_density_head', kind: 'head', label: 'Mixture-Density Head', sublabel: '5 mixtures over next z',
        params: P.linear(256, 5 * (2 * Z + 1)), column: 4,
      },
      {
        id: 'controller', kind: 'head', label: 'Controller (C)', sublabel: 'linear — deliberately tiny',
        inShape: `B × ${Z + 256}`, outShape: `B × ${A}`, params: P.linear(Z + 256, A), column: 4, lane: 1,
        detail: { trained: 'by CMA-ES against cumulative reward, not by backpropagation', stage: '3 of 3 — V then M then C' },
        analogy: 'Think of it as the only piece actually trained to trade — everything upstream just hands it a compressed, already-digested picture of the market.',
      },
      { id: 'output', kind: 'output', label: 'Position Action', outShape: `B × ${A}`, column: 5 },
    ],
    edges: [
      ...chain('input', 'vae_encoder', 'latent_z', 'memory_lstm', 'mixture_density_head'),
      ['latent_z', 'vae_decoder', 'flow'],
      ['latent_z', 'controller', 'flow'],
      ['memory_lstm', 'controller', 'flow'],
      ['controller', 'output', 'flow'],
      ['mixture_density_head', 'memory_lstm', 'context', 'predicted next-z distribution feeds imagined ("dream") rollout'],
    ],
  }),

  // ─── Latent Dynamics & Representation Models ───────────────────────────

  'reinforcement-learning-rl-model-based-rl-latent-dynamics-representation-models-deepmdp': blueprint({
    title: 'DeepMDP',
    subtitle: 'no decoder — the latent is shaped only by predicting reward and the next latent',
    nodes: [
      inputNode('State', `${F} features, this bar`, `B × ${F}`, 0),
      {
        id: 'action_input', kind: 'input', label: 'Action', sublabel: `${A} position actions`,
        outShape: `B × ${A}`, column: 0, lane: 1,
      },
      {
        id: 'encoder', kind: 'linear', label: 'Encoder (phi)', sublabel: 'state only — the action is not encoded',
        inShape: `B × ${F}`, outShape: `B × ${Z}`, params: P.linear(F, H) + P.linear(H, Z), column: 1,
      },
      {
        id: 'latent_transition', kind: 'linear', label: 'Latent Transition (P-bar)',
        inShape: `B × ${Z + A}`, outShape: `B × ${Z}`,
        params: P.linear(Z + A, H) + P.linear(H, Z), column: 2,
      },
      {
        id: 'latent_reward', kind: 'head', label: 'Latent Reward (R-bar)',
        inShape: `B × ${Z + A}`, outShape: 'B × 1',
        params: P.linear(Z + A, 64) + P.linear(64, 1), column: 2, lane: 1,
      },
      {
        id: 'transition_loss', kind: 'compare', label: 'Transition Loss', sublabel: 'vs. a slow target encoding of the true next state', column: 3,
        detail: { 'no decoder': 'nothing reconstructs the bar — the latent keeps only what predicts reward and the next latent' },
      },
      { id: 'reward_loss', kind: 'compare', label: 'Reward Loss', sublabel: 'vs. true reward', column: 3, lane: 1 },
      {
        id: 'output', kind: 'output', label: 'Compact Latent State (z)', sublabel: 'reward-relevant only, no reconstruction noise',
        outShape: `B × ${Z}`, column: 4,
        analogy: 'Think of it as throwing away every chart detail that has never once helped predict tomorrow\'s P&L, keeping only what does.',
      },
    ],
    edges: [
      ...chain('input', 'encoder', 'latent_transition', 'transition_loss'),
      ['action_input', 'latent_transition', 'flow'],
      ['action_input', 'latent_reward', 'flow'],
      ['encoder', 'latent_reward', 'flow'],
      ['latent_reward', 'reward_loss', 'flow'],
      ['encoder', 'output', 'flow'],
      ['transition_loss', 'encoder', 'context', 'shapes the representation'],
      ['reward_loss', 'encoder', 'context', 'shapes the representation'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-latent-dynamics-representation-models-latent-dynamics-model-rssm': blueprint({
    title: 'Latent Dynamics Model (RSSM)',
    subtitle: 'deterministic recurrence + stochastic latent, sampled every step',
    nodes: [
      inputNode('Bar Observation', `${F} features`, `B × ${F}`, 0),
      { id: 'obs_embed', kind: 'linear', label: 'Observation Embed', outShape: `B × ${H}`, params: P.linear(F, H), column: 1 },
      {
        id: 'deterministic_h', kind: 'recurrent', label: 'Deterministic State (h)', sublabel: 'GRU',
        outShape: `B × ${DET}`, params: P.gru(Z + A, DET), column: 2,
        analogy: 'Think of it as trend and session context the trader keeps in mind all day, carried forward almost unchanged bar to bar.',
      },
      {
        id: 'posterior_z', kind: 'stochastic', label: 'Posterior (z)', sublabel: 'sees h and the real bar',
        outShape: `B × ${Z}`, params: P.linear(DET + H, 2 * Z), column: 3,
      },
      {
        id: 'prior_z_hat', kind: 'stochastic', label: 'Prior (z-hat)', sublabel: 'sees h only', outShape: `B × ${Z}`,
        params: P.linear(DET, 2 * Z), column: 3, lane: 1,
        analogy: 'Think of it as bar-to-bar surprise a perfect trend read still could not anticipate — the model\'s honest "I don\'t know" carried as a real number.',
      },
      { id: 'kl_divergence', kind: 'compare', label: 'KL Divergence', sublabel: 'posterior vs. prior', column: 4 },
      { id: 'obs_decoder', kind: 'head', label: 'Observation Decoder', outShape: `B × ${F}`, params: P.linear(DET + Z, H) + P.linear(H, F), column: 4, lane: 1 },
      { id: 'reward_decoder', kind: 'head', label: 'Reward Decoder', outShape: 'B × 1', params: P.linear(DET + Z, 64) + P.linear(64, 1), column: 4, lane: 2 },
      { id: 'output', kind: 'output', label: 'Sufficient State (h, z)', sublabel: 'passed to a planner or actor-critic', column: 5 },
    ],
    edges: [
      ...chain('input', 'obs_embed', 'deterministic_h', 'posterior_z'),
      ['deterministic_h', 'prior_z_hat', 'flow'],
      ['posterior_z', 'kl_divergence', 'flow'],
      ['prior_z_hat', 'kl_divergence', 'flow'],
      ['posterior_z', 'obs_decoder', 'flow'],
      ['posterior_z', 'reward_decoder', 'flow'],
      ['posterior_z', 'output', 'flow'],
      ['deterministic_h', 'output', 'flow'],
      ['kl_divergence', 'obs_embed', 'context', 'shapes the representation'],
      ['posterior_z', 'deterministic_h', 'context', 'z and the action feed the GRU at the next bar'],
      ['prior_z_hat', 'deterministic_h', 'context', 'in imagination the prior sample feeds the GRU instead'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-latent-dynamics-representation-models-state-space-abstraction-model': blueprint({
    title: 'State-Space Abstraction Model',
    subtitle: 'bisimulation-style grouping — states with the same reward and future collapse together',
    nodes: [
      inputNode('State Pair (s_i, s_j)', `two bars, ${F} features each`, `2 × B × ${F}`, 0),
      {
        id: 'abstraction_encoder', kind: 'linear', label: 'Abstraction Encoder (phi)', sublabel: 'shared weights, applied to both members of the pair',
        inShape: `2 × B × ${F}`, outShape: '2 × B × 24', params: P.linear(F, H) + P.linear(H, 24), column: 1,
      },
      { id: 'latent_reward', kind: 'head', label: 'Latent Reward', inShape: `2 × B × ${24 + A}`, outShape: '2 × B × 1', params: P.linear(24 + A, 64) + P.linear(64, 1), column: 2 },
      { id: 'latent_transition', kind: 'linear', label: 'Latent Transition', inShape: `2 × B × ${24 + A}`, outShape: '2 × B × 24', params: P.linear(24 + A, 64) + P.linear(64, 24), column: 2, lane: 1 },
      {
        id: 'bisimulation_distance', kind: 'compare', label: 'Bisimulation Distance', sublabel: 'reward gap + discounted next-state gap, between the pair', column: 3,
        detail: { target: '|reward_i - reward_j| + gamma x distance(next latent i, next latent j)' },
        analogy: 'Think of it as asking "would these two bars have led to the same trade and the same outcome?" — if yes, they are treated as the same market condition no matter how different they look.',
      },
      { id: 'abstract_state_grouping', kind: 'cluster', label: 'Behavioral Grouping', sublabel: 'pairs at distance ~0 collapse to one abstract state', column: 4 },
      { id: 'output', kind: 'output', label: 'Abstract State (z)', sublabel: 'far smaller than the raw feature space', column: 5 },
    ],
    edges: [
      ['input', 'abstraction_encoder', 'flow'],
      ['abstraction_encoder', 'latent_reward', 'flow'],
      ['abstraction_encoder', 'latent_transition', 'flow'],
      ['latent_reward', 'bisimulation_distance', 'flow'],
      ['latent_transition', 'bisimulation_distance', 'flow'],
      ['bisimulation_distance', 'abstract_state_grouping', 'flow'],
      ['abstract_state_grouping', 'output', 'flow'],
      ['bisimulation_distance', 'abstraction_encoder', 'context', 'regression target'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-latent-dynamics-representation-models-temporal-predictive-coding-agent': blueprint({
    title: 'Temporal Predictive Coding Agent',
    subtitle: 'predicts its own future representation, never the raw next bar',
    nodes: [
      inputNode('Bar Window', `${DIM.window} bars × ${F} features`, `B × ${DIM.window} × ${F}`, 0),
      { id: 'frame_encoder', kind: 'linear', label: 'Frame Encoder', outShape: `B × ${DIM.window} × 64`, params: P.linear(F, 64), column: 1 },
      {
        id: 'context_aggregator', kind: 'recurrent', label: 'Context Aggregator', sublabel: 'GRU', outShape: 'B × 64',
        params: P.gru(64, 64), column: 2,
      },
      { id: 'predictor_k1', kind: 'head', label: 'Predictor (k=1)', inShape: `B × ${64 + A}`, outShape: 'B × 64', params: P.linear(64 + A, 64), column: 3 },
      { id: 'predictor_k5', kind: 'head', label: 'Predictor (k=5)', inShape: `B × ${64 + A}`, outShape: 'B × 64', params: P.linear(64 + A, 64), column: 3, lane: 1 },
      { id: 'negative_samples', kind: 'memory', label: 'Negative (Decoy) Codes', sublabel: 'other times, other trajectories', column: 3, lane: 2 },
      {
        id: 'action_input', kind: 'input', label: 'Intervening Actions', sublabel: `a(t) .. a(t+k-1), ${A} actions each`,
        outShape: `B × ${A}`, column: 2, lane: 1,
      },
      {
        id: 'contrastive_loss', kind: 'compare', label: 'Contrastive Loss (InfoNCE)', sublabel: 'pick the true future code from decoys',
        column: 4, detail: { 'no decoder': 'nothing reconstructs the bar — only the ranking of codes trains the encoder' },
        analogy: 'Think of it as a police lineup where the model, knowing only where the market stands now, has to pick the real future bar out of a handful of decoys.',
      },
      { id: 'policy_head', kind: 'head', label: 'Policy Head', outShape: `B × ${A}`, params: P.linear(64, A), column: 5 },
      { id: 'output', kind: 'output', label: 'Position Action', column: 6 },
    ],
    edges: [
      ...chain('input', 'frame_encoder', 'context_aggregator'),
      ['context_aggregator', 'predictor_k1', 'flow'],
      ['context_aggregator', 'predictor_k5', 'flow'],
      ['predictor_k1', 'contrastive_loss', 'flow'],
      ['predictor_k5', 'contrastive_loss', 'flow'],
      ['negative_samples', 'contrastive_loss', 'flow', 'decoys'],
      ['frame_encoder', 'contrastive_loss', 'flow', 'the true future code z(t+k) — the positive'],
      ['action_input', 'predictor_k1', 'flow'],
      ['action_input', 'predictor_k5', 'flow'],
      ['context_aggregator', 'policy_head', 'flow'],
      ['policy_head', 'output', 'flow'],
      ['contrastive_loss', 'frame_encoder', 'context', 'shapes the representation'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-latent-dynamics-representation-models-variational-world-model': blueprint({
    title: 'Variational World Model',
    subtitle: 'a calibrated distribution over the next bar, not a single point forecast',
    nodes: [
      inputNode('Bar Observation', `${F} features`, `B × ${F}`, 0),
      { id: 'obs_embed', kind: 'linear', label: 'Observation Embed', outShape: `B × ${H}`, params: P.linear(F, H), column: 1 },
      { id: 'context_gru', kind: 'recurrent', label: 'Recurrent Context', sublabel: 'GRU', outShape: `B × ${H}`, params: P.gru(Z + A, H), column: 2 },
      {
        id: 'posterior_z', kind: 'stochastic', label: 'Posterior (z)', sublabel: 'reparameterized sample',
        outShape: `B × ${Z}`, params: P.linear(H + H, 2 * Z), column: 3,
      },
      {
        id: 'prior_z', kind: 'stochastic', label: 'Prior (z)', sublabel: 'the forward dynamics predictor', outShape: `B × ${Z}`,
        params: P.linear(H, 2 * Z), column: 3, lane: 1,
      },
      { id: 'decoder', kind: 'head', label: 'Decoder', sublabel: 'decodes a posterior sample when training, a prior sample when imagining', inShape: `B × ${Z}`, outShape: `B × ${F}`, params: P.linear(Z, H) + P.linear(H, F), column: 4 },
      { id: 'reward_head', kind: 'head', label: 'Reward Head', inShape: `B × ${Z}`, outShape: 'B × 1', params: P.linear(Z, 64) + P.linear(64, 1), column: 4, lane: 1 },
      { id: 'kl_divergence', kind: 'compare', label: 'KL(posterior || prior)', sublabel: 'free-bits floor on the whole-latent KL', column: 4, lane: 2 },
      {
        id: 'output', kind: 'output', label: 'Next-Bar Distribution', sublabel: 'mean + variance, not a point',
        column: 5,
        analogy: 'Think of it as the model answering "what could happen next" with a full spread of outcomes and their odds, not one confident guess.',
      },
    ],
    edges: [
      ...chain('input', 'obs_embed', 'context_gru', 'posterior_z'),
      ['context_gru', 'prior_z', 'flow'],
      ['posterior_z', 'decoder', 'flow'],
      ['posterior_z', 'reward_head', 'flow'],
      ['posterior_z', 'kl_divergence', 'flow'],
      ['prior_z', 'kl_divergence', 'flow'],
      ['prior_z', 'decoder', 'flow', 'imagination: sample the prior, decode the bar'],
      ['decoder', 'output', 'flow'],
      ['reward_head', 'output', 'flow'],
      ['kl_divergence', 'obs_embed', 'context', 'shapes the representation'],
      ['posterior_z', 'context_gru', 'context', 'z and the action feed the GRU at the next bar'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-latent-imagination-policy-network': blueprint({
    title: 'Latent Imagination Policy Network',
    subtitle: 'an amortized actor-critic trained by backpropagating through imagined latent rollouts',
    nodes: [
      inputNode('Latent State (z)', 'already encoded, real', `B × ${Z}`, 0),
      { id: 'actor', kind: 'head', label: 'Actor', outShape: `B × ${A}`, params: P.linear(Z, H) + P.linear(H, A), column: 1 },
      { id: 'critic', kind: 'head', label: 'Critic', outShape: 'B × 1', params: P.linear(Z, H) + P.linear(H, 1), column: 1, lane: 1 },
      {
        id: 'frozen_dynamics_model', kind: 'memory', label: 'Frozen Dynamics Model', sublabel: 'pretrained, held fixed during actor training',
        inShape: `B × ${Z + A}`, outShape: `B × ${Z + 1}`, column: 0, lane: 2, params: P.linear(Z + A, H) + P.linear(H, Z + 1),
        detail: { 'gradient status': 'weights frozen — the actor gradient passes THROUGH them, it does not update them' },
      },
      {
        id: 'imagined_action', kind: 'stochastic', label: 'Imagined Action', sublabel: 'sampled from the actor', column: 2,
      },
      {
        id: 'imagined_trajectory', kind: 'memory', label: 'Imagined Trajectory', sublabel: 'H-step latent rollout', column: 3,
        analogy: 'Think of it as the trader rehearsing a whole imagined trading day, bar by imagined bar, without a single real fill.',
      },
      {
        id: 'lambda_return', kind: 'compare', label: 'Bootstrapped Lambda-Return', column: 4,
        detail: { recursion: 'V(tau) = reward(tau) + gamma [ (1 - lambda) value(tau+1) + lambda V(tau+1) ]' },
      },
      { id: 'output', kind: 'output', label: 'Position Action', sublabel: 'one forward pass — no search at decision time', outShape: `B × ${A}`, column: 5 },
    ],
    edges: [
      ['input', 'actor', 'flow'],
      ['input', 'critic', 'flow'],
      ['actor', 'imagined_action', 'flow'],
      ['actor', 'output', 'flow'],
      ['frozen_dynamics_model', 'imagined_trajectory', 'flow'],
      ['imagined_action', 'imagined_trajectory', 'flow'],
      ['imagined_trajectory', 'lambda_return', 'flow'],
      ['critic', 'lambda_return', 'flow'],
      ['lambda_return', 'actor', 'context', 'value gradient backprop through imagination'],
      ['lambda_return', 'critic', 'context', 'bootstrapped TD target'],
    ],
  }),

  // ─── Planning-Based Agents ──────────────────────────────────────────────

  'reinforcement-learning-rl-model-based-rl-planning-based-agents-dyna-q': blueprint({
    title: 'Dyna-Q',
    subtitle: 'tabular Q-learning, replayed many times per real bar through a learned table model',
    nodes: [
      inputNode('Discretized State', 'binned OHLCV features', 'B × 1', 0),
      {
        id: 'q_table', kind: 'memory', label: 'Q-Table', sublabel: `states × ${A} actions`, column: 1,
        detail: { update: 'alpha [r + gamma max Q(s\',a\') - Q(s,a)]' },
      },
      {
        id: 'transition_model', kind: 'memory', label: 'Tabular Transition Model', sublabel: 'most recent (r, s\') per (s,a)', column: 1, lane: 1,
      },
      {
        id: 'td_error', kind: 'compare', label: 'Temporal-Difference Error', sublabel: 'ONE rule, used by real and simulated transitions alike', column: 2,
        detail: { update: 'Q(s,a) <- Q(s,a) + alpha [ r + gamma max Q(s-next, a-next) - Q(s,a) ]' },
      },
      {
        id: 'simulated_replay', kind: 'stochastic', label: 'Simulated Replay', sublabel: 'N planning updates per real step', column: 2, lane: 1,
        analogy: 'Think of it as replaying one real trade in your head dozens of times, each replay a free extra lesson.',
      },
      {
        id: 'action_selection', kind: 'compare', label: 'Epsilon-Greedy Selection', sublabel: 'over the Q-table row for this state', column: 3,
      },
      { id: 'output', kind: 'output', label: 'Position Action', sublabel: 'sell / hold / buy', column: 4 },
    ],
    edges: [
      ...chain('input', 'q_table', 'td_error'),
      ['input', 'transition_model', 'flow'],
      ['transition_model', 'simulated_replay', 'flow'],
      ['simulated_replay', 'td_error', 'flow', 'simulated reward and next state, through the SAME update'],
      ['td_error', 'q_table', 'context', 'writes Q(s, a)'],
      ['q_table', 'action_selection', 'flow'],
      ['action_selection', 'output', 'flow'],
      ['output', 'transition_model', 'context', 'the realized reward and next state overwrite Model(s, a)'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-planning-based-agents-model-predictive-control-mpc': blueprint({
    title: 'Model Predictive Control (MPC)',
    subtitle: 'receding-horizon search — re-solved fresh at every bar, only the first action executed',
    nodes: [
      inputNode('Current State', `${F} features`, `B × ${F}`, 0),
      {
        id: 'candidate_action_sequences', kind: 'stochastic', label: 'Candidate Action Sequences', sublabel: `K sampled sequences, ${PLAN} bars deep`,
        outShape: `K × ${PLAN} × ${A}`, column: 1,
      },
      {
        id: 'dynamics_model_f', kind: 'linear', label: 'Dynamics Model', sublabel: `rolled forward ${PLAN} steps per candidate`,
        inShape: `K × ${F + A}`, outShape: `K × ${F + 1}`, params: P.linear(F + A, H) + P.linear(H, F + 1), column: 2,
        analogy: 'Think of it as fast-forwarding several imagined tapes of the next few bars, one tape per candidate trade.',
      },
      {
        id: 'cumulative_reward_J', kind: 'compare', label: 'Predicted Cumulative Reward', sublabel: 'discounted sum over the horizon, per candidate',
        outShape: 'K × 1', column: 3,
      },
      { id: 'elite_refit', kind: 'pool', label: 'Elite Refit (CEM)', sublabel: 'top fraction reshapes the sampler', column: 4 },
      {
        id: 'first_action', kind: 'output', label: 'First Action Only', sublabel: 'the rest of the plan is discarded', column: 5,
        analogy: 'Think of it as never fully trusting the plan past the very next bar — only the first move is ever taken before starting over.',
      },
    ],
    edges: [
      ...chain('input', 'candidate_action_sequences', 'dynamics_model_f', 'cumulative_reward_J', 'elite_refit', 'first_action'),
      ['elite_refit', 'candidate_action_sequences', 'context', 'refit sampling distribution, iterate'],
      ['first_action', 'input', 'context', 're-plan fresh next bar'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-planning-based-agents-muzero': blueprint({
    title: 'MuZero',
    subtitle: 'a purely abstract latent model, trained only to make search accurate',
    nodes: [
      inputNode('Observation History', `${F} features`, `B × ${F}`, 0),
      {
        id: 'representation_h', kind: 'linear', label: 'Representation Function', outShape: 'B × 64',
        params: P.linear(F, H) + P.linear(H, 64), column: 1,
      },
      {
        id: 'search_tree', kind: 'memory', label: 'Monte Carlo Tree Search', sublabel: 'expanded entirely in latent space', column: 2,
        detail: {
          selection: 'upper-confidence bound over child value and prior, root Dirichlet noise while collecting',
          'not drawn': 'the reward and value legs of the training loss — see the spec',
        },
        analogy: 'Think of it as the agent playing out many imagined "what if I did X" branches inside its own head, never once checking a real future bar.',
      },
      {
        id: 'dynamics_g', kind: 'linear', label: 'Dynamics Function', sublabel: 'predicts next latent + reward only',
        inShape: `B × ${64 + A}`, outShape: 'B × 65', params: P.linear(64 + A, H) + P.linear(H, 65), column: 2, lane: 1,
        detail: { 'never predicts': 'the next observation — nothing ties the latent to a real bar' },
      },
      {
        id: 'prediction_f', kind: 'head', label: 'Prediction Function', sublabel: 'policy + value from a latent node',
        inShape: 'B × 64', outShape: `B × ${A + 1}`, params: P.linear(64, A) + P.linear(64, 1), column: 2, lane: 2,
      },
      {
        id: 'visit_count_policy_target', kind: 'compare', label: 'Root Visit Counts', sublabel: 'search output AND the policy training target',
        outShape: `B × ${A}`, column: 3,
        detail: { 'why it improves': 'search visits good actions more than the raw policy would, so its counts are a better policy' },
      },
      { id: 'output', kind: 'output', label: 'Position Action', outShape: `B × ${A}`, column: 4 },
    ],
    edges: [
      ...chain('input', 'representation_h', 'search_tree', 'visit_count_policy_target', 'output'),
      ['representation_h', 'dynamics_g', 'flow'],
      ['representation_h', 'prediction_f', 'flow'],
      ['dynamics_g', 'search_tree', 'context', 'expands a node with a predicted next latent + reward'],
      ['prediction_f', 'search_tree', 'context', 'evaluates a node with predicted policy + value'],
      ['visit_count_policy_target', 'prediction_f', 'context', 'cross-entropy against the visit counts trains the policy head'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-planning-based-agents-planet-planning-network': blueprint({
    title: 'PlaNet (Planning Network)',
    subtitle: 'the same RSSM as Dreamer, but no actor — every decision is a fresh CEM search',
    nodes: [
      inputNode('Bar Observation', `${F} features`, `B × ${F}`, 0),
      { id: 'obs_embed', kind: 'linear', label: 'Observation Embed', outShape: `B × ${H}`, params: P.linear(F, H), column: 1 },
      { id: 'deterministic_h', kind: 'recurrent', label: 'Deterministic State (h)', sublabel: 'GRU', outShape: `B × ${DET}`, params: P.gru(Z + A, DET), column: 2 },
      { id: 'posterior_z', kind: 'stochastic', label: 'Posterior (z)', outShape: `B × ${Z}`, params: P.linear(DET + H, 2 * Z), column: 3 },
      {
        id: 'candidate_sequences', kind: 'stochastic', label: 'CEM Candidate Sequences', sublabel: `K sampled from N(mu, sigma), ${PLAN} bars deep`,
        outShape: `K × ${PLAN} × ${A}`, column: 3, lane: 1,
      },
      { id: 'reward_predictor', kind: 'head', label: 'Reward Predictor', outShape: 'B × 1', params: P.linear(DET + Z, 64) + P.linear(64, 1), column: 4 },
      { id: 'predicted_return_J', kind: 'compare', label: 'Predicted Cumulative Reward', sublabel: 'per candidate, from imagined latent rollouts alone', outShape: 'K × 1', column: 5 },
      {
        id: 'elite_refit', kind: 'pool', label: 'Elite Refit', sublabel: 'top fraction reshapes the sampler', column: 6,
        analogy: 'Think of it as narrowing a wide guess-list of trade plans down to only the ones that panned out best in imagination, then guessing again nearer to those.',
      },
      { id: 'first_action', kind: 'output', label: 'First Action Only', sublabel: 'no actor network exists — every bar is a fresh search', column: 7 },
    ],
    edges: [
      ...chain('input', 'obs_embed', 'deterministic_h', 'posterior_z'),
      ['deterministic_h', 'reward_predictor', 'flow', '(h, z) is the state each candidate is rolled from'],
      ['posterior_z', 'reward_predictor', 'flow'],
      ['candidate_sequences', 'reward_predictor', 'flow'],
      ['reward_predictor', 'predicted_return_J', 'flow'],
      ['predicted_return_J', 'elite_refit', 'flow'],
      ['elite_refit', 'first_action', 'flow'],
      ['elite_refit', 'candidate_sequences', 'context', 'refit distribution, iterate'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-planning-based-agents-simple-simulated-policy-learning': blueprint({
    title: 'SimPLe (Simulated Policy Learning)',
    subtitle: 'an ordinary model-free policy, trained almost entirely inside a learned bar simulator',
    nodes: [
      inputNode('Recent Bar', `${F} features`, `B × ${F}`, 0),
      {
        id: 'action_input', kind: 'input', label: 'Candidate Action', sublabel: `${A} position actions`,
        outShape: `B × ${A}`, column: 0, lane: 1,
      },
      {
        id: 'dynamics_trunk', kind: 'linear', label: 'Video-Prediction Dynamics', sublabel: 'predicts the FULL next bar, not a latent code',
        inShape: `B × ${F + A}`, outShape: `B × 256`, params: P.linear(F + A, 256) + P.linear(256, 256), column: 1,
      },
      {
        id: 'next_bar_sample', kind: 'stochastic', label: 'Sampled Next Bar', sublabel: 'mean + variance, genuinely stochastic',
        inShape: 'B × 256', outShape: `B × ${F + 1}`, params: P.linear(256, 2 * (F + 1)), column: 2,
        detail: { 'why stochastic': 'a deterministic simulator hands the policy an artifact to exploit' },
      },
      {
        id: 'simulated_env_buffer', kind: 'memory', label: 'Simulated Environment', sublabel: 'exposed as an ordinary step/reset env', column: 3,
        analogy: 'Think of it as a video-game version of the market the policy can play against millions of times, with no real money ever at risk.',
      },
      { id: 'policy_pi', kind: 'head', label: 'Policy (PPO)', sublabel: 'an ordinary, unmodified model-free learner', inShape: `B × ${F}`, outShape: `B × ${A}`, params: P.linear(F, H) + P.linear(H, A), column: 4 },
      { id: 'value_v', kind: 'head', label: 'Value (PPO)', inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, H) + P.linear(H, 1), column: 4, lane: 1 },
      {
        id: 'ppo_objective', kind: 'compare', label: 'PPO Clipped Objective', column: 5,
        detail: { objective: 'min( ratio x advantage, clip(ratio, 1 - epsilon, 1 + epsilon) x advantage )' },
      },
      { id: 'output', kind: 'output', label: 'Position Action', sublabel: 'policy queried on the REAL bar at inference', column: 6 },
    ],
    edges: [
      ...chain('input', 'dynamics_trunk', 'next_bar_sample', 'simulated_env_buffer'),
      ['action_input', 'dynamics_trunk', 'flow'],
      ['simulated_env_buffer', 'policy_pi', 'flow'],
      ['simulated_env_buffer', 'value_v', 'flow'],
      ['policy_pi', 'ppo_objective', 'flow'],
      ['value_v', 'ppo_objective', 'flow'],
      ['input', 'policy_pi', 'flow', 'at inference the policy reads the REAL bar'],
      ['policy_pi', 'output', 'flow'],
      ['ppo_objective', 'policy_pi', 'context', 'policy-gradient update'],
      ['policy_pi', 'simulated_env_buffer', 'context', 'fresh real bars are collected under the updated policy to refit the simulator'],
    ],
  }),

  // ─── Probabilistic & Uncertainty-Based Models ──────────────────────────

  'reinforcement-learning-rl-model-based-rl-probabilistic-uncertainty-based-models-probabilistic-ensembles-with-trajectory-sampling-pets': blueprint({
    title: 'Probabilistic Ensembles with Trajectory Sampling (PETS)',
    subtitle: '5 probabilistic networks, disagreement IS the uncertainty signal',
    nodes: [
      inputNode('State + Action', `${F} features + ${A} actions`, `B × ${F + A}`, 0),
      {
        id: 'probabilistic_ensemble', kind: 'ensemble', label: 'Probabilistic Ensemble', sublabel: '5 networks, each on its own bootstrap resample',
        outShape: `5 × B × ${2 * F}`,
        params: 5 * (P.linear(F + A, 200) + P.linear(200, 200) + P.linear(200, 2 * F)),
        column: 1,
        detail: { members: 5, output: 'mean + variance per member (aleatoric)' },
      },
      {
        id: 'particle_population', kind: 'stochastic', label: 'Trajectory-Sampled Particles', sublabel: 'P particles per candidate, each drawing its own outcome every step',
        column: 2,
        detail: {
          'TS-infinity (default)': 'a particle keeps its initial member for the whole rollout',
          'TS1': 'a particle re-draws its member uniformly at every step',
        },
        analogy: 'Think of it as asking five different analysts for their forecast and letting each one\'s honest disagreement, not just their average guess, decide how much to trust the plan.',
      },
      {
        id: 'trajectory_return', kind: 'compare', label: 'Mean Predicted Return', sublabel: 'averaged over the particle population, so disagreement shows up in the score',
        outShape: 'K × 1', column: 3,
      },
      { id: 'elite_refit_cem', kind: 'pool', label: 'Elite Refit (CEM)', column: 4 },
      { id: 'first_action', kind: 'output', label: 'First Action Only', column: 5 },
    ],
    edges: [
      ...chain('input', 'probabilistic_ensemble', 'particle_population', 'trajectory_return', 'elite_refit_cem', 'first_action'),
      ['elite_refit_cem', 'particle_population', 'context', 'refit sampling distribution, iterate'],
    ],
  }),

  // ─── Transformers & Sequence Models ─────────────────────────────────────

  'reinforcement-learning-rl-model-based-rl-transformers-sequence-models-action-conditioned-dynamics-transformer': blueprint({
    title: 'Action-Conditioned Dynamics Transformer',
    subtitle: 'causal self-attention over interleaved state/action tokens, parallel to train',
    nodes: [
      inputNode('Bar + Action Window', `${DIM.window} bars, interleaved actions`, `B × ${2 * DIM.window} tokens`, 0),
      { id: 'state_embed', kind: 'linear', label: 'State Token Embed', inShape: `B × ${DIM.window} × ${F}`, outShape: `B × ${DIM.window} × ${H}`, params: P.linear(F, H), column: 1 },
      { id: 'action_embed', kind: 'linear', label: 'Action Token Embed', inShape: `B × ${DIM.window} × ${A}`, outShape: `B × ${DIM.window} × ${H}`, params: P.linear(A, H), column: 1, lane: 1 },
      {
        id: 'positional_encoding', kind: 'positional', label: 'Positional Encoding', sublabel: `${2 * DIM.window} learned positions`,
        params: P.embedding(2 * DIM.window, H), column: 1, lane: 2,
      },
      {
        id: 'transformer_layer_1', kind: 'attention', label: 'Causal Transformer Layer 1', sublabel: '4 heads, causally masked',
        inShape: `B × ${2 * DIM.window} × ${H}`, outShape: `B × ${2 * DIM.window} × ${H}`, params: P.encoderLayer(H, INNER), column: 2,
        analogy: 'Think of it as every predicted bar being allowed to look directly back at any earlier bar or trade, a support level thirty bars back included, instead of only what survived through a compressed memory.',
      },
      { id: 'transformer_layer_2', kind: 'attention', label: 'Causal Transformer Layer 2', sublabel: '4 heads, causally masked', inShape: `B × ${2 * DIM.window} × ${H}`, outShape: `B × ${2 * DIM.window} × ${H}`, params: P.encoderLayer(H, INNER), column: 3 },
      {
        id: 'next_state_head', kind: 'head', label: 'Next-Bar Head', sublabel: 'reads the ACTION token position',
        inShape: `B × ${DIM.window} × ${H}`, outShape: `B × ${DIM.window} × ${F}`, params: P.linear(H, F), column: 4,
        detail: { 'why the action token': 'under the causal mask the state token at 2t cannot attend to a(t), so a head there would not be action-conditioned at all' },
      },
      { id: 'reward_head', kind: 'head', label: 'Reward Head', sublabel: 'reads the ACTION token position', inShape: `B × ${DIM.window} × ${H}`, outShape: `B × ${DIM.window} × 1`, params: P.linear(H, 1), column: 4, lane: 1 },
      { id: 'output', kind: 'output', label: 'Predicted Next Bar + Reward', column: 5 },
    ],
    edges: [
      ['input', 'state_embed', 'flow'],
      ['input', 'action_embed', 'flow'],
      ['input', 'positional_encoding', 'flow'],
      ['state_embed', 'transformer_layer_1', 'flow'],
      ['action_embed', 'transformer_layer_1', 'flow'],
      ['positional_encoding', 'transformer_layer_1', 'flow'],
      ['transformer_layer_1', 'transformer_layer_2', 'flow'],
      ['transformer_layer_2', 'next_state_head', 'flow'],
      ['transformer_layer_2', 'reward_head', 'flow'],
      ['next_state_head', 'output', 'flow'],
      ['reward_head', 'output', 'flow'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-transformers-sequence-models-latent-planning-with-transformers': blueprint({
    title: 'Latent Planning with Transformers',
    subtitle: 'compact latent tokens keep attention affordable, then beam search plans over them',
    nodes: [
      inputNode('Bar + Action Window', `${DIM.window} bars, interleaved actions`, `B × ${2 * DIM.window} tokens`, 0),
      { id: 'latent_encoder', kind: 'linear', label: 'Latent Encoder', inShape: `B × ${DIM.window} × ${F}`, outShape: `B × ${DIM.window} × ${Z}`, params: P.linear(F, H) + P.linear(H, Z), column: 1 },
      { id: 'latent_token_embed', kind: 'linear', label: 'Latent Token Embed', inShape: `B × ${DIM.window} × ${Z}`, outShape: `B × ${DIM.window} × ${H}`, params: P.linear(Z, H), column: 2 },
      { id: 'action_token_embed', kind: 'linear', label: 'Action Token Embed', inShape: `B × ${DIM.window} × ${A}`, outShape: `B × ${DIM.window} × ${H}`, params: P.linear(A, H), column: 2, lane: 1 },
      {
        id: 'positional_encoding', kind: 'positional', label: 'Positional Encoding', params: P.embedding(2 * DIM.window, H), column: 2, lane: 2,
      },
      {
        id: 'transformer_layer_1', kind: 'attention', label: 'Causal Transformer Layer 1', inShape: `B × ${2 * DIM.window} × ${H}`, outShape: `B × ${2 * DIM.window} × ${H}`, params: P.encoderLayer(H, INNER), column: 3,
        analogy: 'Think of it as planning over a compressed diary of the market instead of the raw ticker tape — cheap enough to attend over weeks of history at once.',
      },
      { id: 'transformer_layer_2', kind: 'attention', label: 'Causal Transformer Layer 2', inShape: `B × ${2 * DIM.window} × ${H}`, outShape: `B × ${2 * DIM.window} × ${H}`, params: P.encoderLayer(H, INNER), column: 4 },
      { id: 'next_latent_head', kind: 'head', label: 'Next-Latent Head', sublabel: 'reads the ACTION token position', inShape: `B × ${DIM.window} × ${H}`, outShape: `B × ${DIM.window} × ${Z}`, params: P.linear(H, Z), column: 5 },
      { id: 'latent_reward_head', kind: 'head', label: 'Latent Reward Head', sublabel: 'reads the ACTION token position', inShape: `B × ${DIM.window} × ${H}`, outShape: `B × ${DIM.window} × 1`, params: P.linear(H, 1), column: 5, lane: 1 },
      {
        id: 'beam_search', kind: 'stochastic', label: 'Beam Search / Decoding', sublabel: 'keeps the best few candidate latent-action continuations',
        column: 6,
        detail: { causality: 'each extra step rolls on the model own predicted latent, never on a real future bar' },
      },
      { id: 'output', kind: 'output', label: 'Planned Action', outShape: `B × ${A}`, column: 7 },
    ],
    edges: [
      ...chain('input', 'latent_encoder', 'latent_token_embed'),
      ['input', 'action_token_embed', 'flow'],
      ['input', 'positional_encoding', 'flow'],
      ['latent_token_embed', 'transformer_layer_1', 'flow'],
      ['action_token_embed', 'transformer_layer_1', 'flow'],
      ['positional_encoding', 'transformer_layer_1', 'flow'],
      ['transformer_layer_1', 'transformer_layer_2', 'flow'],
      ['transformer_layer_2', 'next_latent_head', 'flow'],
      ['transformer_layer_2', 'latent_reward_head', 'flow'],
      ['next_latent_head', 'beam_search', 'flow'],
      ['latent_reward_head', 'beam_search', 'flow'],
      ['beam_search', 'output', 'flow'],
      ['next_latent_head', 'latent_token_embed', 'context', 'a decoded latent is re-embedded as the next token, one beam step deeper'],
    ],
  }),

  'reinforcement-learning-rl-model-based-rl-transformers-sequence-models-neural-ode-based-dynamics-learner': blueprint({
    title: 'Neural ODE-based Dynamics Learner',
    subtitle: 'the state evolves continuously — integration handles a weekend gap the same as one bar',
    nodes: [
      inputNode('Bar Observation', `${F} features, irregular elapsed time`, `B × ${F}`, 0),
      { id: 'encoder', kind: 'linear', label: 'Encoder', outShape: `B × ${Z}`, params: P.linear(F, H) + P.linear(H, Z), column: 1 },
      {
        id: 'elapsed_time_input', kind: 'input', label: 'Elapsed Time', sublabel: 'real hours since the previous bar - a weekend gap is just a bigger number',
        outShape: 'B × 1', column: 1, lane: 1,
      },
      {
        id: 'derivative_network', kind: 'linear', label: 'Derivative Network f(z, a, t)', sublabel: 'an MLP the solver calls many times per interval',
        inShape: `B × ${Z + A}`, outShape: `B × ${Z}`, params: P.linear(Z + A, H) + P.linear(H, H) + P.linear(H, Z), column: 2,
        detail: { returns: 'dz/dt, a RATE - the state itself is never predicted directly' },
        analogy: 'Think of it as a speedometer for the market rather than a fixed-interval odometer reading, so the solver can integrate over however much real time actually passed, a weekend gap included.',
      },
      {
        id: 'adaptive_integration', kind: 'pool', label: 'Adaptive Integration (dopri5)', sublabel: 'more internal steps where dynamics change fast',
        outShape: `B × ${Z}`, column: 3,
        detail: { 'step count': 'chosen by solver tolerance, not by a layer count typed by hand' },
      },
      { id: 'decoder', kind: 'head', label: 'Decoder', outShape: `B × ${F}`, params: P.linear(Z, H) + P.linear(H, F), column: 4 },
      { id: 'reward_head', kind: 'head', label: 'Reward Head', outShape: 'B × 1', params: P.linear(Z, 64) + P.linear(64, 1), column: 4, lane: 1 },
      { id: 'output', kind: 'output', label: 'Predicted State at t1', column: 5 },
    ],
    edges: [
      ...chain('input', 'encoder', 'derivative_network', 'adaptive_integration', 'decoder', 'output'),
      ['elapsed_time_input', 'adaptive_integration', 'flow', 'the integration limit, per row'],
      ['adaptive_integration', 'reward_head', 'flow'],
      ['reward_head', 'output', 'flow'],
      ['adaptive_integration', 'derivative_network', 'context', 're-evaluated at each adaptive solver step'],
    ],
  }),
};
