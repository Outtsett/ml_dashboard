"""Planners over a discretised market model estimated on the training span.

``ClusterMarketModel`` is the model every planner shares: market clusters
(k-means on a few feature columns, ``bridges.binning.ClusterStates``), the
cluster transition matrix P(c' | c) counted from consecutive training bars with
additive smoothing, and the reward pieces of the tape's step reward
(``bridges.tape``): per bar t, in units of the bar's causal move scale,

    gap move  g_t = (open[t+1] - close[t]) / move_scale[t]    (earned by the position held into t+1)
    bar move  b_t = (close[t+1] - open[t+1]) / move_scale[t]  (earned by the position chosen at t)
    cost      k_t = round_trip_cost_points / move_scale[t]    (a round trip; a fill is half)

so the step reward of moving from position p to a at bar t is
p * g_t + a * b_t - |a - p| * k_t / 2, exactly ``RewardTape.step_reward``. The
position is part of the planning state (switching costs), the market cluster
evolves on its own. Every planner reads the flat-position root, so a bar's
answer never depends on an earlier prediction.

- ``backward_induction``: exact finite-horizon dynamic programming
  (Bellman 1957), V_H = liquidation, V_t = max_a [R + discount * P V_{t+1}].
- ``value_iteration``: the infinite-horizon discounted Markov decision process
  solved to a tolerance (Q* of the counted model).
- ``uct_root_values``: Monte Carlo tree search with UCB1 selection (Kocsis and
  Szepesvari 2006) on min-max normalised returns, over (depth, cluster,
  position) nodes, random rollouts, rewards resampled from the cluster's own
  training bars; numba.
- ``solve_zero_sum``: the minimax linear program of a two-player zero-sum
  matrix game (scipy HiGHS); ``robust_game`` builds the per-cluster game.
- ``expected_utility_position``: the position in [-1, 1] maximising expected
  utility (CRRA, CARA) or the cumulative-prospect-theory value of a cluster's
  empirical outcome lottery.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numba import njit

from cycle.bridges.binning import ClusterStates, conditional_means

POSITIONS = np.array([-1.0, 0.0, 1.0])
SHORT, FLAT, LONG = 0, 1, 2


def step_pieces(view, tape, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(gap move, bar move, cost) per row in move-scale units; NaN where the
    tape may not read bar t+1 (past ``tape.known_until``) or a price is missing."""
    rows = np.asarray(rows, dtype=np.int64)
    known = (rows >= 0) & (rows + 1 <= tape.known_until)
    gap = np.full(rows.shape, np.nan)
    bar = np.full(rows.shape, np.nan)
    cost = np.full(rows.shape, np.nan)
    row = rows[known]
    scale = tape.move_scale[row]
    with np.errstate(invalid="ignore", divide="ignore"):
        gap[known] = (tape.open[row + 1] - tape.close[row]) / scale
        bar[known] = (tape.close[row + 1] - tape.open[row + 1]) / scale
        cost[known] = tape.round_trip_cost_points / scale
    bad = ~(np.isfinite(gap) & np.isfinite(bar) & np.isfinite(cost))
    gap[bad] = bar[bad] = cost[bad] = np.nan
    return gap, bar, cost


