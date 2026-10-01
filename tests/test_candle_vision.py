"""candle_vision: the facts the pattern recognizer and the candle-shape standouts rest on."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src" / "ml" / "studies" / "candle_shape_standouts"))

talib = pytest.importorskip("talib")
torch = pytest.importorskip("torch")

from candle_vision import labels, synth  # noqa: E402
from candle_vision.render import CANDLE_WIDTH, WINDOW_BARS, normalise, rasterize  # noqa: E402


def random_bars(n: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    c = np.round((np.cumsum(rng.normal(0, 4, n)) + 20000) * 4) / 4
    o = np.r_[c[0], c[:-1]] + np.round(rng.normal(0, 1, n) * 4) / 4
    h = np.maximum(o, c) + np.round(np.abs(rng.normal(0, 2, n)) * 4) / 4 * (rng.random(n) > 0.2)
    lo = np.minimum(o, c) - np.round(np.abs(rng.normal(0, 2, n)) * 4) / 4 * (rng.random(n) > 0.2)
    return np.stack([o, h, lo, c], 1)


def test_the_last_15_bars_decide_every_pattern():
    """A 20-bar window gives TA-Lib's full-series answer for all 61 functions (the image holds the label)."""
    bars = random_bars(3000)
    full = labels.talib_values(*bars.T)
    ends = np.arange(100, len(bars), 5)
    windows = np.stack([bars[t - WINDOW_BARS + 1:t + 1] for t in ends])
    assert (synth.verdicts(windows) == labels.to_classes(full[ends])).all()


def test_class_list_covers_every_direction_talib_emits():
    classes = labels.class_list()
    assert len(classes) == 88 and len({c[1] for c in classes}) == 61
    values = labels.talib_values(*random_bars(20000, seed=3).T)
    named = {(f, d) for _, f, d in classes}
    for j, function in enumerate(labels.pattern_functions()):
        for direction, fired in (("bullish", (values[:, j] > 0).any()), ("bearish", (values[:, j] < 0).any())):
            if fired:
                assert (function, direction) in named or (function, "neutral") in named, (function, direction)


def test_neutral_classes_fire_whenever_talib_fires():
    classes = labels.class_list()
    doji = next(k for k, c in enumerate(classes) if c[0] == "doji:neutral")
    values = np.zeros((2, 61), dtype=np.int16)
    values[0, labels.pattern_functions().index("CDLDOJI")] = 100
    assert labels.to_classes(values)[:, doji].tolist() == [1, 0]


def test_rasterize_draws_each_candle_in_its_own_columns():
    ohlc = np.zeros((1, WINDOW_BARS, 4))
    ohlc[0, :, :] = [10, 11, 9, 10.5]           # rising candles
    ohlc[0, -1] = [10.5, 12, 8, 9]               # the last one falling, the widest range
    image = rasterize(torch.from_numpy(normalise(ohlc)))[0]
    assert image.shape == (3, 128, WINDOW_BARS * CANDLE_WIDTH)
    last = image[:, :, -CANDLE_WIDTH:]
    assert last[2].sum() > 0 and last[1].sum() == 0          # falling body only
    assert image[1, :, :CANDLE_WIDTH].sum() > 0               # first candle rising
    assert float(last[0, 0, 2]) > 0.99 and float(last[0, -1, 2]) > 0.99  # the wick (column 2 of 6) spans top to bottom
    assert image[:, :, 0::CANDLE_WIDTH].sum() == 0            # the gap column stays blank


def test_synthetic_windows_carry_talib_verdicts():
    templates = {f"{t['pattern']}:{t['direction']}": t for t in labels.load_templates()["templates"]}
    contexts = np.stack([random_bars(WINDOW_BARS, seed=s) for s in range(256)])
    rng = np.random.default_rng(0)
    windows = synth.candidates(templates["engulfing:bearish"], contexts, rng)
    assert windows.shape == (256, WINDOW_BARS, 4)
    assert (windows[..., 1] >= windows[..., [0, 3]].max(-1)).all() and (windows[..., 2] <= windows[..., [0, 3]].min(-1)).all()
    k = [c[0] for c in labels.class_list()].index("engulfing:bearish")
    verdict = synth.verdicts(windows)
    assert verdict[:, k].sum() > 0
    for w, v in zip(windows[:20], verdict[:20]):
        assert (labels.to_classes(labels.talib_values(*w.T))[-1] == v).all()


def test_standout_rarity_is_causal():
    """Truncating the series never changes an earlier bar's trailing share (no whole-series statistic)."""
    import build

    bars = random_bars(6000, seed=7)
    _, _, _, cells = build.shape_cells(*bars.T)
    share_full, _ = build.trailing_share(cells, 1000)
    share_cut, _ = build.trailing_share(cells[:4000], 1000)
    np.testing.assert_array_equal(share_full[:4000], share_cut)
    assert np.isnan(share_full[:1000]).all()


def test_standout_frame_flags_follow_the_rules():
    import build

    n = 25_000
    bars = random_bars(n, seed=11)
    frame = pd.DataFrame(bars, columns=["open", "high", "low", "close"])
    frame["timestamp"] = pd.date_range("2024-01-01", periods=n, freq="min", tz="UTC")
    frame["trading_day"] = frame["timestamp"].dt.date
    frame["minute_of_session"] = 0
    frame["bars_since_session_break"] = 0
    frame["contract_symbol"] = "MNQH4"
    frame["volume"] = 1.0
    tables = build.compute(frame)
    standouts = tables["standouts"]
    assert (standouts["reason_count"] > 0).all()
    long_range = standouts[standouts["long_range"]]
    assert (long_range["range_to_trailing_mean_range_ratio"] >= 4.0).all()
    assert set(tables["rules"]["reason"]) == set(build.RULES)


def test_a_doji_at_the_window_edge_gets_a_full_pixel():
    """A sub-pixel body at the window's high is widened inside the image, not clipped by it."""
    window = np.array([[[0.0, 1.0, 0.0, 0.5]] * (WINDOW_BARS - 1) + [[1.0, 1.0, 0.9, 1.0]]], dtype=np.float32)
    image = rasterize(torch.from_numpy(window))[0]
    assert abs(float(image[1, :, -CANDLE_WIDTH + 1].sum()) - 1.0) < 1e-5


def test_tolerant_labels_keep_every_exact_firing_and_widen_only_a_little():
    from candle_vision import tolerance

    bars = random_bars(4000, seed=5)
    ends = np.arange(100, len(bars), 3)
    windows = np.stack([bars[t - WINDOW_BARS + 1:t + 1] for t in ends])
    exact = synth.verdicts(windows)
    soft = tolerance.soft_labels(windows, 0.10, 4, seed=0, jobs=1, log=lambda m: None).astype(np.float32)
    assert soft.shape == exact.shape and (soft >= 0).all() and (soft <= 1).all()
    assert (soft[exact == 1] >= 1 / 5 - 1e-3).all()            # the bars as they are are one of the 5 versions
    assert (tolerance.soft_labels(windows, 0.0, 4, log=lambda m: None) == exact).all()
    tolerant = (exact == 1) | (soft >= 0.5)
    assert exact.sum() <= tolerant.sum() <= 2 * exact.sum()
