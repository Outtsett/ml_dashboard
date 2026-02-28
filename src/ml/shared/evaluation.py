"""
Evaluation Pipeline — Statistical validation of regime models.

SRP: Runs statistical tests and returns results as dicts. Does NOT write to DB.
OCP: New tests = new functions in this module, added to stage results dict.

Stage 1: Regime Quality Assessment (always runs, ~1 second)
Stage 2: Statistical Significance (opt-in, ~60-120 seconds with 1000 permutations)
"""

import numpy as np
from typing import Optional

from shared.protocol import emit_log, emit_metric


def run_stage1_regime_quality(
    features: np.ndarray,        # (T, D) feature matrix
    assignments: np.ndarray,     # (T,) regime assignments
    close: np.ndarray,           # (T,) close prices
    iteration: int = 0,
) -> dict:
    """
    Stage 1: Regime Quality Assessment.

    Tests: silhouette, calinski-harabasz, davies-bouldin,
           return separation, volatility separation, min duration.

    Returns dict of {test_name: {value, passed, p_value, details}}.
    """
    # Lazy imports — these are heavy and only needed during evaluation
    from scipy import stats
    from sklearn.metrics import silhouette_score, calinski_harabasz_score, davies_bouldin_score

    emit_log("Running Stage 1: Regime Quality Assessment")
    results = {}
    K = int(assignments.max()) + 1
    log_returns = np.diff(np.log(np.maximum(close, 1e-10)))
    log_returns = np.concatenate([[0.0], log_returns])

    # ── Silhouette Score ──
    try:
        if K > 1 and K < len(assignments):
            sil = float(silhouette_score(
                features, assignments,
                sample_size=min(5000, len(features)),
            ))
        else:
            sil = 0.0
        passed = sil > 0.2
        results["silhouette_score"] = {
            "value": round(sil, 4), "passed": passed, "p_value": None,
        }
        emit_metric("eval_silhouette", sil, iteration)
    except Exception as e:
        results["silhouette_score"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Calinski-Harabasz Index ──
    try:
        if K > 1:
            ch = float(calinski_harabasz_score(features, assignments))
        else:
            ch = 0.0
        results["calinski_harabasz"] = {
            "value": round(ch, 2), "passed": ch > 10, "p_value": None,
        }
        emit_metric("eval_calinski_harabasz", ch, iteration)
    except Exception as e:
        results["calinski_harabasz"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Davies-Bouldin Index ──
    try:
        if K > 1:
            db_idx = float(davies_bouldin_score(features, assignments))
        else:
            db_idx = 999.0
        passed = db_idx < 1.5
        results["davies_bouldin"] = {
            "value": round(db_idx, 4), "passed": passed, "p_value": None,
        }
        emit_metric("eval_davies_bouldin", db_idx, iteration)
    except Exception as e:
        results["davies_bouldin"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Regime Return Separation (Welch's t-test on pairwise log returns) ──
    try:
        regime_rets = {k: log_returns[assignments == k]
                       for k in range(K) if (assignments == k).sum() > 2}
        pairs_tested = 0
        pairs_significant = 0
        min_p = 1.0

        keys = sorted(regime_rets.keys())
        for i, k1 in enumerate(keys):
            for k2 in keys[i + 1:]:
                _, p_val = stats.ttest_ind(
                    regime_rets[k1], regime_rets[k2], equal_var=False,
                )
                pairs_tested += 1
                if p_val < 0.05:
                    pairs_significant += 1
                min_p = min(min_p, float(p_val))

        passed = pairs_significant >= 2 if pairs_tested >= 3 else pairs_significant >= 1
        results["return_separation"] = {
            "value": pairs_significant, "passed": passed,
            "p_value": round(min_p, 6),
            "details": {"pairs_tested": pairs_tested, "pairs_significant": pairs_significant},
        }
        emit_metric("eval_return_separation_pairs", pairs_significant, iteration)
    except Exception as e:
        results["return_separation"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Regime Volatility Separation (Levene's test) ──
    try:
        groups = [log_returns[assignments == k]
                  for k in range(K) if (assignments == k).sum() > 2]
        if len(groups) >= 2:
            stat, p_val = stats.levene(*groups)
            passed = float(p_val) < 0.05
        else:
            stat, p_val, passed = 0.0, 1.0, False
        results["volatility_separation"] = {
            "value": round(float(stat), 4), "passed": passed,
            "p_value": round(float(p_val), 6),
        }
        emit_metric("eval_volatility_levene_p", float(p_val), iteration)
    except Exception as e:
        results["volatility_separation"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Minimum Regime Duration ──
    try:
        durations = _regime_run_lengths(assignments)
        median_dur = float(np.median(durations)) if durations else 0
        passed = median_dur > 5
        results["min_duration"] = {
            "value": round(median_dur, 1), "passed": passed, "p_value": None,
            "details": {
                "median": round(median_dur, 1),
                "mean": round(float(np.mean(durations)), 1) if durations else 0,
                "count": len(durations),
            },
        }
        emit_metric("eval_median_duration", median_dur, iteration)
    except Exception as e:
        results["min_duration"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    return results


def run_stage2_significance(
    features: np.ndarray,
    assignments: np.ndarray,
    close: np.ndarray,
    n_permutations: int = 1000,
    n_bootstrap: int = 100,
    iteration: int = 0,
) -> dict:
    """
    Stage 2: Statistical Significance.

    Expensive — opt-in via --run-significance-tests CLI flag.
    Takes ~60-120s with n_permutations=1000.
    """
    from sklearn.metrics import silhouette_score

    emit_log(f"Running Stage 2: Significance Tests (n_perm={n_permutations}, n_boot={n_bootstrap})")
    results = {}
    K = int(assignments.max()) + 1

    # ── Permutation Test ──
    try:
        emit_log("Permutation test: shuffling regime labels to build null distribution...")
        random_scores = []
        sample_n = min(2000, len(features))
        for i in range(n_permutations):
            shuffled = np.random.permutation(assignments)
            if K > 1 and K < len(shuffled):
                score = float(silhouette_score(features, shuffled, sample_size=sample_n))
            else:
                score = 0.0
            random_scores.append(score)
            if (i + 1) % 100 == 0:
                emit_metric("eval_permutation_progress", (i + 1) / n_permutations * 100, iteration)

        real_score = float(silhouette_score(
            features, assignments, sample_size=min(5000, len(features)),
        )) if K > 1 else 0.0
        p_value = float(np.mean(np.array(random_scores) >= real_score))
        passed = p_value < 0.05

        results["permutation_test"] = {
            "value": round(real_score, 4), "passed": passed,
            "p_value": round(p_value, 4),
            "details": {
                "n_permutations": n_permutations,
                "real_score": round(real_score, 4),
                "random_mean": round(float(np.mean(random_scores)), 4),
                "random_std": round(float(np.std(random_scores)), 4),
            },
        }
        emit_metric("eval_permutation_p", p_value, iteration)
    except Exception as e:
        results["permutation_test"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Bootstrap Confidence Interval ──
    try:
        emit_log("Bootstrap CI: resampling to measure assignment stability...")
        boot_scores = []
        T = len(assignments)
        for i in range(n_bootstrap):
            idx = np.random.choice(T, size=T, replace=True)
            if K > 1 and K < len(idx):
                score = float(silhouette_score(
                    features[idx], assignments[idx],
                    sample_size=min(2000, len(idx)),
                ))
            else:
                score = 0.0
            boot_scores.append(score)

        ci_low = float(np.percentile(boot_scores, 2.5))
        ci_high = float(np.percentile(boot_scores, 97.5))
        ci_mean = float(np.mean(boot_scores))

        results["bootstrap_ci"] = {
            "value": round(ci_mean, 4),
            "passed": ci_low > 0.0,  # 95% CI above 0 means stable
            "p_value": None,
            "details": {
                "ci_low": round(ci_low, 4),
                "ci_high": round(ci_high, 4),
                "ci_mean": round(ci_mean, 4),
                "n_bootstrap": n_bootstrap,
            },
        }
        emit_metric("eval_bootstrap_ci_low", ci_low, iteration)
        emit_metric("eval_bootstrap_ci_high", ci_high, iteration)
    except Exception as e:
        results["bootstrap_ci"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    return results


def compute_evaluation_grade(stage1: dict, stage2: Optional[dict] = None) -> str:
    """
    Compute composite evaluation grade A-F.

    A: All Stage 1 pass + Stage 2 permutation p < 0.01
    B: All Stage 1 pass + Stage 2 permutation p < 0.05
    C: Most Stage 1 pass (>=60%)
    D: Some Stage 1 pass (>0%)
    F: No tests pass or cluster quality below random
    """
    s1_tests = [v.get("passed", False) for v in stage1.values()]
    s1_total = len(s1_tests)
    if s1_total == 0:
        return "F"

    s1_pass_rate = sum(s1_tests) / s1_total

    perm_p = None
    if stage2 and "permutation_test" in stage2:
        perm_p = stage2["permutation_test"].get("p_value")

    if s1_pass_rate == 1.0 and perm_p is not None and perm_p < 0.01:
        return "A"
    elif s1_pass_rate == 1.0 and perm_p is not None and perm_p < 0.05:
        return "B"
    elif s1_pass_rate >= 0.6:
        return "C"
    elif s1_pass_rate > 0:
        return "D"
    else:
        return "F"


def _regime_run_lengths(assignments: np.ndarray) -> list:
    """Compute list of consecutive run lengths across all regimes."""
    if len(assignments) == 0:
        return []
    runs = []
    current = int(assignments[0])
    length = 1
    for i in range(1, len(assignments)):
        if int(assignments[i]) == current:
            length += 1
        else:
            runs.append(length)
            current = int(assignments[i])
            length = 1
    runs.append(length)
    return runs
