/**
 * Blueprints — Probabilistic & Symbolic Models.
 *
 * One entry per catalog spec id. This family is mostly the honest opposite of
 * a neural stack: a Dirichlet Process, a Bayesian network, a CSP solver, a
 * Prolog resolution engine have few or no trainable weights in the PyTorch
 * sense, so `params` is omitted almost everywhere and the real quantity being
 * estimated, stored or searched (a cluster table, a CPT, a transition matrix,
 * a rule weight) is named in `detail` instead. Where a stage genuinely IS a
 * linear map with a fixed parameter count (the neuro-symbolic fusion layer,
 * the Bayesian linear regression posterior mean), `P` is used.
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const C = DIM.classes;

export const PROBABILISTIC_SYMBOLIC_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Generative Processes & Mixtures ────────────────────────────────────

  'probabilistic-symbolic-models-generative-processes-mixtures-dirichlet-process': blueprint({
    title: 'Dirichlet Process',
    subtitle: 'stick-breaking prior, Chinese Restaurant Process regime discovery',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar features', sublabel: `${F} indicators, this bar`,
        outShape: `B x ${F}`, column: 0,
      },
      {
        id: 'crp_probs', kind: 'compare', label: 'CRP assignment probabilities',
        sublabel: 'existing-cluster occupancy x likelihood, vs alpha x new-cluster prior',
        column: 1,
        analogy: 'Think of it as a bar asking every regime discovered so far how well it fits, while also asking whether it is odd enough to justify starting a brand-new regime.',
      },
      {
        id: 'cluster_store', kind: 'memory', label: 'Active cluster table', sublabel: 'K_active clusters, grows online',
        column: 1, lane: 1,
        detail: { stored: 'per-cluster mean (35 values) + occupancy count, no fixed size' },
        analogy: 'Think of it as a running ledger of every regime discovered so far, each entry just an average and a headcount.',
      },
      {
        id: 'base_measure', kind: 'stochastic', label: 'Base measure G0', sublabel: 'mu ~ N(0, tau^2 I), prior template for a new cluster',
        column: 1, lane: 2,
      },
      {
        id: 'assign', kind: 'stochastic', label: 'Sample assignment', sublabel: 'CRP categorical draw over existing clusters + new',
        column: 2,
        analogy: 'Think of it as the bar joining whichever regime table is the best fit, or starting a new table if none fits well enough.',
      },
      {
        id: 'param_update', kind: 'memory', label: 'Update cluster parameters', sublabel: 'closed-form mean/count update, no gradient',
        column: 3,
      },
      { id: 'output', kind: 'output', label: 'Regime label + active count', outShape: 'B x 1, plus K_active', column: 4 },
    ],
    edges: [
      ...chain('input', 'crp_probs', 'assign', 'param_update', 'output'),
      ['cluster_store', 'crp_probs', 'context', 'occupancy x likelihood, per existing cluster'],
      ['base_measure', 'crp_probs', 'context', 'alpha x prior for a brand-new cluster'],
      ['param_update', 'cluster_store', 'context', 'write updated mean/count back to the table'],
    ],
  }),

  'probabilistic-symbolic-models-generative-processes-mixtures-mixture-model-e-g-gmm-dpm': blueprint({
    title: 'Mixture Model (GMM, DPM)',
    subtitle: 'K=4 Gaussian components, EM-fit, soft regime membership',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar features', sublabel: `${F} indicators, this bar`,
        outShape: `B x ${F}`, column: 0,
      },
      {
        id: 'e_step', kind: 'compare', label: 'E-step: responsibilities',
        sublabel: 'gamma_ik = pi_k N(x|mu_k,Sigma_k) / sum_j pi_j N(x|mu_j,Sigma_j)',
        column: 1,
        analogy: 'Think of it as asking, for this bar, how much each of the 4 candidate regimes would claim it as their own, given as a percentage rather than a single vote.',
      },
      {
        id: 'k_select', kind: 'compare', label: 'Component count selection', sublabel: 'BIC across K=2..8, or DP-driven if nonparametric',
        column: 1, lane: 1,
      },
      {
        id: 'component_store', kind: 'memory', label: 'M-step: refit components', sublabel: 'update pi_k, mu_k, Sigma_k from weighted points',
        column: 2,
        detail: { stored: 'K=4 components x (mean: 35 values, diag covariance: 35 values, weight: 1 scalar)' },
      },
      { id: 'log_likelihood', kind: 'compare', label: 'Log-likelihood', sublabel: 'convergence check, delta < epsilon', column: 3 },
      { id: 'output', kind: 'output', label: 'Soft membership + density', outShape: 'B x 4', column: 4 },
    ],
    edges: [
      ...chain('input', 'e_step', 'component_store', 'log_likelihood', 'output'),
      ['k_select', 'component_store', 'context', 'sets K before EM begins, or the DP prior replaces a fixed K'],
      ['log_likelihood', 'e_step', 'context', 'iterate E/M until delta log-likelihood < epsilon'],
    ],
  }),

  // ─── Graphical & Structured Models ──────────────────────────────────────

  'probabilistic-symbolic-models-graphical-structured-models-bayesian-network-bn': blueprint({
    title: 'Bayesian Network (BN)',
    subtitle: 'session -> volatility -> direction DAG, exact inference by variable elimination',
    nodes: [
      {
        id: 'evidence', kind: 'input', label: 'Observed evidence', sublabel: 'session, volatility regime (discretized)',
        outShape: 'B x 2 (categorical)', column: 0,
      },
      {
        id: 'dag_structure', kind: 'memory', label: 'DAG structure', sublabel: 'session -> volatility -> direction, session -> direction',
        column: 0, lane: 1,
        detail: { edges: '3 directed edges, hand-specified or BIC-searched' },
      },
      {
        id: 'cpt_bank', kind: 'memory', label: 'Fitted CPTs', sublabel: '3 nodes, Dirichlet-smoothed counts',
        column: 1,
        detail: { sizes: 'P(session) 1x3, P(vol|session) 3x3, P(direction|vol,session) 9x3' },
        analogy: 'Think of it as a compact lookup table built once from history, holding a probability for every possible session-volatility-direction combination.',
      },
      { id: 'elimination', kind: 'compare', label: 'Variable elimination', sublabel: 'sum out session, volatility in topological order', column: 2,
        analogy: 'Think of it as folding the session and volatility evidence into the direction question one variable at a time, instead of building one giant table over every variable at once.',
      },
      { id: 'normalize', kind: 'compare', label: 'Normalize', sublabel: 'eliminated factor renormalized to sum to 1', column: 3 },
      { id: 'output', kind: 'output', label: 'P(direction | evidence)', outShape: `B x ${C}`, column: 4 },
    ],
    edges: [
      ['evidence', 'cpt_bank', 'flow'],
      ['dag_structure', 'cpt_bank', 'flow'],
      ...chain('cpt_bank', 'elimination', 'normalize', 'output'),
    ],
  }),

  'probabilistic-symbolic-models-graphical-structured-models-neuro-symbolic-reasoning-model': blueprint({
    title: 'Neuro-Symbolic Reasoning Model',
    subtitle: 'learned encoder + fixed rule bank, fused under a hard-constraint gate',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
        outShape: `B x ${F}`, column: 0,
      },
      {
        id: 'encoder', kind: 'linear', label: 'Neural encoder', sublabel: `Linear ${F} -> 32`,
        inShape: `B x ${F}`, outShape: 'B x 32', params: P.linear(F, 32), column: 1, lane: 0,
        analogy: 'Think of it as the network forming its own read of the 35 features, with no rules involved yet.',
      },
      {
        id: 'predicates', kind: 'compare', label: 'Symbolic predicate extraction', sublabel: 'K=4 fixed logical tests on raw features',
        inShape: `B x ${F}`, outShape: 'B x 4', column: 1, lane: 1,
        detail: { predicates: 'trend_up, vol_spike, session_open, momentum_up', weights: 'none - fixed, hand-authored' },
        analogy: 'Think of it as a fixed checklist of textbook trading signals evaluated alongside the network, never learning, always checking.',
      },
      {
        id: 'fusion', kind: 'fusion', label: 'Differentiable fusion', sublabel: 'g(h, r_1..r_4; omega)',
        inShape: 'B x 32, B x 4', outShape: `B x ${C}`, params: P.linear(32 + 4, C), column: 2,
      },
      {
        id: 'constraint_gate', kind: 'gate', label: 'Hard-constraint gate', sublabel: 'fixed veto mask, nothing learned',
        inShape: `B x ${C}, B x 4`, outShape: `B x ${C}`, column: 3,
        detail: { rule: 'vol_spike true -> subtract 1e4 from the long logit', weights: 'none - structural, not a learned layer' },
        analogy: 'Think of it as a compliance officer sitting after the fused decision, allowed to veto any call that breaks a hard rule such as never going long during a volatility spike.',
      },
      { id: 'output', kind: 'output', label: 'Constrained direction probabilities', outShape: `B x ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'encoder', 'flow'], ['input', 'predicates', 'flow'],
      ['encoder', 'fusion', 'flow'], ['predicates', 'fusion', 'flow'],
      ['predicates', 'constraint_gate', 'flow', 'rule flags read again for the hard veto'],
      ...chain('fusion', 'constraint_gate', 'output'),
    ],
  }),

  'probabilistic-symbolic-models-graphical-structured-models-probabilistic-graphical-model-pgm': blueprint({
    title: 'Probabilistic Graphical Model (PGM)',
    subtitle: 'undirected Markov random field over 5 regime nodes, loopy belief propagation',
    nodes: [
      {
        id: 'evidence', kind: 'input', label: 'Observed evidence (partial)', sublabel: 'e.g. 2 of 5 regime nodes',
        outShape: 'B x 2 (categorical)', column: 0,
      },
      {
        id: 'graph_structure', kind: 'memory', label: 'Undirected graph structure', sublabel: '5 regime nodes, symmetric edges, no causal direction',
        column: 0, lane: 1,
      },
      {
        id: 'clique_potentials', kind: 'memory', label: 'Pairwise clique potentials', sublabel: 'psi_ij per edge, fit by pseudo-likelihood',
        column: 1,
        detail: { stored: 'one potential table per edge' },
      },
      {
        id: 'message_pass', kind: 'compare', label: 'Loopy belief propagation', sublabel: 'iterative message passing across edges',
        column: 2,
        analogy: 'Think of it as every regime node whispering its current belief to its graph neighbors, and updating its own belief from what it hears back, round after round, until nobody changes their mind.',
      },
      { id: 'convergence_check', kind: 'compare', label: 'Message convergence check', sublabel: 'max message change < epsilon', column: 3 },
      { id: 'output', kind: 'output', label: 'Approximate marginals (unobserved nodes)', column: 4 },
    ],
    edges: [
      ['evidence', 'clique_potentials', 'flow'],
      ['graph_structure', 'clique_potentials', 'flow'],
      ...chain('clique_potentials', 'message_pass', 'convergence_check', 'output'),
      ['convergence_check', 'message_pass', 'context', 'not converged: pass another round of messages'],
    ],
  }),

  // ─── Probabilistic Inference Models ─────────────────────────────────────

  'probabilistic-symbolic-models-probabilistic-inference-models-bayesian-linear-regression': blueprint({
    title: 'Bayesian Linear Regression',
    subtitle: 'Gaussian prior + Gaussian likelihood, exact closed-form posterior',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Feature row', sublabel: `${F} engineered features`,
        outShape: `B x ${F}`, column: 0,
      },
      {
        id: 'prior', kind: 'stochastic', label: 'Weight prior', sublabel: `w ~ N(0, tau^2 I), ${F}-dim`,
        column: 1,
        analogy: 'Think of it as starting from complete agnosticism about which of the 35 features matter, weighted only by a gentle pull toward zero.',
      },
      {
        id: 'posterior_update', kind: 'compare', label: 'Closed-form Bayes update',
        sublabel: 'Sigma_n = (X^T X / sigma^2 + I / tau^2)^-1; mu_n = Sigma_n X^T y / sigma^2',
        column: 2,
        analogy: 'Think of it as an exact, one-shot revision of every coefficient belief, no iteration required.',
      },
      {
        id: 'posterior_store', kind: 'memory', label: 'Posterior weight distribution', sublabel: 'N(mu_n, Sigma_n)',
        params: P.linear(F, 1), column: 3,
        detail: {
          'counted here': `posterior mean mu_n only: ${F} coefficients + 1 intercept, P.linear(F, 1)`,
          'also stored, not counted': `posterior covariance Sigma_n, ${F} x ${F}, a belief about the weights rather than a weight`,
        },
      },
      {
        id: 'predictive', kind: 'stochastic', label: 'Predictive distribution', sublabel: 'y* ~ N(mu_n^T x*, x*^T Sigma_n x* + sigma^2)',
        column: 4,
        analogy: 'Think of it as the model admitting how far this bar sits from anything it has seen before, and widening its own confidence band accordingly.',
      },
      { id: 'output', kind: 'output', label: 'Point prediction + uncertainty band', column: 5 },
    ],
    edges: [
      ['prior', 'posterior_update', 'flow', 'prior mean/covariance combine with the likelihood'],
      ...chain('input', 'posterior_update', 'posterior_store', 'predictive', 'output'),
    ],
  }),

  'probabilistic-symbolic-models-probabilistic-inference-models-gaussian-process-gp': blueprint({
    title: 'Gaussian Process (GP)',
    subtitle: 'kernel-defined function prior, exact posterior via one Cholesky solve',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Training set', sublabel: 'N bars x 35 features + targets, N kept small: O(N^3)',
        outShape: `N x ${F}`, column: 0,
      },
      {
        id: 'kernel_hyperparams', kind: 'memory', label: '3 kernel hyperparameters', sublabel: 'length scale, signal variance, noise variance',
        column: 0, lane: 1,
        detail: { 'fit by': 'maximize the log marginal likelihood, gradient-based, not per-weight learning' },
      },
      {
        id: 'kernel_matrix', kind: 'compare', label: 'Kernel matrix K', sublabel: 'K_ij = sigma_f^2 exp(-||x_i - x_j||^2 / (2 l^2))',
        outShape: 'N x N', column: 1,
        analogy: 'Think of it as measuring how similar every pair of training bars is; two nearly identical bars score near 1, two very different bars near 0.',
      },
      {
        id: 'cholesky_solve', kind: 'compare', label: 'Cholesky solve', sublabel: 'alpha = (K + sigma_n^2 I)^-1 y, O(N^3)',
        inShape: 'N x N', outShape: 'N x 1', column: 2,
        analogy: 'Think of it as the one expensive matrix operation the whole method boils down to: solve once, and every future prediction and its confidence band fall out of that single solve.',
      },
      {
        id: 'posterior_mean_var', kind: 'compare', label: 'Posterior mean + variance',
        sublabel: 'k*^T alpha ; k** - k*^T (K + sigma_n^2 I)^-1 k*', column: 3,
      },
      { id: 'output', kind: 'output', label: 'Predictive mean + variance at test point', column: 4 },
    ],
    edges: [
      ['input', 'kernel_matrix', 'flow'],
      ['kernel_hyperparams', 'kernel_matrix', 'flow'],
      ...chain('kernel_matrix', 'cholesky_solve', 'posterior_mean_var', 'output'),
    ],
  }),

  'probabilistic-symbolic-models-probabilistic-inference-models-hidden-markov-model-hmm': blueprint({
    title: 'Hidden Markov Model (HMM)',
    subtitle: 'K=3 regime states, Gaussian emissions, Baum-Welch fit, forward filter + Viterbi',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar sequence', sublabel: `${T} bars x ${F} features`,
        outShape: `${T} x ${F}`, column: 0,
      },
      {
        id: 'emission', kind: 'compare', label: 'Emission likelihood b_k(x_t)', sublabel: 'K=3 states, per-state diagonal Gaussian',
        inShape: `${T} x ${F}`, outShape: `${T} x 3`, column: 1,
        detail: { stored: 'per state: 35 means + 35 diagonal variances' },
      },
      {
        id: 'transition_matrix', kind: 'memory', label: 'Transition matrix A + initial pi', sublabel: '3x3 row-stochastic, self-transition-biased init',
        column: 1, lane: 1,
        detail: { stored: '9 transition probabilities + 3 initial-state probabilities' },
        analogy: 'Think of it as a memory of how sticky each regime has been historically -- a market trending today is shown here as very likely to still be trending tomorrow.',
      },
      {
        id: 'forward_pass', kind: 'recurrent', label: 'Forward recursion (alpha)', sublabel: 'alpha_t(k) = b_k(x_t) sum_i alpha_{t-1}(i) A_ik',
        inShape: `${T} x 3`, outShape: `${T} x 3`, column: 2,
        analogy: 'Think of it as a trader keeping a running, bar-by-bar belief about which of the 3 regimes the market is in, updated the instant each bar closes and never revised using later bars.',
      },
      {
        id: 'backward_pass', kind: 'recurrent', label: 'Backward recursion (beta)', sublabel: 'beta_t(k) = sum_j A_kj b_j(x_{t+1}) beta_{t+1}(j) -- TRAINING ONLY',
        inShape: `${T} x 3`, outShape: `${T} x 3`, column: 2, lane: 1,
        detail: { causality: 'reads bars after t, so it may fit parameters but must never label a bar for live or walk-forward use' },
        analogy: 'Think of it as a second read of the same history running backwards from the end, allowed only when fitting on closed data because it sees bars that had not happened yet.',
      },
      {
        id: 'viterbi', kind: 'compare', label: 'Viterbi decode', sublabel: 'delta_t(k) = b_k(x_t) max_i[delta_{t-1}(i) A_ik], with backpointers',
        inShape: `${T} x 3`, outShape: `${T} x 1`, column: 3,
      },
      {
        id: 'baum_welch', kind: 'compare', label: 'Baum-Welch E/M re-estimation',
        sublabel: 'gamma_t(k) ~ alpha_t(k) beta_t(k); A_ij = sum_t xi_t(i,j) / sum_t gamma_t(i)',
        column: 3, lane: 1,
        analogy: 'Think of it as scoring how much each bar in the fitted history belonged to each regime, then rewriting the stickiness table and each regime character from those weighted scores, over and over until the numbers settle.',
      },
      { id: 'output', kind: 'output', label: 'Regime path (offline) / filtered posterior (live)', column: 4 },
    ],
    edges: [
      ...chain('input', 'emission'),
      ['emission', 'forward_pass', 'flow'],
      ['emission', 'backward_pass', 'flow'],
      ['transition_matrix', 'forward_pass', 'flow'],
      ['transition_matrix', 'backward_pass', 'flow'],
      ['transition_matrix', 'viterbi', 'flow'],
      ['forward_pass', 'viterbi', 'flow'],
      ['backward_pass', 'baum_welch', 'flow'],
      ['forward_pass', 'baum_welch', 'context', 'E-step: alpha x beta gives the state posterior gamma'],
      ['baum_welch', 'transition_matrix', 'context', 'M-step: rewrite A, pi and the emissions, then sweep again until the log-likelihood stops rising'],
      ['forward_pass', 'output', 'context', 'live path: the filtered posterior alone, no backward pass'],
      ['viterbi', 'output', 'flow'],
    ],
  }),

  'probabilistic-symbolic-models-probabilistic-inference-models-markov-chain': blueprint({
    title: 'Markov Chain',
    subtitle: 'K=3 discretized states, one-step and stationary transition dynamics',
    nodes: [
      {
        id: 'current_state', kind: 'input', label: 'Current state', sublabel: 'K=3 return buckets', outShape: 'B x 1 (categorical)',
        column: 0,
      },
      {
        id: 'transition_matrix', kind: 'memory', label: 'Transition matrix P', sublabel: '3x3, Dirichlet-smoothed counts',
        column: 1,
        detail: { stored: '9 transition probabilities, row-stochastic' },
        analogy: 'Think of it as the market\'s short-term memory reduced to nine numbers: given today\'s bucket, how likely is each bucket tomorrow.',
      },
      {
        id: 'lookup', kind: 'compare', label: 'Row lookup P_i,:', sublabel: 'read row i directly as the predictive distribution',
        column: 2, lane: 0,
        analogy: 'Think of it as reading tomorrow\'s odds directly from a lookup table, no computation beyond picking the right row.',
      },
      {
        id: 'matrix_power', kind: 'compare', label: 'n-step matrix power', sublabel: 'P^n via repeated matrix multiply, deterministic',
        column: 2, lane: 1,
      },
      { id: 'stationary', kind: 'compare', label: 'Stationary distribution', sublabel: 'pi P = pi, the left eigenvector of P at eigenvalue 1', column: 3 },
      { id: 'output', kind: 'output', label: 'Next-state / long-run distribution', column: 4 },
    ],
    edges: [
      // The current state indexes a row of P; it does not produce P. P is fitted
      // once from counts and read, so both stages are fed by both.
      ['current_state', 'lookup', 'flow', 'the observed bucket i picks the row'],
      ['transition_matrix', 'lookup', 'flow'],
      ['transition_matrix', 'matrix_power', 'flow'],
      ['lookup', 'output', 'flow'],
      ...chain('matrix_power', 'stationary', 'output'),
    ],
  }),

  'probabilistic-symbolic-models-probabilistic-inference-models-markov-decision-process-mdp': blueprint({
    title: 'Markov Decision Process (MDP)',
    subtitle: 'position-management MDP solved by value iteration',
    nodes: [
      {
        id: 'state', kind: 'input', label: 'Current state', sublabel: 'position x volatility regime, discretized',
        outShape: 'B x 1 (categorical, |S| states)', column: 0,
      },
      {
        id: 'transition_model', kind: 'memory', label: 'Transition model P(s prime | s,a)',
        sublabel: 'estimated from historical (state, action, next-state) counts', column: 1, lane: 0,
      },
      {
        id: 'reward_model', kind: 'memory', label: 'Reward model r(s,a)', sublabel: 'realized P&L net of transaction cost',
        column: 1, lane: 1,
      },
      {
        id: 'bellman_backup', kind: 'compare', label: 'Bellman backup',
        sublabel: 'V_{k+1}(s) = max_a [ r(s,a) + gamma sum P(sprime|s,a) V_k(sprime) ]',
        column: 2,
        analogy: 'Think of it as asking, for every possible state, what this state is truly worth if you act optimally from here on, updating that answer using yesterday\'s best guess, sweep after sweep, until the guesses stop changing.',
      },
      {
        id: 'value_table', kind: 'memory', label: 'Value table V*(s)', sublabel: 'converged after value iteration',
        column: 3,
        detail: { stored: '|S| scalar values, one per discretized state' },
        analogy: 'Think of it as a fully worked-out price tag on every possible situation the position-management problem could be in.',
      },
      {
        id: 'policy_extract', kind: 'compare', label: 'Policy extraction', sublabel: 'pi*(s) = argmax_a [ r(s,a) + gamma sum P(sprime|s,a) V*(sprime) ]',
        column: 4,
        analogy: 'Think of it as reading off, for the state you are actually in right now, whichever action the price tag says is worth the most.',
      },
      { id: 'output', kind: 'output', label: 'Recommended action (buy/sell/hold)', column: 5 },
    ],
    edges: [
      ['transition_model', 'bellman_backup', 'flow'], ['reward_model', 'bellman_backup', 'flow'],
      ['bellman_backup', 'value_table', 'flow'],
      ['value_table', 'bellman_backup', 'context', 'sweep again until max|delta V| < tolerance'],
      ['value_table', 'policy_extract', 'flow'], ['transition_model', 'policy_extract', 'flow'],
      ['state', 'policy_extract', 'flow'],
      ['policy_extract', 'output', 'flow'],
      ['output', 'state', 'context', 'action executed in the environment; new state and reward observed next step'],
    ],
  }),

  // ─── Probabilistic Programming & Logic ──────────────────────────────────

  'probabilistic-symbolic-models-probabilistic-programming-logic-probabilistic-logic-network-pln': blueprint({
    title: 'Probabilistic Logic Network (PLN)',
    subtitle: 'strength-confidence truth values, deduction/induction/abduction + revision',
    nodes: [
      {
        id: 'base_atoms', kind: 'input', label: 'Base facts', sublabel: 'observed evidence atoms, each (strength, confidence)',
        column: 0,
      },
      {
        id: 'implication_links', kind: 'memory', label: 'Implication knowledge base',
        sublabel: 'Implication(A,B) links, each with a (strength, confidence) pair', column: 1,
      },
      {
        id: 'deduction', kind: 'compare', label: 'Deduction rule',
        sublabel: 's_AC = s_AB s_BC + (1-s_AB)(s_C - s_B s_BC)/(1-s_B)', column: 2, lane: 0,
        detail: { confidence: 'capped by the weakest premise and discounted once per link, so a long chain cannot read as more certain than its weakest step' },
        analogy: 'Think of it as chaining two if-this-then-that beliefs into a new one, discounting the result the way trusting a friend of a friend is weaker than trusting a friend directly.',
      },
      {
        id: 'induction_abduction', kind: 'compare', label: 'Induction / abduction rules', sublabel: 'generalize from cases / infer a plausible cause',
        column: 2, lane: 1,
      },
      {
        id: 'revision', kind: 'fusion', label: 'Evidence-weighted revision', sublabel: 'merge independent truth-value estimates, weighted by confidence',
        column: 3,
        analogy: 'Think of it as two independent witnesses to the same fact being combined, with the more confident witness account counted for more.',
      },
      { id: 'output', kind: 'output', label: 'Derived truth value (strength, confidence)', column: 4 },
    ],
    edges: [
      // Observed facts are what the rules are applied TO; the link store is the
      // rule bank they are applied THROUGH, not a stage the facts pass into.
      ['base_atoms', 'deduction', 'flow'], ['base_atoms', 'induction_abduction', 'flow'],
      ['implication_links', 'deduction', 'context', 'the A->B and B->C links the chain runs through'],
      ['implication_links', 'induction_abduction', 'context', 'the links generalized from or inverted'],
      ['deduction', 'revision', 'flow'], ['induction_abduction', 'revision', 'flow'],
      ['revision', 'output', 'flow'],
      ['revision', 'implication_links', 'context', 'merged truth value written back, so the next query starts from it'],
    ],
  }),

  'probabilistic-symbolic-models-probabilistic-programming-logic-probabilistic-programming-stan-pymc3': blueprint({
    title: 'Probabilistic Programming (Stan, PyMC3)',
    subtitle: 'declared generative model, fit by Hamiltonian Monte Carlo / NUTS',
    nodes: [
      {
        id: 'declared_model', kind: 'input', label: 'Declared generative model', sublabel: 'priors p(theta) + likelihood p(y|theta), written as code',
        column: 0,
      },
      {
        id: 'autodiff', kind: 'memory', label: 'Automatic differentiation', sublabel: 'exact gradient of the log posterior w.r.t. every parameter',
        column: 1, lane: 0,
      },
      {
        id: 'warmup_adapt', kind: 'memory', label: 'Warmup adaptation', sublabel: 'tunes step size + mass matrix from early trajectories',
        column: 1, lane: 1,
      },
      {
        id: 'hmc_trajectory', kind: 'stochastic', label: 'Hamiltonian trajectory', sublabel: 'leapfrog-integrated dynamics using the posterior gradient',
        column: 2,
        analogy: 'Think of it as a marble rolling on the negative-log-posterior landscape, using its measured slope to glide toward the most probable parameter values instead of wandering randomly.',
      },
      {
        id: 'nuts_accept', kind: 'compare', label: 'NUTS accept/reject', sublabel: 'Metropolis correction for integration error; auto-tunes trajectory length',
        column: 3,
      },
      {
        id: 'posterior_samples', kind: 'memory', label: 'Posterior sample store', sublabel: 'accumulates samples across several chains',
        column: 4,
      },
      {
        id: 'diagnostics', kind: 'compare', label: 'Convergence diagnostics', sublabel: 'R-hat, effective sample size, divergence count',
        column: 5,
        analogy: 'Think of it as the sampler grading its own homework -- if several independent chains do not agree, the posterior is not trusted no matter how many samples were drawn.',
      },
      { id: 'output', kind: 'output', label: 'Posterior predictive distribution', column: 6 },
    ],
    edges: [
      ['declared_model', 'warmup_adapt', 'flow'], ['warmup_adapt', 'hmc_trajectory', 'flow'],
      ['nuts_accept', 'hmc_trajectory', 'context', 'reject: retry the trajectory from the last accepted state'],
      ...chain('declared_model', 'autodiff', 'hmc_trajectory', 'nuts_accept', 'posterior_samples', 'diagnostics', 'output'),
    ],
  }),

  'probabilistic-symbolic-models-probabilistic-programming-logic-probabilistic-soft-logic-psl': blueprint({
    title: 'Probabilistic Soft Logic (PSL)',
    subtitle: 'continuous [0,1] truth values, convex hinge-loss MAP inference',
    nodes: [
      {
        id: 'ground_atoms', kind: 'input', label: 'Ground atom truth values', sublabel: 'continuous truth in [0,1], from observed features',
        column: 0,
      },
      {
        id: 'rule_grounding', kind: 'memory', label: 'Rule grounding', sublabel: 'K=6 first-order templates instantiated over current atoms',
        column: 1, lane: 0,
      },
      {
        id: 'rule_weights', kind: 'memory', label: 'Rule weights', sublabel: '6 learned nonnegative weights',
        column: 1, lane: 1,
        detail: { learned: 'by gradient descent through the convex MAP solve, not backprop through a network' },
      },
      {
        id: 'hinge_potentials', kind: 'compare', label: 'Hinge-loss potentials', sublabel: 'max(0, body - head)^p per rule, Lukasiewicz relaxation',
        column: 2,
        analogy: 'Think of it as measuring, for every rule, exactly how far the current best guess is from making that rule fully true -- zero if satisfied, growing the further it is violated.',
      },
      {
        id: 'admm_solve', kind: 'memory', label: 'ADMM convex optimization', sublabel: 'iterative consensus solve for the MAP truth values',
        column: 3,
        analogy: 'Think of it as nudging every atom truth value a little at a time so the whole rule base becomes as mutually consistent as possible, all at once rather than rule by rule.',
      },
      { id: 'output', kind: 'output', label: 'Inferred truth value of target atom', column: 4 },
    ],
    edges: [
      ['ground_atoms', 'rule_grounding', 'flow'], ['rule_weights', 'hinge_potentials', 'flow'],
      ...chain('rule_grounding', 'hinge_potentials', 'admm_solve', 'output'),
      ['admm_solve', 'hinge_potentials', 'context', 'reevaluate potentials at the updated truth-value estimate, repeat to convergence'],
    ],
  }),

  // ─── Symbolic Reasoning Systems ─────────────────────────────────────────

  'probabilistic-symbolic-models-symbolic-reasoning-systems-constraint-satisfaction-problem-csp': blueprint({
    title: 'Constraint Satisfaction Problem (CSP)',
    subtitle: 'position-sizing feasibility, arc consistency + backtracking search',
    nodes: [
      {
        id: 'variables_domains', kind: 'input', label: 'Variables + domains', sublabel: 'position size per instrument, discretized lot choices',
        column: 0,
      },
      {
        id: 'constraint_graph', kind: 'memory', label: 'Constraint graph', sublabel: 'margin limit, per-instrument cap, correlated-exposure limit',
        column: 1,
      },
      {
        id: 'arc_consistency', kind: 'compare', label: 'Arc consistency (AC-3)', sublabel: 'prune locally inconsistent domain values',
        column: 2,
        analogy: 'Think of it as ruling out, before any guessing begins, every position size that could never survive even one risk constraint no matter what the other instruments end up doing.',
      },
      {
        id: 'backtracking_search', kind: 'compare', label: 'Backtracking search', sublabel: 'systematic depth-first, most-constrained-variable + least-constraining-value ordering',
        column: 3,
        analogy: 'Think of it as trying the most promising position size for the tightest-constrained instrument first, and immediately backing up the moment a choice makes the whole configuration infeasible.',
      },
      { id: 'consistency_check', kind: 'compare', label: 'Constraint check', sublabel: 'verify the partial assignment against every constraint', column: 4 },
      { id: 'output', kind: 'output', label: 'Feasible assignment (or infeasible)', column: 5 },
    ],
    edges: [
      ...chain('variables_domains', 'constraint_graph', 'arc_consistency', 'backtracking_search', 'consistency_check', 'output'),
      ['consistency_check', 'backtracking_search', 'context', 'violated: back up and try the next value'],
    ],
  }),

  'probabilistic-symbolic-models-symbolic-reasoning-systems-expert-system': blueprint({
    title: 'Expert System',
    subtitle: 'forward-chaining IF-THEN rules with certainty-factor combination',
    nodes: [
      {
        id: 'observed_facts', kind: 'input', label: 'Observed facts', sublabel: 'trend, volatility, news flag (current bar)',
        column: 0,
      },
      { id: 'working_memory', kind: 'memory', label: 'Working memory', sublabel: 'grows as rules fire and assert new facts', column: 1 },
      { id: 'rule_matching', kind: 'compare', label: 'Rule matching', sublabel: 'test every rule condition against working memory', column: 2 },
      {
        id: 'conflict_resolution', kind: 'compare', label: 'Conflict resolution', sublabel: 'priority / specificity ordering picks which matching rule fires',
        column: 3,
        analogy: 'Think of it as the desk\'s most specific, most trusted rule getting first say whenever several rules would otherwise fire on the same bar.',
      },
      {
        id: 'certainty_combine', kind: 'fusion', label: 'Certainty factor combination', sublabel: 'CF_combined = CF1 + CF2(1-CF1) for independent support',
        column: 4,
        analogy: 'Think of it as two independent confirmations of the same call being worth more together than either alone, but never simply added past full certainty.',
      },
      { id: 'output', kind: 'output', label: 'Recommendation + combined certainty', column: 5 },
    ],
    edges: [
      ...chain('observed_facts', 'working_memory', 'rule_matching', 'conflict_resolution', 'certainty_combine', 'output'),
      ['certainty_combine', 'working_memory', 'context', 'derived fact asserted back; forward-chain another cycle until nothing new fires'],
    ],
  }),

  'probabilistic-symbolic-models-symbolic-reasoning-systems-first-order-logic-fol-inference': blueprint({
    title: 'First-Order Logic (FOL) Inference',
    subtitle: 'clausal resolution refutation proving a query is entailed',
    nodes: [
      { id: 'knowledge_base', kind: 'input', label: 'Knowledge base + negated query', sublabel: 'quantified rules + ground facts', column: 0 },
      { id: 'clausal_form', kind: 'memory', label: 'Clausal normal form', sublabel: 'Skolemize, eliminate implications, drop quantifiers', column: 1 },
      {
        id: 'unification', kind: 'compare', label: 'Unification', sublabel: 'find the most general substitution making two literals identical',
        column: 2,
        analogy: 'Think of it as matching a general rule pattern, for any instrument X, against a specific fact like EURUSD, discovering exactly which instrument X must be.',
      },
      {
        id: 'resolution', kind: 'compare', label: 'Resolution step', sublabel: 'resolve two clauses with complementary literals into a new clause',
        column: 3,
        analogy: 'Think of it as combining two partial arguments that share a contradiction into one new argument, over and over, until the contradiction needed to prove the query falls out directly.',
      },
      { id: 'empty_clause_check', kind: 'compare', label: 'Empty clause check', sublabel: 'a contradiction found means the query is entailed', column: 4 },
      { id: 'output', kind: 'output', label: 'Entailed / not entailed + proof trace', column: 5 },
    ],
    edges: [
      ...chain('knowledge_base', 'clausal_form', 'unification', 'resolution', 'empty_clause_check', 'output'),
      ['empty_clause_check', 'resolution', 'context', 'no contradiction yet: resolve another pair, repeat'],
    ],
  }),

  'probabilistic-symbolic-models-symbolic-reasoning-systems-fuzzy-logic-model': blueprint({
    title: 'Fuzzy Logic Model',
    subtitle: 'Mamdani inference: fuzzify, evaluate rules, defuzzify by centroid',
    nodes: [
      { id: 'crisp_inputs', kind: 'input', label: 'Crisp indicator readings', sublabel: 'RSI, MACD histogram, ATR', column: 0 },
      {
        id: 'fuzzification', kind: 'compare', label: 'Fuzzification', sublabel: 'triangular/trapezoidal membership functions per linguistic term',
        column: 1,
        analogy: 'Think of it as translating RSI = 68 into fairly high, but not maximally high, instead of forcing a hard yes/no at 70.',
      },
      {
        id: 'rule_base', kind: 'memory', label: 'Fuzzy rule base', sublabel: 'IF RSI is high AND MACD is rising THEN signal is bullish',
        column: 1, lane: 1,
        detail: { authored: 'hand-written linguistic rules, nothing learned in the Mamdani form' },
      },
      {
        id: 'rule_evaluation', kind: 'compare', label: 'Rule evaluation (implication)',
        sublabel: 'firing strength = min over antecedent memberships; clip the consequent set to it', column: 2,
      },
      { id: 'rule_aggregation', kind: 'fusion', label: 'Rule aggregation', sublabel: 'combine every fired rule\'s clipped output set by max', column: 3 },
      {
        id: 'defuzzification', kind: 'compare', label: 'Defuzzification (centroid)', sublabel: 'y* = integral(y mu(y) dy) / integral(mu(y) dy)',
        column: 4,
        analogy: 'Think of it as finding the balance point of every rule pull at once, so the final signal shifts smoothly rather than jumping the instant one threshold is crossed.',
      },
      { id: 'output', kind: 'output', label: 'Crisp trading signal', column: 5 },
    ],
    edges: [
      ...chain('crisp_inputs', 'fuzzification', 'rule_evaluation', 'rule_aggregation', 'defuzzification', 'output'),
      ['rule_base', 'rule_evaluation', 'context', 'which antecedents to test and which consequent set each rule clips'],
    ],
  }),

  'probabilistic-symbolic-models-symbolic-reasoning-systems-logic-programming-e-g-prolog': blueprint({
    title: 'Logic Programming (e.g., Prolog)',
    subtitle: 'Horn-clause knowledge base, SLD resolution with backtracking',
    nodes: [
      { id: 'query_goal', kind: 'input', label: 'Query goal', sublabel: 'e.g. risky_pair(eurusd, Y)', column: 0 },
      { id: 'clause_db', kind: 'memory', label: 'Clause database', sublabel: 'Horn-clause facts + rules loaded from current market state', column: 1 },
      { id: 'unification', kind: 'compare', label: 'Unify goal with clause head', sublabel: 'most general unifier', column: 2 },
      { id: 'sld_resolution', kind: 'compare', label: 'SLD resolution', sublabel: 'replace subgoal with clause body, append to goal list', column: 3 },
      {
        id: 'choice_point_stack', kind: 'memory', label: 'Choice-point stack', sublabel: 'remembers untried alternatives for backtracking',
        column: 4,
        analogy: 'Think of it as a bookmark left at every fork in the search, so if a chosen path later fails, the engine jumps straight back and tries the next option instead of starting over.',
      },
      { id: 'output', kind: 'output', label: 'Variable bindings (every satisfying answer)', column: 5 },
    ],
    edges: [
      ...chain('query_goal', 'clause_db', 'unification', 'sld_resolution', 'output'),
      ['sld_resolution', 'choice_point_stack', 'flow'],
      ['choice_point_stack', 'unification', 'context', 'subgoal failed: backtrack to the next untried clause alternative'],
    ],
  }),

  'probabilistic-symbolic-models-symbolic-reasoning-systems-rule-based-system': blueprint({
    title: 'Rule-Based System',
    subtitle: 'fixed, priority-ordered decision list, first match wins',
    nodes: [
      { id: 'fact_vector', kind: 'input', label: 'Current bar facts', sublabel: 'feature vector or derived booleans', column: 0 },
      { id: 'rule_1', kind: 'compare', label: 'Rule 1 (highest priority)', sublabel: 'condition test', column: 1, lane: 0 },
      { id: 'rule_2', kind: 'compare', label: 'Rule 2', sublabel: 'condition test', column: 1, lane: 1 },
      { id: 'rule_3', kind: 'compare', label: 'Rule 3 (lowest priority)', sublabel: 'condition test', column: 1, lane: 2 },
      {
        id: 'first_match', kind: 'compare', label: 'First-match selection', sublabel: 'take the highest-priority rule whose condition is true',
        column: 2,
        analogy: 'Think of it as walking down a fixed checklist in priority order and stopping at the very first item that applies -- never blending rules, never weighing them against each other.',
      },
      { id: 'output', kind: 'output', label: 'Action (or default)', column: 3 },
    ],
    edges: [
      ['fact_vector', 'rule_1', 'flow'], ['fact_vector', 'rule_2', 'flow'], ['fact_vector', 'rule_3', 'flow'],
      ['rule_1', 'first_match', 'flow'], ['rule_2', 'first_match', 'flow'], ['rule_3', 'first_match', 'flow'],
      ['first_match', 'output', 'flow'],
    ],
  }),

  'probabilistic-symbolic-models-symbolic-reasoning-systems-symbolic-regression': blueprint({
    title: 'Symbolic Regression',
    subtitle: 'genetic programming search over expression trees',
    nodes: [
      { id: 'dataset', kind: 'input', label: 'Training dataset', sublabel: '(feature row, target) pairs', column: 0 },
      {
        id: 'population_init', kind: 'stochastic', label: 'Random population init', sublabel: 'N=2000 expression trees, ramped half-and-half',
        column: 1,
        analogy: 'Think of it as scattering thousands of random little formulas across the space of possible equations, most of them nonsense, as raw material for evolution to work with.',
      },
      { id: 'fitness_eval', kind: 'compare', label: 'Fitness evaluation', sublabel: 'MSE(e(X), y) + lambda * size(e)', column: 2 },
      {
        id: 'selection', kind: 'stochastic', label: 'Tournament selection', sublabel: 'sample k=5, keep the fittest',
        column: 3,
        analogy: 'Think of it as picking the better of a handful of random contestants to become a parent, so fitter formulas get more chances to pass on their structure.',
      },
      {
        id: 'crossover_mutation', kind: 'fusion', label: 'Crossover + mutation', sublabel: 'subtree swap between parents; random subtree replacement',
        column: 4,
        analogy: 'Think of it as splicing a promising piece of one formula into another, and occasionally swapping in a fresh random piece to keep the search from going stale.',
      },
      {
        id: 'best_expression', kind: 'memory', label: 'Best-fitness expression', sublabel: 'carried forward each generation',
        column: 5,
        detail: { represents: 'a single closed-form formula, not a fixed weight count' },
      },
      { id: 'output', kind: 'output', label: 'Discovered formula', column: 6 },
    ],
    edges: [
      ...chain('dataset', 'population_init', 'fitness_eval', 'selection', 'crossover_mutation', 'best_expression', 'output'),
      ['crossover_mutation', 'fitness_eval', 'context', 'next generation: re-evaluate fitness, repeat for G generations'],
    ],
  }),
};
