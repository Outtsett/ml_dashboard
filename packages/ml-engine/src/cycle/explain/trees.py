""""Inside the model" for tree ensembles (``explainKind`` ``trees`` and
``oblivious_trees``).

For one bar: which leaf every tree sent it to and the questions it asked on
the way, the leaf values, and how they add up (boosting: base + Σ leaves, then
the link) or average out (forests: the mean of the trees' P(up) or target).
Every leaf and every raw output is the LIBRARY's answer, never a re-run of its
split rule:

    library          model(s)                          leaves                          raw output
    xgboost          legacy xgboost                    predict(pred_leaf=True)         inplace_predict(margin)
    lightgbm         legacy lightgbm                   predict(pred_leaf=True)         predict(raw_score=True)
    scikit-learn     legacy random forest, extra       tree_.apply / tree_.decision_path  the trees' leaf values
                     trees, the two single trees         (per tree)                     averaged as predict_proba does
    scikit-learn     gradient boosting machine         tree_.decision_path (first       decision_function / predict
                                                        ``best_iteration`` rounds)
    catboost         catboost (symmetric trees)        calc_leaf_indexes               predict(RawFormulaVal)

The iteration range is the one the adapter predicts with: xgboost stops at
``best_iteration`` (the trees after it exist but are not counted); lightgbm,
the gradient boosting machine and catboost were cut back to their best round
when saved. Structure comes out of the fitted object: xgboost's JSON model
(``save_raw("json")``: children, parents, split conditions, default
directions, hessian sums, gains, node weights), lightgbm's ``dump_model()``,
scikit-learn's ``tree_`` arrays, catboost's JSON export (the levels of each
tree in the model's own split order, the leaf values, scale and bias).

Paths: scikit-learn reports the nodes a row visits (``decision_path``); for
xgboost and lightgbm the path is read upward from the leaf the library chose
through the tree's parent links; for catboost the leaf index is decoded as
``leaf = Σ_d bit_d · 2^d`` with bit_d = 1 when the value is above level d's
border, d in the order of the model's ``splits`` list (checked against
``calc_leaf_indexes`` by G3 on every explained bar).

Units: every leaf value is what that tree adds to the raw output — xgboost's
leaves already carry the learning rate (its internal node weights do not, so
they are multiplied by it), the gradient boosting machine's tree values are
multiplied by its learning rate here, catboost's by the model's scale. A
forest classifier's value at a node is its fraction of up bars, read in the
column of ``classes_ == 1``.

``baseValue`` in a bar is the library's raw output minus the sum of the leaf
values, so the running total ends exactly at the library's raw output (xgboost
sums its leaves in float32); ``structure.baseValue`` is the declared constant
(xgboost's base score as a margin, lightgbm 0 — its first tree holds the
average — the gradient boosting machine's initial estimator, catboost's bias;
null for forests). G2 checks both.

Structure statistics (depth histogram, leaf count, feature usage) cover the
trees that count toward predictions.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from dataclasses import dataclass, field

import numpy as np

from . import ExplainError, NotExplained
from .linear import link_output, reported_output

G2_TOLERANCE = 1e-6
LESS_THAN, LESS_OR_EQUAL, GREATER_THAN = "less_than", "less_or_equal", "greater_than"
# lightgbm's kZeroThreshold (include/LightGBM/meta.h): |x| <= 1e-35 counts as zero
LIGHTGBM_ZERO_THRESHOLD = 1e-35


# ─── one binary tree, columnar ─────────────────────────────────────────────


@dataclass
class TreeArrays:
    """Node columns (position = node id in the library's own numbering, or
    pre-order for lightgbm). ``missing_left`` is 1 / 0, or -1 at a leaf."""

    left: np.ndarray
    right: np.ndarray
    feature: np.ndarray
    threshold: np.ndarray          # NaN at a leaf
    missing_left: np.ndarray
    value: np.ndarray
    cover: np.ndarray              # NaN when not recorded
    gain: np.ndarray               # NaN when not recorded / at a leaf
    parent: np.ndarray             # -1 at the root
    extra: dict = field(default_factory=dict)
    _depth: np.ndarray | None = None

    @property
    def depth(self) -> np.ndarray:
        if self._depth is None:
            depth = np.zeros(self.left.size, dtype=np.int64)
            stack = [0] if self.left.size else []
            while stack:
                node = stack.pop()
                for child in (self.left[node], self.right[node]):
                    if child >= 0:
                        depth[child] = depth[node] + 1
                        stack.append(int(child))
            self._depth = depth
        return self._depth

    def is_leaf(self, node: int) -> bool:
        return self.left[node] < 0 and self.right[node] < 0

    def leaves(self) -> np.ndarray:
        return np.flatnonzero((self.left < 0) & (self.right < 0))

    def path_to(self, leaf: int) -> list[tuple[int, bool]]:
        """(node, went left) from the root down to ``leaf``, read through the parent links."""
        steps: list[tuple[int, bool]] = []
        node = int(leaf)
        guard = self.left.size + 1
        while self.parent[node] >= 0:
            parent = int(self.parent[node])
            steps.append((parent, bool(self.left[parent] == node)))
            node = parent
            guard -= 1
            if guard < 0:
                raise RuntimeError("the tree's parent links form a cycle")
        if node != 0:
            raise RuntimeError(f"leaf {leaf} does not lead back to the root")
        steps.reverse()
        return steps

    def reply(self, split_rule: str) -> dict:
        leaf = (self.left < 0) & (self.right < 0)
        return {
            "splitRule": split_rule,
            "nodes": {
                "left": self.left, "right": self.right,
                "feature": np.where(leaf, -1, self.feature),
                "threshold": [None if is_leaf or not math.isfinite(t) else float(t)
                              for is_leaf, t in zip(leaf.tolist(), self.threshold.tolist())],
                "missingGoesLeft": [None if is_leaf or flag < 0 else bool(flag)
                                    for is_leaf, flag in zip(leaf.tolist(), self.missing_left.tolist())],
                "value": self.value,
                "cover": [None if not math.isfinite(c) else float(c) for c in self.cover.tolist()],
                "depth": self.depth,
            },
        }


def _parents(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    parent = np.full(left.size, -1, dtype=np.int64)
    for node in range(left.size):
        for child in (left[node], right[node]):
            if child >= 0:
                parent[child] = node
    return parent


def _statistics(trees: list[TreeArrays], feature_count: int) -> dict:
    """Depth histogram, leaf count and feature usage over the given trees."""
    deepest = [int(tree.depth[tree.leaves()].max()) if tree.leaves().size else 0 for tree in trees]
    max_depth = max(deepest, default=0)
    histogram = np.bincount(np.asarray(deepest, dtype=np.int64), minlength=max_depth + 1) if deepest else np.zeros(1)
    counts = np.zeros(feature_count, dtype=np.int64)
    gains = np.zeros(feature_count, dtype=np.float64)
    gain_recorded = np.zeros(feature_count, dtype=bool)
    for tree in trees:
        internal = np.flatnonzero((tree.left >= 0) | (tree.right >= 0))
        for node in internal:
            feature = int(tree.feature[node])
            if 0 <= feature < feature_count:
                counts[feature] += 1
                gain = float(tree.gain[node])
                if math.isfinite(gain):
                    gains[feature] += gain
                    gain_recorded[feature] = True
    return {
        "maxDepth": max_depth,
        "depthHistogram": [int(n) for n in histogram],
        "leafCount": int(sum(tree.leaves().size for tree in trees)),
        "featureUsage": [{"featureIndex": int(f), "splitCount": int(counts[f]),
                          "totalGain": float(gains[f]) if gain_recorded[f] else None}
                         for f in np.flatnonzero(counts)],
    }


# ─── the libraries ─────────────────────────────────────────────────────────


class _Ensemble:
    """What every library gives the explainer. ``leaves`` and ``raw`` ask the
    library; ``steps`` reads the path out of the structure (or the library's
    decision path); ``went_left`` re-evaluates one split with the library's
    own comparison and is used only by the G3 check."""

    split_rule = LESS_THAN
    aggregation = "sum"
    oblivious = False
    learning_rate: float | None = None
    base_value: float | None = None
    tree_count = 0
    used_count = 0
    trees: list[TreeArrays]

    def leaves(self, row32: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def raw(self, row32: np.ndarray, leaf_values: np.ndarray) -> float:
        raise NotImplementedError

    def leaf_value(self, tree_index: int, leaf: int) -> float:
        return float(self.trees[tree_index].value[leaf])

    def steps(self, tree_index: int, leaf: int, row32: np.ndarray) -> list[tuple[int, int, float, bool]]:
        """(node, feature, threshold, went left) root first."""
        tree = self.trees[tree_index]
        return [(node, int(tree.feature[node]), float(tree.threshold[node]), left)
                for node, left in tree.path_to(leaf)]

    def went_left(self, tree_index: int, node: int, row32: np.ndarray) -> bool:
        raise NotImplementedError

    def child(self, tree_index: int, node: int, left: bool) -> int:
        tree = self.trees[tree_index]
        return int(tree.left[node] if left else tree.right[node])

    def statistics(self, feature_count: int) -> dict:
        return _statistics(self.trees[:self.used_count], feature_count)

    def tree_reply(self, tree_index: int) -> dict:
        return self.trees[tree_index].reply(self.split_rule)


def _parse_float_list(text) -> float:
    """xgboost 3 writes base_score as "[5.175E-1]"."""
    if isinstance(text, (int, float)):
        return float(text)
    values = [float(part) for part in str(text).strip("[]").split(",") if part.strip()]
    if len(values) != 1:
        raise NotExplained(f"xgboost base score {text!r} is not one number")
    return values[0]


class XGBoostTrees(_Ensemble):
    split_rule = LESS_THAN

    def __init__(self, adapter) -> None:
        booster = adapter.booster
        self.booster = booster
        self.best_iteration = int(adapter.best_iteration)
        model = json.loads(bytes(booster.save_raw("json")).decode("utf-8"))
        learner = model["learner"]
        booster_block = learner["gradient_booster"]
        if booster_block.get("name") != "gbtree":
            raise NotExplained(f"xgboost booster {booster_block.get('name')!r} is not a tree booster")
        body = booster_block["model"]
        parallel = int(body["gbtree_model_param"].get("num_parallel_tree", "1"))
        self.trees_per_iteration = max(1, parallel)
        if any(int(group) != 0 for group in body.get("tree_info", [])):
            raise NotExplained("xgboost model with more than one output group")
        configuration = json.loads(booster.save_config())
        train_parameters = configuration["learner"]["gradient_booster"].get("tree_train_param", {})
        eta = train_parameters.get("eta", train_parameters.get("learning_rate"))
        if eta is None:
            eta = (getattr(adapter, "parameters", {}) or {}).get("learning_rate")
        if eta is None:
            raise NotExplained("xgboost's learning rate is not recorded in the model")
        self.learning_rate = float(eta)
        objective = learner["objective"]["name"]
        base = _parse_float_list(learner["learner_model_param"]["base_score"])
        if objective in ("binary:logistic", "reg:logistic", "binary:logitraw"):
            self.base_value = math.log(base / (1.0 - base)) if objective != "binary:logitraw" else base
        elif objective.startswith("reg:") and objective not in ("reg:gamma", "reg:tweedie"):
            self.base_value = base
        else:
            self.base_value = None
        self.trees = [self._tree(tree) for tree in body["trees"]]
        self.tree_count = len(self.trees)
        self.used_count = min(self.tree_count, (self.best_iteration + 1) * self.trees_per_iteration)

    def _tree(self, tree: dict) -> TreeArrays:
        if any(int(kind) != 0 for kind in tree.get("split_type", [])):
            raise NotExplained("xgboost tree with categorical splits")
        left = np.asarray(tree["left_children"], dtype=np.int64)
        right = np.asarray(tree["right_children"], dtype=np.int64)
        leaf = (left < 0) & (right < 0)
        conditions = np.asarray(tree["split_conditions"], dtype=np.float64)
        weights = np.asarray(tree["base_weights"], dtype=np.float64)
        # leaves: the split condition slot holds the leaf value (learning rate applied);
        # internal nodes: the unshrunk weight a leaf there would have had, times the learning rate
        value = np.where(leaf, conditions, weights * self.learning_rate)
        parent = np.asarray(tree["parents"], dtype=np.int64)
        parent = np.where((parent < 0) | (parent >= left.size), -1, parent)
        return TreeArrays(
            left=left, right=right,
            feature=np.asarray(tree["split_indices"], dtype=np.int64),
            threshold=np.where(leaf, np.nan, conditions),
            missing_left=np.where(leaf, -1, np.asarray(tree["default_left"], dtype=np.int64)),
            value=value,
            cover=np.asarray(tree["sum_hessian"], dtype=np.float64),
            gain=np.where(leaf, np.nan, np.asarray(tree["loss_changes"], dtype=np.float64)),
            parent=parent,
        )

    def _range(self) -> tuple[int, int]:
        return 0, self.best_iteration + 1

    def leaves(self, row32: np.ndarray) -> np.ndarray:
        import xgboost as xgb

        matrix = xgb.DMatrix(row32.reshape(1, -1))
        leaves = self.booster.predict(matrix, pred_leaf=True, iteration_range=self._range())
        return np.asarray(leaves, dtype=np.int64).reshape(-1)

    def raw(self, row32: np.ndarray, leaf_values: np.ndarray) -> float:
        margin = self.booster.inplace_predict(row32.reshape(1, -1), iteration_range=self._range(), predict_type="margin")
        return float(np.asarray(margin, dtype=np.float64).reshape(-1)[0])

    def went_left(self, tree_index: int, node: int, row32: np.ndarray) -> bool:
        tree = self.trees[tree_index]
        value = np.float32(row32[tree.feature[node]])
        if np.isnan(value):
            return bool(tree.missing_left[node])
        return bool(value < np.float32(tree.threshold[node]))


class LightGBMTrees(_Ensemble):
    split_rule = LESS_OR_EQUAL

    def __init__(self, adapter) -> None:
        booster = adapter.booster
        self.booster = booster
        self.best_iteration = int(adapter.best_iteration)
        dump = booster.dump_model(num_iteration=-1)
        if int(dump.get("num_tree_per_iteration", 1)) != 1:
            raise NotExplained("lightgbm model with more than one tree per round")
        if dump.get("average_output"):
            raise NotExplained("lightgbm random-forest mode (averaged output)")
        self.trees = []
        self.leaf_positions: list[np.ndarray] = []
        shrinkage = []
        for info in dump["tree_info"]:
            tree, positions = self._tree(info["tree_structure"], int(info["num_leaves"]))
            self.trees.append(tree)
            self.leaf_positions.append(positions)
            shrinkage.append(float(info.get("shrinkage", float("nan"))))
        self.tree_count = len(self.trees)
        self.used_count = min(self.tree_count, self.best_iteration) if self.best_iteration > 0 else self.tree_count
        # the first tree carries the boost-from-average start at shrinkage 1; the rest the learning rate
        rates = [rate for rate in shrinkage[1:self.used_count] if math.isfinite(rate)]
        self.learning_rate = rates[-1] if rates else (shrinkage[0] if shrinkage else None)
        self.base_value = 0.0

    @staticmethod
    def _tree(root: dict, leaf_count: int) -> tuple[TreeArrays, np.ndarray]:
        columns: dict[str, list] = {name: [] for name in
                                    ("left", "right", "feature", "threshold", "missing_left", "value", "cover", "gain",
                                     "missing_type")}
        positions = np.full(max(leaf_count, 1), -1, dtype=np.int64)

        def add(node: dict) -> int:
            position = len(columns["left"])
            for name in columns:
                columns[name].append(None)
            if "leaf_index" in node or "leaf_value" in node:
                positions[int(node.get("leaf_index", 0))] = position
                columns["left"][position] = columns["right"][position] = -1
                columns["feature"][position] = -1
                columns["threshold"][position] = float("nan")
                columns["missing_left"][position] = -1
                columns["value"][position] = float(node["leaf_value"])
                columns["cover"][position] = float(node.get("leaf_weight", float("nan")))
                columns["gain"][position] = float("nan")
                columns["missing_type"][position] = None
                return position
            if node.get("decision_type", "<=") != "<=":
                raise NotExplained(f"lightgbm split {node.get('decision_type')!r} (categorical) is not explained")
            missing_type = node.get("missing_type", "None")
            threshold = float(node["threshold"])
            default_left = bool(node.get("default_left", True))
            columns["feature"][position] = int(node["split_feature"])
            columns["threshold"][position] = threshold
            # "None": a missing value is read as 0 and compared; otherwise it takes the default side
            columns["missing_left"][position] = int(0.0 <= threshold) if missing_type == "None" else int(default_left)
            columns["missing_type"][position] = missing_type
            columns["value"][position] = float(node.get("internal_value", float("nan")))
            columns["cover"][position] = float(node.get("internal_weight", float("nan")))
            columns["gain"][position] = float(node.get("split_gain", float("nan")))
            columns["left"][position] = add(node["left_child"])
            columns["right"][position] = add(node["right_child"])
            return position

        add(root)
        left = np.asarray(columns["left"], dtype=np.int64)
        right = np.asarray(columns["right"], dtype=np.int64)
        tree = TreeArrays(
            left=left, right=right,
            feature=np.asarray(columns["feature"], dtype=np.int64),
            threshold=np.asarray(columns["threshold"], dtype=np.float64),
            missing_left=np.asarray(columns["missing_left"], dtype=np.int64),
            value=np.asarray(columns["value"], dtype=np.float64),
            cover=np.asarray(columns["cover"], dtype=np.float64),
            gain=np.asarray(columns["gain"], dtype=np.float64),
            parent=_parents(left, right),
            extra={"missing_type": columns["missing_type"]},
        )
        return tree, positions

    def leaves(self, row32: np.ndarray) -> np.ndarray:
        indexes = self.booster.predict(row32.reshape(1, -1), pred_leaf=True, num_iteration=self.used_count,
                                       num_threads=1)
        indexes = np.asarray(indexes, dtype=np.int64).reshape(-1)[:self.used_count]
        return np.array([self.leaf_positions[t][leaf] for t, leaf in enumerate(indexes)], dtype=np.int64)

    def raw(self, row32: np.ndarray, leaf_values: np.ndarray) -> float:
        raw = self.booster.predict(row32.reshape(1, -1), raw_score=True, num_iteration=self.used_count, num_threads=1)
        return float(np.asarray(raw, dtype=np.float64).reshape(-1)[0])

    def went_left(self, tree_index: int, node: int, row32: np.ndarray) -> bool:
        # lightgbm's NumericalDecision (include/LightGBM/tree.h), on the double of the float32 input
        tree = self.trees[tree_index]
        missing_type = tree.extra["missing_type"][node]
        value = float(row32[tree.feature[node]])
        if math.isnan(value) and missing_type != "NaN":
            value = 0.0
        is_zero = -LIGHTGBM_ZERO_THRESHOLD <= value <= LIGHTGBM_ZERO_THRESHOLD
        if (missing_type == "Zero" and is_zero) or (missing_type == "NaN" and math.isnan(value)):
            return bool(tree.missing_left[node])
        return bool(value <= float(tree.threshold[node]))


class ScikitLearnTrees(_Ensemble):
    """A forest (random forest, extra trees), one decision tree (a forest of
    one, averaged the same way) or a gradient boosting machine."""

    split_rule = LESS_OR_EQUAL

    def __init__(self, estimator, task: str, best_iteration: int | None = None) -> None:
        self.estimator = estimator
        self.task = task
        name = type(estimator).__name__
        self.boosting = name.startswith("GradientBoosting")
        if name.startswith("HistGradientBoosting"):
            raise NotExplained("histogram gradient boosting trees are not explained")
        if self.boosting:
            members = [row[0] for row in np.asarray(estimator.estimators_, dtype=object)]
            self.aggregation = "sum"
            self.learning_rate = float(estimator.learning_rate)
            used = len(members) if not best_iteration else min(len(members), int(best_iteration))
        elif hasattr(estimator, "estimators_"):
            members = list(estimator.estimators_)
            self.aggregation = "mean"
            used = len(members)
        elif hasattr(estimator, "tree_"):
            members = [estimator]
            self.aggregation = "mean"
            used = 1
        else:
            raise NotExplained(f"{name} is not a tree model")
        self.members = members
        self.tree_count = len(members)
        self.used_count = used
        self.column = 0
        if task == "classification" and not self.boosting:
            classes = np.asarray(estimator.classes_)
            matches = np.flatnonzero(classes == 1)
            if matches.size != 1:
                raise NotExplained(f"{name}: no up class (1) among classes {classes.tolist()}")
            self.column = int(matches[0])      # classes_ order, never assumed
        self.base_value = self._declared_base() if self.boosting else None
        self.trees = [self._tree(member.tree_) for member in members]

    def _declared_base(self) -> float | None:
        init = getattr(self.estimator, "init_", None)
        if not (init == "zero" or type(init).__name__ in ("DummyClassifier", "DummyRegressor")):
            return None          # an initial estimator that depends on the inputs has no single base
        zeros = np.zeros((1, int(self.estimator.n_features_in_)), dtype=np.float32)
        return float(np.asarray(self.estimator._raw_predict_init(zeros), dtype=np.float64).reshape(-1)[0])

    def _node_values(self, tree) -> np.ndarray:
        values = np.asarray(tree.value, dtype=np.float64)
        if self.boosting:
            return self.learning_rate * values[:, 0, 0]
        if self.task == "regression":
            return values[:, 0, 0]
        totals = values[:, 0, :].sum(axis=1)
        column = values[:, 0, self.column]
        # scikit-learn >= 1.4 stores class fractions (what tree_.predict returns); older ones stored counts
        if np.all(np.abs(totals - 1.0) < 1e-9):
            return column
        return np.divide(column, totals, out=np.zeros_like(column), where=totals > 0)

    def _tree(self, tree) -> TreeArrays:
        left = np.asarray(tree.children_left, dtype=np.int64)
        right = np.asarray(tree.children_right, dtype=np.int64)
        leaf = (left < 0) & (right < 0)
        missing = getattr(tree, "missing_go_to_left", None)
        missing_left = np.where(leaf, -1, np.asarray(missing, dtype=np.int64)) if missing is not None \
            else np.full(left.size, -1, dtype=np.int64)
        return TreeArrays(
            left=left, right=right,
            feature=np.where(leaf, -1, np.asarray(tree.feature, dtype=np.int64)),
            threshold=np.where(leaf, np.nan, np.asarray(tree.threshold, dtype=np.float64)),
            missing_left=missing_left,
            value=self._node_values(tree),
            cover=np.asarray(tree.weighted_n_node_samples, dtype=np.float64),
            gain=np.full(left.size, np.nan),
            parent=_parents(left, right),
            extra={"tree": tree},
        )

    def statistics(self, feature_count: int) -> dict:
        stats = _statistics(self.trees[:self.used_count], feature_count)
        # total impurity decrease per feature, as the library measures it (unnormalised feature importances)
        decrease = np.zeros(feature_count, dtype=np.float64)
        for tree in self.trees[:self.used_count]:
            importances = np.asarray(tree.extra["tree"].compute_feature_importances(normalize=False), dtype=np.float64)
            decrease[:importances.size] += importances[:feature_count]
        for usage in stats["featureUsage"]:
            usage["totalGain"] = float(decrease[usage["featureIndex"]])
        return stats

    def leaves(self, row32: np.ndarray) -> np.ndarray:
        matrix = np.ascontiguousarray(row32.reshape(1, -1), dtype=np.float32)
        return np.array([int(tree.extra["tree"].apply(matrix)[0]) for tree in self.trees[:self.used_count]],
                        dtype=np.int64)

    def steps(self, tree_index: int, leaf: int, row32: np.ndarray) -> list[tuple[int, int, float, bool]]:
        tree = self.trees[tree_index]
        matrix = np.ascontiguousarray(row32.reshape(1, -1), dtype=np.float32)
        visited = np.sort(tree.extra["tree"].decision_path(matrix).indices).tolist()   # the library's own path
        if not visited or visited[-1] != leaf:
            raise RuntimeError(f"tree {tree_index + 1}: the decision path does not end at the leaf the tree applied")
        return [(node, int(tree.feature[node]), float(tree.threshold[node]), bool(tree.left[node] == following))
                for node, following in zip(visited[:-1], visited[1:])]

    def raw(self, row32: np.ndarray, leaf_values: np.ndarray) -> float:
        if self.boosting:
            matrix = row32.reshape(1, -1).astype(np.float64)
            output = self.estimator.decision_function(matrix) if self.task == "classification" \
                else self.estimator.predict(matrix)
            return float(np.asarray(output, dtype=np.float64).reshape(-1)[0])
        # predict_proba / predict of a forest: the trees' leaf values summed in tree order, over the tree count
        total = 0.0
        for value in leaf_values:
            total += float(value)
        return total / len(leaf_values)

    def went_left(self, tree_index: int, node: int, row32: np.ndarray) -> bool:
        # scikit-learn's _apply_dense: float32 input against a float64 threshold, missing by missing_go_to_left
        tree = self.trees[tree_index]
        value = np.float32(row32[tree.feature[node]])
        if np.isnan(value):
            return bool(tree.missing_left[node] == 1)
        return bool(float(value) <= float(tree.threshold[node]))


@dataclass
class ObliviousTree:
    features: np.ndarray       # per level, in the model's split order
    borders: np.ndarray        # float64 of the float32 border
    leaf_values: np.ndarray    # 2^depth, already multiplied by the model's scale


class CatBoostTrees(_Ensemble):
    split_rule = GREATER_THAN
    oblivious = True

    def __init__(self, adapter) -> None:
        model = adapter.model
        self.model = model
        with tempfile.TemporaryDirectory(prefix="cycle_explain_catboost_") as folder:
            path = os.path.join(folder, "model.json")
            model.save_model(path, format="json")
            with open(path, encoding="utf-8") as handle:
                exported = json.load(handle)
        if "oblivious_trees" not in exported:
            raise NotExplained("catboost model without symmetric trees")
        scale, bias = exported.get("scale_and_bias", [1.0, [0.0]])
        bias_values = bias if isinstance(bias, list) else [bias]
        if len(bias_values) != 1:
            raise NotExplained("catboost model with more than one output dimension")
        self.scale = float(scale)
        self.base_value = float(bias_values[0])
        float_features = exported.get("features_info", {}).get("float_features", [])
        flat_index = {int(item["feature_index"]): int(item.get("flat_feature_index", item["feature_index"]))
                      for item in float_features}
        self.nan_as_true = {int(item.get("flat_feature_index", item["feature_index"])):
                            item.get("nan_value_treatment") == "AsTrue" for item in float_features}
        self.oblivious_trees: list[ObliviousTree] = []
        for tree in exported["oblivious_trees"]:
            splits = tree.get("splits", [])
            if any(split.get("split_type") != "FloatFeature" for split in splits):
                raise NotExplained("catboost tree with a non-numeric split")
            values = np.asarray(tree["leaf_values"], dtype=np.float64)
            if values.size != 2 ** len(splits):
                raise NotExplained("catboost tree with more than one value per leaf")
            features = np.array([flat_index.get(int(split["float_feature_index"]), int(split["float_feature_index"]))
                                 for split in splits], dtype=np.int64)
            borders = np.array([float(np.float32(split["border"])) for split in splits], dtype=np.float64)
            self.oblivious_trees.append(ObliviousTree(features, borders, self.scale * values))
        self.trees = []
        self.tree_count = len(self.oblivious_trees)
        self.used_count = self.tree_count            # the adapter predicts with every tree (cut back at fit time)
        try:
            self.learning_rate = float(model.learning_rate_)
        except (AttributeError, TypeError, ValueError):
            self.learning_rate = None

    def statistics(self, feature_count: int) -> dict:
        trees = self.oblivious_trees[:self.used_count]
        depths = [tree.features.size for tree in trees]
        max_depth = max(depths, default=0)
        counts = np.zeros(feature_count, dtype=np.int64)
        for tree in trees:
            for feature in tree.features:
                if 0 <= feature < feature_count:
                    counts[feature] += 1
        return {
            "maxDepth": max_depth,
            "depthHistogram": [int(n) for n in np.bincount(np.asarray(depths, dtype=np.int64), minlength=max_depth + 1)],
            "leafCount": int(sum(2 ** depth for depth in depths)),
            "featureUsage": [{"featureIndex": int(f), "splitCount": int(counts[f]), "totalGain": None}
                             for f in np.flatnonzero(counts)],
        }

    def leaves(self, row32: np.ndarray) -> np.ndarray:
        indexes = self.model.calc_leaf_indexes(row32.reshape(1, -1), ntree_start=0, ntree_end=self.used_count,
                                               thread_count=1)
        return np.asarray(indexes, dtype=np.int64).reshape(-1)[:self.used_count]

    def raw(self, row32: np.ndarray, leaf_values: np.ndarray) -> float:
        raw = self.model.predict(row32.reshape(1, -1), prediction_type="RawFormulaVal", thread_count=1)
        return float(np.asarray(raw, dtype=np.float64).reshape(-1)[0])

    def leaf_value(self, tree_index: int, leaf: int) -> float:
        return float(self.oblivious_trees[tree_index].leaf_values[leaf])

    def steps(self, tree_index: int, leaf: int, row32: np.ndarray) -> list[tuple[int, int, float, bool]]:
        # the leaf index the library chose, decoded: bit d (level d, model split order) = above that level's border
        tree = self.oblivious_trees[tree_index]
        return [(level, int(tree.features[level]), float(tree.borders[level]), bool((int(leaf) >> level) & 1))
                for level in range(tree.features.size)]

    def went_left(self, tree_index: int, node: int, row32: np.ndarray) -> bool:
        # CatBoost's binarisation: float32 value > float32 border; NaN by the feature's nan treatment
        tree = self.oblivious_trees[tree_index]
        feature = int(tree.features[node])
        value = np.float32(row32[feature])
        if np.isnan(value):
            return bool(self.nan_as_true.get(feature, False))
        return bool(value > np.float32(tree.borders[node]))

    def tree_reply(self, tree_index: int) -> dict:
        tree = self.oblivious_trees[tree_index]
        empty: list = []
        return {
            "splitRule": self.split_rule,
            "nodes": {"left": empty, "right": empty, "feature": empty, "threshold": empty, "missingGoesLeft": empty,
                      "value": empty, "cover": empty, "depth": empty},
            "obliviousLevels": [{"feature": int(feature), "threshold": float(border)}
                                for feature, border in zip(tree.features, tree.borders)],
            "obliviousLeafValues": tree.leaf_values,
        }


def ensemble(context) -> _Ensemble:
    """The explained adapter's trees, parsed once per context."""
    cached = context.cache.get("tree_ensemble")
    if cached is not None:
        return cached
    adapter = context.explained_adapter
    name = type(adapter).__name__
    task = getattr(adapter, "task", "regression" if context.role == "price" else "classification")
    if name == "XGBoostAdapter":
        trees = XGBoostTrees(adapter)
    elif name == "LightGBMAdapter":
        trees = LightGBMTrees(adapter)
    elif name == "RandomForestAdapter":
        trees = ScikitLearnTrees(adapter.model, task)
    elif name == "SklearnEstimatorAdapter":
        trees = ScikitLearnTrees(adapter.estimator, task, getattr(adapter, "best_iteration", None))
    elif name == "CatBoostAdapter":
        trees = CatBoostTrees(adapter)
    else:
        raise NotExplained(f"{name} is not a tree model this explainer knows")
    context.cache["tree_ensemble"] = trees
    return trees


