"""
Feature importance analysis — permutation, mutual information, SHAP, and
unsupervised regime stability.

Model-agnostic importance measurement. Works with any trained model or as
standalone analysis against a target variable.

Usage:
    from ml.shared.feature_importance import (
        permutation_importance,
        unsupervised_permutation_importance,
        mutual_information_analysis,
        shap_importance,
        compute_cumulative_importance,
        aggregate_importance,
        run_importance_analysis,
    )

    results = run_importance_analysis(
        X, y, feature_names,
        model_predict_fn=model.predict,
    )
"""

import numpy as np

# ── Permutation importance (supervised) ───────────────────────────────────


def permutation_importance(
    model_predict_fn,
    X: np.ndarray,
    y: np.ndarray,
    feature_names: list[str],
    n_repeats: int = 10,
    scoring: str = "accuracy",
    random_state: int = 42,
    n_jobs: int = -1,
) -> list[dict]:
    """Model-agnostic permutation importance — parallelized via joblib.

    Shuffles each feature column independently, measures prediction degradation
    against the original score. Higher degradation = more important feature.

    Uses joblib threading for parallel feature processing (~4-8x speedup).
    """
    from joblib import Parallel, delayed

    T, D = X.shape

    # Compute baseline score
    y_pred_base = model_predict_fn(X)
    base_score = _score(y, y_pred_base, scoring)

    def _eval_feature(d):
        rng = np.random.default_rng(random_state + d)
        scores = []
        X_perm = X.copy()
        for _ in range(n_repeats):
            X_perm[:, d] = rng.permutation(X[:, d])
            y_pred_perm = model_predict_fn(X_perm)
            perm_score = _score(y, y_pred_perm, scoring)
            scores.append(base_score - perm_score)
            X_perm[:, d] = X[:, d]  # restore
        return {
            "feature": feature_names[d],
            "importance_mean": round(float(np.mean(scores)), 6),
            "importance_std": round(float(np.std(scores)), 6),
        }

    actual_jobs = min(n_jobs if n_jobs > 0 else 8, D)
    results = Parallel(n_jobs=actual_jobs, prefer="threads")(
        delayed(_eval_feature)(d) for d in range(D)
    )

    results.sort(key=lambda r: r["importance_mean"], reverse=True)
    return results


# ── Unsupervised permutation importance (for clustering models) ──────────


def unsupervised_permutation_importance(
    model_assign_fn,
    X: np.ndarray,
    feature_names: list[str],
    n_repeats: int = 10,
    random_state: int = 42,
) -> list[dict]:
    """Permutation importance for unsupervised models (clustering).

    Instead of comparing predictions to labels, measures assignment
    stability via Adjusted Rand Index (ARI). Features that cause large ARI
    drops when permuted are important to the cluster structure.

    Args:
        model_assign_fn: Callable(X) -> cluster_labels (T,).
        X: Feature matrix (T, D).
        feature_names: Column names.
        n_repeats: Number of shuffle repeats per feature.
        random_state: RNG seed.

    Returns:
        [{"feature": str, "importance_mean": float, "importance_std": float}]
        sorted by importance_mean descending.
    """
    from sklearn.metrics import adjusted_rand_score

    rng = np.random.default_rng(random_state)
    T, D = X.shape

    # Baseline regime assignments
    base_labels = model_assign_fn(X)

    results = []
    for d in range(D):
        ari_drops = []
        for _ in range(n_repeats):
            X_perm = X.copy()
            X_perm[:, d] = rng.permutation(X_perm[:, d])
            perm_labels = model_assign_fn(X_perm)
            ari = adjusted_rand_score(base_labels, perm_labels)
            ari_drops.append(1.0 - ari)  # Higher = more disruption = more important

        results.append(
            {
                "feature": feature_names[d],
                "importance_mean": round(float(np.mean(ari_drops)), 6),
                "importance_std": round(float(np.std(ari_drops)), 6),
            }
        )

    results.sort(key=lambda r: r["importance_mean"], reverse=True)
    return results


