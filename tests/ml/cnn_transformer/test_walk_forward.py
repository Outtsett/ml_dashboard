"""Tests for walk-forward fold generation."""
import numpy as np
import pytest
from datetime import datetime, timedelta


def _make_timestamps(start_year: int, end_year: int, interval_minutes: int = 5):
    """Generate monotonically increasing timestamps spanning years."""
    base = datetime(start_year, 1, 1)
    end = datetime(end_year, 12, 31)
    ts = []
    current = base
    while current < end:
        ts.append(current.strftime("%Y-%m-%d %H:%M:%S"))
        current += timedelta(minutes=interval_minutes)
    return ts


def test_generate_folds_count():
    from ml.cnn_transformer.walk_forward import generate_folds
    ts = _make_timestamps(2019, 2025, interval_minutes=60)
    folds = generate_folds(n_bars=len(ts), timestamps=ts, fold_months=6, purge_bars=120)
    assert len(folds) >= 6


def test_folds_no_overlap():
    from ml.cnn_transformer.walk_forward import generate_folds
    ts = _make_timestamps(2019, 2025, interval_minutes=60)
    folds = generate_folds(n_bars=len(ts), timestamps=ts, fold_months=6, purge_bars=120)
    assert len(folds) > 0
    for fold in folds:
        assert fold["train_end"] + fold["purge_bars"] <= fold["test_start"]


def test_folds_expanding_window():
    from ml.cnn_transformer.walk_forward import generate_folds
    ts = _make_timestamps(2019, 2025, interval_minutes=60)
    folds = generate_folds(n_bars=len(ts), timestamps=ts, fold_months=6, purge_bars=120)
    assert len(folds) > 0
    for fold in folds:
        assert fold["train_start"] == 0


def test_fold_dict_keys():
    from ml.cnn_transformer.walk_forward import generate_folds
    ts = _make_timestamps(2019, 2025, interval_minutes=60)
    folds = generate_folds(n_bars=len(ts), timestamps=ts, fold_months=6, purge_bars=120)
    assert len(folds) > 0
    required = {"fold_number", "train_start", "train_end", "purge_bars", "test_start", "test_end"}
    for fold in folds:
        assert required.issubset(fold.keys())


def test_folds_with_iso8601_timestamps():
    from ml.cnn_transformer.walk_forward import generate_folds
    base = datetime(2019, 1, 1)
    ts = [(base + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M:%S.000000Z") for i in range(60000)]
    folds = generate_folds(n_bars=len(ts), timestamps=ts, fold_months=6, purge_bars=120)
    assert len(folds) >= 4
