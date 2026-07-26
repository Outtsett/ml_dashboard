"""Unit tests for src/ml/shared/bootstrap.py.

Validates:

1. IID Gaussian: block-bootstrap CI for the mean ~= analytic normal CI.
2. AR(1) phi=0.5: block-bootstrap CI is wider than naive iid bootstrap CI
   (proves the block scheme captures autocorrelation-induced variance).
3. Politis-Romano picks a different (typically larger) block size than
   sqrt(n) on autocorrelated data.
4. p-value of clearly-greater candidate vs zero baseline is < 0.01.
5. Reproducibility: same random_state -> identical bounds.
6. Edge cases: empty series, n_resamples=1, invalid statistic name, invalid
   block_size_method, ci out of range.
7. CLI smoke test: subprocess + JSON stdout parses to expected schema.

Synthetic iid/AR(1) arrays are valid here because this is an algorithm-level
unit test of the bootstrap, not a model-training data test.
"""

from __future__ import annotations

import json
import subprocess
import sys

import numpy as np
import pytest
from scipy.stats import norm
from src.ml.shared.bootstrap import (
    _block_size_sqrt_n,
    _politis_romano_block_size,
    _resolve_statistic,
    block_bootstrap_ci,
    bootstrap_pvalue_vs_baseline,
)

# ─── Helpers ────────────────────────────────────────────────────────────────


def _ar1(n: int, phi: float, sigma: float = 1.0, seed: int = 0) -> np.ndarray:
    """Generate an AR(1) series x_t = phi * x_{t-1} + eps_t, eps ~ N(0, sigma^2)."""
    rng = np.random.default_rng(seed)
    eps = rng.normal(0.0, sigma, size=n)
    x = np.empty(n, dtype=np.float64)
    x[0] = eps[0] / np.sqrt(max(1.0 - phi * phi, 1e-9))  # stationary init
    for i in range(1, n):
        x[i] = phi * x[i - 1] + eps[i]
    return x


def _iid_bootstrap_ci_mean(
    series: np.ndarray,
    n_resamples: int = 10_000,
    ci: float = 0.95,
    seed: int = 0,
) -> tuple[float, float]:
    """Naive (block_size=1) percentile bootstrap CI for the mean."""
    rng = np.random.default_rng(seed)
    n = series.shape[0]
    idx = rng.integers(0, n, size=(n_resamples, n))
    means = series[idx].mean(axis=1)
    alpha = 1.0 - ci
    return float(np.quantile(means, alpha / 2.0)), float(np.quantile(means, 1.0 - alpha / 2.0))


# ─── 1. IID Gaussian: bootstrap CI ~ analytic normal CI ────────────────────


def test_iid_gaussian_mean_ci_matches_analytic():
    rng = np.random.default_rng(42)
    n = 1000
    series = rng.normal(loc=0.5, scale=2.0, size=n)
    point, lo, hi = block_bootstrap_ci(
        series,
        statistic="mean",
        n_resamples=10_000,
        random_state=123,
    )
    sem = series.std(ddof=1) / np.sqrt(n)
    analytic_lo, analytic_hi = norm.interval(0.95, loc=series.mean(), scale=sem)

    assert point == pytest.approx(series.mean(), rel=1e-9)
    # Within ~5% of analytic CI bounds (block_size = sqrt(1000) = 31, so the
    # iid mean is slightly inflated vs analytic SEM but should track tightly).
    width_analytic = analytic_hi - analytic_lo
    assert abs(lo - analytic_lo) < 0.10 * width_analytic, (
        f"lo={lo} analytic_lo={analytic_lo}"
    )
    assert abs(hi - analytic_hi) < 0.10 * width_analytic, (
        f"hi={hi} analytic_hi={analytic_hi}"
    )


# ─── 2. AR(1): block bootstrap CI is wider than naive iid bootstrap ───────


def test_ar1_block_bootstrap_wider_than_iid():
    series = _ar1(n=2000, phi=0.5, seed=7)
    _, lo_block, hi_block = block_bootstrap_ci(
        series,
        statistic="mean",
        n_resamples=4_000,
        random_state=11,
    )
    lo_iid, hi_iid = _iid_bootstrap_ci_mean(series, n_resamples=4_000, seed=11)
    width_block = hi_block - lo_block
    width_iid = hi_iid - lo_iid
    # On AR(1) phi=0.5 with n=2000, theoretical inflation factor for variance
    # of the mean is (1+phi)/(1-phi) = 3.0 -> sqrt(3) ~ 1.73x SE. We accept
    # any width inflation > 1.3x as proof the block scheme is doing its job.
    assert width_block > 1.3 * width_iid, (
        f"block_width={width_block} not wider than 1.3x iid_width={width_iid}"
    )


