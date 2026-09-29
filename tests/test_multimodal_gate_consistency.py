"""`src/ml/multimodal/gate.py` builds the holdout's features in memory; they must equal what the
development tables hold for the same bars, or the gate would score a model on inputs it never saw.

Checked on a development month (January 2024), built by the gate's own `build_period` with a
three-month lead-in, against `derived_multimodal_features_*`. Needs the lake (slow).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

pytestmark = pytest.mark.slow

BLOCKS = ["time", "price", "flow", "cross", "context"]


def test_the_gate_builds_the_same_features_as_the_development_tables():
    lake = pytest.importorskip("lake.serving")
    from multimodal import gate

    period = gate.build_period("2024-01-02", "2024-02-01", "2023-10-01", BLOCKS)
    connection = lake.connect(with_bars=False, with_derived=False)
    stored = None
    for block in BLOCKS:
        frame = connection.execute(
            f"SELECT * FROM read_parquet('s3://derived/multimodal_features/recipe=features_v1/table={block}/*.parquet', hive_partitioning = false)"
        ).df()
        frame = frame[frame["is_decision"]].drop(columns=["is_decision"])
        stored = frame if stored is None else stored.merge(frame.drop(columns=["session"]), on="decision_timestamp")
    stored = stored.set_index("decision_timestamp")
    built = period.features.copy()
    built.index = period.keys["decision_timestamp"].to_numpy()
    common = built.index.intersection(stored.index)
    assert len(common) > 1000
    mismatched = []
    for column in built.columns:
        a = built.loc[common, column].to_numpy(float)
        b = stored.loc[common, column].to_numpy(float)
        if not np.allclose(a, b, rtol=1e-5, atol=1e-6, equal_nan=True):
            bad = ~np.isclose(a, b, rtol=1e-5, atol=1e-6, equal_nan=True)
            mismatched.append((column, int(bad.sum())))
    assert not mismatched, f"gate-built features differ from the development tables: {mismatched}"
    built_labels = pd.Series(period.heads["long_r2"].net_points, index=period.keys["decision_timestamp"].to_numpy())
    assert built_labels.notna().mean() > 0.99
    stored_labels = connection.execute(
        "SELECT decision_timestamp, net_points FROM read_parquet('s3://derived/multimodal_labels/recipe=bracket_atr1_r2_r3_v1/table=labels/*.parquet', "
        "hive_partitioning = false) WHERE side = 1 AND reward_multiple = 2.0"
    ).df().set_index("decision_timestamp")["net_points"]
    shared = built_labels.index.intersection(stored_labels.index)
    assert len(shared) > 1000
    assert np.allclose(built_labels.loc[shared].to_numpy(), stored_labels.loc[shared].to_numpy(), atol=1e-9)
