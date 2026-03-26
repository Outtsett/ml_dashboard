"""
Feature engineering research pipeline — extract, correlate, importance-test.

Reads pre-computed indicators (parquet or QuestDB), derives feature representations,
runs correlation analysis to find redundancy, and measures feature importance
via permutation, mutual information, and SHAP.

Output structure:
    data/feature_research/{symbol}/{timeframe}/
        extracted_features.parquet     # Derived feature matrix
        extraction_stats.json          # Column catalog, transform log
        correlation_matrix.parquet     # Full pairwise correlations
        redundant_pairs.json           # High-correlation pairs
        feature_clusters.json          # Hierarchical clustering
        vif_scores.json                # VIF per feature
        importance_ranking.json        # Aggregated importance
        recommended_features.json      # Final recommended feature set

Usage:
    python scripts/feature-research.py --symbol ES --timeframe 1h
    python scripts/feature-research.py --symbol ES --timeframe 1h --stages extract,correlate
    python scripts/feature-research.py --symbol ES --timeframe 1h --stages importance --target regime
    python scripts/feature-research.py --symbol ES --timeframe 1h
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Add project root to sys.path for shared imports
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from ml.shared.feature_extract import (
    extract_derived_features,
    load_extraction_config,
    load_indicators_from_parquet,
    load_indicators_from_questdb,
)
from ml.shared.feature_correlation import run_correlation_analysis
from ml.shared.feature_importance import run_importance_analysis


# ── Constants ─────────────────────────────────────────────────────────────

DATA_DIR = ROOT / "data"
OUTPUT_BASE = DATA_DIR / "feature_research"


# ── Data loading ──────────────────────────────────────────────────────────


def load_indicator_data(
    symbol: str,
    timeframe: str,
    source: str = "parquet",
    max_bars: int = 0,
    date_range: dict | None = None,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Load indicator DataFrame and close prices.

    Returns (indicator_df, close_array).
    """
    if source == "questdb":
        df = load_indicators_from_questdb(symbol, timeframe, max_bars, date_range)
    else:
        # Try futures first, then forex
        try:
            df = load_indicators_from_parquet(symbol, timeframe, str(DATA_DIR), "futures")
        except FileNotFoundError:
            df = load_indicators_from_parquet(symbol, timeframe, str(DATA_DIR), "forex")

    # Extract close prices
    if "close" in df.columns:
        close = df["close"].values.astype(np.float64)
    elif "Close" in df.columns:
        close = df["Close"].values.astype(np.float64)
    else:
        raise ValueError("No close price column found in indicator data")

    print(f"[load] {symbol}/{timeframe}: {len(df)} bars, {len(df.columns)} columns")
    return df, close


def build_target(
    symbol: str,
    timeframe: str,
    target_type: str,
    close: np.ndarray,
    df: pd.DataFrame,
) -> np.ndarray | None:
    """Build target variable for importance analysis.

    Args:
        target_type: "return_5" (direction), "regime" (from model), "label" (from QuestDB).

    Returns:
        y array or None if not applicable.
    """
    if target_type == "return_5":
        # 5-bar forward return direction: +1 (up), -1 (down), 0 (flat)
        forward_ret = np.zeros(len(close))
        forward_ret[:-5] = (close[5:] - close[:-5]) / (close[:-5] + 1e-10)
        threshold = 0.001  # 0.1% threshold for "flat"
        y = np.where(forward_ret > threshold, 1, np.where(forward_ret < -threshold, -1, 0))
        return y.astype(np.float64)

    elif target_type == "return_10":
        forward_ret = np.zeros(len(close))
        forward_ret[:-10] = (close[10:] - close[:-10]) / (close[:-10] + 1e-10)
        threshold = 0.002
        y = np.where(forward_ret > threshold, 1, np.where(forward_ret < -threshold, -1, 0))
        return y.astype(np.float64)

    elif target_type == "regime":
        # model_regimes QuestDB table has been dropped.
        # Regime assignments are now saved as CSV files in model output directories.
        # Look for the latest assignments.csv in data/models/ or checkpoints/.
        print(
            "[target] model_regimes QuestDB table no longer exists. "
            "Regime assignments are saved as assignments.csv in model output dirs. "
            "Use --target return_5 or return_10 instead."
        )
        return None

    elif target_type == "none":
        return None

    else:
        print(f"[target] Unknown target type: {target_type}")
        return None


