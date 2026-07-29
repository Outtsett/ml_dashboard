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
"""

import json
import math
from datetime import datetime


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
        # event that says exactly what could not be encoded.
        line = json.dumps({
            "type": "log",
            "level": "error",
            "message": f"[protocol] unserializable {event.get('type', '?')!r} event: {exc}",
        })
    print(line, flush=True)


def emit_progress(iteration: int, total: int, phase: str = "gibbs_sampling"):
    emit({"type": "progress", "iteration": iteration, "total": total, "phase": phase})


def emit_metric(name: str, value, iteration: int, total: int = 0):
    emit({"type": "metric", "name": name, "value": float(value), "iteration": iteration, "total": total})


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
    emit({
        "type": "fold_complete",
        "fold_idx": int(fold_idx),
        "metrics": payload,
    })


def _to_epoch_sec(t) -> int:
    """Convert a datetime/timestamp to epoch seconds (matches chart timeKey)."""
    if isinstance(t, (int, float)):
        # Already numeric — if > 1e12 assume milliseconds
        return int(t / 1000) if t > 1e12 else int(t)
    if isinstance(t, datetime):
        return int(t.timestamp())
    if hasattr(t, 'as_py'):  # pyarrow scalar
        return int(t.as_py().timestamp())
    return int(float(str(t)))


def emit_overlay(timestamps, assignments, regime_colors, regime_labels,
                  transition_matrix=None, n_regimes=None):
    payload = {
        "colors": regime_colors,
        "labels": regime_labels,
    }
    if transition_matrix is not None:
        payload["transition_matrix"] = transition_matrix.tolist() if hasattr(transition_matrix, 'tolist') else transition_matrix
        payload["n_regimes"] = n_regimes or len(regime_colors)
    emit({
        "type": "overlay",
        "overlayType": "regime_zones",
        "timestamps": [_to_epoch_sec(t) for t in timestamps],
        "assignments": [int(a) for a in assignments],
        "payload": payload,
    })


def emit_log(message: str, level: str = "info"):
    emit({"type": "log", "level": level, "message": message})


def emit_done(model_path: str, diagnostics: dict):
    emit({"type": "done", "modelPath": model_path, "diagnostics": diagnostics})


def emit_model_state(iteration: int, total: int, snapshot: dict):
    emit({"type": "model_state", "iteration": iteration, "total": total, "snapshot": snapshot})


def emit_sampler_diagnostics(iteration: int, total: int, diagnostics: dict):
    emit({"type": "sampler_diagnostics", "iteration": iteration, "total": total, "diagnostics": diagnostics})


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
    emit({"type": "metric_declarations", "declarations": declarations})


def emit_error(message: str, details: str = ""):
    emit({"type": "error", "message": message, "details": details})
