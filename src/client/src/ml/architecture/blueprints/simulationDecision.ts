/**
 * Blueprints — Simulation & Decision Models.
 *
 * These are, almost without exception, NOT layer stacks: an agent-based
 * model has no forward pass, a decision tree's leaves store a majority
 * class rather than a learned weight, and a Nash equilibrium solver runs a
 * linear program, not backpropagation. `params` is therefore omitted on
 * most nodes — the honest answer for this whole category — and `detail`
 * states what IS estimated or stored (a population, a conditional
 * probability table, a payoff matrix) instead. Where a stage genuinely is a
 * small trainable network (a multi-agent RL policy), `P.*` is used exactly
 * as in the neural blueprints.
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const C = DIM.classes;

export const SIMULATION_DECISION_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Agent-Based & Multi-Agent Systems ──────────────────────────────────

  'simulation-decision-models-agent-based-multi-agent-systems-agent-based-modeling': blueprint({
    title: 'Agent-Based Modeling',
    subtitle: 'heterogeneous rule-based agents clear into one price series; the offline moment-calibration loop is not drawn',
    nodes: [
      {
        id: 'market_state', kind: 'input', label: 'Market state Omega(t)', sublabel: 'recent OHLCV, order-book depth',
        column: 0,
        analogy: 'Think of it as every agent glancing at the same tape of recent candles before deciding what to do next.',
      },
      {
        id: 'trend_agent', kind: 'compare', label: 'Trend-follower agents', sublabel: 'signal = close - lookback mean',
        column: 1, lane: 0,
        detail: { population: '40 agents, lookback 5-100 bars each' },
      },
      {
        id: 'mean_revert_agent', kind: 'compare', label: 'Mean-reversion agents', sublabel: 'z = (close - mean) / std',
        column: 1, lane: 1,
        analogy: 'Think of it as a trader who fades every move away from the recent average, sized by how far price has stretched.',
      },
      {
        id: 'noise_agent', kind: 'stochastic', label: 'Noise trader agents', sublabel: 'uniform random order, seeded generator',
        column: 1, lane: 2,
        detail: { role: 'null baseline: submits order flow that carries no information about the state' },
      },
      {
        id: 'clearing', kind: 'fusion', label: 'Market clearing', sublabel: 'aggregate order imbalance -> price',
        column: 2,
        detail: { mechanism: 'order-imbalance price update, or a simplified limit order book' },
        analogy: 'Think of it as an auctioneer averaging every agent\'s order into one clearing price for the bar.',
      },
      {
        id: 'output', kind: 'output', label: 'Simulated OHLCV path', sublabel: 'R independent runs',
        column: 3,
      },
    ],
    edges: [
      ['market_state', 'trend_agent', 'flow'],
      ['market_state', 'mean_revert_agent', 'flow'],
      ['market_state', 'noise_agent', 'flow'],
      ['trend_agent', 'clearing', 'flow'],
      ['mean_revert_agent', 'clearing', 'flow'],
      ['noise_agent', 'clearing', 'flow'],
      ['clearing', 'output', 'flow'],
      ['output', 'market_state', 'context', 'next bar, updated Omega'],
      ['output', 'trend_agent', 'context', 'realized P&L rescales or retires each agent'],
      ['output', 'mean_revert_agent', 'context', 'realized P&L rescales or retires each agent'],
    ],
  }),

  'simulation-decision-models-agent-based-multi-agent-systems-multi-agent-simulation': blueprint({
    title: 'Multi-Agent Simulation',
    subtitle: 'two of the spec\'s 2-12 roles drawn, trained by MADDPG: centralized critic, decentralized actors',
    nodes: [
      {
        id: 'observation', kind: 'input', label: 'Observed state', sublabel: `${F} features, per-role visibility`,
        outShape: `B × ${F}`, column: 0,
      },
      {
        id: 'mm_policy', kind: 'head', label: 'Market-maker actor', sublabel: `${F} -> 64 -> quote (bid, ask)`,
        inShape: `B × ${F}`, outShape: 'B × 2', params: P.linear(F, 64) + P.linear(64, 2), column: 1, lane: 0,
        detail: { 'sees at inference': 'its own observation only', 'formula': 'P.linear(35, 64) + P.linear(64, 2)' },
        analogy: 'Think of it as a market maker deciding where to post bid and ask, leaning quotes away from its own inventory.',
      },
      {
        id: 'informed_policy', kind: 'head', label: 'Informed-trader actor', sublabel: `${F} -> 64 -> action`,
        inShape: `B × ${F}`, outShape: `B × ${C}`, params: P.linear(F, 64) + P.linear(64, C), column: 1, lane: 1,
        detail: { 'sees at inference': 'its own observation plus its private signal', 'formula': 'P.linear(35, 64) + P.linear(64, 3)' },
      },
      {
        id: 'environment', kind: 'fusion', label: 'Environment (matching engine)', sublabel: 'resolves all submitted actions',
        column: 2,
        analogy: 'Think of it as the exchange itself: it takes every agent\'s order and decides who trades with whom, at what price.',
      },
      {
        id: 'replay_buffer', kind: 'memory', label: 'Replay buffer', sublabel: '10k-1M transitions per agent',
        column: 3, lane: 1,
        detail: { stores: 'joint (observation, action, reward, next observation) tuples' },
      },
      {
        id: 'centralized_critic', kind: 'head', label: 'Centralized critic Q', sublabel: `all ${2 * F} observations + all ${2 + C} action values -> 64 -> 1`,
        inShape: `B × ${2 * F + 2 + C}`, outShape: 'B × 1',
        params: P.linear(2 * F + 2 + C, 64) + P.linear(64, 1), column: 4, lane: 1,
        detail: {
          'training time': 'sees every agent\'s observation and action, which is what stabilizes a non-stationary opponent',
          'inference time': 'discarded -- each actor runs on its own observation alone',
          'drawn once, simplified': 'MADDPG gives each agent its OWN centralized critic; one is drawn here, so a K-agent run has K of these',
          'formula': 'P.linear(2*35 + 2 + 3, 64) + P.linear(64, 1)',
        },
        analogy: 'Think of it as a risk manager who watches every desk\'s book at once and tells each trader how good their fill really was, knowing what everyone else did that bar.',
      },
      {
        id: 'output', kind: 'output', label: 'New state + rewards', sublabel: 'OHLCV bar, per-agent P&L',
        column: 5, lane: 0,
      },
    ],
    edges: [
      ['observation', 'mm_policy', 'flow'],
      ['observation', 'informed_policy', 'flow'],
      ['mm_policy', 'environment', 'flow'],
      ['informed_policy', 'environment', 'flow'],
      ['environment', 'output', 'flow'],
      ['environment', 'replay_buffer', 'flow'],
      ['replay_buffer', 'centralized_critic', 'flow'],
      ['centralized_critic', 'mm_policy', 'context', 'deterministic policy gradient'],
      ['centralized_critic', 'informed_policy', 'context', 'deterministic policy gradient'],
      ['output', 'observation', 'context', 'next observation'],
    ],
  }),

  // ─── Evolutionary Decision Models (general) ─────────────────────────────

  'simulation-decision-models-evolutionary-decision-models': blueprint({
    title: 'Evolutionary Decision Models',
    subtitle: 'population of trading rules, selected by simulated fitness',
    nodes: [
      {
        id: 'population_init', kind: 'input', label: 'Random population init', sublabel: 'M candidate rules or parameter vectors',
        column: 0,
        detail: { population: '50-1000 candidates' },
      },
      {
        id: 'fitness_eval', kind: 'compare', label: 'Fitness evaluation', sublabel: 'simulate each candidate over training bars',
        column: 1,
        analogy: 'Think of it as backtesting every candidate rule in the population at once and writing down each one\'s score.',
      },
      {
        id: 'selection', kind: 'pool', label: 'Tournament selection', sublabel: 'fitter candidates more likely to reproduce',
        column: 2,
        detail: { 'tournament size': '2-10 drawn per parent slot', elitism: 'top 1-10 percent copied into the next generation unchanged' },
      },
      {
        id: 'crossover', kind: 'fusion', label: 'Crossover', sublabel: 'combine two parent rules into a child',
        column: 3,
        analogy: 'Think of it as splicing two half-decent trading rules together, hoping the combination beats either parent.',
      },
      {
        id: 'mutation', kind: 'stochastic', label: 'Mutation', sublabel: 'random perturbation, rate 0.001-0.10',
        column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Fittest evolved rule', sublabel: 'best candidate + fitness history',
        column: 5,
      },
    ],
    edges: [
      ...chain('population_init', 'fitness_eval', 'selection', 'crossover', 'mutation', 'output'),
      ['mutation', 'fitness_eval', 'context', 'new generation, repeat for G generations'],
    ],
  }),

  // ─── Fuzzy & Soft Logic Models ───────────────────────────────────────────

  'simulation-decision-models-fuzzy-soft-logic-models-fuzzy-decision-models': blueprint({
    title: 'Fuzzy Decision Models',
    subtitle: 'Mamdani inference: fuzzify, fire rules, defuzzify',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar indicators', sublabel: 'trend, volatility, momentum',
        column: 0,
      },
      {
        id: 'fuzzify', kind: 'norm', label: 'Fuzzification', sublabel: 'membership mu_T(x) in [0,1] per linguistic term',
        column: 1,
        analogy: 'Think of it as scoring how much this bar\'s trend counts as "weak", "neutral" or "strong" -- all three, by degree, not just one.',
      },
      {
        id: 'rule_firing', kind: 'compare', label: 'Rule firing strengths', sublabel: 'w_r = min over antecedent memberships',
        column: 2,
        detail: { rule_base: '5-200 if-then rules' },
      },
      {
        id: 'aggregation', kind: 'fusion', label: 'Aggregate rule outputs', sublabel: 'clip each consequent at w_r, then take the pointwise max',
        column: 3,
        detail: { implication: 'min (Mamdani clipping); the Larsen variant scales instead', aggregation: 'max across rules' },
      },
      {
        id: 'defuzzify', kind: 'pool', label: 'Defuzzification', sublabel: 'centroid method',
        column: 4,
        analogy: 'Think of it as collapsing every rule\'s fuzzy vote back into one crisp position-size number.',
      },
      {
        id: 'output', kind: 'output', label: 'Crisp decision value', sublabel: 'position-size multiplier or confidence',
        column: 5,
      },
    ],
    edges: chain('input', 'fuzzify', 'rule_firing', 'aggregation', 'defuzzify', 'output'),
  }),

  // ─── Game Theory & Strategic Reasoning ───────────────────────────────────

  'simulation-decision-models-game-theory-strategic-reasoning-game-theoretic-models-nash-zero-sum': blueprint({
    title: 'Game Theoretic Models (Nash, Zero-Sum)',
    subtitle: 'two-player payoff matrix solved by minimax linear program',
    nodes: [
      {
        id: 'fills', kind: 'input', label: 'Historical fills / counterparty behavior', column: 0,
      },
      {
        id: 'payoff_matrix', kind: 'memory', label: 'Estimated payoff matrix M', sublabel: 'action_i x action_j -> player 1 payoff, u_2 = -u_1',
        column: 1,
        detail: { estimated_from: 'historical fills or a calibrated model of counterparty response', shrinkage: 'toward a symmetric-game prior where a cell has few observations' },
      },
      {
        id: 'minimax_lp', kind: 'compare', label: 'Minimax linear program', sublabel: 'max v subject to sum_i p_i M_ij >= v for every j, sum_i p_i = 1',
        column: 2,
        detail: { solver: 'simplex or interior point; exact, not iterative', dual: 'the same program solved for player 2 gives q and the identical value v' },
        analogy: 'Think of it as asking for the quoting mix whose worst-case profit against any single counterparty response is as high as it can be made.',
      },
      {
        id: 'player1_mixed', kind: 'stochastic', label: 'Player 1 mixed strategy p', sublabel: 'primal solution: probability distribution over our actions',
        column: 3, lane: 0,
        analogy: 'Think of it as our quoting desk randomizing between a few plausible quote levels so a competitor cannot predict us exactly.',
      },
      {
        id: 'player2_mixed', kind: 'stochastic', label: 'Player 2 mixed strategy q', sublabel: 'dual solution: the counterparty\'s equilibrium mix',
        column: 3, lane: 1,
      },
      {
        id: 'output', kind: 'output', label: 'Equilibrium strategy + game value v', column: 4,
      },
    ],
    edges: [
      ['fills', 'payoff_matrix', 'flow'],
      ['payoff_matrix', 'minimax_lp', 'flow'],
      ['minimax_lp', 'player1_mixed', 'flow'],
      ['minimax_lp', 'player2_mixed', 'flow'],
      ['player1_mixed', 'output', 'flow'],
      ['player2_mixed', 'output', 'flow'],
    ],
  }),

  // ─── Probabilistic Inference & Sampling ──────────────────────────────────

  'simulation-decision-models-probabilistic-inference-sampling-markov-chain-monte-carlo-mcmc': blueprint({
    title: 'Markov Chain Monte Carlo (MCMC)',
    subtitle: 'Metropolis-Hastings chain sampling a posterior over model parameters',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Observed returns + prior', sublabel: 'unnormalized target pi(theta) = likelihood x prior',
        column: 0,
        analogy: 'Think of it as the return history plus whatever you believed about the volatility model before you looked at it.',
      },
      {
        id: 'chain_state', kind: 'memory', label: 'Current theta', sublabel: 'chain state at step s',
        column: 1,
        analogy: 'Think of it as the chain\'s current best guess at the volatility model\'s parameters, updated one step at a time.',
      },
      {
        id: 'propose', kind: 'stochastic', label: 'Propose theta prime', sublabel: 'draw from q(theta_prime | theta)',
        column: 2,
      },
      {
        id: 'acceptance_test', kind: 'compare', label: 'Metropolis acceptance ratio', sublabel: 'alpha = min(1, [pi(theta_prime) q(theta | theta_prime)] / [pi(theta) q(theta_prime | theta)])',
        column: 3,
        detail: {
          'accept with probability alpha': 'theta at step s+1 becomes theta_prime',
          'otherwise': 'theta at step s+1 stays at theta -- the current state is recorded again, never dropped',
          'normalizing constant': 'cancels in the ratio, which is why it never has to be computed',
        },
        analogy: 'Think of it as a coin flip biased toward moves that make the fit better, but not exclusively -- occasionally accepting a worse step so the chain can explore.',
      },
      {
        id: 'chain_samples', kind: 'memory', label: 'Retained samples', sublabel: 'one row per step, burn-in discarded, then thinned', column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Posterior samples', sublabel: 'mean, credible intervals, predictive distribution',
        column: 5,
      },
    ],
    edges: [
      ['input', 'chain_state', 'flow'],
      ['chain_state', 'propose', 'flow'],
      ['propose', 'acceptance_test', 'flow'],
      ['acceptance_test', 'chain_state', 'context', 'accept: theta = theta_prime; reject: keep theta. Repeat for S steps'],
      ['acceptance_test', 'chain_samples', 'flow', 'record the step s state'],
      ['chain_samples', 'output', 'flow'],
    ],
  }),

  'simulation-decision-models-probabilistic-inference-sampling-monte-carlo-simulation': blueprint({
    title: 'Monte Carlo Simulation',
    subtitle: 'block-bootstrapped historical returns -> distribution of outcomes',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Historical return series', column: 0,
      },
      {
        id: 'block_bootstrap', kind: 'stochastic', label: 'Block bootstrap sample', sublabel: 'resample contiguous blocks, 5-60 bars',
        column: 1,
        analogy: 'Think of it as cutting the real return history into chunks and shuffling those chunks back together into a new, equally plausible path.',
      },
      {
        id: 'path_accumulate', kind: 'memory', label: 'Simulated path', sublabel: 'cumulate sampled returns, S paths in parallel',
        column: 2,
      },
      {
        id: 'strategy_apply', kind: 'compare', label: 'Apply strategy logic', sublabel: 'terminal P&L, max drawdown per path',
        column: 3,
      },
      {
        id: 'collect_distribution', kind: 'pool', label: 'Empirical distribution', sublabel: 'S draws of the quantity of interest',
        column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Risk metrics', sublabel: 'VaR, expected shortfall, ruin probability',
        column: 5,
      },
    ],
    edges: chain('input', 'block_bootstrap', 'path_accumulate', 'strategy_apply', 'collect_distribution', 'output'),
  }),

  // ─── Robust & Multi-Criteria Decision Frameworks ─────────────────────────

  'simulation-decision-models-robust-multi-criteria-decision-frameworks-multi-criteria-decision-analysis-mcda': blueprint({
    title: 'Multi-Criteria Decision Analysis (MCDA)',
    subtitle: 'TOPSIS: normalize, weight, rank by closeness to the ideal',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Decision matrix', sublabel: 'm alternatives x n criteria',
        outShape: 'm × n', column: 0,
        analogy: 'Think of it as a table with one row per candidate trade and one column per thing you care about -- expected return, volatility, liquidity, slippage.',
      },
      {
        id: 'normalize', kind: 'norm', label: 'Vector normalize', sublabel: 'r_ij = x_ij / sqrt(sum_i x_ij^2)',
        inShape: 'm × n', outShape: 'm × n', column: 1,
        detail: { purpose: 'puts every criterion column on one dimensionless scale so a volume in thousands cannot dominate a return in percent' },
      },
      {
        id: 'weight', kind: 'linear', label: 'Apply criterion weights', sublabel: 'v_ij = w_j . r_ij',
        inShape: 'm × n', outShape: 'm × n', column: 2,
        detail: { weights: 'n criteria, explicit or AHP-derived, sum to 1', learned: 'none -- the weights are stated by the analyst, not fitted' },
      },
      {
        id: 'ideal_distance', kind: 'compare', label: 'Distance to ideal A+', sublabel: 'D+_i = ||v_i - A+||, A+ is the best value per criterion',
        inShape: 'm × n', outShape: 'm × 1', column: 3, lane: 0,
      },
      {
        id: 'negative_ideal_distance', kind: 'compare', label: 'Distance to negative-ideal A-', sublabel: 'D-_i = ||v_i - A-||, A- is the worst value per criterion',
        inShape: 'm × n', outShape: 'm × 1', column: 3, lane: 1,
        analogy: 'Think of it as scoring each candidate trade by how close it sits to the best-of-every-criterion alternative, and how far from the worst.',
      },
      {
        id: 'closeness_score', kind: 'compare', label: 'Closeness coefficient', sublabel: 'C_i = D-/(D+ + D-)',
        inShape: 'm × 1', outShape: 'm × 1', column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Ranked alternatives', sublabel: 'sorted by C_i descending',
        outShape: 'm × 1', column: 5,
      },
    ],
    edges: [
      ...chain('input', 'normalize', 'weight'),
      ['weight', 'ideal_distance', 'flow'],
      ['weight', 'negative_ideal_distance', 'flow'],
      ['ideal_distance', 'closeness_score', 'flow'],
      ['negative_ideal_distance', 'closeness_score', 'flow'],
      ['closeness_score', 'output', 'flow'],
    ],
  }),

  'simulation-decision-models-robust-multi-criteria-decision-frameworks-robust-decision-making-rdm': blueprint({
    title: 'Robust Decision Making (RDM)',
    subtitle: 'candidate strategies swept across a wide scenario ensemble',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Deeply uncertain inputs', sublabel: 'vol regime, correlation breakdown, liquidity shock',
        column: 0,
      },
      {
        id: 'scenario_sampling', kind: 'stochastic', label: 'Latin hypercube sampling', sublabel: 'L scenarios across the uncertainty space',
        column: 1,
      },
      {
        id: 'strategy_a', kind: 'compare', label: 'Candidate strategy A', sublabel: 'conservative risk budget',
        column: 2, lane: 0,
      },
      {
        id: 'strategy_b', kind: 'compare', label: 'Candidate strategy B', sublabel: 'aggressive risk budget',
        column: 2, lane: 1,
        analogy: 'Think of it as running every candidate strategy through hundreds of structurally different possible futures, not just the one that already happened.',
      },
      {
        id: 'performance_matrix', kind: 'memory', label: 'L x K performance matrix', column: 3,
      },
      {
        id: 'scenario_discovery', kind: 'tree', label: 'Scenario discovery', sublabel: 'PRIM/tree: which theta region causes failure',
        column: 4,
        analogy: 'Think of it as a detective working backward from every failed run to name the exact combination of conditions that caused it.',
      },
      {
        id: 'output', kind: 'output', label: 'Robustness ranking + vulnerability region', column: 5,
      },
    ],
    edges: [
      ['input', 'scenario_sampling', 'flow'],
      ['scenario_sampling', 'strategy_a', 'flow'],
      ['scenario_sampling', 'strategy_b', 'flow'],
      ['strategy_a', 'performance_matrix', 'flow'],
      ['strategy_b', 'performance_matrix', 'flow'],
      ['performance_matrix', 'scenario_discovery', 'flow'],
      ['scenario_discovery', 'output', 'flow'],
    ],
  }),

  'simulation-decision-models-robust-multi-criteria-decision-frameworks-scenario-analysis': blueprint({
    title: 'Scenario Analysis',
    subtitle: 'named driver-shock scenarios revalued through fitted sensitivities',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Driver history', sublabel: 'rate, volatility, correlation proxy',
        outShape: 'B × 3', column: 0,
      },
      {
        id: 'sensitivity_regression', kind: 'linear', label: 'Sensitivity regression', sublabel: 'ordinary least squares: instrument return ~ 3 drivers',
        inShape: 'B × 3', outShape: '3 × 1', params: P.linear(3, 1), column: 1,
        detail: {
          formula: 'P.linear(3 drivers, 1) = 3 coefficients + 1 intercept = 4',
          'what leaves this node': 'the 3 x 1 beta vector, not the B x 1 fitted values',
          'the intercept': 'fitted but never applied -- a scenario is a driver DELTA, so it cancels',
        },
        analogy: 'Think of it as measuring, from history, how many basis points this instrument moves per unit move in each driver.',
      },
      {
        id: 'scenario_definitions', kind: 'memory', label: 'Named scenarios', sublabel: 'base case, rate shock, liquidity crisis',
        outShape: 'K × 3', column: 2,
        detail: { count: 'a handful of named, internally-consistent driver-shock vectors, stated not sampled' },
        analogy: 'Think of it as three named, internally-consistent stories about the future, each with its own stated driver moves.',
      },
      {
        id: 'shock_apply', kind: 'fusion', label: 'Apply driver shocks', sublabel: 'instrument move = shock matrix (K x 3) . beta (3 x 1)',
        outShape: 'K × 1', column: 3,
        detail: { inputs: 'two differently-shaped feeds: the K x 3 scenario shocks and the 3 x 1 fitted beta' },
      },
      {
        id: 'revaluation', kind: 'compare', label: 'Portfolio revaluation', sublabel: 'notional x instrument move, per scenario',
        inShape: 'K × 1', outShape: 'K × 1', column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Scenario-by-scenario P&L table', sublabel: 'one row per named scenario',
        outShape: 'K × 1', column: 5,
      },
    ],
    edges: [
      ...chain('input', 'sensitivity_regression'),
      ['scenario_definitions', 'shock_apply', 'flow'],
      ['sensitivity_regression', 'shock_apply', 'flow'],
      ...chain('shock_apply', 'revaluation', 'output'),
    ],
  }),

  // ─── Simulation Techniques ────────────────────────────────────────────────

  'simulation-decision-models-simulation-techniques-discrete-event-simulation-des': blueprint({
    title: 'Discrete Event Simulation (DES)',
    subtitle: 'event queue advances straight to the next order arrival, cancel or fill',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Initial book state', sublabel: 'empty or seeded limit order book',
        column: 0, lane: 0,
      },
      {
        id: 'arrival_process', kind: 'stochastic', label: 'Fitted arrival process', sublabel: 'Poisson or self-exciting Hawkes inter-arrival draws',
        column: 0, lane: 1,
        detail: { fitted_from: 'real order-flow inter-arrival times, sizes and price offsets', why_hawkes: 'a Poisson process has no clustering, so it understates cancellation cascades' },
        analogy: 'Think of it as the clock that decides when the next order shows up -- and, in the Hawkes version, one arrival makes the next one more likely, the way real order flow comes in bursts.',
      },
      {
        id: 'event_queue', kind: 'memory', label: 'Event queue', sublabel: 'priority queue ordered by scheduled time',
        column: 1,
        analogy: 'Think of it as a to-do list sorted by time -- the simulation always does whatever is scheduled soonest, skipping every quiet moment in between.',
      },
      {
        id: 'pop_event', kind: 'compare', label: 'Pop earliest event', sublabel: 'advance simulated clock straight to its timestamp',
        column: 2,
      },
      {
        id: 'handler_arrival', kind: 'compare', label: 'Order arrival handler', sublabel: 'rest on the book by price-time priority, or cross',
        column: 3, lane: 0,
      },
      {
        id: 'handler_cancel', kind: 'compare', label: 'Cancellation handler', sublabel: 'pull a resting order, re-ranking the queue behind it',
        column: 3, lane: 1,
      },
      {
        id: 'handler_fill', kind: 'compare', label: 'Fill handler', sublabel: 'match, update positions, emit a trade print',
        column: 3, lane: 2,
      },
      {
        id: 'output', kind: 'output', label: 'Event trace + order book history', sublabel: 'optionally aggregated back into OHLCV bars',
        column: 4,
      },
    ],
    edges: [
      ['input', 'event_queue', 'flow'],
      ['arrival_process', 'event_queue', 'flow', 'seed the first arrival of each process'],
      ['event_queue', 'pop_event', 'flow'],
      ['pop_event', 'handler_arrival', 'flow'],
      ['pop_event', 'handler_cancel', 'flow'],
      ['pop_event', 'handler_fill', 'flow'],
      ['handler_arrival', 'output', 'flow'],
      ['handler_cancel', 'output', 'flow'],
      ['handler_fill', 'output', 'flow'],
      ['handler_arrival', 'event_queue', 'context', 'schedule the follow-on cancel and the next arrival'],
      ['handler_cancel', 'event_queue', 'context', 'schedule any replenishment order'],
      ['handler_fill', 'event_queue', 'context', 'schedule the follow-on order'],
    ],
  }),

  'simulation-decision-models-simulation-techniques-event-driven-simulation': blueprint({
    title: 'Event-Driven Simulation',
    subtitle: 'MarketEvent -> SignalEvent -> OrderEvent -> FillEvent, all through one queue and one dispatcher',
    nodes: [
      {
        id: 'market_event', kind: 'input', label: 'DataHandler -> MarketEvent', sublabel: 'next bar or tick, strict timestamp order',
        column: 0,
        detail: { 'backtest': 'a historical file replayed in timestamp order', 'live': 'an exchange socket -- the only component that differs' },
        analogy: 'Think of it as the tape arriving one bar at a time, and the only part of the system that knows whether this is a replay or the real feed.',
      },
      {
        id: 'event_queue', kind: 'memory', label: 'Event queue', sublabel: 'FIFO of typed events awaiting dispatch',
        column: 1,
        detail: { 'holds': 'MarketEvent, SignalEvent, OrderEvent, FillEvent', 'why it exists': 'a handler never calls another handler directly -- it pushes an event back here' },
        analogy: 'Think of it as an in-tray every desk drops its paperwork into, so nobody ever hands work straight to the next desk.',
      },
      {
        id: 'dispatcher', kind: 'fusion', label: 'Event dispatcher', sublabel: 'pop earliest, route to that type\'s subscribers',
        column: 2,
        analogy: 'Think of it as a mail room that delivers each event only to the components that asked for that type -- the same room whether this is a backtest or the live desk.',
      },
      {
        id: 'strategy_handler', kind: 'head', label: 'Strategy handler', sublabel: 'MarketEvent -> SignalEvent',
        column: 3,
        detail: { 'no lookahead by construction': 'it is only ever handed the current bar, never the queue\'s future contents' },
      },
      {
        id: 'portfolio_handler', kind: 'head', label: 'Portfolio handler', sublabel: 'SignalEvent -> OrderEvent, sizing + risk',
        column: 4,
      },
      {
        id: 'execution_handler', kind: 'head', label: 'Execution handler', sublabel: 'OrderEvent -> FillEvent, commission + slippage model',
        column: 5,
      },
      {
        id: 'output', kind: 'output', label: 'Fill events + equity curve', column: 6,
      },
    ],
    edges: [
      ...chain('market_event', 'event_queue', 'dispatcher', 'strategy_handler'),
      ['dispatcher', 'portfolio_handler', 'flow'],
      ['dispatcher', 'execution_handler', 'flow'],
      ['execution_handler', 'output', 'flow'],
      ['strategy_handler', 'event_queue', 'context', 'push SignalEvent'],
      ['portfolio_handler', 'event_queue', 'context', 'push OrderEvent'],
      ['execution_handler', 'event_queue', 'context', 'push FillEvent'],
    ],
  }),

  'simulation-decision-models-simulation-techniques-stochastic-differential-equations-sde': blueprint({
    title: 'Stochastic Differential Equations (SDE)',
    subtitle: 'Euler-Maruyama: drift + diffusion . dW, stepped forward',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Initial state x0', column: 0,
      },
      {
        id: 'drift_term', kind: 'compare', label: 'Drift mu(x,t)', sublabel: 'e.g. kappa(theta - x) for mean reversion',
        column: 1, lane: 0,
      },
      {
        id: 'diffusion_term', kind: 'compare', label: 'Diffusion sigma(x,t)', column: 1, lane: 1,
      },
      {
        id: 'wiener_increment', kind: 'stochastic', label: 'Wiener increment dW', sublabel: 'Z ~ N(0,1) . sqrt(dt)',
        column: 1, lane: 2,
        analogy: 'Think of it as the irreducible random jitter every bar gets on top of its expected drift, scaled by the square root of the elapsed time.',
      },
      {
        id: 'euler_step', kind: 'fusion', label: 'Euler-Maruyama step', sublabel: 'x_(t+dt) = x_t + mu.dt + sigma.sqrt(dt).Z',
        column: 2,
      },
      {
        id: 'simulated_path', kind: 'memory', label: 'Simulated path', sublabel: 'carried state, many paths in parallel',
        column: 3,
      },
      {
        id: 'output', kind: 'output', label: 'Path distribution', column: 4,
      },
    ],
    edges: [
      ['input', 'drift_term', 'flow'],
      ['input', 'diffusion_term', 'flow'],
      ['input', 'wiener_increment', 'flow'],
      ['drift_term', 'euler_step', 'flow'],
      ['diffusion_term', 'euler_step', 'flow'],
      ['wiener_increment', 'euler_step', 'flow'],
      ['euler_step', 'simulated_path', 'flow'],
      ['simulated_path', 'output', 'flow'],
      ['simulated_path', 'drift_term', 'context', 'x_t for next step'],
      ['simulated_path', 'diffusion_term', 'context', 'x_t for next step'],
    ],
  }),

  'simulation-decision-models-simulation-techniques-system-dynamics-modeling': blueprint({
    title: 'System Dynamics Modeling',
    subtitle: 'stocks accumulate through inflows and outflows, closed by feedback',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Initial stocks', sublabel: 'open interest, dealer inventory, volatility level',
        column: 0,
      },
      {
        id: 'flow_inflow', kind: 'compare', label: 'Inflow equations', sublabel: 'f(stocks, t)', column: 1, lane: 0,
      },
      {
        id: 'flow_outflow', kind: 'compare', label: 'Outflow equations', column: 1, lane: 1,
        analogy: 'Think of it as open interest filling up like a bathtub -- new positions are the inflow, closed positions the outflow, and the water level is what you actually observe.',
      },
      {
        id: 'integrate_step', kind: 'fusion', label: 'Euler integration step', sublabel: 'stock += net flow . dt',
        column: 2,
      },
      {
        id: 'stock_state', kind: 'memory', label: 'Updated stock levels', column: 3,
      },
      {
        id: 'output', kind: 'output', label: 'Simulated stock + flow trajectories', column: 4,
      },
    ],
    edges: [
      ['input', 'flow_inflow', 'flow'],
      ['input', 'flow_outflow', 'flow'],
      ['flow_inflow', 'integrate_step', 'flow'],
      ['flow_outflow', 'integrate_step', 'flow'],
      ['integrate_step', 'stock_state', 'flow'],
      ['stock_state', 'output', 'flow'],
      ['stock_state', 'flow_inflow', 'context', 'current stock levels feed next-step flows'],
      ['stock_state', 'flow_outflow', 'context', 'current stock levels feed next-step flows'],
    ],
  }),

  // ─── Tree & Graph-Based Decision Models ─────────────────────────────────

  'simulation-decision-models-tree-graph-based-decision-models-bayesian-decision-networks': blueprint({
    title: 'Bayesian Decision Networks',
    subtitle: 'chance nodes, a decision node and one utility node, solved by inference',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Observed evidence', sublabel: 'e.g. today\'s realized volatility regime, binned by quantile',
        column: 0, lane: 0,
        detail: { 'discretization': 'bin boundaries taken from the data\'s own quantiles -- the single most sensitive modelling choice here' },
      },
      {
        id: 'chance_cpt', kind: 'memory', label: 'Chance node CPTs', sublabel: 'prior P(today) and P(tomorrow regime | today regime)',
        column: 0, lane: 1,
        detail: { 'learned': 'the tables themselves, counted from history -- no weights, no gradients' },
        analogy: 'Think of it as a lookup table of how often a volatile day was followed by another volatile day, built by counting the tape.',
      },
      {
        id: 'belief_propagation', kind: 'compare', label: 'Belief propagation', sublabel: 'prior x likelihood -> posterior over unobserved chance nodes',
        column: 1,
        detail: { 'exact method': 'variable elimination; cost grows with the graph\'s treewidth, not its node count' },
        analogy: 'Think of it as updating every belief in the network the instant new evidence arrives, the way hearing one piece of news updates a whole web of related expectations.',
      },
      {
        id: 'decision_node', kind: 'head', label: 'Decision node', sublabel: 'enumerate candidate hedge ratios',
        column: 2,
      },
      {
        id: 'utility_node', kind: 'compare', label: 'Utility node', sublabel: 'E[U | D = d] = sum_c P(c | evidence, d) . U(c, d)',
        column: 3,
      },
      {
        id: 'argmax', kind: 'pool', label: 'Maximize expected utility', sublabel: 'd* = argmax_d E[U | D = d]',
        column: 4,
        analogy: 'Think of it as pricing every hedge size against the updated odds and keeping the one with the best expected payoff.',
      },
      {
        id: 'output', kind: 'output', label: 'Expected-utility-optimal decision', sublabel: 'the hedge ratio plus its expected utility',
        column: 5,
      },
    ],
    edges: [
      ['input', 'belief_propagation', 'flow'],
      ['chance_cpt', 'belief_propagation', 'flow'],
      ...chain('belief_propagation', 'decision_node', 'utility_node', 'argmax', 'output'),
    ],
  }),

  'simulation-decision-models-tree-graph-based-decision-models-decision-trees': blueprint({
    title: 'Decision Trees',
    subtitle: 'recursive greedy splits on Gini impurity, depth-limited',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar features', sublabel: `${F} indicators, this bar`,
        outShape: `B × ${F}`, column: 0,
        analogy: 'Think of it as a trader asking one yes/no question about this bar, then another, until the questions alone are enough to make a call.',
      },
      {
        id: 'root_split', kind: 'tree', label: 'Root split', sublabel: 'argmax over (feature, threshold) of impurity reduction',
        inShape: `B × ${F}`, column: 1,
        detail: {
          'impurity': 'Gini, I = 1 - sum_k p_k^2, for classification; variance for regression',
          'reduction': 'I(parent) - (n_L/n) I(left) - (n_R/n) I(right)',
          'learned parameters': 'none -- a split is a stored feature index and threshold, not a weight',
        },
      },
      {
        id: 'left_split', kind: 'tree', label: 'Left child split', sublabel: 'feature_j <= threshold', column: 2, lane: 0,
      },
      {
        id: 'right_split', kind: 'tree', label: 'Right child split', sublabel: 'feature_j > threshold', column: 2, lane: 1,
      },
      {
        id: 'leaves', kind: 'tree', label: 'Leaves', sublabel: 'majority class / mean target of examples reaching it',
        column: 3,
        detail: { stopping: 'max depth 2-15, min samples per leaf 5-500' },
      },
      {
        id: 'output', kind: 'output', label: 'Class probability / prediction', column: 4,
      },
    ],
    edges: [
      ['input', 'root_split', 'flow'],
      ['root_split', 'left_split', 'flow'],
      ['root_split', 'right_split', 'flow'],
      ['left_split', 'leaves', 'flow'],
      ['right_split', 'leaves', 'flow'],
      ['leaves', 'output', 'flow'],
    ],
  }),

  'simulation-decision-models-tree-graph-based-decision-models-dynamic-decision-networks': blueprint({
    title: 'Dynamic Decision Networks',
    subtitle: 'chance-decision-utility template replicated across time, solved by backward induction from the horizon',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'State C_t', sublabel: 'this time slice\'s chance nodes, discretized',
        column: 0, lane: 0,
      },
      {
        id: 'immediate_utility', kind: 'memory', label: 'Immediate utility U_t', sublabel: 'payoff of taking D_t in state C_t, this slice only',
        column: 0, lane: 1,
      },
      {
        id: 'transition_model', kind: 'memory', label: 'Transition model', sublabel: 'P(C_(t+1) | C_t, D_t)', column: 1,
        detail: { 'estimated from': 'historical regime transitions, conditioned on the action', 'risk': 'a small one-step error compounds across every slice of the recursion' },
      },
      {
        id: 'decision_node', kind: 'head', label: 'Decision D_t', sublabel: 'candidate actions this slice', column: 2,
        analogy: 'Think of it as deciding this bar\'s hedge knowing exactly how that choice shifts the odds of tomorrow\'s regime.',
      },
      {
        id: 'bellman_backup', kind: 'compare', label: 'Bellman backup', sublabel: 'V_t(C_t) = max_D [U_t + gamma . E_(C_(t+1))[V_(t+1)]]',
        column: 3,
        analogy: 'Think of it as working the schedule backwards from the last bar, so today\'s hedge is priced knowing what you would do on every bar after it.',
      },
      {
        id: 'value_function', kind: 'memory', label: 'Value function V_t', sublabel: 'one value and one stored argmax per state',
        column: 4,
        detail: { 'seeded at the horizon': 'V_T(C_T) = max_D U_T(C_T, D)' },
      },
      {
        id: 'output', kind: 'output', label: 'Optimal policy per time slice', sublabel: 'D*_t(C_t) for every slice and state', column: 5,
      },
    ],
    edges: [
      ['input', 'transition_model', 'flow'],
      ['immediate_utility', 'decision_node', 'flow'],
      ...chain('transition_model', 'decision_node', 'bellman_backup', 'value_function', 'output'),
      ['value_function', 'bellman_backup', 'context', 'V_(t+1) from the slice one step later -- the recursion runs backward'],
    ],
  }),

  'simulation-decision-models-tree-graph-based-decision-models-influence-diagrams': blueprint({
    title: 'Influence Diagrams',
    subtitle: 'chance, decision and utility nodes solved by node removal: sum out chance, max out decision, alternating',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Chance node CPTs + informational arcs', sublabel: 'what is known when each decision is taken',
        column: 0, lane: 0,
        analogy: 'Think of it as writing down, once, which facts you will actually have in front of you at the moment you have to size the trade.',
      },
      {
        id: 'utility_node', kind: 'memory', label: 'Utility node U', sublabel: 'payoff table over its parent chance and decision nodes',
        column: 0, lane: 1,
        detail: { 'role': 'the potential every elimination step folds into -- an input to the solve, never its last stage' },
      },
      {
        id: 'elimination_order', kind: 'compare', label: 'Choose elimination order', sublabel: 'consistent with the arcs, minimizing induced width',
        column: 1,
        detail: { 'cost driver': 'the largest intermediate table, set by induced width, not by node count' },
      },
      {
        id: 'marginalize_chance', kind: 'pool', label: 'Marginalize a chance node', sublabel: 'sum it out into the utility potential',
        column: 2,
        analogy: 'Think of it as folding away one uncertain factor at a time, averaging its payoff into what is left.',
      },
      {
        id: 'maximize_decision', kind: 'head', label: 'Maximize out a decision node', sublabel: 'replace it with argmax E[U] as a function of its informational parents',
        column: 3,
        analogy: 'Think of it as deciding, for every situation you could find yourself in, which size you would take -- and then treating that rule as settled.',
      },
      {
        id: 'output', kind: 'output', label: 'Optimal policy + max expected utility', sublabel: 'one decision rule per decision node',
        column: 4,
      },
    ],
    edges: [
      ['input', 'elimination_order', 'flow'],
      ['utility_node', 'elimination_order', 'flow'],
      ...chain('elimination_order', 'marginalize_chance', 'maximize_decision', 'output'),
      ['maximize_decision', 'marginalize_chance', 'context', 'alternate until only the utility node remains'],
    ],
  }),

  'simulation-decision-models-tree-graph-based-decision-models-monte-carlo-tree-search-mcts': blueprint({
    title: 'Monte Carlo Tree Search (MCTS)',
    subtitle: 'UCT: select, expand, rollout, backpropagate, repeat',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Current state s0', column: 0,
      },
      {
        id: 'selection', kind: 'tree', label: 'Selection', sublabel: 'UCB1: W/N + c.sqrt(ln N_parent / N)',
        column: 1,
        analogy: 'Think of it as walking down the tree always picking whichever branch looks best so far, but occasionally trying an under-explored one just in case.',
      },
      {
        id: 'expansion', kind: 'tree', label: 'Expansion', sublabel: 'add one untried child action', column: 2,
      },
      {
        id: 'rollout', kind: 'stochastic', label: 'Rollout', sublabel: 'simulate to terminal state or horizon',
        column: 3,
      },
      {
        id: 'backpropagation', kind: 'memory', label: 'Backpropagation', sublabel: 'update N(s), W(s) up the visited path',
        column: 4,
      },
      {
        id: 'output', kind: 'output', label: 'Recommended action', sublabel: 'root child with highest visit count', column: 5,
      },
    ],
    edges: [
      ...chain('input', 'selection', 'expansion', 'rollout', 'backpropagation', 'output'),
      ['backpropagation', 'selection', 'context', 'repeat until simulation budget exhausted'],
    ],
  }),

  // ─── Utility & Value-Based Decision Making ───────────────────────────────

  'simulation-decision-models-utility-value-based-decision-making-utility-theory-models': blueprint({
    title: 'Utility Theory Models',
    subtitle: 'CRRA expected-utility maximization, of which the Kelly criterion is the log-utility (gamma = 1) special case',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Outcome distribution', sublabel: 'win probability, payoff ratio', column: 0,
      },
      {
        id: 'utility_transform', kind: 'compare', label: 'Utility transform u(w)', sublabel: 'CRRA: w^(1-gamma) / (1-gamma)',
        column: 1,
        analogy: 'Think of it as a rule that makes a dollar of loss hurt more than a dollar of gain helps, matching how a real trader actually feels about risk.',
      },
      {
        id: 'expected_utility', kind: 'compare', label: 'Expected utility', sublabel: 'E[U] = sum p_i . u(w_i)', column: 2,
      },
      {
        id: 'certainty_equivalent', kind: 'compare', label: 'Certainty equivalent', sublabel: 'sure amount matching E[U]', column: 3,
      },
      {
        id: 'optimal_fraction', kind: 'head', label: 'Optimal capital fraction', sublabel: 'argmax_f E[u(w0(1 + f.r))]; at gamma = 1 this is Kelly, f* = (p.b - q)/b',
        column: 4,
        detail: { 'sensitivity': 'a small overestimate of the edge produces a materially oversized, ruin-prone bet, which is why half-Kelly is the common practice' },
      },
      {
        id: 'output', kind: 'output', label: 'Position size decision', column: 5,
      },
    ],
    edges: chain('input', 'utility_transform', 'expected_utility', 'certainty_equivalent', 'optimal_fraction', 'output'),
  }),
};
