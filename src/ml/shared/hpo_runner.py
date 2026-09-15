"""HPO Orchestrator — unified entry point for hyperparameter optimization.

Spawned by the TypeScript server as::

    python -m src.ml.shared.hpo_runner --config '{"model_type": "...", ...}'

Workflow:
  1. Parses ``--config`` JSON (or ``--config-file``) from CLI
  2. Loads search space from the config dict
  3. Creates the optimizer via ``OptimizerRegistry.create``
  4. Builds an objective function that spawns the model's training script
     as a subprocess, capturing the objective metric from stdout
  5. Attaches ``SSECallback`` for real-time trial events to the Node server
  6. Runs ``optimizer.optimize(objective_fn)``
  7. Emits trial events via SSE for real-time dashboard updates
  8. Emits ``hpo-complete`` with the final ``OptimizationResult`` summary
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

# Import every optimizer module so their ``@OptimizerRegistry.register``
# decorators execute before we try to instantiate one.
from ..optimizers import (  # noqa: F401
    bayesian_optimizer,
    bohb_optimizer,
    evolutionary_optimizer,
    montecarlo_optimizer,
    optuna_optimizer,
    pso_optimizer,
)

# ---------------------------------------------------------------------------
# Relative imports — works when run via ``python -m src.ml.shared.hpo_runner``
# ---------------------------------------------------------------------------
from .optimizer import (
    OptimizationResult,
    OptimizerRegistry,
    SearchSpace,
    SSECallback,
)
from .protocol import emit, emit_error, emit_log

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # …/ml_dashboard

# Model type → relative path from project root to the training entry point.
# These are *training* scripts (single-fold CLI). HPO drivers spawn them
# per-trial; nested HPO drivers spawn them per-fold.
_MODEL_ENTRYPOINTS: dict[str, str] = {
    "xgb_classifier":      "src/ml/xgb_classifier/main.py",
    "xgb_classifier_wf":   "src/ml/xgb_classifier/main.py",  # WF reuses single-fold entry
    "xgb_classifier_nest": "src/ml/xgb_classifier/main.py",  # nested HPO uses fold-level driver, see hpo_main.py
}


def _preload_feature_cache(model_type: str, training_args: dict[str, Any]) -> None:
    """Warm the parquet feature cache once before the optimization loop.

    Per-trial subprocesses share the same OHLCV + feature matrix (only
    hyperparameters change). Pre-warming the cache means trial 1 hits the
    cache instead of re-reading the lake. No-op when the cache is already warm.
    """
    if model_type.lower() not in _MODEL_ENTRYPOINTS:
        return
    try:
        from .data import load_ohlcv_arrays
        from .feature_cache import cached_features, has_cache
        from .features import compute_features

        symbol = str(training_args.get("symbol") or "").upper()
        timeframe = str(training_args.get("timeframe") or "1h")
        if not symbol:
            return
        date_range: dict | None = None
        if training_args.get("date_start") or training_args.get("date_end"):
            date_range = {}
            if training_args.get("date_start"):
                date_range["start"] = training_args["date_start"]
            if training_args.get("date_end"):
                date_range["end"] = training_args["date_end"]
        cats_raw = training_args.get("feature_categories")
        categories: list[str] | None
        if isinstance(cats_raw, str):
            categories = [s.strip() for s in cats_raw.split(",") if s.strip()]
        elif isinstance(cats_raw, list):
            categories = list(cats_raw)
        else:
            categories = None

        if has_cache(symbol, timeframe, date_range, categories):
            emit_log(f"[hpo] Feature cache already warm for {symbol}@{timeframe}")
            return

        emit_log(f"[hpo] Pre-warming feature cache for {symbol}@{timeframe}…")
        max_bars = int(training_args.get("max_bars") or 0)
        raw = load_ohlcv_arrays(symbol, timeframe, max_bars=max_bars, date_range=date_range)

        def _compute():
            ohlcv = {
                "open_": raw["open"], "high": raw["high"], "low": raw["low"],
                "close": raw["close"], "volume": raw["volume"],
            }
            matrix, names, _ts = compute_features(ohlcv, categories=categories, n_jobs=1)
            ts_arr = [t.timestamp() if hasattr(t, "timestamp") else float(t) for t in raw["timestamp"]]
            import numpy as _np
            return matrix.astype(_np.float32), list(names), _np.asarray(ts_arr, dtype=_np.int64)

        cached_features(symbol, timeframe, date_range, categories, _compute)
        emit_log("[hpo] Feature cache warm.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Feature cache pre-warm skipped: %s", exc)
        emit_log(f"[hpo] Feature cache pre-warm skipped: {exc}", level="warning")

# ---------------------------------------------------------------------------
# Objective function builder
# ---------------------------------------------------------------------------


def _build_subprocess_objective(
    model_type: str,
    objective_metric: str,
    direction: str,
    training_args: dict[str, Any],
) -> callable:
    """Return an objective function that spawns a training subprocess.

    The function runs the model's ``main.py`` with ``--json`` and the trial's
    hyperparameters as CLI flags.  It scans stdout for a JSON ``done`` event
    containing diagnostics, then extracts ``objective_metric`` from it.

    Args:
        model_type: Model identifier (e.g. ``"primitives-discovery"``).
        objective_metric: Key to extract from the training diagnostics.
        direction: ``"minimize"`` or ``"maximize"`` — controls the failure
            sentinel value.
        training_args: Extra CLI arguments forwarded to the training script
            (e.g. ``{"symbol": "EURUSD", "timeframe": "1h"}``).

    Returns:
        A callable ``objective(params: dict) -> float``.
    """
    entrypoint = _MODEL_ENTRYPOINTS.get(model_type.lower())
    if entrypoint is None:
        raise ValueError(
            f"Unknown model_type '{model_type}'. "
            f"Known models: {sorted(_MODEL_ENTRYPOINTS)}"
        )
    script = str(_PROJECT_ROOT / entrypoint)
    fail_score = float("inf") if direction == "minimize" else float("-inf")

    def objective(params: dict[str, Any]) -> float:
        cmd: list[str] = [sys.executable, script, "--json"]

        # Append fixed training args (--symbol ES --timeframe 1h …)
        for key, value in training_args.items():
            flag = f"--{key.replace('_', '-')}"
            cmd.extend([flag, str(value)])

        # Append trial hyperparams (--alpha 0.42 --kappa 12.3 …)
        for key, value in params.items():
            flag = f"--{key.replace('_', '-')}"
            if isinstance(value, bool):
                if value:
                    cmd.append(flag)
                continue
            cmd.extend([flag, str(value)])

        logger.info("Subprocess cmd: %s", " ".join(cmd))
        emit_log(f"[hpo] Launching trial: {' '.join(cmd[-6:])}")

        t0 = time.perf_counter()
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=3600,  # 1-hour per-trial safety timeout
                cwd=str(_PROJECT_ROOT),
            )
        except subprocess.TimeoutExpired:
            logger.warning("Trial subprocess timed out after 3600s")
            emit_log("[hpo] Trial subprocess timed out", level="warning")
            return fail_score
        except Exception as exc:
            logger.exception("Trial subprocess failed: %s", exc)
            emit_log(f"[hpo] Trial subprocess error: {exc}", level="error")
            return fail_score

        elapsed = time.perf_counter() - t0
        logger.info("Trial subprocess finished in %.1fs (exit=%d)", elapsed, proc.returncode)

        if proc.returncode != 0:
            stderr_tail = (proc.stderr or "")[-500:]
            logger.warning("Trial exited with code %d: %s", proc.returncode, stderr_tail)
            emit_log(f"[hpo] Trial failed (exit {proc.returncode})", level="warning")
            return fail_score

        # Scan stdout for the last JSON ``done`` event and extract the metric.
        score = _extract_metric(proc.stdout, objective_metric)
        if score is None:
            logger.warning(
                "Could not find metric '%s' in trial output", objective_metric
            )
            emit_log(
                f"[hpo] Metric '{objective_metric}' not found in output",
                level="warning",
            )
            return fail_score

        logger.info("Trial score (%s): %.6f", objective_metric, score)
        return score

    return objective


def _extract_metric(stdout: str, metric_name: str) -> float | None:
    """Parse training stdout for the objective metric.

    Strategy:
      1. Look for a JSON ``done`` event with ``diagnostics.<metric_name>``.
      2. Fall back to any JSON ``metric`` event with matching name.
      3. Fall back to grepping for ``<metric_name>: <float>`` pattern.

    Returns the metric value as a float, or *None* if not found.
    """
    last_done: dict | None = None
    last_metric_value: float | None = None

    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        if obj.get("type") == "done":
            last_done = obj
        elif obj.get("type") == "metric" and obj.get("name") == metric_name:
            last_metric_value = float(obj["value"])

    # Prefer the diagnostics dict inside a ``done`` event.
    if last_done is not None:
        diag = last_done.get("diagnostics", {})
        if metric_name in diag:
            return float(diag[metric_name])
        # Nested lookup: diagnostics may have sub-dicts.
        for _key, val in diag.items():
            if isinstance(val, dict) and metric_name in val:
                return float(val[metric_name])

    if last_metric_value is not None:
        return last_metric_value

    # Last resort: regex scan.
    pattern = re.compile(rf"{re.escape(metric_name)}\s*[:=]\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)")
    for line in reversed(stdout.splitlines()):
        m = pattern.search(line)
        if m:
            return float(m.group(1))

    return None


def _build_dry_run_objective(
    search_space: SearchSpace,
    direction: str,
) -> callable:
    """Return a dummy objective for testing the HPO pipeline.

    Generates a deterministic score based on parameter values so that the
    optimizer can still converge meaningfully during integration tests.
    """
    import hashlib

    def objective(params: dict[str, Any]) -> float:
        # Simulate work
        time.sleep(0.05)
        # Deterministic-ish score based on param hash
        h = hashlib.md5(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()
        score = int(h[:8], 16) / 0xFFFFFFFF  # [0, 1]
        if direction == "maximize":
            return score
        return 1.0 - score

    return objective


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------


def run_hpo(config: dict[str, Any]) -> OptimizationResult:
    """Execute an HPO run described by *config*.

    This is the programmatic entry point — the CLI ``main()`` simply parses
    arguments and delegates here.

    Args:
        config: Full HPO configuration dict.  Required keys:
            - ``model_type``: str
            - ``optimizer``: str  (registered optimizer name)
            - ``search_space``: dict  (param name → SearchDimension spec)
            Optional keys:
            - ``optimizer_config``: dict  (forwarded to optimizer constructor)
            - ``objective_metric``: str  (default ``"log_likelihood"``)
            - ``direction``: str  (``"minimize"`` | ``"maximize"``, default ``"maximize"``)
            - ``training_args``: dict  (extra CLI flags for the training script)
            - ``timeout``: float  (overall timeout in seconds)
            - ``dry_run``: bool  (use dummy objective)

    Returns:
        The ``OptimizationResult`` from the optimizer.
    """
    t_start = time.perf_counter()

    # ---- Unpack config ----------------------------------------------------
    model_type: str = config["model_type"]
    optimizer_type: str = config["optimizer"]
    search_space_dict: dict = config["search_space"]
    optimizer_config: dict = config.get("optimizer_config", {})
    objective_metric: str = config.get("objective_metric", "log_likelihood")
    direction: str = config.get("direction", "maximize")
    training_args: dict = config.get("training_args", {})
    timeout: float | None = config.get("timeout")
    dry_run: bool = config.get("dry_run", False)

    logger.info("=" * 72)
    logger.info("HPO Orchestrator starting")
    logger.info("  model_type      : %s", model_type)
    logger.info("  optimizer       : %s", optimizer_type)
    logger.info("  direction       : %s", direction)
    logger.info("  objective_metric: %s", objective_metric)
    logger.info("  n_trials        : %s", optimizer_config.get("n_trials", "default"))
    logger.info("  timeout         : %s", timeout)
    logger.info("  dry_run         : %s", dry_run)
    logger.info("  search_space    : %d dimensions", len(search_space_dict))
    logger.info("=" * 72)

    # ---- Emit hpo-started event -------------------------------------------
    emit({
        "type": "hpo-started",
        "modelType": model_type,
        "optimizer": optimizer_type,
        "direction": direction,
        "objectiveMetric": objective_metric,
        "searchSpace": search_space_dict,
        "nTrials": optimizer_config.get("n_trials"),
        "timeout": timeout,
    })

    # ---- Build search space -----------------------------------------------
    search_space = SearchSpace.from_dict(search_space_dict)
    emit_log(
        f"[hpo] Search space: {len(search_space)} dimensions — "
        + ", ".join(d.name for d in search_space)
    )

    # ---- Build callbacks --------------------------------------------------
    sse_callback = SSECallback()
    callbacks: list = [sse_callback]

    # ---- Create optimizer -------------------------------------------------
    # Merge direction, timeout, and callbacks into the optimizer kwargs.
    opt_kwargs: dict[str, Any] = {**optimizer_config}
    opt_kwargs["direction"] = direction
    if timeout is not None:
        opt_kwargs["timeout"] = timeout
    opt_kwargs["callbacks"] = callbacks

    try:
        optimizer = OptimizerRegistry.create(
            optimizer_type, search_space, **opt_kwargs
        )
    except KeyError as exc:
        available = OptimizerRegistry.list_available()
        msg = f"Unknown optimizer '{optimizer_type}'. Available: {available}"
        logger.error(msg)
        emit_error(msg, details=str(exc))
        raise SystemExit(1) from exc

    emit_log(
        f"[hpo] Optimizer created: {optimizer_type} "
        f"({optimizer.n_trials} trials, {optimizer.n_jobs} jobs)"
    )

    # ---- Build objective function -----------------------------------------
    if dry_run:
        emit_log("[hpo] DRY-RUN mode — using dummy objective function")
        objective_fn = _build_dry_run_objective(search_space, direction)
    else:
        # Warm the feature cache once so the very first trial is fast.
        _preload_feature_cache(model_type, training_args)
        objective_fn = _build_subprocess_objective(
            model_type=model_type,
            objective_metric=objective_metric,
            direction=direction,
            training_args=training_args,
        )

    # ---- Run optimization -------------------------------------------------
    emit_log(f"[hpo] Starting optimization loop ({optimizer_type})…")
    try:
        result: OptimizationResult = optimizer.optimize(objective_fn)
    except Exception as exc:
        elapsed = time.perf_counter() - t_start
        logger.exception("HPO failed after %.1fs", elapsed)
        emit_error(
            f"HPO failed after {elapsed:.1f}s: {exc}",
            details=str(exc),
        )
        raise SystemExit(1) from exc

    total_elapsed = time.perf_counter() - t_start

    # ---- Log final results ------------------------------------------------
    logger.info("-" * 72)
    logger.info("HPO COMPLETE in %.1fs", total_elapsed)
    logger.info("  Best score : %.6f", result.best_score)
    logger.info("  Best params: %s", result.best_params)
    logger.info("  Completed  : %d / %d trials", result.completed_trials, result.total_trials)
    logger.info("  Pruned     : %d trials", result.pruned_trials)
    logger.info("-" * 72)

    # ---- Emit final hpo-complete (in addition to SSECallback's event) -----
    emit({
        "type": "hpo-complete",
        "bestScore": result.best_score,
        "bestParams": result.best_params,
        "totalTrials": result.total_trials,
        "completedTrials": result.completed_trials,
        "prunedTrials": result.pruned_trials,
        "elapsedSec": round(total_elapsed, 2),
        "optimizerType": result.optimizer_type,
        "topTrials": [
            {
                "trialId": t.trial_id,
                "score": t.score,
                "params": t.params,
                "durationSec": round(t.duration_sec, 2),
            }
            for t in result.top_n(5)
        ],
    })

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="hpo_runner",
        description="Unified HPO orchestrator for ML Dashboard models.",
    )
    config_group = parser.add_mutually_exclusive_group(required=True)
    config_group.add_argument(
        "--config",
        type=str,
        help="JSON string with the full HPO configuration.",
    )
    config_group.add_argument(
        "--config-file",
        type=str,
        help="Path to a JSON file containing the HPO configuration.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Use a dummy objective function for pipeline testing.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="Overall HPO timeout in seconds (overrides config value).",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        default=False,
        help="Enable DEBUG-level logging.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """CLI entry point for ``python -m src.ml.shared.hpo_runner``."""
    args = _parse_args(argv)

    # ---- Logging setup ----------------------------------------------------
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stderr,  # Keep stderr for logs, stdout for JSON events.
    )
    logger.info("HPO Runner starting (pid=%d)", os.getpid())

    # ---- Load config ------------------------------------------------------
    if args.config:
        try:
            config: dict[str, Any] = json.loads(args.config)
        except json.JSONDecodeError as exc:
            emit_error(f"Invalid --config JSON: {exc}")
            logger.error("Failed to parse --config JSON: %s", exc)
            raise SystemExit(1) from exc
    else:
        config_path = Path(args.config_file)
        if not config_path.exists():
            emit_error(f"Config file not found: {config_path}")
            logger.error("Config file not found: %s", config_path)
            raise SystemExit(1)
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            emit_error(f"Invalid JSON in {config_path}: {exc}")
            logger.error("Failed to parse config file %s: %s", config_path, exc)
            raise SystemExit(1) from exc

    # ---- Validate required keys -------------------------------------------
    required = ("model_type", "optimizer", "search_space")
    missing = [k for k in required if k not in config]
    if missing:
        msg = f"Missing required config keys: {missing}"
        emit_error(msg)
        logger.error(msg)
        raise SystemExit(1)

    # ---- CLI overrides ----------------------------------------------------
    if args.dry_run:
        config["dry_run"] = True
    if args.timeout is not None:
        config["timeout"] = args.timeout

    # ---- Run HPO ----------------------------------------------------------
    logger.info("Config loaded — dispatching to run_hpo()")
    run_hpo(config)
    logger.info("HPO Runner finished successfully")


if __name__ == "__main__":
    main()
