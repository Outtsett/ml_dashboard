"""What every model's explanation shares (``src/shared/cycle/explain.ts``).

``ExplainContext`` (documented field by field in ``cycle/explain/__init__.py``)
is one fold model of one run, reloaded the way the engine saved it. From it
the core builds, for any model:

- the **inputs**: the model's inputs for the bar (through the adapter's own
  scaler when the core knows it), the same features before the z-score, where
  each sits among the fold's training bars, and for a model that reads a
  window of bars the window;
- the **output chain**: direction — P(up); price — target units, the scale in
  points per unit, the move in points and the predicted close; ``raw`` is the
  value before the link, inverted from the output generically (the kind module
  replaces it with the library's exact margin when it has one);
- **engineReload** (the reloaded adapter's own prediction, what the engine
  called during the walk) and **streamed** (what the engine wrote to
  ``predictions.parquet`` for the bar, in the same units), for gate G1;
- the **link** from the registry entry.

The kind-specific blocks come from the kind modules (``KIND_MODULES``) and stay
null when there is none.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np

from . import ExplainError, NotExplained, artifacts, kind_module

LOGIT_CLIP = 1e-15
# G1 tolerances (explain.ts): CPU libraries bit-for-bit up to float noise; torch on CPU; torch trained on the GPU
G1_TOLERANCE_CPU_LIBRARY = 1e-12
G1_TOLERANCE_TORCH_CPU = 1e-6
G1_TOLERANCE_TORCH_CUDA = 1e-4

LEGACY_MEAN_PROBABILITY = ("random_forest",)

STRUCTURE_BLOCKS = ("trees", "linear", "neighbors", "naiveBayes", "supportVectors", "calibration", "stacking", "neural")
BAR_BLOCKS = ("trees", "contributions", "neighbors", "supportVectors", "calibration", "stacking", "neural")


def log(message: str) -> None:
    print(f"[explain] {message}", file=sys.stderr, flush=True)


# ─── JSON: never NaN ───────────────────────────────────────────────────────


def clean(value: Any) -> Any:
    """A JSON-ready copy: numpy scalars and arrays become Python values and
    lists, tuples become lists, and every non-finite float becomes None."""
    if isinstance(value, dict):
        return {str(key): clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(item) for item in value]
    if isinstance(value, np.ndarray):
        return [clean(item) for item in value.tolist()]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        value = float(value)
        return value if math.isfinite(value) else None
    return value


def finite_or_none(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


# ─── the link ──────────────────────────────────────────────────────────────


def link_for(entry: dict | None, model_key: str | None, role: str) -> str:
    """How the raw output becomes the reported output (``cycleExplainLinkSchema``)."""
    if role == "price":
        return "identity"
    if entry is None:
        return "mean_probability" if model_key in LEGACY_MEAN_PROBABILITY else "logistic"
    direction = entry.get("direction") or {}
    if direction.get("mode") == "from_price":
        return "logistic_curve"
    source = direction.get("probability")
    kind = entry.get("explainKind")
    estimator = direction.get("estimator") or ""
    if source == "legacy":
        family = entry.get("legacyFamily") or model_key
        return "mean_probability" if family in LEGACY_MEAN_PROBABILITY else "logistic"
    if source == "probit":
        return "probit"
    if source == "logistic_curve_on_validation":
        return "logistic_curve"
    if source == "network":
        return "logistic"
    # predict_proba: what the library does inside it
    if kind == "trees":
        return "logistic" if "GradientBoosting" in estimator or "HistGradientBoosting" in estimator else "mean_probability"
    return {
        "oblivious_trees": "logistic",
        "linear": "logistic",
        "neighbors": "vote",
        "naive_bayes": "posterior",
        "calibration": "calibration_map",
        "stacking": "logistic",
        "support_vectors": "logistic_curve",
        "neural": "logistic",
    }.get(kind, "logistic")


def _logit(probability: float) -> float:
    p = min(1.0 - LOGIT_CLIP, max(LOGIT_CLIP, float(probability)))
    return math.log(p / (1.0 - p))


def _probit_inverse(probability: float) -> float:
    from scipy.special import ndtri

    p = min(1.0 - LOGIT_CLIP, max(LOGIT_CLIP, float(probability)))
    return float(ndtri(p))


# ─── the context ───────────────────────────────────────────────────────────


def _registry_entry(key: str | None) -> dict | None:
    if not key:
        return None
    from cycle import catalog

    try:
        return catalog.entry(key)
    except Exception:  # noqa: BLE001 - a key the registry does not carry explains as a plain model
        return None


def _load_adapter(directory: str, device: str = "cpu"):
    from cycle.models import load_adapter

    return load_adapter(directory, device=device)


class ExplainContext:
    """One fold model of one run (see ``cycle/explain/__init__.py`` for every attribute)."""

    def __init__(self, *, run: artifacts.RunArrays, fold: int, role: str, model_directory: Path, metadata: dict,
                 adapter, index: dict[str, np.ndarray], signature: tuple) -> None:
        self.run = run
        self.run_directory = run.run_directory
        self.model_id = Path(run.run_directory).name
        self.manifest = run.manifest
        self.fold = int(fold)
        self.role = role
        self.model_directory = str(model_directory)
        self.metadata = metadata
        self.adapter = adapter
        self.explained_adapter = getattr(adapter, "price_adapter", None) if metadata.get("adapter") == "derived" else adapter
        if self.explained_adapter is None:
            self.explained_adapter = adapter
        self.model_key = self.manifest.get("modelKey") or metadata.get("key") or metadata.get("family")
        self.entry = _registry_entry(self.model_key)
        kind = self.manifest.get("explainKind") or (self.entry or {}).get("explainKind")
        if kind is None:
            raise ExplainError(f"The model {self.model_key!r} has no explanation kind in the registry.")
        self.explain_kind = kind
        self.direction_mode = self.manifest.get("directionMode") or ((self.entry or {}).get("direction") or {}).get("mode") \
            or "classifier"
        self.link = link_for(self.entry, self.model_key, role)
        self.features = run.features
        self.raw_features = run.raw_features
        self.raw_available = run.raw_available
        self.timestamps = run.timestamps
        self.close = run.close
        self.move_scale = run.move_scale
        self.labels = run.labels
        self.price_target = run.price_target
        self.index = index
        # the rows the model was actually fitted on: a direction-from-price model is its price model
        # (fitted on the price rows), whose logistic curve was fitted on the direction validation rows
        if role == "price":
            self.training_rows = index["price_train"] if index["price_train"].size else index["train"]
            self.validation_rows = index["price_validation"] if index["price_validation"].size else index["validation"]
        elif metadata.get("adapter") == "derived":
            self.training_rows = index["price_train"] if index["price_train"].size else index["train"]
            self.validation_rows = index["validation"]
        else:
            self.training_rows = index["train"]
            self.validation_rows = index["validation"]
        self.minimum_history = max(1, int(adapter.minimum_history()))
        self.sequence = bool((self.entry or {}).get("sequence")) or self.minimum_history > 1
        self.feature_names = list(self.manifest.get("featureNames", []))
        self.feature_display_names = list(self.manifest.get("featureDisplayNames", [])) or \
            [name.replace("_", " ") for name in self.feature_names]
        self.signature = signature
        self.cache: dict = {}
        self._scaler: Callable[[np.ndarray], np.ndarray] | None | bool = False

    # ── rows and inputs ──
    def row_of(self, timestamp: int) -> int:
        return self.run.row_of(timestamp)

    def valid(self, row: int) -> bool:
        start = row - self.minimum_history + 1
        if start < 0 or row >= self.features.shape[0]:
            return False
        return bool(np.isfinite(self.features[start:row + 1]).all())

    def scaler(self) -> Callable[[np.ndarray], np.ndarray] | None:
        """The adapter's own input transform when the core knows it, else None."""
        if self._scaler is False:
            self._scaler = _known_scaler(self.explained_adapter)
        return self._scaler  # type: ignore[return-value]

    def model_inputs(self, rows) -> tuple[np.ndarray, bool]:
        rows = np.asarray(rows, dtype=np.int64).reshape(-1)
        matrix = np.asarray(self.features[rows], dtype=np.float64)
        transform = self.scaler()
        if transform is None:
            return matrix, False
        return np.asarray(transform(matrix), dtype=np.float64).reshape(matrix.shape), True

    def training_percentiles(self, values: np.ndarray) -> list[float | None]:
        """Where each feature value sits among this fold's training rows, 0..1
        (mid-rank: ties count half), on the unscaled inputs — any per-feature
        scaler is monotone, so the rank is the same."""
        ranked = self.cache.get("_training_sorted")
        if ranked is None:
            rows = self.training_rows
            matrix = self.features[rows] if rows.size else np.empty((0, self.features.shape[1]), dtype=np.float32)
            ranked = [np.sort(column[np.isfinite(column)]) for column in np.asarray(matrix, dtype=np.float64).T]
            self.cache["_training_sorted"] = ranked
        out: list[float | None] = []
        for column, value in zip(ranked, values):
            if column.size == 0 or not math.isfinite(float(value)):
                out.append(None)
                continue
            below = np.searchsorted(column, value, side="left")
            at_or_below = np.searchsorted(column, value, side="right")
            out.append(float((below + at_or_below) / 2.0 / column.size))
        return out

    # ── the model's own predictions ──
    def reload_prediction(self, row: int) -> float:
        """What the reloaded adapter predicts for the row — P(up) clamped to
        [0, 1] exactly as the engine traded it, or the price output in target units."""
        index = np.array([row], dtype=np.int64)
        if self.role == "price":
            value = float(np.asarray(self.adapter.predict_value(self.features, index), dtype=np.float64).reshape(-1)[0])
        else:
            value = float(np.asarray(self.adapter.predict_probability(self.features, index), dtype=np.float64).reshape(-1)[0])
            if math.isfinite(value):
                value = min(1.0, max(0.0, value))
        if not math.isfinite(value):
            raise ExplainError(f"The model returned a non-finite value at this bar ({value}); the engine did not trade it.")
        return value

    def logistic_curve(self) -> tuple[float, float] | None:
        curve = getattr(self.adapter, "logistic_curve", None) if self.role == "direction" else None
        if curve is None:
            return None
        slope, intercept = curve
        return float(slope), float(intercept)


