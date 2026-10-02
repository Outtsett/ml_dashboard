"""
Feature correlation analysis — redundancy detection and feature selection.

Computes pairwise correlations, identifies redundant feature groups via
hierarchical clustering, measures multicollinearity via VIF, and suggests
which features to drop.

Usage:
    from ml.shared.feature_correlation import (
        compute_correlation_matrix,
        find_redundant_pairs,
        hierarchical_cluster_features,
        compute_vif,
        suggest_feature_drops,
        run_correlation_analysis,
    )

    results = run_correlation_analysis(X, feature_names, threshold=0.90)
"""

import numpy as np
import pandas as pd

# ── Correlation matrix ────────────────────────────────────────────────────


def compute_correlation_matrix(
    X: np.ndarray,
    feature_names: list[str],
    method: str = "spearman",
) -> pd.DataFrame:
    """Pairwise correlation matrix — high-performance implementation.

    Pearson: uses numpy corrcoef (BLAS-accelerated).
    Spearman: ranks via scipy then numpy corrcoef.

    ~10-50x faster than pandas .corr() on large matrices.
    """
    import time

    t0 = time.time()

    # Try polars first (Rust-native, ~3-5x faster for ranking)
    try:
        import polars as pl

        pl_df = pl.DataFrame({feature_names[d]: X[:, d] for d in range(X.shape[1])})
        # Polars .corr() method is not yet available for spearman in all versions
        # Use polars for NaN fill + ranking, then numpy corrcoef
        pl_df = pl_df.fill_nan(None).fill_null(strategy="mean")

        if method == "spearman":
            ranked = pl_df.select([pl.col(c).rank() for c in pl_df.columns])
            X_ranked = ranked.to_numpy()
        else:
            X_ranked = pl_df.to_numpy()

        corr_matrix = np.corrcoef(X_ranked, rowvar=False)

    except (ImportError, Exception):
        # Fallback: scipy rankdata + numpy corrcoef
        X_clean = X.copy()
        for d in range(X.shape[1]):
            col = X_clean[:, d]
            nan_mask = ~np.isfinite(col)
            if np.any(nan_mask):
                mean_val = np.nanmean(col)
                col[nan_mask] = mean_val if np.isfinite(mean_val) else 0.0

        if method == "spearman":
            from scipy.stats import rankdata

            X_ranked = np.empty_like(X_clean)
            for d in range(X_clean.shape[1]):
                X_ranked[:, d] = rankdata(X_clean[:, d], nan_policy="omit")
            corr_matrix = np.corrcoef(X_ranked, rowvar=False)
        else:
            corr_matrix = np.corrcoef(X_clean, rowvar=False)

    corr_matrix = np.nan_to_num(corr_matrix, nan=0.0)

    elapsed = time.time() - t0
    print(f"[correlate] {method} correlation {X.shape[1]}x{X.shape[1]} in {elapsed:.1f}s")

    return pd.DataFrame(corr_matrix, index=feature_names, columns=feature_names)


# ── Redundant pair detection ──────────────────────────────────────────────


def find_redundant_pairs(
    corr_matrix: pd.DataFrame,
    threshold: float = 0.90,
) -> list[dict]:
    """Find all feature pairs with |correlation| above threshold.

    Returns list of dicts sorted by |correlation| descending:
        [{"feat_a": str, "feat_b": str, "corr": float}]
    """
    pairs = []
    names = corr_matrix.columns.tolist()
    values = corr_matrix.values

    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            c = values[i, j]
            if np.isnan(c):
                continue
            if abs(c) >= threshold:
                pairs.append(
                    {
                        "feat_a": names[i],
                        "feat_b": names[j],
                        "corr": round(float(c), 6),
                    }
                )

    pairs.sort(key=lambda p: abs(p["corr"]), reverse=True)
    return pairs


# ── Hierarchical clustering ──────────────────────────────────────────────


