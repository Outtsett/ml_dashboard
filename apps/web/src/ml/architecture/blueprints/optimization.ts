/**
 * Blueprints — Optimization-Based Models.
 *
 * Every method here is a solver or search procedure over a stated
 * mathematical problem, not a layer stack with learned weights. Only
 * Gradient Descent, Stochastic Gradient Descent and the RL-with-MPC value
 * network have real trainable parameters (via `P.linear`); everywhere else
 * `params` is omitted and `detail` states what IS stored or estimated
 * (an incumbent solution, a covariance matrix, a population, a pheromone
 * table) — the honest answer for a classical solver is "no learned weights".
 */

import type { ArchGraph } from '../types';
import type { NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features; // 35 — reused here as "35-instrument universe" or "35-dim parameter vector"
const C = DIM.classes;
// RL-with-MPC state, taken from that spec's own snippet: [inventory, cash, time_remaining].
const S = 3;
const VALUE_HIDDEN = 32;

function problemInput(label: string, sublabel: string, column: number, lane = 0): NodeSpec {
  return { id: 'input', kind: 'input', label, sublabel, outShape: `${F}`, column, lane };
}

function outputNode(label: string, sublabel: string, column: number, lane = 0): NodeSpec {
  return { id: 'output', kind: 'output', label, sublabel, column, lane };
}

export const OPTIMIZATION_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Classical Optimization ─────────────────────────────────────────────

  'optimization-based-models-classical-optimization-integer-linear-programming-ilp': blueprint({
    title: 'Integer Linear Programming (ILP)',
    subtitle: 'LP relaxation + branch and bound over a 35-instrument universe',
    nodes: [
      problemInput('Problem data', 'c, A, b — expected score, margin/exposure limits', 0),
      {
        id: 'lp_relax', kind: 'compare', label: 'LP relaxation', sublabel: 'simplex/interior-point, integrality dropped',
        column: 1,
      },
      {
        id: 'branch', kind: 'tree', label: 'Branch on fractional variable', sublabel: 'floor child / ceiling child',
        column: 2,
        analogy: 'Think of it as a desk forced to trade whole contracts: when the relaxed math says "buy 3.4 lots", it forks into two what-if branches — round to 3 or round to 4 — and only keeps exploring the ones that could still beat the best whole-lot plan found so far.',
      },
      {
        id: 'cut', kind: 'compare', label: 'Cutting planes', sublabel: 'Gomory cuts tighten the relaxation', column: 2, lane: 1,
      },
      {
        id: 'bound', kind: 'compare', label: 'Bound and prune', sublabel: 'discard if relaxed bound cannot beat incumbent',
        column: 3,
        analogy: 'Think of it as refusing to keep exploring a branch once its best-possible outcome is already worse than a plan already in hand — no point pricing out contracts that cannot win.',
      },
      { id: 'incumbent', kind: 'memory', label: 'Incumbent', sublabel: 'best integer-feasible x found so far', column: 4 },
      outputNode('Integer allocation x*', 'whole lots per instrument, with optimality gap', 5),
    ],
    edges: [
      ...chain('input', 'lp_relax', 'branch', 'bound', 'incumbent', 'output'),
      ['branch', 'cut', 'context', 'tighten relaxation at this node'],
      ['cut', 'bound', 'context', 'tightened bound'],
      ['bound', 'branch', 'residual', 'recurse into surviving children'],
    ],
  }),

  'optimization-based-models-classical-optimization-interior-point-methods': blueprint({
    title: 'Interior-Point Methods',
    subtitle: 'primal-dual barrier method following the central path',
    nodes: [
      problemInput('Problem data', 'c, A, b (or Q for QP) — barrier formulation', 0),
      { id: 'barrier', kind: 'compare', label: 'Log-barrier objective', sublabel: 'c^Tx - mu*sum(ln x_i), interior only', column: 1 },
      {
        id: 'newton', kind: 'compare', label: 'Newton step on KKT system', sublabel: 'primal, dual, slack step directions',
        column: 2,
        analogy: 'Think of it as feeling out the fastest safe path to the target while always staying a comfortable step away from any wall — never grazing the boundary the way a vertex-hopping method does.',
      },
      { id: 'path', kind: 'memory', label: 'Central path position', sublabel: '(x, y, s), strictly interior', column: 3 },
      { id: 'mu_reduce', kind: 'compare', label: 'Reduce barrier parameter mu', sublabel: 'centering schedule', column: 4 },
      outputNode('Primal-dual optimum', 'x*, y*, duality gap certificate', 5),
    ],
    edges: [
      ...chain('input', 'barrier', 'newton', 'path', 'mu_reduce', 'output'),
      ['mu_reduce', 'newton', 'residual', 'repeat until duality gap below tolerance'],
    ],
  }),

  'optimization-based-models-classical-optimization-linear-programming-lp': blueprint({
    title: 'Linear Programming (LP)',
    subtitle: 'simplex — vertex to adjacent, better vertex',
    nodes: [
      problemInput('Problem data', 'c, A, b — 35-instrument continuous weight allocation', 0),
      { id: 'vertex', kind: 'compare', label: 'Basic feasible solution', sublabel: 'start at a vertex of the polytope', column: 1 },
      {
        id: 'reduced_cost', kind: 'compare', label: 'Reduced-cost test', sublabel: 'any nonbasic variable still improving?',
        column: 2,
        analogy: 'Think of it as checking every unused instrument once more: does swapping it in still improve the book, or has the allocation already exhausted every profitable trade?',
      },
      {
        id: 'pivot', kind: 'compare', label: 'Pivot', sublabel: 'swap entering / leaving basic variable', column: 3,
        analogy: 'Think of it as walking along an edge of the feasible region to the next corner that is strictly better — never through the interior, always corner to corner.',
      },
      { id: 'dual', kind: 'memory', label: 'Shadow prices y*', sublabel: 'marginal value per binding constraint', column: 3, lane: 1 },
      outputNode('Optimal weights x*', 'continuous allocation + dual prices', 4),
    ],
    edges: [
      ['input', 'vertex', 'flow'],
      ['vertex', 'reduced_cost', 'flow'],
      ['reduced_cost', 'pivot', 'flow', 'improving direction found'],
      ['pivot', 'vertex', 'residual', 'move to adjacent vertex, repeat'],
      ['reduced_cost', 'output', 'flow', 'no improving direction — optimal'],
      ['vertex', 'dual', 'context', 'current basis prices every constraint'],
      ['dual', 'output', 'flow'],
    ],
  }),

  'optimization-based-models-classical-optimization-mixed-integer-programming-mip': blueprint({
    title: 'Mixed-Integer Programming (MIP)',
    subtitle: 'continuous weights + integer trade indicators, one joint solve',
    nodes: [
      problemInput('Problem data', 'c, d, A, B, b — continuous w, integer/binary z', 0),
      { id: 'lp_relax', kind: 'compare', label: 'LP relaxation', sublabel: 'z relaxed to continuous too', column: 1 },
      {
        id: 'branch', kind: 'tree', label: 'Branch on fractional z', sublabel: 'only the integer variables are split',
        column: 2,
        analogy: 'Think of it as leaving the continuous position-size math untouched while only forking on the yes/no "do we trade this instrument at all" decisions.',
      },
      {
        id: 'link', kind: 'compare', label: 'Big-M link constraint', sublabel: 'w_i <= M * z_i, couples size to indicator',
        column: 2, lane: 1,
        analogy: 'Think of it as the rule that a position size can only be nonzero on an instrument the desk actually switched on — and the switch, not the size, is what the search forks on.',
      },
      { id: 'bound', kind: 'compare', label: 'Bound and prune', sublabel: 'discard if bound cannot beat incumbent', column: 3 },
      { id: 'incumbent', kind: 'memory', label: 'Incumbent (x*, z*)', sublabel: 'best mixed feasible solution so far', column: 4 },
      outputNode('Joint allocation', 'which instruments (z*) at what weight (x*)', 5),
    ],
    edges: [
      ...chain('input', 'lp_relax', 'branch', 'bound', 'incumbent', 'output'),
      ['branch', 'link', 'context', 'linking constraint checked at this node'],
      ['link', 'bound', 'context', 'tightened by the linking constraint'],
      ['bound', 'branch', 'residual', 'recurse into surviving children'],
    ],
  }),

  'optimization-based-models-classical-optimization-quadratic-programming-qp': blueprint({
    title: 'Quadratic Programming (QP)',
    subtitle: 'mean-variance: risk (quadratic) vs. return (linear), 35 instruments',
    nodes: [
      problemInput('Estimated Sigma, mu', 'causal covariance + expected return, 35 instruments', 0),
      {
        id: 'objective', kind: 'compare', label: 'Risk-return objective', sublabel: 'lambda * w^T*Sigma*w - mu^T*w',
        column: 1,
        analogy: 'Think of it as one dial: turn risk-aversion lambda up and the solver hugs the minimum-variance corner; turn it down and it chases the highest-scoring instruments regardless of how correlated they are.',
      },
      { id: 'kkt', kind: 'compare', label: 'KKT stationarity', sublabel: 'Qx* + c + A^Ty* = 0 at the optimum', column: 2 },
      {
        id: 'solve', kind: 'compare', label: 'Active-set / interior-point solve', sublabel: 'small: active-set, large: barrier method',
        column: 3,
      },
      { id: 'frontier', kind: 'memory', label: 'Efficient frontier point', sublabel: 'one point per risk-aversion lambda', column: 3, lane: 1 },
      outputNode('Optimal weights w*', 'portfolio variance + expected return achieved', 4),
    ],
    edges: [
      ...chain('input', 'objective', 'kkt', 'solve', 'output'),
      ['solve', 'frontier', 'context', 'sweeping lambda traces the frontier'],
      ['frontier', 'objective', 'residual', 're-solve at a new lambda'],
    ],
  }),

  // ─── Convex & Non-Convex Methods ────────────────────────────────────────

  'optimization-based-models-convex-non-convex-methods-convex-optimization': blueprint({
    title: 'Convex Optimization',
    subtitle: 'any local optimum IS the global optimum, certified by duality',
    nodes: [
      problemInput('Convex problem', 'f0 convex, f_i convex, Ax = b', 0),
      {
        id: 'compose', kind: 'compare', label: 'Disciplined composition', sublabel: 'built from convexity-preserving operations',
        column: 1,
        analogy: 'Think of it as a search with no bad valleys to get trapped in: because the whole landscape is bowl-shaped, walking downhill from anywhere always reaches the single lowest point.',
      },
      {
        id: 'lagrangian', kind: 'compare', label: 'Lagrangian dual', sublabel: 'L(x,lambda,nu) = f0 + lambda^Tf + nu^T(Ax-b)',
        column: 2,
        analogy: 'Think of it as putting a price on every constraint so the relaxed book can be valued: whatever that priced-out version scores is a floor no feasible allocation can beat.',
      },
      { id: 'solver', kind: 'compare', label: 'Interior-point / ADMM / proximal solve', sublabel: 'whichever suits the problem\'s special structure', column: 3 },
      { id: 'certificate', kind: 'memory', label: 'Duality gap certificate', sublabel: 'primal - dual objective, proves near-optimality', column: 4 },
      outputNode('Global optimum x*', 'f0(x*) with a checkable optimality proof', 5),
    ],
    edges: [
      ...chain('input', 'compose', 'lagrangian', 'solver', 'certificate', 'output'),
    ],
  }),

  'optimization-based-models-convex-non-convex-methods-non-convex-optimization': blueprint({
    title: 'Non-Convex Optimization',
    subtitle: 'multi-start local search — no global-optimality certificate exists',
    nodes: [
      problemInput('Non-convex objective', 'f(x), possibly many stationary points', 0),
      {
        id: 'restart', kind: 'stochastic', label: 'Random / space-filling restart', sublabel: 'many independent starting points',
        column: 1,
        analogy: 'Think of it as dropping many scouts at random locations across a foggy, hilly landscape instead of trusting one to find the true lowest valley.',
      },
      { id: 'local_search', kind: 'compare', label: 'Local descent', sublabel: 'gradient / quasi-Newton / SLSQP from each start', column: 2 },
      {
        id: 'perturb', kind: 'stochastic', label: 'Basin-hopping perturbation', sublabel: 'jump + Metropolis-style accept test',
        column: 3,
        analogy: 'Think of it as occasionally letting a scout climb back UP out of a shallow valley on purpose, to check whether a deeper one is hiding just over the next ridge.',
      },
      { id: 'best_found', kind: 'memory', label: 'Best-found tracker', sublabel: 'no certificate this IS the global optimum', column: 4 },
      outputNode('Best-found x*', 'no optimality guarantee, only a best-observed result', 5),
    ],
    edges: [
      ...chain('input', 'restart', 'local_search', 'perturb', 'best_found', 'output'),
      ['perturb', 'local_search', 'residual', 'next hop, repeat'],
    ],
  }),

  // ─── Decomposition & Relaxation ─────────────────────────────────────────

  'optimization-based-models-decomposition-relaxation-augmented-lagrangian-method': blueprint({
    title: 'Augmented Lagrangian Method',
    subtitle: 'penalty + multiplier update, exact enforcement at finite rho',
    nodes: [
      problemInput('Constrained problem', 'min f(x) s.t. g(x) = 0', 0),
      {
        id: 'augmented', kind: 'compare', label: 'Augmented objective', sublabel: 'f(x) + lambda^Tg(x) + (rho/2)||g(x)||^2',
        column: 1,
        analogy: 'Think of it as fining a portfolio proportionally for breaking a risk-parity rule rather than forbidding the break outright — the fine rises only as much as needed to make compliance the cheaper choice.',
      },
      {
        id: 'inner_min', kind: 'compare', label: 'Inner unconstrained minimize', sublabel: 'L-BFGS / gradient, lambda held fixed', column: 2,
        analogy: 'Think of it as letting the desk rebalance freely for one round with the current fine schedule posted, and only then re-pricing the fine.',
      },
      { id: 'multiplier', kind: 'memory', label: 'Multiplier lambda', sublabel: 'lambda <- lambda + rho * g(x)', column: 3 },
      {
        id: 'penalty_grow', kind: 'compare', label: 'Grow penalty rho', sublabel: 'only if violation did not shrink enough', column: 3, lane: 1,
      },
      outputNode('Constrained optimum x*', 'exact constraint satisfaction at finite rho', 4),
    ],
    edges: [
      ...chain('input', 'augmented', 'inner_min', 'multiplier', 'output'),
      ['inner_min', 'penalty_grow', 'context', 'check constraint violation shrinkage'],
      ['penalty_grow', 'augmented', 'residual', 'outer iteration, repeat'],
    ],
  }),

  'optimization-based-models-decomposition-relaxation-dual-decomposition': blueprint({
    title: 'Dual Decomposition',
    subtitle: 'N independent subproblems coordinated by one shared price',
    nodes: [
      problemInput('Coupled subproblems', 'sum f_i(x_i) s.t. sum A_i*x_i <= b', 0),
      {
        id: 'price', kind: 'memory', label: 'Shared-resource price', sublabel: 'lambda — one multiplier for the coupling constraint',
        column: 1,
        analogy: 'Think of it as a single margin price posted to every desk: each desk decides its own position size independently, reacting only to that one shared number.',
      },
      {
        id: 'sub_1', kind: 'compare', label: 'Subproblem 1 (parallel)', sublabel: 'min f_1(x_1) + lambda^T*A_1*x_1', column: 2, lane: 0,
      },
      {
        id: 'sub_2', kind: 'compare', label: 'Subproblem N (parallel)', sublabel: 'min f_N(x_N) + lambda^T*A_N*x_N', column: 2, lane: 1,
      },
      {
        id: 'usage', kind: 'compare', label: 'Aggregate usage vs budget', sublabel: 'sum A_i*x_i - b', column: 3,
        analogy: 'Think of it as tallying every desk\'s margin draw at the end of the round and raising or lowering next round\'s price depending on whether the shared pool ran over or under.',
      },
      outputNode('Coordinated solution', 'per-subproblem {x_i*} + converged price lambda*', 4),
    ],
    edges: [
      ['input', 'price', 'flow'],
      ['price', 'sub_1', 'flow'],
      ['price', 'sub_2', 'flow'],
      ['sub_1', 'usage', 'flow'],
      ['sub_2', 'usage', 'flow'],
      ['usage', 'output', 'flow'],
      ['usage', 'price', 'residual', 'subgradient step, repeat'],
    ],
  }),

  'optimization-based-models-decomposition-relaxation-lagrangian-relaxation': blueprint({
    title: 'Lagrangian Relaxation',
    subtitle: 'relax the complicating constraint into a penalty, bound the hard problem',
    nodes: [
      problemInput('Hard combinatorial problem', 'min f(x) s.t. g(x)<=0 (complicating), x in X (easy)', 0),
      {
        id: 'relax', kind: 'compare', label: 'Relax g(x) into the objective', sublabel: 'L(lambda) = min_{x in X} f(x) + lambda^Tg(x)',
        column: 1,
        analogy: 'Think of it as temporarily dropping the one awkward rule (a cardinality cap) and instead pricing it — the remaining problem is suddenly easy to solve exactly.',
      },
      { id: 'easy_solve', kind: 'compare', label: 'Solve the easy subproblem', sublabel: 'x in X only, no complicating constraint', column: 2 },
      { id: 'bound_val', kind: 'memory', label: 'Lagrangian bound', sublabel: 'valid bound for ANY lambda >= 0', column: 3 },
      { id: 'dual_ascent', kind: 'compare', label: 'Subgradient ascent on lambda', sublabel: 'tighten the bound', column: 3, lane: 1 },
      {
        id: 'repair', kind: 'compare', label: 'Repair heuristic', sublabel: 'project relaxed solution onto true feasible set',
        column: 4,
      },
      outputNode('Bound + feasible solution', 'L(lambda*) bound and a repaired feasible x-hat', 5),
    ],
    edges: [
      ...chain('input', 'relax', 'easy_solve', 'bound_val', 'repair', 'output'),
      ['easy_solve', 'dual_ascent', 'context', 'constraint violation g(x)'],
      ['dual_ascent', 'relax', 'residual', 'updated lambda, repeat'],
    ],
  }),

  // ─── Evolutionary Strategies ─────────────────────────────────────────────

  'optimization-based-models-evolutionary-strategies-differential-evolution-de': blueprint({
    title: 'Differential Evolution (DE)',
    subtitle: 'mutant = base + F*(diff of two others), greedy one-to-one selection',
    nodes: [
      { id: 'input', kind: 'input', label: 'Population init', sublabel: `NP candidates, ${F}-dim parameter vectors`, outShape: `NP × ${F}`, column: 0 },
      {
        id: 'mutate', kind: 'stochastic', label: 'Difference-vector mutation', sublabel: 'v = x_r1 + F*(x_r2 - x_r3)',
        column: 1,
        analogy: 'Think of it as nudging one candidate strategy by exactly the gap between two OTHER candidates — the step size is never hand-set, it comes straight from how spread out the current population already is.',
      },
      { id: 'crossover', kind: 'compare', label: 'Binomial crossover', sublabel: 'blend mutant with target per-dimension, prob CR', column: 2 },
      {
        id: 'population', kind: 'memory', label: 'Population', sublabel: 'NP candidate parameter vectors, this generation',
        column: 2, lane: 1,
      },
      {
        id: 'select', kind: 'compare', label: 'Greedy selection', sublabel: 'trial replaces target only if it scores >=', column: 3,
        analogy: 'Think of it as a strict rule: a new trial strategy only survives into the next generation if it backtests at least as well as the one it is replacing — best score in the population can never get worse.',
      },
      outputNode('Best candidate x*', 'best member of the final population', 4),
    ],
    edges: [
      ...chain('input', 'mutate', 'crossover', 'select', 'output'),
      ['population', 'mutate', 'context', 'r1, r2, r3 drawn from here'],
      ['crossover', 'select', 'flow'],
      ['select', 'population', 'residual', 'next generation, repeat'],
    ],
  }),

  'optimization-based-models-evolutionary-strategies-evolution-strategies-es': blueprint({
    title: 'Evolution Strategies (ES / CMA-ES)',
    subtitle: 'sample a Gaussian, rank, reweight the mean and covariance',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Search distribution', sublabel: `N(m, sigma^2*C), ${F}-dim mean`, outShape: `${F}`, column: 0,
      },
      {
        id: 'sample', kind: 'stochastic', label: 'Sample lambda candidates', sublabel: 'x_k ~ N(m, sigma^2*C)', column: 1,
        analogy: 'Think of it as scattering a cloud of trial parameter sets around the current best guess, shaped like an ellipse that stretches along whatever direction has recently paid off.',
      },
      { id: 'evaluate', kind: 'compare', label: 'Evaluate + rank', sublabel: 'fitness = backtest score, ranked not raw-weighted', column: 2 },
      {
        id: 'recombine', kind: 'compare', label: 'Weighted recombination', sublabel: 'new mean = rank-weighted average of top mu', column: 3,
      },
      { id: 'covariance', kind: 'memory', label: 'Covariance adaptation (CMA)', sublabel: 'C learned from the evolution path', column: 3, lane: 1,
        analogy: 'Think of it as the search cloud learning its own shape over time — stretching along directions that keep producing improvement, shrinking along ones that do not.',
      },
      outputNode('Optimized parameters', 'final mean m, re-validated on held-out data', 4),
    ],
    edges: [
      ...chain('input', 'sample', 'evaluate', 'recombine', 'output'),
      ['recombine', 'covariance', 'context', 'update C and step size sigma'],
      ['covariance', 'sample', 'residual', 'next generation, repeat'],
    ],
  }),

  'optimization-based-models-evolutionary-strategies-genetic-algorithm-ga': blueprint({
    title: 'Genetic Algorithm (GA)',
    subtitle: 'selection, crossover, mutation over a chromosome population',
    nodes: [
      { id: 'input', kind: 'input', label: 'Chromosome population', sublabel: `N candidates, ${F}-gene vectors`, outShape: `N × ${F}`, column: 0 },
      { id: 'fitness', kind: 'compare', label: 'Fitness evaluation', sublabel: 'backtest score per chromosome', column: 1 },
      {
        id: 'select', kind: 'compare', label: 'Tournament selection', sublabel: 'fitter individuals more likely to reproduce', column: 2,
      },
      {
        id: 'crossover', kind: 'stochastic', label: 'Crossover', sublabel: 'recombine two parents\' genes into an offspring',
        column: 3,
        analogy: 'Think of it as splicing two decent trading rule-sets together and hoping the offspring inherits the best of both — a good entry filter from one parent, a good exit rule from the other.',
      },
      { id: 'mutate', kind: 'stochastic', label: 'Mutation', sublabel: 'small per-gene random perturbation', column: 4 },
      {
        id: 'elite', kind: 'memory', label: 'Elitism', sublabel: 'best individual carried over unchanged', column: 4, lane: 1,
        analogy: 'Think of it as never letting the single best strategy found so far get accidentally bred or mutated away — it rides into the next generation untouched, as insurance.',
      },
      outputNode('Best chromosome', 'decoded back to strategy rules + parameters', 5),
    ],
    edges: [
      ...chain('input', 'fitness', 'select', 'crossover', 'mutate', 'output'),
      ['fitness', 'elite', 'context', 'best individual this generation'],
      ['elite', 'output', 'flow'],
      ['mutate', 'input', 'residual', 'next generation, repeat'],
    ],
  }),

  // ─── Gradient-Based Optimization ────────────────────────────────────────

  'optimization-based-models-gradient-based-optimization-gradient-descent': blueprint({
    title: 'Gradient Descent',
    subtitle: 'full-batch — step along the negative gradient every iteration',
    nodes: [
      { id: 'input', kind: 'input', label: 'Full training set', sublabel: `all n samples, ${F} causal features`, outShape: `n × ${F}`, column: 0 },
      {
        id: 'linear', kind: 'linear', label: 'Model parameters theta', sublabel: `Linear ${F} → ${C}`,
        inShape: `n × ${F}`, outShape: `n × ${C}`, params: P.linear(F, C), column: 1,
      },
      { id: 'predict', kind: 'output', label: 'Predictions', sublabel: 'f(theta; entire dataset)', inShape: `n × ${C}`, outShape: `n × ${C}`, column: 2 },
      {
        id: 'loss', kind: 'compare', label: 'Full-batch loss', sublabel: 'f(theta) = (1/n) * sum over ALL n examples', column: 3,
        analogy: 'Think of it as grading a strategy against every single historical bar before making even one adjustment — thorough, but you only get to adjust once per full pass through the data.',
      },
      {
        id: 'update', kind: 'compare', label: 'Parameter update', sublabel: 'theta <- theta - eta * grad f(theta)', column: 4,
      },
      outputNode('Fitted parameters theta*', 'gradient norm below tolerance, or iteration budget spent', 5),
    ],
    edges: [
      ...chain('input', 'linear', 'predict', 'loss', 'update', 'output'),
      ['update', 'linear', 'residual', 'apply the step, recompute the full gradient'],
    ],
  }),

  'optimization-based-models-gradient-based-optimization-stochastic-gradient-descent-sgd': blueprint({
    title: 'Stochastic Gradient Descent (SGD)',
    subtitle: 'Adam/AdamW — noisy mini-batch gradients, vastly more steps per second',
    nodes: [
      { id: 'input', kind: 'input', label: 'Shuffled training set', sublabel: `bar windows, ${F} causal features`, outShape: `n × ${F}`, column: 0 },
      {
        id: 'minibatch', kind: 'stochastic', label: 'Sample mini-batch', sublabel: 'B_t, size b << n',
        inShape: `n × ${F}`, outShape: `b × ${F}`, column: 1,
        analogy: 'Think of it as grading the strategy on just today\'s handful of bars instead of the whole history before adjusting — noisier per step, but you get to adjust thousands of times instead of once.',
      },
      {
        id: 'linear', kind: 'linear', label: 'Model parameters theta', sublabel: `Linear ${F} → ${C}`,
        inShape: `b × ${F}`, outShape: `b × ${C}`, params: P.linear(F, C), column: 2,
      },
      { id: 'loss', kind: 'compare', label: 'Mini-batch loss', sublabel: 'unbiased estimate of the true full-batch loss', inShape: `b × ${C}`, column: 3 },
      {
        id: 'moments', kind: 'memory', label: 'Adam moments (m_t, v_t)', sublabel: 'running mean + variance of the gradient', column: 3, lane: 1,
        analogy: 'Think of it as remembering not just today\'s gradient but a smoothed trend of recent ones — so one noisy, unrepresentative mini-batch cannot yank the parameters off course.',
      },
      { id: 'update', kind: 'compare', label: 'AdamW step', sublabel: 'theta <- theta - eta * m_hat / (sqrt(v_hat) + eps)', column: 4 },
      outputNode('Fitted parameters theta*', 'early-stopped on a strictly later validation block', 5),
    ],
    edges: [
      ...chain('input', 'minibatch', 'linear', 'loss', 'update', 'output'),
      ['loss', 'moments', 'context', 'gradient feeds the running moment estimates'],
      ['moments', 'update', 'context', 'bias-corrected m_hat, v_hat rescale the step'],
      ['update', 'linear', 'residual', 'apply the step, sample the next mini-batch'],
    ],
  }),

  // ─── Metaheuristic Algorithms ────────────────────────────────────────────

  'optimization-based-models-metaheuristic-algorithms-ant-colony-optimization-aco': blueprint({
    title: 'Ant Colony Optimization (ACO)',
    subtitle: 'pheromone-guided construction of a routing/sequencing solution',
    nodes: [
      { id: 'input', kind: 'input', label: 'Construction graph', sublabel: 'venues / sequence positions + edge costs', column: 0 },
      {
        id: 'pheromone', kind: 'memory', label: 'Pheromone trail', sublabel: 'tau_ij per edge, shared across all ants',
        column: 1,
        analogy: 'Think of it as a shared scent trail: every ant reads and adds to the same map, so good routes get more heavily marked purely by how many successful ants have walked them.',
      },
      {
        id: 'heuristic', kind: 'compare', label: 'Heuristic desirability', sublabel: 'eta_ij = 1 / cost_ij, fixed by the problem',
        column: 1, lane: 1,
        analogy: 'Think of it as the venue table every ant can already read before anyone has traded — it biases the very first routes sensibly, before any experience exists to learn from.',
      },
      {
        id: 'construct', kind: 'stochastic', label: 'Ants construct routes', sublabel: 'p_ij proportional to tau^alpha * eta^beta', column: 2,
      },
      { id: 'evaluate', kind: 'compare', label: 'Score each ant\'s route', sublabel: 'total cost of the completed path', column: 3 },
      {
        id: 'evaporate', kind: 'compare', label: 'Evaporate + deposit', sublabel: 'tau <- (1-rho)*tau + new deposit', column: 4,
        analogy: 'Think of it as the scent trail fading a little every round no matter what — so a route that was good last month but is not being reinforced now quietly loses its influence.',
      },
      outputNode('Best route found', 'lowest-cost sequence across all ants and iterations', 5),
    ],
    edges: [
      ...chain('input', 'pheromone', 'construct', 'evaluate', 'evaporate', 'output'),
      ['input', 'heuristic', 'flow'],
      ['heuristic', 'construct', 'context', 'the eta^beta factor in every step probability'],
      ['evaporate', 'pheromone', 'residual', 'updated trail feeds the next iteration'],
    ],
  }),

  'optimization-based-models-metaheuristic-algorithms-bayesian-optimization': blueprint({
    title: 'Bayesian Optimization',
    subtitle: 'Gaussian-process surrogate + expected-improvement acquisition',
    nodes: [
      { id: 'input', kind: 'input', label: 'Observed trials', sublabel: '(hyperparameters, walk-forward score) pairs', column: 0 },
      {
        id: 'surrogate', kind: 'memory', label: 'Gaussian process surrogate', sublabel: 'prior x likelihood -> posterior over the whole space',
        column: 1,
        detail: {
          'prior': 'GP(m, k), Matern or RBF kernel sets the smoothness assumption',
          'likelihood': 'each observed score is the true value plus noise of variance sigma_n^2',
          'posterior': 'mean mu(x) and standard deviation sigma(x) at every untried x',
          'learned weights': 'none — the GP is refit from the observation set each round',
        },
        analogy: 'Think of it as a mental map of the whole hyperparameter space built from only a few dozen expensive backtests — confident where it has evidence, honestly uncertain everywhere else.',
      },
      {
        id: 'acquisition', kind: 'compare', label: 'Expected improvement', sublabel: 'balances the surrogate\'s mean vs. its uncertainty',
        column: 2,
        analogy: 'Think of it as choosing the next trial not by "where do I think the best score is" alone, but by "where could I be most wrong" — trying a promising region and an uncertain one, never only one or the other.',
      },
      { id: 'expensive_eval', kind: 'compare', label: 'Run the real trial', sublabel: 'full training + walk-forward validation', column: 3 },
      outputNode('Best configuration', 'evaluated dozens of times, not thousands', 4),
    ],
    edges: [
      ...chain('input', 'surrogate', 'acquisition', 'expensive_eval', 'output'),
      ['expensive_eval', 'input', 'residual', 'new observation added, refit the surrogate'],
    ],
  }),

  'optimization-based-models-metaheuristic-algorithms-branch-and-bound': blueprint({
    title: 'Branch and Bound',
    subtitle: 'general framework — partition, bound, prune, repeat to a certified optimum',
    nodes: [
      problemInput('Combinatorial problem', 'min f(x), x in discrete/mixed feasible set X', 0),
      { id: 'relax_bound', kind: 'compare', label: 'Relaxation bound', sublabel: 'cheap bound on this subproblem\'s best outcome', column: 1 },
      {
        id: 'prune_test', kind: 'compare', label: 'Prune test', sublabel: 'can this bound beat the incumbent?', column: 2,
        analogy: 'Think of it as refusing to price out an entire branch of possibilities the instant you can prove none of them could beat a plan already in hand.',
      },
      {
        id: 'branch', kind: 'tree', label: 'Branch', sublabel: 'partition into child subproblems', column: 3,
      },
      { id: 'incumbent', kind: 'memory', label: 'Incumbent', sublabel: 'best feasible solution found so far', column: 4 },
      outputNode('Certified optimum', 'incumbent + proven optimality gap', 5),
    ],
    edges: [
      ['input', 'relax_bound', 'flow'],
      ['relax_bound', 'prune_test', 'flow'],
      ['prune_test', 'branch', 'flow', 'bound still beats the incumbent — keep going'],
      ['branch', 'incumbent', 'flow', 'a child whose relaxation is already feasible becomes the new best'],
      ['incumbent', 'output', 'flow'],
      ['prune_test', 'incumbent', 'context', 'compare against current best'],
      ['branch', 'relax_bound', 'residual', 'bound each new child, repeat'],
    ],
  }),

  'optimization-based-models-metaheuristic-algorithms-greedy-algorithms': blueprint({
    title: 'Greedy Algorithms',
    subtitle: 'one forward pass — always take the locally best remaining choice',
    nodes: [
      problemInput('Candidate set', 'per-candidate contribution value, e.g. score/margin', 0),
      {
        id: 'rank', kind: 'compare', label: 'Rank by marginal gain', sublabel: 'g(e | current partial solution)', column: 1,
        analogy: 'Think of it as always reaching for the single best-remaining trade first, without ever asking whether saving it for later might combine better with something else.',
      },
      { id: 'pick_best', kind: 'compare', label: 'Take the top-ranked choice', sublabel: 'add it if it keeps the solution feasible', column: 2 },
      { id: 'partial', kind: 'memory', label: 'Partial solution S', sublabel: 'grows by exactly one choice per step', column: 3 },
      outputNode('Selected subset / sequence', 'no backtracking — never revisited once chosen', 4),
    ],
    edges: [
      ...chain('input', 'rank', 'pick_best', 'partial', 'output'),
      ['partial', 'rank', 'residual', 're-rank remaining candidates, repeat'],
    ],
  }),

  'optimization-based-models-metaheuristic-algorithms-particle-swarm-optimization-pso': blueprint({
    title: 'Particle Swarm Optimization (PSO)',
    subtitle: 'velocity pulled toward personal best AND swarm-wide global best',
    nodes: [
      { id: 'input', kind: 'input', label: 'Swarm init', sublabel: `N particles, ${F}-dim position + velocity`, outShape: `N × ${F}`, column: 0 },
      { id: 'evaluate', kind: 'compare', label: 'Evaluate every particle', sublabel: 'backtest score at current position', column: 1 },
      {
        id: 'pbest', kind: 'memory', label: 'Personal best (pbest)', sublabel: 'each particle\'s own historical best position', column: 2, lane: 0,
      },
      {
        id: 'gbest', kind: 'memory', label: 'Global best (gbest)', sublabel: 'best position found by ANY particle', column: 2, lane: 1,
        analogy: 'Think of it as every trader on the desk both trusting their own best trade idea so far AND being pulled toward whichever colleague currently has the single best idea in the room.',
      },
      {
        id: 'velocity', kind: 'stochastic', label: 'Velocity update', sublabel: 'w*v + c1*r1*(pbest-x) + c2*r2*(gbest-x)', column: 3,
        analogy: 'Think of it as deciding how hard to lean this round — partly carrying last round\'s momentum, partly pulled back toward your own best idea, partly pulled toward the desk\'s.',
      },
      {
        id: 'position', kind: 'compare', label: 'Position update', sublabel: 'x <- x + v, clipped to the search bounds', column: 4,
        analogy: 'Think of it as actually moving the parameter set by that lean — nothing is ever discarded or replaced, every particle just ends up somewhere new.',
      },
      outputNode('Global best position', 'swarm-wide best, re-validated on held-out data', 5),
    ],
    edges: [
      ['input', 'evaluate', 'flow'],
      ['evaluate', 'pbest', 'context', 'update if this position beats the particle\'s own best'],
      ['evaluate', 'gbest', 'context', 'update if this position beats the swarm best'],
      ['pbest', 'velocity', 'flow'],
      ['gbest', 'velocity', 'flow'],
      ['velocity', 'position', 'flow'],
      ['position', 'evaluate', 'residual', 'next iteration: re-score every particle where it now stands'],
      ['gbest', 'output', 'flow'],
    ],
  }),

  'optimization-based-models-metaheuristic-algorithms-simulated-annealing': blueprint({
    title: 'Simulated Annealing',
    subtitle: 'single trajectory — cooling temperature shifts explore -> exploit',
    nodes: [
      problemInput('Initial solution', 'x_0, energy E(x_0)', 0),
      {
        id: 'perturb', kind: 'stochastic', label: 'Perturb', sublabel: 'candidate x\' from the neighborhood N(x)', column: 1,
      },
      {
        id: 'metropolis', kind: 'compare', label: 'Metropolis acceptance', sublabel: 'accept worsening move w.p. exp(-dE / T)',
        column: 2,
        analogy: 'Think of it as being willing to accept a slightly worse trading rule change early on, on purpose, because the temperature is still high — that willingness is exactly what lets the search climb out of a mediocre local optimum instead of getting stuck in it.',
      },
      {
        id: 'cool', kind: 'compare', label: 'Cool the temperature', sublabel: 'T <- alpha * T, geometric decay', column: 3,
        analogy: 'Think of it as the search gradually losing its tolerance for bad moves — wide open to experimentation early, almost purely greedy by the end.',
      },
      { id: 'best_tracker', kind: 'memory', label: 'Best-found tracker', sublabel: 'best energy seen across the whole trajectory', column: 3, lane: 1 },
      outputNode('Best-found solution', 'trajectory\'s best point, re-validated out of sample', 4),
    ],
    edges: [
      ...chain('input', 'perturb', 'metropolis', 'cool', 'output'),
      ['metropolis', 'best_tracker', 'context', 'record if this is the best ever seen'],
      ['best_tracker', 'output', 'flow'],
      ['cool', 'perturb', 'residual', 'next step at the lower temperature'],
    ],
  }),

  // ─── Reinforcement-Guided Methods ───────────────────────────────────────

  'optimization-based-models-reinforcement-guided-methods-dynamic-programming-dp': blueprint({
    title: 'Dynamic Programming (DP)',
    subtitle: 'backward induction — solve every subproblem exactly, once, reuse forever',
    nodes: [
      { id: 'input', kind: 'input', label: 'State + action spaces', sublabel: 'inventory, cash, time-remaining; trade-size actions', column: 0 },
      { id: 'terminal', kind: 'memory', label: 'Terminal value V_T(s)', sublabel: 'known exactly at the horizon', column: 1 },
      {
        id: 'bellman', kind: 'compare', label: 'Bellman recursion', sublabel: 'V_t(s) = max_a[ r(s,a) + gamma*E[V_{t+1}(s\')] ]',
        column: 2,
        analogy: 'Think of it as never re-deriving "what should I do if I still have 40 contracts left with 3 bars to go" more than once — the answer is computed a single time and looked up instantly every time that exact situation recurs.',
      },
      { id: 'value_table', kind: 'memory', label: 'Value table V_t(s)', sublabel: 'one entry per (time, state), filled backward', column: 3 },
      {
        id: 'policy', kind: 'compare', label: 'Optimal policy pi_t(s)', sublabel: 'argmax_a stored alongside each value', column: 4,
      },
      outputNode('Full policy table', 'live decisions are a lookup, not a re-solve', 5),
    ],
    edges: [
      ...chain('input', 'terminal', 'bellman', 'value_table', 'policy', 'output'),
      ['value_table', 'bellman', 'residual', 'earlier time step reuses later ones, working backward'],
    ],
  }),

  'optimization-based-models-reinforcement-guided-methods-reinforcement-learning-with-mpc': blueprint({
    title: 'Reinforcement Learning with MPC',
    subtitle: 'short explicit plan + a learned value function beyond the horizon',
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Current state', sublabel: 'inventory, cash, time-remaining',
        outShape: `B × ${S}`, column: 0,
      },
      {
        id: 'plan', kind: 'compare', label: 'MPC solve (horizon H)', sublabel: 'plan H steps using the explicit dynamics model',
        inShape: `B × ${S}`, column: 1,
        analogy: 'Think of it as planning your next few moves in detail using known market rules, then trusting a learned instinct — not another explicit plan — for everything past that short horizon.',
      },
      {
        id: 'value_net', kind: 'linear', label: 'Learned terminal value V_theta',
        sublabel: `Linear ${S} → ${VALUE_HIDDEN} → 1, ReLU between`,
        inShape: `B × ${S}`, outShape: `B × 1`,
        params: P.linear(S, VALUE_HIDDEN) + P.linear(VALUE_HIDDEN, 1), column: 2,
        detail: {
          'state': 'inventory, cash, time_remaining',
          'formula': 'P.linear(3, 32) + P.linear(32, 1)',
          'the only learned weights in this diagram': P.linear(S, VALUE_HIDDEN) + P.linear(VALUE_HIDDEN, 1),
        },
        analogy: 'Think of it as the desk\'s learned instinct for what a given leftover inventory is worth once the plan runs out — the one piece here that is fitted rather than derived.',
      },
      { id: 'replay', kind: 'memory', label: 'Replay buffer', sublabel: 'past (s, a, r, s\') transitions', column: 2, lane: 1 },
      {
        id: 'execute', kind: 'compare', label: 'Execute first action only', sublabel: 'then re-plan from the new state next step', column: 3,
      },
      { id: 'bellman_fit', kind: 'compare', label: 'Fit V_theta (Bellman residual)', sublabel: '(V_theta(s) - [r + gamma*V_target(s\')])^2', column: 3, lane: 1 },
      {
        id: 'target_net', kind: 'memory', label: 'Target network V_target', sublabel: 'frozen copy, synced every N steps',
        column: 4, lane: 1,
        analogy: 'Think of it as scoring today\'s plan against yesterday\'s published valuation rather than one that moves while you are using it — the target stops chasing itself.',
      },
      outputNode('Action taken', 'receding-horizon — replanned at every step', 4),
    ],
    edges: [
      ...chain('input', 'plan', 'execute', 'output'),
      ['value_net', 'plan', 'context', 'supplies the terminal cost-to-go'],
      ['replay', 'bellman_fit', 'flow'],
      ['bellman_fit', 'value_net', 'residual', 'periodic offline refit'],
      ['target_net', 'bellman_fit', 'context', 'V_target(s\') held fixed between syncs'],
      ['value_net', 'target_net', 'context', 'hard copy every target-update interval'],
      ['execute', 'replay', 'context', 'realized transition stored for future fitting'],
    ],
  }),

  // ─── Submodular & Discrete Optimization ─────────────────────────────────

  'optimization-based-models-submodular-discrete-optimization-submodular-optimization': blueprint({
    title: 'Submodular Optimization',
    subtitle: 'lazy greedy — diminishing-returns selection with a (1 - 1/e) guarantee',
    nodes: [
      problemInput('Ground set E', '35 candidate instruments / features', 0),
      {
        id: 'marginal_gain', kind: 'compare', label: 'Marginal gain', sublabel: 'f(S union {e}) - f(S), shrinks as S grows',
        column: 1,
        analogy: 'Think of it as picking instruments for a diversified basket: the 1st correlated-market pick adds a lot of new coverage, but the 6th pick that behaves like the first five adds almost nothing — submodularity is that exact shrinking-returns pattern, made precise.',
      },
      {
        id: 'lazy_queue', kind: 'memory', label: 'Lazy priority queue', sublabel: 'stale upper bounds skip most recomputation',
        column: 2,
        analogy: 'Think of it as never re-checking a candidate\'s appeal from scratch if its LAST known gain already looks worse than everyone else\'s current best — diminishing returns guarantee that old bound can only be too optimistic, never too pessimistic.',
      },
      { id: 'add_best', kind: 'compare', label: 'Add the top candidate to S', sublabel: 'recompute its TRUE current gain first', column: 3 },
      { id: 'selected_set', kind: 'memory', label: 'Selected set S', sublabel: 'grows by one element per step, up to budget k', column: 4 },
      outputNode('Selected subset S*', 'f(S*) >= (1 - 1/e) * f(optimal subset)', 5),
    ],
    edges: [
      ...chain('input', 'marginal_gain', 'lazy_queue', 'add_best', 'selected_set', 'output'),
      ['selected_set', 'marginal_gain', 'residual', 'recompute remaining candidates\' gains against the new S'],
    ],
  }),
};
