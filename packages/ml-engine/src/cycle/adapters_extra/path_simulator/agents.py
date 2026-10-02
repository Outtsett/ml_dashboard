"""Agent-based modeling and multi-agent simulation.

Both simulate a market of trading agents forward from bar t; prices are in
the bar's move-scale units relative to its close (X_t = 0), and every agent
reads only bars <= t plus the simulated path.

``AgentBasedModel`` (variant ``agent_based``) - rule-based heterogeneous
agents calibrated by the method of simulated moments:

- trend followers, each with its own lookback L_a (uniform on
  3..``trend_follower_lookback_bars``) and sensitivity k_a (log-normal):
  demand tanh(k_a (X_s - X_{s-L_a}) sqrt(h / L_a));
- mean reverters, each with its own window W_a (5..``mean_reversion_window_bars``):
  demand -tanh(k_a (X_s - mean of the last W_a) sqrt(h / W_a));
- informed traders reading the training span's ridge index u_t of the
  features (standardised), each with its own fixed private bias:
  demand tanh(k_a (u_t + bias_a));
- noise traders: independent unit-variance demand every bar;
- a liquidity provider absorbs the net demand D and works its inventory off:
  a share ``liquidity_inventory_aversion`` of the accumulated impact reverts
  every bar.

  One bar's move: lambda (p_T D_T + p_R D_R + p_I D_I + p_N D_N) + sigma
  e / sqrt(h) - aversion * (impact accumulated so far), e a unit-variance
  Student-t. The impact lambda, the four type proportions p (a softmax), sigma
  and the tail's degrees of freedom are calibrated by CMA-ES (``cma``, seeded)
  on the training span: the simulated one-bar moves from every training bar's
  observed state (common random numbers) must match the observed mean,
  deviation, excess kurtosis and the correlations of the next move with the
  momentum, the stretch and the informed index.

``MultiAgentSimulation`` (variant ``multi_agent``) - learning agents: four
independent tabular Q-learners (market maker, trend follower, mean reverter,
informed trader), actions flat / long / short. Each observes a train-quantile
bin of its own signal (the market maker: the others' net position). They are
trained on the training span's replayed one-bar moves plus the price impact of
their own order flow (``impact_coefficient`` per contract), rewarded with
their marked-to-market P&L net of half the round-trip cost per contract
traded, in parallel episodes of ``episode_length_bars`` bars. The link from
their greedy net position to the next bar's move is then estimated on the
training span (least squares), and at bar t their greedy policies trade along
``path_count`` simulated paths: each bar's move is that link applied to the
agents' net position plus a residual resampled from the training span, and
the trend follower and mean reverter re-read the simulated prices.

The raw score is the logit of the share of paths that end above X_t = 0; the
price forecast is the mean path end.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

from .common import (
    RidgeIndex,
    Simulated,
    Simulator,
    correlation,
    excess_kurtosis,
    fit_generator,
    history_closes,
    logit_share,
    row_generator,
    rows_of,
    scaled_steps,
    share_up,
    usable_training_rows,
)

ABM_EPOCHS = 10
MAS_EPOCHS = 10
ACTIONS = np.array([0.0, 1.0, -1.0])        # flat first, so an untried state's tie goes to flat
ROLES = ("market_maker", "trend_follower", "mean_reverter", "informed_trader")


def momentum(paths: np.ndarray, lookbacks: np.ndarray, horizon: int) -> np.ndarray:
    """(paths, agents): each agent's normalised momentum over its lookback; the last column is now."""
    last = paths.shape[1] - 1
    earlier = paths[:, last - lookbacks]
    return (paths[:, last:last + 1] - earlier) * np.sqrt(horizon / lookbacks)[None, :]


def stretch(paths: np.ndarray, windows_: np.ndarray, horizon: int) -> np.ndarray:
    """(paths, agents): each agent's normalised distance of now from its moving average."""
    cumulative = np.concatenate([np.zeros((paths.shape[0], 1)), np.cumsum(paths, axis=1)], axis=1)
    end = cumulative.shape[1] - 1
    averages = (cumulative[:, end:end + 1] - cumulative[:, end - windows_]) / windows_[None, :]
    return (paths[:, -1:] - averages) * np.sqrt(horizon / windows_)[None, :]