# ─── the dispatch contract ─────────────────────────────────────────────────


def structure_block(context) -> dict:
    trees = ensemble(context)
    return {
        "baseValue": trees.base_value,
        "trees": {
            "treeCount": trees.tree_count,
            "usedTreeCount": trees.used_count,
            "aggregation": trees.aggregation,
            "learningRate": trees.learning_rate,
            **trees.statistics(context.features.shape[1]),
            "oblivious": trees.oblivious,
            "splitRule": trees.split_rule,
        },
    }


def tree(context, tree_index: int) -> dict:
    trees = ensemble(context)
    if not 0 <= tree_index < trees.tree_count:
        raise ExplainError(f"This model has {trees.tree_count} trees: there is no tree {tree_index + 1}.")
    return trees.tree_reply(int(tree_index))


def _row32(context, row: int) -> np.ndarray:
    inputs, _ = context.model_inputs([row])
    return np.ascontiguousarray(inputs[0], dtype=np.float32)


def bar_block(context, row: int) -> dict:
    trees = ensemble(context)
    row32 = _row32(context, row)
    leaves = trees.leaves(row32)
    if leaves.size != trees.used_count:
        raise RuntimeError(f"the library returned {leaves.size} leaves for {trees.used_count} trees")
    leaf_values = np.array([trees.leaf_value(t, int(leaf)) for t, leaf in enumerate(leaves)], dtype=np.float64)
    raw = trees.raw(row32, leaf_values)
    if trees.aggregation == "sum":
        base = raw - float(np.sum(leaf_values))
        running = base + np.cumsum(leaf_values)
    else:
        base = 0.0
        running = np.cumsum(leaf_values) / np.arange(1, leaf_values.size + 1)
        running[-1] = raw
    offsets, nodes, features, thresholds, went_left = [0], [], [], [], []
    for t, leaf in enumerate(leaves):
        for node, feature, threshold, left in trees.steps(t, int(leaf), row32):
            nodes.append(node)
            features.append(feature)
            thresholds.append(threshold)
            went_left.append(left)
        offsets.append(len(nodes))
    return {
        "trees": {
            "baseValue": base,
            "leafValues": leaf_values,
            "runningTotal": running,
            "leafNode": leaves,
            "pathOffsets": offsets,
            "pathNode": nodes,
            "pathFeature": features,
            "pathThreshold": thresholds,
            "pathWentLeft": went_left,
        },
        "output": {"raw": raw},
    }


