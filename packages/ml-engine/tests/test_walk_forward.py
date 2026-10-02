"""Unit tests for packages/ml-engine/packages/shared/src/walk_forward.py.

Covers the iter_folds() walk-forward fold generator with synthetic timestamp
arrays — no disk I/O, no parquet loading. This is a unit test of the
calendar-aware fold-boundary math; data integrity is tested separately in
tests/test_labels_mnq.py.
"""

from __future__ import annotations

import numpy as np
import pytest
from core.shared.walk_forward import Fold, iter_folds

# ─── Helpers ────────────────────────────────────────────────────────────────


def _daily_timestamps_int64(start_iso: str, n_days: int) -> np.ndarray:
    """Return int64 epoch-seconds array, one timestamp per day starting at start_iso."""
    start = np.datetime64(start_iso, "s")
    seconds_per_day = 86400
    return (start.astype("int64") + np.arange(n_days, dtype=np.int64) * seconds_per_day)


def _months_between(a: np.datetime64, b: np.datetime64) -> int:
    """Months from a to b (inclusive of both endpoints)."""
    am = a.astype("datetime64[M]")
    bm = b.astype("datetime64[M]")
    return int((bm - am).astype("int64")) + 1


# ─── 1. Basic rolling: 36 months → 3 folds (12-train + 3-test, step 3) ─────


def test_basic_rolling_3_folds():
    # 36 months × ~30 days/month = 1080 days. Use exact daily granularity.
    ts = _daily_timestamps_int64("2020-01-01", 36 * 30)
    folds = list(
        iter_folds(
            timestamps=ts,
            train_months=12,
            test_months=3,
            step_months=3,
        )
    )
    assert len(folds) >= 3, f"expected >= 3 folds, got {len(folds)}"
    # First three folds should be the canonical 12+3 layout.
    f0, f1, f2 = folds[0], folds[1], folds[2]
    assert f0.idx == 0 and f1.idx == 1 and f2.idx == 2
    # No overlap: each fold's train_idx and test_idx are disjoint.
    for f in (f0, f1, f2):
        assert np.intersect1d(f.train_idx, f.test_idx).size == 0
        assert f.train_idx.max() < f.test_idx.min(), "train must precede test"
    # Test windows advance by 3 months.
    span_f0 = _months_between(f0.test_start, f0.test_end)
    assert 2 <= span_f0 <= 4, f"test span ~3 months, got {span_f0}"
    # Test starts shift forward fold-to-fold.
    assert f1.test_start > f0.test_start
    assert f2.test_start > f1.test_start


# ─── 2. Purge bars trim train end ──────────────────────────────────────────


def test_purge_trims_train_end():
    ts = _daily_timestamps_int64("2020-01-01", 36 * 30)
    folds_no_purge = list(
        iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=3, purge_bars=0)
    )
    folds_purged = list(
        iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=3, purge_bars=10)
    )
    assert len(folds_no_purge) == len(folds_purged)
    for f0, f1 in zip(folds_no_purge, folds_purged):
        # Same start, fewer bars at end of train.
        assert f0.train_idx[0] == f1.train_idx[0]
        assert f1.train_idx.size == f0.train_idx.size - 10
        assert f1.train_idx[-1] == f0.train_idx[-1] - 10
        # Test indices unchanged.
        np.testing.assert_array_equal(f0.test_idx, f1.test_idx)


# ─── 3. Embargo bars trim test start ───────────────────────────────────────


def test_embargo_trims_test_start():
    ts = _daily_timestamps_int64("2020-01-01", 36 * 30)
    folds_no_emb = list(
        iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=3, embargo_bars=0)
    )
    folds_emb = list(
        iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=3, embargo_bars=5)
    )
    assert len(folds_no_emb) == len(folds_emb)
    for f0, f1 in zip(folds_no_emb, folds_emb):
        # Train indices unchanged.
        np.testing.assert_array_equal(f0.train_idx, f1.train_idx)
        # Test starts 5 bars later.
        assert f1.test_idx.size == f0.test_idx.size - 5
        assert f1.test_idx[0] == f0.test_idx[0] + 5
        assert f1.test_idx[-1] == f0.test_idx[-1]


# ─── 4. Expanding training window grows each fold ───────────────────────────