def _known_scaler(adapter) -> Callable[[np.ndarray], np.ndarray] | None:
    scaler = getattr(adapter, "scaler", None)
    if scaler is not None and hasattr(scaler, "transform"):
        return lambda matrix: scaler.transform(matrix)
    mean = getattr(adapter, "mean", None)
    scale = getattr(adapter, "scale", None)
    if isinstance(mean, np.ndarray) and isinstance(scale, np.ndarray) and mean.ndim == 1 and scale.ndim == 1:
        mean64, scale64 = mean.astype(np.float64), scale.astype(np.float64)
        return lambda matrix: (matrix - mean64) / scale64
    return None


def explain_plan(run: artifacts.RunArrays) -> dict:
    """What ``MarketView.from_explain`` reads: the explain manifest, overlaid by
    the run's ``config.json`` plan once the run has ended (horizon, gap
    multiple, feature names, cost model)."""
    import json

    plan: dict = dict(run.manifest or {})
    path = Path(run.run_directory) / "config.json"
    if path.is_file():
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            plan.update({key: value for key, value in (document.get("plan") or {}).items() if value is not None})
        except (OSError, ValueError):
            pass
    return plan


def _bind_explain_market(adapter, run: artifacts.RunArrays) -> None:
    """Hand a reloaded model that defines ``bind_market`` the run's market as
    the engine had it, minus open, high and low (never saved; fit-only by the
    MarketView read rules). Models without the method are untouched."""
    if not callable(getattr(adapter, "bind_market", None)):
        return
    from cycle.market import MarketView

    adapter.bind_market(MarketView.from_explain(run, explain_plan(run)))


