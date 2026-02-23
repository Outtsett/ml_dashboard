"""
HDP-HMM Validation
====================

Walk-forward validation and out-of-sample stability assessment.
"""

import io
import sys
from typing import Any

import numpy as np

from .model import StickyHDPHMM


def walk_forward_validation(
    X: np.ndarray,
    n_windows: int = 5,
    train_pct: float = 0.6,
    gibbs_iter: int = 50,
    burn_in: int = 15,
    random_state: int = 42,
    kappa: float = 50.0,
    gamma: float = 5.0,
    alpha: float = 1.0,
) -> dict:
    """
    Walk-forward out-of-sample regime stability test.

    Think of it as: sliding a window through time -- train HDP-HMM on 60%
    of a chunk, then apply to the next 40%. If the regimes are REAL patterns,
    they should appear consistently across all windows.
    """
    n_total = len(X)
    window_size = n_total // n_windows
    if window_size < 200:
        n_windows = max(2, n_total // 200)
        window_size = n_total // n_windows

    step_size = (n_total - window_size) // max(n_windows - 1, 1)
    if step_size < 50:
        step_size = 50

    window_results = []
    max_k_seen = 0  # noqa: F841 — reserved for future use

    for w in range(n_windows):
        start = w * step_size
        end = min(start + window_size, n_total)
        if end - start < 200:
            break

        X_window = X[start:end]
        split_point = int(len(X_window) * train_pct)
        if split_point < 100 or (len(X_window) - split_point) < 50:
            continue

        X_train = X_window[:split_point]
        X_test = X_window[split_point:]

        try:
            model = StickyHDPHMM(
                alpha=alpha,
                gamma=gamma,
                kappa=kappa,
                max_states=20,
                n_iter=gibbs_iter,
                burn_in=burn_in,
                random_state=random_state + w * 100,
            )
            # Suppress per-iteration output during WF
            old_stdout = sys.stdout
            sys.stdout = io.StringIO()
            model.fit(X_train)
            sys.stdout = old_stdout

            train_ll = model.score(X_train)
            test_ll = model.score(X_test)

            oos_regimes = model.predict(X_test)
            oos_probs = model.predict_proba(X_test)

            n_regimes_found = model.n_active_
            max_k_seen = max(max_k_seen, n_regimes_found)  # noqa: F841

            # Regime distribution
            regime_counts = np.bincount(oos_regimes, minlength=n_regimes_found)
            regime_pcts = regime_counts / len(oos_regimes)

            n_switches = np.sum(np.diff(oos_regimes) != 0)
            switch_rate = n_switches / max(len(oos_regimes) - 1, 1)
            avg_confidence = float(np.mean(np.max(oos_probs, axis=1)))

            window_results.append(
                {
                    "window": w + 1,
                    "start_idx": int(start),
                    "end_idx": int(end),
                    "train_size": int(split_point),
                    "test_size": int(len(X_window) - split_point),
                    "n_regimes_found": int(n_regimes_found),
                    "train_ll_per_sample": round(float(train_ll / split_point), 6),
                    "test_ll_per_sample": round(
                        float(test_ll / (len(X_window) - split_point)), 6
                    ),
                    "regime_distribution": [
                        round(float(p), 4) for p in regime_pcts.tolist()
                    ],
                    "switch_rate": round(float(switch_rate), 4),
                    "avg_confidence": round(avg_confidence, 4),
                    "failed": False,
                }
            )
        except (ValueError, RuntimeError, np.linalg.LinAlgError) as e:
            window_results.append(
                {
                    "window": w + 1,
                    "start_idx": int(start),
                    "end_idx": int(end),
                    "train_size": split_point if "split_point" in dir() else 0,
                    "test_size": 0,
                    "failed": True,
                    "error": str(e),
                }
            )

    # Stability: consistency of # regimes found + distribution similarity
    valid_windows: list[dict[str, Any]] = [
        vw for vw in window_results if not vw.get("failed", False)
    ]
    stability_score = 0.0

    if len(valid_windows) >= 2:
        # Check if same number of regimes is found consistently
        k_values = [vw["n_regimes_found"] for vw in valid_windows]
        k_agreement = k_values.count(max(set(k_values), key=k_values.count)) / len(
            k_values
        )

        # Pad distributions to same length for comparison
        max_k: int = max(
            len(vw["regime_distribution"])
            for vw in valid_windows  # type: ignore[arg-type]
        )
        padded = []
        for vw in valid_windows:
            dist: list[float] = vw["regime_distribution"]  # type: ignore[assignment]
            d = dist + [0.0] * (max_k - len(dist))
            padded.append(d)

        # Pairwise JSD
        js_distances = []
        for i in range(len(padded)):
            for j in range(i + 1, len(padded)):
                p = np.array(padded[i]) + 1e-10
                q = np.array(padded[j]) + 1e-10
                p, q = p / p.sum(), q / q.sum()
                m_d = 0.5 * (p + q)
                js = 0.5 * np.sum(p * np.log(p / m_d)) + 0.5 * np.sum(
                    q * np.log(q / m_d)
                )
                js_distances.append(float(np.sqrt(max(js, 0))))

        dist_stability = 1.0 - float(np.mean(js_distances))
        stability_score = round(0.5 * k_agreement + 0.5 * dist_stability, 4)

    avg_confidence_all = (
        round(float(np.mean([vw["avg_confidence"] for vw in valid_windows])), 4)
        if valid_windows
        else 0.0
    )
    avg_switch_rate = (
        round(float(np.mean([vw["switch_rate"] for vw in valid_windows])), 4)
        if valid_windows
        else 0.0
    )

    return {
        "n_windows": len(valid_windows),
        "window_results": window_results,
        "stability_score": stability_score,
        "avg_oos_confidence": avg_confidence_all,
        "avg_switch_rate": avg_switch_rate,
    }


def assess_oos_stability(
    model: StickyHDPHMM,
    X_train: np.ndarray,
    X_test: np.ndarray,
    _feature_names: list,
) -> dict:
    """
    Measure how well learned regimes hold up on unseen test data.
    """
    K = model.n_components

    train_regimes = model.predict(X_train)
    test_regimes = model.predict(X_test)
    test_probs = model.predict_proba(X_test)

    train_counts = np.bincount(train_regimes, minlength=K)
    train_dist = train_counts / len(train_regimes)
    test_counts = np.bincount(test_regimes, minlength=K)
    test_dist = test_counts / len(test_regimes)

    # JSD
    p = train_dist + 1e-10
    q = test_dist + 1e-10
    p, q = p / p.sum(), q / q.sum()
    m_d = 0.5 * (p + q)
    jsd = 0.5 * np.sum(p * np.log(p / m_d)) + 0.5 * np.sum(q * np.log(q / m_d))
    distribution_similarity = round(1.0 - float(np.sqrt(max(jsd, 0))), 4)

    # Feature profile consistency
    profile_consistency: list[dict[str, Any]] = []
    for k in range(K):
        train_mask = train_regimes == k
        test_mask = test_regimes == k
        if train_mask.sum() < 10 or test_mask.sum() < 10:
            profile_consistency.append(
                {
                    "regime": k,
                    "correlation": None,
                    "insufficient_data": True,
                }
            )
            continue
        train_means = np.mean(X_train[train_mask], axis=0)
        test_means = np.mean(X_test[test_mask], axis=0)
        corr = float(np.corrcoef(train_means, test_means)[0, 1])
        profile_consistency.append(
            {
                "regime": k,
                "correlation": round(corr, 4),
                "train_count": int(train_mask.sum()),
                "test_count": int(test_mask.sum()),
                "insufficient_data": False,
            }
        )

    valid_corrs = [
        p["correlation"] for p in profile_consistency if p["correlation"] is not None
    ]
    avg_profile_corr = round(float(np.mean(valid_corrs)), 4) if valid_corrs else 0.0
    avg_confidence = round(float(np.mean(np.max(test_probs, axis=1))), 4)

    train_switches = np.sum(np.diff(train_regimes) != 0) / max(
        len(train_regimes) - 1, 1
    )
    test_switches = np.sum(np.diff(test_regimes) != 0) / max(len(test_regimes) - 1, 1)

    return {
        "distribution_similarity": distribution_similarity,
        "train_distribution": [round(float(d), 4) for d in train_dist],
        "test_distribution": [round(float(d), 4) for d in test_dist],
        "profile_consistency": profile_consistency,
        "avg_profile_correlation": avg_profile_corr,
        "avg_test_confidence": avg_confidence,
        "train_switch_rate": round(float(train_switches), 4),
        "test_switch_rate": round(float(test_switches), 4),
        "switch_rate_ratio": round(
            float(test_switches / max(train_switches, 1e-10)), 4
        ),
    }
