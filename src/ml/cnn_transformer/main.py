#!/usr/bin/env python3
"""
CNN+Transformer Triple Barrier Predictor — entry point.

Two modes:
  Default: single training run with specified barrier config
  --hpo:   walk-forward HPO via Optuna over barrier + training params

Usage (single run):
  python src/ml/cnn_transformer/main.py --symbol MNQ --timeframe 1m \
    --epochs 30 --batch-size 4096 --learning-rate 0.0001 \
    --window-size 128 --tp-multiplier 2.0 --sl-multiplier 2.0 \
    --vertical-bars 60 --test-split 0.20

Usage (HPO):
  python src/ml/cnn_transformer/main.py --symbol MNQ --timeframe 1m \
    --hpo --n-trials 30
"""

import argparse
import json
import os
import sys
import time

# Add src/ml/ to sys.path so shared.* and cnn_transformer.* imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import torch
import torch.nn as nn

from cnn_transformer.auxiliary_labels import (
    generate_return_bucket_labels,
    generate_vol_regime_labels,
)
from cnn_transformer.barrier_labels import generate_triple_barrier_labels
from cnn_transformer.dataset import OHLCVWindowDataset
from cnn_transformer.evaluate import (
    compute_class_metrics,
    compute_profit_factor,
    compute_sharpe,
    simulate_barrier_trades,
)
from cnn_transformer.hpo import run_hpo
from cnn_transformer.io import save_checkpoint, save_diagnostics
from cnn_transformer.label_utils import apply_split_mask
from cnn_transformer.model import CnnTransformerModel
from cnn_transformer.train import LossHeadConfig, TrainConfig, train_model
from cnn_transformer.walk_forward import generate_folds

try:
    from shared.data import load_ohlcv_arrays
    from shared.protocol import emit_done, emit_error, emit_log, emit_metric, emit_progress
except ModuleNotFoundError:
    from ml.shared.data import load_ohlcv_arrays
    from ml.shared.protocol import emit_done, emit_error, emit_log, emit_metric, emit_progress


def parse_args():
    parser = argparse.ArgumentParser(description="CNN+Transformer Triple Barrier Predictor")
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--model-id", type=str, default=None,
                        help="Model ID from server (used for output dir)")

    # Architecture
    parser.add_argument("--window-size", type=int, default=128,
                        help="Input window size in bars")

    # Training
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=1e-4)

    # Barrier config
    parser.add_argument("--atr-period", type=int, default=14)
    parser.add_argument("--tp-multiplier", type=float, default=2.0)
    parser.add_argument("--sl-multiplier", type=float, default=2.0)
    parser.add_argument("--vertical-bars", type=int, default=60)

    # Split
    parser.add_argument("--test-split", type=float, default=0.20,
                        help="Fraction of data for out-of-sample validation")

    # HPO
    parser.add_argument("--hpo", action="store_true",
                        help="Run HPO instead of single training run")
    parser.add_argument("--n-trials", type=int, default=30,
                        help="Number of Optuna trials (HPO mode only)")
    parser.add_argument("--use-l2", action="store_true", help="Use MBP10 Level 2 depth data")

    return parser.parse_args()


def _load_cost_config(symbol: str) -> dict:
    """Load cost model JSON for the given symbol."""
    config_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "config", "cost_model.json"
    )
    with open(config_path) as f:
        all_configs = json.load(f)
    if symbol not in all_configs:
        raise ValueError(f"Symbol {symbol} not found in cost_model.json")
    return all_configs[symbol]


def _build_output_dir(args) -> str:
    model_id = args.model_id or f"{args.symbol}_{args.timeframe}_cnn_transformer"
    output_dir = os.path.join("data", "models", model_id)
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