def build_context(run: artifacts.RunArrays, fold: int, role: str, *, adapter_loader=None) -> ExplainContext:
    """Reload one fold model (``cycle.models.load_adapter(dir, device="cpu")``
    unless the tests hand an ``adapter_loader(directory) -> adapter``)."""
    directory = artifacts.require_ready(run.run_directory, run.manifest, fold, role)
    signature = artifacts.model_signature(directory)
    metadata = artifacts.read_model_metadata(directory)
    index = artifacts.load_fold_index(run.run_directory, fold)
    loader = adapter_loader or (lambda folder: _load_adapter(folder, device="cpu"))
    adapter = loader(str(directory))
    _bind_explain_market(adapter, run)
    return ExplainContext(run=run, fold=fold, role=role, model_directory=directory, metadata=metadata,
                          adapter=adapter, index=index, signature=signature)


# ─── replies ───────────────────────────────────────────────────────────────


def _kind_call(context: ExplainContext, name: str, *arguments) -> dict | None:
    module = kind_module(context.explain_kind)
    function = getattr(module, name, None) if module is not None else None
    if function is None:
        return None
    try:
        block = function(context, *arguments)
    except NotExplained as reason:
        log(f"{context.model_id} fold {context.fold} {context.role}: {reason}")
        return None
    return dict(block or {})


