/**
 * Blueprints — Reinforcement Learning (RL) / Model-Free RL / Policy & Value
 * Methods: Actor-Critic, Deterministic Policy Gradient, Distributional &
 * Exploration Enhancements, Evolutionary, Policy Gradient, Value-Based.
 *
 * One entry per catalog spec id, stages in data-flow order, every learned
 * count from `P`, with the arguments read off the spec's own snippet rather
 * than assumed. Three network shapes appear in this group, and which one a
 * model gets is a fact about its spec, never a house style:
 *
 *  - SHARED TRUNK, two hidden layers (`sharedTrunk`). Actor-Critic, A2C, A3C
 *    and NAF build `nn.Sequential(Linear(FLAT,H), ReLU, Linear(H,H), ReLU)`
 *    and hang small heads off it.
 *  - INDEPENDENT NETWORKS. The off-policy continuous-control methods
 *    (DDPG / TD3 / SAC / Q-Prop) and Vanilla Policy Gradient never share a
 *    weight between actor and critic, so each real nn.Module is ONE node.
 *  - STABLE-BASELINES3 DEFAULTS. DQN, PPO and TRPO delegate to sb3, whose
 *    `MlpPolicy` is 64 units wide, not 128, and whose actor and critic are
 *    SEPARATE `[64, 64]` towers sharing only a parameter-free flatten
 *    (`net_arch=dict(pi=[64, 64], vf=[64, 64])`, read off sb3 2.9.0). Those
 *    three are drawn at `HSB3`, and their totals reproduce
 *    `sum(p.numel() for p in model.policy.parameters())` of the model the
 *    snippet actually constructs — 295,428 for PPO, 147,779 for the DQN
 *    q-network.
 *
 * Off-policy methods draw their replay buffer and their target networks,
 * because the spec's own Input line is "a replay buffer of transitions" and
 * the bootstrapped target is read from the frozen copies, not the live ones.
 * Tabular methods (Q-Learning, SARSA) have no network at all — the
 * "parameters" are the Q-table itself, sized like a SOM codebook via
 * P.embedding, exactly as `unsupervised.ts` does for its codebook table.
 */

import type { ArchGraph } from '../types';
import type { NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features; // 35 features per bar
const T = DIM.window; // 64-bar trailing window
const A = DIM.classes; // 3 actions: hold, long, short
const FLAT = F * T; // 2240 — the flattened window an MLP trunk consumes
const H = 128; // hidden width of the hand-written snippets in this group
const HALF = H / 2; // 64 — Dueling DQN's per-stream bottleneck, `hidden // 2`
const HSB3 = 64; // stable-baselines3 MlpPolicy width, used by DQN / PPO / TRPO
const ATOMS = 51; // C51 support size in the Rainbow snippet

function stateInput(column: number, lane = 0): NodeSpec {
  return {
    id: 'input', kind: 'input', label: 'State window', sublabel: `${T} bars × ${F} features`,
    outShape: `B × ${T} × ${F}`, column, lane,
    analogy: 'Think of it as the trader\'s last 64 candles, all 35 measurements per candle, handed to the network at once.',
  };
}

/** Two-layer shared trunk: Linear(FLAT,H) -> ReLU -> Linear(H,H) -> ReLU. */
function sharedTrunk(column: number, lane = 0): NodeSpec {
  return {
    id: 'encoder', kind: 'linear', label: 'Shared trunk', sublabel: `${FLAT} → ${H} → ${H}, ReLU`,
    inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H) + P.linear(H, H), column, lane,
    detail: { 'hidden layers': 2, formula: `P.linear(${FLAT}, ${H}) + P.linear(${H}, ${H})` },
  };
}

/** One-layer encoder: Linear(FLAT,H) -> ReLU. Dueling DQN and Rainbow only. */
function encoderOneLayer(column: number, lane = 0): NodeSpec {
  return {
    id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `${FLAT} → ${H}, ReLU`,
    inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H), column, lane,
    detail: { 'hidden layers': 1, formula: `P.linear(${FLAT}, ${H})` },
  };
}

/** One of stable-baselines3's two independent [64, 64] MlpPolicy towers. */
function sb3Tower(id: string, label: string, column: number, lane: number): NodeSpec {
  return {
    id, kind: 'linear', label, sublabel: `${FLAT} → ${HSB3} → ${HSB3}, tanh`,
    inShape: `B × ${T} × ${F}`, outShape: `B × ${HSB3}`,
    params: P.linear(FLAT, HSB3) + P.linear(HSB3, HSB3), column, lane,
    detail: { net_arch: `[${HSB3}, ${HSB3}]`, formula: `P.linear(${FLAT}, ${HSB3}) + P.linear(${HSB3}, ${HSB3})` },
  };
}