@dataclass
class ClusterMarketModel:
    clusters: ClusterStates
    transition: np.ndarray        # (C, C) P(c' | c)
    gap_mean: np.ndarray          # (C,) shrunk toward 0 (no edge)
    bar_mean: np.ndarray          # (C,)
    cost_mean: np.ndarray         # (C,) scaled round trip
    counts: np.ndarray            # (C,) training bars per cluster
    samples: np.ndarray           # (n, 3) gap, bar, cost of the training bars, grouped by cluster
    offsets: np.ndarray           # (C + 1,) the cluster's rows in ``samples``

    @property
    def cluster_count(self) -> int:
        return self.clusters.cluster_count

    @classmethod
    def fit(cls, features: np.ndarray, view, tape, train_index: np.ndarray, columns: list[int], cluster_count: int,
            seed: int, smoothing: float) -> ClusterMarketModel:
        rows = view.fit_rows(train_index)
        clusters = ClusterStates.fit(features, train_index, cluster_count, seed, columns=columns)
        codes = clusters.assign(features, rows)
        gap, bar, cost = step_pieces(view, tape, rows)
        usable = (codes >= 0) & np.isfinite(gap)
        count = clusters.cluster_count
        gap_mean = conditional_means(codes[usable], gap[usable], count, prior_weight=smoothing, prior_mean=0.0)
        bar_mean = conditional_means(codes[usable], bar[usable], count, prior_weight=smoothing, prior_mean=0.0)
        cost_mean = conditional_means(codes[usable], cost[usable], count, prior_weight=smoothing)
        counts = np.bincount(codes[usable], minlength=count).astype(np.int64)
        transition = np.full((count, count), float(smoothing))
        consecutive = (rows[1:] == rows[:-1] + 1) & (codes[:-1] >= 0) & (codes[1:] >= 0)
        np.add.at(transition, (codes[:-1][consecutive], codes[1:][consecutive]), 1.0)
        totals = transition.sum(axis=1, keepdims=True)
        transition = np.where(totals > 0, transition / np.where(totals > 0, totals, 1.0), 1.0 / count)
        order = np.argsort(codes[usable], kind="stable")
        samples = np.column_stack([gap[usable], bar[usable], cost[usable]])[order]
        offsets = np.concatenate([[0], np.cumsum(counts)]).astype(np.int64)
        return cls(clusters, transition, gap_mean, bar_mean, cost_mean, counts, np.ascontiguousarray(samples), offsets)

    def reward(self) -> np.ndarray:
        """R[c, p, a]: the expected step reward of moving from position p to a in cluster c."""
        previous = POSITIONS[None, :, None]
        action = POSITIONS[None, None, :]
        return (previous * self.gap_mean[:, None, None] + action * self.bar_mean[:, None, None]
                - np.abs(action - previous) * self.cost_mean[:, None, None] / 2.0)

    def liquidation(self) -> np.ndarray:
        """(C, 3): the value of closing position p in cluster c at the horizon."""
        return -np.abs(POSITIONS)[None, :] * self.cost_mean[:, None] / 2.0

    def to_arrays(self, prefix: str = "market_") -> dict[str, np.ndarray]:
        return {f"{prefix}centers": self.clusters.centers, f"{prefix}columns": np.asarray(self.clusters.columns),
                f"{prefix}transition": self.transition, f"{prefix}gap_mean": self.gap_mean,
                f"{prefix}bar_mean": self.bar_mean, f"{prefix}cost_mean": self.cost_mean,
                f"{prefix}counts": self.counts, f"{prefix}samples": self.samples, f"{prefix}offsets": self.offsets}

    @classmethod
    def from_arrays(cls, arrays: dict[str, np.ndarray], prefix: str = "market_") -> ClusterMarketModel:
        clusters = ClusterStates(np.asarray(arrays[f"{prefix}centers"], dtype=np.float64),
                                 [int(column) for column in arrays[f"{prefix}columns"]])
        return cls(clusters, arrays[f"{prefix}transition"], arrays[f"{prefix}gap_mean"], arrays[f"{prefix}bar_mean"],
                   arrays[f"{prefix}cost_mean"], arrays[f"{prefix}counts"],
                   np.ascontiguousarray(arrays[f"{prefix}samples"], dtype=np.float64),
                   arrays[f"{prefix}offsets"].astype(np.int64))


# ─── dynamic programming ──────────────────────────────────────────────────


def backward_induction(reward: np.ndarray, transition: np.ndarray, terminal: np.ndarray, horizon: int,
                       discount: float) -> np.ndarray:
    """Q_0[c, p, a] of the finite-horizon problem: V_H = ``terminal`` (C, 3),
    Q_t[c, p, a] = R[c, p, a] + discount * sum_c' P[c, c'] V_{t+1}[c', a],
    V_t = max_a Q_t."""
    value = np.asarray(terminal, dtype=np.float64)
    quality = np.asarray(reward, dtype=np.float64).copy()
    for _ in range(int(horizon)):
        continuation = transition @ value                         # (C, 3): E[V(c', a) | c]
        quality = reward + discount * continuation[:, None, :]
        value = quality.max(axis=2)
    return quality


def value_iteration(reward: np.ndarray, transition: np.ndarray, discount: float, tolerance: float,
                    iteration_limit: int) -> tuple[np.ndarray, int, float]:
    """Q* of the discounted infinite-horizon problem, iterated until the value
    moves less than ``tolerance``; returns (Q, iterations, last change)."""
    count = reward.shape[0]
    value = np.zeros((count, 3))
    quality = reward.copy()
    change = math.inf
    iterations = 0
    for iterations in range(1, int(iteration_limit) + 1):
        quality = reward + discount * (transition @ value)[:, None, :]
        updated = quality.max(axis=2)
        change = float(np.max(np.abs(updated - value)))
        value = updated
        if change < tolerance:
            break
    return quality, iterations, change


