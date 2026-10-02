"""Moving-block bootstrap (MBB) confidence intervals and p-values.

Designed for autocorrelated trading-PnL series where the iid bootstrap
underestimates variance. Implements:

- ``block_bootstrap_ci`` — CI95 (default) for an arbitrary statistic
  (mean / median / Sharpe / profit factor / user callable).
- ``bootstrap_pvalue_vs_baseline`` — one-sided / two-sided p-value for
  ``statistic(candidate) vs statistic(baseline)`` via paired (same length)
  or independent block bootstrap. Used by the W7 promotion gate
  ``bootstrap_pvalue_vs_baseline`` and W6 frontend evaluator.
- A ``__main__`` CLI that emits a single-line JSON result for the
  ``POST /api/eval/block-bootstrap`` backend route (W6.b).

Block-size selection:
- ``sqrt_n`` = ``floor(sqrt(n))`` — the rule-of-thumb default. Fast and
  conservative; tends to over-estimate variance when autocorrelation is
  weak.
- ``politis_romano`` = automatic via the Politis & White (2004) lag-window
  / spectral method. Estimates the optimal block length from the sample
  autocovariance kernel and an empirical bandwidth-selection rule.

Algorithmic notes:
- The hot resampling loop (``_resample_blocks_njit``) is JIT-compiled with
  numba ``@njit(cache=True)`` and produces (n_resamples, n) re-sampled
  index arrays. Statistics are evaluated in pure NumPy on each row to
  preserve callable-statistic generality.
- For the moving block bootstrap the number of blocks per resample is
  ``ceil(n / block_size)``; the resample is truncated back to length n.
- Reproducibility: ``random_state`` seeds a ``numpy.random.Generator``
  (PCG64); the integer block-start indices are sampled once and passed to
  the numba kernel — this keeps the JIT path deterministic and free of
  numba's separate RNG seeding pitfalls.

References:
- Künsch, H. R. (1989). The jackknife and the bootstrap for general
  stationary observations. *Annals of Statistics*, 17(3), 1217-1241.
- Politis, D. N., & White, H. (2004). Automatic block-length selection
  for the dependent bootstrap. *Econometric Reviews*, 23(1), 53-70.
- Lahiri, S. N. (2003). *Resampling Methods for Dependent Data*.
  Springer, ch. 5-7.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Callable, Literal, Union

import numpy as np
from numba import njit

# ─── Public types ─────────────────────────────────────────────────────────

StatisticArg = Union[Callable[[np.ndarray], float], str]
BlockSizeMethod = Literal["sqrt_n", "politis_romano"]
Alternative = Literal["greater", "less", "two-sided"]


# ─── Named statistic registry ─────────────────────────────────────────────


def _stat_mean(x: np.ndarray) -> float:
    return float(np.mean(x))


def _stat_median(x: np.ndarray) -> float:
    return float(np.median(x))


def _stat_sharpe(x: np.ndarray) -> float:
    """Annualization-free Sharpe ratio (mean / std). NaN for std=0."""
    s = float(np.std(x, ddof=1)) if x.size > 1 else 0.0
    if s == 0.0:
        return 0.0
    return float(np.mean(x)) / s


def _stat_profit_factor(x: np.ndarray) -> float:
    """sum(positive) / sum(|negative|). +inf if no losses, 0 if no wins."""
    pos = float(np.sum(x[x > 0]))
    neg = float(-np.sum(x[x < 0]))
    if neg == 0.0:
        return float("inf") if pos > 0.0 else 0.0
    return pos / neg


_NAMED_STATISTICS: dict[str, Callable[[np.ndarray], float]] = {
    "mean": _stat_mean,
    "median": _stat_median,
    "sharpe": _stat_sharpe,
    "profit_factor": _stat_profit_factor,
}


def _resolve_statistic(statistic: StatisticArg) -> Callable[[np.ndarray], float]:
    if callable(statistic):
        return statistic
    if isinstance(statistic, str):
        try:
            return _NAMED_STATISTICS[statistic]
        except KeyError:
            raise ValueError(
                f"Unknown statistic name {statistic!r}. "
                f"Available: {sorted(_NAMED_STATISTICS)} or pass a callable."
            ) from None
    raise TypeError(f"statistic must be a callable or str; got {type(statistic).__name__}")


# ─── Block size selectors ─────────────────────────────────────────────────


def _block_size_sqrt_n(n: int) -> int:
    return max(1, int(np.floor(np.sqrt(n))))


def _politis_romano_block_size(series: np.ndarray) -> int:
    """Politis & White (2004) automatic block length for moving-block bootstrap.

    Implements the lag-window / spectral approach in §3 of the paper:
        b_opt = ( 2 * g_hat^2 / D_hat )^(1/3) * n^(1/3)
    where g_hat estimates the sum of weighted autocovariances and D_hat the
    spectral density at frequency 0. We use the empirical bandwidth rule
    K_n = max(5, floor(sqrt(log10(n)))) for the lag cutoff and a flat-top
    Bartlett-style window. The result is clipped to [1, floor(n/2)].
    """
    series = np.ascontiguousarray(series, dtype=np.float64)
    n = series.shape[0]
    if n < 4:
        return max(1, n)

    x = series - series.mean()
    var = float(np.dot(x, x) / n)
    if var <= 0.0:
        # Constant series — autocovariance is zero, fall back to sqrt(n).
        return _block_size_sqrt_n(n)

    # Empirical bandwidth: small fraction of n.
    k_n = max(5, int(np.floor(np.sqrt(np.log10(max(n, 10))))))
    max_lag = min(n - 1, max(2 * k_n, int(np.ceil(np.log10(n))) * 4))

    # Sample autocovariances rho_k = gamma_k / gamma_0.
    rhos = np.empty(max_lag + 1, dtype=np.float64)
    rhos[0] = 1.0
    for k in range(1, max_lag + 1):
        rhos[k] = float(np.dot(x[: n - k], x[k:]) / n) / var

    # Politis-White flat-top lag window: w(k/M) where w is 1 for |x|<=1/2,
    # linearly decays to 0 at |x|=1, with M = 2 * m_hat. m_hat is chosen as
    # the smallest lag past which |rho_k| stays below 2*sqrt(log10(n)/n) for
    # K_n consecutive lags.
    threshold = 2.0 * np.sqrt(np.log10(n) / n)
    m_hat = max_lag
    consecutive = 0
    for k in range(1, max_lag + 1):
        if abs(rhos[k]) < threshold:
            consecutive += 1
            if consecutive >= k_n:
                m_hat = k - k_n + 1
                break
        else:
            consecutive = 0
    m_hat = max(1, m_hat)

    big_m = min(2 * m_hat, max_lag)

    # Compute g_hat = sum_{|k|<=M} w(k/M) * |k| * gamma_k
    # and    D_hat = (4/3) * (sum_{|k|<=M} w(k/M) * gamma_k)^2  (MBB constant)
    #              c.f. Politis & White (2004) Tab. 1, "Moving block".
    gamma = rhos * var
    g_sum = 0.0
    d_sum = 0.0
    for k in range(-big_m, big_m + 1):
        ak = abs(k)
        if big_m == 0:
            w = 1.0 if ak == 0 else 0.0
        else:
            ratio = ak / big_m
            if ratio <= 0.5:
                w = 1.0
            elif ratio < 1.0:
                w = 2.0 * (1.0 - ratio)
            else:
                w = 0.0
        gk = gamma[ak] if ak <= max_lag else 0.0
        g_sum += w * ak * gk
        d_sum += w * gk
    d_hat = (4.0 / 3.0) * d_sum * d_sum

    if d_hat <= 0.0 or g_sum == 0.0:
        return _block_size_sqrt_n(n)

    b_opt = (2.0 * g_sum * g_sum / d_hat) ** (1.0 / 3.0) * n ** (1.0 / 3.0)
    b_opt_int = int(np.clip(np.round(b_opt), 1, max(1, n // 2)))
    return b_opt_int


def _select_block_size(
    series: np.ndarray,
    block_size: int | None,
    block_size_method: BlockSizeMethod,
) -> int:
    if block_size is not None:
        if block_size < 1:
            raise ValueError(f"block_size must be >= 1; got {block_size}")
        return int(block_size)
    if block_size_method == "sqrt_n":
        return _block_size_sqrt_n(series.shape[0])
    if block_size_method == "politis_romano":
        return _politis_romano_block_size(series)
    raise ValueError(
        f"block_size_method must be 'sqrt_n' or 'politis_romano'; got {block_size_method!r}"
    )


# ─── Numba resampling kernel ──────────────────────────────────────────────


@njit(cache=True)
def _resample_blocks_njit(
    n: int,
    block_size: int,
    n_resamples: int,
    starts: np.ndarray,  # shape (n_resamples, n_blocks_per_resample) int64
) -> np.ndarray:
    """Build (n_resamples, n) int64 index arrays from block start positions.

    Each row tiles ``n_blocks_per_resample`` consecutive runs of length
    ``block_size`` starting at the given offsets, then truncates to length
    ``n``. Wrap-around is intentionally not used (Künsch MBB with truncation,
    not the circular variant) — block starts are pre-sampled in
    ``[0, n - block_size]`` to ensure every block fits without wrap.
    """
    n_blocks = starts.shape[1]
    out = np.empty((n_resamples, n), dtype=np.int64)
    for r in range(n_resamples):
        pos = 0
        for b in range(n_blocks):
            s = starts[r, b]
            for k in range(block_size):
                if pos >= n:
                    break
                out[r, pos] = s + k
                pos += 1
            if pos >= n:
                break
    return out


def _build_resamples(
    n: int,
    block_size: int,
    n_resamples: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Return (n_resamples, n) int64 index array of block-bootstrap resamples."""
    if block_size > n:
        block_size = n
    n_blocks = int(np.ceil(n / block_size))
    high = max(1, n - block_size + 1)  # exclusive upper bound for randint
    starts = rng.integers(low=0, high=high, size=(n_resamples, n_blocks), dtype=np.int64)
    return _resample_blocks_njit(n, block_size, n_resamples, starts)


