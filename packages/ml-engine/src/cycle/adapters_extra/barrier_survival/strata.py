"""Kaplan-Meier / Aalen-Johansen per stratum.

Kaplan-Meier takes no covariates, so the bars are first split into strata by a
shallow decision tree (scikit-learn CART, depth ``max_depth``, leaves of at
least ``min_samples_leaf`` bars) fitted on the training span's uncensored
walks to the first-touch side. Inside each leaf the competing-risks
Kaplan-Meier (Aalen-Johansen, ``incidence.aalen_johansen``) gives CIF_up and
CIF_down on the bar grid; P(up) of a new bar is its leaf's
CIF_up(h) / (CIF_up(h) + CIF_down(h)).

The tree is saved as its node arrays (no pickle) and walked here exactly as
scikit-learn does (features compared as float32, ``<=`` goes left).
"""

from __future__ import annotations

import numpy as np

from . import incidence


def apply_tree(features: np.ndarray, left: np.ndarray, right: np.ndarray, feature: np.ndarray,
               threshold: np.ndarray) -> np.ndarray:
    """Leaf node id of each row (scikit-learn's ``tree_.apply``)."""
    values = np.asarray(features, dtype=np.float32).astype(np.float64)
    node = np.zeros(values.shape[0], dtype=np.int64)
    for _ in range(int(left.size)):
        internal = left[node] != -1
        if not internal.any():
            break
        rows = np.flatnonzero(internal)
        current = node[rows]
        go_left = values[rows, feature[current]] <= threshold[current]
        node[rows] = np.where(go_left, left[current], right[current])
    return node


class StratifiedKaplanMeier:
    name = "kaplan_meier"

    def __init__(self, max_depth: int, min_samples_leaf: int, maximum_hold_bars: int, seed: int) -> None:
        self.max_depth = int(max_depth)
        self.min_samples_leaf = int(min_samples_leaf)
        self.maximum_hold_bars = int(maximum_hold_bars)
        self.seed = int(seed)
        self.left = np.array([-1], dtype=np.int64)
        self.right = np.array([-1], dtype=np.int64)
        self.feature = np.array([-2], dtype=np.int64)
        self.threshold = np.array([-2.0])
        self.cif_up = np.zeros((1, self.maximum_hold_bars + 1))
        self.cif_down = np.zeros((1, self.maximum_hold_bars + 1))
        self.leaf_sizes = np.zeros(1, dtype=np.int64)
        self.summary: dict = {}

    def fit(self, features: np.ndarray, durations, log) -> dict:
        from sklearn.tree import DecisionTreeClassifier

        uncensored = durations.cause != 0
        side = (durations.cause[uncensored] == 1).astype(np.int64)
        if np.unique(side).size == 2 and self.max_depth > 0:
            tree = DecisionTreeClassifier(max_depth=self.max_depth, min_samples_leaf=self.min_samples_leaf,
                                          random_state=self.seed)
            tree.fit(np.asarray(features, dtype=np.float32)[uncensored], side)
            structure = tree.tree_
            self.left = np.asarray(structure.children_left, dtype=np.int64)
            self.right = np.asarray(structure.children_right, dtype=np.int64)
            self.feature = np.asarray(structure.feature, dtype=np.int64)
            self.threshold = np.asarray(structure.threshold, dtype=np.float64)
        else:
            log("Kaplan-Meier: one first-touch side only (or depth 0); a single stratum", "warn")
        leaves = apply_tree(features, self.left, self.right, self.feature, self.threshold)
        node_count = self.left.size
        hold = self.maximum_hold_bars
        self.cif_up = np.zeros((node_count, hold + 1))
        self.cif_down = np.zeros((node_count, hold + 1))
        self.leaf_sizes = np.zeros(node_count, dtype=np.int64)
        for node in np.unique(leaves):
            members = leaves == node
            self.cif_up[node], self.cif_down[node] = incidence.aalen_johansen(durations.duration[members],
                                                                              durations.cause[members], hold)
            self.leaf_sizes[node] = int(members.sum())
        used = self.leaf_sizes > 0
        self.summary = {"strata": int(used.sum()), "smallest_stratum": int(self.leaf_sizes[used].min()),
                        "largest_stratum": int(self.leaf_sizes[used].max())}
        return self.summary

    def incidence(self, features: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
        leaves = apply_tree(features, self.left, self.right, self.feature, self.threshold)
        return self.cif_up[leaves, horizon], self.cif_down[leaves, horizon]

    def to_state(self) -> tuple[dict, dict]:
        arrays = {"left": self.left, "right": self.right, "feature": self.feature, "threshold": self.threshold,
                  "cif_up": self.cif_up, "cif_down": self.cif_down, "leaf_sizes": self.leaf_sizes}
        info = {"max_depth": self.max_depth, "min_samples_leaf": self.min_samples_leaf,
                "maximum_hold_bars": self.maximum_hold_bars, "seed": self.seed, "summary": self.summary}
        return arrays, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> StratifiedKaplanMeier:
        model = cls(info["max_depth"], info["min_samples_leaf"], info["maximum_hold_bars"], info["seed"])
        for name in ("left", "right", "feature", "leaf_sizes"):
            setattr(model, name, np.asarray(arrays[name], dtype=np.int64))
        for name in ("threshold", "cif_up", "cif_down"):
            setattr(model, name, np.asarray(arrays[name], dtype=np.float64))
        model.summary = dict(info.get("summary") or {})
        return model
