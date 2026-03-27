"""
Checkpoint and diagnostics saving for CNN+Transformer model.

Saves:
  checkpoint_best.pt   — model weights + optimizer + scheduler + config + barrier_config
  diagnostics.json     — training summary matching barrier diagnostics schema
  convergence.json     — per-epoch metric arrays for convergence charts
"""

import json
import os
from datetime import datetime

import torch


def _unwrap(model):
    """Unwrap torch.compile wrapper to get the original module."""
    return getattr(model, "_orig_mod", model)


def save_checkpoint(
    model,
    optimizer,
    scheduler,
    epoch: int,
    val_loss: float,
    metrics: dict,
    hyperparameters: dict,
    output_dir: str,
    barrier_config: dict | None = None,
):
    """Save best model checkpoint.

    Parameters
    ----------
    model : CnnTransformerModel
    optimizer : AdamW
    scheduler : OneCycleLR
    epoch : int
        Best epoch number.
    val_loss : float
        Validation loss at best epoch.
    metrics : dict
        All metrics at best epoch.
    hyperparameters : dict
        Full hyperparameter config for reproducibility.
    output_dir : str
        Directory to save into (created if needed).
    barrier_config : dict | None
        Triple barrier parameters: atr_period, tp_multiplier, sl_multiplier, vertical_bars.
    """
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, "checkpoint_best.pt")

    raw = _unwrap(model)
    torch.save({
        "model_state_dict": raw.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "scheduler_state_dict": scheduler.state_dict(),
        "epoch": epoch,
        "val_loss": val_loss,
        "metrics": metrics,
        "hyperparameters": hyperparameters,
        "barrier_config": barrier_config or {},
        "model_config": {
            "window_size": raw.window_size,
            "d_model": raw.d_model,
            "param_count": raw.param_count(),
        },
        "saved_at": datetime.utcnow().isoformat(),
    }, path)

    return path


def save_diagnostics(
    output_dir: str,
    symbol: str,
    timeframe: str,
    model,
    train_result: dict,
    n_total: int,
    n_train: int,
    n_val: int,
    start_ts: str,
    end_ts: str,
    barrier_config: dict,
    profit_factor: float,
    sharpe: float,
    n_trades: int,
    class_metrics: dict,
    elapsed: float,
    walk_forward_results: dict | None = None,
) -> dict:
    """Save diagnostics.json and convergence.json.

    Parameters
    ----------
    output_dir : str
    symbol : str
    timeframe : str
    model : CnnTransformerModel
    train_result : dict
        Return value of train_model(): best_epoch, best_val_loss, best_metrics,
        epoch_history, total_time_sec.
    n_total : int
        Total number of bars in dataset.
    n_train : int
        Number of train bars (split_idx).
    n_val : int
        Number of val bars.
    start_ts : str
        ISO timestamp of first bar.
    end_ts : str
        ISO timestamp of last bar.
    barrier_config : dict
        atr_period, tp_multiplier, sl_multiplier, vertical_bars.
    profit_factor : float
    sharpe : float
    n_trades : int
    class_metrics : dict
        {tp: {precision, recall}, sl: {...}, timeout: {...}}
    elapsed : float
        Total wall-clock seconds from process start.
    walk_forward_results : dict | None
        HPO walk-forward summary if run in HPO mode, else None.

    Returns
    -------
    dict
        The diagnostics dict (also used for emit_done).
    """
    os.makedirs(output_dir, exist_ok=True)

    raw = _unwrap(model)
    param_count = raw.param_count()

    # ── Diagnostics ──────────────────────────────────────────────────────────
    diagnostics = {
        "model_type": "cnn-transformer",
        "symbol": symbol,
        "timeframe": timeframe,
        "architecture": {
            "type": "CNN+Transformer",
            "param_count": param_count,
            "window_size": raw.window_size,
            "d_model": raw.d_model,
            "n_heads": 8,
            "n_layers": 8,
            "n_codebook": 32,
        },
        "barrier_config": {
            "atr_period": barrier_config.get("atr_period", 14),
            "tp_multiplier": barrier_config.get("tp_multiplier", 2.0),
            "sl_multiplier": barrier_config.get("sl_multiplier", 2.0),
            "vertical_bars": barrier_config.get("vertical_bars", 60),
        },
        "cost_model": {
            "symbol": "MNQ",
            "round_trip": 2.80,
            "point_value": 2.00,
        },
        "performance": {
            "profit_factor": profit_factor,
            "sharpe": sharpe,
            "n_trades": n_trades,
        },
        "class_metrics": class_metrics,
        "best_metrics": train_result["best_metrics"],
        "data": {
            "n_bars_total": n_total,
            "n_bars_train": n_train,
            "n_bars_val": n_val,
            "date_range": {
                "start": start_ts,
                "end": end_ts,
            },
        },
        "walk_forward": walk_forward_results,
        "training_time_sec": round(elapsed, 1),
        "trained_at": datetime.now().isoformat(),
    }

    with open(os.path.join(output_dir, "diagnostics.json"), "w") as f:
        json.dump(diagnostics, f, indent=2, default=str)

    # ── Convergence (per-epoch arrays for dashboard charts) ──────────────────
    epoch_history = train_result["epoch_history"]
    convergence: dict = {
        "epochs": [e["epoch"] for e in epoch_history],
        "train_loss": [e["train_loss"] for e in epoch_history],
        "val_loss": [e["val_loss"] for e in epoch_history],
        "learning_rate": [e["learning_rate"] for e in epoch_history],
    }
    # Include per-head accuracy arrays if present in epoch records
    for head in ["barrier_class", "vol_regime", "return_bucket"]:
        key = f"val_{head}_accuracy"
        if epoch_history and key in epoch_history[0]:
            convergence[key] = [e.get(key, 0.0) for e in epoch_history]

    with open(os.path.join(output_dir, "convergence.json"), "w") as f:
        json.dump(convergence, f, indent=2)

    return diagnostics
