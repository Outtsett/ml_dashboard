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
deliberate. `XgbClassifierParser` (`src/server/training/runners/parsers/
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


def _envelope(event_type: str, payload: dict, kind: str = _DEFAULT_KIND) -> dict:
    """Wrap a flat emitter payload in the common v1 envelope.

    Field order matters only for readability; `payload` is applied *after* the
    envelope defaults so an emitter that carries its own coordinate (e.g.
    `emit_fold_complete`'s `fold_idx`) wins over the module-level active one
    rather than being nulled by it.
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
    `src/config/runners.json` (also `models.json` / `tasks.json` /
    `model-templates.json`, merged onto ``ModelRegistryEntry`` at
    `src/server/training/registry.ts:122`). Values in use across those configs
    today: ``regime_bands``, ``prediction_markers``, ``prediction_heatband``,
    ``prediction_line``, ``reward_curve``, ``credible_bands``. A model whose
    declaration and emitted ``overlayType`` disagree paints nothing — the client
    has no fallback branch, by design, so a mismatch is visible rather than
    silently rendered as the wrong thing.

    The server side is already generic: ``OverlayEventSchema``
    (`src/server/training/runners/parsers/generated.ts:150-156`) accepts any
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
        existing regime caller (`src/ml/ghmm_smoke/main.py:850`, which passes
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
    model declares in `src/config/runners.json` (merged onto
    ``ModelRegistryEntry`` at `src/server/training/registry.ts:122`, default
    ``"prediction_markers"``). A classifier declaring ``prediction_markers``
    calls this with the default; a model declaring something else passes its own
    string rather than having a branch added here.

    Wire shape (validates against ``OverlayEventSchema``,
    `src/server/training/runners/parsers/generated.ts:150-156`)::

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
    (`src/server/training/runners/parsers/generated.ts:96-103`) is the contract
    this matches exactly: ``type`` (discriminator), ``config`` (required
    record), and the optional ``scope`` / ``trial`` / ``fold`` / ``label``.
    Nothing else is invented; the schema is ``.passthrough()`` so the envelope
    fields ride along untouched.

    Signature-compatible with the diverged fork at
    `Trading/quant/model/src/ml/shared/protocol.py::emit_config`, so a script
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
