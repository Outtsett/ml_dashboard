"""
Evaluation Pipeline — Statistical validation of regime models.

SRP: Runs statistical tests and returns results as dicts. Does NOT write to DB.
OCP: New tests = new functions in this module, added to stage results dict.

Stage 1: Regime Quality Assessment (always runs, ~1 second)
Stage 2: Statistical Significance (opt-in, ~60-120 seconds with 1000 permutations)
Stage 3: Out-of-Sample Validation (confidence calibration, return separation, transitions, drift)
Stage 4: Regime-Conditioned Performance (Sharpe, long/short, transition returns, stability premium, drawdown)
Stage 5: Benchmarking (vs buy-and-hold, vs SMA crossover, information ratio)
"""

from typing import Optional

import numpy as np

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
    from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score

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


def run_stage3_oos_validation(
    train_assignments: np.ndarray,   # (T_train,) regime ids
    test_assignments: np.ndarray,    # (T_test,) regime ids
    train_close: np.ndarray,         # (T_train,) prices
    test_close: np.ndarray,          # (T_test,) prices
    train_confidence: np.ndarray,    # (T_train,) confidence values
    test_confidence: np.ndarray,     # (T_test,) confidence values
    transition_matrix: np.ndarray,   # (K, K) transition probabilities
    iteration: int = 0,
) -> dict:
    """
    Stage 3: Out-of-Sample Validation.

    Tests: confidence calibration, return separation (OOS), transition prediction, distribution drift.

    Returns dict of {test_name: {value, passed, p_value, details}}.
    """
    from scipy import stats

    emit_log("Running Stage 3: Out-of-Sample Validation")
    results = {}

    # ── OOS Confidence Calibration ──
    try:
        train_mean_conf = float(np.mean(train_confidence))
        test_mean_conf = float(np.mean(test_confidence))
        ratio = test_mean_conf / max(train_mean_conf, 1e-10)
        passed = test_mean_conf >= 0.7 * train_mean_conf
        results["oos_confidence_calibration"] = {
            "value": round(ratio, 4), "passed": passed, "p_value": None,
            "details": {
                "train_mean_confidence": round(train_mean_conf, 4),
                "test_mean_confidence": round(test_mean_conf, 4),
                "threshold": round(0.7 * train_mean_conf, 4),
            },
        }
        emit_metric("eval_oos_confidence_ratio", ratio, iteration)
    except Exception as e:
        results["oos_confidence_calibration"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── OOS Return Separation (Welch's t-test on TEST data per-regime returns) ──
    try:
        test_log_returns = np.diff(np.log(np.maximum(test_close, 1e-10)))
        test_log_returns = np.concatenate([[0.0], test_log_returns])

        K = int(max(train_assignments.max(), test_assignments.max())) + 1
        regime_rets = {k: test_log_returns[test_assignments == k]
                       for k in range(K) if (test_assignments == k).sum() > 2}

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

        passed = pairs_significant >= 1
        results["oos_return_separation"] = {
            "value": pairs_significant, "passed": passed,
            "p_value": round(min_p, 6),
            "details": {"pairs_tested": pairs_tested, "pairs_significant": pairs_significant},
        }
        emit_metric("eval_oos_return_sep_pairs", pairs_significant, iteration)
    except Exception as e:
        results["oos_return_separation"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Regime Transition Prediction ──
    try:
        T_test = len(test_assignments)
        predicted_transitions = 0
        actual_transitions = 0
        correct_predictions = 0

        if transition_matrix is not None and T_test > 1:
            K_tm = transition_matrix.shape[0]
            for t in range(T_test - 1):
                current_regime = int(test_assignments[t])
                next_regime = int(test_assignments[t + 1])
                actually_changed = current_regime != next_regime

                # Predict transition if P(stay) < 0.5 (i.e., P(switch) > 0.5)
                if current_regime < K_tm:
                    switch_prob = 1.0 - float(transition_matrix[current_regime, current_regime])
                    if switch_prob > 0.5:
                        predicted_transitions += 1
                        if actually_changed:
                            correct_predictions += 1
                if actually_changed:
                    actual_transitions += 1

        precision = correct_predictions / max(predicted_transitions, 1)
        recall = correct_predictions / max(actual_transitions, 1)
        passed = precision > 0.3
        results["regime_transition_prediction"] = {
            "value": round(precision, 4), "passed": passed, "p_value": None,
            "details": {
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "predicted_transitions": predicted_transitions,
                "actual_transitions": actual_transitions,
                "correct_predictions": correct_predictions,
            },
        }
        emit_metric("eval_transition_precision", precision, iteration)
    except Exception as e:
        results["regime_transition_prediction"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Regime Distribution Drift (chi-squared on train vs test proportions) ──
    try:
        K = int(max(train_assignments.max(), test_assignments.max())) + 1
        train_counts = np.array([np.sum(train_assignments == k) for k in range(K)], dtype=np.float64)
        test_counts = np.array([np.sum(test_assignments == k) for k in range(K)], dtype=np.float64)

        # Expected test counts if same distribution as train
        train_total = float(train_counts.sum())
        test_total = float(test_counts.sum())
        if train_total > 0 and test_total > 0:
            train_proportions = train_counts / train_total
            expected_test = train_proportions * test_total
            # Ensure all expected values > 0 for chi-squared
            expected_test = np.maximum(expected_test, 1e-10)
            chi2_stat, p_val = stats.chisquare(test_counts, f_exp=expected_test)
            passed = float(p_val) > 0.05  # NOT significantly different = stable
        else:
            chi2_stat, p_val, passed = 0.0, 1.0, True

        results["regime_distribution_drift"] = {
            "value": round(float(chi2_stat), 4), "passed": passed,
            "p_value": round(float(p_val), 6),
            "details": {
                "train_proportions": [round(float(x), 4) for x in train_counts / max(train_total, 1)],
                "test_proportions": [round(float(x), 4) for x in test_counts / max(test_total, 1)],
            },
        }
        emit_metric("eval_distribution_drift_p", float(p_val), iteration)
    except Exception as e:
        results["regime_distribution_drift"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    return results


def run_stage4_conditioned_performance(
    assignments: np.ndarray,    # (T,) full dataset assignments
    close: np.ndarray,          # (T,) close prices
    confidence: np.ndarray,     # (T,) confidence values (can be None -> default 0.5)
    split_idx: int,             # index where test period starts
    iteration: int = 0,
) -> dict:
    """
    Stage 4: Regime-Conditioned Performance.

    Tests: per-regime Sharpe, long-bull/short-bear strategy, transition returns,
           stability premium, max regime drawdown.

    Returns dict of {test_name: {value, passed, p_value, details}}.
    """
    emit_log("Running Stage 4: Regime-Conditioned Performance")
    results = {}
    T = len(assignments)
    K = int(assignments.max()) + 1

    if confidence is None:
        confidence = np.full(T, 0.5)

    log_returns = np.diff(np.log(np.maximum(close, 1e-10)))
    log_returns = np.concatenate([[0.0], log_returns])

    # ── Regime Sharpe ──
    try:
        regime_sharpes = {}
        for k in range(K):
            mask = assignments == k
            if mask.sum() > 10:
                rets = log_returns[mask]
                sharpe = _annualized_sharpe(rets)
                regime_sharpes[k] = round(sharpe, 4)
            else:
                regime_sharpes[k] = 0.0

        best_sharpe = max(regime_sharpes.values()) if regime_sharpes else 0.0
        passed = best_sharpe > 0.5
        results["regime_sharpe"] = {
            "value": round(best_sharpe, 4), "passed": passed, "p_value": None,
            "details": {f"regime_{k}": v for k, v in regime_sharpes.items()},
        }
        emit_metric("eval_best_regime_sharpe", best_sharpe, iteration)
    except Exception as e:
        results["regime_sharpe"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Long Bull / Short Bear Strategy ──
    try:
        # Identify bull (highest avg return) and bear (lowest avg return) regimes
        regime_avg_ret = {}
        for k in range(K):
            mask = assignments == k
            if mask.sum() > 0:
                regime_avg_ret[k] = float(np.mean(log_returns[mask]))
            else:
                regime_avg_ret[k] = 0.0

        bull_regime = max(regime_avg_ret, key=regime_avg_ret.get)
        bear_regime = min(regime_avg_ret, key=regime_avg_ret.get)

        # Position: +1 in bull, -1 in bear, 0 otherwise
        positions = np.zeros(T)
        positions[assignments == bull_regime] = 1.0
        positions[assignments == bear_regime] = -1.0

        # Cumulative return on TEST portion
        test_positions = positions[split_idx:]
        test_returns = log_returns[split_idx:]
        strategy_returns = test_positions * test_returns
        cumulative_return = float(np.sum(strategy_returns))
        passed = cumulative_return > 0.0

        results["long_bull_short_bear"] = {
            "value": round(cumulative_return, 6), "passed": passed, "p_value": None,
            "details": {
                "bull_regime": int(bull_regime),
                "bear_regime": int(bear_regime),
                "bull_avg_return": round(regime_avg_ret[bull_regime], 6),
                "bear_avg_return": round(regime_avg_ret[bear_regime], 6),
                "test_bars": len(test_returns),
            },
        }
        emit_metric("eval_long_bull_short_bear", cumulative_return, iteration)
    except Exception as e:
        results["long_bull_short_bear"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Transition Returns (avg 5-bar forward return after regime transitions) ──
    try:
        forward_window = 5
        transition_rets = []
        for t in range(T - forward_window):
            if t > 0 and assignments[t] != assignments[t - 1]:
                fwd_ret = float(np.sum(log_returns[t:t + forward_window]))
                transition_rets.append(fwd_ret)

        if len(transition_rets) > 0:
            mean_transition_ret = float(np.mean(transition_rets))
            passed = abs(mean_transition_ret) > 0.001
        else:
            mean_transition_ret = 0.0
            passed = False

        results["transition_returns"] = {
            "value": round(mean_transition_ret, 6), "passed": passed, "p_value": None,
            "details": {
                "n_transitions": len(transition_rets),
                "forward_window": forward_window,
                "mean_forward_return": round(mean_transition_ret, 6),
                "std_forward_return": round(float(np.std(transition_rets)), 6) if transition_rets else 0.0,
            },
        }
        emit_metric("eval_transition_returns", mean_transition_ret, iteration)
    except Exception as e:
        results["transition_returns"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Stability Premium (high-confidence vs low-confidence bar returns) ──
    try:
        high_conf_mask = confidence > 0.7
        low_conf_mask = confidence <= 0.7

        high_abs_returns = np.abs(log_returns[high_conf_mask]) if high_conf_mask.sum() > 0 else np.array([0.0])
        low_abs_returns = np.abs(log_returns[low_conf_mask]) if low_conf_mask.sum() > 0 else np.array([0.0])

        high_mean = float(np.mean(high_abs_returns))
        low_mean = float(np.mean(low_abs_returns))
        passed = high_mean > low_mean

        results["stability_premium"] = {
            "value": round(high_mean - low_mean, 6), "passed": passed, "p_value": None,
            "details": {
                "high_conf_mean_abs_return": round(high_mean, 6),
                "low_conf_mean_abs_return": round(low_mean, 6),
                "high_conf_bars": int(high_conf_mask.sum()),
                "low_conf_bars": int(low_conf_mask.sum()),
            },
        }
        emit_metric("eval_stability_premium", high_mean - low_mean, iteration)
    except Exception as e:
        results["stability_premium"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Max Regime Drawdown (report only — always passes) ──
    try:
        regime_drawdowns = {}
        for k in range(K):
            mask = assignments == k
            if mask.sum() > 1:
                regime_rets = log_returns[mask]
                cum = np.cumsum(regime_rets)
                running_max = np.maximum.accumulate(cum)
                drawdowns = cum - running_max
                max_dd = float(np.min(drawdowns))
                regime_drawdowns[k] = round(max_dd, 6)
            else:
                regime_drawdowns[k] = 0.0

        worst_dd = min(regime_drawdowns.values()) if regime_drawdowns else 0.0
        results["max_regime_drawdown"] = {
            "value": round(worst_dd, 6), "passed": True, "p_value": None,
            "details": {f"regime_{k}": v for k, v in regime_drawdowns.items()},
        }
        emit_metric("eval_max_regime_drawdown", worst_dd, iteration)
    except Exception as e:
        results["max_regime_drawdown"] = {
            "value": None, "passed": True, "p_value": None, "details": str(e),
        }

    return results


def run_stage5_benchmarking(
    assignments: np.ndarray,    # (T,) regime assignments
    close: np.ndarray,          # (T,) close prices
    split_idx: int,             # test period start
    iteration: int = 0,
) -> dict:
    """
    Stage 5: Benchmarking.

    Compares regime-based strategy against buy-and-hold and SMA crossover.

    Returns dict of {test_name: {value, passed, p_value, details}}.
    """
    emit_log("Running Stage 5: Benchmarking")
    results = {}
    T = len(assignments)
    K = int(assignments.max()) + 1

    log_returns = np.diff(np.log(np.maximum(close, 1e-10)))
    log_returns = np.concatenate([[0.0], log_returns])

    # Pre-compute regime strategy positions: +1 in highest-return regime, -1 in lowest
    regime_avg_ret = {}
    for k in range(K):
        mask = assignments == k
        if mask.sum() > 0:
            regime_avg_ret[k] = float(np.mean(log_returns[mask]))
        else:
            regime_avg_ret[k] = 0.0

    best_regime = max(regime_avg_ret, key=regime_avg_ret.get)
    worst_regime = min(regime_avg_ret, key=regime_avg_ret.get)

    regime_positions = np.zeros(T)
    regime_positions[assignments == best_regime] = 1.0
    regime_positions[assignments == worst_regime] = -1.0

    test_returns = log_returns[split_idx:]
    regime_test_pos = regime_positions[split_idx:]
    regime_strat_returns = regime_test_pos * test_returns
    regime_cum = float(np.sum(regime_strat_returns))

    # ── vs Buy-and-Hold ──
    try:
        bnh_cum = float(np.sum(test_returns))
        excess = regime_cum - bnh_cum
        passed = regime_cum > bnh_cum

        results["vs_buy_and_hold"] = {
            "value": round(excess, 6), "passed": passed, "p_value": None,
            "details": {
                "regime_cumulative": round(regime_cum, 6),
                "bnh_cumulative": round(bnh_cum, 6),
                "excess_return": round(excess, 6),
                "best_regime": int(best_regime),
                "worst_regime": int(worst_regime),
            },
        }
        emit_metric("eval_vs_bnh_excess", excess, iteration)
    except Exception as e:
        results["vs_buy_and_hold"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── vs SMA Crossover (50/200) ──
    try:
        sma50 = _sma(close, 50)
        sma200 = _sma(close, 200)

        # SMA positions: +1 when SMA50 > SMA200, -1 otherwise
        sma_positions = np.where(sma50 > sma200, 1.0, -1.0)
        # NaN regions (warmup) → 0
        sma_positions[np.isnan(sma50) | np.isnan(sma200)] = 0.0

        sma_test_pos = sma_positions[split_idx:]
        sma_strat_returns = sma_test_pos * test_returns
        sma_cum = float(np.sum(sma_strat_returns))

        excess = regime_cum - sma_cum
        passed = regime_cum > sma_cum

        results["vs_sma_crossover"] = {
            "value": round(excess, 6), "passed": passed, "p_value": None,
            "details": {
                "regime_cumulative": round(regime_cum, 6),
                "sma_cumulative": round(sma_cum, 6),
                "excess_return": round(excess, 6),
            },
        }
        emit_metric("eval_vs_sma_excess", excess, iteration)
    except Exception as e:
        results["vs_sma_crossover"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Regime Information Ratio ──
    try:
        # IR = mean(excess return per bar) / std(excess per bar) * sqrt(252)
        bnh_test_returns = test_returns  # Buy-and-hold = always +1
        excess_returns = regime_strat_returns - bnh_test_returns
        if len(excess_returns) > 1 and np.std(excess_returns) > 1e-10:
            ir = float(np.mean(excess_returns) / np.std(excess_returns)) * np.sqrt(252)
        else:
            ir = 0.0

        passed = ir > 0.0
        results["regime_information_ratio"] = {
            "value": round(ir, 4), "passed": passed, "p_value": None,
            "details": {
                "mean_excess": round(float(np.mean(excess_returns)), 6),
                "std_excess": round(float(np.std(excess_returns)), 6),
                "annualized_ir": round(ir, 4),
            },
        }
        emit_metric("eval_information_ratio", ir, iteration)
    except Exception as e:
        results["regime_information_ratio"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    return results


def run_all_stages(
    features: np.ndarray,
    assignments: np.ndarray,
    close: np.ndarray,
    split_mask: np.ndarray,          # boolean: True = train
    confidence: Optional[np.ndarray],
    transition_matrix: Optional[np.ndarray],
    run_significance: bool = False,
    iteration: int = 0,
) -> dict:
    """
    Orchestrate all 5 evaluation stages and compute composite grade.

    Returns {"stage1": ..., "stage2": ..., "stage3": ..., "stage4": ..., "stage5": ..., "grade": ...}.
    """
    emit_log("Running full evaluation pipeline (Stages 1-5)")

    # Derive train/test split index from split_mask
    # split_mask is True for train, False for test — find first False
    test_indices = np.where(~split_mask)[0]
    split_idx = int(test_indices[0]) if len(test_indices) > 0 else len(assignments)

    train_assignments = assignments[split_mask]
    test_assignments = assignments[~split_mask]
    train_close = close[split_mask]
    test_close = close[~split_mask]

    if confidence is None:
        confidence = np.full(len(assignments), 0.5)
    train_confidence = confidence[split_mask]
    test_confidence = confidence[~split_mask]

    # Stage 1: Regime Quality Assessment (always runs)
    stage1 = run_stage1_regime_quality(
        features=features,
        assignments=assignments,
        close=close,
        iteration=iteration,
    )

    # Stage 2: Statistical Significance (opt-in)
    stage2 = {}
    if run_significance:
        stage2 = run_stage2_significance(
            features=features,
            assignments=assignments,
            close=close,
            iteration=iteration,
        )

    # Stage 3: OOS Validation
    stage3 = {}
    if len(test_assignments) >= 20:
        tm = transition_matrix if transition_matrix is not None else np.eye(int(assignments.max()) + 1)
        stage3 = run_stage3_oos_validation(
            train_assignments=train_assignments,
            test_assignments=test_assignments,
            train_close=train_close,
            test_close=test_close,
            train_confidence=train_confidence,
            test_confidence=test_confidence,
            transition_matrix=tm,
            iteration=iteration,
        )
    else:
        emit_log("Stage 3 skipped: insufficient test data (<20 bars)")

    # Stage 4: Regime-Conditioned Performance
    stage4 = run_stage4_conditioned_performance(
        assignments=assignments,
        close=close,
        confidence=confidence,
        split_idx=split_idx,
        iteration=iteration,
    )

    # Stage 5: Benchmarking
    stage5 = run_stage5_benchmarking(
        assignments=assignments,
        close=close,
        split_idx=split_idx,
        iteration=iteration,
    )

    grade = compute_evaluation_grade_v2(stage1, stage2, stage3, stage4)
    emit_log(f"Evaluation grade (v2): {grade}")
    emit_metric("evaluation_grade_v2_ord", ord(grade) - ord("A"), iteration)

    return {
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
        "stage4": stage4,
        "stage5": stage5,
        "grade": grade,
    }


def compute_evaluation_grade_v2(
    stage1: dict,
    stage2: Optional[dict] = None,
    stage3: Optional[dict] = None,
    stage4: Optional[dict] = None,
) -> str:
    """
    Compute composite evaluation grade A-F (v2 — uses all stages).

    A: All Stage 1 pass + Stage 2 perm p<0.01 + all Stage 3 pass + any Stage 4 Sharpe > 1.0
    B: All Stage 1 pass + Stage 2 perm p<0.05 + Stage 3 OOS return sep pass
    C: >=60% Stage 1 pass + Stage 3 confidence calibration pass
    D: >0% Stage 1 pass
    F: No tests pass
    """
    # Stage 1 pass rate
    s1_tests = [v.get("passed", False) for v in stage1.values()]
    s1_total = len(s1_tests)
    if s1_total == 0:
        return "F"
    s1_pass_rate = sum(s1_tests) / s1_total

    # Stage 2 permutation p-value
    perm_p = None
    if stage2 and "permutation_test" in stage2:
        perm_p = stage2["permutation_test"].get("p_value")

    # Stage 3 checks
    s3_all_pass = False
    s3_oos_ret_sep_pass = False
    s3_conf_cal_pass = False
    if stage3:
        s3_tests = [v.get("passed", False) for v in stage3.values()]
        s3_all_pass = all(s3_tests) if s3_tests else False
        if "oos_return_separation" in stage3:
            s3_oos_ret_sep_pass = stage3["oos_return_separation"].get("passed", False)
        if "oos_confidence_calibration" in stage3:
            s3_conf_cal_pass = stage3["oos_confidence_calibration"].get("passed", False)

    # Stage 4 Sharpe check
    s4_sharpe_above_1 = False
    if stage4 and "regime_sharpe" in stage4:
        details = stage4["regime_sharpe"].get("details", {})
        if isinstance(details, dict):
            s4_sharpe_above_1 = any(v > 1.0 for v in details.values() if isinstance(v, (int, float)))

    # Grade rubric
    if (s1_pass_rate == 1.0
            and perm_p is not None and perm_p < 0.01
            and s3_all_pass
            and s4_sharpe_above_1):
        return "A"
    elif (s1_pass_rate == 1.0
            and perm_p is not None and perm_p < 0.05
            and s3_oos_ret_sep_pass):
        return "B"
    elif s1_pass_rate >= 0.6 and s3_conf_cal_pass:
        return "C"
    elif s1_pass_rate > 0:
        return "D"
    else:
        return "F"


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


def _sma(close: np.ndarray, window: int) -> np.ndarray:
    """Simple moving average. Returns array of same length; NaN where insufficient data."""
    result = np.full(len(close), np.nan)
    if len(close) < window:
        return result
    cumsum = np.cumsum(close)
    result[window - 1:] = (cumsum[window - 1:] - np.concatenate([[0.0], cumsum[:-window]])) / window
    return result


def _annualized_sharpe(returns: np.ndarray, bars_per_year: int = 252) -> float:
    """Annualized Sharpe ratio from log returns (assumes zero risk-free rate)."""
    if len(returns) < 2 or np.std(returns) < 1e-10:
        return 0.0
    return float(np.mean(returns) / np.std(returns)) * np.sqrt(bars_per_year)
