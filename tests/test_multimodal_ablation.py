"""The gbdt family's block ablation (`multimodal.main.fit_family`), which gate G6 reads.

A block that carries the signal loses AUC when its columns are shuffled; a noise block does not; and the
measurement leaves the predictions and numpy's global random state (which the fusion member of an
ensemble shuffles with) exactly as they were.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from multimodal import main as runner
from multimodal import walkforward
from multimodal.dataset import Dataset, Head


def synthetic(n: int = 3000) -> Dataset:
    rng = np.random.default_rng(0)
    features = pd.DataFrame({"price_signal": rng.normal(size=n), "price_other": rng.normal(size=n), "flow_noise": rng.normal(size=n)})
    win = (features["price_signal"].to_numpy() + rng.normal(size=n) > 0).astype(np.int8)
    stamps = np.arange(n, dtype=np.int64) * 300
    head = Head(side=1, reward_multiple=2.0, win=win, net_points=np.where(win == 1, 10.0, -5.0), stop_points=np.full(n, 5.0),
                target_points=np.full(n, 12.0), entry_timestamp=stamps + 60, exit_timestamp=stamps + 600, available=np.ones(n, bool))
    keys = pd.DataFrame({"decision_timestamp": stamps, "session": np.repeat(np.arange(n // 10), 10)})
    return Dataset(keys=keys, features=features, heads={"long_r2": head})


def test_gbdt_ablation_finds_the_signal_block_and_changes_nothing_else():
    data = synthetic()
    fold = walkforward.Fold(3, "2021Q1", np.arange(0, 2000), np.arange(2010, 2500), np.arange(2510, 3000))
    args = runner.parse_args(["--model-id", "test", "--family", "gbdt"])

    np.random.seed(123)
    before = np.random.get_state()[1].copy()
    probabilities = {"long_r2": np.full(len(data.keys), np.nan)}
    importances: list[dict] = []
    runner.fit_family(args, data, fold, ("long_r2",), probabilities, importances)
    assert np.array_equal(np.random.get_state()[1], before)

    ablation = {row["feature"]: row["auc_drop"] for row in importances if row["feature"].endswith("__token")}
    assert set(ablation) == {"price__token", "flow__token"}
    assert ablation["price__token"] > 0.1
    assert abs(ablation["flow__token"]) < 0.02

    # the predictions are the model's own, whatever the ablation did afterwards
    again = {"long_r2": np.full(len(data.keys), np.nan)}
    runner.fit_family(args, data, fold, ("long_r2",), again, [])
    assert np.array_equal(probabilities["long_r2"][fold.test], again["long_r2"][fold.test])
