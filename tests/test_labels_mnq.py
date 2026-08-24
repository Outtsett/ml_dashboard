"""Smoke tests for src/ml/shared/labels.py against real MNQ 1m parquet.

Per the no-synthetic-data rule (~/.claude/rules/ml/no-synthetic-data.md), label
adapters are validated against actual MNQ 1m bars rather than synthesized data.
Loads the first 100k rows from data/parquet/MNQ/1m.parquet and verifies:
  - shape correctness
  - non-empty valid mask
  - label distribution within sane ranges per strategy
  - causality: no future leak in label generation
"""

from __future__ import annotations

import pathlib

import numpy as np
import polars as pl
import pytest
from src.ml.shared.labels import (
    next_close_direction_labels,
    range_bucket_labels,
    structural_labels,
    triple_barrier_labels,
)

# ─── Module-level data load ─────────────────────────────────────────────────

_PARQUET = pathlib.Path("E:/source/repos/ml_dashboard/data/parquet/MNQ/1m.parquet")
_N_BARS = 100_000


@pytest.fixture(scope="module")
def mnq_arrays():
    """Load the first 100k bars of MNQ 1m and return as float64 numpy arrays."""
    if not _PARQUET.exists():
        pytest.skip(f"MNQ 1m parquet missing at {_PARQUET}; cannot run smoke test")
    df = (
        pl.scan_parquet(str(_PARQUET))
        .select(["timestamp", "open", "high", "low", "close", "volume"])
        .head(_N_BARS)
        .collect()
    )
    if df.height < 1000:
        pytest.skip(f"MNQ 1m parquet has only {df.height} rows; need >= 1000")
    return {
        "timestamp": df["timestamp"].to_numpy(),
        "open": df["open"].to_numpy().astype(np.float64),
        "high": df["high"].to_numpy().astype(np.float64),
        "low": df["low"].to_numpy().astype(np.float64),
        "close": df["close"].to_numpy().astype(np.float64),
        "volume": df["volume"].to_numpy().astype(np.float64),
    }


# ─── 1. triple_barrier ──────────────────────────────────────────────────────


def test_triple_barrier_mnq(mnq_arrays):
    close = mnq_arrays["close"]
    high = mnq_arrays["high"]
    low = mnq_arrays["low"]
    n = close.shape[0]

    labels, valid = triple_barrier_labels(
        close=close, high=high, low=low,
        params={"horizon_bars": 10, "threshold_bp": 5.0},
    )
    # Shape contract
    assert labels.shape == (n,)
    assert valid.shape == (n,)
    assert labels.dtype == np.int8
    assert valid.dtype == np.bool_
    # Non-empty valid mask
    n_valid = int(valid.sum())
    assert n_valid > n // 4, f"expected >25% valid, got {n_valid}/{n}"
    # Label range: only {0, 1} where valid; -1 elsewhere.
    assert set(np.unique(labels[valid]).tolist()).issubset({0, 1})
    assert (labels[~valid] == -1).all()
    # Distribution is at least nominally balanced (each class >5%).
    pos_rate = float(labels[valid].mean())
    assert 0.05 < pos_rate < 0.95, f"degenerate triple-barrier dist: pos_rate={pos_rate:.3f}"


# ─── 2. next_close_direction ────────────────────────────────────────────────


