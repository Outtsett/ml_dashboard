#!/usr/bin/env python3
"""
Primitives Discovery Model â€” training entry point.

Self-discovering model that learns trading signals from ~510 mathematical
primitives computed from raw OHLCV data. No hand-crafted indicators â€” the
model discovers which primitive combinations predict profitable trades.

Entry point spawned by Node.js pythonRunner.ts. Loads OHLCV from QuestDB,
computes primitives, generates labels, trains a Feature-Attention +
CNN + Transformer model with three output heads.

Usage:
  python src/ml/primitives_discovery/main.py --symbol MNQ --timeframe 1m \
    --epochs 100 --batch-size 64 --learning-rate 0.0003 \
    --window-size 64 --forward-n 5 --test-split 0.20 --json
"""

import argparse
import json
import os
import sys
import time

# Add src/ml/ to sys.path so shared.* and primitives_discovery.* imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.metrics import roc_auc_score

from shared.protocol import emit_progress, emit_metric, emit_log, emit_done, emit_error
from shared.data import load_ohlcv_arrays
from shared.primitives import compute_and_normalize_primitives

from primitives_discovery.dataset import PrimitivesDataset
from primitives_discovery.model import PrimitivesDiscoveryModel


def parse_args():
    parser = argparse.ArgumentParser(description="Primitives Discovery Model")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--model-id", type=str, default=None,
                        help="Model ID from server (used for output dir)")
    parser.add_argument("--max-bars", type=int, default=0,
                        help="Max bars to load (0 = all available data)")
    parser.add_argument("--date-start", type=str, default=None)
    parser.add_argument("--date-end", type=str, default=None)

    # Architecture
    parser.add_argument("--window-size", type=int, default=64,
                        help="Input window size in bars")
    parser.add_argument("--d-model", type=int, default=256,
                        help="Transformer model dimension")
    parser.add_argument("--n-heads", type=int, default=8,
                        help="Number of attention heads")
    parser.add_argument("--n-layers", type=int, default=4,
                        help="Number of transformer layers")

    # Training
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--patience", type=int, default=15,
                        help="Early stopping patience (epochs)")

    # Labels
    parser.add_argument("--forward-n", type=int, default=5,
                        help="Forward return horizon in bars")
    parser.add_argument("--test-split", type=float, default=0.20,
                        help="Fraction of data for out-of-sample validation")

    # Primitives
    parser.add_argument("--primitive-lookback", type=int, default=20,
                        help="Rolling z-score lookback for primitive normalization")

    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


# â”€â”€ Label generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def generate_direction_labels(high, low, close):
    """Generate microstructure direction labels (same algorithm as cnn_transformer).

    Returns (labels, horizon) where horizon[i] = furthest bar used.
    """
    n = len(high)
    labels = np.full(n, np.nan, dtype=np.float64)
    horizon = np.full(n, -1, dtype=np.int64)

    if n < 3:
        return labels, horizon

    confirmed = []
    last_high = high[0]
    last_high_idx = 0
    last_low = low[0]
    last_low_idx = 0
    direction = 0

    for i in range(1, n):
        new_pivot = None

        if direction == 0:
            if high[i] > last_high:
                direction = 1
                new_pivot = (last_low_idx, float(last_low), -1, i)
                last_high = high[i]
                last_high_idx = i
            elif low[i] < last_low:
                direction = -1
                new_pivot = (last_high_idx, float(last_high), +1, i)
                last_low = low[i]
                last_low_idx = i
            else:
                if high[i] > last_high:
                    last_high = high[i]
                    last_high_idx = i
                if low[i] < last_low:
                    last_low = low[i]
                    last_low_idx = i

        elif direction == 1:
            if high[i] >= last_high:
                last_high = high[i]
                last_high_idx = i
            elif low[i] < low[i - 1]:
                new_pivot = (last_high_idx, float(last_high), +1, i)
                direction = -1
                last_low = low[i]
                last_low_idx = i

        else:  # direction == -1
            if low[i] <= last_low:
                last_low = low[i]
                last_low_idx = i
            elif high[i] > high[i - 1]:
                new_pivot = (last_low_idx, float(last_low), -1, i)
                direction = 1
                last_high = high[i]
                last_high_idx = i

        if new_pivot is not None:
            confirmed.append(new_pivot)

    if not confirmed:
        return labels, horizon

    conf_bars = np.array([p[3] for p in confirmed], dtype=np.int64)
    conf_types = np.array([p[2] for p in confirmed], dtype=np.int64)

    for i in range(n):
        idx = np.searchsorted(conf_bars, i, side="right")
        if idx < len(confirmed):
            pivot_type = conf_types[idx]
            labels[i] = 1.0 if pivot_type == 1 else 0.0
            horizon[i] = conf_bars[idx]

    return labels, horizon


