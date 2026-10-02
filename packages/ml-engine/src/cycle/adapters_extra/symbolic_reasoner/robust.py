"""Robust decision making: choose the strategies that hold up across many scenarios.

**Strategy pool** (fitted on the training span): single-feature strategies
for the columns with the largest information coefficient with the scaled
move (sign-oriented), an L2 logistic regression on every feature, and three
rule strategies read from the closes (trend slope, MACD histogram and mean
reversion to the Bollinger band centre). Each strategy's score is divided by
its training standard deviation; its position is the score's sign.

**Scenario ensemble** (training span only, never later bars):
``scenario_block_count`` contiguous blocks, the three training-volatility
terciles and the two trend regimes, each evaluated at the actual round-trip
cost and at twice it (cost uncertainty). A strategy's utility in a scenario is
the mean of position x scaled move minus the round-trip cost (in move-scale
units) spread over the h-bar holding period.

**Robustness**: ``satisficing`` (the share of scenarios whose utility clears
``acceptable_utility_threshold``) or ``minimax_regret`` (the worst shortfall
against the best strategy of each scenario, turned into a weight
1 / (1 + regret / median regret)). The ``robust_strategy_count`` most robust
strategies survive; the score is their robustness-weighted average score.
**Scenario discovery**: a shallow decision tree (``scenario_discovery_depth``)
on the scenario descriptors (volatility, trend, position in the span, cost
multiplier) says where the robust ensemble fails to satisfice; its rules are
logged. P(up) comes from the validation curve.
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine
from cycle.bridges import rules as indicator_rules

RULE_STRATEGIES = ("trend_slope", "moving_average_convergence_divergence_histogram", "mean_reversion")


def rule_series(name: str, view, cache: dict) -> np.ndarray:
    key = ("robust", name)
    if key not in cache:
        if name == "trend_slope":
            cache[key] = indicator_rules.trend_slope(view.close, view.move_scale)
        elif name == "moving_average_convergence_divergence_histogram":
            cache[key] = indicator_rules.macd_histogram(view.close, view.move_scale)
        else:
            cache[key] = -(indicator_rules.bollinger_band_position(view.close) - 0.5)
    return cache[key]


class RobustSelection(Engine):
    uses_predicates = False

    def _raw_scores(self, context, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        features = context.features
        columns = []
        for strategy in self.strategies:
            kind = strategy["kind"]
            if kind == "feature":
                columns.append(strategy["sign"] * np.asarray(features[rows, strategy["column"]], dtype=np.float64))
            elif kind == "logistic":
                x = np.asarray(features[rows], dtype=np.float64)
                with np.errstate(invalid="ignore"):
                    columns.append(x @ np.asarray(strategy["coefficients"]) + strategy["intercept"])
            else:
                columns.append(np.asarray(rule_series(kind, context.view, context.cache), dtype=np.float64)[rows])
        return np.column_stack(columns)

    def fit(self, context, train_rows, target, direction):
        from sklearn.linear_model import LogisticRegression
        from sklearn.tree import DecisionTreeClassifier, export_text

        p = self.parameters
        view = context.view
        features = context.features
        span = view.fit_rows(train_rows)
        move = np.asarray(view.price_targets, dtype=np.float64)[span]
        span, move = span[np.isfinite(move)], move[np.isfinite(move)]
        # single-feature strategies by information coefficient with the scaled move
        coefficients = []
        for column in range(features.shape[1]):
            values = np.asarray(features[span, column], dtype=np.float64)
            usable = np.isfinite(values)
            if usable.sum() < 30 or np.std(values[usable]) <= 1e-12:
                continue
            coefficients.append((float(np.corrcoef(values[usable], move[usable])[0, 1]), column))
        coefficients.sort(key=lambda item: (-abs(item[0]), item[1]))
        feature_count = max(1, int(p["candidate_strategy_count"]) - 1 - len(RULE_STRATEGIES))
        self.strategies = [{"kind": "feature", "name": f"feature_{view.feature_names[c] if c < len(view.feature_names) else c}",
                            "column": int(c), "sign": 1.0 if ic >= 0 else -1.0} for ic, c in coefficients[:feature_count]]
        x = np.asarray(features[train_rows], dtype=np.float64)
        y = direction[train_rows]
        usable = np.all(np.isfinite(x), axis=1) & np.isfinite(y)
        if usable.sum() >= 10 and len(np.unique(y[usable])) == 2:
            model = LogisticRegression(C=1.0, max_iter=500).fit(x[usable], y[usable].astype(int))
            self.strategies.append({"kind": "logistic", "name": "logistic_regression",
                                    "coefficients": model.coef_[0].tolist(), "intercept": float(model.intercept_[0])})
        self.strategies += [{"kind": name, "name": name} for name in RULE_STRATEGIES]
        self.scales = np.ones(len(self.strategies))
        raw = self._raw_scores(context, span)
        for k in range(raw.shape[1]):
            spread = float(np.nanstd(raw[:, k]))
            self.scales[k] = spread if np.isfinite(spread) and spread > 1e-12 else 1.0
        positions = np.sign(np.nan_to_num(raw / self.scales[None, :]))
        cost = float(view.round_trip_cost_points) / np.asarray(view.move_scale, dtype=np.float64)[span] / max(view.horizon, 1)
        cost = np.nan_to_num(cost)
        # the scenario ensemble
        scenarios, descriptors = [], []
        volatility = np.asarray(view.move_scale, dtype=np.float64)[span]
        trend = np.nan_to_num(rule_series("trend_slope", view, context.cache)[span])
        blocks = np.array_split(np.arange(span.size), max(1, int(p["scenario_block_count"])))
        edges = np.nanquantile(volatility, (1 / 3, 2 / 3)) if span.size else np.zeros(2)
        tercile = np.searchsorted(edges, volatility, side="right")
        groups = [block for block in blocks if block.size]
        groups += [np.flatnonzero(tercile == level) for level in range(3)]
        groups += [np.flatnonzero(trend > 0), np.flatnonzero(trend <= 0)]
        for members in groups:
            if members.size < 5:
                continue
            for multiplier in (1.0, 2.0):
                utility = (positions[members] * move[members, None] - multiplier * cost[members, None]).mean(axis=0)
                scenarios.append(utility)
                descriptors.append([float(np.nanmean(volatility[members])), float(np.mean(trend[members])),
                                    float(np.mean(members) / max(span.size, 1)), multiplier])
        utilities = np.array(scenarios) if scenarios else np.zeros((1, len(self.strategies)))
        threshold = float(p["acceptable_utility_threshold"])
        if p["robustness_metric"] == "satisficing":
            robustness = (utilities >= threshold).mean(axis=0)
        else:
            regret = (utilities.max(axis=1, keepdims=True) - utilities).max(axis=0)
            scale = float(np.median(regret)) if np.median(regret) > 0 else 1.0
            robustness = 1.0 / (1.0 + regret / scale)
        order = np.lexsort((np.arange(len(self.strategies)), -utilities.mean(axis=0), -robustness))
        keep = order[: max(1, int(p["robust_strategy_count"]))]
        weights = np.zeros(len(self.strategies))
        weights[keep] = robustness[keep]
        if weights.sum() <= 0:
            weights[keep] = 1.0
        self.weights = weights / weights.sum()
        ensemble = np.sign(np.nan_to_num(raw / self.scales[None, :]) @ self.weights)
        discovery = ""
        if len(descriptors) >= 4:
            outcome = []
            for members in groups:
                if members.size < 5:
                    continue
                for multiplier in (1.0, 2.0):
                    value = float((ensemble[members] * move[members] - multiplier * cost[members]).mean())
                    outcome.append(int(value >= threshold))
            if len(set(outcome)) == 2:
                tree = DecisionTreeClassifier(max_depth=int(p["scenario_discovery_depth"]), random_state=self.seed)
                tree.fit(np.array(descriptors), np.array(outcome))
                discovery = export_text(tree, feature_names=["volatility", "trend", "position", "cost_multiplier"])
        self.summary = {"strategies": [s["name"] for s in self.strategies], "robustness": robustness.tolist(),
                        "weights": self.weights.tolist(), "scenario_count": int(utilities.shape[0])}
        chosen = ", ".join(self.strategies[k]["name"] for k in keep)
        context.log(f"robust decision making: {len(self.strategies)} strategies over {utilities.shape[0]} scenarios; "
                    f"robust set: {chosen}")
        if discovery:
            context.log("scenario discovery (where the robust set fails to satisfice): "
                        + " | ".join(line.strip() for line in discovery.splitlines()))
        return None

    def score(self, context, rows):
        raw = self._raw_scores(context, rows) / self.scales[None, :]
        used = self.weights > 0
        out = raw[:, used] @ self.weights[used]
        out[~np.all(np.isfinite(raw[:, used]), axis=1)] = np.nan
        return out

    def state(self):
        return {"strategies": self.strategies, "scales": self.scales.tolist(), "weights": self.weights.tolist()}

    def load(self, state):
        self.strategies = list(state["strategies"])
        self.scales = np.asarray(state["scales"], dtype=np.float64)
        self.weights = np.asarray(state["weights"], dtype=np.float64)