# ─── 3. Politis-Romano vs sqrt_n on autocorrelated data ────────────────────


def test_politis_romano_differs_from_sqrt_n_on_ar1():
    series = _ar1(n=2000, phi=0.7, seed=3)
    bs_sqrt = _block_size_sqrt_n(series.shape[0])
    bs_pr = _politis_romano_block_size(series)
    assert bs_sqrt == 44  # floor(sqrt(2000)) = 44
    assert bs_pr != bs_sqrt, f"PR returned same {bs_pr} as sqrt_n {bs_sqrt}"
    assert bs_pr >= 1
    # On strongly autocorrelated data the optimal block is typically larger
    # than the rule of thumb. We don't enforce direction strictly (PR can
    # return smaller in finite samples), only that it ran the spectral path
    # and produced a finite, reasonable value.
    assert bs_pr <= series.shape[0] // 2


def test_politis_romano_constant_series_falls_back():
    # Variance-zero edge case: PR estimator hits the var<=0 guard.
    series = np.zeros(500, dtype=np.float64)
    bs_pr = _politis_romano_block_size(series)
    assert bs_pr == _block_size_sqrt_n(500)


# ─── 4. p-value: clearly greater candidate ─────────────────────────────────


def test_pvalue_candidate_greater_than_baseline():
    rng = np.random.default_rng(99)
    n = 500
    candidate = 0.5 + rng.normal(0.0, 0.3, size=n)  # mean ~0.5
    baseline = rng.normal(0.0, 0.3, size=n)         # mean ~0.0
    p = bootstrap_pvalue_vs_baseline(
        candidate,
        baseline,
        statistic="mean",
        n_resamples=2_000,
        alternative="greater",
        random_state=5,
    )
    assert p < 0.01, f"expected p<0.01 for clearly-greater candidate, got p={p}"


def test_pvalue_two_sided_when_no_difference():
    rng = np.random.default_rng(1)
    n = 400
    candidate = rng.normal(0.0, 1.0, size=n)
    baseline = rng.normal(0.0, 1.0, size=n)
    p = bootstrap_pvalue_vs_baseline(
        candidate,
        baseline,
        statistic="mean",
        n_resamples=2_000,
        alternative="two-sided",
        random_state=2,
    )
    assert p > 0.05, f"expected p>0.05 for indistinguishable means, got p={p}"


def test_pvalue_independent_paths_when_different_lengths():
    # Length mismatch -> independent bootstraps for each side.
    rng = np.random.default_rng(7)
    candidate = 0.4 + rng.normal(0.0, 0.3, size=300)
    baseline = rng.normal(0.0, 0.3, size=200)
    p = bootstrap_pvalue_vs_baseline(
        candidate,
        baseline,
        statistic="mean",
        n_resamples=2_000,
        alternative="greater",
        random_state=8,
    )
    assert p < 0.01


# ─── 5. Reproducibility ────────────────────────────────────────────────────


def test_random_state_reproducibility():
    rng = np.random.default_rng(0)
    series = rng.normal(0.0, 1.0, size=500)
    out_a = block_bootstrap_ci(
        series, statistic="mean", n_resamples=1_000, random_state=42
    )
    out_b = block_bootstrap_ci(
        series, statistic="mean", n_resamples=1_000, random_state=42
    )
    assert out_a == out_b


def test_random_state_changes_result():
    rng = np.random.default_rng(0)
    series = rng.normal(0.0, 1.0, size=500)
    out_a = block_bootstrap_ci(
        series, statistic="mean", n_resamples=1_000, random_state=42
    )
    out_b = block_bootstrap_ci(
        series, statistic="mean", n_resamples=1_000, random_state=43
    )
    # Different seed must change at least one CI bound.
    assert out_a != out_b


# ─── 6. Edge cases & validation ────────────────────────────────────────────


def test_empty_series_raises():
    with pytest.raises(ValueError, match="non-empty"):
        block_bootstrap_ci(np.array([], dtype=np.float64))