export const RL_POLICY_VALUE_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Actor-Critic Methods ───────────────────────────────────────────────

  'reinforcement-learning-rl-model-free-rl-actor-critic-methods-actor-critic': blueprint({
    title: 'Actor-Critic',
    subtitle: 'shared trunk · one-step bootstrapped advantage',
    nodes: [
      stateInput(0),
      sharedTrunk(1),
      {
        id: 'actor_head', kind: 'head', label: 'Actor head', sublabel: `Linear ${H} → ${A}, softmax`,
        inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0,
        analogy: 'Think of it as the trader deciding what to do this bar: go long, go short, or stay flat.',
      },
      {
        id: 'critic_head', kind: 'head', label: 'Critic head', sublabel: `Linear ${H} → 1, V(s)`,
        inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 1,
        analogy: 'Think of it as a second voice, silent about what to DO, only grading how favorable this bar\'s market state feels.',
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', sublabel: 'sampled or argmax action', outShape: `B × ${A}`, column: 3, lane: 0 },
      {
        id: 'environment', kind: 'stochastic', label: 'Trading environment', sublabel: 'one bar step, cost-adjusted P&L reward',
        column: 4, lane: 0,
      },
      {
        id: 'td_error', kind: 'compare', label: 'TD error', sublabel: 'delta = r + gamma·V(s\') − V(s)', column: 5, lane: 0,
        analogy: 'Think of it as grading the critic\'s last guess against what actually happened one bar later — the gap IS the learning signal.',
      },
    ],
    edges: [
      ...chain('input', 'encoder', 'actor_head', 'output', 'environment', 'td_error'),
      ['encoder', 'critic_head', 'flow'],
      ['critic_head', 'td_error', 'context', 'V(s)'],
      ['td_error', 'critic_head', 'context', 'regression target, backprop'],
      ['td_error', 'actor_head', 'context', 'advantage, policy-gradient step'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-actor-critic-methods-advantage-actor-critic-a2c': blueprint({
    title: 'Advantage Actor-Critic (A2C)',
    subtitle: 'N parallel environments · one synchronous batched update',
    nodes: [
      { ...stateInput(0), sublabel: `N parallel envs × ${T} bars × ${F} features` },
      sharedTrunk(1),
      { id: 'actor_head', kind: 'head', label: 'Actor head', sublabel: `Linear ${H} → ${A}`, params: P.linear(H, A), column: 2, lane: 0 },
      { id: 'critic_head', kind: 'head', label: 'Critic head', sublabel: `Linear ${H} → 1`, params: P.linear(H, 1), column: 2, lane: 1 },
      { id: 'output', kind: 'output', label: 'Hold · long · short', column: 3, lane: 0 },
      {
        id: 'parallel_envs', kind: 'stochastic', label: 'N parallel environments', sublabel: 'each steps n bars, independent regime',
        column: 4, lane: 0,
        analogy: 'Think of it as running N traders at once against different starting points, so one lucky or unlucky stretch never dominates an update.',
      },
      { id: 'rollout_buffer', kind: 'memory', label: 'Rollout batch', sublabel: 'N × n transitions, this update only', column: 5, lane: 0 },
      {
        id: 'advantage', kind: 'compare', label: 'Batched n-step advantage', sublabel: 'averaged over N environments', column: 6, lane: 0,
        analogy: 'Think of it as averaging N traders\' grades into one lesson, so no single trader\'s noisy stretch skews the update.',
      },
    ],
    edges: [
      ...chain('input', 'encoder', 'actor_head', 'output', 'parallel_envs', 'rollout_buffer', 'advantage'),
      ['encoder', 'critic_head', 'flow'],
      ['critic_head', 'advantage', 'context', 'V(s), V(s+n) bootstrap'],
      ['advantage', 'actor_head', 'context', 'synchronous batched gradient'],
      ['advantage', 'critic_head', 'context', 'value regression'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-actor-critic-methods-asynchronous-advantage-actor-critic-a3c': blueprint({
    title: 'Asynchronous Advantage Actor-Critic (A3C)',
    subtitle: 'K asynchronous workers · lock-free gradients to one global net',
    nodes: [
      { ...stateInput(0), id: 'worker_input', sublabel: 'this worker\'s own environment copy' },
      {
        id: 'local_encoder', kind: 'linear', label: 'Local trunk', sublabel: `${FLAT} → ${H} → ${H}, synced from global before each rollout`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H) + P.linear(H, H), column: 1, lane: 0,
        detail: { 'hidden layers': 2, formula: `P.linear(${FLAT}, ${H}) + P.linear(${H}, ${H})` },
      },
      {
        id: 'local_actor', kind: 'head', label: 'Local actor head', sublabel: `Linear ${H} → ${A}`,
        inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0,
      },
      {
        id: 'local_critic', kind: 'head', label: 'Local critic head', sublabel: `Linear ${H} → 1`,
        inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 1,
      },
      { id: 'action', kind: 'output', label: 'Hold · long · short', outShape: `B × ${A}`, column: 3, lane: 0 },
      {
        id: 'environment', kind: 'stochastic', label: 'This worker\'s environment', sublabel: 'independent instrument or offset', column: 4, lane: 0,
        analogy: 'Think of it as one of K independent traders, each watching a different slice of history, all reporting to one shared notebook.',
      },
      { id: 'local_gradient', kind: 'compare', label: 'Local n-step gradient', sublabel: 'plain actor-critic loss, this worker only', column: 5, lane: 0 },
      {
        id: 'global_params', kind: 'memory', label: 'Shared global network', sublabel: 'Hogwild-style lock-free updates', column: 6, lane: 0,
        analogy: 'Think of it as a shared notebook every trader scribbles gradients into without waiting their turn — a little messy, but far faster than a queue.',
      },
    ],
    edges: [
      ...chain('worker_input', 'local_encoder', 'local_actor', 'action', 'environment', 'local_gradient', 'global_params'),
      ['local_encoder', 'local_critic', 'flow'],
      ['local_critic', 'local_gradient', 'context', 'V(s), bootstrap'],
      ['global_params', 'local_encoder', 'context', 'pull latest weights before next rollout'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-actor-critic-methods-q-prop': blueprint({
    title: 'Q-Prop',
    subtitle: 'off-policy critic control variate · unbiased on-policy gradient',
    nodes: [
      stateInput(0),
      { id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', sublabel: 'past transitions, off-policy', column: 0, lane: 1 },
      { id: 'policy', kind: 'linear', label: 'On-policy actor', sublabel: `${FLAT} → ${H} → ${A}`, params: P.linear(FLAT, H) + P.linear(H, A), column: 1, lane: 0 },
      {
        id: 'critic', kind: 'linear', label: 'Off-policy critic', sublabel: `${FLAT} → ${H} → ${A}, Q(s,·)`,
        params: P.linear(FLAT, H) + P.linear(H, A), column: 1, lane: 1,
        analogy: 'Think of it as a second, more experienced trader who has watched far more history and lends the rookie a steadier opinion.',
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', column: 2, lane: 0 },
      {
        id: 'control_variate', kind: 'compare', label: 'Analytic control variate', sublabel: 'E_a~pi[Q(s,a)], Taylor term', column: 2, lane: 1,
      },
      {
        id: 'policy_gradient', kind: 'compare', label: 'Unbiased gradient', sublabel: 'Monte Carlo residual + analytic term', column: 3, lane: 0,
        analogy: 'Think of it as trusting the experienced trader\'s steadier opinion, but always double-checking it against what actually happened.',
      },
    ],
    edges: [
      ...chain('input', 'policy', 'output'),
      ['output', 'replay_buffer', 'context', 'transitions stored for future off-policy critic training'],
      ['replay_buffer', 'critic', 'flow'],
      ['critic', 'control_variate', 'flow', 'Q(s,a) all actions'],
      ['output', 'control_variate', 'context', 'pi(a|s) weights the expectation'],
      ['critic', 'policy_gradient', 'context', 'Q(s, a taken), MC residual'],
      ['control_variate', 'policy_gradient', 'flow'],
      ['policy_gradient', 'policy', 'context', 'unbiased combined gradient, backprop'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-actor-critic-methods-soft-actor-critic-sac': blueprint({
    title: 'Soft Actor-Critic (SAC)',
    subtitle: 'maximum-entropy actor · twin critics · auto-tuned temperature',
    nodes: [
      stateInput(0),
      {
        id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', sublabel: '500k transitions, uniform minibatch', column: 0, lane: 1,
        analogy: 'Think of it as a trading journal the model rereads out of order, so today\'s narrow stretch of bars never dominates a lesson.',
      },
      {
        id: 'actor', kind: 'linear', label: 'Stochastic actor', sublabel: `${FLAT} → ${H} → ${A}, softmax`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${A}`, params: P.linear(FLAT, H) + P.linear(H, A), column: 1, lane: 0,
      },
      {
        id: 'critic1', kind: 'linear', label: 'Critic 1', sublabel: `${FLAT} → ${H} → ${A}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${A}`, params: P.linear(FLAT, H) + P.linear(H, A), column: 1, lane: 1,
      },
      {
        id: 'critic2', kind: 'linear', label: 'Critic 2', sublabel: `${FLAT} → ${H} → ${A}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${A}`, params: P.linear(FLAT, H) + P.linear(H, A), column: 1, lane: 2,
      },
      {
        id: 'min_critic', kind: 'ensemble', label: 'min(Q1, Q2)', sublabel: 'at the CURRENT state, ascended by the actor', column: 2, lane: 1,
        analogy: 'Think of it as asking two skeptical traders for a value estimate and always believing the more cautious of the two.',
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', sublabel: 'sampled from the entropy-regularized policy', outShape: `B × ${A}`, column: 2, lane: 0 },
      {
        id: 'target_critics', kind: 'memory', label: 'Target critics 1 and 2', sublabel: 'Polyak-averaged copies, tau = 0.005',
        column: 2, lane: 2,
        detail: { 'learned count': 'none — copies of critic 1 and 2, moved by Polyak averaging, never by a gradient' },
        analogy: 'Think of it as a slow-moving shadow of both appraisers, so today\'s lesson has a target that is not moving underneath it.',
      },
      {
        id: 'temperature', kind: 'memory', label: 'Temperature alpha', sublabel: 'one learned scalar, targets a minimum entropy',
        params: 1, column: 3, lane: 1,
        detail: { formula: 'log_alpha = torch.zeros(1, requires_grad=True) — exactly one learned scalar' },
        analogy: 'Think of it as a dial that keeps the trader curious — turned up, it keeps trying alternatives even after finding something that works.',
      },
      { id: 'soft_target', kind: 'compare', label: 'Soft Bellman target', sublabel: 'r + gamma·(min target Q − alpha·log pi) at the next state', column: 3, lane: 0 },
    ],
    edges: [
      ...chain('input', 'actor', 'output'),
      ['input', 'replay_buffer', 'context', 'every transition stored, off-policy'],
      ['replay_buffer', 'critic1', 'flow', 'minibatch s, a, r, s\''], ['replay_buffer', 'critic2', 'flow'],
      ['critic1', 'min_critic', 'flow'], ['critic2', 'min_critic', 'flow'],
      ['min_critic', 'actor', 'context', 'actor ascends min(Q1,Q2) minus the entropy term'],
      ['critic1', 'target_critics', 'context', 'Polyak update every step'],
      ['critic2', 'target_critics', 'context', 'Polyak update every step'],
      ['target_critics', 'soft_target', 'context', 'min over the FROZEN critics at s\''],
      ['output', 'soft_target', 'context', 'entropy -log pi(a\'|s\')'],
      ['temperature', 'soft_target', 'context', 'alpha weight'],
      ['soft_target', 'critic1', 'context', 'regression target, backprop'],
      ['soft_target', 'critic2', 'context', 'regression target, backprop'],
      ['soft_target', 'temperature', 'context', 'adjust alpha toward target entropy'],
    ],
  }),

  // ─── Deterministic Policy Gradient Methods ──────────────────────────────

  'reinforcement-learning-rl-model-free-rl-deterministic-policy-gradient-methods-deep-deterministic-policy-gradient-ddpg': blueprint({
    title: 'Deep Deterministic Policy Gradient (DDPG)',
    subtitle: 'deterministic actor · single critic · target networks',
    nodes: [
      stateInput(0),
      {
        id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', sublabel: '500k transitions, uniform minibatch', column: 0, lane: 1,
        analogy: 'Think of it as a trading journal the critic rereads out of order, so consecutive lessons never come from one narrow stretch of bars.',
      },
      {
        id: 'actor', kind: 'linear', label: 'Deterministic actor', sublabel: `${FLAT} → ${H} → ${H} → 1, tanh`,
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1',
        params: P.linear(FLAT, H) + P.linear(H, H) + P.linear(H, 1), column: 1, lane: 0,
        detail: { formula: `P.linear(${FLAT}, ${H}) + P.linear(${H}, ${H}) + P.linear(${H}, 1)` },
      },
      {
        id: 'critic', kind: 'linear', label: 'Critic Q(s,a)', sublabel: `${FLAT} → ${H} → ${H} → ${H}, then concat(action) → 1`,
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1',
        params: P.linear(FLAT, H) + P.linear(H, H) + P.linear(H, H) + P.linear(H + 1, 1), column: 1, lane: 1,
        detail: { formula: `P.linear(${FLAT}, ${H}) + 2 × P.linear(${H}, ${H}) + P.linear(${H} + 1, 1)` },
      },
      {
        id: 'exploration_noise', kind: 'stochastic', label: 'Exploration noise', sublabel: 'Gaussian, added to mu(s) during rollout', column: 2, lane: 0,
        analogy: 'Think of it as the trader deliberately sizing a little off-plan sometimes, just to see what happens.',
      },
      { id: 'output', kind: 'output', label: 'Position size', sublabel: 'continuous, [-1, 1]', outShape: 'B × 1', column: 3, lane: 0 },
      {
        id: 'targets', kind: 'memory', label: 'Target actor + critic', sublabel: 'Polyak-averaged copies, tau small', column: 2, lane: 1,
        analogy: 'Think of it as a slow-moving shadow of the live trader, updated a little at a time so today\'s lesson has a stable target to aim at.',
      },
      { id: 'td_target', kind: 'compare', label: 'TD target', sublabel: 'r + gamma·Q_target(s\', mu_target(s\'))', column: 3, lane: 1 },
    ],
    edges: [
      ...chain('input', 'actor', 'exploration_noise', 'output'),
      ['input', 'replay_buffer', 'context', 'every collected transition stored'],
      ['replay_buffer', 'critic', 'flow', 'minibatch s, a, r, s\''],
      ['critic', 'td_target', 'context', 'Q(s,a) current'],
      ['targets', 'td_target', 'context', 'frozen copies score (s\', mu_target(s\'))'],
      ['td_target', 'critic', 'context', 'regression, backprop'],
      ['td_target', 'actor', 'context', 'ascend Q(s, mu(s)), backprop through critic'],
      ['actor', 'targets', 'context', 'Polyak update every step'],
      ['critic', 'targets', 'context', 'Polyak update every step'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-deterministic-policy-gradient-methods-normalized-advantage-function-naf': blueprint({
    title: 'Normalized Advantage Function (NAF)',
    subtitle: 'single network · closed-form greedy action, no separate actor',
    nodes: [
      stateInput(0),
      {
        id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', sublabel: '500k transitions, uniform minibatch', column: 0, lane: 1,
        analogy: 'Think of it as a journal of past sizing decisions the one network keeps rereading out of order.',
      },
      sharedTrunk(1),
      {
        id: 'value_head', kind: 'head', label: 'V(s)', sublabel: `Linear ${H} → 1`,
        inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 0,
      },
      {
        id: 'mu_head', kind: 'head', label: 'mu(s)', sublabel: `Linear ${H} → 1, tanh — the greedy action`, params: P.linear(H, 1), column: 2, lane: 1,
        analogy: 'Think of it as the network stating its best guess at position size directly — no separate actor needed to find it.',
      },
      { id: 'cholesky_head', kind: 'head', label: 'L(s)', sublabel: `Linear ${H} → 1, Cholesky factor`, params: P.linear(H, 1), column: 2, lane: 2 },
      {
        id: 'curvature', kind: 'reshape', label: 'P(s) = L·Lᵀ', sublabel: 'positive-definite by construction', column: 3, lane: 2,
      },
      { id: 'output', kind: 'output', label: 'Position size', sublabel: 'mu(s), read directly, no search', outShape: 'B × 1', column: 3, lane: 1 },
      {
        id: 'q_value', kind: 'compare', label: 'Q(s,a) = V − ½(a−mu)ᵀP(a−mu)', sublabel: 'quadratic advantage', column: 4, lane: 0,
        analogy: 'Think of it as a bowl-shaped penalty around the greedy size — the further the actual trade drifts from mu(s), the steeper the cost.',
      },
      { id: 'target_network', kind: 'memory', label: 'Target network', sublabel: 'V_target(s\'), max_a Q == V(s\') by construction', column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'encoder'),
      ['input', 'replay_buffer', 'context', 'transitions stored, a = mu(s) + exploration noise'],
      ['replay_buffer', 'encoder', 'flow', 'minibatch s, a, r, s\''],
      ['encoder', 'value_head', 'flow'], ['encoder', 'mu_head', 'flow'], ['encoder', 'cholesky_head', 'flow'],
      ['mu_head', 'output', 'flow'],
      ['cholesky_head', 'curvature', 'flow'],
      ['value_head', 'q_value', 'flow'],
      ['curvature', 'q_value', 'flow'],
      ['mu_head', 'q_value', 'context', 'expansion point'],
      ['target_network', 'q_value', 'context', 'bootstrap target = V_target(s\')'],
      ['q_value', 'value_head', 'context', 'TD regression, backprop'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-deterministic-policy-gradient-methods-twin-delayed-deep-deterministic-policy-gradient-td3': blueprint({
    title: 'Twin Delayed DDPG (TD3)',
    subtitle: 'twin critics · delayed actor updates · target policy smoothing',
    nodes: [
      stateInput(0),
      {
        id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', sublabel: '500k transitions, uniform minibatch', column: 0, lane: 1,
        analogy: 'Think of it as a trading journal both appraisers reread out of order, so neither learns one narrow stretch of bars by heart.',
      },
      {
        id: 'actor', kind: 'linear', label: 'Deterministic actor', sublabel: `${FLAT} → ${H} → ${H} → 1, tanh`,
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1',
        params: P.linear(FLAT, H) + P.linear(H, H) + P.linear(H, 1), column: 1, lane: 0,
        detail: { formula: `P.linear(${FLAT}, ${H}) + P.linear(${H}, ${H}) + P.linear(${H}, 1)` },
      },
      {
        id: 'critic1', kind: 'linear', label: 'Critic 1', sublabel: `${FLAT} → ${H} → ${H} → ${H}, then concat(action) → 1`,
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1',
        params: P.linear(FLAT, H) + P.linear(H, H) + P.linear(H, H) + P.linear(H + 1, 1), column: 1, lane: 1,
        detail: { formula: `P.linear(${FLAT}, ${H}) + 2 × P.linear(${H}, ${H}) + P.linear(${H} + 1, 1)` },
      },
      {
        id: 'critic2', kind: 'linear', label: 'Critic 2', sublabel: 'independent twin, same shape',
        inShape: `B × ${T} × ${F}`, outShape: 'B × 1',
        params: P.linear(FLAT, H) + P.linear(H, H) + P.linear(H, H) + P.linear(H + 1, 1), column: 1, lane: 2,
        detail: { formula: `P.linear(${FLAT}, ${H}) + 2 × P.linear(${H}, ${H}) + P.linear(${H} + 1, 1)` },
      },
      {
        id: 'min_critic', kind: 'ensemble', label: 'min(Q1, Q2)', column: 2, lane: 1,
        analogy: 'Think of it as two independent appraisers valuing the trade, and always trusting whichever one is more conservative.',
      },
      { id: 'output', kind: 'output', label: 'Position size', outShape: 'B × 1', column: 3, lane: 0 },
      {
        id: 'target_smoothing', kind: 'stochastic', label: 'Target policy smoothing', sublabel: 'clipped noise on the TARGET action only', column: 3, lane: 1,
        analogy: 'Think of it as refusing to trust a value estimate that only holds up for one razor-precise position size — nudge it slightly and see if it still holds.',
      },
      { id: 'targets', kind: 'memory', label: 'Target actor + twin critics', sublabel: 'Polyak-averaged, updated every d steps', column: 4, lane: 1 },
      { id: 'td_target', kind: 'compare', label: 'Clipped double-Q target', sublabel: 'r + gamma·min_i Q_target_i(s\', smoothed a\')', column: 5, lane: 1 },
    ],
    edges: [
      ...chain('input', 'actor', 'output'),
      ['input', 'replay_buffer', 'context', 'every collected transition stored'],
      ['replay_buffer', 'critic1', 'flow', 'minibatch s, a, r, s\''], ['replay_buffer', 'critic2', 'flow'],
      ['critic1', 'min_critic', 'flow'], ['critic2', 'min_critic', 'flow'],
      ['output', 'target_smoothing', 'context', 'noise added only to the TARGET copy of this action'],
      ['target_smoothing', 'targets', 'context', 'smoothed action scores the frozen target critics'],
      ['targets', 'td_target', 'context', 'min over the frozen twins at the smoothed next action'],
      ['min_critic', 'td_target', 'context', 'current twin-critic estimate vs target'],
      ['td_target', 'critic1', 'context', 'regression, every step'],
      ['td_target', 'critic2', 'context', 'regression, every step'],
      ['td_target', 'actor', 'context', 'ascend critic1 Q, DELAYED every d steps'],
    ],
  }),

  // ─── Distributional & Exploration Enhancements ──────────────────────────

  'reinforcement-learning-rl-model-free-rl-distributional-exploration-enhancements-noisy-dqn': blueprint({
    title: 'Noisy DQN',
    subtitle: 'learned, state-dependent exploration replaces epsilon-greedy',
    nodes: [
      stateInput(0),
      { id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `${FLAT} → ${H}, ReLU`, params: P.linear(FLAT, H), column: 1, lane: 0 },
      {
        id: 'noisy_hidden', kind: 'stochastic', label: 'Noisy linear', sublabel: 'w = mu_w + sigma_w · eps_w, factorized noise',
        params: 2 * P.linear(H, H), column: 2, lane: 0,
        detail: { formula: '2 · P.linear(H, H) — mu AND sigma per weight' },
        analogy: 'Think of it as the network\'s own hand trembling more in unfamiliar markets and steadying once it has genuinely learned the regime.',
      },
      { id: 'noisy_q_head', kind: 'head', label: 'Noisy Q-head', sublabel: `Linear ${H} → ${A}, also noisy`, params: 2 * P.linear(H, A), column: 3, lane: 0 },
      { id: 'output', kind: 'output', label: 'Hold · long · short', sublabel: 'argmax, noise already explored', column: 4, lane: 0 },
      { id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', column: 1, lane: 1 },
      { id: 'target_network', kind: 'memory', label: 'Target network', sublabel: 'noise resampled independently', column: 4, lane: 1 },
      { id: 'td_target', kind: 'compare', label: 'TD target', sublabel: 'r + gamma·max_a\' Q_target(s\',a\')', column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'encoder', 'noisy_hidden', 'noisy_q_head', 'output'),
      ['input', 'replay_buffer', 'flow'],
      ['replay_buffer', 'td_target', 'flow'],
      ['noisy_q_head', 'td_target', 'context', 'Q(s,a) current'],
      ['target_network', 'td_target', 'context', 'bootstrapped target'],
      ['td_target', 'noisy_hidden', 'context', 'backprop, updates mu AND sigma'],
      ['noisy_q_head', 'target_network', 'context', 'periodic hard copy'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-distributional-exploration-enhancements-rainbow-dqn': blueprint({
    title: 'Rainbow DQN',
    subtitle: 'dueling · distributional (C51) · double-Q · prioritized, n-step replay',
    nodes: [
      stateInput(0),
      encoderOneLayer(1),
      {
        id: 'value_stream', kind: 'head', label: 'Noisy value stream', sublabel: `NoisyLinear ${H} → ${ATOMS} atoms`,
        inShape: `B × ${H}`, outShape: `B × 1 × ${ATOMS}`, params: 2 * P.linear(H, ATOMS), column: 2, lane: 0,
        detail: { formula: `2 × P.linear(${H}, ${ATOMS}) — mu AND sigma per weight and bias` },
      },
      {
        id: 'advantage_stream', kind: 'head', label: 'Noisy advantage stream', sublabel: `NoisyLinear ${H} → ${A} × ${ATOMS} atoms`,
        inShape: `B × ${H}`, outShape: `B × ${A} × ${ATOMS}`, params: 2 * P.linear(H, A * ATOMS), column: 2, lane: 1,
        detail: { formula: `2 × P.linear(${H}, ${A} × ${ATOMS})` },
        analogy: 'Think of it as the per-action opinion carrying its own built-in tremor, steadier once the regime is genuinely learned.',
      },
      {
        id: 'dueling_combine', kind: 'fusion', label: 'Dueling combine', sublabel: 'V + (A − mean(A)), per atom', column: 3, lane: 0,
      },
      {
        id: 'distribution_output', kind: 'output', label: 'Return distribution', sublabel: 'categorical, per action',
        inShape: `B × ${A} × ${ATOMS}`, outShape: `B × ${A} × ${ATOMS}`, column: 4, lane: 0,
        analogy: 'Think of it as the model refusing to give one number for a trade\'s outcome, instead handing back the whole shape of what could happen.',
      },
      {
        id: 'prioritized_replay', kind: 'memory', label: 'Prioritized n-step replay', sublabel: 'sampled proportional to |TD error|', column: 1, lane: 1,
        analogy: 'Think of it as spending more study time on the trades the model got most wrong, instead of reviewing everything equally.',
      },
      {
        id: 'double_target', kind: 'memory', label: 'Double-Q target net', sublabel: 'the ONLINE net selects a*, this frozen copy evaluates it', column: 4, lane: 1,
        analogy: 'Think of it as one trader naming the move that looks best and a separate, slower colleague pricing only that move.',
      },
      { id: 'projection', kind: 'compare', label: 'C51 projection + cross-entropy', sublabel: 'projected n-step target vs predicted', column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'encoder'),
      ['encoder', 'value_stream', 'flow'], ['encoder', 'advantage_stream', 'flow'],
      ['value_stream', 'dueling_combine', 'flow'], ['advantage_stream', 'dueling_combine', 'flow'],
      ['dueling_combine', 'distribution_output', 'flow'],
      ['input', 'prioritized_replay', 'context', 'transitions stored with their n-step reward'],
      ['prioritized_replay', 'double_target', 'flow', 'sampled minibatch, n-step'],
      ['distribution_output', 'double_target', 'context', 'online argmax over expected return names a*'],
      ['double_target', 'projection', 'flow', 'projected target distribution'],
      ['distribution_output', 'projection', 'context', 'predicted vs target, cross-entropy'],
      ['projection', 'encoder', 'context', 'backprop, priority update'],
    ],
  }),

  // ─── Evolutionary Methods ────────────────────────────────────────────────

  'reinforcement-learning-rl-model-free-rl-evolutionary-methods-cross-entropy-method-cem': blueprint({
    title: 'Cross-Entropy Method (CEM)',
    subtitle: 'population search over a linear policy, no gradient',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar features', sublabel: `this bar\'s ${F} features, no window`,
        outShape: `B × ${F}`, column: 0,
        analogy: 'Think of it as a candidate strategy glancing at this bar\'s indicators and scoring each of the 3 actions with one line of arithmetic.',
      },
      {
        id: 'linear_policy', kind: 'head', label: 'Linear policy', sublabel: `theta = (W, b), the searched vector`,
        inShape: `B × ${F}`, outShape: `B × ${A}`, params: P.linear(F, A), column: 1, lane: 0,
        detail: { formula: `P.linear(${F}, ${A}) — the parameter count being SEARCHED, not gradient-trained` },
      },
      {
        id: 'search_distribution', kind: 'memory', label: 'Search distribution', sublabel: 'Gaussian mean mu, diag variance sigma^2 over theta', column: 0, lane: 1,
        analogy: 'Think of it as a fuzzy cloud of guesses about the best strategy, that sharpens generation by generation.',
      },
      {
        id: 'population_sample', kind: 'stochastic', label: 'Sample K candidates', sublabel: 'theta_k ~ N(mu, diag(sigma^2))', column: 1, lane: 1,
      },
      {
        id: 'backtest_episode', kind: 'ensemble', label: 'K full backtests', sublabel: 'each candidate runs an entire episode', column: 2, lane: 0,
        analogy: 'Think of it as K interns, each handed a different strategy and told to trade the whole training span alone.',
      },
      { id: 'fitness_rank', kind: 'compare', label: 'Rank by total P&L', column: 3, lane: 0 },
      { id: 'elite_select', kind: 'compare', label: 'Keep top fraction', sublabel: 'elite fraction, typically 10-20%', column: 4, lane: 0 },
      { id: 'output', kind: 'output', label: 'Deployed policy', sublabel: 'final mu, zero sampling variance', column: 5, lane: 0 },
    ],
    edges: [
      ['search_distribution', 'population_sample', 'flow'],
      ['population_sample', 'linear_policy', 'context', 'candidate theta plugged in'],
      ['input', 'linear_policy', 'flow'],
      ['linear_policy', 'backtest_episode', 'flow'],
      ['backtest_episode', 'fitness_rank', 'flow'],
      ['fitness_rank', 'elite_select', 'flow'],
      ['elite_select', 'search_distribution', 'context', 'refit mu, sigma to elite mean/variance, repeat'],
      ['search_distribution', 'output', 'context', 'final mu deployed, sigma → 0'],
    ],
  }),

  // ─── Policy Gradient Methods ─────────────────────────────────────────────

  'reinforcement-learning-rl-model-free-rl-policy-gradient-methods-proximal-policy-optimization-ppo': blueprint({
    title: 'Proximal Policy Optimization (PPO)',
    subtitle: 'clipped ratio · GAE · K epochs per rollout batch · separate actor and critic towers',
    nodes: [
      stateInput(0),
      sb3Tower('actor_tower', 'Actor tower', 1, 0),
      sb3Tower('critic_tower', 'Critic tower', 1, 1),
      {
        id: 'actor_head', kind: 'head', label: 'Action net', sublabel: `Linear ${HSB3} → ${A}`,
        inShape: `B × ${HSB3}`, outShape: `B × ${A}`, params: P.linear(HSB3, A), column: 2, lane: 0,
      },
      {
        id: 'critic_head', kind: 'head', label: 'Value net', sublabel: `Linear ${HSB3} → 1`,
        inShape: `B × ${HSB3}`, outShape: 'B × 1', params: P.linear(HSB3, 1), column: 2, lane: 1,
      },
      { id: 'rollout_buffer', kind: 'memory', label: 'Rollout batch', sublabel: 'T steps, log pi_old stored', column: 3, lane: 0 },
      { id: 'gae_advantage', kind: 'compare', label: 'GAE advantage', sublabel: 'gamma, lambda weighted multi-step', column: 3, lane: 1 },
      {
        id: 'ratio_clip', kind: 'compare', label: 'Clipped surrogate', sublabel: 'r_t(theta) clipped to [1-eps, 1+eps]', column: 4, lane: 0,
        analogy: 'Think of it as letting the trader adjust strategy from this batch\'s lesson, but capping how far a single lesson can push them.',
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', outShape: `B × ${A}`, column: 5, lane: 0 },
    ],
    edges: [
      ['input', 'actor_tower', 'flow'], ['input', 'critic_tower', 'flow'],
      ['actor_tower', 'actor_head', 'flow'], ['critic_tower', 'critic_head', 'flow'],
      ['actor_head', 'rollout_buffer', 'flow', 'log pi_old, action stored'],
      ['critic_head', 'gae_advantage', 'flow'],
      ['rollout_buffer', 'gae_advantage', 'context', 'rewards from the rollout'],
      ['gae_advantage', 'ratio_clip', 'flow'],
      ['rollout_buffer', 'ratio_clip', 'context', 'pi_old for the ratio denominator'],
      ['actor_head', 'output', 'flow'],
      ['ratio_clip', 'actor_tower', 'context', 'clipped loss, K epochs, backprop'],
      ['ratio_clip', 'critic_tower', 'context', 'value loss, backprop'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-policy-gradient-methods-reinforce': blueprint({
    title: 'REINFORCE',
    subtitle: 'Monte Carlo return · whole episode per update, no critic',
    nodes: [
      stateInput(0),
      {
        id: 'encoder', kind: 'linear', label: 'Hidden layer', sublabel: `${FLAT} → ${H}, ReLU`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H), column: 1, lane: 0,
        detail: { formula: `P.linear(${FLAT}, ${H})` },
      },
      {
        id: 'policy_head', kind: 'head', label: 'Policy head', sublabel: `Linear ${H} → ${A}`,
        inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0,
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', outShape: `B × ${A}`, column: 3, lane: 0 },
      { id: 'environment', kind: 'stochastic', label: 'Full episode rollout', sublabel: 'no update until it ends', column: 4, lane: 0 },
      {
        id: 'episode_return', kind: 'compare', label: 'Return-to-go G_t', sublabel: 'sum of REALIZED discounted rewards', column: 5, lane: 0,
        analogy: 'Think of it as never grading a trade until the entire session has closed, then crediting every decision with the true final outcome.',
      },
      {
        id: 'baseline', kind: 'memory', label: 'EMA baseline', sublabel: 'moving average of past episode returns, no network', column: 5, lane: 1,
      },
      { id: 'policy_gradient', kind: 'compare', label: 'Policy gradient', sublabel: 'log pi(a|s) · (G_t − baseline)', column: 6, lane: 0 },
    ],
    edges: [
      ...chain('input', 'encoder', 'policy_head', 'output', 'environment', 'episode_return', 'policy_gradient'),
      ['baseline', 'policy_gradient', 'context', 'subtract EMA'],
      ['episode_return', 'baseline', 'context', 'update EMA after this episode'],
      ['policy_gradient', 'policy_head', 'context', 'REINFORCE step, whole episode at once'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-policy-gradient-methods-trust-region-policy-optimization-trpo': blueprint({
    title: 'Trust Region Policy Optimization (TRPO)',
    subtitle: 'natural gradient · conjugate gradient · KL-constrained line search',
    nodes: [
      stateInput(0),
      sb3Tower('actor_tower', 'Actor tower', 1, 0),
      sb3Tower('critic_tower', 'Critic tower', 1, 1),
      {
        id: 'actor_head', kind: 'head', label: 'Action net', sublabel: `Linear ${HSB3} → ${A}`,
        inShape: `B × ${HSB3}`, outShape: `B × ${A}`, params: P.linear(HSB3, A), column: 2, lane: 0,
      },
      {
        id: 'critic_head', kind: 'head', label: 'Value net', sublabel: `Linear ${HSB3} → 1`,
        inShape: `B × ${HSB3}`, outShape: 'B × 1', params: P.linear(HSB3, 1), column: 2, lane: 1,
      },
      { id: 'rollout_buffer', kind: 'memory', label: 'Rollout batch', column: 3, lane: 0 },
      { id: 'gae_advantage', kind: 'compare', label: 'GAE advantage', column: 3, lane: 1 },
      {
        id: 'fisher_cg', kind: 'compare', label: 'Natural gradient', sublabel: 'conjugate gradient solves Fx=g, Fisher curvature',
        column: 4, lane: 0,
        analogy: 'Think of it as steering by how much a small nudge actually MOVES the trader\'s behavior, not just by the raw size of the nudge.',
      },
      {
        id: 'line_search', kind: 'compare', label: 'Backtracking line search', sublabel: 'exact KL <= delta, objective improves', column: 5, lane: 0,
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', column: 6, lane: 0 },
    ],
    edges: [
      ['input', 'actor_tower', 'flow'], ['input', 'critic_tower', 'flow'],
      ['actor_tower', 'actor_head', 'flow'], ['critic_tower', 'critic_head', 'flow'],
      ['actor_head', 'rollout_buffer', 'flow'],
      ['rollout_buffer', 'gae_advantage', 'context', 'rewards + V(s)'],
      ['critic_head', 'gae_advantage', 'flow'],
      ['gae_advantage', 'fisher_cg', 'flow'],
      ['actor_head', 'fisher_cg', 'context', 'policy distribution, Fisher curvature'],
      ['fisher_cg', 'line_search', 'flow'],
      ['line_search', 'actor_tower', 'context', 'accepted step, KL <= delta'],
      ['actor_head', 'output', 'flow'],
      ['line_search', 'critic_tower', 'context', 'separate value regression, n_critic_updates per step'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-policy-gradient-methods-vanilla-policy-gradient': blueprint({
    title: 'Vanilla Policy Gradient',
    subtitle: 'batched Monte Carlo · learned baseline, never bootstrapped',
    nodes: [
      stateInput(0),
      {
        id: 'policy_trunk', kind: 'linear', label: 'Policy hidden layer', sublabel: `${FLAT} → ${H}, ReLU`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H), column: 1, lane: 0,
        detail: { formula: `P.linear(${FLAT}, ${H})` },
      },
      {
        id: 'baseline_trunk', kind: 'linear', label: 'Baseline hidden layer', sublabel: `${FLAT} → ${H}, ReLU — its OWN weights`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${H}`, params: P.linear(FLAT, H), column: 1, lane: 1,
        detail: { formula: `P.linear(${FLAT}, ${H})`, 'shared with the policy': 'nothing — two separate nn.Sequential stacks' },
        analogy: 'Think of it as a second analyst reading the same candles from scratch, keeping their own notes rather than borrowing the trader\'s.',
      },
      {
        id: 'policy_head', kind: 'head', label: 'Policy head', sublabel: `Linear ${H} → ${A}`,
        inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, A), column: 2, lane: 0,
      },
      {
        id: 'baseline_head', kind: 'head', label: 'Baseline head', sublabel: `Linear ${H} → 1, fit by regression`,
        inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, 1), column: 2, lane: 1,
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', outShape: `B × ${A}`, column: 3, lane: 0 },
      {
        id: 'environment', kind: 'stochastic', label: 'N episodes this batch', column: 4, lane: 0,
        analogy: 'Think of it as running N full trading sessions before drawing any lesson, instead of learning from just one noisy session.',
      },
      { id: 'episode_batch', kind: 'memory', label: 'N-episode batch', sublabel: 'reward-to-go G_t per step, every episode', column: 5, lane: 0 },
      { id: 'advantage', kind: 'compare', label: 'Batched advantage', sublabel: 'G_t − V_phi(s_t), averaged over N', column: 6, lane: 0 },
    ],
    edges: [
      ['input', 'policy_trunk', 'flow'], ['input', 'baseline_trunk', 'flow'],
      ['policy_trunk', 'policy_head', 'flow'], ['baseline_trunk', 'baseline_head', 'flow'],
      ['policy_head', 'output', 'flow'],
      ...chain('output', 'environment', 'episode_batch', 'advantage'),
      ['baseline_head', 'advantage', 'context', 'V_phi(s_t) subtracted, never bootstrapped'],
      ['advantage', 'baseline_trunk', 'context', 'regression toward G_t, backprop'],
      ['advantage', 'policy_trunk', 'context', 'batched policy gradient, backprop'],
    ],
  }),

  // ─── Value-Based Methods ──────────────────────────────────────────────────

  'reinforcement-learning-rl-model-free-rl-value-based-methods-deep-q-network-dqn': blueprint({
    title: 'Deep Q-Network (DQN)',
    subtitle: 'experience replay · frozen target network',
    nodes: [
      stateInput(0),
      {
        id: 'q_network', kind: 'linear', label: 'Online Q-network', sublabel: `${FLAT} → ${HSB3} → ${HSB3} → ${A}`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${A}`,
        params: P.linear(FLAT, HSB3) + P.linear(HSB3, HSB3) + P.linear(HSB3, A), column: 1, lane: 0,
        detail: {
          net_arch: `[${HSB3}, ${HSB3}] — stable-baselines3 MlpPolicy default`,
          formula: `P.linear(${FLAT}, ${HSB3}) + P.linear(${HSB3}, ${HSB3}) + P.linear(${HSB3}, ${A})`,
        },
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', sublabel: 'argmax Q(s,a)', outShape: `B × ${A}`, column: 2, lane: 0 },
      {
        id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', sublabel: 'uniform random sampling', column: 1, lane: 1,
        analogy: 'Think of it as a trading journal the model rereads out of order, so consecutive lessons never come from the same narrow stretch of bars.',
      },
      { id: 'target_network', kind: 'memory', label: 'Target network', sublabel: 'periodic frozen copy', column: 2, lane: 1 },
      { id: 'td_target', kind: 'compare', label: 'Bellman target', sublabel: 'r + gamma·max_a\' Q_target(s\',a\')', column: 3, lane: 0 },
    ],
    edges: [
      ...chain('input', 'q_network', 'output'),
      ['input', 'replay_buffer', 'flow'],
      ['replay_buffer', 'td_target', 'flow'],
      ['q_network', 'td_target', 'context', 'Q(s,a) current'],
      ['target_network', 'td_target', 'context', 'max over target Q, bootstrap'],
      ['td_target', 'q_network', 'context', 'TD regression, backprop'],
      ['q_network', 'target_network', 'context', 'periodic hard copy every N steps'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-value-based-methods-double-dqn': blueprint({
    title: 'Double DQN',
    subtitle: 'selection and evaluation decoupled — corrects overestimation',
    nodes: [
      stateInput(0),
      {
        id: 'q_network', kind: 'linear', label: 'Online Q-network', sublabel: `${FLAT} → ${H} → ${H} → ${A}`,
        params: P.linear(FLAT, H) + P.linear(H, H) + P.linear(H, A), column: 1, lane: 0,
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', column: 2, lane: 0 },
      { id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', column: 1, lane: 1 },
      { id: 'target_network', kind: 'memory', label: 'Target network', column: 2, lane: 1 },
      {
        id: 'action_select', kind: 'compare', label: 'a* = argmax Q_online(s\',a)', sublabel: 'SELECTION, online net', column: 3, lane: 0,
        analogy: 'Think of it as one trader proposing which move looks best, and a separate, skeptical trader grading only how good THAT specific move is.',
      },
      { id: 'value_evaluate', kind: 'compare', label: 'Q_target(s\', a*)', sublabel: 'EVALUATION, target net — not its own argmax', column: 4, lane: 0 },
      { id: 'td_target', kind: 'compare', label: 'Decoupled TD target', sublabel: 'y = r + gamma·Q_target(s\', a*)', column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'q_network', 'output'),
      ['input', 'replay_buffer', 'flow'],
      ['replay_buffer', 'action_select', 'flow', 'next state s\''],
      ['q_network', 'action_select', 'context', 'online net picks a*'],
      ['action_select', 'value_evaluate', 'flow'],
      ['target_network', 'value_evaluate', 'context', 'target net scores a*'],
      ['value_evaluate', 'td_target', 'flow'],
      ['replay_buffer', 'td_target', 'context', 'reward r'],
      ['td_target', 'q_network', 'context', 'regression, backprop'],
      ['q_network', 'target_network', 'context', 'periodic copy'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-value-based-methods-dueling-dqn': blueprint({
    title: 'Dueling DQN',
    subtitle: 'state value and action advantage learned as separate streams',
    nodes: [
      stateInput(0),
      encoderOneLayer(1),
      {
        id: 'value_stream', kind: 'head', label: 'Value stream V(s)', sublabel: `${H} → ${HALF} → 1, ReLU between`,
        inShape: `B × ${H}`, outShape: 'B × 1', params: P.linear(H, HALF) + P.linear(HALF, 1), column: 2, lane: 0,
        detail: { formula: `P.linear(${H}, ${HALF}) + P.linear(${HALF}, 1)` },
      },
      {
        id: 'advantage_stream', kind: 'head', label: 'Advantage stream A(s,a)', sublabel: `${H} → ${HALF} → ${A}, ReLU between`,
        inShape: `B × ${H}`, outShape: `B × ${A}`, params: P.linear(H, HALF) + P.linear(HALF, A), column: 2, lane: 1,
        detail: { formula: `P.linear(${H}, ${HALF}) + P.linear(${HALF}, ${A})` },
        analogy: 'Think of it as separating "is this a good market to be in at all" from "which specific action is best right now".',
      },
      {
        id: 'dueling_combine', kind: 'fusion', label: 'Q = V + (A − mean(A))', sublabel: 'mean-subtraction for identifiability', column: 3, lane: 0,
      },
      { id: 'output', kind: 'output', label: 'Hold · long · short', column: 4, lane: 0 },
      { id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', column: 1, lane: 1 },
      { id: 'target_network', kind: 'memory', label: 'Target network', sublabel: 'own dueling streams', column: 4, lane: 1 },
      { id: 'td_target', kind: 'compare', label: 'Bellman target', column: 5, lane: 0 },
    ],
    edges: [
      ...chain('input', 'encoder'),
      ['encoder', 'value_stream', 'flow'], ['encoder', 'advantage_stream', 'flow'],
      ['value_stream', 'dueling_combine', 'flow'], ['advantage_stream', 'dueling_combine', 'flow'],
      ['dueling_combine', 'output', 'flow'],
      ['input', 'replay_buffer', 'flow'],
      ['replay_buffer', 'td_target', 'flow'],
      ['dueling_combine', 'td_target', 'context', 'current Q(s,a)'],
      ['target_network', 'td_target', 'context', 'bootstrap target, own streams'],
      ['td_target', 'encoder', 'context', 'backprop through both streams'],
      ['dueling_combine', 'target_network', 'context', 'periodic copy'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-value-based-methods-q-learning': blueprint({
    title: 'Q-Learning',
    subtitle: 'tabular · off-policy · no network at all',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar indicators', sublabel: '2-5 hand-chosen features, this bar', column: 0,
        analogy: 'Think of it as a trader glancing at just a couple of readouts — momentum, volatility — rather than the full 35-feature board.',
      },
      { id: 'discretize', kind: 'reshape', label: 'Quantile binning', sublabel: 'continuous feature -> bin index', column: 1 },
      {
        id: 'q_table', kind: 'memory', label: 'Q-table', sublabel: '25 states × 3 actions, updated directly', params: P.embedding(25, A), column: 2,
        detail: { formula: `P.embedding(25, ${A}) — the table entries themselves ARE the parameters, no gradient` },
        analogy: 'Think of it as a lookup card: for each of 25 discretized market states, three numbers say how good hold, long and short have looked so far.',
      },
      { id: 'action_select', kind: 'stochastic', label: 'Epsilon-greedy select', sublabel: 'argmax Q(s,·), or random with prob epsilon', column: 3 },
      { id: 'output', kind: 'output', label: 'Hold · long · short', column: 4 },
      { id: 'environment', kind: 'stochastic', label: 'Environment step', column: 5 },
      {
        id: 'td_update', kind: 'compare', label: 'Direct table update', sublabel: 'Q(s,a) += alpha·(r + gamma·max Q(s\',·) − Q(s,a))', column: 6,
        analogy: 'Think of it as erasing and rewriting one cell of the lookup card by hand — no gradients, no network, just arithmetic.',
      },
    ],
    edges: [
      ...chain('input', 'discretize', 'q_table', 'action_select', 'output', 'environment', 'td_update'),
      ['q_table', 'td_update', 'context', 'current Q(s,a) AND max over Q(s\',·)'],
      ['td_update', 'q_table', 'context', 'in-place update, no backprop'],
    ],
  }),

  'reinforcement-learning-rl-model-free-rl-value-based-methods-sarsa-state-action-reward-state-action': blueprint({
    title: 'SARSA (State-Action-Reward-State-Action)',
    subtitle: 'tabular · on-policy — bootstraps from the action actually taken next',
    nodes: [
      { id: 'input', kind: 'input', label: 'Bar indicators', sublabel: '2-5 hand-chosen features, this bar', column: 0 },
      { id: 'discretize', kind: 'reshape', label: 'Quantile binning', column: 1 },
      {
        id: 'q_table', kind: 'memory', label: 'Q-table', sublabel: '25 states × 3 actions', params: P.embedding(25, A), column: 2,
        detail: { formula: `P.embedding(25, ${A})` },
      },
      { id: 'action_select', kind: 'stochastic', label: 'Epsilon-greedy select', column: 3 },
      { id: 'output', kind: 'output', label: 'Hold · long · short', column: 4 },
      { id: 'environment', kind: 'stochastic', label: 'Environment step', column: 5 },
      {
        id: 'next_action_select', kind: 'stochastic', label: 'Select NEXT action a\'', sublabel: 'SAME policy, chosen BEFORE the update', column: 6,
        analogy: 'Think of it as committing to what you would actually do next, exploration included, before grading whether the last move was good.',
      },
      {
        id: 'td_update', kind: 'compare', label: 'On-policy table update', sublabel: 'Q(s,a) += alpha·(r + gamma·Q(s\',a\') − Q(s,a))', column: 7,
        analogy: 'Think of it as grading the last move by what you will actually do next, exploration risk included — not by the impossible best case.',
      },
    ],
    edges: [
      ...chain('input', 'discretize', 'q_table', 'action_select', 'output', 'environment', 'next_action_select', 'td_update'),
      ['q_table', 'next_action_select', 'context', 'epsilon-greedy on Q(s\',·)'],
      ['q_table', 'td_update', 'context', 'Q(s,a) and Q(s\',a\') both read'],
      ['td_update', 'q_table', 'context', 'direct update using a\' actually taken, ON-POLICY'],
      ['next_action_select', 'action_select', 'context', '(s\',a\') carried forward as next step\'s (s,a)'],
    ],
  }),
};