def run_single(args, device: torch.device):
    """Single training run with fixed barrier config."""
    t_start = time.time()

    # ── 1. Load data ─────────────────────────────────────────────────────────
    emit_log(f"Loading OHLCV for {args.symbol} {args.timeframe}")
    data = load_ohlcv_arrays(args.symbol, args.timeframe)
    n_bars = len(data["close"])
    timestamps = data["timestamp"]
    emit_log(f"Loaded {n_bars:,} bars ({timestamps[0]} to {timestamps[-1]})")

    min_bars = args.window_size + args.vertical_bars + args.atr_period + 200
    if n_bars < min_bars:
        emit_error(f"Insufficient data: {n_bars} bars (need >= {min_bars})")
        sys.exit(1)

    # ── 2. Generate triple barrier labels ────────────────────────────────────
    emit_progress(0, args.epochs, "generating_labels")
    emit_log(f"Generating triple barrier labels (ATR={args.atr_period}, "
             f"TP={args.tp_multiplier}x, SL={args.sl_multiplier}x, "
             f"vert={args.vertical_bars})")

    barrier = generate_triple_barrier_labels(
        close=data["close"],
        high=data["high"],
        low=data["low"],
        open_=data["open"],
        atr_period=args.atr_period,
        tp_multiplier=args.tp_multiplier,
        sl_multiplier=args.sl_multiplier,
        vertical_bars=args.vertical_bars,
    )

    # ── 3. Generate auxiliary labels ─────────────────────────────────────────
    emit_log("Generating volatility regime labels...")
    vol_labels = generate_vol_regime_labels(data["close"], lookback=250)

    # ── 4. Train/val split ───────────────────────────────────────────────────
    split_idx = int(n_bars * (1 - args.test_split))
    emit_log(f"Split: train=[0, {split_idx:,}) val=[{split_idx:,}, {n_bars:,}) "
             f"({100*(1-args.test_split):.0f}/{100*args.test_split:.0f})")

    # ── 5. Return bucket labels (bin edges from train only) ──────────────────
    emit_log("Generating return bucket labels (quantile bins from train only)...")
    train_returns = barrier["returns_at_exit"][:split_idx]
    _, bin_edges = generate_return_bucket_labels(train_returns, n_bins=8)
    bucket_labels, _ = generate_return_bucket_labels(
        barrier["returns_at_exit"], n_bins=8, bin_edges=bin_edges
    )

    # ── 6. Mask lookahead at split boundary ──────────────────────────────────
    masked_barrier = apply_split_mask(
        barrier["labels"], barrier["exit_bars"], split_idx
    )
    masked_buckets = apply_split_mask(
        bucket_labels, barrier["exit_bars"], split_idx
    )

    # ── 7. Shift barrier labels +1 for CrossEntropyLoss (-1,0,1 -> 0,1,2) ───
    # NaN bars remain NaN (shift only applied to valid values via the dataset mask)
    shifted_barrier = np.where(
        ~np.isnan(masked_barrier),
        masked_barrier + 1.0,
        np.nan,
    )

    # ── 8. Build datasets ────────────────────────────────────────────────────
    labels_dict = {
        "barrier_class": shifted_barrier,
        "vol_regime": vol_labels,
        "return_bucket": masked_buckets,
    }

    train_ds = OHLCVWindowDataset(
        data, labels_dict, start=0, end=split_idx, window_size=args.window_size
    )
    val_ds = OHLCVWindowDataset(
        data, labels_dict, start=split_idx, end=n_bars, window_size=args.window_size
    )

    emit_log(f"Train dataset: {len(train_ds):,} samples")
    emit_log(f"Val dataset: {len(val_ds):,} samples")

    if len(train_ds) < 100 or len(val_ds) < 100:
        emit_error(f"Insufficient samples: train={len(train_ds)}, val={len(val_ds)}")
        sys.exit(1)

    # ── 9. Build model ───────────────────────────────────────────────────────
    model = CnnTransformerModel(window_size=args.window_size, d_input=X.shape[1])
    model = model.to(device)
    param_count = model.param_count()
    emit_log(f"Model: {param_count:,} parameters, window={args.window_size}")

    # ── 10. Build loss heads with class weights ──────────────────────────────
    # Class weights from training slice only (shifted labels 0/1/2)
    train_barrier_labels = shifted_barrier[:split_idx]
    valid_train = train_barrier_labels[~np.isnan(train_barrier_labels)]
    class_counts = np.bincount(
        valid_train.astype(int), minlength=3
    ).astype(np.float32)
    class_counts = np.maximum(class_counts, 1.0)
    class_weights = torch.tensor(class_counts.sum() / (3.0 * class_counts))

    loss_heads = [
        LossHeadConfig(
            "barrier_class",
            nn.CrossEntropyLoss(weight=class_weights.to(device)),
            weight=0.7,
            enabled=True,
        ),
        LossHeadConfig(
            "vol_regime",
            nn.CrossEntropyLoss(),
            weight=0.15,
            enabled=True,
        ),
        LossHeadConfig(
            "return_bucket",
            nn.CrossEntropyLoss(),
            weight=0.15,
            enabled=True,
        ),
    ]

    # ── 11. Output directory ─────────────────────────────────────────────────
    output_dir = _build_output_dir(args)

    # ── 12. Convergence callback ─────────────────────────────────────────────
    def on_epoch(epoch_history, best_metrics):
        import json as _json
        conv = {
            "epochs": [e["epoch"] for e in epoch_history],
            "train_loss": [e["train_loss"] for e in epoch_history],
            "val_loss": [e["val_loss"] for e in epoch_history],
            "learning_rate": [e["learning_rate"] for e in epoch_history],
        }
        for head in ["barrier_class", "vol_regime", "return_bucket"]:
            conv[f"val_{head}_accuracy"] = [
                e.get(f"val_{head}_accuracy", 0.0) for e in epoch_history
            ]
        with open(os.path.join(output_dir, "convergence.json"), "w") as _f:
            _json.dump(conv, _f, indent=2)

    # ── 13. Train ────────────────────────────────────────────────────────────
    num_workers = min(4, os.cpu_count() // 3) if os.cpu_count() else 0
    config = TrainConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        patience=5,
        num_workers=num_workers,
        loss_heads=loss_heads,
    )

    result = train_model(model, train_ds, val_ds, config, device=str(device), on_epoch=on_epoch)

    # ── 14. Save checkpoint ──────────────────────────────────────────────────
    emit_progress(args.epochs, args.epochs, "saving")

    barrier_config = {
        "atr_period": args.atr_period,
        "tp_multiplier": args.tp_multiplier,
        "sl_multiplier": args.sl_multiplier,
        "vertical_bars": args.vertical_bars,
    }
    hyperparameters = {
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "window_size": args.window_size,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "test_split": args.test_split,
        "weight_decay": 1e-4,
        "grad_clip": 1.0,
    }

    # Restore best model to get optimizer/scheduler for checkpoint
    # (train_model already restores best weights; re-build optimizer for saving)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=1e-4,
    )
    total_steps = args.epochs * max(len(train_ds) // args.batch_size, 1)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=args.learning_rate,
        total_steps=max(total_steps, 1),
        pct_start=0.1,
        anneal_strategy="cos",
    )

    save_checkpoint(
        model, optimizer, scheduler,
        result["best_epoch"], result["best_val_loss"], result["best_metrics"],
        hyperparameters, output_dir,
        barrier_config=barrier_config,
    )

    # ── 15. Compute performance metrics on val set ───────────────────────────
    cost_config = _load_cost_config(args.symbol)
    cost_rt = cost_config["total_round_trip"]
    point_value = cost_config["point_value"]

    # Run inference on val set for trade simulation
    model.eval()
    from torch.utils.data import DataLoader as _DL
    val_loader_inf = _DL(val_ds, batch_size=args.batch_size, shuffle=False)
    all_preds = []
    with torch.no_grad():
        for window, _, _ in val_loader_inf:
            out = model(window.to(device), active_heads={"barrier_class"})
            # Shift back: 0->-1, 1->0, 2->+1
            preds = out["barrier_class"].argmax(dim=1).cpu().numpy() - 1
            all_preds.append(preds)
    predictions = np.concatenate(all_preds)

    # Align predictions with raw barrier arrays (accounting for window offset)
    offset = args.window_size - 1
    actual_start = split_idx + offset
    actual_end = actual_start + len(predictions)
    val_actual = barrier["labels"][actual_start:actual_end]
    val_returns = barrier["returns_at_exit"][actual_start:actual_end]

    trades = simulate_barrier_trades(predictions, val_actual, val_returns, cost_rt, point_value)
    profit_factor = compute_profit_factor(trades)
    sharpe = compute_sharpe(trades)
    n_trades = len(trades)

    # Class metrics: predictions are already in -1/0/+1 space
    class_metrics = compute_class_metrics(predictions, val_actual)

    emit_metric("profit_factor", profit_factor, args.epochs, args.epochs)
    emit_metric("sharpe", sharpe, args.epochs, args.epochs)
    emit_metric("n_trades", n_trades, args.epochs, args.epochs)
    emit_log(f"Val performance: PF={profit_factor:.3f} Sharpe={sharpe:.3f} Trades={n_trades}")

    # ── 16. Save diagnostics ─────────────────────────────────────────────────
    elapsed = time.time() - t_start

    diagnostics = save_diagnostics(
        output_dir=output_dir,
        symbol=args.symbol,
        timeframe=args.timeframe,
        model=model,
        train_result=result,
        n_total=n_bars,
        n_train=split_idx,
        n_val=n_bars - split_idx,
        start_ts=str(timestamps[0]),
        end_ts=str(timestamps[-1]),
        barrier_config=barrier_config,
        profit_factor=profit_factor,
        sharpe=sharpe,
        n_trades=n_trades,
        class_metrics=class_metrics,
        elapsed=elapsed,
        walk_forward_results=None,
    )

    emit_log(f"Training complete in {elapsed:.1f}s. Best epoch: {result['best_epoch']}, "
             f"val_loss: {result['best_val_loss']:.4f}")
    emit_done(output_dir, diagnostics)


