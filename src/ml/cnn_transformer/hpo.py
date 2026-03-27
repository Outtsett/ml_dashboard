"""In-process Optuna HPO with walk-forward profit factor objective."""
from __future__ import annotations

import numpy as np
import optuna
import torch
import torch.nn as nn
import torch.utils.data

from ml.cnn_transformer.auxiliary_labels import (
    generate_return_bucket_labels,
    generate_vol_regime_labels,
)
from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels
from ml.cnn_transformer.dataset import OHLCVWindowDataset
from ml.cnn_transformer.evaluate import compute_profit_factor, simulate_barrier_trades
from ml.cnn_transformer.label_utils import apply_split_mask
from ml.cnn_transformer.model import CnnTransformerModel
from ml.cnn_transformer.train import LossHeadConfig, TrainConfig, train_model
from shared.protocol import emit_metric


def run_hpo(
    ohlcv: dict[str, np.ndarray],
    timestamps: list[str],
    folds: list[dict],
    cost_config: dict,
    n_trials: int = 30,
    device: str = "cuda",
    window_size: int = 128,
) -> optuna.Study:
    """Run Optuna HPO over barrier configs with walk-forward validation.

    Each trial:
    1. Sample barrier params + training params
    2. Generate labels with sampled barrier config
    3. For each fold: train, evaluate, compute profit factor
    4. Return median profit factor across folds
    """
    cost_rt = cost_config["total_round_trip"]
    point_value = cost_config["point_value"]

    def objective(trial: optuna.Trial) -> float:
        # Sample barrier params
        atr_period = trial.suggest_categorical("atr_period", [10, 14, 20, 30])
        tp_mult = trial.suggest_float("tp_multiplier", 1.0, 4.0)
        sl_mult = trial.suggest_float("sl_multiplier", 0.5, 3.0)
        vert = trial.suggest_categorical("vertical_bars", [15, 30, 60, 120])
        lr = trial.suggest_float("learning_rate", 1e-5, 5e-4, log=True)

        # Sample loss weights; enforce gamma >= 0.05 to keep all heads active
        alpha = trial.suggest_float("loss_alpha", 0.5, 0.85)
        beta = trial.suggest_float("loss_beta", 0.05, 0.25)
        gamma = 1.0 - alpha - beta
        if gamma < 0.05:
            return 0.0  # reject invalid combo

        # Generate labels once per trial for this barrier config
        barrier = generate_triple_barrier_labels(
            close=ohlcv["close"],
            high=ohlcv["high"],
            low=ohlcv["low"],
            open_=ohlcv["open"],
            atr_period=atr_period,
            tp_multiplier=tp_mult,
            sl_multiplier=sl_mult,
            vertical_bars=vert,
        )
        vol_labels = generate_vol_regime_labels(ohlcv["close"], lookback=250)

        fold_pfs: list[float] = []
        for fold_idx, fold in enumerate(folds):
            train_end = fold["train_end"]
            test_start = fold["test_start"]
            test_end = fold["test_end"]

            # Fit return bucket bin edges on training data only (no lookahead)
            train_returns = barrier["returns_at_exit"][:train_end]
            _, bin_edges = generate_return_bucket_labels(train_returns, n_bins=8)
            bucket_labels, _ = generate_return_bucket_labels(
                barrier["returns_at_exit"],
                n_bins=8,
                bin_edges=bin_edges,
            )

            # Mask barrier and bucket labels at fold boundary to prevent lookahead
            masked_barrier = apply_split_mask(
                barrier["labels"], barrier["exit_bars"], test_start
            )
            masked_buckets = apply_split_mask(
                bucket_labels, barrier["exit_bars"], test_start
            )

            # Compute class weights from training slice only
            train_labels = masked_barrier[:train_end]
            valid_train = train_labels[~np.isnan(train_labels)]
            if len(valid_train) == 0:
                fold_pfs.append(0.0)
                continue

            # Barrier labels are -1/0/+1; shift to 0/1/2 for bincount and CrossEntropy
            shifted = (valid_train + 1).astype(int)
            class_counts = np.bincount(shifted, minlength=3).astype(np.float32)
            class_counts = np.maximum(class_counts, 1.0)
            class_weights = torch.tensor(class_counts.sum() / (3.0 * class_counts))

            # Build label dicts — barrier_class shifted to 0/1/2 for CrossEntropyLoss
            labels_dict: dict[str, np.ndarray] = {
                "barrier_class": masked_barrier + 1,   # -1->0, 0->1, +1->2
                "vol_regime": vol_labels,
                "return_bucket": masked_buckets,
            }
            train_ds = OHLCVWindowDataset(
                ohlcv, labels_dict, start=0, end=train_end, window_size=window_size
            )
            test_ds = OHLCVWindowDataset(
                ohlcv, labels_dict, start=test_start, end=test_end, window_size=window_size
            )

            if len(train_ds) == 0 or len(test_ds) == 0:
                fold_pfs.append(0.0)
                continue

            # Fresh model weights each fold — no cross-fold contamination
            model = CnnTransformerModel(window_size=window_size)

            loss_heads = [
                LossHeadConfig("barrier_class", nn.CrossEntropyLoss(weight=class_weights), alpha, True),
                LossHeadConfig("vol_regime", nn.CrossEntropyLoss(), beta, True),
                LossHeadConfig("return_bucket", nn.CrossEntropyLoss(), gamma, True),
            ]
            config = TrainConfig(
                epochs=30,
                batch_size=4096,
                learning_rate=lr,
                patience=5,
                loss_heads=loss_heads,
            )

            train_model(model, train_ds, test_ds, config, device=device)

            # Inference on test fold
            model.eval()
            dev = torch.device(device if torch.cuda.is_available() else "cpu")
            model = model.to(dev)
            test_loader = torch.utils.data.DataLoader(
                test_ds, batch_size=4096, shuffle=False
            )
            all_preds: list[np.ndarray] = []
            with torch.no_grad():
                for window, _, _ in test_loader:
                    out = model(window.to(dev), active_heads={"barrier_class"})
                    # Shift predictions back: 0->-1, 1->0, 2->+1
                    preds = out["barrier_class"].argmax(dim=1).cpu().numpy() - 1
                    all_preds.append(preds)
            predictions = np.concatenate(all_preds)

            # Align predictions with raw barrier arrays
            # Dataset first index = test_start + (window_size - 1) due to windowing
            offset = window_size - 1
            actual_start = test_start + offset
            actual_end = actual_start + len(predictions)
            test_actual = barrier["labels"][actual_start:actual_end]
            test_returns = barrier["returns_at_exit"][actual_start:actual_end]

            trades = simulate_barrier_trades(
                predictions, test_actual, test_returns, cost_rt, point_value
            )
            pf = compute_profit_factor(trades)
            fold_pfs.append(pf)

            # Report intermediate value for pruning
            trial.report(pf, fold_idx)
            if trial.should_prune():
                raise optuna.TrialPruned()

            emit_metric("fold_profit_factor", pf, fold_idx + 1, len(folds))

        median_pf = float(np.median(fold_pfs)) if fold_pfs else 0.0
        emit_metric("median_profit_factor", median_pf, trial.number + 1, n_trials)
        return median_pf

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=42),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=5),
    )
    study.optimize(objective, n_trials=n_trials)
    return study