def generate_forward_labels(close, n=5):
    """Generate forward return labels: direction + magnitude.

    Returns (dir_labels, mag_labels, horizon).
    """
    total = len(close)
    dir_labels = np.full(total, np.nan, dtype=np.float64)
    mag_labels = np.full(total, np.nan, dtype=np.float64)
    horizon = np.full(total, -1, dtype=np.int64)

    if total <= n:
        return dir_labels, mag_labels, horizon

    fwd_return = close[n:] - close[:-n]
    fwd_return_pct = fwd_return / (close[:-n] + 1e-10)

    dir_labels[:total - n] = (fwd_return > 0).astype(np.float64)
    mag_labels[:total - n] = fwd_return_pct
    horizon[:total - n] = np.arange(n, total, dtype=np.int64)

    return dir_labels, mag_labels, horizon


def apply_split_mask(labels, horizon, split_idx):
    """Mask labels whose horizon extends into validation set."""
    train_mask = np.arange(len(labels)) < split_idx
    leaks = horizon >= split_idx
    labels[train_mask & leaks] = np.nan
    return labels


# â”€â”€ Training loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def train_one_epoch(
    model, loader, criterion_dir, criterion_fwd, criterion_mag,
    optimizer, scheduler, scaler, grad_clip, device,
):
    """Run one training epoch. Returns dict of metrics."""
    model.train()

    total_loss = 0.0
    total_dir_loss = 0.0
    total_fwd_loss = 0.0
    total_mag_loss = 0.0
    n_batches = 0

    all_dir_logits, all_dir_labels, all_dir_valid = [], [], []
    all_fwd_logits, all_fwd_labels, all_fwd_valid = [], [], []

    for batch in loader:
        window, dir_label, fwd_label, mag_label, dir_valid, fwd_valid, mag_valid = batch
        window = window.to(device, non_blocking=True)
        dir_label = dir_label.to(device, non_blocking=True)
        fwd_label = fwd_label.to(device, non_blocking=True)
        mag_label = mag_label.to(device, non_blocking=True)
        dir_valid = dir_valid.to(device, non_blocking=True)
        fwd_valid = fwd_valid.to(device, non_blocking=True)
        mag_valid = mag_valid.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)

        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            dir_logits, conf_logits, mag_output = model(window)
            dir_logits = dir_logits.squeeze(-1)   # (B,)
            conf_logits = conf_logits.squeeze(-1)  # (B,)
            mag_output = mag_output.squeeze(-1)    # (B,)

            loss = torch.tensor(0.0, device=device)
            dir_loss_val = 0.0
            fwd_loss_val = 0.0
            mag_loss_val = 0.0

            # Direction loss (microstructure labels) â€” weight 0.4
            if dir_valid.any():
                dl = criterion_dir(dir_logits[dir_valid], dir_label[dir_valid])
                loss = loss + 0.4 * dl
                dir_loss_val = dl.item()

            # Forward direction loss (confidence head) â€” weight 0.4
            if fwd_valid.any():
                fl = criterion_fwd(conf_logits[fwd_valid], fwd_label[fwd_valid])
                loss = loss + 0.4 * fl
                fwd_loss_val = fl.item()

            # Magnitude loss (MSE on forward return %) â€” weight 0.2
            if mag_valid.any():
                ml = criterion_mag(mag_output[mag_valid], mag_label[mag_valid])
                loss = loss + 0.2 * ml
                mag_loss_val = ml.item()

        if loss.requires_grad:
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
            scaler.step(optimizer)
            scaler.update()
            if scheduler is not None:
                scheduler.step()

        total_loss += loss.item()
        total_dir_loss += dir_loss_val
        total_fwd_loss += fwd_loss_val
        total_mag_loss += mag_loss_val
        n_batches += 1

        all_dir_logits.append(dir_logits.detach().cpu().numpy())
        all_dir_labels.append(dir_label.detach().cpu().numpy())
        all_dir_valid.append(dir_valid.detach().cpu().numpy())
        all_fwd_logits.append(conf_logits.detach().cpu().numpy())
        all_fwd_labels.append(fwd_label.detach().cpu().numpy())
        all_fwd_valid.append(fwd_valid.detach().cpu().numpy())

    return _aggregate_metrics(
        all_dir_logits, all_dir_labels, all_dir_valid,
        all_fwd_logits, all_fwd_labels, all_fwd_valid,
        total_loss, total_dir_loss, total_fwd_loss, total_mag_loss, n_batches,
    )