def run_hpo_mode(args, device: torch.device):
    """HPO mode: walk-forward profit factor optimization via Optuna."""
    t_start = time.time()

    # ── 1. Load data ─────────────────────────────────────────────────────────
    emit_log(f"Loading OHLCV for {args.symbol} {args.timeframe} (HPO mode)")
    data = load_ohlcv_arrays(args.symbol, args.timeframe)
    n_bars = len(data["close"])
    timestamps = data["timestamp"]
    emit_log(f"Loaded {n_bars:,} bars ({timestamps[0]} to {timestamps[-1]})")

    # ── 2. Generate walk-forward folds ───────────────────────────────────────
    emit_log("Generating walk-forward folds...")
    folds = generate_folds(
        n_bars=n_bars,
        timestamps=[str(t) for t in timestamps],
        fold_months=6,
        purge_bars=120,
    )
    emit_log(f"Generated {len(folds)} walk-forward folds")

    if len(folds) == 0:
        emit_error("No walk-forward folds generated — insufficient data history (need 24+ months)")
        sys.exit(1)

    # ── 3. Load cost config ──────────────────────────────────────────────────
    cost_config = _load_cost_config(args.symbol)

    ohlcv = {
        "open": data["open"],
        "high": data["high"],
        "low": data["low"],
        "close": data["close"],
        "volume": data["volume"],
    }

    # ── 4. Run HPO ───────────────────────────────────────────────────────────
    emit_log(f"Starting HPO: {args.n_trials} trials, {len(folds)} folds each")
    study = run_hpo(
        ohlcv=ohlcv,
        timestamps=[str(t) for t in timestamps],
        folds=folds,
        cost_config=cost_config,
        n_trials=args.n_trials,
        device=str(device),
        window_size=args.window_size,
    )

    best_trial = study.best_trial
    best_params = best_trial.params
    emit_log(f"HPO complete. Best trial #{best_trial.number}: "
             f"median_pf={best_trial.value:.4f}")
    emit_log(f"Best params: {best_params}")

    # ── 5. Build walk-forward results summary ────────────────────────────────
    walk_forward_results = {
        "n_trials": len(study.trials),
        "n_folds": len(folds),
        "best_trial_number": best_trial.number,
        "best_median_profit_factor": float(best_trial.value),
        "best_params": best_params,
        "folds": [
            {
                "fold_number": f["fold_number"],
                "train_end": f["train_end"],
                "test_start": f["test_start"],
                "test_end": f["test_end"],
            }
            for f in folds
        ],
    }

    # ── 6. Train final model with best params on full dataset ─────────────────
    emit_log("Training final model with best HPO params on full dataset...")
    barrier_config = {
        "atr_period": best_params.get("atr_period", 14),
        "tp_multiplier": float(best_params.get("tp_multiplier", 2.0)),
        "sl_multiplier": float(best_params.get("sl_multiplier", 2.0)),
        "vertical_bars": best_params.get("vertical_bars", 60),
    }

    barrier = generate_triple_barrier_labels(
        close=ohlcv["close"],
        high=ohlcv["high"],
        low=ohlcv["low"],
        open_=ohlcv["open"],
        **barrier_config,
    )
    vol_labels = generate_vol_regime_labels(ohlcv["close"], lookback=250)

    split_idx = int(n_bars * (1 - args.test_split))
    train_returns = barrier["returns_at_exit"][:split_idx]
    _, bin_edges = generate_return_bucket_labels(train_returns, n_bins=8)
    bucket_labels, _ = generate_return_bucket_labels(
        barrier["returns_at_exit"], n_bins=8, bin_edges=bin_edges
    )

    masked_barrier = apply_split_mask(barrier["labels"], barrier["exit_bars"], split_idx)
    masked_buckets = apply_split_mask(bucket_labels, barrier["exit_bars"], split_idx)
    shifted_barrier = np.where(~np.isnan(masked_barrier), masked_barrier + 1.0, np.nan)

    labels_dict = {
        "barrier_class": shifted_barrier,
        "vol_regime": vol_labels,
        "return_bucket": masked_buckets,
    }
    train_ds = OHLCVWindowDataset(
        ohlcv, labels_dict, start=0, end=split_idx, window_size=args.window_size
    )
    val_ds = OHLCVWindowDataset(
        ohlcv, labels_dict, start=split_idx, end=n_bars, window_size=args.window_size
    )

    model = CnnTransformerModel(window_size=args.window_size, d_input=X.shape[1])
    model = model.to(device)

    valid_train = shifted_barrier[:split_idx]
    valid_train = valid_train[~np.isnan(valid_train)]
    class_counts = np.bincount(valid_train.astype(int), minlength=3).astype(np.float32)
    class_counts = np.maximum(class_counts, 1.0)
    class_weights = torch.tensor(class_counts.sum() / (3.0 * class_counts))

    lr = float(best_params.get("learning_rate", args.learning_rate))
    alpha = float(best_params.get("loss_alpha", 0.7))
    beta = float(best_params.get("loss_beta", 0.15))
    gamma = max(1.0 - alpha - beta, 0.05)

    loss_heads = [
        LossHeadConfig(
            "barrier_class",
            nn.CrossEntropyLoss(weight=class_weights.to(device)),
            weight=alpha,
            enabled=True,
        ),
        LossHeadConfig(
            "vol_regime",
            nn.CrossEntropyLoss(),
            weight=beta,
            enabled=True,
        ),
        LossHeadConfig(
            "return_bucket",
            nn.CrossEntropyLoss(),
            weight=gamma,
            enabled=True,
        ),
    ]

    output_dir = _build_output_dir(args)

    def on_epoch_hpo(epoch_history, best_metrics):
        import json as _json
        conv = {
            "epochs": [e["epoch"] for e in epoch_history],
            "train_loss": [e["train_loss"] for e in epoch_history],
            "val_loss": [e["val_loss"] for e in epoch_history],
            "learning_rate": [e["learning_rate"] for e in epoch_history],
        }
        for head in ["barrier_class", "vol_regime", "return_bucket"]:
            conv[f"val_{head}_accuracy"] = [
                e.get(f"val_{head}_accuracy", 0.0) for e in epoch_history
            ]
        with open(os.path.join(output_dir, "convergence.json"), "w") as _f:
            _json.dump(conv, _f, indent=2)

    num_workers = min(4, os.cpu_count() // 3) if os.cpu_count() else 0
    config = TrainConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=lr,
        patience=5,
        num_workers=num_workers,
        loss_heads=loss_heads,
    )
    result = train_model(model, train_ds, val_ds, config, device=str(device), on_epoch=on_epoch_hpo)

    # Save checkpoint
    hyperparameters = {
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "window_size": args.window_size,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": lr,
        "test_split": args.test_split,
        "weight_decay": 1e-4,
        "grad_clip": 1.0,
        "hpo_best_params": best_params,
    }

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    total_steps = args.epochs * max(len(train_ds) // args.batch_size, 1)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=lr,
        total_steps=max(total_steps, 1),
        pct_start=0.1,
        anneal_strategy="cos",
    )
    save_checkpoint(
        model, optimizer, scheduler,
        result["best_epoch"], result["best_val_loss"], result["best_metrics"],
        hyperparameters, output_dir,
        barrier_config=barrier_config,
    )

    # Performance on val set
    cost_rt = cost_config["total_round_trip"]
    point_value = cost_config["point_value"]

    model.eval()
    from torch.utils.data import DataLoader as _DL
    val_loader_inf = _DL(val_ds, batch_size=args.batch_size, shuffle=False)
    all_preds = []
    with torch.no_grad():
        for window, _, _ in val_loader_inf:
            out = model(window.to(device), active_heads={"barrier_class"})
            preds = out["barrier_class"].argmax(dim=1).cpu().numpy() - 1
            all_preds.append(preds)
    predictions = np.concatenate(all_preds)

    offset = args.window_size - 1
    actual_start = split_idx + offset
    actual_end = actual_start + len(predictions)
    val_actual = barrier["labels"][actual_start:actual_end]
    val_returns = barrier["returns_at_exit"][actual_start:actual_end]

    trades = simulate_barrier_trades(predictions, val_actual, val_returns, cost_rt, point_value)
    profit_factor = compute_profit_factor(trades)
    sharpe = compute_sharpe(trades)
    n_trades = len(trades)
    class_metrics = compute_class_metrics(predictions, val_actual)

    emit_metric("profit_factor", profit_factor, args.epochs, args.epochs)
    emit_metric("sharpe", sharpe, args.epochs, args.epochs)
    emit_metric("n_trades", n_trades, args.epochs, args.epochs)
    emit_log(f"Final model val performance: PF={profit_factor:.3f} Sharpe={sharpe:.3f} Trades={n_trades}")

    elapsed = time.time() - t_start

    diagnostics = save_diagnostics(
        output_dir=output_dir,
        symbol=args.symbol,
        timeframe=args.timeframe,
        model=model,
        train_result=result,
        n_total=n_bars,
        n_train=split_idx,
        n_val=n_bars - split_idx,
        start_ts=str(timestamps[0]),
        end_ts=str(timestamps[-1]),
        barrier_config=barrier_config,
        profit_factor=profit_factor,
        sharpe=sharpe,
        n_trades=n_trades,
        class_metrics=class_metrics,
        elapsed=elapsed,
        walk_forward_results=walk_forward_results,
    )

    emit_done(output_dir, diagnostics)


def main():
    args = parse_args()

    try:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        emit_log(
            f"Device: {device}"
            + (f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else "")
        )

        if args.hpo:
            run_hpo_mode(args, device)
        else:
            run_single(args, device)

    except Exception as e:
        import traceback
        emit_error(str(e), traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