def structure_reply(context: ExplainContext) -> dict:
    """``CycleExplainStructure``: what the fitted model is."""
    curve = context.logistic_curve() if context.link == "logistic_curve" else None
    reply: dict = {
        "modelId": context.model_id,
        "foldIndex": context.fold,
        "role": context.role,
        "explainKind": context.explain_kind,
        "link": context.link,
        "baseValue": None,
        "logisticCurve": None if curve is None else {"slope": curve[0], "intercept": curve[1]},
        **{name: None for name in STRUCTURE_BLOCKS},
    }
    block = _kind_call(context, "structure_block")
    if block:
        reply.update(block)
    return clean(reply)


def tree_reply(context: ExplainContext, tree_index: int) -> dict:
    """``CycleExplainTree``: one whole tree."""
    module = kind_module(context.explain_kind)
    function = getattr(module, "tree", None) if module is not None else None
    if function is None:
        raise ExplainError("This model has no trees to draw.", f"explain kind {context.explain_kind}")
    try:
        block = dict(function(context, int(tree_index)) or {})
    except NotExplained as reason:
        raise ExplainError(f"This model's trees cannot be drawn yet: {reason}") from None
    reply = {"modelId": context.model_id, "foldIndex": context.fold, "role": context.role, "treeIndex": int(tree_index),
             "obliviousLevels": None, "obliviousLeafValues": None}
    reply.update(block)
    return clean(reply)


def _format_time(timestamp: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).strftime("%Y-%m-%d %H:%M")


def inputs_block(context: ExplainContext, row: int) -> dict:
    values, scaled = context.model_inputs([row])
    feature_count = context.features.shape[1]
    raw = context.raw_features[row] if context.raw_available else np.full(feature_count, np.nan)
    window = None
    if context.sequence and context.minimum_history > 1:
        rows = np.arange(row - context.minimum_history + 1, row + 1, dtype=np.int64)
        matrix, _ = context.model_inputs(rows)
        window = {"timestamps": [int(t) for t in context.timestamps[rows]], "values": matrix}
    return {
        "values": values[0],
        "scaled": scaled,
        "raw": np.asarray(raw, dtype=np.float64),
        "trainingPercentile": context.training_percentiles(np.asarray(context.features[row], dtype=np.float64)),
        "window": window,
    }


def generic_raw(context: ExplainContext, row: int, output: float) -> float:
    """The value before the link, when it can be had without the kind module:
    the inverse of the link, or (direction from price) the price model's
    forecast itself."""
    link = context.link
    if link == "identity":
        return output
    if link in ("logistic", "posterior"):
        # posterior: raw is the log posterior odds, up minus down — the logit of P(up) for two classes
        return _logit(output)
    if link == "probit":
        return _probit_inverse(output)
    if link == "logistic_curve":
        predict_value = getattr(context.adapter, "predict_value", None)
        if context.metadata.get("adapter") == "derived" and predict_value is not None:
            value = float(np.asarray(predict_value(context.features, np.array([row], dtype=np.int64))).reshape(-1)[0])
            if math.isfinite(value):
                return value
        curve = context.logistic_curve()
        if curve is not None and curve[0] != 0.0:
            return (_logit(output) - curve[1]) / curve[0]
    return output


def _round_to_tick(price: float, tick_size: float) -> float:
    from cycle.simulate import round_to_tick

    return round_to_tick(price, tick_size)


def streamed_value(context: ExplainContext, streamed: artifacts.StreamedPredictions | None, row: int) -> float | None:
    """What the engine streamed for this bar with THIS fold's model, in the
    units of ``engineReload``; None when the run is live or another fold tested the bar."""
    if streamed is None or streamed.fold_by_row.get(row) != context.fold:
        return None
    if context.role == "price":
        move = streamed.predicted_move_points.get(row)
        scale = float(context.move_scale[row])
        if move is None or not math.isfinite(scale) or scale == 0.0:
            return None
        return move / scale
    return streamed.probability_up.get(row)