# ── Mutual information ────────────────────────────────────────────────────


def mutual_information_analysis(
    X: np.ndarray,
    y: np.ndarray,
    feature_names: list[str],
    discrete_target: bool = True,
    n_neighbors: int = 5,
    random_state: int = 42,
    max_samples: int = 100_000,
) -> list[dict]:
    """Non-linear dependency measure between features and target.

    Uses sklearn's mutual_info_classif or mutual_info_regression.
    Subsamples to max_samples for performance on large datasets
    (MI is O(n*d*k) with KNN — 100k rows is the sweet spot for
    accuracy vs speed).

    Returns:
        [{"feature": str, "mi_score": float}] sorted by mi_score descending.
    """
    import time

    from sklearn.feature_selection import mutual_info_classif, mutual_info_regression

    t0 = time.time()

    # Subsample if too large
    T = X.shape[0]
    if T > max_samples:
        rng = np.random.default_rng(random_state)
        indices = rng.choice(T, max_samples, replace=False)
        indices.sort()
        X_sub = X[indices]
        y_sub = y[indices]
        print(f"[mi] Subsampled {T:,} to {max_samples:,} rows for MI")
    else:
        X_sub = X
        y_sub = y

    # Handle NaN: replace with column median (faster than mean)
    X_clean = X_sub.copy()
    for d in range(X_clean.shape[1]):
        col = X_clean[:, d]
        mask = ~np.isfinite(col)
        if np.any(mask):
            med = np.nanmedian(col)
            col[mask] = med if np.isfinite(med) else 0.0

    if discrete_target:
        mi_scores = mutual_info_classif(
            X_clean, y_sub, n_neighbors=n_neighbors, random_state=random_state
        )
    else:
        mi_scores = mutual_info_regression(
            X_clean, y_sub, n_neighbors=n_neighbors, random_state=random_state
        )

    elapsed = time.time() - t0
    print(f"[mi] {X_clean.shape[1]} features in {elapsed:.1f}s")

    results = [
        {"feature": feature_names[d], "mi_score": round(float(mi_scores[d]), 6)}
        for d in range(len(feature_names))
    ]
    results.sort(key=lambda r: r["mi_score"], reverse=True)
    return results


# ── SHAP importance wrapper ──────────────────────────────────────────────


def shap_importance(
    model,
    X: np.ndarray,
    feature_names: list[str],
    model_type: str = "tree",
    max_samples: int = 1000,
) -> dict:
    """SHAP-based feature importance.

    Delegates to the appropriate SHAP explainer based on model type.

    Args:
        model: Trained model object.
        X: Feature matrix (T, D).
        feature_names: Column names.
        model_type: "tree" (TreeExplainer), "kernel" (KernelExplainer).
        max_samples: Max samples for KernelExplainer (slow method).

    Returns:
        {
            "mean_abs_shap": [{"feature": str, "value": float}],
            "shap_values": np.ndarray (T, D) or None,
        }
    """
    if model_type == "tree":
        return _shap_tree(model, X, feature_names)
    elif model_type == "kernel":
        return _shap_kernel(model, X, feature_names, max_samples)
    else:
        raise ValueError(f"Unknown model_type: {model_type}")


def _shap_tree(model, X, feature_names):
    """SHAP for tree-based models (XGBoost, LightGBM, RF, etc.)."""
    import shap

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)

    # Handle multi-class: average across classes
    if isinstance(shap_values, list):
        shap_values = np.mean([np.abs(sv) for sv in shap_values], axis=0)
    else:
        shap_values = np.abs(shap_values)

    mean_abs = np.mean(shap_values, axis=0)
    results = [
        {"feature": feature_names[d], "value": round(float(mean_abs[d]), 6)}
        for d in range(len(feature_names))
    ]
    results.sort(key=lambda r: r["value"], reverse=True)

    return {
        "mean_abs_shap": results,
        "shap_values": shap_values,
    }


