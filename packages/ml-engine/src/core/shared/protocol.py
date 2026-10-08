"""
Stdout Protocol — JSON event emitters for ML training scripts.

Reusable by any ML script that communicates with the Node.js training
pipeline via stdout. Each function emits a JSON line that the parser
registry (server/training/runners/parsers/) knows how to handle.

Event types:
  progress             — iteration / phase progress
  metric               — per-iteration numeric metric
  metric_declarations  — self-describing metric schema (renderer, mission, context)
  config               — config snapshot (model / data / optimizer / schedule / HPO)
  overlay              — chart overlay update (regime zones, predictions, etc.)
  model_state          — full model state snapshot (cluster quality, feature attribution, etc.)
  sampler_diagnostics  — sampler health metrics (ESS, autocorrelation, step timing)
  log                  — human-readable log message
  done                 — training complete + diagnostics
  error                — training failed

Envelope (schema v1, added 2026-07-28 — provenance stage 1)
-----------------------------------------------------------
Every event emitted by this module is wrapped by `_envelope()`, which adds
identity + ordering fields on top of the historical flat payload:

  v, kind, ts, mono_ns, seq, run_id, experiment_id, catalog_id,
  trial_idx, fold_idx, config_hash, manifest_hash, data

Identity comes from the environment (`ML_RUN_ID`, `ML_EXPERIMENT_ID`,
`ML_CATALOG_ID`, `ML_CONFIG_HASH`, `ML_MANIFEST_HASH`), which the Node
orchestrator sets on the child process *before* spawn. Fold/trial
coordinates come from `set_active_fold()` / `set_active_trial()`.

**Transition form — the payload is emitted TWICE**: once flat at the top
level exactly as before, and once nested under `data`. That duplication is
deliberate. `XgbClassifierParser` (`apps/api/training/runners/parsers/
xgbClassifier.ts`) reads the flat fields with no Zod schema and no
passthrough, so a nested-only cutover breaks it on the first event. When
every runner reads `data`, bump `_ENVELOPE_VERSION` to 2 and drop the flat
copy.

Zero call-site changes: every `emit_*` signature is unchanged.
"""

import json
import math
import os
import time
from datetime import datetime, timezone

# ─── Envelope context ────────────────────────────────────────────────────────

_ENVELOPE_VERSION = 1
_DEFAULT_KIND = "training"

# Monotonic origin — captured once at import so `mono_ns` is "nanoseconds since
# this process started emitting", immune to wall-clock adjustments.
_T0_NS = time.perf_counter_ns()

# Per-process event counter. A gap in `seq` on the consumer side proves a
# dropped stdout line; without it a drop is indistinguishable from silence.
_SEQ = 0

# Fold / trial coordinates. These are *coordinates*, not identifiers — the
# physical identity of a run is `run_id` (see the identity hierarchy in
# `~/.claude/plans/reactive-percolating-ullman.md` §2.1).
_ACTIVE_FOLD = None
_ACTIVE_TRIAL = None

_ENV_KEYS = {
    "run_id": "ML_RUN_ID",
    "experiment_id": "ML_EXPERIMENT_ID",
    "catalog_id": "ML_CATALOG_ID",
    "config_hash": "ML_CONFIG_HASH",
    "manifest_hash": "ML_MANIFEST_HASH",
}


def _read_env_context() -> dict:
    """Snapshot the ML_* identity variables. Absent variables map to ``None``.

    ``None`` — not ``""`` — because a headless `scripts/train_*.py` invocation
    legitimately has no orchestrator-minted identity, and the Node side
    synthesizes those fields from its spawn record. An empty string would be
    indistinguishable from a real (if useless) identifier.
    """
    return {field: (os.environ.get(var) or None) for field, var in _ENV_KEYS.items()}


_CONTEXT = _read_env_context()


def refresh_env_context() -> dict:
    """Re-read the ML_* environment variables into the module context.

    The context is captured at import because the orchestrator sets the
    variables before `spawn`. This hook exists for in-process callers (tests,
    notebook drivers) that mutate `os.environ` after import.
    """
    global _CONTEXT
    _CONTEXT = _read_env_context()
    return dict(_CONTEXT)


def set_active_fold(idx) -> None:
    """Set the walk-forward fold coordinate stamped on every later event."""
    global _ACTIVE_FOLD
    _ACTIVE_FOLD = None if idx is None else int(idx)


def set_active_trial(idx) -> None:
    """Set the HPO trial coordinate stamped on every later event."""
    global _ACTIVE_TRIAL
    _ACTIVE_TRIAL = None if idx is None else int(idx)


def get_active_coordinates() -> dict:
    """Return the current ``{trial_idx, fold_idx}`` coordinates."""
    return {"trial_idx": _ACTIVE_TRIAL, "fold_idx": _ACTIVE_FOLD}


