"""
Parity fixture for src/shared/regression — the price-vs-variable scatter tab.

Every statistic the TypeScript module reports is computed here by the
reference implementations (statsmodels OLS / OLSInfluence / HAC, scipy.stats)
on fixed-seed datasets, and written to tests/fixtures/regression-parity.json.
tests/shared/regression.test.ts asserts the TypeScript matches.

Run:  .venv/Scripts/python.exe scripts/regression_parity_fixture.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import statsmodels.api as sm
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from statsmodels.nonparametric.smoothers_lowess import lowess
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.outliers_influence import OLSInfluence
from statsmodels.stats.stattools import durbin_watson

SEED = 20260923
BAND_SAMPLES = 48
CONFIDENCE = 0.95
OUTLIER_FAMILY_ALPHA = 0.05
OUTPUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "regression-parity.json"


def newey_west_lag(n: int) -> int:
    return int(math.floor(4 * (n / 100) ** (2 / 9)))


def midrank_spearman(x: np.ndarray, y: np.ndarray) -> float:
    return float(stats.spearmanr(x, y).statistic)


def eight_numbers(values: np.ndarray) -> dict:
    return {
        "count": int(values.size),
        "mean": float(np.mean(values)),
        "median": float(np.median(values)),
        "standardDeviation": float(np.std(values, ddof=1)),
        "skewness": float(stats.skew(values, bias=False)),
        "kurtosis": float(stats.kurtosis(values, bias=False)),
        "percentile25": float(np.quantile(values, 0.25)),
        "percentile75": float(np.quantile(values, 0.75)),
        "minimum": float(np.min(values)),
        "maximum": float(np.max(values)),
    }


def quantile_buckets(x: np.ndarray, y: np.ndarray, bucket_count: int) -> dict | None:
    # Up to `bucket_count` equal-count groups over x sorted ascending (ties in
    # input order). A cut that lands inside a run of equal x moves to the
    # nearer end of that run (the start on a tie), or the other end if the
    # nearer one is unusable, so a tied value never straddles two groups — the
    # same rule the TypeScript uses.
    order = np.argsort(x, kind="stable")
    sorted_x = x[order]
    n = x.size
    sizes = [len(part) for part in np.array_split(np.arange(n), bucket_count)]
    cuts = []
    position = 0
    for size in sizes[:-1]:
        position += size
        start = position
        while 0 < start < n and sorted_x[start] == sorted_x[start - 1]:
            start -= 1
        end = position
        while 0 < end < n and sorted_x[end] == sorted_x[end - 1]:
            end += 1
        preferred = [start, end] if position - start <= end - position else [end, start]
        for cut in preferred:
            if 0 < cut < n and (not cuts or cut > cuts[-1]):
                cuts.append(cut)
                break
    bounds = [0, *cuts, n]
    groups = [order[start:end] for start, end in zip(bounds[:-1], bounds[1:]) if end > start]
    if len(groups) < 2:
        return None
    buckets = []
    for group in groups:
        group_y = y[group]
        count = group_y.size
        mean_y = float(np.mean(group_y))
        standard_error = float(np.std(group_y, ddof=1) / math.sqrt(count))
        critical = float(stats.t.ppf(1 - (1 - CONFIDENCE) / 2, count - 1))
        buckets.append({
            "count": int(count),
            "minimumX": float(np.min(x[group])),
            "maximumX": float(np.max(x[group])),
            "meanY": mean_y,
            "standardError": standard_error,
            "lower": mean_y - critical * standard_error,
            "upper": mean_y + critical * standard_error,
        })
    top = y[groups[-1]]
    bottom = y[groups[0]]
    welch = stats.ttest_ind(top, bottom, equal_var=False)
    return {
        "buckets": buckets,
        "spread": float(np.mean(top) - np.mean(bottom)),
        "spreadTStatistic": float(welch.statistic),
        "spreadPValue": float(welch.pvalue),
    }


def reference_case(name: str, x: np.ndarray, y: np.ndarray) -> dict:
    n = x.size
    design = sm.add_constant(x)
    fit = sm.OLS(y, design).fit()
    influence = OLSInfluence(fit)
    lag = newey_west_lag(n)
    hac = sm.OLS(y, design).fit(cov_type="HAC", cov_kwds={"maxlags": lag}, use_t=True)
    hac_uncorrected = sm.OLS(y, design).fit(
        cov_type="HAC", cov_kwds={"maxlags": lag, "use_correction": False}, use_t=True,
    )

    residuals = np.asarray(fit.resid)
    grid = np.linspace(float(np.min(x)), float(np.max(x)), BAND_SAMPLES)
    frame = fit.get_prediction(sm.add_constant(grid, has_constant="add")).summary_frame(alpha=1 - CONFIDENCE)
    lag_one = float(np.sum(residuals[1:] * residuals[:-1]) / np.sum(residuals ** 2))
    confidence_interval = np.asarray(fit.conf_int(alpha=1 - CONFIDENCE))

    return {
        "name": name,
        "x": x.tolist(),
        "y": y.tolist(),
        "expected": {
            "n": int(n),
            "intercept": float(fit.params[0]),
            "slope": float(fit.params[1]),
            "interceptStandardError": float(fit.bse[0]),
            "slopeStandardError": float(fit.bse[1]),
            "slopeTStatistic": float(fit.tvalues[1]),
            "slopePValue": float(fit.pvalues[1]),
            "slopeConfidenceInterval": [float(confidence_interval[1, 0]), float(confidence_interval[1, 1])],
            "rSquared": float(fit.rsquared),
            "adjustedRSquared": float(fit.rsquared_adj),
            "pearsonCorrelation": float(stats.pearsonr(x, y).statistic),
            "spearmanCorrelation": midrank_spearman(x, y),
            "residualStandardError": float(math.sqrt(fit.scale)),
            "degreesOfFreedom": int(fit.df_resid),
            "tCritical": float(stats.t.ppf(1 - (1 - CONFIDENCE) / 2, n - 2)),
            "durbinWatson": float(durbin_watson(residuals)),
            "residualLagOneAutocorrelation": lag_one,
            "neweyWestLag": lag,
            "slopeStandardErrorNeweyWest": float(hac.bse[1]),
            "slopeTStatisticNeweyWest": float(hac.tvalues[1]),
            "slopePValueNeweyWest": float(hac.pvalues[1]),
            "slopeStandardErrorNeweyWestUncorrected": float(hac_uncorrected.bse[1]),
            "fitted": np.asarray(fit.fittedvalues).tolist(),
            "residuals": residuals.tolist(),
            "leverage": np.asarray(influence.hat_matrix_diag).tolist(),
            "studentizedInternal": np.asarray(influence.resid_studentized_internal).tolist(),
            "studentizedExternal": np.asarray(influence.resid_studentized_external).tolist(),
            "cookDistance": np.asarray(influence.cooks_distance[0]).tolist(),
            "verticalOutlierCutoff": float(stats.t.ppf(1 - OUTLIER_FAMILY_ALPHA / (2 * n), n - 3)),
            "band": {
                "x": grid.tolist(),
                "fitted": np.asarray(frame["mean"]).tolist(),
                "meanLower": np.asarray(frame["mean_ci_lower"]).tolist(),
                "meanUpper": np.asarray(frame["mean_ci_upper"]).tolist(),
                "predictionLower": np.asarray(frame["obs_ci_lower"]).tolist(),
                "predictionUpper": np.asarray(frame["obs_ci_upper"]).tolist(),
            },
            "residualSummary": eight_numbers(residuals),
            "quintiles": quantile_buckets(x, y, 5),
        },
    }


def build_cases(generator: np.random.Generator) -> list[dict]:
    cases = []

    x = generator.normal(0, 1, 400)
    y = 3 + 1.7 * x + generator.normal(0, 2, 400)
    cases.append(reference_case("linear_independent_noise", x, y))

    # Two independent random walks: the Granger-Newbold spurious regression.
    x = np.cumsum(generator.normal(0, 1, 1500))
    y = 20000 + np.cumsum(generator.normal(0, 5, 1500))
    cases.append(reference_case("independent_random_walks", x, y))

    # Heavy-tailed noise, five vertical outliers and two high-leverage points.
    x = generator.normal(10, 3, 300)
    y = -4 + 0.6 * x + stats.t.rvs(3, size=300, random_state=generator)
    y[[17, 88, 140, 201, 260]] += np.array([25.0, -30.0, 22.0, -27.0, 35.0])
    x[[5, 6]] = [40.0, 45.0]
    y[[5, 6]] = [2.0, 1.0]
    cases.append(reference_case("heavy_tails_with_outliers", x, y))

    # Integer data, so both variables carry ties (midrank Spearman).
    x = generator.integers(0, 8, 60).astype(float)
    y = np.round(2 + 0.5 * x + generator.normal(0, 1.5, 60))
    cases.append(reference_case("tied_integers", x, y))

    # Autocorrelated errors around a real relationship (AR(1), phi = 0.8).
    n = 2500
    x = generator.normal(0, 1, n)
    errors = np.zeros(n)
    shocks = generator.normal(0, 1, n)
    for index in range(1, n):
        errors[index] = 0.8 * errors[index - 1] + shocks[index]
    y = 0.25 * x + errors
    cases.append(reference_case("autocorrelated_errors", x, y))
    return cases


def lowess_cases(generator: np.random.Generator) -> list[dict]:
    # LOWESS with no robustness pass, evaluated on an even grid - what the
    # scatter's local-trend curve draws. Continuous x only: statsmodels sorts
    # with an unstable argsort, so tied x at a window edge is order-dependent.
    cases = []
    # A run of tied x wider than the window: statsmodels returns NaN where
    # every neighbour sits at x0 (radius 0); the TypeScript must too.
    tied_x = np.concatenate([np.full(15, 5.0), np.linspace(0.0, 4.5, 5), np.linspace(5.5, 10.0, 5)])
    tied_y = np.sin(tied_x) + np.linspace(-0.3, 0.3, tied_x.size)
    tied_grid = np.linspace(0.0, 10.0, 41)
    cases.append({
        "name": "tied_run_wider_than_window",
        "x": tied_x.tolist(),
        "y": tied_y.tolist(),
        "span": 8 / tied_x.size,
        "grid": tied_grid.tolist(),
        "fitted": [None if not np.isfinite(v) else float(v) for v in lowess(tied_y, tied_x, frac=8 / tied_x.size, it=0, delta=0.0, xvals=tied_grid)],
    })
    specs = [
        ("sine_bend", 600, 0.3, lambda x: np.sin(x) * 2 + 0.2 * x, 0.5),
        ("heteroskedastic", 900, 0.25, lambda x: 0.5 * x, None),
        ("small_sample_wide_span", 40, 0.6, lambda x: x ** 2 / 4, 0.8),
    ]
    for name, n, frac, shape, noise in specs:
        x = generator.uniform(-5, 5, n)
        if noise is None:
            y = shape(x) + generator.normal(0, 1, n) * (0.3 + 0.4 * np.abs(x))
        else:
            y = shape(x) + generator.normal(0, noise, n)
        grid = np.linspace(x.min(), x.max(), 60)
        fitted = lowess(y, x, frac=frac, it=0, delta=0.0, xvals=grid)
        cases.append({
            "name": name,
            "x": x.tolist(),
            "y": y.tolist(),
            "span": frac,
            "grid": grid.tolist(),
            "fitted": [None if not np.isfinite(v) else float(v) for v in fitted],
        })
    return cases


def kmeans_cases(generator: np.random.Generator) -> list[dict]:
    # Lloyd's iterations from fixed starting centres, and the silhouette of the
    # result - scikit-learn is the reference for both.
    cases = []
    blobs = np.concatenate([
        generator.normal([0, 0], 0.6, (120, 2)),
        generator.normal([4, 1], 0.8, (90, 2)),
        generator.normal([1, 5], 0.5, (70, 2)),
    ])
    diffuse = generator.normal(0, 1, (250, 2))
    for name, points, k in [("three_blobs", blobs, 3), ("diffuse_cloud", diffuse, 4)]:
        init = points[[3, 50, 150, 200][:k]]
        model = KMeans(n_clusters=k, init=init, n_init=1, algorithm="lloyd", tol=0.0, max_iter=300).fit(points)
        cases.append({
            "name": name,
            "x": points[:, 0].tolist(),
            "y": points[:, 1].tolist(),
            "initialX": init[:, 0].tolist(),
            "initialY": init[:, 1].tolist(),
            "labels": model.labels_.tolist(),
            "inertia": float(model.inertia_),
            "centersX": model.cluster_centers_[:, 0].tolist(),
            "centersY": model.cluster_centers_[:, 1].tolist(),
            "silhouette": float(silhouette_score(points, model.labels_)),
        })
    return cases


def histogram_cases(generator: np.random.Generator) -> list[dict]:
    cases = []
    for name, values in [
        ("normal", generator.normal(3, 2, 777)),
        ("heavy_tailed", stats.t.rvs(2, size=1500, random_state=generator)),
    ]:
        edges = np.histogram_bin_edges(values, bins="fd")
        cases.append({"name": name, "values": values.tolist(), "binCount": int(edges.size - 1), "rule": "fd"})
    # IQR 0: numpy's "fd" collapses to one bin; the TypeScript falls back to Sturges.
    flag = np.where(np.arange(500) % 25 == 0, 1.0, 0.0)
    cases.append({
        "name": "mostly_zero_flag",
        "values": flag.tolist(),
        "binCount": int(np.histogram_bin_edges(flag, bins="sturges").size - 1),
        "rule": "sturges",
    })
    return cases


def student_table() -> dict:
    quantiles = []
    for degrees in [1, 2, 3, 4, 7, 10, 30, 100, 998, 4998, 19998]:
        for probability in [0.5, 0.6, 0.9, 0.95, 0.975, 0.995, 0.9995, 1 - 1e-6, 1 - 2.5e-7, 0.025, 1e-5]:
            quantiles.append({
                "probability": probability,
                "degreesOfFreedom": degrees,
                "quantile": float(stats.t.ppf(probability, degrees)),
            })
    upper_tails = []
    for degrees in [1, 2, 3, 5, 12, 50, 500, 5000, 20000]:
        for value in [-3.0, -0.4, 0.0, 0.3, 1.0, 1.96, 2.5, 4.0, 7.5, 15.0, 40.0]:
            upper_tails.append({
                "t": value,
                "degreesOfFreedom": degrees,
                "upperTail": float(stats.t.sf(value, degrees)),
            })
    return {"quantiles": quantiles, "upperTails": upper_tails}


def main() -> None:
    generator = np.random.default_rng(SEED)
    cases = build_cases(generator)
    p_values = [0.001, 0.2, 0.03, 0.04, 0.5, 0.0001, 0.049, 0.9, 0.012, 0.3]
    fixture = {
        "generatedBy": "scripts/regression_parity_fixture.py",
        "seed": SEED,
        "confidenceLevel": CONFIDENCE,
        "outlierFamilyAlpha": OUTLIER_FAMILY_ALPHA,
        "bandSamples": BAND_SAMPLES,
        "cases": cases,
        "student": student_table(),
        "lowess": lowess_cases(generator),
        "kMeans": kmeans_cases(generator),
        "histograms": histogram_cases(generator),
        "benjaminiHochberg": {
            "pValues": p_values,
            "qValues": multipletests(p_values, method="fdr_bh")[1].tolist(),
        },
    }
    OUTPUT.write_text(json.dumps(fixture), encoding="utf-8")
    print(f"wrote {OUTPUT} ({len(cases)} cases)")
    for case in cases:
        expected = case["expected"]
        print(
            f"  {case['name']}: n={expected['n']} slope={expected['slope']:.6g} "
            f"R2={expected['rSquared']:.4g} DW={expected['durbinWatson']:.4g} "
            f"HAC se={expected['slopeStandardErrorNeweyWest']:.6g} "
            f"(uncorrected {expected['slopeStandardErrorNeweyWestUncorrected']:.6g})"
        )


if __name__ == "__main__":
    main()