# ─── Public API ───────────────────────────────────────────────────────────


def block_bootstrap_ci(
    series: np.ndarray,
    statistic: StatisticArg = "mean",
    *,
    block_size: int | None = None,
    block_size_method: BlockSizeMethod = "sqrt_n",
    n_resamples: int = 10_000,
    ci: float = 0.95,
    random_state: int | None = None,
) -> tuple[float, float, float]:
    """Moving-block bootstrap CI for ``statistic`` on autocorrelated ``series``.

    Returns ``(point_estimate, ci_lower, ci_upper)`` at the requested CI
    level (default 95%). Uses the percentile method on the bootstrap
    distribution of the statistic.

    Parameters
    ----------
    series : np.ndarray
        1-D float array (e.g. trade-PnL series, per-bar returns).
    statistic : callable or {'mean','median','sharpe','profit_factor'}
        Function reducing the array to a scalar, or a named shortcut.
    block_size : int | None
        Override block size. ``None`` (default) selects via
        ``block_size_method``.
    block_size_method : {'sqrt_n','politis_romano'}
        Method for automatic block-size selection. ``sqrt_n`` is the
        ``floor(sqrt(n))`` rule of thumb. ``politis_romano`` runs the
        Politis-White lag-window estimator.
    n_resamples : int
        Number of bootstrap resamples.
    ci : float
        CI level in (0, 1). 0.95 = 95% CI.
    random_state : int | None
        Seed for reproducible resampling.
    """
    series = np.ascontiguousarray(series, dtype=np.float64).ravel()
    n = series.shape[0]
    if n == 0:
        raise ValueError("series must be non-empty")
    if not (0.0 < ci < 1.0):
        raise ValueError(f"ci must be in (0, 1); got {ci}")
    if n_resamples < 1:
        raise ValueError(f"n_resamples must be >= 1; got {n_resamples}")

    stat_fn = _resolve_statistic(statistic)
    point = float(stat_fn(series))

    bs = _select_block_size(series, block_size, block_size_method)
    rng = np.random.default_rng(random_state)
    indices = _build_resamples(n, bs, n_resamples, rng)

    # Evaluate statistic on each row. Pure numpy loop (callable preserves
    # generality — vectorized fast paths possible for mean/median but the
    # extra branching isn't worth it for typical n_resamples=10k * n=2k).
    boot = np.empty(n_resamples, dtype=np.float64)
    for r in range(n_resamples):
        boot[r] = stat_fn(series[indices[r]])

    alpha = 1.0 - ci
    lo = float(np.quantile(boot, alpha / 2.0))
    hi = float(np.quantile(boot, 1.0 - alpha / 2.0))
    return point, lo, hi