def flat_score(quality: np.ndarray) -> np.ndarray:
    """(C,) Q(c, flat, long) - Q(c, flat, short)."""
    return quality[:, FLAT, LONG] - quality[:, FLAT, SHORT]


# ─── Monte Carlo tree search ──────────────────────────────────────────────


@njit(cache=True)
def _sample_step(cluster, previous, action, samples, offsets, cost_mean):
    start = offsets[cluster]
    stop = offsets[cluster + 1]
    before = -1.0 + previous
    after = -1.0 + action
    if stop > start:
        pick = start + np.random.randint(stop - start)
        return before * samples[pick, 0] + after * samples[pick, 1] - abs(after - before) * samples[pick, 2] / 2.0
    return -abs(after - before) * cost_mean[cluster] / 2.0


@njit(cache=True)
def _next_cluster(cluster, cumulative):
    draw = np.random.random()
    count = cumulative.shape[1]
    for candidate in range(count):
        if draw < cumulative[cluster, candidate]:
            return candidate
    return count - 1


@njit(cache=True)
def uct_root_values(root_cluster, cumulative, samples, offsets, cost_mean, horizon, discount, simulation_count,
                    exploration, seed):
    """UCT from (root cluster, flat) over position sequences of ``horizon``
    steps. Returns the root's mean return per action (short, flat, long) and
    its visit counts. Nodes are keyed by (depth, cluster, position), so every
    visit to a state shares its statistics (UCT with transpositions).
    The root spreads the simulations evenly over its three actions, so the
    long and the short value (the two sides of the score) are estimated with
    the same effort; below the root, selection is canonical UCB1 on returns
    normalised to [0, 1] by the smallest and largest return the search has
    backed up so far (the MuZero normalisation): mean + exploration *
    sqrt(ln N / n)."""
    np.random.seed(seed)
    lowest = 1e300
    highest = -1e300
    count = cumulative.shape[0]
    node_visits = np.zeros((horizon, count, 3), dtype=np.int64)
    action_visits = np.zeros((horizon, count, 3, 3), dtype=np.int64)
    action_totals = np.zeros((horizon, count, 3, 3), dtype=np.float64)
    path_cluster = np.zeros(horizon, dtype=np.int64)
    path_position = np.zeros(horizon, dtype=np.int64)
    path_action = np.zeros(horizon, dtype=np.int64)
    rewards = np.zeros(horizon, dtype=np.float64)
    for simulation in range(simulation_count):
        cluster = root_cluster
        position = 1
        tree_depth = 0
        depth = 0
        in_tree = True
        while depth < horizon:
            if in_tree and depth == 0:
                chosen = simulation % 3             # the root spreads its budget evenly: both sides of the score
                if action_visits[0, cluster, position, chosen] == 0:
                    in_tree = False                 # first visit of this root action: a rollout follows
                path_cluster[0] = cluster
                path_position[0] = position
                path_action[0] = chosen
                tree_depth = 1
            elif in_tree:
                untried = 0
                for action in range(3):
                    if action_visits[depth, cluster, position, action] == 0:
                        untried += 1
                if untried > 0:
                    pick = np.random.randint(untried)
                    chosen = 0
                    for action in range(3):
                        if action_visits[depth, cluster, position, action] == 0:
                            if pick == 0:
                                chosen = action
                                break
                            pick -= 1
                    in_tree = False              # expansion: this action is new, a rollout follows
                else:
                    best = -1e300
                    chosen = 0
                    logarithm = math.log(node_visits[depth, cluster, position])
                    spread = highest - lowest
                    for action in range(3):
                        visits = action_visits[depth, cluster, position, action]
                        mean = action_totals[depth, cluster, position, action] / visits
                        normalised = (mean - lowest) / spread if spread > 0 else 0.5
                        score = normalised + exploration * math.sqrt(logarithm / visits)
                        if score > best:
                            best = score
                            chosen = action
                path_cluster[depth] = cluster
                path_position[depth] = position
                path_action[depth] = chosen
                tree_depth = depth + 1
            else:
                chosen = np.random.randint(3)    # the random rollout policy
            rewards[depth] = _sample_step(cluster, position, chosen, samples, offsets, cost_mean)
            position = chosen
            cluster = _next_cluster(cluster, cumulative)
            depth += 1
        future = -abs(-1.0 + position) * cost_mean[cluster] / 2.0      # liquidation at the horizon
        for step in range(horizon - 1, -1, -1):
            future = rewards[step] + discount * future
            if step < tree_depth:
                if future < lowest:
                    lowest = future
                if future > highest:
                    highest = future
                node_visits[step, path_cluster[step], path_position[step]] += 1
                action_visits[step, path_cluster[step], path_position[step], path_action[step]] += 1
                action_totals[step, path_cluster[step], path_position[step], path_action[step]] += future
    values = np.zeros(3)
    visits = np.zeros(3, dtype=np.int64)
    for action in range(3):
        visits[action] = action_visits[0, root_cluster, 1, action]
        if visits[action] > 0:
            values[action] = action_totals[0, root_cluster, 1, action] / visits[action]
    return values, visits


