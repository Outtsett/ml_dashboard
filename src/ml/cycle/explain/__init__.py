""""Inside the model": the Python side of ``src/shared/cycle/explain.ts``.

How one fitted fold model of a Model Cycle run turns one bar's inputs into its
output, computed on the model the engine saved (``data/models/<id>/fold_<k>/``)
by the model's own library. One warm CPU-only process serves every request
(``src/ml/cycle/explain_main.py --serve``, spawned by
``src/server/training/cycleExplainer.ts``); the same code runs in-process for
the tests and ``scripts/verify_cycle_explain.py``.

Modules

    artifacts   the run's files: ``explain/manifest.json`` and arrays, fold
                readiness, ``fold_<k>/index.npz``, ``predictions.parquet``
    common      ``ExplainContext`` and everything every model shares: the inputs
                block, the output chain, the link, G1, the three replies
    server      ``Explainer`` (the cached in-process API) and ``serve(stdin,
                stdout)``, the JSON-lines protocol loop
    trees / linear / probabilistic / neighbors / composite / neural
                the kind modules (written separately; see below)

Every reply is complete and schema-valid without any kind module: the core
fills every field it can for every model and leaves the kind-specific blocks
(``trees``, ``linear``, ``contributions``, ``neighbors``, ``naiveBayes``,
``supportVectors``, ``calibration``, ``stacking``, ``neural``) null.

Kind modules — the dispatch contract
-------------------------------------

``KIND_MODULES`` maps a registry ``explainKind`` to the module that explains
it. The module is imported lazily, the first time a model of that kind is
explained; a module that does not exist yet means its blocks stay null. One
module may serve several kinds (``context.explain_kind`` says which). A module
exposes plain functions of an ``ExplainContext`` (``cycle.explain.common``):

    structure_block(context) -> dict
        Fields of CycleExplainStructure to set, e.g. ``{"trees": {...},
        "baseValue": 0.0}`` or ``{"linear": {...}, "baseValue": intercept}``.
        It may also override ``link`` and ``logisticCurve``. Merged into the
        core's structure (top-level keys replace).

    bar_block(context, row) -> dict
        Fields of CycleExplainBar for bar ``row`` (a row of the explain arrays),
        e.g. ``{"trees": {...}}``, ``{"contributions": {...}}``. The key
        ``"output"`` is special: it is a PARTIAL output merged key by key into
        the core's output (typically ``{"raw": <exact margin>}``, replacing the
        core's generic inverse-link estimate). ``engineReload`` and
        ``streamed`` belong to the core and are never overridden.

    tree(context, tree_index) -> dict                      (optional)
        The CycleExplainTree fields except ``modelId``, ``foldIndex``, ``role``
        and ``treeIndex`` (the core fills those). Absent: the tree request
        fails with "this model has no trees to draw".

    check(context, row, bar) -> list[dict]                 (optional)
        Parity gates G2 / G3 / G4 for one explained bar (``bar`` is the full
        reply the core built, blocks included). Each item:
        ``{"gate": "G2", "passed": bool, "error": float | None,
        "tolerance": float | None, "detail": str}``. Called by
        ``scripts/verify_cycle_explain.py`` and the tests, never per request.

A kind module that cannot explain one particular model (a library it does not
cover yet) raises ``NotExplained("sentence")``: the core leaves that block
null and logs the sentence to stderr. Any other exception is a real failure and
becomes an ``{"ok": false}`` reply. A user-facing refusal (bad fold, bar in the
warm-up, no such timestamp) is an ``ExplainError``.

ExplainContext — what a kind module gets (``cycle.explain.common``)
-------------------------------------------------------------------

One context per (run directory, fold, role), cached by the server while the
model files' modification times are unchanged. Attributes:

    run_directory      absolute path of data/models/<model_id>
    model_id           the folder name
    manifest           explain/manifest.json as written by the engine (dict)
    fold               fold index (int)
    role               "direction" or "price"
    model_directory    fold_<k>/ (direction) or fold_<k>/price_model/ (price)
    metadata           that folder's model.json (dict)
    adapter            the model reloaded by ``cycle.models.load_adapter(model_directory,
                       device="cpu")`` — its predict_probability / predict_value
                       are what the engine called during the walk
    explained_adapter  the adapter that holds the library object: ``adapter``
                       itself, or for a direction-from-price model
                       (``cycle.derived.DerivedDirectionAdapter``) its
                       ``.price_adapter`` (the fitted regressor; the direction
                       output is its forecast through ``adapter.logistic_curve``)
    entry              the registry entry (``cycle.catalog.entry``) or None
    model_key          the registry key (manifest ``modelKey``)
    explain_kind       registry explainKind (trees, linear, neural, ...)
    direction_mode     "classifier" or "from_price"
    link               the CycleExplainLink of this role ("logistic", "identity", ...)
    features           float32 [bars, features]  the model inputs (causal z-scores, NaN warm-up)
    raw_features       float32 [bars, features]  the same columns before the z-score
    raw_available      False when the run wrote no raw columns (then raw_features is NaN)
    timestamps         int64 [bars]
    close              float64 [bars]  (roll-adjusted)
    move_scale         float64 [bars]  points per target unit
    labels             float32 [bars]  1 up, 0 down, NaN unscored
    price_target       float32 [bars]
    index              dict of int64 rows: train, validation, test, price_train, price_validation
    training_rows      the rows this role's model was fitted on: train (direction), price_train
                       (price, and the direction role of a direction-from-price model)
    validation_rows    validation (direction; for direction-from-price the rows its logistic
                       curve was fitted on), or price_validation (price)
    minimum_history    rows one prediction reads (the adapter's minimum_history())
    sequence           True when the model reads a window of bars
    feature_names, feature_display_names
    cache              a dict the kind module may use to memoise per context
                       (e.g. a parsed tree dump); dropped with the context

and methods:

    context.row_of(timestamp) -> int           the bar's row; ExplainError when absent
    context.model_inputs(rows) -> (matrix, scaled)
        float64 [len(rows), features]: the features at those rows, through the
        adapter's own scaler when the core knows it (``.scaler`` with
        ``transform``, or the legacy linear models' ``.mean`` / ``.scale``);
        ``scaled`` says whether it did
    context.scaler()                           that transform, or None
    context.valid(row) -> bool                 the whole window of the row is finite
"""

