"""Inside the model, k-nearest neighbors (``explainKind == "neighbors"``).

A k-nearest neighbors model (scikit-learn ``KNeighborsClassifier`` for the
direction, ``KNeighborsRegressor`` for the price) keeps its training bars and,
for a new bar, finds the ``k`` whose inputs are closest to this bar's, then
votes: the (weighted) share of them that went up is P(up); for the price model
the (weighted) mean of their targets is the predicted move.

Everything here is asked of the fitted estimator itself:

- the neighbors: ``estimator.kneighbors`` on this bar's model inputs (through
  the adapter's scaler, the same matrix ``predict_probability`` hands the
  estimator), in the estimator's own metric; the first ``k`` are exactly the
  ones ``predict`` uses (queried with ``n_neighbors=k``), then up to
  ``EXTRA_NEIGHBORS`` more (the next closest) so the view's slider can show
  what a larger ``k`` would have said;
- their targets: the labels the estimator stored at fit (``_y``, mapped
  through ``classes_``: 1 up, 0 down; the price model's clipped training
  targets in target units);
- their weights: scikit-learn's own ``_get_weights`` (uniform: 1; distance:
  1 / distance, and when a neighbor sits at distance 0 the zero-distance ones
  weigh 1 and the rest 0);
- when they happened: a neighbor's position in the fitted matrix is a row of
  ``adapter.training_rows`` (the rows actually fitted), whose timestamp is
  read from the run's arrays;
- ``output.raw``: the library's own ``predict_proba`` P(up) (direction) or
  ``predict`` (price) — the vote.

``check`` (gate G2): the weighted vote of the listed first ``k`` neighbors,
Σ weight × target ÷ Σ weight, equals ``output.raw`` and the model's output
(P(up) or the target units the engine traded), within 1e-6.
"""

from __future__ import annotations

import numpy as np

from . import NotExplained

G2_TOLERANCE = 1e-6
EXTRA_NEIGHBORS = 25          # neighbors listed past the model's own k (at most k more)


# ─── the fitted estimator ──────────────────────────────────────────────────


def _estimator(context):
    estimator = getattr(context.explained_adapter, "estimator", None)
    if estimator is None or not hasattr(estimator, "kneighbors"):
        raise NotExplained(f"the {context.role} model has no fitted k-nearest neighbors estimator (.estimator)")
    if callable(estimator.weights) or estimator.weights not in (None, "uniform", "distance"):
        raise NotExplained(f"neighbor weighting {estimator.weights!r} is not uniform or distance")
    return estimator


def _weighting(estimator) -> str:
    return "distance" if estimator.weights == "distance" else "uniform"


def _fit_rows(context, estimator) -> np.ndarray:
    """The run rows the estimator was fitted on, in the order of its fitted matrix."""
    rows = getattr(context.explained_adapter, "training_rows", None)
    rows = np.asarray(rows if rows is not None else [], dtype=np.int64).reshape(-1)
    if rows.size == 0:
        rows = np.asarray(context.training_rows, dtype=np.int64).reshape(-1)
    fitted = int(estimator.n_samples_fit_)
    if rows.size != fitted:
        raise NotExplained(f"the model was fitted on {fitted} bars but {rows.size} training rows are recorded, "
                           "so its neighbors cannot be placed in time")
    return rows


def _weights(estimator, distances: np.ndarray) -> np.ndarray:
    """scikit-learn's own neighbor weights for one row of distances."""
    try:
        from sklearn.neighbors._base import _get_weights
    except ImportError:  # pragma: no cover - the rule of scikit-learn 1.x, for a version that moved it
        _get_weights = None
    row = np.asarray(distances, dtype=np.float64).reshape(1, -1)
    if _get_weights is not None:
        weights = _get_weights(row, estimator.weights)
    elif estimator.weights == "distance":  # pragma: no cover
        with np.errstate(divide="ignore"):
            weights = 1.0 / row
        infinite = np.isinf(weights)
        if infinite.any():
            weights = infinite.astype(np.float64)
    else:  # pragma: no cover
        weights = None
    if weights is None:
        return np.ones(row.shape[1], dtype=np.float64)
    return np.asarray(weights, dtype=np.float64).reshape(-1)