def _shap_kernel(model, X, feature_names, max_samples):
    """SHAP KernelExplainer for arbitrary models (slow, subsampled)."""
    import shap

    # Subsample background data
    if X.shape[0] > max_samples:
        indices = np.random.default_rng(42).choice(X.shape[0], max_samples, replace=False)
        X_bg = X[indices]
    else:
        X_bg = X

    explainer = shap.KernelExplainer(model.predict, X_bg)
    shap_values = explainer.shap_values(X_bg, nsamples=100)

    if isinstance(shap_values, list):
        shap_values = np.mean([np.abs(sv) for sv in shap_values], axis=0)
    else:
        shap_values = np.abs(shap_values)

    mean_abs = np.mean(shap_values, axis=0)
    results = [
        {"feature": feature_names[d], "value": round(float(mean_abs[d]), 6)}
        for d in range(len(feature_names))
    ]
    results.sort(key=lambda r: r["value"], reverse=True)

    return {
        "mean_abs_shap": results,
        "shap_values": shap_values,
    }


# ── Cumulative importance ────────────────────────────────────────────────


def compute_cumulative_importance(
    ranked_features: list[dict],
    importance_key: str = "importance_mean",
) -> list[dict]:
    """Compute cumulative importance from a ranked feature list.

    Finds the elbow: how many features for 80%, 90%, 95% of total.

    Args:
        ranked_features: Pre-sorted list with importance values.
        importance_key: Key containing the importance value.

    Returns:
        [{"feature": str, "importance": float, "cumulative_pct": float, "rank": int}]
    """
    total = sum(max(r.get(importance_key, r.get("value", 0)), 0) for r in ranked_features)
    if total <= 0:
        return [
            {
                "feature": r.get("feature", ""),
                "importance": 0.0,
                "cumulative_pct": 0.0,
                "rank": i + 1,
            }
            for i, r in enumerate(ranked_features)
        ]

    cumulative = 0.0
    results = []
    for i, r in enumerate(ranked_features):
        imp = max(r.get(importance_key, r.get("value", 0)), 0)
        cumulative += imp
        results.append(
            {
                "feature": r.get("feature", ""),
                "importance": round(float(imp), 6),
                "cumulative_pct": round(float(cumulative / total), 6),
                "rank": i + 1,
            }
        )

    return results


# ── Aggregate importance ─────────────────────────────────────────────────


def aggregate_importance(
    permutation_results: list[dict] | None = None,
    mi_results: list[dict] | None = None,
    shap_results: list[dict] | None = None,
) -> list[dict]:
    """Rank-average across multiple importance methods.

    Each method provides a ranking. The aggregate score is the average rank
    across all available methods. Lower aggregate rank = more important.

    Returns:
        [{"feature": str, "aggregate_rank": float, "permutation_rank": int,
          "mi_rank": int, "shap_rank": int}]
        sorted by aggregate_rank ascending (most important first).
    """
    # Collect all feature names
    all_features = set()
    if permutation_results:
        all_features.update(r["feature"] for r in permutation_results)
    if mi_results:
        all_features.update(r["feature"] for r in mi_results)
    if shap_results:
        all_features.update(r["feature"] for r in shap_results)

    if not all_features:
        return []

    n = len(all_features)

    # Build rank maps (1-indexed, lower = more important)
    perm_rank = {}
    if permutation_results:
        for i, r in enumerate(permutation_results):
            perm_rank[r["feature"]] = i + 1

    mi_rank = {}
    if mi_results:
        for i, r in enumerate(mi_results):
            mi_rank[r["feature"]] = i + 1

    shap_rank = {}
    if shap_results:
        for i, r in enumerate(shap_results):
            shap_rank[r["feature"]] = i + 1

    # Compute aggregate
    results = []
    for feat in all_features:
        ranks = []
        pr = perm_rank.get(feat, n)
        mr = mi_rank.get(feat, n)
        sr = shap_rank.get(feat, n)

        if permutation_results:
            ranks.append(pr)
        if mi_results:
            ranks.append(mr)
        if shap_results:
            ranks.append(sr)

        avg_rank = sum(ranks) / len(ranks) if ranks else n

        results.append(
            {
                "feature": feat,
                "aggregate_rank": round(float(avg_rank), 2),
                "permutation_rank": pr,
                "mi_rank": mr,
                "shap_rank": sr,
            }
        )

    results.sort(key=lambda r: r["aggregate_rank"])
    return results