# ── Stage runners ─────────────────────────────────────────────────────────


def run_extract(
    df: pd.DataFrame,
    close: np.ndarray,
    output_dir: Path,
    config: dict,
) -> tuple[pd.DataFrame, list[str]]:
    """Stage 1: Extract derived features from indicators."""
    print("\n" + "=" * 60)
    print("[extract] Stage 1: Feature extraction")
    print("=" * 60)

    t0 = time.time()
    derived_df, derived_names = extract_derived_features(df, close, config)
    elapsed = time.time() - t0

    print(f"[extract] {len(derived_names)} derived features from {len(df.columns)} indicators")
    print(f"[extract] Time: {elapsed:.1f}s")

    # Save
    output_dir.mkdir(parents=True, exist_ok=True)

    # Parquet output
    derived_df.to_parquet(
        str(output_dir / "extracted_features.parquet"),
        compression="zstd",
        compression_level=3,
    )

    # Stats JSON
    stats = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "n_input_columns": len(df.columns),
        "n_derived_features": len(derived_names),
        "derived_features": derived_names,
        "elapsed_seconds": round(elapsed, 2),
        "n_bars": len(derived_df),
        "nan_pct_per_feature": {
            name: round(float(derived_df[name].isna().mean()), 4)
            for name in derived_names[:50]  # Top 50 to keep file reasonable
        },
    }
    with open(output_dir / "extraction_stats.json", "w") as f:
        json.dump(stats, f, indent=2)

    print(f"[extract] Saved to {output_dir}")
    return derived_df, derived_names


def run_correlate(
    X: np.ndarray,
    feature_names: list[str],
    output_dir: Path,
    threshold: float = 0.90,
    method: str = "spearman",
    importance_ranking: list[str] | None = None,
) -> dict:
    """Stage 2: Correlation analysis."""
    print("\n" + "=" * 60)
    print("[correlate] Stage 2: Correlation analysis")
    print("=" * 60)

    t0 = time.time()

    # Drop columns that are all NaN or constant (zero variance)
    valid_mask = np.ones(X.shape[1], dtype=bool)
    for d in range(X.shape[1]):
        col = X[:, d]
        finite = col[np.isfinite(col)]
        if len(finite) < 10 or np.std(finite) < 1e-10:
            valid_mask[d] = False
    X_valid = X[:, valid_mask]
    names_valid = [feature_names[i] for i in range(len(feature_names)) if valid_mask[i]]
    n_dropped = len(feature_names) - len(names_valid)
    if n_dropped > 0:
        print(f"[correlate] Dropped {n_dropped} all-NaN/constant columns ({len(names_valid)} remaining)")

    results = run_correlation_analysis(
        X_valid, names_valid,
        threshold=threshold,
        method=method,
        importance_ranking=importance_ranking,
    )
    elapsed = time.time() - t0

    print(f"[correlate] {len(results['redundant_pairs'])} redundant pairs (|r| >= {threshold})")
    print(f"[correlate] {results['clusters']['n_clusters']} feature clusters")
    print(f"[correlate] {results['n_after_drops']}/{results['n_original']} features after suggested drops")
    print(f"[correlate] Time: {elapsed:.1f}s")

    # Save
    output_dir.mkdir(parents=True, exist_ok=True)

    # Correlation matrix as parquet (reset index to avoid string index issues)
    corr_for_save = results["correlation_matrix"].copy()
    corr_for_save.insert(0, "feature", corr_for_save.index)
    corr_for_save = corr_for_save.reset_index(drop=True)
    corr_for_save.to_parquet(
        str(output_dir / "correlation_matrix.parquet"),
        compression="zstd",
    )

    # Redundant pairs
    with open(output_dir / "redundant_pairs.json", "w") as f:
        json.dump(results["redundant_pairs"], f, indent=2)

    # Feature clusters
    with open(output_dir / "feature_clusters.json", "w") as f:
        json.dump(results["clusters"], f, indent=2)

    # VIF scores
    if results["vif_results"]:
        with open(output_dir / "vif_scores.json", "w") as f:
            json.dump(results["vif_results"], f, indent=2)

    # Suggested drops
    with open(output_dir / "suggested_drops.json", "w") as f:
        json.dump({
            "suggested_drops": results["suggested_drops"],
            "n_original": results["n_original"],
            "n_after_drops": results["n_after_drops"],
            "threshold": threshold,
            "method": method,
        }, f, indent=2)

    print(f"[correlate] Saved to {output_dir}")
    return results