def hierarchical_cluster_features(
    corr_matrix: pd.DataFrame,
    n_clusters: int | None = None,
    max_clusters: int = 30,
) -> dict:
    """Cluster features by correlation similarity.

    Uses agglomerative clustering on distance = 1 - |corr|.
    If n_clusters is None, auto-selects via silhouette score.

    Returns:
        {
            "n_clusters": int,
            "clusters": {cluster_id: [feature_names]},
            "labels": [cluster_id_per_feature],
            "linkage_matrix": list (for dendrogram reconstruction),
        }
    """
    from scipy.cluster.hierarchy import fcluster, linkage
    from scipy.spatial.distance import squareform

    names = corr_matrix.columns.tolist()
    n = len(names)

    if n < 2:
        return {
            "n_clusters": 1,
            "clusters": {1: names},
            "labels": [1] * n,
            "linkage_matrix": [],
        }

    # Distance matrix: 1 - |corr|, clipped to [0, 1]
    corr_vals = corr_matrix.values.copy()
    # Replace NaN correlations with 0 (= distance 1, fully uncorrelated)
    corr_vals = np.nan_to_num(corr_vals, nan=0.0)
    dist = 1.0 - np.abs(corr_vals)
    np.fill_diagonal(dist, 0.0)
    dist = np.clip(dist, 0.0, 1.0)

    # Make symmetric (handle floating-point asymmetry)
    dist = (dist + dist.T) / 2.0
    np.fill_diagonal(dist, 0.0)

    condensed = squareform(dist, checks=False)
    # Replace any remaining non-finite values
    condensed = np.nan_to_num(condensed, nan=1.0, posinf=1.0, neginf=0.0)
    Z = linkage(condensed, method="average")

    if n_clusters is not None:
        labels = fcluster(Z, n_clusters, criterion="maxclust")
    else:
        # Auto-select via silhouette score
        best_k = 2
        best_score = -1.0

        if n > 3:
            from sklearn.metrics import silhouette_score

            for k in range(2, min(max_clusters + 1, n)):
                candidate_labels = fcluster(Z, k, criterion="maxclust")
                if len(set(candidate_labels)) < 2:
                    continue
                score = silhouette_score(dist, candidate_labels, metric="precomputed")
                if score > best_score:
                    best_score = score
                    best_k = k

        labels = fcluster(Z, best_k, criterion="maxclust")

    # Build cluster dict
    clusters = {}
    for i, label in enumerate(labels):
        label_int = int(label)
        if label_int not in clusters:
            clusters[label_int] = []
        clusters[label_int].append(names[i])

    return {
        "n_clusters": int(max(labels)),
        "clusters": clusters,
        "labels": [int(l) for l in labels],
        "linkage_matrix": Z.tolist(),
    }


# ── Variance Inflation Factor ────────────────────────────────────────────


def compute_vif(
    X: np.ndarray,
    feature_names: list[str],
    max_features: int = 100,
    max_rows: int = 50_000,
) -> list[dict]:
    """Compute VIF for each feature. VIF > 10 = serious multicollinearity.

    Subsamples rows and caps features for performance.
    Uses batch OLS via matrix inversion instead of per-feature regression.

    Returns:
        [{"feature": str, "vif": float}] sorted by VIF descending.
    """
    import time

    t0 = time.time()

    T, D = X.shape
    if D > max_features:
        X = X[:, :max_features]
        feature_names = feature_names[:max_features]
        D = max_features

    # Drop invalid columns
    valid_mask = np.ones(D, dtype=bool)
    for d in range(D):
        col = X[:, d]
        finite = col[np.isfinite(col)]
        if len(finite) < 10 or np.std(finite) < 1e-10:
            valid_mask[d] = False

    X_valid = X[:, valid_mask]
    names_valid = [feature_names[d] for d in range(D) if valid_mask[d]]
    D_valid = X_valid.shape[1]

    if D_valid < 2:
        return [{"feature": n, "vif": 1.0} for n in names_valid]

    # Subsample rows for speed
    if T > max_rows:
        rng = np.random.default_rng(42)
        idx = rng.choice(T, max_rows, replace=False)
        X_valid = X_valid[idx]

    # Replace NaN with column median
    X_clean = X_valid.copy()
    for d in range(D_valid):
        col = X_clean[:, d]
        mask = ~np.isfinite(col)
        if np.any(mask):
            med = np.nanmedian(col)
            col[mask] = med if np.isfinite(med) else 0.0

    # Batch VIF via correlation matrix inverse
    # VIF_i = diag((X'X)^-1)_ii * var(X_i) = diag(R^-1)_ii
    # where R is the correlation matrix
    try:
        corr = np.corrcoef(X_clean, rowvar=False)
        corr = np.nan_to_num(corr, nan=0.0)
        # Regularize for numerical stability
        corr += np.eye(D_valid) * 1e-6
        R_inv = np.linalg.inv(corr)
        vif_values = np.diag(R_inv)
    except np.linalg.LinAlgError:
        # Fallback: per-feature OLS
        vif_values = np.ones(D_valid)
        for d in range(D_valid):
            y = X_clean[:, d]
            X_others = np.delete(X_clean, d, axis=1)
            X_ols = np.column_stack([np.ones(len(y)), X_others])
            try:
                beta = np.linalg.lstsq(X_ols, y, rcond=None)[0]
                ss_res = np.sum((y - X_ols @ beta) ** 2)
                ss_tot = np.sum((y - y.mean()) ** 2)
                r2 = min(1.0 - ss_res / ss_tot, 0.9999) if ss_tot > 1e-10 else 0.0
                vif_values[d] = 1.0 / (1.0 - r2)
            except Exception:
                vif_values[d] = float("inf")

    results = [
        {"feature": names_valid[d], "vif": round(float(vif_values[d]), 4)} for d in range(D_valid)
    ]
    results.sort(key=lambda r: r["vif"], reverse=True)

    elapsed = time.time() - t0
    print(f"[vif] {D_valid} features in {elapsed:.1f}s")
    return results