def _gate(name: str, error: float | None, tolerance: float, detail: str) -> dict:
    return {"gate": name, "passed": None if error is None else error <= tolerance, "error": error,
            "tolerance": tolerance, "detail": detail}


def check(context, row: int, bar: dict) -> list[dict]:
    """G2 (the link on base + Σ leaves, or the mean of the leaves, reproduces
    the output; also with the model's declared base) and G3 (every recorded
    path, re-evaluated with the library's own comparison, reaches the recorded
    leaf; for catboost the answers spell the leaf index the library chose)."""
    block = bar.get("trees")
    if block is None:
        return [_gate("G2", None, G2_TOLERANCE, "the bar carries no trees"),
                _gate("G3", None, 0.0, "the bar carries no trees")]
    trees = ensemble(context)
    expected = reported_output(bar)
    leaf_values = np.asarray(block["leafValues"], dtype=np.float64)
    if trees.aggregation == "sum":
        total = float(block["baseValue"]) + float(np.sum(leaf_values))
    else:
        total = float(np.mean(leaf_values))
    linked = link_output(bar["link"], total, context)
    errors = [abs(linked - expected)] if linked is not None else []
    detail = f"{bar['link']}({total!r}) = {linked!r} against {expected!r}"
    if trees.aggregation == "sum" and trees.base_value is not None and linked is not None:
        declared = link_output(bar["link"], trees.base_value + float(np.sum(leaf_values)), context)
        errors.append(abs(declared - expected))
        detail += f"; with the declared base {trees.base_value!r}: {declared!r}"
    gates = [_gate("G2", max(errors) if errors else None, G2_TOLERANCE, detail)]

    row32 = _row32(context, row)
    offsets = block["pathOffsets"]
    mismatches = 0
    first = ""
    for t, leaf in enumerate(block["leafNode"]):
        steps = range(offsets[t], offsets[t + 1])
        if trees.oblivious:
            spelled = 0
            for level, position in enumerate(steps):
                answer = trees.went_left(t, level, row32)
                if answer != block["pathWentLeft"][position]:
                    mismatches += 1
                    first = first or f"tree {t + 1} level {level + 1}"
                spelled += int(answer) << level
            if spelled != int(leaf):
                mismatches += 1
                first = first or f"tree {t + 1}: the answers spell leaf {spelled}, the library chose {leaf}"
            continue
        node = 0
        for position in steps:
            if block["pathNode"][position] != node:
                mismatches += 1
                first = first or f"tree {t + 1} step {position - offsets[t] + 1}: recorded node differs"
                break
            answer = trees.went_left(t, node, row32)
            if answer != block["pathWentLeft"][position]:
                mismatches += 1
                first = first or f"tree {t + 1} node {node}"
            node = trees.child(t, node, answer)
        if node != int(leaf):
            mismatches += 1
            first = first or f"tree {t + 1}: re-evaluation reaches node {node}, the library chose leaf {leaf}"
    gates.append(_gate("G3", float(mismatches), 0.0,
                       f"{len(block['leafNode'])} paths re-evaluated with the {trees.split_rule} rule"
                       + (f"; first difference: {first}" if first else "")))
    return gates


__all__ = ["CatBoostTrees", "LightGBMTrees", "ScikitLearnTrees", "XGBoostTrees", "bar_block", "check", "ensemble",
           "structure_block", "tree"]