def run_importance(
    X: np.ndarray,
    y: np.ndarray | None,
    feature_names: list[str],
    output_dir: Path,
    model_predict_fn=None,
    model=None,
    model_type: str | None = None,
    model_assign_fn=None,
    n_repeats: int = 10,
    scoring: str = "accuracy",
    discrete_target: bool = True,
) -> dict:
    """Stage 3: Feature importance analysis."""
    print("\n" + "=" * 60)
    print("[importance] Stage 3: Feature importance analysis")
    print("=" * 60)

    t0 = time.time()

    # Drop warmup rows where most features are NaN
    # Find the first row where >= 80% of features have valid values
    valid_pct = np.mean(np.isfinite(X), axis=1)
    warmup_end = 0
    for i in range(len(X)):
        if valid_pct[i] >= 0.8:
            warmup_end = i
            break

    X_trimmed = X[warmup_end:]
    y_trimmed = y[warmup_end:] if y is not None else None

    # Fill remaining NaN with column median (for scattered NaN after warmup)
    X_clean = X_trimmed.copy()
    for d in range(X_clean.shape[1]):
        col = X_clean[:, d]
        nan_mask = ~np.isfinite(col)
        if np.any(nan_mask):
            median_val = np.nanmedian(col)
            if np.isfinite(median_val):
                col[nan_mask] = median_val
            else:
                col[nan_mask] = 0.0

    # Also handle NaN in target
    if y_trimmed is not None:
        y_valid = np.isfinite(y_trimmed)
        X_clean = X_clean[y_valid]
        y_clean = y_trimmed[y_valid]
    else:
        y_clean = None

    n_dropped = len(X) - len(X_clean)
    if n_dropped > 0:
        print(f"[importance] Skipped {warmup_end} warmup rows, using {len(X_clean)} rows")

    if len(X_clean) < 100:
        print("[importance] Not enough valid rows for importance analysis")
        return {}

    results = run_importance_analysis(
        X_clean, y_clean, feature_names,
        model_predict_fn=model_predict_fn,
        model=model,
        model_type=model_type,
        model_assign_fn=model_assign_fn,
        n_repeats=n_repeats,
        scoring=scoring,
        discrete_target=discrete_target,
    )
    elapsed = time.time() - t0

    # Report top features
    aggregate = results.get("aggregate", [])
    if aggregate:
        print(f"\n[importance] Top 15 features (aggregate rank):")
        for i, feat in enumerate(aggregate[:15]):
            print(f"  {i+1:3d}. {feat['feature']:<40s} rank={feat['aggregate_rank']:.1f}")

    # Cumulative importance elbow
    cumulative = results.get("cumulative", [])
    for pct in [0.80, 0.90, 0.95]:
        for item in cumulative:
            if item["cumulative_pct"] >= pct:
                print(f"[importance] {pct:.0%} importance reached at feature #{item['rank']}")
                break

    print(f"[importance] Time: {elapsed:.1f}s")

    # Save
    output_dir.mkdir(parents=True, exist_ok=True)

    # Importance ranking (aggregate)
    with open(output_dir / "importance_ranking.json", "w") as f:
        json.dump({
            "aggregate": aggregate,
            "permutation": results.get("permutation"),
            "unsupervised_permutation": results.get("unsupervised_permutation"),
            "mutual_information": results.get("mutual_information"),
            "cumulative": cumulative,
            "elapsed_seconds": round(elapsed, 2),
        }, f, indent=2)

    # Recommended features (top features up to 95% cumulative importance)
    recommended = []
    for item in cumulative:
        recommended.append(item["feature"])
        if item["cumulative_pct"] >= 0.95:
            break

    with open(output_dir / "recommended_features.json", "w") as f:
        json.dump({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "n_total": len(feature_names),
            "n_recommended": len(recommended),
            "coverage_pct": 0.95,
            "features": recommended,
        }, f, indent=2)

    print(f"[importance] Saved to {output_dir}")
    return results


# ── Main ──────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Feature engineering research pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Output: data/feature_research/{symbol}/{timeframe}/