def bootstrap_pvalue_vs_baseline(
    candidate: np.ndarray,
    baseline: np.ndarray,
    statistic: StatisticArg = "mean",
    *,
    block_size: int | None = None,
    block_size_method: BlockSizeMethod = "sqrt_n",
    n_resamples: int = 10_000,
    alternative: Alternative = "greater",
    random_state: int | None = None,
) -> float:
    """Block-bootstrap p-value for ``statistic(candidate) vs statistic(baseline)``.

    H0 (alternative='greater'): statistic(candidate) <= statistic(baseline).
    H0 (alternative='less'):    statistic(candidate) >= statistic(baseline).
    H0 (alternative='two-sided'): statistic(candidate) == statistic(baseline).

    If both inputs have the same length, **paired** block bootstrap is used:
    a single set of block-start positions is shared across the two series so
    common factor noise cancels (lower variance, tighter test). Otherwise
    independent block bootstraps are drawn for each.

    The returned p-value is the bootstrap fraction satisfying the null,
    floored at ``1 / (n_resamples + 1)`` so that a perfect-separation result
    never reports exactly zero.
    """
    candidate = np.ascontiguousarray(candidate, dtype=np.float64).ravel()
    baseline = np.ascontiguousarray(baseline, dtype=np.float64).ravel()
    if candidate.size == 0 or baseline.size == 0:
        raise ValueError("candidate and baseline must be non-empty")
    if n_resamples < 1:
        raise ValueError(f"n_resamples must be >= 1; got {n_resamples}")
    if alternative not in ("greater", "less", "two-sided"):
        raise ValueError(
            f"alternative must be 'greater', 'less', or 'two-sided'; got {alternative!r}"
        )

    stat_fn = _resolve_statistic(statistic)
    obs_diff = float(stat_fn(candidate)) - float(stat_fn(baseline))

    rng = np.random.default_rng(random_state)
    paired = candidate.size == baseline.size

    if paired:
        n = candidate.size
        bs = _select_block_size(candidate, block_size, block_size_method)
        indices = _build_resamples(n, bs, n_resamples, rng)
        diffs = np.empty(n_resamples, dtype=np.float64)
        for r in range(n_resamples):
            idx = indices[r]
            diffs[r] = stat_fn(candidate[idx]) - stat_fn(baseline[idx])
    else:
        bs_c = _select_block_size(candidate, block_size, block_size_method)
        bs_b = _select_block_size(baseline, block_size, block_size_method)
        idx_c = _build_resamples(candidate.size, bs_c, n_resamples, rng)
        idx_b = _build_resamples(baseline.size, bs_b, n_resamples, rng)
        diffs = np.empty(n_resamples, dtype=np.float64)
        for r in range(n_resamples):
            diffs[r] = stat_fn(candidate[idx_c[r]]) - stat_fn(baseline[idx_b[r]])

    # Centre the bootstrap diff distribution under H0 (mean-zero shift) and
    # compare the *centred* distribution against the *observed* obs_diff.
    centred = diffs - diffs.mean()

    if alternative == "greater":
        hits = int(np.sum(centred >= obs_diff))
    elif alternative == "less":
        hits = int(np.sum(centred <= obs_diff))
    else:  # two-sided
        hits = int(np.sum(np.abs(centred) >= abs(obs_diff)))

    # Floor at 1 / (n_resamples + 1) per Davison & Hinkley (1997) §4.2.
    return max(hits, 1) / (n_resamples + 1)


