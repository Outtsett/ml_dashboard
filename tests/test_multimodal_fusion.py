"""`src/ml/multimodal/models/fusion.py` — the network trains, predicts every test row in [0, 1],
reports a per-modality ablation, and learns a planted signal from the modality that carries it."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

torch = pytest.importorskip("torch")

from multimodal.dataset import Dataset, Head  # noqa: E402
from multimodal.models.fusion import FusionParameters, fit_predict  # noqa: E402
from multimodal.walkforward import Fold  # noqa: E402


def planted(n: int = 3000, seed: int = 0) -> Dataset:
    rng = np.random.default_rng(seed)
    signal = rng.normal(size=n)
    features = pd.DataFrame({
        "price_signal": signal.astype(np.float32),
        "price_noise": rng.normal(size=n).astype(np.float32),
        "flow_noise": rng.normal(size=n).astype(np.float32),
    })
    keys = pd.DataFrame({"decision_timestamp": np.arange(n) * 300, "session": np.arange(n) // 60})
    heads = {}
    for name, side in (("long_r2", 1), ("short_r2", -1)):
        p = 1 / (1 + np.exp(-(side * 1.5 * signal - 0.8)))
        win = (rng.random(n) < p).astype(np.int8)
        heads[name] = Head(side, 2.0, win, np.where(win, 20.0, -10.0), np.full(n, 10.0), np.full(n, 22.0),
                           keys["decision_timestamp"].to_numpy() + 300.0, keys["decision_timestamp"].to_numpy() + 900.0, np.ones(n, bool))
    return Dataset(keys=keys, features=features, heads=heads,
                   sequence_bars=np.c_[signal, rng.normal(size=n)].astype(np.float32), sequence_columns=("price_signal", "noise"),
                   sequence_index=np.arange(n))


def test_the_network_learns_a_planted_signal_and_reports_ablations():
    data = planted()
    fold = Fold(0, "test", np.arange(0, 2000), np.arange(2050, 2400), np.arange(2450, 3000))
    probabilities = {h: np.full(len(data.keys), np.nan) for h in ("long_r2", "short_r2")}
    importances: list = []
    extra = fit_predict(data, fold, ("long_r2", "short_r2"), probabilities,
                        FusionParameters(epochs=8, hidden=16, sequence_bars=8, batch_size=256, patience=3), importances)
    assert extra["epochs_run"] >= 1
    test = probabilities["long_r2"][fold.test]
    assert np.isfinite(test).all() and (test >= 0).all() and (test <= 1).all()
    from sklearn.metrics import roc_auc_score

    assert roc_auc_score(data.heads["long_r2"].win[fold.test], test) > 0.7
    tokens = {row["feature"] for row in importances}
    assert {"price__token", "flow__token", "sequence__token"} <= tokens
    drops = {row["feature"]: row["auc_drop"] for row in importances if row["head"] == "long_r2"}
    assert drops["price__token"] > drops["flow__token"]      # the signal lives in the price modality