class _InformedIndex:
    """The ridge index of the features on the price target, standardised on the training span."""

    def __init__(self, index: RidgeIndex, deviation: float) -> None:
        self.index = index
        self.deviation = deviation

    @classmethod
    def fit(cls, features, view, rows, penalty: float) -> _InformedIndex:
        target = np.full(len(view), np.nan)
        target[rows] = np.asarray(view.price_targets, dtype=np.float64)[rows]
        index = RidgeIndex.fit(features, rows, target, penalty)
        deviation = float(np.std(index.apply(features, rows)))
        return cls(index, deviation if deviation > 1e-12 else 1.0)

    def apply(self, features, rows) -> np.ndarray:
        return (self.index.apply(features, rows) - self.index.intercept) / self.deviation

    def arrays(self) -> dict:
        return {**self.index.arrays("informed"), "informed_deviation": np.array([self.deviation])}

    @classmethod
    def from_arrays(cls, arrays) -> _InformedIndex:
        return cls(RidgeIndex.from_arrays(arrays, "informed"), float(arrays["informed_deviation"][0]))


def _next_steps(view, rows: np.ndarray) -> np.ndarray:
    """The scaled one-bar step after each training row (row + 1 <= train end + 1: inside the purge)."""
    steps = scaled_steps(view)
    following = np.full(rows.size, np.nan)
    inside = rows + 1 < steps.shape[0]
    following[inside] = steps[rows[inside] + 1]
    return following


# ═══ agent-based model ══════════════════════════════════════════════════════


