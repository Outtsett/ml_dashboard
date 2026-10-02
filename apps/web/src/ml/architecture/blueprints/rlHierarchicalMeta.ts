/**
 * Blueprints - Reinforcement Learning / Meta-RL & Hierarchical RL.
 *
 * One entry per catalog spec id. Most of these architectures are agent-plus-
 * environment loops, not layer stacks: a manager/worker split, a policy over
 * options, a context encoder, a hypernetwork. Two rules hold everywhere.
 *
 * 1. Every count comes from `P` with the arguments the node's own shapes name,
 *    and it matches the module the spec's python block actually builds - so a
 *    two-layer encoder is drawn as two `P.linear` terms, never one.
 * 2. A stage with nothing to learn (a sampling step, a replay buffer, a frozen
 *    target-network copy, a k-means subgoal mine, a least-squares reward
 *    regression, generated weights) carries NO `params`; what it stores or
 *    estimates instead is named in `detail`.
 *
 * The market environment is drawn explicitly wherever the training signal is a
 * return rather than a label: an RL diagram that stops at the action has hidden
 * the half of the method that does the learning.
 *
 * Greek letters are spelled out - Q_Omega, beta_omega, pi_top - so the diagram
 * reads the same way the spec does.
 */

import type { ArchGraph } from '../types';
import type { NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const A = DIM.classes; // 3 trading actions: sell / hold / buy
const H = 128;
/** The 64-unit hidden width the MAML and Reptile specs' classifiers use. */
const H_SMALL = 64;

function barWindowInput(column: number, lane = 0): NodeSpec {
  return {
    id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
    outShape: `B × ${T} × ${F}`, column, lane,
    analogy: 'Think of it as the last 64 candles laid out left to right, each with its 35 measurements.',
  };
}

/** The market, drawn as what it is: a stochastic step that hands back a reward. */
function marketEnvironment(column: number, lane = 0, sublabel = 'next bar · cost-adjusted reward'): NodeSpec {
  return {
    id: 'environment', kind: 'stochastic', label: 'Market environment', sublabel, column, lane,
    detail: { 'trainable parameters': 'none - the market is sampled, not fitted' },
    analogy: 'Think of it as the tape answering back: you traded, here is the next candle and what it cost you.',
  };
}

export const RL_HIERARCHICAL_META_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Hierarchical Control Architectures ─────────────────────────────────

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-hierarchical-control-architectures-feudal-reinforcement-learning':
    blueprint({
      title: 'Feudal Reinforcement Learning',
      subtitle: 'Manager sets a latent goal every c bars · Worker chases it bar by bar',
      nodes: [
        barWindowInput(0),
        {
          id: 'encoder', kind: 'linear', label: 'State encoder', sublabel: 'Linear 2240 -> 128 · ReLU · Linear 128 -> 32',
          inShape: `B × ${T} × ${F}`, outShape: 'B × 32', params: P.linear(F * T, H) + P.linear(H, 32), column: 1,
          detail: { formula: 'P.linear(35·64, 128) + P.linear(128, 32)' },
        },
        {
          id: 'manager', kind: 'head', label: 'Manager', sublabel: 'goal head, held fixed for c bars',
          inShape: 'B × 32', outShape: 'B × 16', params: P.linear(32, 16), column: 2,
          detail: {
            'goal horizon c': '5-30 bars',
            objective: 'extrinsic (trading) return',
            'goal is unit-norm': 'only the DIRECTION of g carries meaning',
          },
          analogy: 'Think of it as a portfolio manager who only steps in every few bars to set a fresh directive.',
        },
        {
          id: 'worker', kind: 'head', label: 'Worker', sublabel: 'goal-conditioned action head, Linear 48 -> 3',
          inShape: 'B × 48', outShape: `B × ${A}`, params: P.linear(32 + 16, A), column: 3,
          detail: {
            input: 'latent z (32) concatenated with goal g (16)',
            simplified: 'drawn as one linear head; the spec runs the Worker as PPO with net_arch [128, 64]',
          },
          analogy: 'Think of it as the trader executing the manager\'s directive one bar at a time.',
        },
        {
          id: 'compare', kind: 'compare', label: 'Goal-progress reward', sublabel: 'cos(z_{t+c} - z_t, g_t)',
          column: 3, lane: 1,
          detail: {
            'trainable parameters': 'none - a cosine between two vectors the network already produced',
            'the Worker never sees': 'the extrinsic reward, only this',
          },
        },
        { id: 'output', kind: 'output', label: 'Trade action', sublabel: 'sell · hold · buy', outShape: `B × ${A}`, column: 4 },
        marketEnvironment(5),
      ],
      edges: [
        ...chain('input', 'encoder', 'manager', 'worker', 'output'),
        ['encoder', 'worker', 'flow', 'latent z_t'],
        ['encoder', 'compare', 'flow', 'z_t'],
        ['manager', 'compare', 'flow', 'g_t'],
        ['compare', 'worker', 'context', 'intrinsic reward, Worker policy gradient'],
        ['output', 'environment', 'flow'],
        ['environment', 'manager', 'context', 'extrinsic return, Manager policy gradient on its coarse transitions'],
        ['environment', 'encoder', 'context', 'next bar window'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-hierarchical-control-architectures-hi-map-hierarchical-imitation-of-mixed-agent-policies':
    blueprint({
      title: 'HI-MAP (Hierarchical Imitation of Mixed Agent Policies)',
      subtitle: 'stage 1 clones the demonstrated sub-policy choice · stage 2 fine-tunes it against realized P&L',
      nodes: [
        barWindowInput(0),
        {
          id: 'demonstrations', kind: 'memory', label: 'Demonstration set', sublabel: '(state, chosen sub-policy k*, action)',
          column: 0, lane: 1,
          detail: {
            'trainable parameters': 'none - historical, regime-labelled bars',
            labels: 'derived only from bars at or before that close',
          },
        },
        {
          id: 'encoder', kind: 'linear', label: 'Shared backbone', sublabel: 'net_arch [128, 64]',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H_SMALL}`, params: P.linear(F * T, H) + P.linear(H, H_SMALL), column: 1,
          detail: { formula: 'P.linear(35·64, 128) + P.linear(128, 64)' },
        },
        {
          id: 'selector', kind: 'gate', label: 'Selector', sublabel: 'pi_sel(k | s) over 3 sub-policies',
          inShape: `B × ${H_SMALL}`, outShape: 'B × 3', params: P.linear(H_SMALL, 3), column: 2,
          detail: {
            'warm start': 'multinomial logistic regression on the flattened window',
            'sub-policy count': '2-8',
          },
          analogy: 'Think of it as knowing which specialist trader to trust in the current market, not knowing the trade itself.',
        },
        {
          id: 'clone_loss', kind: 'compare', label: 'Behavior-cloning loss', sublabel: 'cross-entropy against k*',
          column: 2, lane: 1,
          detail: { 'trainable parameters': 'none - a loss', stage: '1 of 2, supervised warm start' },
        },
        { id: 'trend_specialist', kind: 'head', label: 'Trend specialist', sublabel: 'sub-policy 1', inShape: `B × ${H_SMALL}`, outShape: `B × ${A}`, params: P.linear(H_SMALL, A), column: 3, lane: 0 },
        { id: 'meanrev_specialist', kind: 'head', label: 'Mean-reversion specialist', sublabel: 'sub-policy 2', inShape: `B × ${H_SMALL}`, outShape: `B × ${A}`, params: P.linear(H_SMALL, A), column: 3, lane: 1 },
        { id: 'flat_specialist', kind: 'head', label: 'Session-close specialist', sublabel: 'sub-policy 3', inShape: `B × ${H_SMALL}`, outShape: `B × ${A}`, params: P.linear(H_SMALL, A), column: 3, lane: 2 },
        {
          id: 'compose', kind: 'fusion', label: 'Weighted mix', sublabel: 'hard pick or soft mixture over selector weights',
          outShape: `B × ${A}`, column: 4,
          detail: { 'trainable parameters': 'none - a weighted sum of the sub-policy distributions' },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 5 },
        marketEnvironment(6, 0, 'cost-adjusted return, stage 2'),
      ],
      edges: [
        ['input', 'encoder', 'flow'],
        ['encoder', 'selector', 'flow'],
        ['encoder', 'trend_specialist', 'flow'],
        ['encoder', 'meanrev_specialist', 'flow'],
        ['encoder', 'flat_specialist', 'flow'],
        ['trend_specialist', 'compose', 'flow'],
        ['meanrev_specialist', 'compose', 'flow'],
        ['flat_specialist', 'compose', 'flow'],
        ['selector', 'compose', 'context', 'routing weight per specialist'],
        ['compose', 'output', 'flow'],
        ['demonstrations', 'clone_loss', 'flow', 'k*_t'],
        ['selector', 'clone_loss', 'flow'],
        ['clone_loss', 'selector', 'context', 'stage 1: cross-entropy warm start'],
        ['output', 'environment', 'flow'],
        ['environment', 'selector', 'context', 'stage 2: clipped policy gradient, KL-penalized toward the cloned selector'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-hierarchical-control-architectures-hierarchical-dqn-h-dqn':
    blueprint({
      title: 'Hierarchical DQN (h-DQN)',
      subtitle: 'two Q-learners, each with its own replay buffer and target network',
      nodes: [
        barWindowInput(0),
        {
          id: 'meta_encoder', kind: 'linear', label: 'Meta-controller encoder', sublabel: 'MlpPolicy trunk',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1,
        },
        {
          id: 'meta_q', kind: 'head', label: 'Meta Q-function', sublabel: 'Q2(s, g) over 4 discrete goals',
          inShape: `B × ${H}`, outShape: 'B × 4', params: P.linear(H, 4), column: 2,
          detail: { 'goal set': 'flat_by_close · target_small_profit · target_large_profit · reduce_exposure' },
          analogy: 'Think of it as deciding, every so often, what today\'s trading objective should be.',
        },
        {
          id: 'replay', kind: 'memory', label: 'Replay buffers', sublabel: 'one per level, 10k-1M transitions',
          column: 2, lane: 1,
          detail: {
            'trainable parameters': 'none - stored transitions',
            'meta buffer': 'one row per whole sub-episode, which is what makes its transitions semi-Markov',
          },
        },
        {
          id: 'goal_memory', kind: 'memory', label: 'Active goal', sublabel: 'held until achieved or the 5-50 bar budget expires',
          outShape: 'B × 4', column: 3,
          detail: { 'trainable parameters': 'none - a one-hot selection' },
        },
        {
          id: 'target_networks', kind: 'memory', label: 'Target networks', sublabel: 'frozen copies, synced every 500-10000 steps',
          column: 3, lane: 1,
          detail: {
            'trainable parameters': 'none - a periodic copy of each level\'s weights',
            'Bellman target': 'y = r + gamma · max_a Q(s\', a; theta_minus)',
          },
          analogy: 'Think of it as marking your book against yesterday\'s closing marks so today\'s prices cannot chase themselves.',
        },
        {
          id: 'controller_q', kind: 'head', label: 'Controller Q-function', sublabel: 'Q1(s, a | g): Linear 2244 -> 128 · ReLU · Linear 128 -> 3',
          inShape: `B × ${F * T + 4}`, outShape: `B × ${A}`, params: P.linear(F * T + 4, H) + P.linear(H, A), column: 4,
          detail: {
            formula: 'P.linear(35·64 + 4, 128) + P.linear(128, 3)',
            input: 'flattened window concatenated with the one-hot goal',
          },
          analogy: 'Think of it as the trader taking one bar at a time toward whatever objective was just set.',
        },
        {
          id: 'intrinsic', kind: 'compare', label: 'Goal-achieved critic', sublabel: 'f_g(s_t) in {0, 1}',
          column: 4, lane: 1,
          detail: {
            reward: '+1 achieved, -0.01 per step otherwise',
            'trainable parameters': 'none - a stated achievement test',
          },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 5 },
        marketEnvironment(6, 0, 'extrinsic reward, sparse'),
      ],
      edges: [
        ['input', 'meta_encoder', 'flow'],
        ['meta_encoder', 'meta_q', 'flow'],
        ['meta_q', 'goal_memory', 'flow', 'argmax over goals'],
        ['goal_memory', 'controller_q', 'flow'],
        ['input', 'controller_q', 'flow', 's_t'],
        ['input', 'intrinsic', 'flow'],
        ['goal_memory', 'intrinsic', 'flow'],
        ['intrinsic', 'controller_q', 'context', 'intrinsic reward, TD update'],
        ['controller_q', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'replay', 'context', 'transitions logged, one buffer per level'],
        ['replay', 'controller_q', 'context', 'minibatch'],
        ['replay', 'meta_q', 'context', 'minibatch of semi-Markov meta-transitions'],
        ['target_networks', 'controller_q', 'context', 'bootstrap for the Huber Bellman residual'],
        ['target_networks', 'meta_q', 'context', 'bootstrap'],
        ['controller_q', 'target_networks', 'context', 'weights copied at each sync'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-hierarchical-control-architectures-multi-level-policy-learning':
    blueprint({
      title: 'Multi-Level Policy Learning',
      subtitle: 'allocation (64-bar weekly view) -> regime (24-bar daily) -> execution (1 bar), each a directive down',
      nodes: [
        { id: 'input_weekly', kind: 'input', label: 'Weekly window', sublabel: `${T} bars × ${F} features, weekly clock`, outShape: `B × ${T} × ${F}`, column: 0, lane: 0 },
        { id: 'input_daily', kind: 'input', label: 'Daily window', sublabel: `24 bars × ${F} features, daily clock`, outShape: `B × 24 × ${F}`, column: 0, lane: 1 },
        { id: 'input_bar', kind: 'input', label: 'Current bar', sublabel: `${F} features, bar clock`, outShape: `B × ${F}`, column: 0, lane: 2 },
        {
          id: 'alloc_level', kind: 'head', label: 'Allocation level', sublabel: 'directive d_L (8), weekly clock',
          inShape: `B × ${F * T}`, outShape: 'B × 8', params: P.linear(F * T, H) + P.linear(H, 8), column: 1, lane: 0,
          detail: { formula: 'P.linear(35·64, 128) + P.linear(128, 8)' },
          analogy: 'Think of it as the desk head setting target exposure once a week.',
        },
        {
          id: 'regime_level', kind: 'head', label: 'Regime level', sublabel: 'directive d_mid (4), daily clock',
          inShape: `B × ${F * 24 + 8}`, outShape: 'B × 4', params: P.linear(F * 24 + 8, H) + P.linear(H, 4), column: 2, lane: 1,
          detail: {
            formula: 'P.linear(35·24 + 8, 128) + P.linear(128, 4)',
            input: 'daily window concatenated with d_L',
          },
          analogy: 'Think of it as a trader reading the allocation and picking a daily posture: trend or range.',
        },
        {
          id: 'execution_level', kind: 'head', label: 'Execution level', sublabel: 'primitive action, bar clock',
          inShape: `B × ${F + 4}`, outShape: `B × ${A}`, params: P.linear(F + 4, H) + P.linear(H, A), column: 3, lane: 2,
          detail: {
            formula: 'P.linear(35 + 4, 128) + P.linear(128, 3)',
            input: 'current bar concatenated with d_mid',
          },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 4, lane: 2 },
        marketEnvironment(5, 2, 'cost-adjusted return, one joint objective'),
      ],
      edges: [
        ['input_weekly', 'alloc_level', 'flow'],
        ['alloc_level', 'regime_level', 'flow', 'directive d_L'],
        ['input_daily', 'regime_level', 'flow'],
        ['regime_level', 'execution_level', 'flow', 'directive d_mid'],
        ['input_bar', 'execution_level', 'flow'],
        ['execution_level', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'execution_level', 'context', 'return at the bar clock'],
        ['environment', 'regime_level', 'context', 'same return, credited at the daily clock'],
        ['environment', 'alloc_level', 'context', 'same return, credited at the weekly clock - the sparsest level'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-hierarchical-control-architectures-option-critic-architecture':
    blueprint({
      title: 'Option-Critic Architecture',
      subtitle: '4 options · intra-option policies AND terminations both learned by gradient descent',
      nodes: [
        barWindowInput(0),
        {
          id: 'encoder', kind: 'linear', label: 'Shared encoder', sublabel: 'Flatten · Linear 2240 -> 128 · ReLU',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1,
        },
        {
          id: 'q_omega', kind: 'head', label: 'Option values', sublabel: 'Q_Omega(s, omega), 4 options',
          inShape: `B × ${H}`, outShape: 'B × 4', params: P.linear(H, 4), column: 2, lane: 0,
        },
        {
          id: 'intra_option', kind: 'head', label: 'Intra-option policies', sublabel: '4 options × 3 actions',
          inShape: `B × ${H}`, outShape: 'B × 12', params: P.linear(H, 4 * A), column: 2, lane: 1,
        },
        {
          id: 'termination', kind: 'head', label: 'Termination', sublabel: 'beta_omega(s), sigmoid per option',
          inShape: `B × ${H}`, outShape: 'B × 4', params: P.linear(H, 4), column: 2, lane: 2,
          analogy: 'Think of it as the running probability that the current trading posture is about to be abandoned.',
        },
        {
          id: 'option_select', kind: 'stochastic', label: 'Policy over options', sublabel: 'call-and-return, epsilon-greedy over Q_Omega',
          column: 3, lane: 0,
          detail: { 'trainable parameters': 'none - a selection rule over Q_Omega' },
        },
        {
          id: 'action_gate', kind: 'gate', label: 'Active option gate', sublabel: 'routes the selected option\'s action logits',
          outShape: `B × ${A}`, column: 3, lane: 1,
          detail: { 'trainable parameters': 'none - an index into the 4 × 3 logit block' },
        },
        {
          id: 'critic_update', kind: 'compare', label: 'Critic', sublabel: 'Bellman target for Q_Omega and Q_U',
          column: 3, lane: 2,
          detail: {
            'trainable parameters': 'none - a loss over the value heads above',
            'termination gradient': '-(Q_Omega(s\', omega) - V_Omega(s\') + deliberation cost) · grad beta',
          },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 4 },
        marketEnvironment(5),
      ],
      edges: [
        ['input', 'encoder', 'flow'],
        ['encoder', 'q_omega', 'flow'],
        ['encoder', 'intra_option', 'flow'],
        ['encoder', 'termination', 'flow'],
        ['q_omega', 'option_select', 'flow'],
        ['option_select', 'action_gate', 'flow'],
        ['intra_option', 'action_gate', 'flow'],
        ['termination', 'option_select', 'context', 'switch when beta fires, else continue the active option'],
        ['action_gate', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['q_omega', 'critic_update', 'flow'],
        ['environment', 'critic_update', 'context', 'reward r_t'],
        ['critic_update', 'q_omega', 'context', 'TD update'],
        ['critic_update', 'intra_option', 'context', 'Q_U weights the intra-option policy gradient'],
        ['critic_update', 'termination', 'context', 'termination rises where switching beats continuing'],
      ],
    }),

  // ─── Latent Skill Embedding & Transfer ──────────────────────────────────

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-latent-skill-embedding-transfer-composable-skill-transfer-framework':
    blueprint({
      title: 'Composable Skill Transfer Framework',
      subtitle: 'discovery by mutual information over a continuous skill space · reuse by a top controller',
      nodes: [
        barWindowInput(0),
        {
          id: 'skill_sampler', kind: 'stochastic', label: 'Skill prior draw', sublabel: 'z ~ p(z), 8-dim Gaussian',
          outShape: 'B × 8', column: 0, lane: 1,
          detail: { 'trainable parameters': 'none - a draw from the prior', phase: 'discovery' },
        },
        {
          id: 'top_controller', kind: 'head', label: 'Top controller', sublabel: 'pi_top(z | s), transfer phase',
          inShape: `B × ${T} × ${F}`, outShape: 'B × 8', params: P.linear(F * T, H) + P.linear(H, 8), column: 1, lane: 1,
          detail: {
            formula: 'P.linear(35·64, 128) + P.linear(128, 8)',
            'action space': 'the skill embedding itself, continuous',
          },
          analogy: 'Think of it as choosing a blend of trading postures rather than switching between fixed ones.',
        },
        {
          id: 'skill_policy', kind: 'head', label: 'Skill-conditioned policy', sublabel: 'pi(a | s, z): Linear 2248 -> 128 · ReLU · Linear 128 -> 3',
          inShape: `B × ${F * T + 8}`, outShape: `B × ${A}`, params: P.linear(F * T + 8, H) + P.linear(H, A), column: 2,
          detail: {
            formula: 'P.linear(35·64 + 8, 128) + P.linear(128, 3)',
            input: 'flattened window concatenated with z',
          },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 3 },
        marketEnvironment(4, 0, 'next state s_{t+1} · extrinsic return'),
        {
          id: 'discriminator', kind: 'head', label: 'Skill discriminator', sublabel: 'q(z | s_{t+1}): Linear 35 -> 64 · ReLU · Linear 64 -> 8',
          inShape: `B × ${F}`, outShape: 'B × 8', params: P.linear(F, 64) + P.linear(64, 8), column: 5, lane: 1,
        },
        {
          id: 'intrinsic', kind: 'compare', label: 'Mutual-information reward', sublabel: 'log q(z | s) - log p(z)',
          column: 6, lane: 1,
          detail: {
            'trainable parameters': 'none - a log-density difference',
            'what it buys': 'distinct embeddings must produce distinguishable behaviour',
          },
        },
      ],
      edges: [
        ['input', 'skill_policy', 'flow'],
        ['skill_sampler', 'skill_policy', 'flow', 'z, discovery phase'],
        ['input', 'top_controller', 'flow'],
        ['top_controller', 'skill_policy', 'flow', 'z, transfer phase'],
        ['skill_policy', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'discriminator', 'flow', 's_{t+1}'],
        ['discriminator', 'intrinsic', 'flow'],
        ['skill_sampler', 'intrinsic', 'context', 'the z that was actually drawn'],
        ['intrinsic', 'skill_policy', 'context', 'discovery phase: intrinsic reward shapes the skill space'],
        ['intrinsic', 'discriminator', 'context', 'discriminator fitted by maximizing log q(z | s)'],
        ['environment', 'top_controller', 'context', 'transfer phase: extrinsic return trains pi_top only'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-latent-skill-embedding-transfer-hierarchical-latent-variable-model':
    blueprint({
      title: 'Hierarchical Latent Variable Model',
      subtitle: 'slow regime latent z_H conditions a fast per-bar latent z_L · trained on a two-level ELBO',
      nodes: [
        { id: 'input_top', kind: 'input', label: 'Long window', sublabel: `256 bars × ${F} features`, outShape: `B × 256 × ${F}`, column: 0, lane: 0 },
        { id: 'input_bottom', kind: 'input', label: 'Short window', sublabel: `20 bars × ${F} features`, outShape: `B × 20 × ${F}`, column: 0, lane: 1 },
        {
          id: 'top_encoder', kind: 'head', label: 'Top inference', sublabel: 'q(z_H | x_long): Linear 8960 -> 128 · ReLU · mu and logvar heads',
          inShape: `B × 256 × ${F}`, outShape: 'B × 32', params: P.linear(F * 256, H) + 2 * P.linear(H, 16), column: 1, lane: 0,
          detail: {
            formula: 'P.linear(35·256, 128) + 2 · P.linear(128, 16)',
            output: 'mu (16) and logvar (16)',
          },
          analogy: 'Think of it as reading a week of bars to decide what regime the market is probably in.',
        },
        {
          id: 'z_h_sample', kind: 'stochastic', label: 'Reparameterize z_H', sublabel: '16-dim regime latent',
          outShape: 'B × 16', column: 2, lane: 0,
          detail: { 'trainable parameters': 'none - mu + exp(logvar / 2) · standard normal noise' },
        },
        {
          id: 'bottom_encoder', kind: 'head', label: 'Bottom inference', sublabel: 'q(z_L | x_short, z_H): Linear 716 -> 128 · ReLU · mu and logvar heads',
          inShape: `B × ${F * 20 + 16}`, outShape: 'B × 64', params: P.linear(F * 20 + 16, H) + 2 * P.linear(H, 32), column: 3, lane: 1,
          detail: {
            formula: 'P.linear(35·20 + 16, 128) + 2 · P.linear(128, 32)',
            output: 'mu (32) and logvar (32)',
          },
        },
        {
          id: 'z_l_sample', kind: 'stochastic', label: 'Reparameterize z_L', sublabel: '32-dim bar latent',
          outShape: 'B × 32', column: 4, lane: 1,
          detail: { 'trainable parameters': 'none - the reparameterization trick' },
        },
        {
          id: 'decoder', kind: 'head', label: 'Decoder', sublabel: 'p(x | z_L, z_H): Linear 48 -> 128 · ReLU · Linear 128 -> 35',
          inShape: 'B × 48', outShape: `B × ${F}`, params: P.linear(32 + 16, H) + P.linear(H, F), column: 5, lane: 0,
          detail: { formula: 'P.linear(32 + 16, 128) + P.linear(128, 35)' },
        },
        {
          id: 'policy_head', kind: 'head', label: 'Downstream policy head', sublabel: 'conditions on both latents',
          inShape: 'B × 48', outShape: `B × ${A}`, params: P.linear(32 + 16, A), column: 6, lane: 0,
        },
        {
          id: 'elbo', kind: 'compare', label: 'Hierarchical ELBO', sublabel: 'reconstruction - KL(z_L) - KL(z_H)',
          column: 6, lane: 1,
          detail: {
            'trainable parameters': 'none - the objective itself',
            'KL warmup': 'both weights annealed from near zero over 5-50 epochs, against posterior collapse',
          },
          analogy: 'Think of it as paying for every bar you failed to redraw, plus a fee for each story you invented to explain it.',
        },
        { id: 'output', kind: 'output', label: 'Regime-conditioned action', outShape: `B × ${A}`, column: 7, lane: 0 },
      ],
      edges: [
        ['input_top', 'top_encoder', 'flow'],
        ['top_encoder', 'z_h_sample', 'flow'],
        ['input_bottom', 'bottom_encoder', 'flow'],
        ['z_h_sample', 'bottom_encoder', 'flow', 'condition on z_H'],
        ['bottom_encoder', 'z_l_sample', 'flow'],
        ['z_h_sample', 'decoder', 'flow'],
        ['z_l_sample', 'decoder', 'flow'],
        ['z_h_sample', 'policy_head', 'flow'],
        ['z_l_sample', 'policy_head', 'flow'],
        ['decoder', 'elbo', 'flow', 'reconstruction term'],
        ['top_encoder', 'elbo', 'context', 'KL(q(z_H) || p(z_H))'],
        ['bottom_encoder', 'elbo', 'context', 'KL(q(z_L | z_H) || p(z_L | z_H))'],
        ['elbo', 'top_encoder', 'context', 'one gradient trains both levels jointly'],
        ['policy_head', 'output', 'flow'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-latent-skill-embedding-transfer-skill-chaining':
    blueprint({
      title: 'Skill Chaining',
      subtitle: 'built backward from the goal, one empirically validated link at a time',
      nodes: [
        {
          id: 'goal_region', kind: 'memory', label: 'Target region I_{k-1}', sublabel: 'the goal, or the previous skill\'s initiation set',
          column: 0, lane: 0,
          detail: { 'trainable parameters': 'none - a region, not a network', example: 'flat at target P&L' },
        },
        barWindowInput(0, 1),
        {
          id: 'skill_policy', kind: 'head', label: 'Local skill policy', sublabel: 'pi_k, trained only to reach I_{k-1}',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${A}`, params: P.linear(F * T, A), column: 1,
          detail: { formula: 'P.linear(35·64, 3)', scope: 'one link only - never the whole task' },
          analogy: 'Think of it as one validated leg of the trade, only ever run where it has proven reliable.',
        },
        marketEnvironment(2, 1, 'rollout, 20-200 per initiation-set update'),
        {
          id: 'success_eval', kind: 'compare', label: 'Success-rate rollout', sublabel: 'reached I_{k-1}? per rollout',
          column: 3,
          detail: {
            'trainable parameters': 'none - counted outcomes, not a gradient',
            threshold: '0.6-0.95 empirical success before a state joins the set',
          },
        },
        {
          id: 'initiation_classifier', kind: 'compare', label: 'Initiation classifier', sublabel: 'I_k(s), logistic regression on the flattened window',
          inShape: `B × ${F * T}`, outShape: 'B × 1', params: P.linear(F * T, 1), column: 4,
          detail: {
            formula: 'P.linear(35·64, 1)',
            'fitted on': 'states labelled by pi_k\'s empirical success rate',
          },
        },
        {
          id: 'chain_selector', kind: 'gate', label: 'Chain selector', sublabel: 'furthest-along skill whose I_k(s) = 1',
          column: 5,
          detail: { 'trainable parameters': 'none - a lookup over the chain', 'max chain length': '3-15' },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 6 },
      ],
      edges: [
        ['goal_region', 'skill_policy', 'flow', 'target region'],
        ['input', 'skill_policy', 'flow'],
        ['skill_policy', 'environment', 'flow'],
        ['environment', 'success_eval', 'flow'],
        ['success_eval', 'initiation_classifier', 'flow', 'states labelled success / failure'],
        ['input', 'initiation_classifier', 'flow'],
        ['input', 'chain_selector', 'flow'],
        ['initiation_classifier', 'chain_selector', 'flow'],
        ['chain_selector', 'output', 'flow'],
        ['initiation_classifier', 'goal_region', 'context', 'I_k becomes the target for the skill before it - the chain grows backward'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-latent-skill-embedding-transfer-successor-features-for-transfer':
    blueprint({
      title: 'Successor Features for Transfer',
      subtitle: 'psi(s, a) factors dynamics from reward · retarget by regressing a new w',
      nodes: [
        barWindowInput(0),
        {
          id: 'encoder', kind: 'linear', label: 'State encoder', sublabel: 'Flatten · Linear 2240 -> 128 · ReLU',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1,
        },
        {
          id: 'psi_head', kind: 'head', label: 'Successor features', sublabel: 'psi(s, a): 3 actions × 6 basis features',
          inShape: `B × ${H}`, outShape: 'B × 18', params: P.linear(H, A * 6), column: 2,
          detail: {
            formula: 'P.linear(128, 3·6)',
            'basis dimension': '3-16, kept small so the transfer regression stays well-conditioned',
          },
          analogy: 'Think of it as forecasting how much future return, drawdown and cost each action leads to, before deciding what any of that is worth.',
        },
        {
          id: 'target_psi', kind: 'memory', label: 'Target network', sublabel: 'frozen copy of psi, synced every 500-10000 steps',
          column: 2, lane: 1,
          detail: { 'trainable parameters': 'none - a periodic weight copy' },
        },
        {
          id: 'td_update', kind: 'compare', label: 'Vector TD update', sublabel: '|| phi_t + gamma · psi(s\', pi(s\')) - psi(s, a) ||^2',
          column: 3, lane: 1,
          detail: {
            'trainable parameters': 'none - a loss',
            shape: 'vector-valued: the update a DQN uses, one component per basis feature',
          },
        },
        {
          id: 'policy_library', kind: 'memory', label: 'Policy library', sublabel: '1-10 trained psi, one per base policy',
          column: 3, lane: 2,
          detail: { 'trainable parameters': 'none new - it stores psi heads already counted above' },
        },
        {
          id: 'reward_weight', kind: 'memory', label: 'Reward weight w', sublabel: '6 numbers, fitted by least squares',
          column: 3, lane: 3,
          detail: {
            'trainable parameters': 'none - a closed-form regression of realized reward onto phi',
            'transfer sample count': '100-5000',
          },
        },
        {
          id: 'q_combine', kind: 'compare', label: 'Generalized policy improvement', sublabel: 'max over the library of psi(s, a) dot w',
          column: 4,
          detail: { 'trainable parameters': 'none - a dot product and a max' },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 5 },
        marketEnvironment(6, 0, 'basis features phi(s, a, s\') and reward r'),
      ],
      edges: [
        ['input', 'encoder', 'flow'],
        ['encoder', 'psi_head', 'flow'],
        ['psi_head', 'q_combine', 'flow'],
        ['psi_head', 'policy_library', 'context', 'stored as a candidate policy'],
        ['policy_library', 'q_combine', 'context', 'compared across the library'],
        ['reward_weight', 'q_combine', 'context', 'w, retargeted per objective'],
        ['q_combine', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['psi_head', 'td_update', 'flow'],
        ['target_psi', 'td_update', 'flow', 'bootstrap psi(s\', pi(s\'))'],
        ['environment', 'td_update', 'context', 'phi_t'],
        ['td_update', 'psi_head', 'context', 'vector TD gradient'],
        ['psi_head', 'target_psi', 'context', 'weights copied at each sync'],
        ['environment', 'reward_weight', 'context', 'reward samples for the transfer-time regression'],
      ],
    }),

  // ─── Meta-Learning Algorithms ────────────────────────────────────────────

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-meta-learning-algorithms-learning-to-learn-with-gradient-descent':
    blueprint({
      title: 'Learning to Learn with Gradient Descent',
      subtitle: 'an LSTM reads the gradient and writes the parameter update, one coordinate at a time',
      nodes: [
        { id: 'input', kind: 'input', label: 'Loss gradient', sublabel: 'one scalar coordinate at a time', outShape: 'B × 1', column: 0 },
        {
          id: 'lstm_optimizer', kind: 'recurrent', label: 'Optimizer LSTM', sublabel: 'LSTMCell(1, 20), weights shared across every coordinate',
          inShape: 'B × 1', outShape: 'B × 20', params: P.lstm(1, 20), column: 1,
          detail: {
            formula: 'P.lstm(1, 20) = 4 · 20 · (1 + 20 + 2)',
            'why coordinatewise': 'one small network scales to a target model of any size',
          },
          analogy: 'Think of it as a hand-crafted learning-rate schedule replaced by a small network that has seen many fits before.',
        },
        {
          id: 'hidden_state', kind: 'memory', label: 'Optimizer state', sublabel: 'h_t and c_t carried step to step, per coordinate',
          column: 1, lane: 1,
          detail: { 'trainable parameters': 'none - activations, not weights' },
        },
        { id: 'update_head', kind: 'head', label: 'Update head', sublabel: 'delta theta_t', inShape: 'B × 20', outShape: 'B × 1', params: P.linear(20, 1), column: 2 },
        {
          id: 'theta_update', kind: 'memory', label: 'Target parameters', sublabel: 'theta_{t+1} = theta_t + delta theta_t',
          column: 3,
          detail: {
            'trainable parameters': 'none of its own - these are the TARGET model\'s weights',
            'must stay in the graph': 'an in-place .data write detaches theta and the meta-gradient into phi is silently zero',
          },
        },
        {
          id: 'loss_eval', kind: 'compare', label: 'Target loss', sublabel: 'sum of L(theta_t) across the unroll',
          column: 4, lane: 1,
          detail: {
            'unroll length': '10-100 steps',
            'truncation window': '5-20 steps, which is where the graph is cut',
          },
        },
        { id: 'output', kind: 'output', label: 'Adapted target model', sublabel: 'theta_T, ready to predict', column: 5 },
      ],
      edges: [
        ['input', 'lstm_optimizer', 'flow'],
        ['hidden_state', 'lstm_optimizer', 'context', 'h_{t-1}'],
        ['lstm_optimizer', 'hidden_state', 'context', 'h_t'],
        ['lstm_optimizer', 'update_head', 'flow'],
        ['update_head', 'theta_update', 'flow'],
        ['theta_update', 'loss_eval', 'flow', 'theta_t'],
        ['theta_update', 'output', 'flow'],
        ['loss_eval', 'input', 'context', 'the next step\'s gradient is taken at theta_t'],
        ['loss_eval', 'lstm_optimizer', 'context', 'meta-gradient of the summed loss trains phi'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-meta-learning-algorithms-meta-policy-gradient':
    blueprint({
      title: 'Meta Policy Gradient',
      subtitle: 'discount factor and reward shaping are meta-parameters, moved by an outer gradient',
      nodes: [
        barWindowInput(0),
        {
          id: 'meta_discount', kind: 'memory', label: 'Meta-discount gamma_eta', sublabel: 'sigmoid(raw), one learned scalar',
          column: 0, lane: 1, params: 1,
          detail: {
            'trainable parameters': '1 - a genuine learned scalar, so it is counted',
            'learned by': 'the outer meta-gradient, never by the inner loop',
          },
        },
        {
          id: 'encoder', kind: 'linear', label: 'State encoder', sublabel: 'Flatten · Linear 2240 -> 128 · ReLU',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1,
        },
        {
          id: 'meta_reward_shape', kind: 'head', label: 'Meta auxiliary reward', sublabel: 'r_eta(s, a): Linear 128 -> 1',
          inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 1, lane: 1,
          detail: {
            formula: 'P.linear(128, 1)',
            weight: '0.0-1.0, clamped against degenerate drift',
            simplified: 'drawn as one scalar head; the spec leaves the shaping head\'s size to the variant chosen',
          },
        },
        { id: 'policy_head', kind: 'head', label: 'Policy head', inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0 },
        { id: 'value_head', kind: 'head', label: 'Value head', sublabel: 'the critic half of the inner actor-critic', inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 1 },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 3 },
        marketEnvironment(4, 0, 'extrinsic reward r_t'),
        {
          id: 'augmented_reward', kind: 'compare', label: 'Augmented reward', sublabel: 'r_t + r_eta, discounted by gamma_eta',
          column: 5,
          detail: { 'trainable parameters': 'none - the inner loop\'s reward, reshaped' },
          analogy: 'Think of it as the system learning, per instrument, whether to think one bar ahead or fifty.',
        },
        {
          id: 'meta_objective', kind: 'compare', label: 'Meta-objective', sublabel: 'extrinsic return AFTER the inner update',
          column: 6,
          detail: {
            'trainable parameters': 'none - a loss on eta',
            'why it is separate': 'the inner loop optimizes the shaped reward; the meta loop is scored on the real one',
          },
        },
      ],
      edges: [
        ...chain('input', 'encoder', 'policy_head', 'output'),
        ['encoder', 'value_head', 'flow'],
        ['encoder', 'meta_reward_shape', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'augmented_reward', 'flow', 'r_t'],
        ['meta_reward_shape', 'augmented_reward', 'context', 'r_eta'],
        ['meta_discount', 'augmented_reward', 'context', 'gamma_eta'],
        ['augmented_reward', 'policy_head', 'context', 'inner policy-gradient update'],
        ['augmented_reward', 'value_head', 'context', 'inner TD update'],
        ['environment', 'meta_objective', 'flow', 'return measured under the adapted theta'],
        ['meta_objective', 'meta_discount', 'context', 'outer meta-gradient on eta'],
        ['meta_objective', 'meta_reward_shape', 'context', 'outer meta-gradient on eta'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-meta-learning-algorithms-model-agnostic-meta-learning-maml':
    blueprint({
      title: 'Model-Agnostic Meta-Learning (MAML)',
      subtitle: 'K inner SGD steps on a support set, then a meta-gradient from the query loss',
      nodes: [
        { id: 'input_support', kind: 'input', label: 'Support set', sublabel: '5-50 windows, one task', outShape: `B × ${T} × ${F}`, column: 0, lane: 0 },
        { id: 'input_query', kind: 'input', label: 'Query set', sublabel: '20-200 windows, strictly later in time', outShape: `B × ${T} × ${F}`, column: 0, lane: 1 },
        {
          id: 'base_encoder', kind: 'linear', label: 'Base model f_theta', sublabel: 'shared initialization: Flatten · Linear 2240 -> 64 · ReLU',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H_SMALL}`, params: P.linear(F * T, H_SMALL), column: 1,
          detail: { formula: 'P.linear(35·64, 64)' },
        },
        {
          id: 'inner_adapt', kind: 'compare', label: 'Inner-loop adaptation', sublabel: 'K = 1-10 plain SGD steps on the support set',
          column: 2,
          detail: {
            'trainable parameters': 'none new - it moves theta, it does not add weights',
            create_graph: 'kept, so the outer step differentiates THROUGH this one',
          },
          analogy: 'Think of it as a fast, few-example fine-tune the model does for itself, before it ever sees the real query.',
        },
        {
          id: 'adapted_head', kind: 'head', label: 'Adapted model f_theta_prime', sublabel: 'same architecture, adapted weights',
          inShape: `B × ${H_SMALL}`, outShape: `B × ${A}`, params: P.linear(H_SMALL, A), column: 3,
          detail: { formula: 'P.linear(64, 3)' },
        },
        {
          id: 'meta_loss', kind: 'compare', label: 'Query loss', sublabel: 'evaluates f_theta_prime on held-out, later data',
          column: 3, lane: 1,
          detail: { 'trainable parameters': 'none - a loss' },
        },
        { id: 'output', kind: 'output', label: 'Task-adapted action', outShape: `B × ${A}`, column: 4 },
      ],
      edges: [
        ['input_support', 'base_encoder', 'flow'],
        ['base_encoder', 'inner_adapt', 'flow'],
        ['inner_adapt', 'adapted_head', 'flow'],
        ['adapted_head', 'output', 'flow'],
        ['input_query', 'meta_loss', 'flow'],
        ['adapted_head', 'meta_loss', 'flow'],
        ['meta_loss', 'base_encoder', 'context', 'second-order meta-gradient updates the shared theta'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-meta-learning-algorithms-pearl-probabilistic-embeddings-for-actor-critic-rl':
    blueprint({
      title: 'PEARL (Probabilistic Embeddings for Actor-Critic RL)',
      subtitle: 'context posterior over the task, off-policy SAC conditioned on a sample',
      nodes: [
        {
          id: 'input_context', kind: 'input', label: 'Recent transitions', sublabel: 'N = 5-100 of (s, a, r, s\'), 72 numbers each',
          outShape: 'B × N × 72', column: 0, lane: 0,
          detail: { 'transition width': 'state 35 + action 1 + reward 1 + next state 35' },
        },
        { id: 'input_state', kind: 'input', label: 'Current state', outShape: `B × ${F}`, column: 0, lane: 1 },
        {
          id: 'context_encoder', kind: 'head', label: 'Context encoder', sublabel: 'per-transition Linear 72 -> 64 · ReLU · mu and logvar heads',
          inShape: 'B × N × 72', outShape: 'B × 16', params: P.linear(72, 64) + 2 * P.linear(64, 8), column: 1, lane: 0,
          detail: {
            formula: 'P.linear(72, 64) + 2 · P.linear(64, 8)',
            aggregation: 'product of Gaussians across the N transitions - order cannot matter',
            output: 'mu (8) and logvar (8)',
          },
          analogy: 'Think of it as forming a belief about which instrument or regime is being traded from only its recent behavior.',
        },
        {
          id: 'replay', kind: 'memory', label: 'Replay buffer', sublabel: 'per task, 200k transitions',
          column: 1, lane: 1,
          detail: {
            'trainable parameters': 'none - stored transitions',
            'why it matters': 'encoder AND actor-critic both train off-policy from it',
          },
        },
        {
          id: 'z_sample', kind: 'stochastic', label: 'Sample z', sublabel: 'wide early, narrow once confident',
          outShape: 'B × 8', column: 2,
          detail: {
            'trainable parameters': 'none - a draw from the posterior',
            'what it buys': 'explore-then-exploit with no separate exploration bonus',
          },
        },
        {
          id: 'kl_bottleneck', kind: 'compare', label: 'Information bottleneck', sublabel: 'KL(q(z | c) || p(z)), weight 0.001-1.0',
          column: 2, lane: 1,
          detail: {
            'trainable parameters': 'none - a penalty',
            'too small': 'posterior collapses to a point estimate',
            'too large': 'posterior collapses to the prior and carries no task information',
          },
        },
        {
          id: 'actor', kind: 'head', label: 'SAC actor', sublabel: 'pi(a | s, z): Linear 43 -> 128 · ReLU · Linear 128 -> 1',
          inShape: 'B × 43', outShape: 'B × 1', params: P.linear(F + 8, H) + P.linear(H, 1), column: 3, lane: 0,
          detail: {
            formula: 'P.linear(35 + 8, 128) + P.linear(128, 1)',
            action: 'target exposure in [-1, 1] - SAC is defined for a CONTINUOUS action space',
          },
        },
        {
          id: 'critic', kind: 'head', label: 'SAC critic', sublabel: 'Q(s, a, z): Linear 44 -> 128 · ReLU · Linear 128 -> 1',
          inShape: 'B × 44', outShape: 'B × 1', params: P.linear(F + 1 + 8, H) + P.linear(H, 1), column: 3, lane: 1,
          detail: { formula: 'P.linear(35 + 1 + 8, 128) + P.linear(128, 1)' },
        },
        { id: 'output', kind: 'output', label: 'Target exposure', sublabel: 'continuous, in [-1, 1]', outShape: 'B × 1', column: 4 },
        marketEnvironment(5),
      ],
      edges: [
        ['input_context', 'context_encoder', 'flow'],
        ['context_encoder', 'z_sample', 'flow'],
        ['context_encoder', 'kl_bottleneck', 'flow'],
        ['z_sample', 'actor', 'flow'],
        ['z_sample', 'critic', 'flow'],
        ['input_state', 'actor', 'flow'],
        ['input_state', 'critic', 'flow'],
        ['actor', 'output', 'flow'],
        ['critic', 'actor', 'context', 'entropy-regularized critic signal trains the actor'],
        ['kl_bottleneck', 'context_encoder', 'context', 'bottleneck penalty trains phi'],
        ['output', 'environment', 'flow'],
        ['environment', 'replay', 'context', 'transitions logged'],
        ['replay', 'context_encoder', 'context', 'context set sampled off-policy'],
        ['replay', 'critic', 'context', 'minibatch for the SAC update'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-meta-learning-algorithms-reptile-meta-rl':
    blueprint({
      title: 'Reptile Meta-RL',
      subtitle: 'clone -> fine-tune on one task -> nudge the shared initialization toward it',
      nodes: [
        barWindowInput(0),
        {
          id: 'base_model', kind: 'head', label: 'Shared model f_theta', sublabel: 'Flatten · Linear 2240 -> 64 · ReLU · Linear 64 -> 3',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${A}`, params: P.linear(F * T, H_SMALL) + P.linear(H_SMALL, A), column: 1,
          detail: { formula: 'P.linear(35·64, 64) + P.linear(64, 3)' },
        },
        { id: 'task_data', kind: 'input', label: 'Sampled task data', sublabel: 'one instrument or regime', column: 1, lane: 1 },
        {
          id: 'task_clone', kind: 'memory', label: 'Task clone', sublabel: 'deepcopy of theta',
          column: 2,
          detail: { 'trainable parameters': 'none new - a copy of weights already counted' },
        },
        {
          id: 'inner_sgd', kind: 'compare', label: 'Inner SGD (K steps)', sublabel: 'K = 1-20 ordinary training steps on the clone',
          column: 3,
          detail: {
            'trainable parameters': 'none - it moves the clone',
            'no second-order term': 'nothing ever differentiates through this loop',
          },
          analogy: 'Think of it as fine-tuning a copy of the model on one instrument, just to see which direction that pulls it.',
        },
        {
          id: 'displacement', kind: 'compare', label: 'Displacement update', sublabel: 'theta <- theta + epsilon · (theta_i_prime - theta)',
          column: 4,
          detail: {
            'trainable parameters': 'none - an interpolation',
            'outer step size epsilon': '0.01-0.5, annealed toward zero',
          },
        },
        { id: 'output', kind: 'output', label: 'Task-adapted action', outShape: `B × ${A}`, column: 5 },
      ],
      edges: [
        ['input', 'base_model', 'flow'],
        ['base_model', 'task_clone', 'flow'],
        ['task_data', 'inner_sgd', 'flow'],
        ['task_clone', 'inner_sgd', 'flow'],
        ['inner_sgd', 'displacement', 'flow', 'theta_i_prime'],
        ['displacement', 'output', 'flow'],
        ['displacement', 'base_model', 'context', 'shared theta nudged toward theta_i_prime each outer step'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-meta-learning-algorithms-rl-2-reinforcement-learning-squared':
    blueprint({
      title: 'RL^2 (Reinforcement Learning Squared)',
      subtitle: 'adaptation IS the recurrence - no gradient steps at deployment',
      nodes: [
        { id: 'input_state', kind: 'input', label: 'Current state', outShape: `B × ${F}`, column: 0, lane: 0 },
        { id: 'prev_action', kind: 'memory', label: 'Previous action', sublabel: 'one-hot a_{t-1}', outShape: `B × ${A}`, column: 0, lane: 1 },
        { id: 'prev_reward', kind: 'memory', label: 'Previous reward', sublabel: 'r_{t-1}', outShape: 'B × 1', column: 0, lane: 2 },
        {
          id: 'prev_done', kind: 'memory', label: 'Previous done flag', sublabel: 'd_{t-1}, an episode boundary',
          outShape: 'B × 1', column: 0, lane: 3,
          detail: { 'why it is an input, not a reset': 'the hidden state is deliberately NOT cleared on it - that is the whole method' },
        },
        {
          id: 'recurrent_cell', kind: 'recurrent', label: 'Trial-persistent GRU', sublabel: 'GRUCell(40, 128), never reset within a trial',
          inShape: 'B × 40', outShape: `B × ${H}`, params: P.gru(F + A + 1 + 1, H), column: 1,
          detail: {
            formula: 'P.gru(35 + 3 + 1 + 1, 128)',
            'input width': 'state 35 + previous action 3 + previous reward 1 + done flag 1',
          },
          analogy: 'Think of it as one trader who never forgets anything from earlier today, even across separate trades.',
        },
        {
          id: 'hidden_carry', kind: 'memory', label: 'Hidden state', sublabel: 'carried across episode boundaries',
          column: 1, lane: 1,
          detail: {
            'trainable parameters': 'none - activations',
            'this IS the adaptation': 'no gradient step happens at deployment',
          },
        },
        { id: 'policy_head', kind: 'head', label: 'Policy head', inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0 },
        { id: 'value_head', kind: 'head', label: 'Value head', inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 1 },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 3 },
        marketEnvironment(4, 0, 'next state, reward and done - all three feed back in as input'),
      ],
      edges: [
        ['input_state', 'recurrent_cell', 'flow'],
        ['prev_action', 'recurrent_cell', 'flow'],
        ['prev_reward', 'recurrent_cell', 'flow'],
        ['prev_done', 'recurrent_cell', 'flow'],
        ['hidden_carry', 'recurrent_cell', 'context', 'h_{t-1}'],
        ['recurrent_cell', 'hidden_carry', 'context', 'h_t, kept across episodes too'],
        ['recurrent_cell', 'policy_head', 'flow'],
        ['recurrent_cell', 'value_head', 'flow'],
        ['policy_head', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['output', 'prev_action', 'context', 'a_{t-1} at the next step'],
        ['environment', 'prev_reward', 'context', 'r_{t-1} at the next step'],
        ['environment', 'prev_done', 'context', 'd_{t-1} at the next step'],
        ['environment', 'input_state', 'context', 's_t'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-meta-learning-algorithms-task-aware-meta-rl':
    blueprint({
      title: 'Task-Aware Meta-RL',
      subtitle: 'given metadata and inferred recent experience combine into one task embedding',
      nodes: [
        { id: 'input_state', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0, lane: 0 },
        {
          id: 'metadata', kind: 'memory', label: 'Task metadata', sublabel: 'instrument class, volatility bucket',
          outShape: 'B × 4', column: 0, lane: 1,
          detail: { 'trainable parameters': 'none - given, not inferred' },
        },
        {
          id: 'recent_experience', kind: 'memory', label: 'Recent experience', sublabel: '20-bar window, strictly before t',
          outShape: `B × 20 × ${F}`, column: 0, lane: 2,
          detail: { 'trainable parameters': 'none - stored transitions' },
        },
        { id: 'state_encoder', kind: 'linear', label: 'State encoder', inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1, lane: 0 },
        { id: 'metadata_proj', kind: 'linear', label: 'Metadata projection', inShape: 'B × 4', outShape: 'B × 8', params: P.linear(4, 8), column: 1, lane: 1 },
        { id: 'experience_encoder', kind: 'linear', label: 'Experience encoder', inShape: `B × ${20 * F}`, outShape: 'B × 8', params: P.linear(F * 20, 8), column: 1, lane: 2 },
        {
          id: 'task_embed', kind: 'fusion', label: 'Task embedding', sublabel: 'given + inferred, summed',
          outShape: 'B × 8', column: 2, lane: 1,
          detail: {
            'trainable parameters': 'none - an elementwise sum',
            'why it is inspectable': 'unlike a recurrent state, it is a loggable 8-number vector',
          },
        },
        {
          id: 'policy_head', kind: 'head', label: 'Task-conditioned policy', inShape: 'B × 136', outShape: `B × ${A}`, params: P.linear(H + 8, A), column: 3,
          detail: { formula: 'P.linear(128 + 8, 3)' },
          analogy: 'Think of it as one trader who reads a quick dossier on the instrument before deciding how to act.',
        },
        {
          id: 'value_head', kind: 'head', label: 'Task-conditioned value', sublabel: 'the critic half of the actor-critic',
          inShape: 'B × 136', outShape: 'B × 1', params: P.linear(H + 8, 1), column: 3, lane: 1,
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 4 },
        marketEnvironment(5),
      ],
      edges: [
        ['input_state', 'state_encoder', 'flow'],
        ['metadata', 'metadata_proj', 'flow'],
        ['recent_experience', 'experience_encoder', 'flow'],
        ['metadata_proj', 'task_embed', 'flow'],
        ['experience_encoder', 'task_embed', 'flow'],
        ['state_encoder', 'policy_head', 'flow'],
        ['task_embed', 'policy_head', 'flow'],
        ['state_encoder', 'value_head', 'flow'],
        ['task_embed', 'value_head', 'flow'],
        ['policy_head', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'value_head', 'context', 'reward r_t, TD target'],
        ['value_head', 'policy_head', 'context', 'advantage for the actor-critic step'],
        ['environment', 'recent_experience', 'context', 'transitions refresh the inferred half of the embedding'],
      ],
    }),

  // ─── Modularity & Subgoal Discovery ─────────────────────────────────────

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-modularity-subgoal-discovery-hypernetworks-for-rl':
    blueprint({
      title: 'HyperNetworks for RL',
      subtitle: 'a small network writes the trading policy\'s own weights from a task embedding',
      nodes: [
        { id: 'task_embedding_input', kind: 'input', label: 'Task embedding', sublabel: '8-dim, instrument or regime', outShape: 'B × 8', column: 0, lane: 0 },
        { id: 'state_input', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0, lane: 1 },
        {
          id: 'hypernetwork', kind: 'head', label: 'Hypernetwork', sublabel: 'Linear 8 -> 128 · ReLU · Linear 128 -> 143619',
          inShape: 'B × 8', outShape: `B × ${F * T * H_SMALL + H_SMALL + H_SMALL * A + A}`,
          params: P.linear(8, H) + P.linear(H, F * T * H_SMALL + H_SMALL + H_SMALL * A + A), column: 1,
          detail: {
            formula: 'P.linear(8, 128) + P.linear(128, 35·64·64 + 64 + 64·3 + 3)',
            'generated width': 'w1 (64 × 2240) + b1 (64) + w2 (3 × 64) + b2 (3) = 143,619 numbers',
            'the indirection': 'the hypernetwork holds the ONLY trainable weights in the diagram',
          },
          analogy: 'Think of it as one small network writing a whole new trading policy on demand, one instrument at a time.',
        },
        {
          id: 'weight_reshape', kind: 'reshape', label: 'Unpack weights', sublabel: 'slice into w1, b1, w2, b2',
          inShape: `B × ${F * T * H_SMALL + H_SMALL + H_SMALL * A + A}`, column: 2,
          detail: { 'trainable parameters': 'none - a view over the generated vector' },
        },
        {
          id: 'target_forward', kind: 'linear', label: 'Generated target policy', sublabel: 'weights supplied, never independently trained',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${A}`, column: 3,
          detail: { 'trainable parameters': '0 - every weight arrives from the hypernetwork' },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 4 },
        marketEnvironment(5),
      ],
      edges: [
        ['task_embedding_input', 'hypernetwork', 'flow'],
        ['hypernetwork', 'weight_reshape', 'flow'],
        ['weight_reshape', 'target_forward', 'flow', 'generated w1, b1, w2, b2'],
        ['state_input', 'target_forward', 'flow'],
        ['target_forward', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'hypernetwork', 'context', 'policy gradient backpropagates THROUGH the generated weights into phi'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-modularity-subgoal-discovery-meta-controller-with-subgoal-discovery':
    blueprint({
      title: 'Meta-Controller with Subgoal Discovery',
      subtitle: 'goals mined from experience by salience and clustering, then h-DQN unchanged over them',
      nodes: [
        {
          id: 'experience_buffer', kind: 'memory', label: 'Experience buffer', sublabel: 'past transitions, strictly before t',
          column: 0, lane: 0,
          detail: {
            'trainable parameters': 'none - stored transitions',
            'double duty': 'the replay buffer AND the mine the goals are dug out of',
          },
        },
        { id: 'input_state', kind: 'input', label: 'Bar window', outShape: `B × ${T} × ${F}`, column: 0, lane: 1 },
        {
          id: 'discovery', kind: 'cluster', label: 'Subgoal discovery', sublabel: 'top-decile reward salience, then k-means, k = 12',
          column: 1, lane: 0,
          detail: {
            'trainable parameters': 'none - k-means centroids, not gradients',
            're-mined every': '100-5000 episodes',
          },
          analogy: 'Think of it as the system finding its own useful waypoints instead of being handed a list.',
        },
        {
          id: 'encoder', kind: 'linear', label: 'Meta-controller encoder', inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`,
          params: P.linear(F * T, H), column: 1, lane: 1,
        },
        {
          id: 'goal_library', kind: 'memory', label: 'Discovered goal set', sublabel: '5-50 candidates, pruned by selection frequency',
          column: 2, lane: 0,
          detail: { 'trainable parameters': 'none - 12 centroid vectors' },
        },
        {
          id: 'meta_q', kind: 'head', label: 'Meta Q-function', sublabel: 'Q2(s, g) over the discovered set',
          inShape: `B × ${H}`, outShape: 'B × 12', params: P.linear(H, 12), column: 3, lane: 0,
        },
        {
          id: 'target_networks', kind: 'memory', label: 'Target networks', sublabel: 'frozen copies, one per level',
          column: 3, lane: 1,
          detail: {
            'trainable parameters': 'none - periodic weight copies',
            'Bellman target': 'y = r + gamma · max_a Q(s\', a; theta_minus)',
          },
        },
        {
          id: 'controller_q', kind: 'head', label: 'Controller Q-function', sublabel: 'Q1(s, a | g): Linear 2252 -> 128 · ReLU · Linear 128 -> 3',
          inShape: `B × ${F * T + 12}`, outShape: `B × ${A}`, params: P.linear(F * T + 12, H) + P.linear(H, A), column: 4,
          detail: { formula: 'P.linear(35·64 + 12, 128) + P.linear(128, 3)' },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 5 },
        marketEnvironment(6),
      ],
      edges: [
        ['experience_buffer', 'discovery', 'flow'],
        ['discovery', 'goal_library', 'flow'],
        ['input_state', 'encoder', 'flow'],
        ['encoder', 'meta_q', 'flow'],
        ['goal_library', 'meta_q', 'flow', 'the discovered set IS the meta-controller\'s action space'],
        ['meta_q', 'controller_q', 'flow', 'selected goal, one-hot'],
        ['input_state', 'controller_q', 'flow', 's_t'],
        ['controller_q', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'experience_buffer', 'context', 'transitions logged back, re-mined periodically'],
        ['experience_buffer', 'controller_q', 'context', 'replay minibatch'],
        ['target_networks', 'controller_q', 'context', 'bootstrap'],
        ['target_networks', 'meta_q', 'context', 'bootstrap'],
        ['controller_q', 'target_networks', 'context', 'weights copied at each sync'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-modularity-subgoal-discovery-modular-meta-rl-agent':
    blueprint({
      title: 'Modular Meta-RL Agent',
      subtitle: '3 specialized modules, routed by a learned gate and held apart by a load-balancing loss',
      nodes: [
        barWindowInput(0),
        {
          id: 'encoder', kind: 'linear', label: 'Shared encoder', sublabel: 'Flatten · Linear 2240 -> 128 · ReLU',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1,
        },
        {
          id: 'router', kind: 'gate', label: 'Router', sublabel: 'softmax over 3 modules',
          inShape: `B × ${H}`, outShape: 'B × 3', params: P.linear(H, 3), column: 1, lane: 1,
          analogy: 'Think of it as a dispatcher deciding, bar by bar, which specialist trader should be in charge.',
        },
        { id: 'module_trend', kind: 'head', label: 'Trend module', inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0 },
        { id: 'module_meanrev', kind: 'head', label: 'Mean-reversion module', inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 1 },
        { id: 'module_liquidity', kind: 'head', label: 'Low-liquidity module', inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 2 },
        { id: 'value_head', kind: 'head', label: 'Value head', sublabel: 'the critic half of the actor-critic', inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 3 },
        {
          id: 'compose', kind: 'fusion', label: 'Weighted composition', sublabel: 'sum of w_m · pi_m(a | z), a mixture of DISTRIBUTIONS',
          outShape: `B × ${A}`, column: 3,
          detail: {
            'trainable parameters': 'none - a weighted sum',
            'not a sum of logits': 'that would be a different, un-normalized object',
          },
        },
        {
          id: 'load_balance', kind: 'compare', label: 'Load-balancing loss', sublabel: 'weight 0.001-0.1',
          column: 3, lane: 1,
          detail: {
            'trainable parameters': 'none - a penalty on the batch-average routing weight',
            'what it prevents': 'router collapse onto one early-successful module',
          },
        },
        { id: 'output', kind: 'output', label: 'Trade action', outShape: `B × ${A}`, column: 4 },
        marketEnvironment(5),
      ],
      edges: [
        ['input', 'encoder', 'flow'],
        ['encoder', 'router', 'flow'],
        ['encoder', 'module_trend', 'flow'],
        ['encoder', 'module_meanrev', 'flow'],
        ['encoder', 'module_liquidity', 'flow'],
        ['encoder', 'value_head', 'flow'],
        ['module_trend', 'compose', 'flow'],
        ['module_meanrev', 'compose', 'flow'],
        ['module_liquidity', 'compose', 'flow'],
        ['router', 'compose', 'context', 'per-module weight w_m'],
        ['router', 'load_balance', 'flow', 'batch-average routing weight'],
        ['load_balance', 'router', 'context', 'penalty pushes usage back toward uniform'],
        ['compose', 'output', 'flow'],
        ['output', 'environment', 'flow'],
        ['environment', 'value_head', 'context', 'reward r_t, TD target'],
        ['value_head', 'compose', 'context', 'advantage weights the policy gradient for every module and the router'],
      ],
    }),

  'reinforcement-learning-rl-meta-rl-hierarchical-rl-modularity-subgoal-discovery-multitask-rl-with-shared-latent-variables':
    blueprint({
      title: 'Multitask RL with Shared Latent Variables',
      subtitle: 'each task policy pulled toward a shared policy distilled from all of them',
      nodes: [
        barWindowInput(0),
        {
          id: 'shared_encoder', kind: 'linear', label: 'Shared encoder', sublabel: 'pi_0 backbone',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1, lane: 0,
        },
        {
          id: 'task_encoder', kind: 'linear', label: 'Task encoder', sublabel: 'pi_i backbone, its own weights',
          inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(F * T, H), column: 1, lane: 1,
        },
        { id: 'shared_head', kind: 'head', label: 'Shared policy pi_0', inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0 },
        { id: 'task_head', kind: 'head', label: 'Task policy pi_i', inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 1 },
        {
          id: 'task_value', kind: 'head', label: 'Task critic V_i', sublabel: 'supplies the advantages the task objective uses',
          inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 2,
        },
        {
          id: 'kl_distill', kind: 'compare', label: 'Distillation KL', sublabel: 'KL(pi_i || pi_0), weight beta = 0.1-5.0',
          column: 3,
          detail: {
            'trainable parameters': 'none - a divergence between the two heads above',
            'beta too small': 'collapses to independent per-task training',
            'beta too large': 'forces incompatible instruments to behave alike',
          },
          analogy: 'Think of it as every instrument\'s trader being gently pulled back toward the desk\'s shared house style.',
        },
        { id: 'output', kind: 'output', label: 'Trade action (deployed task policy)', outShape: `B × ${A}`, column: 4, lane: 1 },
        marketEnvironment(5, 1),
      ],
      edges: [
        ['input', 'shared_encoder', 'flow'],
        ['input', 'task_encoder', 'flow'],
        ['shared_encoder', 'shared_head', 'flow'],
        ['task_encoder', 'task_head', 'flow'],
        ['task_encoder', 'task_value', 'flow'],
        ['shared_head', 'kl_distill', 'flow'],
        ['task_head', 'kl_distill', 'flow'],
        ['task_head', 'output', 'flow'],
        ['kl_distill', 'task_head', 'context', 'beta · KL term, part of the task objective'],
        ['kl_distill', 'shared_head', 'context', 'pi_0 fitted to the pooled task action distributions'],
        ['output', 'environment', 'flow'],
        ['environment', 'task_value', 'context', 'reward r_t, TD target'],
        ['task_value', 'task_head', 'context', 'advantage for the actor-critic step'],
      ],
    }),
};
