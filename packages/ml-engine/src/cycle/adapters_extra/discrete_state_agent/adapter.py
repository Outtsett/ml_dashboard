"""``DiscreteStateAgentAdapter``: nine decision models over a discrete market state.

One adapter, nine mechanisms, picked by the registry entry's
``direction.fixed.variant``:

==========================  ===========================================================================
variant                     mechanism (module)
==========================  ===========================================================================
``q_learning``              tabular Q-learning on the reward tape, cell x position states (``table``)
``sarsa``                   the same loop with SARSA's on-policy bootstrap (``table``)
``dyna_q``                  Q-learning plus Dyna planning replays from a learned model (``table``)
``backward_induction``      finite-horizon dynamic programming on the cluster market model (``planners``)
``markov_decision_process`` value iteration of the discounted MDP counted from training bars (``planners``)
``tree_search``             UCT Monte Carlo tree search per bar on the cluster market model (``planners``)
``zero_sum_game``           minimax LP of the trader against an adversarial market, per cluster (``planners``)
``expected_utility``        the CRRA / CARA / prospect-theory optimal position per cluster (``planners``)
``markov_chain``            a higher-order chain of one-bar move buckets, h-step simulation (``chain``)
==========================  ===========================================================================

P(up): for every variant but the Markov chain, the model's own directional
score (a Q-value gap at the flat position, an equilibrium or optimal position)
through a Boltzmann share whose one parameter, the inverse temperature, is
fitted on the fold's VALIDATION rows (``bridges.calibration.TemperatureScale``:
never negative, so the sign is always the model's own). The Markov chain's
simulated up-share is its probability as it stands.

Price (``task="regression"``), where the registry gives one: the training-span
mean of the price target in the bar's state (feature-bin cell for the tabular
agents, k-means cluster for expected utility, the simulated mean cumulative
move for the chain).

Causality: fitting reads targets and the reward tape only through the training
span (``MarketView.fit_rows``, ``RewardTape.from_view`` with ``train_index``),
and validation labels only to fit the temperature and pick the epoch. A
prediction at bar t reads the feature row t (and, for the chain, closes and
move scales at rows <= t); tree search draws from a generator seeded by
(seed, row).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.binning import ClusterStates, FeatureBins, QuantileBins, conditional_means
from cycle.bridges.calibration import TemperatureScale
from cycle.bridges.tape import RewardTape
from cycle.bridges.training import run_epochs, score, single_fit

from . import chain as chain_module
from . import planners, table

TABULAR = ("q_learning", "sarsa", "dyna_q")
MARKET_PLANNERS = ("backward_induction", "markov_decision_process", "tree_search")
OUTCOME_PLANNERS = ("zero_sum_game", "expected_utility")
VARIANTS = (*TABULAR, *MARKET_PLANNERS, *OUTCOME_PLANNERS, "markov_chain")
PRICE_VARIANTS = (*TABULAR, "expected_utility", "markov_chain")
MINIMUM_CALIBRATION_ROWS = 20
STATE_FILE = "state.json"
POSITION_GRID = np.round(np.linspace(-1.0, 1.0, 41), 10)

DEFAULTS = {
    "bin_count": 4, "state_feature_count": 2, "learning_rate": 0.05, "discount_factor": 0.9, "epochs": 30,
    "patience": 8, "exploration_rate": 0.1, "planning_step_count": 5, "cluster_count": 12, "planning_horizon": 0,
    "additive_smoothing": 1.0, "iteration_count": 2000, "convergence_tolerance": 1e-9, "simulation_count": 400,
    "exploration_constant": 0.5, "outcome_bin_count": 6, "ambiguity_radius": 0.05, "utility_form": "crra",
    "risk_aversion": 3.0, "exposure_fraction": 0.2, "loss_aversion": 2.25, "value_curvature": 0.88,
    "probability_weighting": 0.65, "markov_order": 2, "path_count": 4000, "remove_training_drift": True,
}


class DiscreteStateAgentAdapter(BridgeAdapter):
    model_file = "model.npz"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: unknown discrete_state_agent variant {self.variant!r}; valid: {', '.join(VARIANTS)}")
        if task == "regression" and self.variant not in PRICE_VARIANTS:
            raise ValueError(f"{key}: the {self.variant} variant has no price model")
        self.step_unit = self._step_unit()
        self._clear()

    # ── helpers ──
    def _step_unit(self) -> str:
        return "epoch" if self.variant in TABULAR and self.task == "classification" else "single_fit"

    def _clear(self) -> None:
        self.arrays: dict[str, np.ndarray] = {}
        self.document: dict = {}
        self._bins: FeatureBins | None = None
        self._clusters: ClusterStates | None = None
        self._scale: TemperatureScale | None = None
        self._market_model: planners.ClusterMarketModel | None = None
        self._chain_bins = None

    def parameter(self, name: str):
        value = self.parameters.get(name)
        return DEFAULTS[name] if value is None else value

    def minimum_history(self) -> int:
        if self.variant == "markov_chain":
            return int(self.parameter("markov_order")) + 1       # x_t needs close[t-1]; the state needs k of them
        return 1

    def _log(self, reporter, message: str) -> None:
        reporter.log(f"{self.key}: {message}")

    def _calibrate(self, gap_validation, labels_validation, gap_train, labels_train, reporter) -> TemperatureScale:
        usable = np.isfinite(gap_validation) & np.isfinite(labels_validation)
        if int(usable.sum()) >= MINIMUM_CALIBRATION_ROWS:
            return TemperatureScale.fit(gap_validation, labels_validation)
        self._log(reporter, f"only {int(usable.sum())} validation rows; the temperature is fitted on training rows")
        return TemperatureScale.fit(gap_train, labels_train)

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        self._clear()
        labels = np.asarray(labels, dtype=np.float64)
        if self.task == "regression":
            self._fit_price(features, labels, train_index, validation_index, reporter)
        elif self.variant in TABULAR:
            self._fit_tabular(features, labels, train_index, validation_index, reporter)
        elif self.variant in MARKET_PLANNERS:
            self._fit_market_planner(features, labels, train_index, validation_index, reporter)
        elif self.variant in OUTCOME_PLANNERS:
            self._fit_outcome_planner(features, labels, train_index, validation_index, reporter)
        else:
            self._fit_chain(features, labels, train_index, validation_index, reporter)

    def _fit_tabular(self, features, labels, train_index, validation_index, reporter) -> None:
        view = self.require_market()
        tape = RewardTape.from_view(view, train_index)
        rows = view.fit_rows(train_index)
        long_reward = tape.position_reward(train_index, 1.0)
        columns = table.association_columns(features, train_index, long_reward, int(self.parameter("state_feature_count")))
        bins = FeatureBins.fit(features, train_index, int(self.parameter("bin_count")), columns)
        cells, following, rewards = table.transitions(bins.states(features, rows), rows, table.step_rewards(tape, rows))
        if cells.size == 0:
            raise ValueError(f"{self.key}: the training span has no bar with a known state and step reward")
        learner = table.TabularLearner(bins.state_count, self.variant, learning_rate=float(self.parameter("learning_rate")),
                                       discount=float(self.parameter("discount_factor")),
                                       exploration_rate=float(self.parameter("exploration_rate")),
                                       planning_step_count=int(self.parameter("planning_step_count")))
        epoch_count = int(self.parameter("epochs"))
        final_rate = float(self.parameter("exploration_rate"))
        anneal_epochs = max(1, math.ceil(epoch_count / 2))
        validation_cells = bins.states(features, validation_index)
        train_cells = bins.states(features, train_index)
        validation_labels = labels[validation_index]
        train_labels = labels[train_index]
        current: dict = {}
        self._log(reporter, f"{bins.state_count} market cells x 3 positions from columns {columns}, "
                            f"{cells.size} steps per sweep")

        def train_epoch(epoch, report_batch):
            reporter.checkpoint()
            rate = max(final_rate, 1.0 - (1.0 - final_rate) * (epoch - 1) / anneal_epochs)
            error = learner.sweep(cells, following, rewards, exploration_rate=rate,
                                  seed=planners.row_seed(self.seed, epoch))
            report_batch(1, 1, int(rows[0]), int(rows[-1]), error)
            return error

        def validate(epoch):
            gap = table.flat_gap(learner.values, validation_cells)
            scale = self._calibrate(gap, validation_labels, table.flat_gap(learner.values, train_cells), train_labels,
                                    reporter)
            current["scale"] = scale
            return score("classification", scale.apply(gap), validation_labels)

        def snapshot():
            return learner.values.copy(), current.get("scale")

        def restore(state):
            learner.values[...] = state[0]
            current["scale"] = state[1]

        summary = run_epochs(reporter, epoch_count=epoch_count, train_index=train_index, train_epoch=train_epoch,
                             validate=validate, snapshot=snapshot, restore=restore,
                             patience=int(self.parameter("patience")), name=self.key)
        self._bins = bins
        self._scale = current.get("scale") or TemperatureScale(0.0, 0)
        visited = np.any(learner.values != 0.0, axis=(1, 2))
        self.arrays = {"values": learner.values.copy()}
        self.document = {"bins": bins.to_dict(), "scale": self._scale.to_dict()}
        self.best_iteration = int(summary["best_epoch"])
        self.fit_summary = {"state_count": int(bins.state_count), "state_columns": [int(c) for c in columns],
                            "visited_state_share": float(visited.mean()), "trained_epochs": int(summary["trained_epochs"]),
                            "best_epoch": int(summary["best_epoch"]), "best_validation_loss": summary["best_validation_loss"],
                            "inverse_temperature": float(self._scale.inverse_temperature)}

    def _planner_columns(self, features, train_index, target) -> list[int]:
        return table.association_columns(features, train_index, target, int(self.parameter("state_feature_count")))

    def _fit_market_planner(self, features, labels, train_index, validation_index, reporter) -> None:
        view = self.require_market()
        tape = RewardTape.from_view(view, train_index)
        columns = self._planner_columns(features, train_index, tape.position_reward(train_index, 1.0))
        smoothing = float(self.parameter("additive_smoothing"))
        discount = float(self.parameter("discount_factor"))
        horizon = int(self.parameter("planning_horizon")) or int(view.horizon)
        result: dict = {}

        def fit():
            model = planners.ClusterMarketModel.fit(features, view, tape, train_index, columns,
                                                    int(self.parameter("cluster_count")), self.seed, smoothing)
            result["model"] = model
            if self.variant == "backward_induction":
                quality = planners.backward_induction(model.reward(), model.transition, model.liquidation(), horizon,
                                                      discount)
                result["score"] = planners.flat_score(quality)
                self._log(reporter, f"backward induction over {horizon} steps, {model.cluster_count} clusters x 3 positions")
            elif self.variant == "markov_decision_process":
                quality, iterations, change = planners.value_iteration(
                    model.reward(), model.transition, discount, float(self.parameter("convergence_tolerance")),
                    int(self.parameter("iteration_count")))
                result["score"] = planners.flat_score(quality)
                result["iterations"] = iterations
                self._log(reporter, f"value iteration converged in {iterations} sweeps (last change {change:.3g})")
            else:
                result["score"] = None
                self._log(reporter, f"tree search model: {model.cluster_count} clusters, horizon {horizon}, "
                                    f"{int(self.parameter('simulation_count'))} simulations per bar")
            return None

        def cluster_scores(model, rows):
            codes = model.clusters.assign(features, rows)
            if self.variant == "tree_search":
                return self._tree_scores(model, codes, rows, horizon)
            out = np.full(codes.shape, np.nan)
            out[codes >= 0] = result["score"][codes[codes >= 0]]
            return out

        def validate():
            model = result["model"]
            gap = cluster_scores(model, validation_index)
            train_gap = cluster_scores(model, train_index) if np.sum(np.isfinite(gap)) < MINIMUM_CALIBRATION_ROWS \
                else np.full(train_index.shape, np.nan)
            scale = self._calibrate(gap, labels[validation_index], train_gap, labels[train_index], reporter)
            result["scale"] = scale
            return score("classification", scale.apply(gap), labels[validation_index])

        summary = single_fit(reporter, train_index=train_index, fit=fit, validate=validate, name=self.key)
        model = result["model"]
        self._market_model = model
        self._clusters = model.clusters
        self._scale = result["scale"]
        self.arrays = model.to_arrays()
        if result["score"] is not None:
            self.arrays["score"] = np.asarray(result["score"], dtype=np.float64)
        self.document = {"scale": self._scale.to_dict(), "horizon": horizon}
        self.fit_summary = {"cluster_count": int(model.cluster_count), "state_columns": [int(c) for c in columns],
                            "planning_horizon": int(horizon), "best_validation_loss": summary["best_validation_loss"],
                            "inverse_temperature": float(self._scale.inverse_temperature)}
        if "iterations" in result:
            self.fit_summary["value_iteration_sweeps"] = int(result["iterations"])

    def _tree_scores(self, model, codes, rows, horizon) -> np.ndarray:
        return planners.tree_search_scores(model, codes, rows, horizon=int(horizon),
                                           discount=float(self.parameter("discount_factor")),
                                           simulation_count=int(self.parameter("simulation_count")),
                                           exploration_constant=float(self.parameter("exploration_constant")),
                                           seed=self.seed)

    def _outcomes(self, view, train_index):
        """Training-span rows with a known outcome: (rows, scaled h-bar move, scaled round-trip cost)."""
        rows = view.fit_rows(train_index)
        outcome = np.asarray(view.price_targets, dtype=np.float64)[rows]
        with np.errstate(invalid="ignore", divide="ignore"):
            cost = float(view.round_trip_cost_points) / np.asarray(view.move_scale, dtype=np.float64)[rows]
        keep = np.isfinite(outcome) & np.isfinite(cost)
        return rows[keep], outcome[keep], cost[keep]

    def _fit_outcome_planner(self, features, labels, train_index, validation_index, reporter) -> None:
        view = self.require_market()
        rows, outcome, cost = self._outcomes(view, train_index)
        target = np.full(features.shape[0], np.nan)
        target[rows] = outcome
        columns = self._planner_columns(features, train_index, target[train_index])
        smoothing = float(self.parameter("additive_smoothing"))
        result: dict = {}

        def fit():
            clusters = ClusterStates.fit(features, train_index, int(self.parameter("cluster_count")), self.seed,
                                         columns=columns)
            codes = clusters.assign(features, rows)
            count = clusters.cluster_count
            if self.variant == "zero_sum_game":
                result.update(self._solve_games(codes, outcome, cost, count, smoothing))
            else:
                result.update(self._solve_utilities(codes, outcome, cost, count))
            result["clusters"] = clusters
            self._log(reporter, f"{count} clusters from columns {columns}; positions "
                                f"{np.round(result['score'], 3).tolist()}")
            return None

        def validate():
            clusters = result["clusters"]
            gap = self._cluster_lookup(clusters, result["score"], features, validation_index)
            train_gap = self._cluster_lookup(clusters, result["score"], features, train_index)
            scale = self._calibrate(gap, labels[validation_index], train_gap, labels[train_index], reporter)
            result["scale"] = scale
            return score("classification", scale.apply(gap), labels[validation_index])

        summary = single_fit(reporter, train_index=train_index, fit=fit, validate=validate, name=self.key)
        self._clusters = result["clusters"]
        self._scale = result["scale"]
        self.arrays = {"centers": self._clusters.centers, "columns": np.asarray(self._clusters.columns),
                       "score": np.asarray(result["score"], dtype=np.float64)}
        for name in ("strategy", "game_value", "utility_value", "frequencies", "outcome_means"):
            if name in result:
                self.arrays[name] = np.asarray(result[name], dtype=np.float64)
        self.document = {"scale": self._scale.to_dict()}
        self.fit_summary = {"cluster_count": int(self._clusters.cluster_count), "state_columns": [int(c) for c in columns],
                            "best_validation_loss": summary["best_validation_loss"],
                            "inverse_temperature": float(self._scale.inverse_temperature)}

    def _solve_games(self, codes, outcome, cost, count, smoothing) -> dict:
        bins = QuantileBins.fit(outcome, int(self.parameter("outcome_bin_count")))
        outcome_codes = bins.assign(outcome)
        radix = bins.bin_count
        overall_means = conditional_means(outcome_codes, outcome, radix, prior_weight=0.0)
        radius = float(self.parameter("ambiguity_radius"))
        strategy = np.zeros((count, 3))
        value = np.zeros(count)
        frequencies = np.zeros((count, radix))
        means = np.zeros((count, radix))
        scores = np.zeros(count)
        overall_cost = float(np.mean(cost)) if cost.size else 0.0
        for cluster in range(count):
            member = codes == cluster
            counts = np.bincount(outcome_codes[member], minlength=radix).astype(np.float64)
            frequencies[cluster] = (counts + smoothing) / (counts.sum() + smoothing * radix)
            sums = np.bincount(outcome_codes[member], weights=outcome[member], minlength=radix)
            means[cluster] = (sums + smoothing * overall_means) / (counts + smoothing)
            cluster_cost = float(np.mean(cost[member])) if member.any() else overall_cost
            strategy[cluster], value[cluster] = planners.robust_game(means[cluster], frequencies[cluster], cluster_cost,
                                                                     radius)
            scores[cluster] = float(strategy[cluster] @ planners.POSITIONS)
        return {"score": scores, "strategy": strategy, "game_value": value, "frequencies": frequencies,
                "outcome_means": means}

    def _solve_utilities(self, codes, outcome, cost, count) -> dict:
        form = str(self.parameter("utility_form"))
        utility = {"form": form, "risk_aversion": float(self.parameter("risk_aversion")),
                   "exposure_fraction": float(self.parameter("exposure_fraction")),
                   "loss_aversion": float(self.parameter("loss_aversion")),
                   "value_curvature": float(self.parameter("value_curvature")),
                   "probability_weighting": float(self.parameter("probability_weighting"))}
        scores = np.zeros(count)
        values = np.zeros(count)
        for cluster in range(count):
            member = codes == cluster
            scores[cluster], values[cluster] = planners.expected_utility_position(outcome[member], cost[member],
                                                                                  grid=POSITION_GRID, **utility)
        values[~np.isfinite(values)] = np.nan
        return {"score": scores, "utility_value": values}

    @staticmethod
    def _cluster_lookup(clusters, values, features, rows) -> np.ndarray:
        codes = clusters.assign(features, rows)
        out = np.full(codes.shape, np.nan)
        out[codes >= 0] = np.asarray(values)[codes[codes >= 0]]
        return out

    def _fit_chain(self, features, labels, train_index, validation_index, reporter) -> None:
        view = self.require_market()
        rows = view.fit_rows(train_index)
        order = int(self.parameter("markov_order"))
        result: dict = {}

        def fit():
            fitted = chain_module.fit_chain(view, rows, bin_count=int(self.parameter("bin_count")), order=order,
                                            smoothing=float(self.parameter("additive_smoothing")),
                                            remove_drift=bool(self.parameter("remove_training_drift")))
            up_share, mean_move = chain_module.simulate(fitted, int(view.horizon), int(self.parameter("path_count")),
                                                        self.seed)
            result.update(fitted)
            result["up_share"], result["mean_move"] = up_share, mean_move
            result["stationary"] = chain_module.stationary_distribution(fitted)
            self._log(reporter, f"{fitted['radix']} buckets, order {order}, "
                                f"{up_share.size} states; stationary {np.round(result['stationary'], 3).tolist()}")
            return None

        def validate():
            codes = chain_module.state_codes(view, validation_index, result["bins"], order)
            table_values = result["up_share"] if self.task == "classification" else result["mean_move"]
            prediction = np.full(codes.shape, np.nan)
            prediction[codes >= 0] = table_values[codes[codes >= 0]]
            return score(self.task, prediction, labels[validation_index])

        summary = single_fit(reporter, train_index=train_index, fit=fit, validate=validate, name=self.key)
        self._chain_bins = result["bins"]
        self.arrays = {"up_share": result["up_share"], "mean_move": result["mean_move"],
                       "transition": result["transition"], "support": result["support"],
                       "stationary": result["stationary"]}
        self.document = {"bins": result["bins"].to_dict(), "order": order, "horizon": int(view.horizon)}
        self.fit_summary = {"state_count": int(result["up_share"].size), "markov_order": order,
                            "training_drift": float(result["training_drift"]),
                            "best_validation_loss": summary["best_validation_loss"]}

    def _fit_price(self, features, targets, train_index, validation_index, reporter) -> None:
        if self.variant == "markov_chain":
            self._fit_chain(features, targets, train_index, validation_index, reporter)
            return
        smoothing = float(self.parameter("additive_smoothing")) if self.variant == "expected_utility" else 1.0
        columns = table.association_columns(features, train_index, targets[train_index],
                                            int(self.parameter("state_feature_count")))
        result: dict = {}

        def states_of(rows):
            if "bins" in result:
                return result["bins"].states(features, rows)
            return result["clusters"].assign(features, rows)

        def fit():
            if self.variant == "expected_utility":
                result["clusters"] = ClusterStates.fit(features, train_index, int(self.parameter("cluster_count")),
                                                       self.seed, columns=columns)
                count = result["clusters"].cluster_count
            else:
                result["bins"] = FeatureBins.fit(features, train_index, int(self.parameter("bin_count")), columns)
                count = result["bins"].state_count
            result["means"] = conditional_means(states_of(train_index), targets[train_index], count,
                                                prior_weight=smoothing)
            self._log(reporter, f"price: the training mean of the price target in each of {count} states")
            return None

        def validate():
            return score("regression", self._lookup(result["means"], states_of(validation_index)),
                         targets[validation_index])

        summary = single_fit(reporter, train_index=train_index, fit=fit, validate=validate, name=self.key)
        self.arrays = {"means": result["means"]}
        if "bins" in result:
            self._bins = result["bins"]
            self.document = {"bins": self._bins.to_dict()}
        else:
            self._clusters = result["clusters"]
            self.arrays.update({"centers": self._clusters.centers, "columns": np.asarray(self._clusters.columns)})
        self.fit_summary = {"state_columns": [int(c) for c in columns],
                            "best_validation_loss": summary["best_validation_loss"]}

    @staticmethod
    def _lookup(values, codes) -> np.ndarray:
        codes = np.asarray(codes, dtype=np.int64)
        out = np.full(codes.shape, np.nan)
        known = (codes >= 0) & (codes < np.asarray(values).shape[0])
        out[known] = np.asarray(values, dtype=np.float64)[codes[known]]
        return out

    # ── predict ──
    def _chain_codes(self, index) -> np.ndarray:
        if self.market is None:
            raise RuntimeError(f"{self.key}: the Markov chain reads the bar's recent closes; bind the run's market "
                               "view first (bind_market)")
        return chain_module.state_codes(self.market, index, self._chain_bins, int(self.document["order"]))

    def _predict_probability(self, features, index) -> np.ndarray:
        if self.variant == "markov_chain":
            return self._lookup(self.arrays["up_share"], self._chain_codes(index))
        if self.variant in TABULAR:
            gap = table.flat_gap(self.arrays["values"], self._bins.states(features, index))
        elif self.variant == "tree_search":
            codes = self._clusters.assign(features, index)
            gap = self._tree_scores(self._market_model, codes, index, int(self.document["horizon"]))
        else:
            gap = self._lookup(self.arrays["score"], self._clusters.assign(features, index))
        return self._scale.apply(gap)

    def _predict_value(self, features, index) -> np.ndarray:
        if self.variant == "markov_chain":
            return self._lookup(self.arrays["mean_move"], self._chain_codes(index))
        codes = self._bins.states(features, index) if self._bins is not None else self._clusters.assign(features, index)
        return self._lookup(self.arrays["means"], codes)

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_arrays(folder / self.model_file, **self.arrays)
        persistence.save_json(folder / STATE_FILE, self.document)
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        self.step_unit = metadata.get("step_unit") or self._step_unit()
        self._clear()
        self.arrays = persistence.load_arrays(folder / self.model_file)
        self.document = persistence.load_json(folder / STATE_FILE)
        if "bins" in self.document and self.variant != "markov_chain":
            self._bins = FeatureBins.from_dict(self.document["bins"])
        if "scale" in self.document:
            self._scale = TemperatureScale.from_dict(self.document["scale"])
        if "market_centers" in self.arrays:
            self._market_model = planners.ClusterMarketModel.from_arrays(self.arrays)
            self._clusters = self._market_model.clusters
        elif "centers" in self.arrays:
            self._clusters = ClusterStates(np.asarray(self.arrays["centers"], dtype=np.float64),
                                           [int(column) for column in self.arrays["columns"]])
        if self.variant == "markov_chain":
            self._chain_bins = QuantileBins.from_dict(self.document["bins"])

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scipy", "scikit-learn", "numba")


__all__ = ["DiscreteStateAgentAdapter", "PRICE_VARIANTS", "VARIANTS"]
