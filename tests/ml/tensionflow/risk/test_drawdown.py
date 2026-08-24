"""Tests for compute_drawdown_factor: drawdown protection scaling."""

from __future__ import annotations

import pytest

from tensionflow.config import MAX_DRAWDOWN_PCT
from tensionflow.risk.drawdown import compute_drawdown_factor


def test_no_drawdown_returns_one():
    # current == peak → drawdown = 0 → factor = 1.0
    result = compute_drawdown_factor(current_equity=100_000.0, peak_equity=100_000.0)
    assert result == pytest.approx(1.0, abs=1e-6)


def test_zero_peak_returns_one():
    # Uninitialised (peak=0) → return 1.0 (full allocation)
    result = compute_drawdown_factor(current_equity=50_000.0, peak_equity=0.0)
    assert result == pytest.approx(1.0, abs=1e-6)


def test_negative_peak_returns_one():
    result = compute_drawdown_factor(current_equity=100.0, peak_equity=-1.0)
    assert result == pytest.approx(1.0, abs=1e-6)


def test_at_max_drawdown_floors_at_point_one():
    # drawdown = MAX_DRAWDOWN_PCT → factor = max(0.1, 1 - 1) = 0.1
    peak = 100_000.0
    current = peak * (1.0 - MAX_DRAWDOWN_PCT)
    result = compute_drawdown_factor(current_equity=current, peak_equity=peak)
    assert result == pytest.approx(0.1, abs=1e-5)


def test_beyond_max_drawdown_floors_at_point_one():
    # drawdown > MAX_DRAWDOWN_PCT → factor still floored at 0.1
    peak = 100_000.0
    current = peak * 0.5  # 50% drawdown, far beyond MAX_DRAWDOWN_PCT
    result = compute_drawdown_factor(current_equity=current, peak_equity=peak)
    assert result == pytest.approx(0.1, abs=1e-6)


def test_half_max_drawdown_linear_decay():
    # drawdown = MAX_DRAWDOWN_PCT / 2 → factor = 1 - 0.5 = 0.5
    peak = 200_000.0
    current = peak * (1.0 - MAX_DRAWDOWN_PCT / 2.0)
    result = compute_drawdown_factor(current_equity=current, peak_equity=peak)
    assert result == pytest.approx(0.5, abs=1e-5)


def test_result_bounded_between_point_one_and_one():
    import numpy as np
    rng = np.random.default_rng(42)
    for _ in range(50):
        peak = float(rng.uniform(10_000, 200_000))
        current = float(rng.uniform(0, peak))
        result = compute_drawdown_factor(current_equity=current, peak_equity=peak)
        assert 0.1 <= result <= 1.0


def test_returns_float():
    result = compute_drawdown_factor(90_000.0, 100_000.0)
    assert isinstance(result, float)
