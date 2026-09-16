"""
Stdout Protocol — JSON event emitters for ML training scripts.

Reusable by any ML script that communicates with the Node.js training
pipeline via stdout. Each function emits a JSON line that the parser
registry (server/training/runners/parsers/) knows how to handle.

Event types:
  progress             — iteration / phase progress
  metric               — per-iteration numeric metric
  metric_declarations  — self-describing metric schema (renderer, mission, context)
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
    timestamps, assignments, regime_colors, regime_labels, transition_matrix=None, n_regimes=None
):
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
                "overlayType": "regime_zones",
                "timestamps": [_to_epoch_sec(t) for t in timestamps],
                "assignments": [int(a) for a in assignments],
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


def emit_error(message: str, details: str = ""):
    emit(_envelope("error", {"message": message, "details": details}))