def bar_reply(context: ExplainContext, timestamp: int, streamed: artifacts.StreamedPredictions | None = None) -> dict:
    """``CycleExplainBar``: one bar, input to output."""
    row = context.row_of(timestamp)
    if not context.valid(row):
        raise ExplainError(
            f"The bar at {_format_time(timestamp)} UTC is inside the feature warm-up: the model makes no prediction there.",
            f"row {row}; the model reads {context.minimum_history} bar(s) and needs every input finite",
        )
    reload = context.reload_prediction(row)
    close = float(context.close[row])
    if context.role == "price":
        scale = finite_or_none(context.move_scale[row])
        move = None if scale is None else reload * scale
        # the chart's forecast is the nearest tick to close + move (the engine rounds the same way)
        tick = artifacts.load_tick_size(context.run_directory)
        predicted_close = None
        if move is not None:
            predicted_close = close + move if tick is None else _round_to_tick(close + move, tick)
        output = {"raw": reload, "probabilityUp": None, "targetUnits": reload, "scale": scale, "movePoints": move,
                  "movePointsOnTick": None if predicted_close is None else predicted_close - close,
                  "close": close, "predictedClose": predicted_close}
    else:
        output = {"raw": generic_raw(context, row, reload), "probabilityUp": reload, "targetUnits": None, "scale": None,
                  "movePoints": None, "close": close, "predictedClose": None}
    reply: dict = {
        "modelId": context.model_id,
        "timestamp": int(context.timestamps[row]),
        "foldIndex": context.fold,
        "role": context.role,
        "explainKind": context.explain_kind,
        "link": context.link,
        "inputs": inputs_block(context, row),
        "output": output,
        "engineReload": reload,
        "streamed": streamed_value(context, streamed, row),
        **{name: None for name in BAR_BLOCKS},
    }
    block = _kind_call(context, "bar_block", row)
    if block:
        partial_output = block.pop("output", None)
        for name in ("engineReload", "streamed", "inputs", "modelId", "timestamp", "foldIndex", "role"):
            block.pop(name, None)
        reply.update(block)
        if partial_output:
            reply["output"].update(partial_output)
    if not math.isfinite(float(reply["output"]["raw"])):
        reply["output"]["raw"] = reload
    return clean(reply)


# ─── parity gates ──────────────────────────────────────────────────────────


def g1_tolerance(context: ExplainContext, plan_device: str | None) -> float:
    implementation = (context.entry or {}).get("implementation")
    if implementation == "torch":
        return G1_TOLERANCE_TORCH_CUDA if (plan_device or "cpu") == "cuda" else G1_TOLERANCE_TORCH_CPU
    return G1_TOLERANCE_CPU_LIBRARY


def gate_g1(context: ExplainContext, bar: dict, plan_device: str | None) -> dict:
    """G1: the reloaded adapter's prediction equals what the engine streamed."""
    tolerance = g1_tolerance(context, plan_device)
    streamed = bar.get("streamed")
    if streamed is None:
        return {"gate": "G1", "passed": None, "error": None, "tolerance": tolerance,
                "detail": "nothing streamed for this bar by this fold (live run, or another fold tested it)"}
    error = abs(float(bar["engineReload"]) - float(streamed))
    return {"gate": "G1", "passed": error <= tolerance, "error": error, "tolerance": tolerance,
            "detail": f"reload {bar['engineReload']!r} against streamed {streamed!r}"}


def kind_checks(context: ExplainContext, row: int, bar: dict) -> list[dict]:
    """G2 / G3 / G4 from the kind module's ``check`` hook (none without one)."""
    module = kind_module(context.explain_kind)
    function = getattr(module, "check", None) if module is not None else None
    if function is None:
        return []
    try:
        return [dict(item) for item in (function(context, row, bar) or [])]
    except NotExplained as reason:
        return [{"gate": "kind", "passed": None, "error": None, "tolerance": None, "detail": str(reason)}]


__all__ = [
    "ExplainContext", "bar_reply", "build_context", "clean", "g1_tolerance", "gate_g1", "generic_raw", "inputs_block",
    "kind_checks", "link_for", "streamed_value", "structure_reply", "tree_reply",
]