def test_invalid_ci_raises():
    with pytest.raises(ValueError, match="ci must be in"):
        block_bootstrap_ci(np.array([1.0, 2.0, 3.0]), ci=1.5)


def test_invalid_n_resamples_raises():
    with pytest.raises(ValueError, match="n_resamples"):
        block_bootstrap_ci(np.array([1.0, 2.0]), n_resamples=0)


def test_invalid_block_size_raises():
    with pytest.raises(ValueError, match="block_size must be >= 1"):
        block_bootstrap_ci(np.array([1.0, 2.0, 3.0]), block_size=0)


def test_invalid_block_size_method_raises():
    with pytest.raises(ValueError, match="block_size_method"):
        block_bootstrap_ci(
            np.array([1.0, 2.0, 3.0]),
            block_size_method="bogus",  # type: ignore[arg-type]
        )


def test_invalid_statistic_name_raises():
    with pytest.raises(ValueError, match="Unknown statistic"):
        _resolve_statistic("nonexistent_stat")


def test_invalid_statistic_type_raises():
    with pytest.raises(TypeError, match="callable or str"):
        _resolve_statistic(42)  # type: ignore[arg-type]


def test_invalid_alternative_raises():
    with pytest.raises(ValueError, match="alternative must be"):
        bootstrap_pvalue_vs_baseline(
            np.array([1.0]),
            np.array([0.0]),
            alternative="bogus",  # type: ignore[arg-type]
        )


def test_n_resamples_one_degenerate_ok():
    # Should not crash; lo == hi == single resample mean.
    series = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    point, lo, hi = block_bootstrap_ci(
        series, statistic="mean", n_resamples=1, random_state=0
    )
    assert lo == hi  # only one bootstrap value -> percentile collapses


# ─── 7. Named statistic shortcuts wired correctly ─────────────────────────


@pytest.mark.parametrize(
    "name,series,expected",
    [
        ("mean", np.array([1.0, 2.0, 3.0, 4.0, 5.0]), 3.0),
        ("median", np.array([1.0, 2.0, 3.0, 4.0, 5.0]), 3.0),
        ("profit_factor", np.array([2.0, -1.0, 3.0, -1.0]), 5.0 / 2.0),
        ("profit_factor", np.array([1.0, 2.0]), float("inf")),
        ("profit_factor", np.array([-1.0, -2.0]), 0.0),
    ],
)
def test_named_statistics(name, series, expected):
    fn = _resolve_statistic(name)
    assert fn(series) == expected


def test_callable_statistic_works():
    series = np.array([1.0, 2.0, 3.0, 4.0])

    def my_stat(x: np.ndarray) -> float:
        return float(np.sum(x))

    point, lo, hi = block_bootstrap_ci(
        series, statistic=my_stat, n_resamples=500, random_state=0
    )
    assert point == 10.0
    assert lo <= point <= hi


# ─── 8. CLI smoke test ─────────────────────────────────────────────────────


def test_cli_emits_expected_json_schema():
    series = [0.1, -0.05, 0.2, 0.15, -0.1, 0.08, -0.02, 0.12, 0.05, -0.03]
    cmd = [
        sys.executable,
        "-m",
        "src.ml.shared.bootstrap",
        "--series-json",
        json.dumps(series),
        "--statistic",
        "mean",
        "--block-size-method",
        "sqrt_n",
        "--n-resamples",
        "1000",
        "--ci",
        "0.95",
        "--random-state",
        "0",
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
        cwd=".",
    )
    assert proc.returncode == 0, f"CLI failed:\nstderr={proc.stderr}"
    payload = json.loads(proc.stdout.strip().splitlines()[-1])
    expected_keys = {"point", "ci_lower", "ci_upper", "block_size", "n_resamples"}
    assert set(payload) == expected_keys, f"unexpected keys: {set(payload)}"
    assert payload["point"] == pytest.approx(float(np.mean(series)), rel=1e-9)
    assert payload["ci_lower"] <= payload["point"] <= payload["ci_upper"]
    assert payload["block_size"] == _block_size_sqrt_n(len(series))
    assert payload["n_resamples"] == 1000


def test_cli_invalid_json_returns_error():
    cmd = [
        sys.executable,
        "-m",
        "src.ml.shared.bootstrap",
        "--series-json",
        "not valid json",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    assert proc.returncode == 2
    payload = json.loads(proc.stdout.strip().splitlines()[-1])
    assert "error" in payload