def row_seed(seed: int, row: int) -> int:
    """A 32-bit stream seed that depends only on (seed, row): a row scored alone
    or in a batch draws the same numbers."""
    return int(np.random.SeedSequence([int(seed) & 0xFFFFFFFF, int(row)]).generate_state(1)[0])


def tree_search_scores(model: ClusterMarketModel, codes: np.ndarray, rows: np.ndarray, *, horizon: int,
                       discount: float, simulation_count: int, exploration_constant: float, seed: int) -> np.ndarray:
    """Root Q(long) - Q(short) per row (NaN where the cluster is unknown)."""
    cumulative = np.cumsum(model.transition, axis=1)
    cumulative[:, -1] = 1.0
    out = np.full(np.asarray(rows).shape, np.nan)
    for position, (code, row) in enumerate(zip(np.asarray(codes), np.asarray(rows))):
        if code < 0:
            continue
        values, _ = uct_root_values(int(code), cumulative, model.samples, model.offsets, model.cost_mean,
                                    int(horizon), float(discount), int(simulation_count),
                                    float(exploration_constant), row_seed(seed, int(row)))
        out[position] = values[LONG] - values[SHORT]
    return out


# ─── the zero-sum game ────────────────────────────────────────────────────


def solve_zero_sum(payoff: np.ndarray) -> tuple[np.ndarray, float]:
    """The row player's minimax mixed strategy and the game value:
    max_p min_j sum_i p_i M[i, j], as the linear program
    max v s.t. M^T p >= v, sum p = 1, p >= 0 (scipy HiGHS)."""
    from scipy.optimize import linprog

    payoff = np.asarray(payoff, dtype=np.float64)
    rows, columns = payoff.shape
    objective = np.zeros(rows + 1)
    objective[-1] = -1.0
    inequality = np.hstack([-payoff.T, np.ones((columns, 1))])
    equality = np.hstack([np.ones((1, rows)), np.zeros((1, 1))])
    result = linprog(objective, A_ub=inequality, b_ub=np.zeros(columns), A_eq=equality, b_eq=np.array([1.0]),
                     bounds=[(0.0, 1.0)] * rows + [(None, None)], method="highs")
    if not result.success:
        raise RuntimeError(f"the minimax linear program failed: {result.message}")
    strategy = np.clip(np.asarray(result.x[:-1], dtype=np.float64), 0.0, 1.0)
    strategy /= strategy.sum()
    return strategy, float(result.x[-1])


def market_strategies(frequencies: np.ndarray, radius: float) -> np.ndarray:
    """(S, K) the adversarial market's pure strategies: the empirical outcome
    distribution itself, and every move of ``radius`` probability mass (or what
    the bin holds) from one outcome bin to another. Their convex hull lies in
    the total-variation ball of ``radius`` around the empirical distribution."""
    frequencies = np.asarray(frequencies, dtype=np.float64)
    count = frequencies.size
    strategies = [frequencies.copy()]
    if radius > 0:
        for source in range(count):
            moved = min(float(radius), float(frequencies[source]))
            if moved <= 0:
                continue
            for destination in range(count):
                if destination == source:
                    continue
                distorted = frequencies.copy()
                distorted[source] -= moved
                distorted[destination] += moved
                strategies.append(distorted)
    return np.asarray(strategies)