def test_expanding_train():
    ts = _daily_timestamps_int64("2020-01-01", 36 * 30)
    rolling = list(
        iter_folds(
            timestamps=ts,
            train_months=12,
            test_months=3,
            step_months=3,
            expanding=False,
        )
    )
    expanding = list(
        iter_folds(
            timestamps=ts,
            train_months=12,
            test_months=3,
            step_months=3,
            expanding=True,
        )
    )
    assert len(rolling) == len(expanding)
    # Rolling: train_idx.size is roughly constant fold-to-fold.
    rolling_sizes = [f.train_idx.size for f in rolling]
    assert max(rolling_sizes) - min(rolling_sizes) <= 2
    # Expanding: train_idx.size is strictly increasing fold-to-fold.
    expanding_sizes = [f.train_idx.size for f in expanding]
    assert all(b > a for a, b in zip(expanding_sizes, expanding_sizes[1:])), (
        f"expanding sizes should be strictly increasing, got {expanding_sizes}"
    )
    # All expanding folds anchor at the data start.
    for f in expanding:
        assert f.train_idx[0] == 0


# ─── 5. Calendar month boundaries (Feb vs Jan length differences) ──────────


def test_calendar_month_boundaries():
    # Span Jan 2024 (31 days) → Feb 2024 (29 leap) → Mar 2024 (31 days), etc.
    # 24 months of daily bars to give the rolling window enough room.
    ts = _daily_timestamps_int64("2024-01-01", 24 * 32)  # over-allocate to cover any month
    folds = list(
        iter_folds(timestamps=ts, train_months=12, test_months=1, step_months=1)
    )
    assert len(folds) >= 2
    # First fold's train should span Jan 2024 → Dec 2024 (12 calendar months).
    f0 = folds[0]
    train_first_m = f0.train_start.astype("datetime64[M]")
    train_last_m = f0.train_end.astype("datetime64[M]")
    assert train_first_m == np.datetime64("2024-01", "M")
    # train end is *inclusive* and the half-open interval ends at Jan 2025 (exclusive),
    # so last month present is Dec 2024.
    assert train_last_m == np.datetime64("2024-12", "M")
    # First fold's test is Jan 2025 (31 days).
    assert f0.test_start.astype("datetime64[M]") == np.datetime64("2025-01", "M")
    # Sanity: Feb-test fold should still produce the right number of test bars,
    # despite Feb being a different length than Jan.
    feb_fold = next((f for f in folds if f.test_start.astype("datetime64[M]") == np.datetime64("2025-02", "M")), None)
    assert feb_fold is not None, "expected a fold with Feb 2025 test window"
    # Feb 2025 has 28 days — test_idx size should be 28 with 1-day spacing.
    assert feb_fold.test_idx.size == 28


# ─── 6. No folds when window too short ─────────────────────────────────────


def test_no_folds_when_window_too_short():
    # Only 3 months of data — train_months=12 will not fit. Should yield zero folds
    # without raising.
    ts = _daily_timestamps_int64("2024-01-01", 3 * 30)
    folds = list(iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=3))
    assert folds == []


# ─── Bonus: validation ──────────────────────────────────────────────────────


def test_invalid_args_raise():
    ts = _daily_timestamps_int64("2024-01-01", 100)
    with pytest.raises(ValueError):
        list(iter_folds(timestamps=ts, train_months=0, test_months=3, step_months=3))
    with pytest.raises(ValueError):
        list(iter_folds(timestamps=ts, train_months=12, test_months=0, step_months=3))
    with pytest.raises(ValueError):
        list(iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=0))
    with pytest.raises(ValueError):
        list(iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=3, purge_bars=-1))
    with pytest.raises(ValueError):
        list(iter_folds(timestamps=ts, train_months=12, test_months=3, step_months=3, embargo_bars=-1))


def test_fold_dataclass_frozen():
    f = Fold(
        idx=0,
        train_start=np.datetime64("2024-01-01", "s"),
        train_end=np.datetime64("2024-12-31", "s"),
        test_start=np.datetime64("2025-01-01", "s"),
        test_end=np.datetime64("2025-03-31", "s"),
        train_idx=np.array([0, 1, 2], dtype=np.int64),
        test_idx=np.array([3, 4, 5], dtype=np.int64),
    )
    with pytest.raises((AttributeError, Exception)):
        f.idx = 99  # type: ignore[misc]  # frozen dataclass should reject