@torch.no_grad()
def validate(
    model, loader, criterion_dir, criterion_fwd, criterion_mag, device,
):
    """Run validation. Returns dict of metrics."""
    model.eval()

    total_loss = 0.0
    total_dir_loss = 0.0
    total_fwd_loss = 0.0
    total_mag_loss = 0.0
    n_batches = 0

    all_dir_logits, all_dir_labels, all_dir_valid = [], [], []
    all_fwd_logits, all_fwd_labels, all_fwd_valid = [], [], []

    for batch in loader:
        window, dir_label, fwd_label, mag_label, dir_valid, fwd_valid, mag_valid = batch
        window = window.to(device, non_blocking=True)
        dir_label = dir_label.to(device, non_blocking=True)
        fwd_label = fwd_label.to(device, non_blocking=True)
        mag_label = mag_label.to(device, non_blocking=True)
        dir_valid = dir_valid.to(device, non_blocking=True)
        fwd_valid = fwd_valid.to(device, non_blocking=True)
        mag_valid = mag_valid.to(device, non_blocking=True)

        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            dir_logits, conf_logits, mag_output = model(window)
            dir_logits = dir_logits.squeeze(-1)
            conf_logits = conf_logits.squeeze(-1)
            mag_output = mag_output.squeeze(-1)

            loss = torch.tensor(0.0, device=device)
            dir_loss_val = 0.0
            fwd_loss_val = 0.0
            mag_loss_val = 0.0

            if dir_valid.any():
                dl = criterion_dir(dir_logits[dir_valid], dir_label[dir_valid])
                loss = loss + 0.4 * dl
                dir_loss_val = dl.item()

            if fwd_valid.any():
                fl = criterion_fwd(conf_logits[fwd_valid], fwd_label[fwd_valid])
                loss = loss + 0.4 * fl
                fwd_loss_val = fl.item()

            if mag_valid.any():
                ml = criterion_mag(mag_output[mag_valid], mag_label[mag_valid])
                loss = loss + 0.2 * ml
                mag_loss_val = ml.item()

        total_loss += loss.item()
        total_dir_loss += dir_loss_val
        total_fwd_loss += fwd_loss_val
        total_mag_loss += mag_loss_val
        n_batches += 1

        all_dir_logits.append(dir_logits.detach().cpu().numpy())
        all_dir_labels.append(dir_label.detach().cpu().numpy())
        all_dir_valid.append(dir_valid.detach().cpu().numpy())
        all_fwd_logits.append(conf_logits.detach().cpu().numpy())
        all_fwd_labels.append(fwd_label.detach().cpu().numpy())
        all_fwd_valid.append(fwd_valid.detach().cpu().numpy())

    return _aggregate_metrics(
        all_dir_logits, all_dir_labels, all_dir_valid,
        all_fwd_logits, all_fwd_labels, all_fwd_valid,
        total_loss, total_dir_loss, total_fwd_loss, total_mag_loss, n_batches,
    )