# ── Scoring helper ────────────────────────────────────────────────────────


def _score(y_true: np.ndarray, y_pred: np.ndarray, method: str) -> float:
    """Compute score for permutation importance."""
    if method == "accuracy":
        return float(np.mean(y_true == y_pred))
    elif method == "mse":
        return -float(np.mean((y_true - y_pred) ** 2))  # Negative MSE (higher = better)
    elif method == "mae":
        return -float(np.mean(np.abs(y_true - y_pred)))
    else:
        raise ValueError(f"Unknown scoring method: {method}")


# ── Full analysis pipeline ───────────────────────────────────────────────


def run_importance_analysis(
    X: np.ndarray,
    y: np.ndarray,
    feature_names: list[str],
    model_predict_fn=None,
    model=None,
    model_type: str | None = None,
    model_assign_fn=None,
    n_repeats: int = 10,
    scoring: str = "accuracy",
    discrete_target: bool = True,
    random_state: int = 42,
) -> dict:
    """Run full importance analysis pipeline.

    Runs whichever analyses are possible based on provided arguments:
    - permutation_importance: requires model_predict_fn + y
    - unsupervised_permutation_importance: requires model_assign_fn (no y needed)
    - mutual_information: requires y
    - shap_importance: requires model + model_type

    Returns:
        {
            "permutation": list[dict] | None,
            "unsupervised_permutation": list[dict] | None,
            "mutual_information": list[dict] | None,
            "shap": dict | None,
            "cumulative": list[dict],
            "aggregate": list[dict],
        }
    """
    perm_results = None
    unsup_results = None
    mi_results = None
    shap_results = None

    # 1. Supervised permutation importance
    if model_predict_fn is not None and y is not None:
        perm_results = permutation_importance(
            model_predict_fn,
            X,
            y,
            feature_names,
            n_repeats=n_repeats,
            scoring=scoring,
            random_state=random_state,
        )

    # 2. Unsupervised permutation importance (for clustering models)
    if model_assign_fn is not None:
        unsup_results = unsupervised_permutation_importance(
            model_assign_fn,
            X,
            feature_names,
            n_repeats=n_repeats,
            random_state=random_state,
        )

    # 3. Mutual information
    if y is not None:
        mi_results = mutual_information_analysis(
            X,
            y,
            feature_names,
            discrete_target=discrete_target,
            random_state=random_state,
        )

    # 4. SHAP
    if model is not None and model_type is not None:
        shap_results = shap_importance(model, X, feature_names, model_type=model_type)

    # 5. Cumulative importance (from best available method)
    primary_ranking = (
        perm_results
        or unsup_results
        or (shap_results.get("mean_abs_shap") if shap_results else None)
        or mi_results
        or []
    )
    cumulative = compute_cumulative_importance(
        primary_ranking,
        importance_key="importance_mean"
        if (perm_results or unsup_results)
        else "mi_score"
        if mi_results
        else "value",
    )

    # 6. Aggregate across methods
    aggregate = aggregate_importance(
        permutation_results=perm_results or unsup_results,
        mi_results=mi_results,
        shap_results=shap_results.get("mean_abs_shap") if shap_results else None,
    )

    return {
        "permutation": perm_results,
        "unsupervised_permutation": unsup_results,
        "mutual_information": mi_results,
        "shap": shap_results,
        "cumulative": cumulative,
        "aggregate": aggregate,
    }
