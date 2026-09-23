"""
XGBoost direction-classifier — single-fold trainer.

Spawned by the Node training orchestrator with the standard CLI surface:

    python src/ml/xgb_classifier/main.py \\
        --symbol MNQ --timeframe 5m --model-id MNQ_5m_xgb_classifier_<ts> --json \\
        --max-bars 200000 \\
        [--date-start ... --date-end ...] \\
        [--feature-categories price_action,volatility,...] \\
        [--n-estimators 500 --max-depth 6 --learning-rate 0.05 ...]

Emits the full standard JSON-line event stream:
  - log
  - progress
  - metric_declarations  (renderer schema for dashboard auto-render)
  - epoch_metric         (per N-round XGBoost eval-set log-loss + AUC)
  - done                 (final diagnostics)

Outputs into ``data/models/<model_id>/``:
  - model.ubj                 — XGBoost native binary model
  - checkpoint.json           — light metadata (best_iteration, params, n_train, n_val)
  - diagnostics.json          — SelfDescribingDiagnostics consumed by the dashboard
  - oos_predictions.parquet   — (timestamp, prob_up, label, realized_return_bps)
  - shap_summary.npz          — SHAP values + abs-mean importance for the top-K rows
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

_HERE = Path(__file__).resolve()
_PROJECT_ROOT = _HERE.parents[3]
sys.path.insert(0, str(_PROJECT_ROOT))

from src.ml.shared.features import load_features_with_cache
from src.ml.shared.protocol import (
    dumps_safe,
    emit,
    emit_done,
    emit_error,
    emit_log,
    emit_metric_declarations,
    emit_progress,
)
from src.ml.xgb_classifier.eval import (
    auc_score,
    brier_score,
    hit_rate_at,
    log_loss,
    reliability_curve,
    simulate_pnl,
)
from src.ml.xgb_classifier.labels import make_labels, time_split_indices


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="XGBoost direction classifier")
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--timeframe", required=True)
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--json", action="store_true", help="Emit JSON-line events")
    ap.add_argument("--max-bars", type=int, default=0)
    ap.add_argument("--date-start", default=None)
    ap.add_argument("--date-end", default=None)
    ap.add_argument(
        "--feature-categories",
        default=None,
        help="Comma-separated list. None = use registry default for the model.",
    )
    # Hyperparameters
    ap.add_argument("--n-estimators", type=int, default=500)
    ap.add_argument("--max-depth", type=int, default=6)
    ap.add_argument("--learning-rate", type=float, default=0.05)
    ap.add_argument("--subsample", type=float, default=0.8)
    ap.add_argument("--colsample-bytree", type=float, default=0.8)
    ap.add_argument("--min-child-weight", type=float, default=1.0)
    ap.add_argument("--reg-lambda", type=float, default=1.0)
    ap.add_argument("--reg-alpha", type=float, default=0.0)
    ap.add_argument("--early-stopping-rounds", type=int, default=50)
    ap.add_argument("--label-horizon-bars", type=int, default=5)
    ap.add_argument(
        "--label-threshold-bp",
        type=float,
        default=5.0,
        help=(
            "In the default 'atr' threshold mode this is an absolute FLOOR in bp "
            "on the barrier width, not the barrier itself. In 'fixed_bp' mode it "
            "IS the barrier. See src/ml/xgb_classifier/labels.py."
        ),
    )
    ap.add_argument(
        "--label-threshold-mode",
        choices=("atr", "fixed_bp"),
        default="atr",
        help=(
            "atr (default): barrier = label-atr-multiple x trailing ATR, so it "
            "scales with the timeframe. fixed_bp: constant label-threshold-bp."
        ),
    )
    ap.add_argument("--label-atr-window", type=int, default=20)
    ap.add_argument("--label-atr-multiple", type=float, default=1.0)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--train-frac", type=float, default=0.8)
    ap.add_argument(
        "--pnl-threshold",
        type=float,
        default=0.55,
        help="Conviction threshold for the cost-adjusted PnL sim.",
    )
    return ap.parse_args()


def _emit_metric_declarations() -> None:
    emit_metric_declarations(
        {
            "auc": {
                "renderer": "gauge",
                "group": "discrimination",
                "mission": "Does the model rank positives above negatives?",
                "context": {"min": 0.5, "good": 0.55, "great": 0.60, "max": 1.0},
            },
            "log_loss": {
                "renderer": "number",
                "group": "discrimination",
                "mission": "Lower is better. ln(2)=0.693 is no-info baseline.",
                "context": {"min": 0.0, "baseline": 0.693, "decimals": 4},
            },
            "brier_score": {
                "renderer": "number",
                "group": "calibration",
                "mission": "Squared error of probabilities. 0.25 is uninformative.",
                "context": {"min": 0.0, "baseline": 0.25, "decimals": 4},
            },
            "ece": {
                "renderer": "number",
                "group": "calibration",
                "mission": "Expected calibration error (lower better).",
                "context": {"min": 0.0, "good": 0.05, "decimals": 4},
            },
            "hit_rate_55": {
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Direction accuracy on conviction trades (p>=0.55 or p<=0.45).",
                "context": {"baseline": 0.5, "good": 0.55, "great": 0.60},
            },
            "profit_factor": {
                "renderer": "gauge",
                "group": "pnl",
                "mission": "Sum of wins / |sum of losses| after costs. 1.0 = breakeven.",
                "context": {"min": 0.0, "breakeven": 1.0, "good": 1.5, "great": 2.0},
            },
            "sharpe_after_costs": {
                "renderer": "number",
                "group": "pnl",
                "mission": "Sharpe ratio of trade-by-trade PnL after costs (unitless).",
                "context": {"baseline": 0.0, "good": 1.0, "great": 2.0, "decimals": 3},
            },
            "cum_pnl_dollars": {
                "renderer": "number",
                "group": "pnl",
                "mission": "Cumulative dollars of trade-by-trade PnL after costs.",
                "context": {"prefix": "$", "decimals": 0},
            },
            "max_drawdown_dollars": {
                "renderer": "number",
                "group": "pnl",
                "mission": "Worst drawdown of cumulative PnL ($).",
                "context": {"prefix": "$", "decimals": 0},
            },
            "n_trades": {
                "renderer": "number",
                "group": "pnl",
                "mission": "How many trades the model took at the conviction threshold.",
                "context": {"min": 0, "good": 50, "decimals": 0},
            },
            "calibration_curve": {
                "renderer": "calibration",
                "group": "calibration",
                "mission": "Predicted vs observed frequency in 10 equal-width bins.",
                "context": {},
            },
        }
    )


# ─── Training callback for streaming metrics ──────────────────────────────────


class _StreamCallback:
    """xgb.callback.TrainingCallback adapter — streams epoch_metric every N rounds."""

    def __init__(self, total: int, every: int = 10):
        self.total = total
        self.every = max(1, every)

    def __call__(self, evt: dict) -> None:
        emit({"type": "epoch_metric", **evt})


def _make_xgb_callback(total: int, every: int):
    import xgboost as xgb

    class StreamingCallback(xgb.callback.TrainingCallback):
        def after_iteration(self, model, epoch, evals_log):
            if (epoch % every) != 0 and epoch != total - 1:
                return False
            payload: dict[str, Any] = {"iteration": int(epoch), "total": int(total)}
            for split_name, metric_dict in evals_log.items():
                for metric_name, values in metric_dict.items():
                    if values:
                        payload[f"{split_name}_{metric_name}"] = float(values[-1])
            emit({"type": "epoch_metric", **payload})
            emit_progress(epoch + 1, total, "training")
            return False

    return StreamingCallback()


# ─── SHAP summary ─────────────────────────────────────────────────────────────


def _shap_summary(booster, x_sample: np.ndarray, feature_names: list[str]) -> dict:
    import xgboost as xgb

    dmat = xgb.DMatrix(x_sample, feature_names=feature_names)
    shap_values = booster.predict(dmat, pred_contribs=True)
    # Last column is the bias term (expected value); drop it.
    contribs = shap_values[:, :-1]
    abs_mean = np.abs(contribs).mean(axis=0)
    order = np.argsort(-abs_mean)
    ranked_names = [feature_names[i] for i in order]
    ranked_imp = abs_mean[order].tolist()
    return {
        "feature_names_ranked": ranked_names,
        "abs_mean_shap_ranked": ranked_imp,
        "top10_names": ranked_names[:10],
        "top10_abs_mean_shap": ranked_imp[:10],
    }, contribs


# ─── Train pipeline ───────────────────────────────────────────────────────────


def _args_to_config(args: argparse.Namespace) -> dict:
    """Translate argparse Namespace to the canonical config dict."""
    return {
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "model_id": args.model_id,
        "max_bars": int(args.max_bars or 0),
        "date_start": args.date_start,
        "date_end": args.date_end,
        "feature_categories": args.feature_categories,
        "n_estimators": int(args.n_estimators),
        "max_depth": int(args.max_depth),
        "learning_rate": float(args.learning_rate),
        "subsample": float(args.subsample),
        "colsample_bytree": float(args.colsample_bytree),
        "min_child_weight": float(args.min_child_weight),
        "reg_lambda": float(args.reg_lambda),
        "reg_alpha": float(args.reg_alpha),
        "early_stopping_rounds": int(args.early_stopping_rounds),
        "label_horizon_bars": int(args.label_horizon_bars),
        "label_threshold_bp": float(args.label_threshold_bp),
        "label_threshold_mode": str(args.label_threshold_mode),
        "label_atr_window": int(args.label_atr_window),
        "label_atr_multiple": float(args.label_atr_multiple),
        "device": args.device,
        "train_frac": float(args.train_frac),
        "pnl_threshold": float(args.pnl_threshold),
    }


def train_with_config(config: dict, *, save_artifacts: bool = True, xgb_callback_obj=None) -> dict:
    """Programmatic single-fold training entry — used by both CLI and hpo_main.py.

    Parameters
    ----------
    config : dict
        Same shape as ``_args_to_config`` output.
    save_artifacts : bool
        When False, skip writing model.ubj/diagnostics.json/etc. Useful for HPO
        trials where we only care about the metric.
    xgb_callback_obj : xgb.callback.TrainingCallback or None
        Optional caller-supplied callback (e.g. an Optuna pruning callback that
        wraps ``trial.report``).
    """
    ns = argparse.Namespace(
        **{
            # Pull through everything from the dict
            **config,
            # Argparse-style names with hyphens converted (most are already snake)
            "json": True,
        }
    )
    # Re-attach as attributes named the way train_one_fold uses them.
    return _train_one_fold_inner(
        ns, save_artifacts=save_artifacts, xgb_callback_obj=xgb_callback_obj
    )


def train_one_fold(args: argparse.Namespace) -> dict:
    """CLI entry kept for back-compat. Same behaviour as `train_with_config`."""
    return _train_one_fold_inner(args, save_artifacts=True, xgb_callback_obj=None)


def _train_one_fold_inner(
    args: argparse.Namespace, *, save_artifacts: bool, xgb_callback_obj
) -> dict:
    import xgboost as xgb

    date_range = None
    if args.date_start or args.date_end:
        date_range = {}
        if args.date_start:
            date_range["start"] = args.date_start
        if args.date_end:
            date_range["end"] = args.date_end

    categories = None
    if args.feature_categories:
        categories = [s.strip() for s in args.feature_categories.split(",") if s.strip()]

    emit_log(f"[xgb] Loading {args.symbol}@{args.timeframe} (categories={categories or 'all'})")
    matrix, names, timestamps, raw = load_features_with_cache(
        args.symbol,
        args.timeframe,
        date_range,
        categories,
        args.max_bars,
    )
    n_total = matrix.shape[0]
    emit_log(f"[xgb] Loaded {n_total:,} bars x {matrix.shape[1]} features")

    threshold_mode = str(getattr(args, "label_threshold_mode", "atr"))
    atr_window = int(getattr(args, "label_atr_window", 20))
    atr_multiple = float(getattr(args, "label_atr_multiple", 1.0))
    floor_bp = float(args.label_threshold_bp)

    if threshold_mode == "atr":
        emit_log(
            f"[xgb] Generating triple-barrier labels (H={args.label_horizon_bars}, "
            f"barrier={atr_multiple}x trailing ATR over {atr_window} bars, "
            f"floor={floor_bp}bp)"
        )
    else:
        emit_log(
            f"[xgb] Generating triple-barrier labels (H={args.label_horizon_bars}, "
            f"barrier=fixed {floor_bp}bp)"
        )
    labels, valid, label_diag = make_labels(
        raw["high"],
        raw["low"],
        raw["close"],
        horizon_bars=args.label_horizon_bars,
        threshold_bp=floor_bp,
        threshold_mode=threshold_mode,
        atr_window=atr_window,
        atr_multiple=atr_multiple,
        return_diagnostics=True,
    )
    n_valid = int(valid.sum())
    emit_log(
        "[xgb] Barrier width in bp: "
        f"median={label_diag['barrier_bp_median']:.1f} "
        f"min={label_diag['barrier_bp_min']:.1f} max={label_diag['barrier_bp_max']:.1f}"
    )
    emit_log(
        f"[xgb] Label drops — barrier warmup {label_diag['dropped_barrier_warmup']:,}, "
        f"horizon overflow {label_diag['dropped_horizon_overflow']:,}, "
        f"neither barrier touched {label_diag['dropped_no_barrier_touched']:,}, "
        f"both touched in one bar {label_diag['dropped_both_barriers_same_bar']:,}, "
        f"bad close {label_diag['dropped_bad_close']:,}"
    )
    if n_valid < 1000:
        tied = label_diag["dropped_both_barriers_same_bar"]
        hint = (
            "the barrier is too NARROW for this timeframe — both sides are touched "
            "inside one forward bar, so the bar cannot be labelled. Widen it "
            "(raise --label-atr-multiple, or --label-threshold-bp in fixed_bp mode). "
            "Lowering the threshold makes this strictly worse."
            if tied >= (n_total - n_valid) * 0.5
            else "the barrier is too WIDE — it is rarely touched inside the horizon. "
            "Lower --label-atr-multiple or lengthen --label-horizon-bars."
        )
        raise RuntimeError(
            f"Only {n_valid} valid labels out of {n_total} bars. Dominant cause: {hint} "
            f"(drop breakdown: {label_diag})"
        )
    pos_rate = float(labels[valid].mean())
    emit_log(f"[xgb] Labels: {n_valid:,} valid, pos_rate={pos_rate:.3f}")

    # Filter feature matrix + close + timestamps to valid rows.
    keep_idx = np.flatnonzero(valid)
    X = matrix[keep_idx]
    y = labels[keep_idx].astype(np.int8)
    ts_kept = timestamps[keep_idx]
    close_kept = raw["close"][keep_idx]

    # Drop rows with NaN/Inf features (warmup region of indicators).
    finite = np.isfinite(X).all(axis=1)
    X = X[finite]
    y = y[finite]
    ts_kept = ts_kept[finite]
    close_kept = close_kept[finite]
    # Index of every surviving row back into the ORIGINAL bar sequence. Realized
    # returns and the PnL sim must step forward H *bars*, not H *surviving rows*.
    orig_idx = keep_idx[finite]
    emit_log(f"[xgb] After dropping non-finite rows: {X.shape[0]:,} samples")
    emit_log(
        f"[xgb] Row accounting: {n_total:,} bars loaded -> "
        f"{int(np.isfinite(matrix).all(axis=1).sum()):,} with all {matrix.shape[1]} features "
        f"finite -> {n_valid:,} labelled -> {X.shape[0]:,} usable samples"
    )

    train_idx, val_idx = time_split_indices(
        n_valid=X.shape[0],
        train_frac=args.train_frac,
        embargo=args.label_horizon_bars,
    )
    n_train, n_val = train_idx.size, val_idx.size
    emit_log(f"[xgb] Time split: train={n_train:,} val={n_val:,} embargo={args.label_horizon_bars}")

    X_train, y_train = X[train_idx], y[train_idx]
    X_val, y_val = X[val_idx], y[val_idx]
    ts_val = ts_kept[val_idx]

    dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=names)
    dval = xgb.DMatrix(X_val, label=y_val, feature_names=names)

    params: dict[str, Any] = {
        "objective": "binary:logistic",
        "eval_metric": ["logloss", "auc"],
        "tree_method": "hist",
        "device": args.device,
        "max_depth": int(args.max_depth),
        "learning_rate": float(args.learning_rate),
        "subsample": float(args.subsample),
        "colsample_bytree": float(args.colsample_bytree),
        "min_child_weight": float(args.min_child_weight),
        "reg_lambda": float(args.reg_lambda),
        "reg_alpha": float(args.reg_alpha),
        "verbosity": 0,
    }

    _emit_metric_declarations()

    emit_log(
        f"[xgb] xgb.train: rounds={args.n_estimators} early_stopping={args.early_stopping_rounds} "
        f"device={args.device}"
    )
    t0 = time.perf_counter()
    callbacks_list = [_make_xgb_callback(int(args.n_estimators), every=10)]
    if xgb_callback_obj is not None:
        callbacks_list.append(xgb_callback_obj)
    booster = xgb.train(
        params,
        dtrain,
        num_boost_round=int(args.n_estimators),
        evals=[(dtrain, "train"), (dval, "val")],
        early_stopping_rounds=int(args.early_stopping_rounds),
        callbacks=callbacks_list,
        verbose_eval=False,
    )
    train_secs = time.perf_counter() - t0
    best_iter = (
        int(booster.best_iteration)
        if booster.best_iteration is not None
        else int(args.n_estimators)
    )
    emit_log(f"[xgb] Train done in {train_secs:.1f}s (best_iteration={best_iter})")

    # OOS predictions on val
    p_val = booster.predict(dval, iteration_range=(0, best_iter + 1)).astype(np.float64)

    # Metrics
    auc = auc_score(y_val, p_val)
    ll = log_loss(y_val, p_val)
    brier = brier_score(y_val, p_val)
    rel = reliability_curve(y_val, p_val, n_bins=10)
    hr_50, n_50 = hit_rate_at(y_val, p_val, 0.50)
    hr_55, n_55 = hit_rate_at(y_val, p_val, 0.55)
    hr_60, n_60 = hit_rate_at(y_val, p_val, 0.60)
    # PnL sim on the ORIGINAL bar grid.
    #
    # simulate_pnl exits at close[i + horizon_bars]. Feeding it the filtered
    # validation closes would step forward H *surviving rows*, which is more
    # than H bars wherever a bar was dropped — that silently lengthens every
    # holding period and inflates the move. So hand it the raw close series
    # over the validation span (plus H bars of exit room) with probabilities
    # placed at their true bar positions; bars with no prediction carry NaN,
    # which fails both the long and the short test and is therefore flat.
    horizon = int(args.label_horizon_bars)
    raw_close = np.asarray(raw["close"], dtype=np.float64)
    val_orig = orig_idx[val_idx]
    span_start = int(val_orig[0])
    span_end = min(int(val_orig[-1]) + horizon + 1, raw_close.shape[0])
    close_span = raw_close[span_start:span_end]
    p_span = np.full(close_span.shape[0], np.nan, dtype=np.float64)
    p_span[val_orig - span_start] = p_val
    pnl = simulate_pnl(
        close=close_span,
        p_up=p_span,
        threshold=float(args.pnl_threshold),
        horizon_bars=horizon,
        symbol=args.symbol,
    )

    # SHAP on a 5k-row subsample of validation
    sample_n = min(5000, n_val)
    rng = np.random.default_rng(seed=42)
    shap_idx = rng.choice(n_val, size=sample_n, replace=False)
    shap_summary, shap_contribs = _shap_summary(
        booster,
        X_val[shap_idx],
        names,
    )

    # Per-bar realized return at the labeling horizon (bp, NaN where the horizon
    # runs past the end of the data). Stepped on the ORIGINAL bar grid, so this
    # is genuinely H bars ahead — walking H rows through the filtered array
    # would skip over every dropped bar and overstate the move.
    realized_full = np.full(val_idx.size, np.nan, dtype=np.float64)
    exit_idx = val_orig + horizon
    has_exit = exit_idx < raw_close.shape[0]
    realized_full[has_exit] = (
        np.log(raw_close[exit_idx[has_exit]] / raw_close[val_orig[has_exit]]) * 10000.0
    )

    out_dir = _PROJECT_ROOT / "data" / "models" / args.model_id
    if save_artifacts:
        out_dir.mkdir(parents=True, exist_ok=True)
        booster.save_model(str(out_dir / "model.ubj"))
        np.savez_compressed(
            out_dir / "shap_summary.npz",
            contribs=shap_contribs.astype(np.float32),
            sample_indices=shap_idx.astype(np.int64),
            feature_names=np.array(names, dtype=object),
        )
        import polars as pl

        pl.DataFrame(
            {
                "ts": ts_val.astype("int64"),
                "prob_up": p_val.astype(np.float32),
                "label": y_val.astype(np.int8),
                "realized_return_bp": realized_full.astype(np.float32),
            }
        ).write_parquet(
            out_dir / "oos_predictions.parquet", compression="zstd", compression_level=3
        )

    # Diagnostics shape — SelfDescribingDiagnostics-compatible (group + mission per metric)
    diagnostics = {
        "model_id": args.model_id,
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "n_train": n_train,
        "n_val": n_val,
        "n_features": X.shape[1],
        "best_iteration": best_iter,
        "train_secs": round(train_secs, 2),
        "metrics": {
            "auc": {
                "value": auc,
                "renderer": "gauge",
                "group": "discrimination",
                "mission": "Rank positives above negatives",
            },
            "log_loss": {
                "value": ll,
                "renderer": "number",
                "group": "discrimination",
                "mission": "Lower better; baseline ln(2)=0.693",
            },
            "brier_score": {
                "value": brier,
                "renderer": "number",
                "group": "calibration",
                "mission": "Squared error of probabilities",
            },
            "ece": {
                "value": rel["ece"],
                "renderer": "number",
                "group": "calibration",
                "mission": "Expected calibration error",
            },
            "hit_rate_55": {
                "value": hr_55,
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Direction accuracy at p>=0.55",
                "context": {"n_picks": n_55},
            },
            "hit_rate_60": {
                "value": hr_60,
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Direction accuracy at p>=0.60",
                "context": {"n_picks": n_60},
            },
            "hit_rate_50": {
                "value": hr_50,
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Direction accuracy on all picks",
                "context": {"n_picks": n_50},
            },
            "profit_factor": {
                "value": pnl["profit_factor"],
                "renderer": "gauge",
                "group": "pnl",
                "mission": "Wins / |losses| after costs",
            },
            "sharpe_after_costs": {
                "value": pnl["sharpe_after_costs"],
                "renderer": "number",
                "group": "pnl",
                "mission": "Trade-by-trade Sharpe after costs",
            },
            "cum_pnl_dollars": {
                "value": pnl["cum_pnl_dollars"],
                "renderer": "number",
                "group": "pnl",
                "mission": "Total dollars after costs",
            },
            "max_drawdown_dollars": {
                "value": pnl["max_drawdown_dollars"],
                "renderer": "number",
                "group": "pnl",
                "mission": "Worst drawdown ($)",
            },
            "max_drawdown_pct": {
                "value": pnl["max_drawdown_pct"],
                "renderer": "number",
                "group": "pnl",
                "mission": "Worst drawdown (%)",
            },
            "n_trades": {
                "value": pnl["n_trades"],
                "renderer": "number",
                "group": "pnl",
                "mission": "Number of trades taken",
            },
        },
        "calibration_curve": rel,
        "label_diagnostics": label_diag,
        "row_accounting": {
            "bars_loaded": int(n_total),
            "bars_all_features_finite": int(np.isfinite(matrix).all(axis=1).sum()),
            "bars_labelled": int(n_valid),
            "usable_samples": int(X.shape[0]),
        },
        "pnl_curve": {
            "trade_pnl_dollars": pnl.get("trade_pnl_dollars", []),
            "n_long": pnl.get("n_long", 0),
            "n_short": pnl.get("n_short", 0),
        },
        "shap": shap_summary,
        "params": {
            "n_estimators": int(args.n_estimators),
            "max_depth": int(args.max_depth),
            "learning_rate": float(args.learning_rate),
            "subsample": float(args.subsample),
            "colsample_bytree": float(args.colsample_bytree),
            "min_child_weight": float(args.min_child_weight),
            "reg_lambda": float(args.reg_lambda),
            "reg_alpha": float(args.reg_alpha),
            "early_stopping_rounds": int(args.early_stopping_rounds),
            "label_horizon_bars": int(args.label_horizon_bars),
            "label_threshold_bp": float(args.label_threshold_bp),
            "label_threshold_mode": threshold_mode,
            "label_atr_window": atr_window,
            "label_atr_multiple": atr_multiple,
            "device": args.device,
            "train_frac": float(args.train_frac),
            "pnl_threshold": float(args.pnl_threshold),
        },
    }

    if not save_artifacts:
        return diagnostics

    # dumps_safe, not json.dumps — a bare NaN makes the whole file unparseable
    # by JSON.parse and 500s /api/training/models/:id/diagnostics.
    (out_dir / "checkpoint.json").write_text(
        dumps_safe(
            {
                "model_id": args.model_id,
                "best_iteration": best_iter,
                "n_train": n_train,
                "n_val": n_val,
                "feature_names": names,
                "params": diagnostics["params"],
                "saved_at_ms": int(time.time() * 1000),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (out_dir / "diagnostics.json").write_text(dumps_safe(diagnostics, indent=2), encoding="utf-8")

    return diagnostics


def main() -> None:
    args = _parse_args()
    try:
        diag = train_one_fold(args)
        emit_done(
            model_path=str(_PROJECT_ROOT / "data" / "models" / args.model_id), diagnostics=diag
        )
    except Exception as exc:
        import traceback

        emit_error(message=str(exc), details=traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