def _aggregate_metrics(
    all_dir_logits, all_dir_labels, all_dir_valid,
    all_fwd_logits, all_fwd_labels, all_fwd_valid,
    total_loss, total_dir_loss, total_fwd_loss, total_mag_loss, n_batches,
):
    """Compute accuracy and AUC from collected predictions."""
    metrics = {
        "loss": total_loss / max(n_batches, 1),
        "dir_loss": total_dir_loss / max(n_batches, 1),
        "fwd_loss": total_fwd_loss / max(n_batches, 1),
        "mag_loss": total_mag_loss / max(n_batches, 1),
        "dir_accuracy": 0.0,
        "dir_auc": 0.5,
        "fwd_accuracy": 0.0,
        "fwd_auc": 0.5,
    }

    # Direction metrics
    dl = np.concatenate(all_dir_logits) if all_dir_logits else np.array([])
    dlab = np.concatenate(all_dir_labels) if all_dir_labels else np.array([])
    dval = np.concatenate(all_dir_valid) if all_dir_valid else np.array([], dtype=bool)

    if dval.sum() > 0:
        probs = 1.0 / (1.0 + np.exp(-dl[dval]))
        preds = (probs > 0.5).astype(float)
        true = dlab[dval]
        metrics["dir_accuracy"] = float(np.mean(preds == true))
        if len(np.unique(true)) == 2:
            metrics["dir_auc"] = float(roc_auc_score(true, probs))

    # Forward direction metrics
    fl = np.concatenate(all_fwd_logits) if all_fwd_logits else np.array([])
    flab = np.concatenate(all_fwd_labels) if all_fwd_labels else np.array([])
    fval = np.concatenate(all_fwd_valid) if all_fwd_valid else np.array([], dtype=bool)

    if fval.sum() > 0:
        probs = 1.0 / (1.0 + np.exp(-fl[fval]))
        preds = (probs > 0.5).astype(float)
        true = flab[fval]
        metrics["fwd_accuracy"] = float(np.mean(preds == true))
        if len(np.unique(true)) == 2:
            metrics["fwd_auc"] = float(roc_auc_score(true, probs))

    return metrics


# â”€â”€ Checkpoint and diagnostics saving â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def save_checkpoint(model, optimizer, scheduler, epoch, val_loss, metrics,
                    hyperparameters, output_dir):
    """Save best model checkpoint."""
    from datetime import datetime
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, "checkpoint_best.pt")

    raw = getattr(model, "_orig_mod", model)
    torch.save({
        "model_state_dict": raw.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "scheduler_state_dict": scheduler.state_dict(),
        "epoch": epoch,
        "val_loss": val_loss,
        "metrics": metrics,
        "hyperparameters": hyperparameters,
        "model_config": {
            "d_primitives": raw.d_primitives,
            "window_size": raw.window_size,
            "d_model": raw.d_model,
            "n_heads": raw.n_heads,
            "n_layers": raw.n_layers,
            "param_count": raw.param_count(),
        },
        "saved_at": datetime.utcnow().isoformat(),
    }, path)
    return path


def save_diagnostics(output_dir, symbol, timeframe, model, epoch_history,
                     best_epoch, best_val_loss, best_metrics, total_time_sec,
                     n_train, n_val, train_date_range, val_date_range,
                     hyperparameters, primitive_names):
    """Save diagnostics.json and convergence.json."""
    os.makedirs(output_dir, exist_ok=True)

    raw = getattr(model, "_orig_mod", model)

    diagnostics = {
        "symbol": symbol,
        "timeframe": timeframe,
        "model_type": "primitives-discovery",
        "architecture": {
            "type": "Feature-Attention + CNN + Transformer",
            "param_count": raw.param_count(),
            "d_primitives": raw.d_primitives,
            "window_size": raw.window_size,
            "d_model": raw.d_model,
            "n_heads": raw.n_heads,
            "n_layers": raw.n_layers,
        },
        "training": {
            "best_epoch": best_epoch,
            "total_epochs_run": len(epoch_history),
            "best_val_loss": best_val_loss,
            "total_time_sec": round(total_time_sec, 1),
        },
        "best_metrics": best_metrics,
        "data": {
            "n_train": n_train,
            "n_val": n_val,
            "n_primitives": raw.d_primitives,
            "train_date_range": list(train_date_range),
            "val_date_range": list(val_date_range),
        },
        "hyperparameters": hyperparameters,
        "primitive_names": primitive_names,
    }

    with open(os.path.join(output_dir, "diagnostics.json"), "w") as f:
        json.dump(diagnostics, f, indent=2, default=str)

    # Convergence arrays for dashboard charts
    convergence = {
        "epochs": [e["epoch"] for e in epoch_history],
        "train_loss": [e["train_loss"] for e in epoch_history],
        "val_loss": [e["val_loss"] for e in epoch_history],
        "dir_accuracy": [e["dir_accuracy"] for e in epoch_history],
        "dir_auc": [e["dir_auc"] for e in epoch_history],
        "fwd_accuracy": [e["fwd_accuracy"] for e in epoch_history],
        "fwd_auc": [e["fwd_auc"] for e in epoch_history],
        "learning_rate": [e["learning_rate"] for e in epoch_history],
    }

    with open(os.path.join(output_dir, "convergence.json"), "w") as f:
        json.dump(convergence, f, indent=2)

    return diagnostics


