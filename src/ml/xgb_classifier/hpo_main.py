"""
Nested HPO-per-walk-forward-fold driver for the XGBoost classifier.

Spawned by the TypeScript HPO orchestrator when ``model_type`` ends with
``_nest``. Receives the same JSON config payload that ``hpo_runner`` would,
plus an optional ``walk_forward`` block.

Workflow per fold:
  1. Create / resume an Optuna SQLite study at
     ``optuna_studies/<model_type>_<symbol>_<tf>_fold<N>.db``
  2. Suggest hyperparameters from ``search_space`` via TPE
  3. Train ``xgb_classifier.main.train_with_config`` in-process (no subprocess
     overhead per trial)
  4. Report intermediate values during boosting for MedianPruner
  5. After all trials done, retrain with best params and save artifacts to
     ``data/models/<base>_w<N>/``
  6. Emit ``hpo-fold-best`` and ``hpo-fold-final`` events
After the last fold: emit ``hpo-complete`` with aggregated metrics.

CLI surface (mirrors hpo_runner.main):
    python -m src.ml.xgb_classifier.hpo_main --config '{"model_type": "...", ...}'
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import optuna
import xgboost as xgb

_HERE = Path(__file__).resolve()
_PROJECT_ROOT = _HERE.parents[3]
sys.path.insert(0, str(_PROJECT_ROOT))

from src.ml.shared.data import load_ohlcv_arrays
from src.ml.shared.feature_cache import cached_features, has_cache
from src.ml.shared.features import compute_features
from src.ml.shared.protocol import emit, emit_error, emit_log
from src.ml.xgb_classifier.main import train_with_config

logger = logging.getLogger(__name__)

_STUDY_DIR = _PROJECT_ROOT / "optuna_studies"


# ─── Utilities ────────────────────────────────────────────────────────────────


def _sample_param(trial: optuna.Trial, name: str, spec: dict) -> Any:
    t = spec.get("type", "float")
    if t == "int":
        return trial.suggest_int(
            name,
            int(spec["low"]),
            int(spec["high"]),
            log=bool(spec.get("log", False)),
            step=int(spec.get("step", 1)) if not spec.get("log", False) else 1,
        )
    if t == "float":
        return trial.suggest_float(
            name,
            float(spec["low"]),
            float(spec["high"]),
            log=bool(spec.get("log", False)),
        )
    if t == "categorical":
        return trial.suggest_categorical(name, list(spec["choices"]))
    if t == "bool":
        return trial.suggest_categorical(name, [False, True])
    raise ValueError(f"Unsupported search dim type: {t}")


def _add_months(d: datetime, months: int) -> datetime:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(
        d.day,
        [
            31,
            29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ][m - 1],
    )
    return datetime(y, m, day)


def _compute_windows(date_start: str, date_end: str, wf_cfg: dict) -> list[dict]:
    """Mirror src/server/training/walkforward.ts::computeWindows."""
    start = datetime.fromisoformat(date_start[:10])
    end = datetime.fromisoformat(date_end[:10])
    train_m = int(wf_cfg["trainMonths"])
    test_m = int(wf_cfg["testMonths"])
    step_m = int(wf_cfg.get("stepMonths") or test_m)

    windows: list[dict] = []
    cursor = start
    idx = 0
    while idx < 50:
        train_end = _add_months(cursor, train_m)
        test_start = train_end
        test_end = _add_months(test_start, test_m)
        if test_end > end:
            break
        windows.append(
            {
                "index": idx,
                "trainStart": cursor.strftime("%Y-%m-%d"),
                "trainEnd": train_end.strftime("%Y-%m-%d"),
                "testStart": test_start.strftime("%Y-%m-%d"),
                "testEnd": test_end.strftime("%Y-%m-%d"),
            }
        )
        cursor = _add_months(cursor, step_m)
        idx += 1
    return windows


def _kill_request_path(study_name: str, trial_id: int) -> Path:
    return _STUDY_DIR / f"{study_name}.kill_trial_{trial_id}"


# ─── Optuna pruning + kill-request callback ──────────────────────────────────


class _PrunableXgbCallback(xgb.callback.TrainingCallback):
    """Reports val_logloss to Optuna trial each round; raises TrialPruned on prune."""

    def __init__(self, trial: optuna.Trial, study_name: str, report_each: int = 10):
        self.trial = trial
        self.study_name = study_name
        self.report_each = max(1, report_each)
        self._kill_path = _kill_request_path(study_name, trial.number)

    def after_iteration(self, model, epoch: int, evals_log: dict) -> bool:
        # Honour kill-trial requests (file-touched by the API)
        if self._kill_path.exists():
            try:
                self._kill_path.unlink()
            except OSError:
                pass
            emit(
                {
                    "type": "hpo-trial-killed",
                    "trialId": int(self.trial.number),
                    "study": self.study_name,
                    "killedAt": int(epoch),
                }
            )
            raise optuna.TrialPruned(f"Trial {self.trial.number} killed by user")

        if (epoch % self.report_each) != 0:
            return False
        try:
            val_log = evals_log.get("val", {}).get("logloss")
            if not val_log:
                return False
            value = float(val_log[-1])
        except Exception:  # noqa: BLE001
            return False

        emit(
            {
                "type": "hpo-trial-intermediate",
                "trialId": int(self.trial.number),
                "step": int(epoch),
                "value": value,
            }
        )
        try:
            self.trial.report(value, step=int(epoch))
            if self.trial.should_prune():
                raise optuna.TrialPruned()
        except optuna.TrialPruned:
            raise
        except Exception:  # noqa: BLE001
            pass
        return False


# ─── Cache prewarm per fold ───────────────────────────────────────────────────


def _prewarm_fold_cache(
    symbol: str,
    timeframe: str,
    train_start: str,
    test_end: str,
    categories: list[str] | None,
    max_bars: int,
) -> None:
    date_range = {"start": train_start, "end": test_end}
    if has_cache(symbol, timeframe, date_range, categories):
        emit_log(f"[hpo-nest] Cache warm for {symbol}@{timeframe} {train_start}->{test_end}")
        return
    raw = load_ohlcv_arrays(symbol, timeframe, max_bars=max_bars, date_range=date_range)

    def _compute():
        ohlcv = {
            "open_": raw["open"],
            "high": raw["high"],
            "low": raw["low"],
            "close": raw["close"],
            "volume": raw["volume"],
        }
        matrix, names, _ts = compute_features(ohlcv, categories=categories, n_jobs=1)
        ts_arr = np.asarray(
            [t.timestamp() if hasattr(t, "timestamp") else float(t) for t in raw["timestamp"]],
            dtype=np.int64,
        )
        return matrix.astype(np.float32), list(names), ts_arr

    cached_features(symbol, timeframe, date_range, categories, _compute)
    emit_log(f"[hpo-nest] Prewarmed feature cache for fold {train_start}->{test_end}")


# ─── Main HPO loop ────────────────────────────────────────────────────────────


def run_nested_hpo(config: dict[str, Any]) -> dict:
    model_type = str(config["model_type"])
    symbol = str(config["symbol"]).upper()
    timeframe = str(config.get("timeframe") or "1h")
    direction = str(config.get("direction") or "maximize")
    objective_metric = str(config.get("objective_metric") or "sharpe_after_costs")
    search_space = dict(config["search_space"])
    fixed_hyperparameters = dict(config.get("fixed_hyperparameters") or {})
    feature_categories = config.get("feature_categories")
    if isinstance(feature_categories, str):
        feature_categories = [s.strip() for s in feature_categories.split(",") if s.strip()]
    max_bars = int(config.get("max_bars") or 0)

    optimizer_cfg = dict(config.get("optimizer_config") or {})
    n_trials_per_fold = int(
        optimizer_cfg.get("n_trials") or optimizer_cfg.get("nTrialsPerFold") or 20
    )
    seed = int(optimizer_cfg.get("seed") or 42)

    wf_cfg = config.get("walk_forward") or config.get("walkForward")
    date_range = config.get("date_range") or config.get("dateRange")
    if not wf_cfg or not date_range or not date_range.get("start") or not date_range.get("end"):
        raise ValueError("Nested HPO requires walk_forward + date_range to be set")

    windows = _compute_windows(date_range["start"], date_range["end"], wf_cfg)
    if not windows:
        raise ValueError("Walk-forward produced 0 windows; check date_range vs train/test months")
    emit_log(f"[hpo-nest] {len(windows)} walk-forward folds")
    emit(
        {
            "type": "hpo-started",
            "modelType": model_type,
            "optimizer": "optuna",
            "direction": direction,
            "objectiveMetric": objective_metric,
            "searchSpace": search_space,
            "nTrialsPerFold": n_trials_per_fold,
            "nFolds": len(windows),
            "walkForward": wf_cfg,
        }
    )

    _STUDY_DIR.mkdir(parents=True, exist_ok=True)
    base_model_id = (
        config.get("model_id") or f"{symbol}_{timeframe}_{model_type}_{int(time.time())}"
    )

    per_fold_results: list[dict] = []

    for fold in windows:
        fold_idx = int(fold["index"])
        study_name = f"{model_type}_{symbol}_{timeframe}_fold{fold_idx}"
        study_path = _STUDY_DIR / f"{study_name}.db"
        storage_url = f"sqlite:///{study_path.as_posix()}"

        emit(
            {
                "type": "hpo-fold-start",
                "fold": fold_idx,
                "totalFolds": len(windows),
                "trainRange": {"start": fold["trainStart"], "end": fold["trainEnd"]},
                "testRange": {"start": fold["testStart"], "end": fold["testEnd"]},
                "studyName": study_name,
            }
        )

        # Pre-warm the per-fold feature cache once (shared across all trials in the fold).
        try:
            _prewarm_fold_cache(
                symbol, timeframe, fold["trainStart"], fold["testEnd"], feature_categories, max_bars
            )
        except Exception as exc:  # noqa: BLE001
            emit_log(f"[hpo-nest] Cache prewarm failed for fold {fold_idx}: {exc}", level="warning")

        sampler = optuna.samplers.TPESampler(seed=seed + fold_idx)
        pruner = optuna.pruners.MedianPruner(
            n_startup_trials=5, n_warmup_steps=50, interval_steps=10
        )
        study = optuna.create_study(
            study_name=study_name,
            storage=storage_url,
            direction=direction,
            sampler=sampler,
            pruner=pruner,
            load_if_exists=True,
        )

        def objective(trial: optuna.Trial) -> float:
            sampled = {
                name: _sample_param(trial, name, spec) for name, spec in search_space.items()
            }

            trial_model_id = f"{base_model_id}_w{fold_idx}_t{trial.number}"
            cfg = {
                "symbol": symbol,
                "timeframe": timeframe,
                "model_id": trial_model_id,
                "max_bars": max_bars,
                "date_start": fold["trainStart"],
                "date_end": fold["testEnd"],
                "feature_categories": (
                    ",".join(feature_categories) if feature_categories else None
                ),
                # Defaults for everything not in search space; fixed_hyperparameters
                # overrides them, then the trial sample overrides those.
                "n_estimators": 500,
                "max_depth": 6,
                "learning_rate": 0.05,
                "subsample": 0.8,
                "colsample_bytree": 0.8,
                "min_child_weight": 1.0,
                "reg_lambda": 1.0,
                "reg_alpha": 0.0,
                "early_stopping_rounds": 50,
                "label_horizon_bars": 5,
                "label_threshold_bp": 5.0,
                "device": "cuda",
                "train_frac": 0.8,
                "pnl_threshold": 0.55,
                # Use the test-window fraction within the fold's full slice as val:
                # we read the whole [trainStart..testEnd] range and let the time_split
                # carve a final 20% for OOS. The fold's trainEnd is implicitly enforced
                # by the date range we pass.
                **fixed_hyperparameters,
                **sampled,
            }
            emit(
                {
                    "type": "hpo-trial-start",
                    "trialId": int(trial.number),
                    "fold": fold_idx,
                    "params": sampled,
                }
            )

            t0 = time.perf_counter()
            try:
                cb = _PrunableXgbCallback(trial, study_name, report_each=10)
                diag = train_with_config(cfg, save_artifacts=False, xgb_callback_obj=cb)
            except optuna.TrialPruned:
                emit(
                    {
                        "type": "hpo-trial-pruned",
                        "trialId": int(trial.number),
                        "fold": fold_idx,
                        "params": sampled,
                        "prunedAtStep": int(trial.last_step or 0),
                    }
                )
                raise
            elapsed = time.perf_counter() - t0
            metrics = {
                k: v["value"] if isinstance(v, dict) and "value" in v else v
                for k, v in diag.get("metrics", {}).items()
            }
            score = float(metrics.get(objective_metric, float("nan")))

            emit(
                {
                    "type": "hpo-trial-done",
                    "trialId": int(trial.number),
                    "fold": fold_idx,
                    "params": sampled,
                    "score": score,
                    "metrics": metrics,
                    "durationSec": round(elapsed, 2),
                }
            )
            return score

        try:
            study.optimize(objective, n_trials=n_trials_per_fold)
        except KeyboardInterrupt:
            emit({"type": "hpo-fold-interrupted", "fold": fold_idx})
            break

        if study.best_trial is not None:
            best_params = dict(study.best_trial.params)
            best_score = (
                float(study.best_trial.value)
                if study.best_trial.value is not None
                else float("nan")
            )
        else:
            best_params, best_score = {}, float("nan")

        emit(
            {
                "type": "hpo-fold-best",
                "fold": fold_idx,
                "bestParams": best_params,
                "bestScore": best_score,
            }
        )

        # Final retrain on the best params with full artifact persistence.
        final_id = f"{base_model_id}_w{fold_idx}"
        final_cfg = {
            "symbol": symbol,
            "timeframe": timeframe,
            "model_id": final_id,
            "max_bars": max_bars,
            "date_start": fold["trainStart"],
            "date_end": fold["testEnd"],
            "feature_categories": (",".join(feature_categories) if feature_categories else None),
            "n_estimators": 500,
            "max_depth": 6,
            "learning_rate": 0.05,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "min_child_weight": 1.0,
            "reg_lambda": 1.0,
            "reg_alpha": 0.0,
            "early_stopping_rounds": 50,
            "label_horizon_bars": 5,
            "label_threshold_bp": 5.0,
            "device": "cuda",
            "train_frac": 0.8,
            "pnl_threshold": 0.55,
            **fixed_hyperparameters,
            **best_params,
        }
        try:
            final_diag = train_with_config(final_cfg, save_artifacts=True, xgb_callback_obj=None)
        except Exception as exc:  # noqa: BLE001
            emit_log(f"[hpo-nest] Final retrain failed for fold {fold_idx}: {exc}", level="error")
            final_diag = {"error": str(exc)}

        per_fold_results.append(
            {
                "fold": fold_idx,
                "studyName": study_name,
                "studyPath": str(study_path),
                "bestParams": best_params,
                "bestScore": best_score,
                "modelId": final_id,
                "metrics": {
                    k: v["value"] if isinstance(v, dict) and "value" in v else v
                    for k, v in final_diag.get("metrics", {}).items()
                }
                if isinstance(final_diag, dict)
                else {},
                "completedTrials": int(
                    len([t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE])
                ),
                "prunedTrials": int(
                    len([t for t in study.trials if t.state == optuna.trial.TrialState.PRUNED])
                ),
                "trainRange": {"start": fold["trainStart"], "end": fold["trainEnd"]},
                "testRange": {"start": fold["testStart"], "end": fold["testEnd"]},
            }
        )

        emit(
            {
                "type": "hpo-fold-final",
                "fold": fold_idx,
                "modelId": final_id,
                "metrics": per_fold_results[-1]["metrics"],
            }
        )

    aggregated = _aggregate(per_fold_results, objective_metric)
    emit(
        {
            "type": "hpo-complete",
            "perFold": per_fold_results,
            "aggregated": aggregated,
            "nFolds": len(per_fold_results),
            "baseModelId": base_model_id,
        }
    )

    return {"perFold": per_fold_results, "aggregated": aggregated}


def _aggregate(per_fold: list[dict], primary_metric: str) -> dict:
    metric_keys = set()
    for f in per_fold:
        metric_keys.update(f.get("metrics", {}).keys())
    out = {}
    for k in metric_keys:
        vals = [
            f["metrics"].get(k)
            for f in per_fold
            if isinstance(f.get("metrics", {}).get(k), (int, float))
            and not math.isnan(f["metrics"][k])
        ]
        if not vals:
            continue
        arr = np.asarray(vals, dtype=np.float64)
        out[k] = {
            "mean": float(arr.mean()),
            "std": float(arr.std(ddof=1)) if arr.size > 1 else 0.0,
            "min": float(arr.min()),
            "max": float(arr.max()),
            "n_folds": int(arr.size),
        }
    out["_primary"] = primary_metric
    return out


# ─── CLI ──────────────────────────────────────────────────────────────────────


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="xgb_classifier.hpo_main", description="Nested HPO per WF fold for XGBoost classifier"
    )
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--config", help="JSON config string")
    g.add_argument("--config-file", help="Path to JSON config file")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stderr,
    )
    logger.info("hpo_main starting (pid=%d)", os.getpid())

    try:
        if args.config:
            config = json.loads(args.config)
        else:
            config = json.loads(Path(args.config_file).read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        emit_error(f"Invalid HPO config JSON: {exc}")
        raise SystemExit(1) from exc

    try:
        run_nested_hpo(config)
    except Exception as exc:  # noqa: BLE001
        import traceback

        emit_error(message=str(exc), details=traceback.format_exc())
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