from __future__ import annotations

import importlib
import sys

# explainKind -> module; lazily imported. A missing module leaves the kind's blocks null.
KIND_MODULES: dict[str, str] = {
    "trees": "cycle.explain.trees",
    "oblivious_trees": "cycle.explain.trees",
    "linear": "cycle.explain.linear",
    "naive_bayes": "cycle.explain.probabilistic",
    "neighbors": "cycle.explain.neighbors",
    "support_vectors": "cycle.explain.composite",
    "calibration": "cycle.explain.composite",
    "stacking": "cycle.explain.composite",
    "neural": "cycle.explain.neural",
    "opaque": "cycle.explain.opaque",      # a runnable model with no view yet: nothing added, nothing guessed
}


class ExplainError(Exception):
    """A refusal the user reads as it is: no such fold, the model is not saved
    yet, the bar is in the feature warm-up, no bar at that time, ..."""

    def __init__(self, message: str, details: str | None = None) -> None:
        super().__init__(message)
        self.details = details


class NotExplained(Exception):
    """Raised by a kind module that cannot explain this particular model; the
    block stays null."""


def _module_name(name: str) -> str:
    """``cycle.x`` in the table, under whatever name this package was imported as."""
    package = (__package__ or "cycle.explain").rsplit(".", 1)[0]
    return package + name[len("cycle"):] if name.startswith("cycle.") else name


_UNAVAILABLE: set[str] = set()


def kind_module(kind: str | None):
    """The module that explains ``kind``, or None when there is none yet."""
    if kind is None or kind not in KIND_MODULES:
        return None
    name = _module_name(KIND_MODULES[kind])
    if name in _UNAVAILABLE:
        return None
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as error:
        if error.name != name:
            raise
        _UNAVAILABLE.add(name)
        print(f"[explain] {name} does not exist yet: {kind} blocks stay empty", file=sys.stderr)
        return None


__all__ = ["KIND_MODULES", "ExplainError", "NotExplained", "kind_module"]