def _rfc3339_now() -> str:
    """UTC wall clock, RFC3339 with millisecond precision and a ``Z`` suffix."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _next_seq() -> int:
    global _SEQ
    seq = _SEQ
    _SEQ += 1
    return seq


def _envelope(
    event_type: str,
    payload: dict,
    kind: str = _DEFAULT_KIND,
    *,
    nested_copy: bool = True,
) -> dict:
    """Wrap a flat emitter payload in the common v1 envelope.

    Field order matters only for readability; `payload` is applied *after* the
    envelope defaults so an emitter that carries its own coordinate (e.g.
    `emit_fold_complete`'s `fold_idx`) wins over the module-level active one
    rather than being nulled by it.

    ``nested_copy=False`` drops the transition-form ``data`` duplicate. The
    `cycle_*` events use it: they carry thousands of bars per line, every
    consumer of them reads the flat fields, and none of them goes through
    `XgbClassifierParser`, which is what the duplicate exists for.
    """
    envelope = {
        "type": event_type,
        "v": _ENVELOPE_VERSION,
        "kind": kind,
        "ts": _rfc3339_now(),
        "mono_ns": time.perf_counter_ns() - _T0_NS,
        "seq": _next_seq(),
        "run_id": _CONTEXT["run_id"],
        "experiment_id": _CONTEXT["experiment_id"],
        "catalog_id": _CONTEXT["catalog_id"],
        "trial_idx": _ACTIVE_TRIAL,
        "fold_idx": _ACTIVE_FOLD,
        "config_hash": _CONTEXT["config_hash"],
        "manifest_hash": _CONTEXT["manifest_hash"],
    }
    envelope.update(payload)
    envelope["type"] = event_type  # payload may not override the discriminator
    if nested_copy:
        envelope["data"] = dict(payload)
    return envelope


def json_safe(obj):
    """Recursively replace non-finite floats with ``None`` so the result is
    strictly-valid JSON.

    Python's ``json`` emits bare ``NaN`` / ``Infinity`` / ``-Infinity`` tokens by
    default. Python reads those back, but they are NOT valid JSON: every
    ``JSON.parse`` on the Node/browser side rejects the whole document. A single
    NaN metric therefore made an entire `diagnostics.json` unreadable and 500'd
    `/api/training/models/:id/diagnostics` (verified against
    `data/models/xgb_baseline_post_w2c/diagnostics.json`).

    ``None`` — not ``0`` — is the correct substitute: a NaN here means "this bin
    was empty" / "this metric is undefined", and zero would be a real value that
    silently corrupts averages and charts.

    numpy scalars/arrays are handled by duck-typing (``.item()`` / ``.tolist()``)
    so this module stays dependency-free for callers that never import numpy.
    """
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    if isinstance(obj, bool):
        return obj  # bool is a subclass of int — must precede the float branch
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    # numpy arrays / scalars, without importing numpy.
    tolist = getattr(obj, "tolist", None)
    if callable(tolist) and not isinstance(obj, (str, bytes)):
        return json_safe(tolist())
    item = getattr(obj, "item", None)
    if callable(item) and not isinstance(obj, (str, bytes)):
        try:
            return json_safe(item())
        except (ValueError, TypeError):
            return obj
    return obj


def dumps_safe(obj, **kwargs) -> str:
    """``json.dumps`` that can never emit a non-finite token.

    ``allow_nan=False`` is an assertion, not the mechanism — `json_safe` has
    already removed every non-finite value. If one still slips through we would
    rather see it than silently write an unparseable artifact.
    """
    kwargs.setdefault("default", str)
    return json.dumps(json_safe(obj), allow_nan=False, **kwargs)


def emit(event: dict):
    """Write a JSON event to stdout (unbuffered)."""
    try:
        line = dumps_safe(event)
    except (ValueError, TypeError) as exc:
        # Never let a serialization fault kill a training run — degrade to a log
        # event that says exactly what could not be encoded. The degraded line
        # still carries the envelope: a serialization fault is precisely when
        # the consumer needs to know which run produced it. Envelope fields are
        # str/int/None only, so this second dumps cannot fail for the same reason.
        line = json.dumps(
            _envelope(
                "log",
                {
                    "level": "error",
                    "message": f"[protocol] unserializable {event.get('type', '?')!r} event: {exc}",
                },
            )
        )
    print(line, flush=True)


def emit_progress(iteration: int, total: int, phase: str = "gibbs_sampling"):
    emit(_envelope("progress", {"iteration": iteration, "total": total, "phase": phase}))


def emit_metric(name: str, value, iteration: int, total: int = 0):
    emit(
        _envelope(
            "metric",
            {
                "name": name,
                "value": float(value),
                "iteration": iteration,
                "total": total,
            },
        )
    )


def emit_fold_complete(fold_idx: int, metrics: dict) -> None:
    """Emit a structured per-fold completion event for the ExperimentLedger.

    Added 2026-05-10 as part of W1.a (cross-domain contract owned by ml-lead,
    consumed by frontend's ExperimentLedger SSE bridge in W4). The event
    carries the full metrics dict for the fold so the frontend can render a
    single ledger-row update without needing to keep per-metric state in
    sync with name-mangled `fold_<i>_<metric>` events.

    Per-metric `metric` events are still emitted alongside this one (by the
    walk-forward template) so the live charts continue to stream point-by-point.
    The `fold_complete` event is the row-commit signal.
    """
    payload: dict = {}
    for k, v in metrics.items():
        try:
            payload[str(k)] = float(v)
        except (TypeError, ValueError):
            # Pass non-numeric values through verbatim (e.g. category strings).
            payload[str(k)] = v
    emit(
        _envelope(
            "fold_complete",
            {
                "fold_idx": int(fold_idx),
                "metrics": payload,
            },
        )
    )


def _to_epoch_sec(t) -> int:
    """Convert a datetime/timestamp to epoch seconds (matches chart timeKey)."""
    if isinstance(t, (int, float)):
        # Already numeric — if > 1e12 assume milliseconds
        return int(t / 1000) if t > 1e12 else int(t)
    if isinstance(t, datetime):
        return int(t.timestamp())
    if hasattr(t, "as_py"):  # pyarrow scalar
        return int(t.as_py().timestamp())
    return int(float(str(t)))


def emit_overlay(
    timestamps,
    assignments,
    regime_colors,
    regime_labels,
    transition_matrix=None,
    n_regimes=None,
    *,
    overlay_type: str = "regime_zones",
):
    """Emit a chart-overlay event carrying a per-bar categorical assignment.

    ``overlayType`` is the dispatch key — it is the ONLY field the client
    branches on to decide how to paint the overlay, so it must match the
    ``chartOverlay`` string the model declares for itself in
    `packages/config/runners.json` (also `models.json` / `tasks.json` /
    `model-templates.json`, merged onto ``ModelRegistryEntry`` at
    `apps/api/training/registry.ts:122`). Values in use across those configs
    today: ``regime_bands``, ``prediction_markers``, ``prediction_heatband``,
    ``prediction_line``, ``reward_curve``, ``credible_bands``. A model whose
    declaration and emitted ``overlayType`` disagree paints nothing — the client
    has no fallback branch, by design, so a mismatch is visible rather than
    silently rendered as the wrong thing.

    The server side is already generic: ``OverlayEventSchema``
    (`apps/api/training/runners/parsers/generated.ts:150-156`) accepts any
    ``overlayType`` string, with ``timestamps`` / ``assignments`` optional
    number arrays and a free-form ``payload``.

    Parameters
    ----------
    timestamps : sequence
        Per-bar timestamps; coerced to epoch SECONDS by :func:`_to_epoch_sec`,
        which is the ``time`` key lightweight-charts indexes on.
    assignments : sequence of int
        Per-bar category index, parallel to ``timestamps``.
    regime_colors : sequence of str
        Hex colour per category. Use the Okabe-Ito palette (orange ``#E69F00``
        for up/positive, blue ``#0072B2`` for down/negative) and never a
        red/green pair — colour must not be the only carrier of meaning.
    regime_labels : sequence of str
        Human-readable label per category, in full words.
    transition_matrix : array-like or None
        Optional K×K transition matrix; emitted inside ``payload`` when given.
    n_regimes : int or None
        Category count; defaults to ``len(regime_colors)`` when a transition
        matrix is supplied.
    overlay_type : str, keyword-only
        The dispatch key described above. Defaults to ``"regime_zones"`` so the
        existing regime caller (`packages/ml-engine/src/ghmm_smoke/main.py:850`, which passes
        keyword arguments only) is unchanged.
    """
    payload = {
        "colors": regime_colors,
        "labels": regime_labels,
    }
    if transition_matrix is not None:
        payload["transition_matrix"] = (
            transition_matrix.tolist()
            if hasattr(transition_matrix, "tolist")
            else transition_matrix
        )
        payload["n_regimes"] = n_regimes or len(regime_colors)
    emit(
        _envelope(
            "overlay",
            {
                "overlayType": str(overlay_type),
                "timestamps": [_to_epoch_sec(t) for t in timestamps],
                "assignments": [int(a) for a in assignments],
                "payload": payload,
            },
        )
    )


# Okabe-Ito, deuteranopia-safe. Orange is up/positive, blue is down/negative —
# never a red/green pair — and every direction also carries a distinct shape so
# the marker is readable with colour ignored entirely.
_DIRECTION_LEGEND = {
    "1": {
        "label": "predicted up",
        "color": "#E69F00",  # Okabe-Ito orange
        "shape": "arrowUp",
        "position": "belowBar",
    },
    "0": {
        "label": "predicted flat",
        "color": "#000000",
        "shape": "circle",
        "position": "inBar",
    },
    "-1": {
        "label": "predicted down",
        "color": "#0072B2",  # Okabe-Ito blue
        "shape": "arrowDown",
        "position": "aboveBar",
    },
}


def emit_prediction_markers(
    timestamps,
    directions,
    confidences=None,
    *,
    overlay_type: str = "prediction_markers",
):
    """Emit per-bar direction predictions to be drawn on the price chart.

    This is the live "is the model predicting correctly?" channel: one marker
    per bar, on the same candle series the bar belongs to, streamed while
    training runs.

    ``overlayType`` is what the client dispatches on — it is the ONLY field the
    client branches on — and it must match the ``chartOverlay`` string this
    model declares in `packages/config/runners.json` (merged onto
    ``ModelRegistryEntry`` at `apps/api/training/registry.ts:122`, default
    ``"prediction_markers"``). A classifier declaring ``prediction_markers``
    calls this with the default; a model declaring something else passes its own
    string rather than having a branch added here.

    Wire shape (validates against ``OverlayEventSchema``,
    `apps/api/training/runners/parsers/generated.ts:150-156`)::

        {"type": "overlay",
         "overlayType": "prediction_markers",
         "timestamps":  [1726790400, 1726876800, ...],   # epoch SECONDS
         "assignments": [1, -1, 0, ...],                 # direction per bar
         "payload": {"confidences": [0.82, 0.61, null, ...],
                     "direction_legend": {...},
                     "bar_count": 3}}

    Three parallel arrays, no per-bar objects: that is the compact form, because
    thousands of bars flow through this event. A per-bar ``{"timestamp": ...,
    "direction": ..., "confidence": ...}`` list costs roughly four times the
    bytes for the same information. ``directions`` rides in the generic
    top-level ``assignments`` field (rather than being repeated inside
    ``payload``) so it is never carried twice.

    Parameters
    ----------
    timestamps : sequence
        Bar timestamps, one per prediction. Coerced to epoch SECONDS by
        :func:`_to_epoch_sec` — the same key the chart's candles are indexed on,
        so a marker lands on its own bar. Datetimes, epoch seconds and epoch
        milliseconds are all accepted.
    directions : sequence of int
        Predicted direction per bar: ``1`` up, ``0`` flat/no-position, ``-1``
        down. Anything outside that set is clamped into it (``> 0`` → ``1``,
        ``< 0`` → ``-1``), so a raw sign, a +1/-1 label vector, or a
        {0,1,2}-style class index that the caller has already re-centred all
        work. A value that is not a number at all becomes ``0``.
    confidences : sequence of float or None
        Optional predicted probability / confidence in ``[0, 1]``, one per bar,
        used by the client to set marker opacity. Values are clamped to
        ``[0, 1]`` and rounded to 3 decimals (≈0.1% resolution — finer than
        anything visible as opacity, and it halves the wire size). A
        non-finite or non-numeric entry becomes ``null``, which means "no
        confidence for this bar", never ``0.0``, which would mean "certain it
        is wrong". Pass ``None`` to omit the array entirely.
    overlay_type : str, keyword-only
        The dispatch key described above.

    Raises
    ------
    ValueError
        If ``confidences`` is given and its length differs from ``timestamps``.
        Silently truncating would mis-pair every marker after the first gap.
    """
    epoch_seconds = [_to_epoch_sec(t) for t in timestamps]

    direction_values = []
    for d in directions:
        try:
            value = int(round(float(d)))
        except (TypeError, ValueError):
            value = 0
        direction_values.append(1 if value > 0 else (-1 if value < 0 else 0))

    if len(direction_values) != len(epoch_seconds):
        raise ValueError(
            f"emit_prediction_markers: {len(epoch_seconds)} timestamps but "
            f"{len(direction_values)} directions — they must be parallel."
        )

    payload: dict = {
        "direction_legend": _DIRECTION_LEGEND,
        "bar_count": len(epoch_seconds),
    }

    if confidences is not None:
        confidence_values = []
        for c in confidences:
            try:
                value = float(c)
            except (TypeError, ValueError):
                confidence_values.append(None)
                continue
            if not math.isfinite(value):
                confidence_values.append(None)
                continue
            confidence_values.append(round(min(1.0, max(0.0, value)), 3))
        if len(confidence_values) != len(epoch_seconds):
            raise ValueError(
                f"emit_prediction_markers: {len(epoch_seconds)} timestamps but "
                f"{len(confidence_values)} confidences — they must be parallel."
            )
        payload["confidences"] = confidence_values

    emit(
        _envelope(
            "overlay",
            {
                "overlayType": str(overlay_type),
                "timestamps": epoch_seconds,
                "assignments": direction_values,
                "payload": payload,
            },
        )
    )


def emit_log(message: str, level: str = "info"):
    emit(_envelope("log", {"level": level, "message": message}))


def emit_done(model_path: str, diagnostics: dict):
    emit(_envelope("done", {"modelPath": model_path, "diagnostics": diagnostics}))


def emit_model_state(iteration: int, total: int, snapshot: dict):
    emit(
        _envelope(
            "model_state",
            {
                "iteration": iteration,
                "total": total,
                "snapshot": snapshot,
            },
        )
    )


def emit_sampler_diagnostics(iteration: int, total: int, diagnostics: dict):
    emit(
        _envelope(
            "sampler_diagnostics",
            {
                "iteration": iteration,
                "total": total,
                "diagnostics": diagnostics,
            },
        )
    )


def emit_metric_declarations(declarations: dict):
    """Emit metric declarations so the dashboard knows how to render each metric.

    Sends a single JSON event containing the full schema for all metrics
    that will be emitted during training. This lets the dashboard pre-configure
    renderers before metrics start flowing.

    Parameters
    ----------
    declarations : dict
        Maps metric names to their declaration dicts. Each declaration must
        contain at minimum: renderer (RendererType), mission (str), context (dict).
        Example::

            {
                "profit_factor": {
                    "renderer": "gauge",
                    "mission": "Is this model profitable after costs?",
                    "context": {"breakeven": 1.0, "good": 1.5, "great": 2.0}
                },
                "n_trades": {
                    "renderer": "number",
                    "mission": "How many trades in evaluation?",
                    "context": {"min": 0, "good": 50, "unit": "trades"}
                }
            }
    """
    emit(_envelope("metric_declarations", {"declarations": declarations}))


def emit_config(
    config: dict,
    *,
    scope: str = "trial",
    trial: int | None = None,
    fold: int | None = None,
    label: str = "",
) -> None:
    """Emit a structured config snapshot — "what is being trained right now".

    The server parser's ``ConfigEventSchema``
    (`apps/api/training/runners/parsers/generated.ts:96-103`) is the contract
    this matches exactly: ``type`` (discriminator), ``config`` (required
    record), and the optional ``scope`` / ``trial`` / ``fold`` / ``label``.
    Nothing else is invented; the schema is ``.passthrough()`` so the envelope
    fields ride along untouched.

    Signature-compatible with the diverged fork at
    `Trading/quant/model/packages/ml-engine/packages/shared/src/protocol.py::emit_config`, so a script
    written against either import resolves the same call.

    ``config`` is free-form and nested; the Config tab flattens it. The shape
    the existing callers use::

        {
          "model":    {"class": "TwoStreamTransformer", "layers": 4, ...},
          "data":     {"symbol": "MNQ", "timeframe": "1d", "n_train": 8000, ...},
          "optim":    {"optimizer": "AdamW", "lr": 1e-4, ...},
          "schedule": {"epochs": 30, "patience": 4, "n_folds": 5},
          "hpo":      {"study_name": "...", "n_trials": 80},
        }

    Parameters
    ----------
    config : dict
        Nested dict of grouped settings (free-form; the renderer flattens it).
    scope : str
        ``"run" | "trial" | "fold"`` — which boundary this snapshot describes.
        The Config tab shows the latest snapshot of each scope.
    trial : int | None
        HPO trial index; emitted only when not ``None`` (``scope == "trial"``).
    fold : int | None
        Walk-forward fold index; emitted only when not ``None``
        (``scope == "fold"``). This is the payload coordinate, distinct from
        the envelope's ``fold_idx`` set by :func:`set_active_fold`.
    label : str
        Optional human-readable tag, e.g. ``"trial_007/fold_2"``. Omitted when
        empty so the key never appears carrying a meaningless ``""``.
    """
    payload: dict = {
        "scope": str(scope),
        "config": dict(config) if config else {},
    }
    if trial is not None:
        payload["trial"] = int(trial)
    if fold is not None:
        payload["fold"] = int(fold)
    if label:
        payload["label"] = str(label)
    emit(_envelope("config", payload))


def emit_error(message: str, details: str = ""):
    emit(_envelope("error", {"message": message, "details": details}))


# ─── Model Cycle events ─────────────────────────────────────────────────────
#
# The wire contract for `packages/ml-engine/src/cycle/main.py` — one process that loads bars,
# tunes, trains, validates and walks test bars one at a time while the
# dashboard chart follows it. Field names here are the zod schema in
# `packages/shared/src/cycle/schema.ts`, letter for letter; the design and the command
# line are `docs/plans/2026-09-25-model-cycle.md`.
#
# Payload keys are camelCase; times are epoch SECONDS; an undefined number is
# None (serialised as null), never 0. Each emitter validates only what would
# make the event unreadable downstream (mismatched column lengths) and leaves
# domain checks to the engine.

CYCLE_PHASES = (
    "loading",
    "tuning",
    "training",
    "validating",
    # the validation market replay: the fitted model walking the validation span bar by
    # bar. Its own phase, distinct from `validating` (the models' validation pass during
    # training), so the phase strip and every phase-keyed consumer can tell them apart.
    "replaying",
    "testing",
    "complete",
    "stopped",
    "failed",
)
CYCLE_STEP_UNITS = ("epoch", "boosting_round", "tree_batch", "solver_pass", "single_fit")


def _optional_number(value):
    """A finite float, or None for None / NaN / infinity / non-numeric."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _optional_int(value):
    return None if value is None else int(value)


def _emit_cycle(event_type: str, payload: dict) -> None:
    emit(_envelope(event_type, payload, nested_copy=False))


def emit_cycle_plan(plan: dict) -> None:
    """The run's plan, once, after the data is loaded and before any fitting.

    ``plan`` carries every `cyclePlanSchema` field: symbol, timeframe,
    modelFamily, modelLabel, parameters, device, deviceName, dataStart,
    dataEnd, barCount, barsPerYear, featureNames, labelHorizonBars,
    labelThresholdTicks, purgeBars, embargoBars, costModel, trading, tuning,
    folds, barsPerSecond, startPaused, artifactDirectory.
    """
    required = ("symbol", "timeframe", "modelFamily", "folds", "barsPerYear", "costModel", "trading")
    missing = [key for key in required if key not in plan]
    if missing:
        raise ValueError(f"emit_cycle_plan: missing {missing}")
    _emit_cycle("cycle_plan", dict(plan))


def emit_cycle_bars(
    role: str,
    fold_index,
    timestamps,
    open_prices,
    high_prices,
    low_prices,
    close_prices,
    volumes,
    *,
    probability_up=None,
    predicted_direction=None,
    position=None,
    equity_usd=None,
    resolved=None,
    predicted_close=None,
    forecast_timestamp=None,
    position_held=None,
    span: str = "test",
) -> None:
    """Bars in strict timestamp order, each bar emitted exactly once per run.

    ``role="context"`` — bars the model has not been tested on (training
    history, the purge/embargo gap). ``role="processed"`` — test bars the model
    has just predicted; the five prediction columns must then be given, one
    value per bar.

    ``resolved`` is ``{"timestamps": [...], "actualDirection": [...],
    "correct": [...]}`` for labels that became known in this frame.

    ``predicted_close`` / ``forecast_timestamp`` (processed bars, optional,
    parallel): the price model's forecast made at each bar of the close
    ``labelHorizonBars`` later, and the epoch seconds of that later bar (None
    past the loaded data).

    ``span`` (processed bars, default ``"test"``): which walk produced the
    frame. ``"test"`` is the out-of-sample walk the run is scored on.
    ``"replay"`` is the market replay over the validation span — the fitted
    model walking bars it was fitted and selected on, which nothing gates and
    which never counts toward the run's equity, trades or metrics. A consumer
    that draws the run's scored position, equity or predictions must read this
    and skip ``"replay"`` frames.
    """
    if role not in ("context", "processed"):
        raise ValueError(f"emit_cycle_bars: role must be context or processed, got {role!r}")
    if span not in ("test", "replay"):
        raise ValueError(f"emit_cycle_bars: span must be test or replay, got {span!r}")
    count = len(timestamps)
    columns = {
        "open": open_prices,
        "high": high_prices,
        "low": low_prices,
        "close": close_prices,
        "volume": volumes,
    }
    for name, column in columns.items():
        if len(column) != count:
            raise ValueError(f"emit_cycle_bars: {name} has {len(column)} values for {count} timestamps")
    payload: dict = {
        "role": role,
        "foldIndex": _optional_int(fold_index),
        "timestamps": [int(t) for t in timestamps],
        "open": [float(v) for v in open_prices],
        "high": [float(v) for v in high_prices],
        "low": [float(v) for v in low_prices],
        "close": [float(v) for v in close_prices],
        "volume": [float(v) for v in volumes],
    }
    if role == "processed":
        prediction_columns = {
            "probabilityUp": probability_up,
            "predictedDirection": predicted_direction,
            "position": position,
            "equityUsd": equity_usd,
        }
        for name, column in prediction_columns.items():
            if column is None or len(column) != count:
                raise ValueError(f"emit_cycle_bars: processed bars need {name} with {count} values")
        payload["probabilityUp"] = [_optional_number(v) for v in probability_up]
        payload["predictedDirection"] = [int(v) for v in predicted_direction]
        payload["position"] = [int(v) for v in position]
        payload["equityUsd"] = [float(v) for v in equity_usd]
        payload["span"] = span
        for name, column in (("predictedClose", predicted_close), ("forecastTimestamp", forecast_timestamp),
                             ("positionHeld", position_held)):
            if column is not None and len(column) != count:
                raise ValueError(f"emit_cycle_bars: {name} has {len(column)} values for {count} timestamps")
        if predicted_close is not None:
            payload["predictedClose"] = [_optional_number(v) for v in predicted_close]
        if forecast_timestamp is not None:
            payload["forecastTimestamp"] = [_optional_int(v) for v in forecast_timestamp]
        if position_held is not None:
            # the position carried THROUGH the bar; `position` is the target for the next open
            payload["positionHeld"] = [int(v) for v in position_held]
    if resolved is not None:
        resolved_count = len(resolved["timestamps"])
        if len(resolved["actualDirection"]) != resolved_count or len(resolved["correct"]) != resolved_count:
            raise ValueError("emit_cycle_bars: resolved columns must be parallel")
        payload["resolved"] = {
            "timestamps": [int(t) for t in resolved["timestamps"]],
            "actualDirection": [int(v) for v in resolved["actualDirection"]],
            "correct": [None if v is None else bool(v) for v in resolved["correct"]],
        }
    _emit_cycle("cycle_bars", payload)


def emit_cycle_cursor(
    phase: str,
    *,
    fold_index=None,
    fold_count: int = 0,
    span_start=None,
    span_end=None,
    bar_timestamp=None,
    bar_index=None,
    bar_count=None,
    epoch=None,
    epoch_count=None,
    batch=None,
    batch_count=None,
    step_unit=None,
    model_role=None,
    trial=None,
    trial_count=None,
    phase_fraction: float = 0.0,
    overall_fraction: float = 0.0,
    bars_per_second: float = 0.0,
    paused: bool = False,
    elapsed_seconds: float = 0.0,
) -> None:
    """Where the model is right now. The engine throttles this to about 20 Hz
    and always emits it on a phase change."""
    if phase not in CYCLE_PHASES:
        raise ValueError(f"emit_cycle_cursor: unknown phase {phase!r}")
    if step_unit is not None and step_unit not in CYCLE_STEP_UNITS:
        raise ValueError(f"emit_cycle_cursor: unknown step unit {step_unit!r}")
    _emit_cycle(
        "cycle_cursor",
        {
            "phase": phase,
            "foldIndex": _optional_int(fold_index),
            "foldCount": int(fold_count),
            "spanStart": _optional_int(span_start),
            "spanEnd": _optional_int(span_end),
            "barTimestamp": _optional_int(bar_timestamp),
            "barIndex": _optional_int(bar_index),
            "barCount": _optional_int(bar_count),
            "epoch": _optional_int(epoch),
            "epochCount": _optional_int(epoch_count),
            "batch": _optional_int(batch),
            "batchCount": _optional_int(batch_count),
            "stepUnit": step_unit,
            "modelRole": model_role,
            "trial": _optional_int(trial),
            "trialCount": _optional_int(trial_count),
            "phaseFraction": min(1.0, max(0.0, float(phase_fraction))),
            "overallFraction": min(1.0, max(0.0, float(overall_fraction))),
            "barsPerSecond": max(0.0, float(bars_per_second)),
            "paused": bool(paused),
            "elapsedSeconds": max(0.0, float(elapsed_seconds)),
        },
    )


def emit_cycle_epoch(
    *,
    fold_index,
    trial,
    epoch: int,
    epoch_count: int,
    step_unit: str,
    train_loss=None,
    validation_loss=None,
    validation_accuracy=None,
    validation_f1_score=None,
    learning_rate=None,
    gradient_norm=None,
    is_best: bool = False,
    seconds_elapsed: float = 0.0,
    model_role: str = "direction",
) -> None:
    """One training-step summary: an epoch, a chunk of boosting rounds, a
    chunk of trees, or a solver pass (``step_unit`` says which), for the
    direction classifier or the price model (``model_role``)."""
    if step_unit not in CYCLE_STEP_UNITS:
        raise ValueError(f"emit_cycle_epoch: unknown step unit {step_unit!r}")
    _emit_cycle(
        "cycle_epoch",
        {
            "foldIndex": _optional_int(fold_index),
            "trial": _optional_int(trial),
            "epoch": int(epoch),
            "epochCount": int(epoch_count),
            "stepUnit": step_unit,
            "trainLoss": _optional_number(train_loss),
            "validationLoss": _optional_number(validation_loss),
            "validationAccuracy": _optional_number(validation_accuracy),
            "validationF1Score": _optional_number(validation_f1_score),
            "learningRate": _optional_number(learning_rate),
            "gradientNorm": _optional_number(gradient_norm),
            "isBest": bool(is_best),
            "secondsElapsed": max(0.0, float(seconds_elapsed)),
            "modelRole": model_role,
        },
    )


def emit_cycle_trial(
    *,
    trial: int,
    trial_count: int,
    state: str,
    parameters: dict,
    objective_name: str,
    objective_value=None,
    best_value=None,
    best_trial=None,
    fold_index=None,
) -> None:
    """An Optuna trial started (``running``), finished, was pruned or failed.
    ``fold_index`` is the walk-forward fold whose training window the trial
    was scored on (tuning runs inside every fold)."""
    if state not in ("running", "complete", "pruned", "failed"):
        raise ValueError(f"emit_cycle_trial: unknown state {state!r}")
    clean_parameters = {}
    for key, value in parameters.items():
        if isinstance(value, bool) or isinstance(value, str):
            clean_parameters[str(key)] = value
        else:
            clean_parameters[str(key)] = float(value) if isinstance(value, float) else int(value)
    _emit_cycle(
        "cycle_trial",
        {
            "trial": int(trial),
            "trialCount": int(trial_count),
            "state": state,
            "parameters": clean_parameters,
            "objectiveName": objective_name,
            "objectiveValue": _optional_number(objective_value),
            "bestValue": _optional_number(best_value),
            "bestTrial": _optional_int(best_trial),
            "foldIndex": _optional_int(fold_index),
        },
    )


def emit_cycle_parameters(
    *,
    fold_index,
    parameters: dict,
    source: str,
    objective_name=None,
    best_trial=None,
    best_value=None,
    trial_count=None,
    pinned=(),
) -> None:
    """The hyperparameters a fold's models are fitted with, once per fold,
    after the fold's tuning (or its decision not to tune). ``source`` is
    ``tuned`` (the fold's best Optuna trial over the base values), ``manual``
    (values typed for the run, no tuning) or ``reviewed_defaults`` (the
    registry's defaults). ``pinned`` names the parameters held out of the
    search. The plan's ``parameters`` are the BASE values; this event carries
    what each fold actually used."""
    if source not in ("tuned", "manual", "reviewed_defaults"):
        raise ValueError(f"emit_cycle_parameters: unknown source {source!r}")
    clean: dict = {}
    for key, value in parameters.items():
        if value is None or isinstance(value, (bool, str)):
            clean[str(key)] = value
        else:
            clean[str(key)] = float(value) if isinstance(value, float) else int(value)
    _emit_cycle(
        "cycle_parameters",
        {
            "foldIndex": _optional_int(fold_index),
            "parameters": clean,
            "source": source,
            "objectiveName": objective_name,
            "bestTrial": _optional_int(best_trial),
            "bestValue": _optional_number(best_value),
            "trialCount": _optional_int(trial_count),
            "pinned": [str(name) for name in pinned],
        },
    )


def cycle_loss_surface_payload(*, fold_index, model_role: str, surface: dict) -> dict:
    """The wire shape of a fold's loss surface (Li et al. 2018, as
    ``core.shared.loss_surface.compute_loss_surface`` returns it): the grid of
    losses around the fitted weights along two filter-normalised directions,
    plus the geometry read off it. One per final fit; a tuning trial's fit
    has none."""
    if model_role not in ("direction", "price"):
        raise ValueError(f"cycle_loss_surface: model role must be direction or price, got {model_role!r}")
    diagnostics = surface.get("diagnostics") or {}
    losses = [[_optional_number(value) for value in row] for row in surface["losses"]]
    return {
        "foldIndex": _optional_int(fold_index),
        "modelRole": model_role,
        "alphas": [float(value) for value in surface["alphas"]],
        "betas": [float(value) for value in surface["betas"]],
        "losses": losses,
        "resolution": int(surface["resolution"]),
        "range": [float(surface["range"][0]), float(surface["range"][1])],
        "diagnostics": {
            "sharpness": _optional_number(diagnostics.get("sharpness")),
            "conditionNumber": _optional_number(diagnostics.get("condition_number")),
            "valleyWidth": _optional_number(diagnostics.get("valley_width")),
            "locallyConvex": bool(diagnostics.get("locally_convex", False)),
        },
        "batchCount": _optional_int(surface.get("batch_count")),
        "secondsElapsed": max(0.0, float(surface.get("seconds_elapsed") or 0.0)),
    }


def emit_cycle_loss_surface(*, fold_index, model_role: str, surface: dict) -> None:
    """A fold's loss surface, once its final fit is done (see
    ``cycle_loss_surface_payload``)."""
    _emit_cycle("cycle_loss_surface", cycle_loss_surface_payload(fold_index=fold_index, model_role=model_role, surface=surface))


def cycle_gate_routing_payload(*, fold_index, model_role: str, timestamps, probabilities) -> dict:
    """The wire shape of a fold's gate routing (a mixture of experts): for every
    scored test bar, the gate's probability per expert, which expert won, how
    diffuse the choice was, and each expert's share of the fold. One per final
    fit of a mixture; other kinds send none."""
    import math

    if model_role not in ("direction", "price"):
        raise ValueError(f"cycle_gate_routing: model role must be direction or price, got {model_role!r}")
    rows = [[float(value) for value in row] for row in probabilities]
    stamps = [int(value) for value in timestamps]
    if len(rows) != len(stamps):
        raise ValueError(f"cycle_gate_routing: {len(rows)} probability rows for {len(stamps)} timestamps")
    expert_count = len(rows[0]) if rows else 0
    chosen = [int(max(range(len(row)), key=lambda k: row[k])) if row else -1 for row in rows]
    entropy = [float(-sum(p * math.log(p) for p in row if p > 0.0)) for row in rows]
    usage = [float(sum(row[k] for row in rows) / len(rows)) if rows else 0.0 for k in range(expert_count)]
    return {
        "foldIndex": _optional_int(fold_index),
        "modelRole": model_role,
        "expertCount": expert_count,
        "timestamps": stamps,
        "probabilities": [[round(value, 4) for value in row] for row in rows],
        "chosenExpert": chosen,
        "entropy": [round(value, 4) for value in entropy],
        "usage": [round(value, 4) for value in usage],
    }


def emit_cycle_gate_routing(*, fold_index, model_role: str, timestamps, probabilities) -> None:
    """A fold's gate routing over its test walk (see ``cycle_gate_routing_payload``)."""
    _emit_cycle("cycle_gate_routing", cycle_gate_routing_payload(fold_index=fold_index, model_role=model_role, timestamps=timestamps, probabilities=probabilities))


def _number_or_none(value, digits: int):
    """A finite float rounded to ``digits`` places, or None (NaN and infinity are not numbers on the wire)."""
    import math

    if value is None:
        return None
    value = float(value)
    return round(value, digits) if math.isfinite(value) else None


def cycle_regime_forecast_payload(*, fold_index, model_role: str, horizon_bars: int, simulation_count: int,
                                  decision_threshold: float, kronos_model: str, regimes: list[dict],
                                  transition_matrix, feature_weights: list[dict], rows: list[dict]) -> dict:
    """The wire shape of a regime Monte Carlo decision model's per-bar forecasts
    over a stretch of its test walk (``regime_montecarlo_decision``): for every
    bar, the filtered regime probabilities, the Monte Carlo fan (10th / 50th /
    90th percentile move paths in points to the horizon, P(up) and the expected
    move), Kronos' predicted candles, the decision model's P(up) and whether
    its trade gate was open. ``rows`` are the adapter's ``regime_forecast(row)``
    records plus ``timestamp``. The fold's constants (regimes, transition
    matrix, feature weights) travel with every stretch, so any one event is
    readable on its own. Other model kinds send none."""
    if model_role not in ("direction", "price"):
        raise ValueError(f"cycle_regime_forecast: model role must be direction or price, got {model_role!r}")
    regime_count = len(regimes)

    def path(values):
        return [_number_or_none(value, 4) for value in values]

    def candles(row, column):
        values = row["kronos_candles"]
        return [_number_or_none(candle[column], 4) for candle in values]

    probabilities = []
    most_likely = []
    for row in rows:
        values = [_number_or_none(value, 4) for value in row["probabilities"]]
        if len(values) != regime_count:
            raise ValueError(f"cycle_regime_forecast: {len(values)} regime probabilities for {regime_count} regimes")
        probabilities.append(values)
        known = [value for value in values if value is not None]
        most_likely.append(int(max(range(regime_count), key=lambda k: values[k] or -1.0)) + 1 if known else None)
    return {
        "foldIndex": None if fold_index is None else int(fold_index),
        "modelRole": model_role,
        "regimeCount": regime_count,
        "horizonBars": int(horizon_bars),
        "simulationCount": int(simulation_count),
        "decisionThreshold": float(decision_threshold),
        "kronosModel": str(kronos_model),
        "regimes": [dict(regime) for regime in regimes],
        "transitionMatrix": [[_number_or_none(value, 6) for value in row] for row in transition_matrix],
        "featureWeights": [{"name": str(item["name"]), "gainShare": _number_or_none(item["gainShare"], 6)}
                           for item in feature_weights],
        "timestamps": [int(row["timestamp"]) for row in rows],
        "close": [_number_or_none(row["close"], 4) for row in rows],
        "regimeProbabilities": probabilities,
        "mostLikelyRegime": most_likely,
        "monteCarloProbabilityUp": [_number_or_none(row["probability_up"], 4) for row in rows],
        "monteCarloExpectedMovePoints": [_number_or_none(row["expected_move_points"], 4) for row in rows],
        "monteCarloPercentile10Points": [path(row["percentile_10_points"]) for row in rows],
        "monteCarloPercentile50Points": [path(row["percentile_50_points"]) for row in rows],
        "monteCarloPercentile90Points": [path(row["percentile_90_points"]) for row in rows],
        "kronosOpen": [candles(row, 0) for row in rows],
        "kronosHigh": [candles(row, 1) for row in rows],
        "kronosLow": [candles(row, 2) for row in rows],
        "kronosClose": [candles(row, 3) for row in rows],
        "kronosPredictedMovePoints": [_number_or_none(row["kronos_move"], 4) for row in rows],
        "decisionProbabilityUp": [_number_or_none(row["decision_probability_up"], 4) for row in rows],
        "gateOpen": [bool(row["gate_open"]) for row in rows],
    }


def emit_cycle_regime_forecast(**arguments) -> dict:
    """A stretch of a regime model's per-bar forecasts (see ``cycle_regime_forecast_payload``);
    returns the payload it sent."""
    payload = cycle_regime_forecast_payload(**arguments)
    _emit_cycle("cycle_regime_forecast", payload)
    return payload


def emit_cycle_trade(trade: dict) -> None:
    """A trade opened (``status="open"``) or closed (``status="closed"``).

    ``trade`` carries every `cycleTradeSchema` field: tradeNumber, foldIndex,
    side, status, contracts, entryTimestamp, entryPrice, exitTimestamp,
    exitPrice, barsHeld, probabilityUpAtEntry, grossProfitUsd, costUsd,
    netProfitUsd, exitReason.
    """
    payload = dict(trade)
    for key in ("grossProfitUsd", "costUsd", "netProfitUsd", "exitPrice"):
        payload[key] = _optional_number(payload.get(key))
    _emit_cycle("cycle_trade", payload)


def emit_cycle_scoreboard(
    *,
    scope: str,
    fold_index,
    bars_evaluated: int,
    bars_scored: int,
    metrics: dict,
    trade_distribution: dict,
    notes=(),
) -> None:
    """Running (during a test walk), per-fold, or final metrics. Every value in
    ``metrics`` is a finite float or None."""
    if scope not in ("running", "fold", "final"):
        raise ValueError(f"emit_cycle_scoreboard: unknown scope {scope!r}")
    distribution = {
        "count": int(trade_distribution.get("count", 0)),
        **{
            key: _optional_number(trade_distribution.get(key))
            for key in (
                "mean",
                "median",
                "standardDeviation",
                "skewness",
                "kurtosis",
                "percentile25",
                "percentile75",
                "minimum",
                "maximum",
            )
        },
    }
    _emit_cycle(
        "cycle_scoreboard",
        {
            "scope": scope,
            "foldIndex": _optional_int(fold_index),
            "barsEvaluated": int(bars_evaluated),
            "barsScored": int(bars_scored),
            "metrics": {str(name): _optional_number(value) for name, value in metrics.items()},
            "tradeDistribution": distribution,
            "notes": [str(note) for note in notes],
        },
    )