def _targets(estimator, positions: np.ndarray, role: str) -> np.ndarray:
    """What each neighbor did: 1 up / 0 down (direction), its training target in target units (price)."""
    stored = np.asarray(estimator._y)
    if stored.ndim > 1:
        if stored.shape[1] != 1:
            raise NotExplained("the neighbors model predicts more than one output")
        stored = stored[:, 0]
    values = stored[positions]
    if role == "price" or not hasattr(estimator, "classes_"):
        return np.asarray(values, dtype=np.float64)
    classes = np.asarray(estimator.classes_)
    return np.asarray(classes[values] == 1, dtype=np.float64)


# ─── the kind-module contract ──────────────────────────────────────────────


def structure_block(context) -> dict:
    estimator = _estimator(context)
    return {
        "baseValue": None,
        "neighbors": {
            "neighborCount": int(estimator.n_neighbors),
            "weighting": _weighting(estimator),
            "trainingBarCount": int(estimator.n_samples_fit_),
        },
    }


def neighbor_positions(context, row: int) -> tuple[np.ndarray, np.ndarray, int]:
    """(distances, positions in the fitted matrix, k) of the listed neighbors:
    the model's own k first (closest first, exactly the ones ``predict`` uses),
    then up to ``EXTRA_NEIGHBORS`` of the next closest."""
    estimator = _estimator(context)
    matrix, _ = context.model_inputs([row])
    k = int(estimator.n_neighbors)
    fitted = int(estimator.n_samples_fit_)
    distances, positions = estimator.kneighbors(matrix, n_neighbors=k)
    distances, positions = distances[0], positions[0]
    listed = min(fitted, k + min(k, EXTRA_NEIGHBORS))
    if listed > k:
        more_distances, more_positions = estimator.kneighbors(matrix, n_neighbors=listed)
        chosen = set(int(p) for p in positions)
        extra = [(d, p) for d, p in zip(more_distances[0], more_positions[0]) if int(p) not in chosen][:listed - k]
        if extra:
            distances = np.concatenate([distances, [d for d, _ in extra]])
            positions = np.concatenate([positions, [p for _, p in extra]])
    return np.asarray(distances, dtype=np.float64), np.asarray(positions, dtype=np.int64), k


def bar_block(context, row: int) -> dict:
    estimator = _estimator(context)
    fit_rows = _fit_rows(context, estimator)
    distances, positions, _ = neighbor_positions(context, row)
    matrix, _ = context.model_inputs([row])
    if context.role == "price":
        raw = float(np.asarray(estimator.predict(matrix), dtype=np.float64).reshape(-1)[0])
    else:
        up = int(np.flatnonzero(np.asarray(estimator.classes_) == 1)[0])
        raw = float(estimator.predict_proba(matrix)[0, up])
    return {
        "output": {"raw": raw},
        "neighbors": {
            "timestamps": [int(t) for t in context.timestamps[fit_rows[positions]]],
            "distances": distances,
            "targets": _targets(estimator, positions, context.role),
            "weights": _weights(estimator, distances),
        },
    }


def check(context, row: int, bar: dict) -> list[dict]:
    """G2: the vote of the listed first k neighbors is the model's output."""
    block = bar.get("neighbors")
    if not block:
        return [{"gate": "G2", "passed": False, "error": None, "tolerance": G2_TOLERANCE,
                 "detail": "the bar carries no neighbors"}]
    k = int(_estimator(context).n_neighbors)
    weights = np.asarray(block["weights"][:k], dtype=np.float64)
    targets = np.asarray(block["targets"][:k], dtype=np.float64)
    vote = float(np.sum(weights * targets) / np.sum(weights))
    reported = float(bar["output"]["probabilityUp"] if context.role == "direction" else bar["output"]["targetUnits"])
    error = max(abs(vote - float(bar["output"]["raw"])), abs(vote - reported), abs(vote - float(bar["engineReload"])))
    return [{"gate": "G2", "passed": error <= G2_TOLERANCE, "error": error, "tolerance": G2_TOLERANCE,
             "detail": f"weighted vote of the first {k} neighbors {vote!r} against the output {reported!r}"}]


__all__ = ["EXTRA_NEIGHBORS", "bar_block", "check", "neighbor_positions", "structure_block"]