class AgentBasedModel(Simulator):
    variant = "agent_based"
    step_unit = "epoch"
    libraries = ("cma",)

    @classmethod
    def _longest(cls, parameters: dict) -> int:
        return max(int(parameters["trend_follower_lookback_bars"]), int(parameters["mean_reversion_window_bars"]))

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return cls._longest(parameters) + 1

    def _population(self) -> None:
        p = self.parameters
        generator = fit_generator(self.seed, 5)
        count = int(p["agent_population_size"])
        self.trend_lookbacks = generator.integers(3, max(4, int(p["trend_follower_lookback_bars"])) + 1, size=count)
        self.reversion_windows = generator.integers(5, max(6, int(p["mean_reversion_window_bars"])) + 1, size=count)
        self.trend_sensitivity = np.exp(0.5 * generator.standard_normal(count))
        self.reversion_sensitivity = np.exp(0.5 * generator.standard_normal(count))
        self.informed_sensitivity = np.exp(0.5 * generator.standard_normal(count))
        self.informed_bias = 0.5 * generator.standard_normal(count)

    def _demands(self, features, view, rows) -> dict:
        """Each type's mean demand at the observed state of each row, (rows,)."""
        longest = self._longest(self.parameters)
        paths = history_closes(view, rows, longest + 1)
        trend = np.tanh(self.trend_sensitivity[None, :] * momentum(paths, self.trend_lookbacks, self.horizon)).mean(axis=1)
        reversion = -np.tanh(self.reversion_sensitivity[None, :]
                             * stretch(paths, self.reversion_windows, self.horizon)).mean(axis=1)
        informed = self._informed_demand(self.informed.apply(features, rows))
        return {"trend": trend, "reversion": reversion, "informed": informed}

    def _informed_demand(self, signal: np.ndarray) -> np.ndarray:
        return np.tanh(self.informed_sensitivity[None, :] * (signal[:, None] + self.informed_bias[None, :])).mean(axis=1)

    @staticmethod
    def _decode(theta: np.ndarray) -> dict:
        logits = np.append(theta[1:4], 0.0)
        proportions = np.exp(logits - logits.max())
        proportions /= proportions.sum()
        return {"impact": float(math.exp(theta[0])), "proportions": proportions,
                "noise_scale": float(math.exp(theta[4])), "tail": float(2.05 + math.exp(theta[5]))}

    def prepare(self, context) -> None:
        import cma

        p = self.parameters
        view, features = context.view, context.features
        rows = usable_training_rows(view, features, context.train_index, int(p["maximum_training_bars"]))
        rows = rows[rows >= self._longest(p)]
        following = _next_steps(view, rows)
        keep = np.isfinite(following)
        rows, following = rows[keep], following[keep]
        if rows.size < 100:
            raise ValueError(f"agent_based: only {rows.size} training bars with a known next move; need 100")
        self._population()
        self.informed = _InformedIndex.fit(features, view, rows, float(p["factor_ridge_penalty"]))
        demands = self._demands(features, view, rows)
        agents = int(p["agent_population_size"])
        generator = fit_generator(self.seed, 6)
        self.noise_demand = generator.standard_normal(rows.size) / math.sqrt(agents)
        self.noise_uniform = np.clip(generator.random(rows.size), 1e-9, 1 - 1e-9)
        self.demand_matrix = np.column_stack([demands["trend"], demands["reversion"], demands["informed"], self.noise_demand])
        paths = history_closes(view, rows, self._longest(p) + 1)
        middle = np.array([max(3, int(p["trend_follower_lookback_bars"]) // 2)])
        self.signal_momentum = momentum(paths, middle, self.horizon)[:, 0]
        self.signal_stretch = stretch(paths, np.array([max(5, int(p["mean_reversion_window_bars"]) // 2)]), self.horizon)[:, 0]
        self.signal_informed = self.informed.apply(features, rows)
        self.observed = self._moments(following)
        count = rows.size
        deviation = max(self.observed[1], 1e-9)
        self.standard_errors = np.array([deviation / math.sqrt(count), deviation / math.sqrt(2 * count),
                                         math.sqrt(24.0 / count) + 0.05 * abs(self.observed[2]),
                                         1 / math.sqrt(count), 1 / math.sqrt(count), 1 / math.sqrt(count)])
        start = np.array([math.log(0.2 * deviation * math.sqrt(self.horizon) + 1e-9), 0.0, 0.0, 0.0,
                          math.log(deviation * math.sqrt(self.horizon) + 1e-9), math.log(3.0)])
        # cma draws from (and its seed option reseeds) numpy's GLOBAL random state; keep its stream in its own
        # saved state so the calibration is reproducible and the rest of the process never sees it
        caller_state = np.random.get_state()
        try:
            self.strategy = cma.CMAEvolutionStrategy(start, 1.0, {
                "seed": int(self.seed % (2 ** 31 - 1)) + 1, "popsize": int(p["population_size"]), "verbose": -9,
                "verb_log": 0, "verb_disp": 0, "bounds": [[-12, -6, -6, -6, -12, -3], [3, 6, 6, 6, 3, 4]],
            })
            self.strategy_random_state = np.random.get_state()
        finally:
            np.random.set_state(caller_state)
        self.generations = int(p["iteration_count"])
        self.generation = 0
        self.rows = rows

    def _moments(self, moves: np.ndarray) -> np.ndarray:
        return np.array([float(np.mean(moves)), float(np.std(moves)), excess_kurtosis(moves),
                         correlation(moves, self.signal_momentum), correlation(moves, self.signal_stretch),
                         correlation(moves, self.signal_informed)])

    def _one_step(self, theta: np.ndarray) -> np.ndarray:
        decoded = self._decode(theta)
        tail = decoded["tail"]
        shock = stats.t.ppf(self.noise_uniform, tail) * math.sqrt((tail - 2.0) / tail)
        return decoded["impact"] * (self.demand_matrix @ decoded["proportions"]) + decoded["noise_scale"] * shock / math.sqrt(self.horizon)

    def distance(self, theta: np.ndarray) -> float:
        simulated = self._moments(self._one_step(np.asarray(theta, dtype=np.float64)))
        return float(np.sum(((simulated - self.observed) / self.standard_errors) ** 2))

    def epoch_count(self) -> int:
        return ABM_EPOCHS

    def train_epoch(self, epoch, report_batch, context) -> float | None:
        end = int(round(self.generations * epoch / ABM_EPOCHS))
        while self.generation < end:
            caller_state = np.random.get_state()
            np.random.set_state(self.strategy_random_state)
            try:
                candidates = self.strategy.ask()
                self.strategy.tell(candidates, [self.distance(candidate) for candidate in candidates])
                self.strategy_random_state = np.random.get_state()
            finally:
                np.random.set_state(caller_state)
            self.generation += 1
        report_batch(1, 1, int(self.rows[0]), int(self.rows[-1]), float(self.strategy.result.fbest))
        return float(self.strategy.result.fbest)

    def finish(self, context) -> None:
        self.theta = np.asarray(self.strategy.result.xbest, dtype=np.float64)
        self.calibration_distance = float(self.strategy.result.fbest)
        decoded = self._decode(self.theta)
        simulated = self._moments(self._one_step(self.theta))
        names = ("mean", "deviation", "excess kurtosis", "corr momentum", "corr stretch", "corr informed")
        context.reporter.log("agent_based: impact {:.4f}, proportions trend {:.2f} reversion {:.2f} informed {:.2f} "
                             "noise {:.2f}, tail {:.1f}; moments observed/simulated ".format(
                                 decoded["impact"], *decoded["proportions"], decoded["tail"])
                             + ", ".join(f"{name} {a:.3f}/{b:.3f}" for name, a, b in zip(names, self.observed, simulated)))
        for name in ("strategy", "strategy_random_state", "demand_matrix", "noise_demand", "noise_uniform", "signal_momentum", "signal_stretch",
                     "signal_informed"):
            delattr(self, name)

    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        count = rows.size
        score, mean_move, share = np.full(count, np.nan), np.full(count, np.nan), np.full(count, np.nan)
        if not count:
            return Simulated(score, mean_move, share)
        longest = self._longest(self.parameters)
        finite = np.all(np.isfinite(features[rows]), axis=1) & np.isfinite(np.asarray(view.move_scale)[rows])
        finite &= rows >= longest
        if not finite.any():
            return Simulated(score, mean_move, share)
        decoded = self._decode(self.theta)
        impact, proportions = decoded["impact"], decoded["proportions"]
        tail, noise_scale = decoded["tail"], decoded["noise_scale"]
        aversion = float(self.parameters["liquidity_inventory_aversion"])
        agents = self.trend_lookbacks.size
        histories = history_closes(view, rows[finite], longest + 1)
        informed = self._informed_demand(self.informed.apply(features, rows[finite]))
        paths = self.path_count
        tail_scale = math.sqrt((tail - 2.0) / tail) / math.sqrt(self.horizon)
        for position, where in enumerate(np.flatnonzero(finite)):
            generator = row_generator(self.seed, int(rows[where]))
            noise_demand = generator.standard_normal((paths, self.horizon)) / math.sqrt(agents)
            shocks = generator.standard_t(tail, (paths, self.horizon)) * tail_scale
            prices = np.repeat(histories[position][None, :], paths, axis=0)
            accumulated = np.zeros(paths)
            for step in range(self.horizon):
                trend = np.tanh(self.trend_sensitivity[None, :] * momentum(prices, self.trend_lookbacks, self.horizon)).mean(axis=1)
                reversion = -np.tanh(self.reversion_sensitivity[None, :]
                                     * stretch(prices, self.reversion_windows, self.horizon)).mean(axis=1)
                demand = (proportions[0] * trend + proportions[1] * reversion + proportions[2] * informed[position]
                          + proportions[3] * noise_demand[:, step])
                pushed = impact * demand
                move = pushed + noise_scale * shocks[:, step] - aversion * accumulated
                accumulated = accumulated * (1.0 - aversion) + pushed
                prices = np.concatenate([prices, (prices[:, -1] + move)[:, None]], axis=1)
            moves = prices[:, -1]
            up = share_up(moves)
            share[where] = up
            score[where] = logit_share(np.array([up]), paths)[0]
            mean_move[where] = float(moves.mean())
        return Simulated(score, mean_move, share)

    def state(self) -> tuple[dict, dict]:
        arrays = {"theta": self.theta, "trend_lookbacks": self.trend_lookbacks, "reversion_windows": self.reversion_windows,
                  "trend_sensitivity": self.trend_sensitivity, "reversion_sensitivity": self.reversion_sensitivity,
                  "informed_sensitivity": self.informed_sensitivity, "informed_bias": self.informed_bias,
                  "observed_moments": self.observed, **self.informed.arrays()}
        return arrays, {"calibration_distance": self.calibration_distance}

    def restore(self, arrays, document) -> None:
        for name in ("theta", "trend_lookbacks", "reversion_windows", "trend_sensitivity", "reversion_sensitivity",
                     "informed_sensitivity", "informed_bias"):
            setattr(self, name, arrays[name])
        self.observed = arrays["observed_moments"]
        self.informed = _InformedIndex.from_arrays(arrays)
        self.calibration_distance = float(document["calibration_distance"])

    def summary(self) -> dict:
        decoded = self._decode(self.theta)
        return {"impact": decoded["impact"], "proportions": [float(v) for v in decoded["proportions"]],
                "noise_scale": decoded["noise_scale"], "tail_degrees_of_freedom": decoded["tail"],
                "calibration_distance": self.calibration_distance}


# ═══ multi-agent simulation ═════════════════════════════════════════════════


class MultiAgentSimulation(Simulator):
    variant = "multi_agent"
    step_unit = "epoch"

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return max(int(parameters["trend_follower_lookback_bars"]), int(parameters["mean_reversion_window_bars"])) + 2

    def _longest(self) -> int:
        return max(int(self.parameters["trend_follower_lookback_bars"]), int(self.parameters["mean_reversion_window_bars"]))

    def _signals(self, features, view, rows) -> np.ndarray:
        """(rows, 3): the trend follower's, mean reverter's and informed trader's raw signals at each row."""
        p = self.parameters
        paths = history_closes(view, rows, self._longest() + 1)
        return np.column_stack([
            momentum(paths, np.array([int(p["trend_follower_lookback_bars"])]), self.horizon)[:, 0],
            stretch(paths, np.array([int(p["mean_reversion_window_bars"])]), self.horizon)[:, 0],
            self.informed.apply(features, rows),
        ])

    def _bin(self, signals: np.ndarray) -> np.ndarray:
        """Train-quantile bin of each signal column (int, 0..bin_count-1)."""
        return np.column_stack([np.searchsorted(self.edges[j], signals[:, j], side="right") for j in range(signals.shape[1])])

    def _maker_state(self, others_net: np.ndarray) -> np.ndarray:
        return (np.clip(np.rint(others_net), -3, 3) + 3).astype(np.int64)

    def _greedy(self, table: np.ndarray, states: np.ndarray) -> np.ndarray:
        return ACTIONS[np.argmax(table[states], axis=-1)]

    def prepare(self, context) -> None:
        p = self.parameters
        view, features = context.view, context.features
        rows = view.fit_rows(context.train_index)
        rows = rows[rows >= self._longest() + 1]
        rows = rows[np.all(np.isfinite(features[rows]), axis=1) & np.isfinite(np.asarray(view.move_scale)[rows])]
        rows = rows[-int(p["maximum_training_bars"]):]
        following = _next_steps(view, rows)
        if np.isfinite(following).sum() < 100:
            raise ValueError("multi_agent: fewer than 100 training bars with a known next move")
        labelled = usable_training_rows(view, features, context.train_index, int(p["maximum_training_bars"]))
        self.informed = _InformedIndex.fit(features, view, labelled, float(p["factor_ridge_penalty"]))
        signals = self._signals(features, view, rows)
        bins = int(p["bin_count"])
        self.edges = [np.unique(np.quantile(signals[:, j], np.linspace(0, 1, bins + 1)[1:-1])) for j in range(3)]
        self.state_sizes = [7] + [edges.size + 1 for edges in self.edges]
        self.tables = [np.zeros((size, ACTIONS.size)) for size in self.state_sizes]
        self.observed_states = self._bin(signals)                              # (rows, 3)
        self.rows = rows
        self.following = np.nan_to_num(following, nan=0.0)                      # a gap step replays as no move
        scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
        self.cost = float(view.round_trip_cost_points) / 2.0 / scale             # per contract traded, move-scale units
        self.generator = fit_generator(self.seed, 7)
        self.episodes_done = 0

    def epoch_count(self) -> int:
        return MAS_EPOCHS

    def train_epoch(self, epoch, report_batch, context) -> float | None:
        p = self.parameters
        total = int(p["episode_count"])
        episodes = int(round(total * epoch / MAS_EPOCHS)) - int(round(total * (epoch - 1) / MAS_EPOCHS))
        if episodes <= 0:
            return None
        length = min(int(p["episode_length_bars"]), self.rows.size - 1)
        rate, discount = float(p["learning_rate"]), float(p["discount_factor"])
        exploration, impact = float(p["exploration_rate"]), float(p["impact_coefficient"])
        starts = self.generator.integers(0, self.rows.size - length, size=episodes)
        positions = np.zeros((episodes, 4))
        errors = []
        maker_state = np.full(episodes, 3, dtype=np.int64)
        for step in range(length):
            index = starts + step
            states = [maker_state, *(self.observed_states[index, j] for j in range(3))]
            chosen = np.empty((episodes, 4), dtype=np.int64)
            for agent in range(4):
                greedy = np.argmax(self.tables[agent][states[agent]], axis=1)
                explore = self.generator.random(episodes) < exploration
                chosen[:, agent] = np.where(explore, self.generator.integers(0, ACTIONS.size, size=episodes), greedy)
            new_positions = ACTIONS[chosen]
            flow = (new_positions - positions).sum(axis=1)
            move = self.following[index] + impact * flow
            rewards = new_positions * move[:, None] - self.cost[index][:, None] * np.abs(new_positions - positions)
            next_maker = self._maker_state(new_positions[:, 1:].sum(axis=1))
            next_index = np.minimum(index + 1, self.rows.size - 1)
            next_states = [next_maker, *(self.observed_states[next_index, j] for j in range(3))]
            terminal = step == length - 1
            for agent in range(4):
                table = self.tables[agent]
                bootstrap = 0.0 if terminal else discount * table[next_states[agent]].max(axis=1)
                error = rewards[:, agent] + bootstrap - table[states[agent], chosen[:, agent]]
                sums = np.zeros_like(table)
                counts = np.zeros_like(table)
                np.add.at(sums, (states[agent], chosen[:, agent]), error)
                np.add.at(counts, (states[agent], chosen[:, agent]), 1.0)
                visited = counts > 0
                table[visited] += rate * sums[visited] / counts[visited]
                errors.append(float(np.mean(np.abs(error))))
            positions = new_positions
            maker_state = next_maker
        self.episodes_done += episodes
        report_batch(1, 1, int(self.rows[0]), int(self.rows[-1]), float(np.mean(errors)))
        return float(np.mean(errors))

    def finish(self, context) -> None:
        """The link from the greedy agents' net position to the next bar's move, on the training span."""
        positions = self._policy_positions(self.observed_states)
        net = positions.sum(axis=1)
        known = np.isfinite(_next_steps(context.view, self.rows))
        design = np.column_stack([np.ones(int(known.sum())), net[known]])
        (self.link_intercept, self.link_slope), *_ = np.linalg.lstsq(design, self.following[known], rcond=None)
        self.link_intercept, self.link_slope = float(self.link_intercept), float(self.link_slope)
        self.residuals = self.following[known] - self.link_intercept - self.link_slope * net[known]
        context.reporter.log(f"multi_agent: {self.episodes_done} episodes; greedy net position -> next move slope "
                             f"{self.link_slope:.4f}; mean positions "
                             + ", ".join(f"{role} {value:.2f}" for role, value in zip(ROLES, positions.mean(axis=0))))
        for name in ("observed_states", "following", "cost", "generator"):
            delattr(self, name)

    def _policy_positions(self, observed_states: np.ndarray) -> np.ndarray:
        """(rows, 4) greedy positions along consecutive rows; the market maker reads the others' previous net."""
        others = np.column_stack([self._greedy(self.tables[agent + 1], observed_states[:, agent]) for agent in range(3)])
        previous = np.concatenate([[0.0], others.sum(axis=1)[:-1]])
        maker = self._greedy(self.tables[0], self._maker_state(previous))
        return np.column_stack([maker, others])

    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        count = rows.size
        score, mean_move, share = np.full(count, np.nan), np.full(count, np.nan), np.full(count, np.nan)
        if not count:
            return Simulated(score, mean_move, share)
        finite = (rows >= self._longest() + 1) & np.isfinite(np.asarray(view.move_scale)[rows])
        finite &= np.all(np.isfinite(features[rows]), axis=1) & np.all(np.isfinite(features[np.maximum(rows - 1, 0)]), axis=1)
        if not finite.any():
            return Simulated(score, mean_move, share)
        p = self.parameters
        selected = rows[finite]
        now_states = self._bin(self._signals(features, view, selected))
        before_states = self._bin(self._signals(features, view, selected - 1))
        previous_net = np.column_stack([self._greedy(self.tables[a + 1], before_states[:, a]) for a in range(3)]).sum(axis=1)
        histories = history_closes(view, selected, self._longest() + 1)
        trend_lookback = np.array([int(p["trend_follower_lookback_bars"])])
        reversion_window = np.array([int(p["mean_reversion_window_bars"])])
        paths = self.path_count
        for position, where in enumerate(np.flatnonzero(finite)):
            generator = row_generator(self.seed, int(rows[where]))
            draws = generator.integers(0, self.residuals.size, size=(paths, self.horizon))
            prices = np.repeat(histories[position][None, :], paths, axis=0)
            informed_state = np.full(paths, now_states[position, 2])
            trend_state = np.full(paths, now_states[position, 0])
            reversion_state = np.full(paths, now_states[position, 1])
            maker_state = np.full(paths, self._maker_state(np.array([previous_net[position]]))[0])
            for step in range(self.horizon):
                others = (self._greedy(self.tables[1], trend_state) + self._greedy(self.tables[2], reversion_state)
                          + self._greedy(self.tables[3], informed_state))
                net = self._greedy(self.tables[0], maker_state) + others
                move = self.link_intercept + self.link_slope * net + self.residuals[draws[:, step]]
                prices = np.concatenate([prices, (prices[:, -1] + move)[:, None]], axis=1)
                signals = np.column_stack([momentum(prices, trend_lookback, self.horizon)[:, 0],
                                           stretch(prices, reversion_window, self.horizon)[:, 0]])
                trend_state = np.searchsorted(self.edges[0], signals[:, 0], side="right")
                reversion_state = np.searchsorted(self.edges[1], signals[:, 1], side="right")
                maker_state = self._maker_state(others)
            moves = prices[:, -1]
            up = share_up(moves)
            share[where] = up
            score[where] = logit_share(np.array([up]), paths)[0]
            mean_move[where] = float(moves.mean())
        return Simulated(score, mean_move, share)

    def state(self) -> tuple[dict, dict]:
        arrays = {**{f"table_{i}": table for i, table in enumerate(self.tables)},
                  **{f"edges_{j}": edges for j, edges in enumerate(self.edges)},
                  "residuals": self.residuals, "link": np.array([self.link_intercept, self.link_slope]),
                  **self.informed.arrays()}
        return arrays, {"episodes": int(self.episodes_done)}

    def restore(self, arrays, document) -> None:
        self.tables = [arrays[f"table_{i}"] for i in range(4)]
        self.edges = [arrays[f"edges_{j}"] for j in range(3)]
        self.residuals = arrays["residuals"]
        self.link_intercept, self.link_slope = (float(v) for v in arrays["link"])
        self.informed = _InformedIndex.from_arrays(arrays)
        self.episodes_done = int(document["episodes"])

    def summary(self) -> dict:
        return {"episodes": int(self.episodes_done), "link_slope": self.link_slope, "link_intercept": self.link_intercept}
