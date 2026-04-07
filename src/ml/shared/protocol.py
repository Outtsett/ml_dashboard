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
from datetime import datetime


def emit(event: dict):
    """Write a JSON event to stdout (unbuffered)."""
    print(json.dumps(event, default=str), flush=True)


def emit_progress(iteration: int, total: int, phase: str = "gibbs_sampling"):
    emit({"type": "progress", "iteration": iteration, "total": total, "phase": phase})


def emit_metric(name: str, value, iteration: int, total: int = 0):
    emit({"type": "metric", "name": name, "value": float(value), "iteration": iteration, "total": total})


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
