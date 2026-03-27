"""End-to-end smoke test: generate labels, build model, train 1 epoch, evaluate."""

import numpy as np
import torch
import pytest


@pytest.mark.slow
def test_e2e_single_fold(synthetic_ohlcv):
    """Full pipeline: labels -> dataset -> model -> train -> evaluate."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels
    from ml.cnn_transformer.auxiliary_labels import (
        generate_vol_regime_labels,
        generate_return_bucket_labels,
    )
    from ml.cnn_transformer.label_utils import apply_split_mask
    from ml.cnn_transformer.dataset import OHLCVWindowDataset
    from ml.cnn_transformer.model import CnnTransformerModel
    from ml.cnn_transformer.train import train_model, TrainConfig, LossHeadConfig
    from ml.cnn_transformer.evaluate import (
        simulate_barrier_trades,
        compute_profit_factor,
    )

    data = synthetic_ohlcv
    n = len(data["close"])
    split = int(n * 0.8)

    # Generate barrier labels
    barrier = generate_triple_barrier_labels(
        data["close"], data["high"], data["low"], data["open"],
        atr_period=10, tp_multiplier=2.0, sl_multiplier=2.0, vertical_bars=20,
    )
    assert "returns_at_exit" in barrier

    # Vol regime (use small lookback for 1000-bar synthetic data)
    vol = generate_vol_regime_labels(data["close"], lookback=50)

    # Return bucket edges from TRAINING DATA ONLY
    train_returns = barrier["returns_at_exit"][:split]
    _, bin_edges = generate_return_bucket_labels(train_returns, n_bins=8)
    buckets, _ = generate_return_bucket_labels(
        barrier["returns_at_exit"], n_bins=8, bin_edges=bin_edges,
    )

    # Apply split mask to barrier AND bucket labels
    exit_bars = barrier["exit_bars"]
    train_barrier = apply_split_mask(barrier["labels"], exit_bars, split)
    train_buckets = apply_split_mask(buckets, exit_bars, split)

    # Shift barrier labels: -1,0,1 -> 0,1,2 for CrossEntropyLoss
    shifted_barrier = train_barrier.copy()
    valid_mask = ~np.isnan(shifted_barrier)
    shifted_barrier[valid_mask] += 1

    shifted_buckets = train_buckets  # already 0-indexed

    # Build datasets
    labels = {
        "barrier_class": shifted_barrier,
        "vol_regime": vol,
        "return_bucket": shifted_buckets,
    }
    ws = 32
    train_ds = OHLCVWindowDataset(data, labels, start=0, end=split, window_size=ws)
    val_ds = OHLCVWindowDataset(data, labels, start=split, end=n, window_size=ws)
    assert len(train_ds) > 0
    assert len(val_ds) > 0

    # Build small model for speed
    model = CnnTransformerModel(
        window_size=ws, d_model=64, n_heads=4, n_layers=2, n_codebook=8,
    )

    # Loss heads
    loss_heads = [
        LossHeadConfig("barrier_class", torch.nn.CrossEntropyLoss(), 0.7, True),
        LossHeadConfig("vol_regime", torch.nn.CrossEntropyLoss(), 0.2, True),
        LossHeadConfig("return_bucket", torch.nn.CrossEntropyLoss(), 0.1, True),
    ]
    config = TrainConfig(
        epochs=2, batch_size=64, learning_rate=1e-3,
        patience=5, loss_heads=loss_heads,
    )

    # Train (CPU for test reliability)
    result = train_model(model, train_ds, val_ds, config, device="cpu")
    assert "best_epoch" in result
    assert "best_val_loss" in result
    assert result["best_epoch"] >= 1

    # Inference on val set
    model.eval()
    val_loader = torch.utils.data.DataLoader(val_ds, batch_size=64, shuffle=False)
    all_preds = []
    with torch.no_grad():
        for window, _, _ in val_loader:
            out = model(window, active_heads={"barrier_class"})
            preds = out["barrier_class"].argmax(dim=1).numpy() - 1  # shift back
            all_preds.append(preds)
    predictions = np.concatenate(all_preds)

    # Align predictions with actual labels.
    # OHLCVWindowDataset.first = max(start, window_size - 1).
    # With start=split=800 and ws=32: first = 800 (no warmup offset needed).
    # Sample i in val_ds maps to bar (split + i), so predictions align directly.
    actual_start = split
    actual_end = actual_start + len(predictions)
    test_actual = barrier["labels"][actual_start:actual_end]
    test_returns = barrier["returns_at_exit"][actual_start:actual_end]

    # Trade simulation
    trades = simulate_barrier_trades(predictions, test_actual, test_returns, 2.80, 2.0)
    pf = compute_profit_factor(trades)
    assert isinstance(pf, float)
    assert pf >= 0.0