# ─── CLI for W6.b backend route ───────────────────────────────────────────


def _cli_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Block-bootstrap CI helper. Reads a 1-D series as JSON, emits a "
            "single JSON line with point estimate + CI bounds + diagnostics."
        ),
    )
    parser.add_argument(
        "--series-json",
        type=str,
        required=True,
        help='1-D array as JSON, e.g. "[0.1,-0.05,0.2]".',
    )
    parser.add_argument(
        "--statistic",
        type=str,
        default="mean",
        help=f"Named statistic. One of: {sorted(_NAMED_STATISTICS)}",
    )
    parser.add_argument("--block-size", type=int, default=None)
    parser.add_argument(
        "--block-size-method",
        type=str,
        default="sqrt_n",
        choices=["sqrt_n", "politis_romano"],
    )
    parser.add_argument("--n-resamples", type=int, default=10_000)
    parser.add_argument("--ci", type=float, default=0.95)
    parser.add_argument("--random-state", type=int, default=None)
    args = parser.parse_args(argv)

    try:
        raw = json.loads(args.series_json)
    except json.JSONDecodeError as exc:
        json.dump({"error": f"--series-json is not valid JSON: {exc}"}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    series = np.asarray(raw, dtype=np.float64).ravel()
    point, lo, hi = block_bootstrap_ci(
        series,
        statistic=args.statistic,
        block_size=args.block_size,
        block_size_method=args.block_size_method,
        n_resamples=args.n_resamples,
        ci=args.ci,
        random_state=args.random_state,
    )
    bs_used = _select_block_size(series, args.block_size, args.block_size_method)
    payload = {
        "point": point,
        "ci_lower": lo,
        "ci_upper": hi,
        "block_size": int(bs_used),
        "n_resamples": int(args.n_resamples),
    }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli_main())