def robust_game(outcome_means: np.ndarray, frequencies: np.ndarray, cost: float, radius: float
                ) -> tuple[np.ndarray, float]:
    """The trader's equilibrium over positions (short, flat, long) against a
    market that picks the outcome distribution within ``radius`` of the
    empirical one: payoff[k, s] = pos_k * E_s[outcome] - |pos_k| * cost."""
    strategies = market_strategies(frequencies, radius)
    expected = strategies @ np.asarray(outcome_means, dtype=np.float64)            # (S,)
    payoff = POSITIONS[:, None] * expected[None, :] - np.abs(POSITIONS)[:, None] * float(cost)
    return solve_zero_sum(payoff)


# ─── expected utility ─────────────────────────────────────────────────────

UTILITY_FORMS = ("crra", "cara", "prospect")


def _probability_weight(probability: np.ndarray, curvature: float) -> np.ndarray:
    """Tversky-Kahneman (1992) weighting w(p) = p^d / (p^d + (1-p)^d)^(1/d)."""
    probability = np.clip(np.asarray(probability, dtype=np.float64), 0.0, 1.0)
    powered = probability ** curvature
    return powered / (powered + (1.0 - probability) ** curvature) ** (1.0 / curvature)


def prospect_value(outcomes: np.ndarray, *, loss_aversion: float, value_curvature: float,
                   probability_weighting: float) -> float:
    """Cumulative prospect theory value of equally likely ``outcomes``
    (reference point 0): rank-dependent decision weights on gains and losses,
    v(x) = x^a for gains and -loss_aversion * (-x)^a for losses."""
    outcomes = np.sort(np.asarray(outcomes, dtype=np.float64))
    count = outcomes.size
    if count == 0:
        return 0.0
    total = 0.0
    gains = outcomes[outcomes > 0][::-1]                 # best first
    if gains.size:
        exceed = np.arange(0, gains.size + 1) / count     # P(X >= the i-th best gain) steps
        weights = np.diff(_probability_weight(exceed, probability_weighting))
        total += float(np.sum(weights * gains ** value_curvature))
    losses = outcomes[outcomes < 0]                      # worst first
    if losses.size:
        below = np.arange(0, losses.size + 1) / count
        weights = np.diff(_probability_weight(below, probability_weighting))
        total -= float(loss_aversion) * float(np.sum(weights * (-losses) ** value_curvature))
    return total


def expected_utility(outcomes: np.ndarray, costs: np.ndarray, position: float, *, form: str, risk_aversion: float,
                     exposure_fraction: float, loss_aversion: float, value_curvature: float,
                     probability_weighting: float) -> float:
    """The utility of holding ``position`` over a lottery of scaled h-bar
    outcomes net of cost (-inf where a CRRA wealth would not be positive)."""
    result = position * outcomes - abs(position) * costs
    if form == "prospect":
        return prospect_value(result, loss_aversion=loss_aversion, value_curvature=value_curvature,
                              probability_weighting=probability_weighting)
    wealth = 1.0 + exposure_fraction * result
    if form == "cara":
        return float(-np.mean(np.exp(-risk_aversion * (wealth - 1.0))))
    if np.any(wealth <= 0):
        return -math.inf
    if abs(risk_aversion - 1.0) < 1e-12:
        return float(np.mean(np.log(wealth)))
    return float(np.mean(wealth ** (1.0 - risk_aversion) / (1.0 - risk_aversion)))


def expected_utility_position(outcomes: np.ndarray, costs: np.ndarray, *, grid: np.ndarray, **utility) -> tuple[float, float]:
    """(best position on ``grid``, its utility); ties go to the smallest |position|."""
    outcomes = np.asarray(outcomes, dtype=np.float64)
    costs = np.asarray(costs, dtype=np.float64)
    if outcomes.size < 2:
        return 0.0, 0.0
    best_position, best_value = 0.0, -math.inf
    for position in sorted(grid, key=lambda value: (abs(value), value)):
        value = expected_utility(outcomes, costs, float(position), **utility)
        if value > best_value + 1e-15:
            best_position, best_value = float(position), value
    return best_position, float(best_value)


__all__ = ["ClusterMarketModel", "FLAT", "LONG", "POSITIONS", "SHORT", "UTILITY_FORMS", "backward_induction",
           "expected_utility", "expected_utility_position", "flat_score", "market_strategies", "prospect_value",
           "robust_game", "row_seed", "solve_zero_sum", "step_pieces", "tree_search_scores",
           "uct_root_values", "value_iteration"]
