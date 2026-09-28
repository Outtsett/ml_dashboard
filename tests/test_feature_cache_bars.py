"""A cached feature matrix is only ever paired with the bars it was built from.

``load_ohlcv_arrays`` keeps the newest ``max_bars`` bars, so two runs that
differ only in ``max_bars`` load different bars. Before the fix the cache key
ignored it: the second run got the first run's matrix, and its labels (built
from the bars it actually loaded) indexed the wrong rows.
"""

from __future__ import annotations

import numpy as np
import pytest
from src.ml.shared import feature_cache


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(feature_cache, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(feature_cache, "_news_data_version", lambda: "fixed")
    return feature_cache


def _compute_for(timestamps: np.ndarray, calls: list[int]):
    def compute():
        calls.append(len(timestamps))
        return np.arange(len(timestamps), dtype=np.float32)[:, None], ["x"], timestamps
    return compute


def test_max_bars_is_part_of_the_key(cache):
    all_bars = np.arange(1_000, 1_010, dtype=np.int64)
    calls: list[int] = []
    cache.cached_features("MNQ", "5m", None, None, _compute_for(all_bars, calls), max_bars=0,
                          bar_timestamps=all_bars)
    newest = all_bars[-4:]
    _, _, ts = cache.cached_features("MNQ", "5m", None, None, _compute_for(newest, calls), max_bars=4,
                                     bar_timestamps=newest)
    assert calls == [10, 4] and ts.tolist() == newest.tolist()


def test_a_hit_for_other_bars_is_recomputed(cache):
    first = np.arange(1_000, 1_010, dtype=np.int64)
    calls: list[int] = []
    cache.cached_features("MNQ", "5m", None, None, _compute_for(first, calls), bar_timestamps=first)
    moved = first + 60                         # same key, the lake moved on
    _, _, ts = cache.cached_features("MNQ", "5m", None, None, _compute_for(moved, calls), bar_timestamps=moved)
    assert calls == [10, 10] and ts.tolist() == moved.tolist()


def test_a_hit_for_the_same_bars_is_served(cache):
    bars = np.arange(1_000, 1_010, dtype=np.int64)
    calls: list[int] = []
    for _ in range(2):
        cache.cached_features("MNQ", "5m", None, None, _compute_for(bars, calls), bar_timestamps=bars)
    assert calls == [10]