# â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def main():
    args = parse_args()
    t_start = time.time()

    try:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        emit_log(f"Device: {device}" + (
            f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else ""
        ))

        # â”€â”€ 1. Load data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        date_range = None
        if args.date_start or args.date_end:
            date_range = {"start": args.date_start, "end": args.date_end}

        bars_label = "all" if args.max_bars == 0 else f"max {args.max_bars}"
        emit_log(f"Loading OHLCV for {args.symbol} {args.timeframe} ({bars_label} bars)")

        data = load_ohlcv_arrays(args.symbol, args.timeframe, args.max_bars, date_range)
        n_bars = len(data["close"])
        emit_log(f"Loaded {n_bars:,} bars ({data['timestamp'][0]} to {data['timestamp'][-1]})")

        min_required = args.window_size + args.forward_n + 500
        if n_bars < min_required:
            emit_error(f"Insufficient data: {n_bars} bars (need >= {min_required})")
            sys.exit(1)

        # â”€â”€ 2. Compute primitives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        emit_progress(0, args.epochs, "computing_primitives")
        emit_log(f"Computing primitives (lookback={args.primitive_lookback})...")

        t_prim = time.time()
        primitives, primitive_names = compute_and_normalize_primitives(
            data["open"], data["high"], data["low"], data["close"], data["volume"],
            lookback=args.primitive_lookback,
        )
        n_primitives = len(primitive_names)
        prim_time = time.time() - t_prim
        emit_log(f"Computed {n_primitives} primitives in {prim_time:.1f}s")

        # â”€â”€ 3. Generate labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        emit_progress(0, args.epochs, "generating_labels")

        split_idx = int(n_bars * (1 - args.test_split))

        emit_log("Generating microstructure direction labels...")
        dir_labels, dir_horizon = generate_direction_labels(
            data["high"], data["low"], data["close"],
        )

        emit_log(f"Generating forward return labels (N={args.forward_n})...")
        fwd_labels, mag_labels, fwd_horizon = generate_forward_labels(
            data["close"], args.forward_n,
        )

        # â”€â”€ 4. Mask lookahead bias at split boundary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        dir_labels = apply_split_mask(dir_labels, dir_horizon, split_idx)
        fwd_labels = apply_split_mask(fwd_labels, fwd_horizon, split_idx)
        mag_labels = apply_split_mask(mag_labels, fwd_horizon, split_idx)

        dir_train_valid = ~np.isnan(dir_labels[:split_idx])
        fwd_train_valid = ~np.isnan(fwd_labels[:split_idx])
        dir_val_valid = ~np.isnan(dir_labels[split_idx:])
        fwd_val_valid = ~np.isnan(fwd_labels[split_idx:])

        emit_log(f"Direction labels: train={dir_train_valid.sum():,} valid, "
                 f"val={dir_val_valid.sum():,} valid")
        emit_log(f"Forward labels: train={fwd_train_valid.sum():,} valid, "
                 f"val={fwd_val_valid.sum():,} valid")

        # â”€â”€ 5. Create datasets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        emit_log(f"Split: train=[0, {split_idx:,}) val=[{split_idx:,}, {n_bars:,}) "
                 f"({100*(1-args.test_split):.0f}/{100*args.test_split:.0f})")

        train_ds = PrimitivesDataset(
            primitives, dir_labels, fwd_labels, mag_labels,
            start=0, end=split_idx, window_size=args.window_size,
        )
        val_ds = PrimitivesDataset(
            primitives, dir_labels, fwd_labels, mag_labels,
            start=split_idx, end=n_bars, window_size=args.window_size,
        )

        emit_log(f"Train dataset: {len(train_ds):,} samples")
        emit_log(f"Val dataset: {len(val_ds):,} samples")

        if len(train_ds) < 100 or len(val_ds) < 100:
            emit_error(f"Insufficient samples: train={len(train_ds)}, val={len(val_ds)}")
            sys.exit(1)

        # â”€â”€ 6. DataLoaders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        num_workers = min(4, os.cpu_count() // 3) if os.cpu_count() else 0
        pin_memory = device.type == "cuda"

        train_loader = DataLoader(
            train_ds, batch_size=args.batch_size, shuffle=True,
            num_workers=num_workers, pin_memory=pin_memory,
            persistent_workers=num_workers > 0, drop_last=True,
        )
        val_loader = DataLoader(
            val_ds, batch_size=args.batch_size, shuffle=False,
            num_workers=num_workers, pin_memory=pin_memory,
            persistent_workers=num_workers > 0,
        )

        # â”€â”€ 7. Build model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        model = PrimitivesDiscoveryModel(
            d_primitives=n_primitives,
            window_size=args.window_size,
            d_model=args.d_model,
            n_heads=args.n_heads,
            n_layers=args.n_layers,
            d_ff=args.d_model * 2,
            dropout=0.1,
        )
        model = model.to(device)

        param_count = model.param_count()
        emit_log(f"Model: {param_count:,} parameters, "
                 f"d_primitives={n_primitives}, window={args.window_size}, "
                 f"d_model={args.d_model}")

        # â”€â”€ 8. Output directory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        model_id = args.model_id or f"{args.symbol}_{args.timeframe}_primitives_discovery"
        output_dir = os.path.join("data", "models", model_id)
        os.makedirs(output_dir, exist_ok=True)

        # â”€â”€ 9. Hyperparameters dict â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        hyperparameters = {
            "symbol": args.symbol,
            "timeframe": args.timeframe,
            "window_size": args.window_size,
            "d_model": args.d_model,
            "n_heads": args.n_heads,
            "n_layers": args.n_layers,
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "learning_rate": args.learning_rate,
            "patience": args.patience,
            "forward_n": args.forward_n,
            "test_split": args.test_split,
            "primitive_lookback": args.primitive_lookback,
            "max_bars": args.max_bars,
            "weight_decay": 1e-4,
            "grad_clip": 1.0,
            "n_primitives": n_primitives,
        }

        # â”€â”€ 10. Optimizer, scheduler, scaler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=args.learning_rate,
            weight_decay=1e-4,
        )

        total_steps = args.epochs * len(train_loader)
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer,
            max_lr=args.learning_rate,
            total_steps=total_steps,
            pct_start=0.1,
            anneal_strategy="cos",
        )

        scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")

        criterion_dir = nn.BCEWithLogitsLoss()
        criterion_fwd = nn.BCEWithLogitsLoss()
        criterion_mag = nn.MSELoss()

        # â”€â”€ 11. Training loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        best_val_loss = float("inf")
        best_epoch = 0
        best_metrics = {}
        patience_counter = 0
        epoch_history = []

        for epoch in range(1, args.epochs + 1):
            t_epoch = time.time()
            emit_progress(epoch, args.epochs, "training")

            # Train
            train_m = train_one_epoch(
                model, train_loader, criterion_dir, criterion_fwd, criterion_mag,
                optimizer, scheduler, scaler, 1.0, device,
            )

            # Validate
            val_m = validate(
                model, val_loader, criterion_dir, criterion_fwd, criterion_mag,
                device,
            )

            epoch_time = time.time() - t_epoch
            current_lr = optimizer.param_groups[0]["lr"]

            # Emit metrics
            emit_metric("train_loss", train_m["loss"], epoch, args.epochs)
            emit_metric("val_loss", val_m["loss"], epoch, args.epochs)
            emit_metric("dir_accuracy", val_m["dir_accuracy"], epoch, args.epochs)
            emit_metric("dir_auc", val_m["dir_auc"], epoch, args.epochs)
            emit_metric("fwd_accuracy", val_m["fwd_accuracy"], epoch, args.epochs)
            emit_metric("fwd_auc", val_m["fwd_auc"], epoch, args.epochs)
            emit_metric("dir_loss", val_m["dir_loss"], epoch, args.epochs)
            emit_metric("fwd_loss", val_m["fwd_loss"], epoch, args.epochs)
            emit_metric("mag_loss", val_m["mag_loss"], epoch, args.epochs)
            emit_metric("learning_rate", current_lr, epoch, args.epochs)
            emit_metric("epoch_time_sec", epoch_time, epoch, args.epochs)

            emit_log(
                f"Epoch {epoch}/{args.epochs}: "
                f"train_loss={train_m['loss']:.4f} val_loss={val_m['loss']:.4f} "
                f"dir_acc={val_m['dir_accuracy']:.4f} fwd_acc={val_m['fwd_accuracy']:.4f} "
                f"dir_auc={val_m['dir_auc']:.4f} fwd_auc={val_m['fwd_auc']:.4f} "
                f"lr={current_lr:.2e} [{epoch_time:.1f}s]"
            )

            # Track history
            epoch_record = {
                "epoch": epoch,
                "train_loss": train_m["loss"],
                "val_loss": val_m["loss"],
                "dir_accuracy": val_m["dir_accuracy"],
                "dir_auc": val_m["dir_auc"],
                "fwd_accuracy": val_m["fwd_accuracy"],
                "fwd_auc": val_m["fwd_auc"],
                "dir_loss": val_m["dir_loss"],
                "fwd_loss": val_m["fwd_loss"],
                "mag_loss": val_m["mag_loss"],
                "learning_rate": current_lr,
                "epoch_time_sec": epoch_time,
            }
            epoch_history.append(epoch_record)

            # Live convergence for monitoring
            convergence = {
                "epochs": [e["epoch"] for e in epoch_history],
                "train_loss": [e["train_loss"] for e in epoch_history],
                "val_loss": [e["val_loss"] for e in epoch_history],
                "dir_accuracy": [e["dir_accuracy"] for e in epoch_history],
                "dir_auc": [e["dir_auc"] for e in epoch_history],
                "fwd_accuracy": [e["fwd_accuracy"] for e in epoch_history],
                "fwd_auc": [e["fwd_auc"] for e in epoch_history],
                "learning_rate": [e["learning_rate"] for e in epoch_history],
            }
            with open(os.path.join(output_dir, "convergence.json"), "w") as f:
                json.dump(convergence, f, indent=2)

            # Early stopping + checkpoint
            if val_m["loss"] < best_val_loss:
                best_val_loss = val_m["loss"]
                patience_counter = 0
                best_epoch = epoch
                best_metrics = epoch_record.copy()

                save_checkpoint(
                    model, optimizer, scheduler, epoch, val_m["loss"],
                    epoch_record, hyperparameters, output_dir,
                )
                emit_log(f"  -> New best val_loss={best_val_loss:.4f}, checkpoint saved")
            else:
                patience_counter += 1
                if patience_counter >= args.patience:
                    emit_log(f"Early stopping at epoch {epoch} (patience={args.patience})")
                    break

        total_time = time.time() - t_start

        # â”€â”€ 12. Save diagnostics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        emit_progress(args.epochs, args.epochs, "saving")

        train_ts = data["timestamp"]
        train_date_range = (str(train_ts[0]), str(train_ts[split_idx - 1]))
        val_date_range = (str(train_ts[split_idx]), str(train_ts[-1]))

        diagnostics = save_diagnostics(
            output_dir, args.symbol, args.timeframe, model,
            epoch_history, best_epoch, best_val_loss, best_metrics,
            total_time, len(train_ds), len(val_ds),
            train_date_range, val_date_range,
            hyperparameters, primitive_names,
        )

        # â”€â”€ 13. Extract and save feature importance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        emit_log("Extracting feature importance from trained model...")
        model.eval()
        # Use a sample batch from validation to get feature importance
        sample_batch = next(iter(val_loader))
        sample_window = sample_batch[0][:min(32, len(sample_batch[0]))].to(device)
        importance = model.get_feature_importance(sample_window)
        # Average across batch and time to get global feature ranking
        global_importance = importance.mean(dim=(0, 1)).cpu().numpy()  # (D,)

        # Sort by importance and save top-50
        ranked_indices = np.argsort(-global_importance)
        top_features = [
            {"rank": i + 1, "name": primitive_names[idx],
             "importance": float(global_importance[idx])}
            for i, idx in enumerate(ranked_indices[:50])
        ]
        with open(os.path.join(output_dir, "feature_importance.json"), "w") as f:
            json.dump(top_features, f, indent=2)

        emit_log(f"Top 5 primitives: {', '.join(f['name'] for f in top_features[:5])}")

        elapsed = time.time() - t_start
        emit_log(f"Training complete in {elapsed:.1f}s. Best epoch: {best_epoch}, "
                 f"val_loss: {best_val_loss:.4f}")
        emit_log(f"Best dir_acc: {best_metrics.get('dir_accuracy', 0):.4f}, "
                 f"Best fwd_acc: {best_metrics.get('fwd_accuracy', 0):.4f}")

        emit_done(output_dir, diagnostics)

    except Exception as e:
        import traceback
        emit_error(str(e), traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()