Examples:
  python scripts/feature-research.py --symbol ES --timeframe 1h
  python scripts/feature-research.py --symbol ES --timeframe 1h --stages extract,correlate
  python scripts/feature-research.py --symbol ES --timeframe 1h --stages importance --target return_5
  python scripts/feature-research.py --symbol ES --timeframe 1h
        """,
    )
    parser.add_argument("--symbol", type=str, required=True, help="Symbol (e.g., ES, MNQ)")
    parser.add_argument("--timeframe", type=str, required=True, help="Timeframe (e.g., 1h, 1d)")
    parser.add_argument(
        "--stages", type=str, default="extract,correlate,importance",
        help="Comma-separated stages: extract, correlate, importance (default: all)",
    )
    parser.add_argument(
        "--source", type=str, default="parquet", choices=["parquet", "questdb"],
        help="Data source (default: parquet)",
    )
    parser.add_argument(
        "--target", type=str, default="return_5",
        choices=["return_5", "return_10", "regime", "none"],
        help="Target variable for importance analysis (default: return_5)",
    )
    parser.add_argument("--max-bars", type=int, default=0, help="Max bars to load (0 = all)")
    parser.add_argument(
        "--corr-threshold", type=float, default=0.90,
        help="Correlation threshold for redundancy detection (default: 0.90)",
    )
    parser.add_argument(
        "--corr-method", type=str, default="spearman", choices=["spearman", "pearson"],
        help="Correlation method (default: spearman)",
    )
    parser.add_argument("--n-repeats", type=int, default=10, help="Permutation repeats (default: 10)")
    parser.add_argument(
        "--output-dir", type=str, default=None,
        help="Custom output directory (default: data/feature_research/{symbol}/{timeframe})",
    )
    args = parser.parse_args()

    stages = set(args.stages.lower().split(","))
    symbol = args.symbol.upper()
    timeframe = args.timeframe.lower()

    # Output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = OUTPUT_BASE / symbol / timeframe

    print(f"{'=' * 60}")
    print(f"Feature Research Pipeline")
    print(f"  Symbol:    {symbol}")
    print(f"  Timeframe: {timeframe}")
    print(f"  Source:    {args.source}")
    print(f"  Stages:   {', '.join(sorted(stages))}")
    print(f"  Target:   {args.target}")
    print(f"  Output:   {output_dir}")
    print(f"{'=' * 60}")

    total_start = time.time()

    # Load data
    print("\n[load] Loading indicator data...")
    df, close = load_indicator_data(symbol, timeframe, args.source, args.max_bars)

    # Load extraction config
    config = load_extraction_config()

    # Stage 1: Extract
    derived_df = None
    derived_names = None
    if "extract" in stages:
        derived_df, derived_names = run_extract(df, close, output_dir, config)
    else:
        # Try to load previously extracted features
        parquet_path = output_dir / "extracted_features.parquet"
        if parquet_path.exists():
            print(f"[extract] Loading previously extracted features from {parquet_path}")
            derived_df = pd.read_parquet(str(parquet_path))
            derived_names = list(derived_df.columns)
        else:
            print("[extract] No extracted features found. Run with --stages extract first.")

    if derived_df is None or derived_names is None:
        print("[error] No features available for analysis. Exiting.")
        sys.exit(1)

    # Build feature matrix (NaN-safe)
    X = derived_df[derived_names].values.astype(np.float64)

    # Stage 2: Correlate
    corr_results = None
    if "correlate" in stages:
        corr_results = run_correlate(
            X, derived_names, output_dir,
            threshold=args.corr_threshold,
            method=args.corr_method,
        )

    # Stage 3: Importance
    if "importance" in stages:
        # Build target variable
        y = build_target(symbol, timeframe, args.target, close, df)

        if y is None and args.target != "none":
            print(f"[importance] Could not build target '{args.target}', running MI-only")

        # Get importance ranking from correlation stage if available
        importance_ranking = None

        run_importance(
            X, y, derived_names, output_dir,
            n_repeats=args.n_repeats,
            scoring="accuracy",
            discrete_target=True,
        )

    # Final summary
    total_time = time.time() - total_start
    print(f"\n{'=' * 60}")
    print(f"[done] Feature research pipeline completed in {total_time:.1f}s")
    print(f"[done] Results: {output_dir}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
