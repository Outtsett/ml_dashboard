"""Discretising the feature row and learning a discrete Bayesian network on the training span.

- ``select_columns``: the feature columns whose training-quantile bins carry the
  most mutual information with the training direction.
- ``Discretizer``: train-quantile bins per chosen column
  (``cycle.bridges.binning.QuantileBins``); a bar's evidence is its own row's
  bin codes (-1 when missing, i.e. unobserved).
- ``learn_structure``: pgmpy's structure search on the complete training rows
  (hill climbing on the BIC score with a parent limit, the tree-augmented naive
  Bayes tree, or plain naive Bayes).
- ``bdeu_tables``: conditional probability tables with the BDeu prior
  (Dirichlet pseudo-count ``equivalent_sample_size / (r q)`` per cell, as
  pgmpy's ``BayesianEstimator``), each laid out (parents..., node) so it is a
  ``factors.Factor`` as it stands.

Everything here reads training rows only; nothing is stored but numbers
(edges, bin edges, tables), so a saved model needs no pgmpy object.
"""

from __future__ import annotations

import logging
import warnings

import numpy as np

from cycle.bridges.binning import QuantileBins


def mutual_information(codes: np.ndarray, target: np.ndarray, states: int) -> float:
    usable = (codes >= 0) & np.isfinite(target)
    if usable.sum() < 2:
        return 0.0
    joint = np.zeros((states, 2))
    np.add.at(joint, (codes[usable], target[usable].astype(np.int64)), 1.0)
    joint /= joint.sum()
    outer = joint.sum(axis=1, keepdims=True) * joint.sum(axis=0, keepdims=True)
    with np.errstate(divide="ignore", invalid="ignore"):
        return float(np.nansum(joint * np.log(joint / outer)))


def select_columns(features: np.ndarray, rows: np.ndarray, direction: np.ndarray, count: int, bin_count: int) -> list[int]:
    target = np.asarray(direction, dtype=np.float64)[rows]
    scored = []
    for column in range(features.shape[1]):
        bins = QuantileBins.fit(np.asarray(features[rows, column], dtype=np.float64), bin_count)
        if bins.bin_count < 2:
            continue
        scored.append((-mutual_information(bins.assign(features[rows, column]), target, bins.bin_count), column))
    scored.sort()
    return [column for _, column in scored[: max(1, count)]]


class Discretizer:
    def __init__(self, columns: list[int], bins: list[QuantileBins]) -> None:
        self.columns = columns
        self.bins = bins

    @classmethod
    def fit(cls, features, rows, columns, bin_count) -> Discretizer:
        return cls(list(columns), [QuantileBins.fit(np.asarray(features[rows, c], dtype=np.float64), bin_count)
                                   for c in columns])

    @property
    def cardinalities(self) -> list[int]:
        return [item.bin_count for item in self.bins]

    def codes(self, features, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        if not self.bins:
            return np.zeros((rows.size, 0), dtype=np.int64)
        return np.column_stack([item.assign(np.asarray(features[rows, c], dtype=np.float64))
                                for c, item in zip(self.columns, self.bins)])

    def to_dict(self) -> dict:
        return {"columns": [int(c) for c in self.columns], "bins": [item.to_dict() for item in self.bins]}

    @classmethod
    def from_dict(cls, document) -> Discretizer:
        return cls([int(c) for c in document["columns"]], [QuantileBins.from_dict(item) for item in document["bins"]])


def learn_structure(codes: np.ndarray, names: list[str], cardinalities: list[int], method: str, maximum_parents: int,
                    target: str) -> list[tuple[str, str]]:
    """Directed edges (parent, child) over ``names`` learned from complete rows of ``codes``."""
    if method == "naive":
        return [(target, name) for name in names if name != target]
    import pandas as pd

    frame = pd.DataFrame({name: pd.Categorical(codes[:, position], categories=list(range(cardinalities[position])))
                          for position, name in enumerate(names)})
    quiet = logging.getLogger("pgmpy")
    level = quiet.level
    quiet.setLevel(logging.ERROR)
    try:
        with warnings.catch_warnings():
            # pgmpy 1.1 keeps TreeSearch only in pgmpy.estimators, whose import warns about its own deprecations
            warnings.simplefilter("ignore", FutureWarning)
            if method == "tree_augmented":
                from pgmpy.estimators import TreeSearch

                root = next(name for name in names if name != target)
                dag = TreeSearch(frame, root_node=root, n_jobs=1).estimate(estimator_type="tan", class_node=target,
                                                                 show_progress=False)
            else:
                from pgmpy.causal_discovery import HillClimbSearch

                search = HillClimbSearch(scoring_method="bic-d", max_indegree=int(maximum_parents), return_type="dag",
                                         show_progress=False)
                dag = search.fit(frame).causal_graph_
    finally:
        quiet.setLevel(level)
    return sorted((str(parent), str(child)) for parent, child in dag.edges())


def parents_of(edges: list[tuple[str, str]], names: list[str]) -> dict[str, list[str]]:
    order = {name: position for position, name in enumerate(names)}
    parents: dict[str, list[str]] = {name: [] for name in names}
    for parent, child in edges:
        parents[child].append(parent)
    return {name: sorted(values, key=order.__getitem__) for name, values in parents.items()}


def bdeu_tables(codes: np.ndarray, names: list[str], cardinalities: list[int], parents: dict[str, list[str]],
                equivalent_sample_size: float) -> dict[str, np.ndarray]:
    """P(node | parents) with the BDeu prior; axes (parents..., node)."""
    position = {name: index for index, name in enumerate(names)}
    tables = {}
    for name in names:
        own = cardinalities[position[name]]
        shape = [cardinalities[position[p]] for p in parents[name]] + [own]
        counts = np.zeros(shape)
        columns = [position[p] for p in parents[name]] + [position[name]]
        np.add.at(counts, tuple(codes[:, c] for c in columns), 1.0)
        configurations = int(np.prod(shape[:-1])) if shape[:-1] else 1
        pseudo = float(equivalent_sample_size) / (own * configurations)
        smoothed = counts + pseudo
        tables[name] = smoothed / smoothed.sum(axis=-1, keepdims=True)
    return tables


__all__ = ["Discretizer", "bdeu_tables", "learn_structure", "mutual_information", "parents_of", "select_columns"]