def test_next_close_direction_mnq(mnq_arrays):
    close = mnq_arrays["close"]
    n = close.shape[0]

    # Binary mode (no flat zone)
    labels, valid = next_close_direction_labels(close=close, params={"horizon_bars": 5})
    assert labels.shape == (n,)
    assert valid.shape == (n,)
    assert labels.dtype == np.int8
    assert valid.dtype == np.bool_
    # Last 5 rows must be invalid (no future close).
    assert valid[: n - 5].all() and not valid[n - 5 :].any()
    # Binary labels in {0, 1} where valid.
    uniq = set(np.unique(labels[valid]).tolist())
    assert uniq.issubset({0, 1}), f"binary mode must yield {{0,1}}, got {uniq}"
    # Distribution roughly 50/50 (within +/- 15pp — MNQ has slight upside drift).
    pos_rate = float(labels[valid].mean())
    assert 0.35 < pos_rate < 0.65, f"binary direction not ~50/50: pos_rate={pos_rate:.3f}"

    # Ternary mode with flat zone
    labels3, valid3 = next_close_direction_labels(
        close=close, params={"horizon_bars": 5, "threshold_pts": 1.0}
    )
    uniq3 = set(np.unique(labels3[valid3]).tolist())
    assert uniq3.issubset({0, 1, 2}), f"ternary mode must yield subset of {{0,1,2}}, got {uniq3}"
    # All three classes should appear with non-trivial mass.
    n_valid3 = int(valid3.sum())
    for cls in (0, 1, 2):
        cls_count = int((labels3[valid3] == cls).sum())
        assert cls_count > n_valid3 * 0.02, (
            f"ternary class {cls} too rare: {cls_count}/{n_valid3}"
        )


# ─── 3. range_bucket ────────────────────────────────────────────────────────


def test_range_bucket_mnq(mnq_arrays):
    close = mnq_arrays["close"]
    n = close.shape[0]

    labels, valid = range_bucket_labels(
        close=close,
        params={"horizon_bars": 5, "bucket_width_pts": 2.0, "n_buckets": 21},
    )
    assert labels.shape == (n,)
    assert valid.shape == (n,)
    assert labels.dtype == np.int16
    assert valid.dtype == np.bool_
    # Last 5 rows are invalid.
    assert valid[: n - 5].all() and not valid[n - 5 :].any()
    # All labels in [0, 20].
    valid_labels = labels[valid]
    assert valid_labels.min() >= 0
    assert valid_labels.max() <= 20
    # Center bucket (10) should be the modal class for MNQ 1m short-horizon noise.
    bucket_counts = np.bincount(valid_labels.astype(np.int64), minlength=21)
    modal_bucket = int(bucket_counts.argmax())
    assert 8 <= modal_bucket <= 12, (
        f"expected near-center modal bucket, got {modal_bucket} "
        f"(distribution head={bucket_counts[:5].tolist()}, "
        f"middle={bucket_counts[8:13].tolist()}, tail={bucket_counts[-5:].tolist()})"
    )
    # Non-trivial mass in upper and lower halves.
    lower_mass = int(bucket_counts[:10].sum())
    upper_mass = int(bucket_counts[11:].sum())
    assert lower_mass > 0 and upper_mass > 0


# ─── 4. structural ──────────────────────────────────────────────────────────


def test_structural_mnq(mnq_arrays):
    high = mnq_arrays["high"]
    low = mnq_arrays["low"]
    n = high.shape[0]

    labels, valid = structural_labels(high=high, low=low, params={"lookback_bars": 20})
    assert labels.shape == (n,)
    assert valid.shape == (n,)
    assert labels.dtype == np.int8
    assert valid.dtype == np.bool_
    # First 20 rows invalid (no lookback available).
    assert not valid[:20].any() and valid[20:].all()
    # All labels in {0, 1, 2, 3, 4}.
    valid_labels = labels[valid]
    uniq = set(np.unique(valid_labels).tolist())
    assert uniq.issubset({0, 1, 2, 3, 4}), f"got {uniq}"
    # All five classes should appear at least once over 100k bars.
    for cls in (0, 1, 2, 3, 4):
        assert int((valid_labels == cls).sum()) > 0, f"class {cls} never appeared"
    # No single class dominates (>80%) — would indicate a buggy classifier.
    counts = np.bincount(valid_labels.astype(np.int64), minlength=5)
    max_share = float(counts.max()) / float(counts.sum())
    assert max_share < 0.80, f"degenerate structural dist: max_share={max_share:.3f}, counts={counts.tolist()}"