# ── Feature drop suggestions ─────────────────────────────────────────────


def suggest_feature_drops(
    redundant_pairs: list[dict],
    vif_results: list[dict],
    importance_ranking: list[str] | None = None,
) -> list[str]:
    """Suggest features to drop based on redundancy and multicollinearity.

    For each redundant pair: keep the one with higher importance (if available)
    or lower VIF. Returns list of feature names to drop.
    """
    vif_map = {r["feature"]: r["vif"] for r in vif_results}
    importance_rank = {}
    if importance_ranking:
        for i, name in enumerate(importance_ranking):
            importance_rank[name] = i  # lower index = more important

    to_drop = set()
    kept = set()

    for pair in redundant_pairs:
        a, b = pair["feat_a"], pair["feat_b"]

        # Skip if one already dropped
        if a in to_drop or b in to_drop:
            continue

        # Decide which to drop
        if importance_ranking:
            rank_a = importance_rank.get(a, len(importance_ranking))
            rank_b = importance_rank.get(b, len(importance_ranking))
            if rank_a <= rank_b:
                to_drop.add(b)
                kept.add(a)
            else:
                to_drop.add(a)
                kept.add(b)
        else:
            # No importance info: drop the one with higher VIF
            vif_a = vif_map.get(a, 1.0)
            vif_b = vif_map.get(b, 1.0)
            if vif_a >= vif_b:
                to_drop.add(a)
                kept.add(b)
            else:
                to_drop.add(b)
                kept.add(a)

    return sorted(to_drop)


# ── Full analysis pipeline ───────────────────────────────────────────────


def run_correlation_analysis(
    X: np.ndarray,
    feature_names: list[str],
    threshold: float = 0.90,
    method: str = "spearman",
    compute_vif_analysis: bool = True,
    max_vif_features: int = 100,
    importance_ranking: list[str] | None = None,
) -> dict:
    """Run full correlation analysis pipeline.

    Returns dict with all results:
        {
            "correlation_matrix": pd.DataFrame,
            "redundant_pairs": list[dict],
            "clusters": dict,
            "vif_results": list[dict] | None,
            "suggested_drops": list[str],
            "n_original": int,
            "n_after_drops": int,
        }
    """
    # 1. Correlation matrix
    corr = compute_correlation_matrix(X, feature_names, method=method)

    # 2. Redundant pairs
    redundant = find_redundant_pairs(corr, threshold=threshold)

    # 3. Hierarchical clustering
    clusters = hierarchical_cluster_features(corr)

    # 4. VIF (on non-redundant subset if too many features)
    vif_results = None
    if compute_vif_analysis:
        # Pre-filter: remove one from each highly redundant pair first
        pre_drops = suggest_feature_drops(redundant, [], importance_ranking)
        keep_indices = [i for i, n in enumerate(feature_names) if n not in pre_drops]
        X_filtered = X[:, keep_indices]
        names_filtered = [feature_names[i] for i in keep_indices]

        if len(names_filtered) > 0:
            vif_results = compute_vif(X_filtered, names_filtered, max_vif_features)

    # 5. Suggested drops (using VIF if available)
    suggested_drops = suggest_feature_drops(
        redundant,
        vif_results or [],
        importance_ranking,
    )

    return {
        "correlation_matrix": corr,
        "redundant_pairs": redundant,
        "clusters": clusters,
        "vif_results": vif_results,
        "suggested_drops": suggested_drops,
        "n_original": len(feature_names),
        "n_after_drops": len(feature_names) - len(suggested_drops),
    }
