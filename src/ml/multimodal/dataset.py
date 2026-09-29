"""The training table: decision-bar features joined to their bracket outcomes.

Features come from ``derived/multimodal_features/recipe=<features>/table=<block>``
(one table per modality, keyed by ``decision_timestamp``), outcomes from
``derived/multimodal_labels/recipe=<labels>/table=labels``. One row per decision
bar; for every (side, reward multiple) "head" the arrays hold the bracket's win
flag, net points, stop and target distances and entry/exit times.

Only the development period is loaded; ``holdout.guard`` refuses anything later.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from multimodal import holdout

FEATURES_RECIPE = "features_v1"
LABELS_RECIPE = "bracket_atr1_r2_r3_v1"
KEY_COLUMNS = ("decision_timestamp", "session", "is_decision")


def head_name(side: int, reward_multiple: float) -> str:
    return f"{'long' if side > 0 else 'short'}_r{reward_multiple:g}"


@dataclass
class Head:
    side: int
    reward_multiple: float
    win: np.ndarray            # 1 when the trade's net points were positive
    net_points: np.ndarray
    stop_points: np.ndarray
    target_points: np.ndarray
    entry_timestamp: np.ndarray
    exit_timestamp: np.ndarray
    available: np.ndarray      # a label exists for this decision bar


@dataclass
class Dataset:
    keys: pd.DataFrame                 # decision_timestamp, session
    features: pd.DataFrame             # one column per feature, NaN where unknown
    heads: dict[str, Head] = field(default_factory=dict)

    def modalities(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for column in self.features.columns:
            out.setdefault(column.split("_", 1)[0], []).append(column)
        return out


def _connection():
    from lake.serving import connect

    connection = connect(with_bars=False, with_derived=False)
    connection.execute("SET TimeZone='UTC'")
    return connection


def load(blocks: list[str], features_recipe: str = FEATURES_RECIPE, labels_recipe: str = LABELS_RECIPE,
         reward_multiples: tuple[float, ...] = (2.0, 3.0), connection=None) -> Dataset:
    connection = connection or _connection()
    merged: pd.DataFrame | None = None
    for block in blocks:
        path = f"s3://derived/multimodal_features/recipe={features_recipe}/table={block}/*.parquet"
        frame = connection.execute(f"SELECT * FROM read_parquet('{path}', hive_partitioning = false)").df()
        frame = frame[frame["is_decision"]].drop(columns=["is_decision"])
        if merged is None:
            merged = frame
        else:
            merged = merged.merge(frame.drop(columns=["session"]), on="decision_timestamp", how="inner")
    assert merged is not None, "no feature blocks"
    labels_path = f"s3://derived/multimodal_labels/recipe={labels_recipe}/table=labels/*.parquet"
    labels = connection.execute(
        "SELECT decision_timestamp, side, reward_multiple, net_points, stop_points, target_points, entry_timestamp, exit_timestamp "
        f"FROM read_parquet('{labels_path}', hive_partitioning = false)"
    ).df()
    keys_in_labels = labels["decision_timestamp"].unique()
    merged = merged[merged["decision_timestamp"].isin(keys_in_labels)].sort_values("decision_timestamp").reset_index(drop=True)
    holdout.guard(merged["decision_timestamp"].to_numpy(np.int64) * 1000, what="training table")
    keys = merged[["decision_timestamp", "session"]].copy()
    features = merged.drop(columns=["decision_timestamp", "session"]).astype("float32")
    dataset = Dataset(keys=keys, features=features)
    index = pd.Index(keys["decision_timestamp"].to_numpy())
    for reward in reward_multiples:
        for side in (1, -1):
            part = labels[(labels["side"] == side) & (labels["reward_multiple"] == reward)].set_index("decision_timestamp")
            aligned = part.reindex(index)
            available = aligned["net_points"].notna().to_numpy()
            net = aligned["net_points"].to_numpy(float)
            dataset.heads[head_name(side, reward)] = Head(
                side=side, reward_multiple=reward,
                win=(net > 0).astype(np.int8), net_points=net,
                stop_points=aligned["stop_points"].to_numpy(float), target_points=aligned["target_points"].to_numpy(float),
                entry_timestamp=aligned["entry_timestamp"].to_numpy(float), exit_timestamp=aligned["exit_timestamp"].to_numpy(float),
                available=available,
            )
    return dataset
