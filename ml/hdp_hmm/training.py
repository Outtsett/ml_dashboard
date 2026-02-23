"""
HDP-HMM Training Pipelines
============================

Full training pipelines for single-symbol and universal (multi-symbol) models.

Each pipeline:
  1. Load data
  2. Extract market vital signs (features)
  3. Split chronologically (train | test)
  4. Normalize (fit on train only)
  5. Run Gibbs sampler -> discovers K regimes automatically
  6. Walk-forward validation -> proves regimes are real
  7. OOS evaluation -> proves regimes generalize
  8. Full dataset analysis
  9. Save everything
"""

import json
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional

import joblib  # type: ignore[import-untyped]
import numpy as np
import pandas as pd  # type: ignore[import-untyped]
from sklearn.preprocessing import StandardScaler  # type: ignore[import-untyped]

from .analysis import analyze_regimes
from .config import DEFAULT_FEATURES, OUTPUT_DIR, WARMUP_BARS
from .data import load_ohlcv_data
from .features import compute_features
from .indicators import merge_features_with_indicators
from .model import StickyHDPHMM
from .validation import assess_oos_stability, walk_forward_validation


def _compute_quality_score(
    convergence_history: list[dict[str, Any]],
    wf: dict,
    oos_results: dict,
) -> float:
    """Compute a 0-100 quality score from convergence, walk-forward, and OOS metrics."""
    quality_components: list[float] = []

    # Convergence quality (LL stabilized?)
    if len(convergence_history) >= 10:
        last_deltas = [h["delta"] for h in convergence_history[-10:]]
        avg_delta = float(np.mean(last_deltas))
        if avg_delta < 100:
            quality_components.append(25)
        elif avg_delta < 500:
            quality_components.append(15)
        else:
            quality_components.append(5)
    else:
        quality_components.append(10)

    # Walk-forward stability
    quality_components.append(wf["stability_score"] * 25)

    # OOS distribution similarity
    quality_components.append(oos_results["distribution_similarity"] * 25)

    # OOS profile correlation
    quality_components.append(
        min(max(oos_results["avg_profile_correlation"], 0), 1) * 25
    )

    return round(sum(quality_components), 1)


# ==============================================================================
# Single-Symbol Training
# ==============================================================================


def train_hdp_hmm(
    symbol: str,
    timeframe: str = "30m",
    start: Optional[str] = None,
    end: Optional[str] = None,
    gibbs_iter: int = 100,
    burn_in: int = 30,
    test_split: float = 0.15,
    walk_forward_windows: int = 5,
    alpha: float = 1.0,
    gamma: float = 5.0,
    kappa: float = 50.0,
    data_file: Optional[str] = None,
    include_indicators: bool = False,
    indicator_groups: Optional[list[Any]] = None,
) -> dict:
    """
    Full HDP-HMM training pipeline. No max_regimes -- the model discovers K.

    Think of it as:
      1. Load data
      2. Extract market vital signs (features)
      3. Split chronologically (train | test)
      4. Normalize (fit on train only)
      5. Run Gibbs sampler -> discovers K regimes automatically
      6. Walk-forward validation -> proves regimes are real
      7. OOS evaluation -> proves regimes generalize
      8. Full dataset analysis
      9. Save everything
    """
    t0 = time.time()
    total_steps = 9

    print(f"{'=' * 60}")
    print("HDP-HMM Regime Training (True Nonparametric)")
    print(f"  Symbol: {symbol}")
    print(f"  Timeframe: {timeframe}")
    print(f"  Gibbs Iterations: {gibbs_iter} (burn-in: {burn_in})")
    print(f"  Test Split: {test_split:.0%}")
    print(f"  Walk-Forward Windows: {walk_forward_windows}")
    print(f"  Hyperparams: alpha={alpha}, gamma={gamma}, kappa={kappa}")
    if include_indicators:
        groups_str = ", ".join(indicator_groups) if indicator_groups else "all"
        print(f"  Indicators: ENABLED (groups: {groups_str})")
    print("  NOTE: # regimes discovered automatically (no cap)")
    print(f"{'=' * 60}")
    sys.stdout.flush()

    # [1/9] Load data
    if data_file:
        print(f"\n[1/{total_steps}] Loading OHLCV data from pre-exported parquet...")
        sys.stdout.flush()
        df = load_ohlcv_data(symbol, timeframe, start, end, data_file)
    else:
        print(f"\n[1/{total_steps}] Loading OHLCV data from DuckDB...")
        sys.stdout.flush()
        df = load_ohlcv_data(symbol, timeframe, start, end)

    if len(df) == 0:
        raise ValueError(f"No data found for {symbol}")

    print(f"  Loaded {len(df):,} bars ({df['ts'].iloc[0]} -> {df['ts'].iloc[-1]})")
    sys.stdout.flush()

    if len(df) < 500:
        raise ValueError(
            f"Insufficient data: {len(df)} bars (need 500+). "
            f"Try a lower timeframe or broader date range."
        )

    # [2/9] Compute features
    print(
        f"\n[2/{total_steps}] Computing features "
        f"({len(DEFAULT_FEATURES)} core dimensions)..."
    )
    sys.stdout.flush()
    features_df = compute_features(df)

    # Optionally merge pre-computed indicator features
    if include_indicators:
        print("  Merging normalized indicator features...")
        sys.stdout.flush()
        features_df = merge_features_with_indicators(
            features_df, symbol, timeframe, indicator_groups
        )

    feature_cols = [c for c in features_df.columns if c != "ts"]
    print(f"  Feature matrix: {len(features_df):,} bars x {len(feature_cols)} features")
    sys.stdout.flush()

    # [3/9] Train/Test Split
    print(
        f"\n[3/{total_steps}] Splitting data "
        f"(train+val {1 - test_split:.0%} / test {test_split:.0%})..."
    )
    sys.stdout.flush()

    n_total = len(features_df)
    test_size = int(n_total * test_split)
    train_val_size = n_total - test_size

    train_val_df = features_df.iloc[:train_val_size].copy()
    test_df = features_df.iloc[train_val_size:].copy()

    print(
        f"  Train+Val: {train_val_size:,} bars "
        f"({features_df['ts'].iloc[0]} -> {features_df['ts'].iloc[train_val_size - 1]})"
    )
    print(
        f"  Test:      {test_size:,} bars "
        f"({features_df['ts'].iloc[train_val_size]} -> {features_df['ts'].iloc[-1]})"
    )
    sys.stdout.flush()

    # [4/9] Standardize
    print(f"\n[4/{total_steps}] Standardizing features (fit on train+val only)...")
    sys.stdout.flush()

    scaler = StandardScaler()
    X_train_val = scaler.fit_transform(train_val_df[feature_cols].values)
    X_test = scaler.transform(test_df[feature_cols].values)
    X_all = scaler.transform(features_df[feature_cols].values)

    X_train_val = np.clip(X_train_val, -5, 5)
    X_test = np.clip(X_test, -5, 5)
    X_all = np.clip(X_all, -5, 5)

    print(
        f"  Train+Val stats: mean={X_train_val.mean():.4f}, "
        f"std={X_train_val.std():.4f}, "
        f"range=[{X_train_val.min():.2f}, {X_train_val.max():.2f}]"
    )
    print(
        f"  Test stats:      mean={X_test.mean():.4f}, "
        f"std={X_test.std():.4f}, "
        f"range=[{X_test.min():.2f}, {X_test.max():.2f}]"
    )
    sys.stdout.flush()

    # [5/9] Gibbs sampling (discovers K automatically)
    print(
        f"\n[5/{total_steps}] Running HDP-HMM Gibbs sampler "
        f"(auto-discovering regimes)..."
    )
    sys.stdout.flush()

    # Emit timestamps once for live chart regime coloring
    train_val_ts = train_val_df["ts"].values
    ts_epoch = np.array(
        [int(pd.Timestamp(t).timestamp()) for t in train_val_ts], dtype=np.int64
    )
    live_dir = OUTPUT_DIR / f"{symbol}_{timeframe}"
    live_dir.mkdir(parents=True, exist_ok=True)
    ts_file = str(live_dir / "live_timestamps.bin")
    ts_epoch.tofile(ts_file)
    print(
        f'__REGIME_META__{{"count":{len(ts_epoch)},'
        f'"first_ts":{int(ts_epoch[0])},'
        f'"last_ts":{int(ts_epoch[-1])}}}'
    )
    sys.stdout.flush()

    # Determine snapshot frequency based on data size
    T_train = len(train_val_df)
    snapshot_every = 1 if T_train < 10000 else 5 if T_train < 50000 else 10

    # Write regime snapshots to a sidecar file
    snapshot_file = str(live_dir / "live_snapshot.bin")

    def emit_regime_snapshot(iteration: int, assignments: np.ndarray) -> None:
        """Write regime assignments to file + emit small notification."""
        if iteration % snapshot_every == 0 or iteration == 1:
            np.array(assignments, dtype=np.uint8).tofile(snapshot_file)
            print(f'__REGIME_SNAP__{{"iter":{iteration}}}')
            sys.stdout.flush()

    model = StickyHDPHMM(
        alpha=alpha,
        gamma=gamma,
        kappa=kappa,
        max_states=30,
        n_iter=gibbs_iter,
        burn_in=burn_in,
        random_state=42,
    )
    model.fit(X_train_val, snapshot_callback=emit_regime_snapshot)
    n_regimes = model.n_components

    print(f"\n  --> Discovered {n_regimes} regimes automatically")
    sys.stdout.flush()

    # [6/9] Walk-forward validation
    print(
        f"\n[6/{total_steps}] Walk-forward validation "
        f"({walk_forward_windows} windows)..."
    )
    sys.stdout.flush()

    wf = walk_forward_validation(
        X_train_val,
        n_windows=walk_forward_windows,
        gibbs_iter=max(30, gibbs_iter // 2),
        burn_in=max(10, burn_in // 2),
        random_state=42,
        kappa=kappa,
        gamma=gamma,
        alpha=alpha,
    )

    for w in wf["window_results"]:
        if not w.get("failed", False):
            dist_str = " ".join([f"{p:.1%}" for p in w["regime_distribution"]])
            print(
                f"    Window {w['window']}: k={w['n_regimes_found']} "
                f"train={w['train_ll_per_sample']:.4f}  "
                f"test={w['test_ll_per_sample']:.4f}  "
                f"regimes=[{dist_str}]"
            )
            sys.stdout.flush()

    print(f"\n  Walk-Forward Stability: {wf['stability_score']:.3f}")
    sys.stdout.flush()

    # [7/9] Out-of-sample evaluation
    print(f"\n[7/{total_steps}] Out-of-sample evaluation on held-out test set...")
    sys.stdout.flush()

    oos_results = assess_oos_stability(model, X_train_val, X_test, feature_cols)

    print(f"  Distribution Similarity: {oos_results['distribution_similarity']:.3f}")
    print(f"  Avg Profile Correlation: {oos_results['avg_profile_correlation']:.3f}")
    print(f"  Test Confidence: {oos_results['avg_test_confidence']:.3f}")
    print(f"  Switch Rate (train): {oos_results['train_switch_rate']:.4f}")
    print(f"  Switch Rate (test):  {oos_results['test_switch_rate']:.4f}")
    for pc in oos_results["profile_consistency"]:
        if pc.get("insufficient_data"):
            print(f"    Regime {pc['regime']}: insufficient test data")
        else:
            print(
                f"    Regime {pc['regime']}: profile corr={pc['correlation']:.3f} "
                f"(train={pc['train_count']:,} / test={pc['test_count']:,})"
            )
    sys.stdout.flush()

    # [8/9] Full dataset analysis
    print(f"\n[8/{total_steps}] Analyzing {n_regimes} regimes on full dataset...")
    sys.stdout.flush()

    aligned_df = df.iloc[WARMUP_BARS:].reset_index(drop=True)
    close_prices = aligned_df["close"].values.astype(np.float64)
    timestamps = features_df["ts"].values

    analysis = analyze_regimes(
        model, X_all, feature_cols, np.asarray(timestamps), close_prices
    )

    print("\n  Regime Summary:")
    print(
        f"  {'ID':>3} {'Label':<20} {'Bars':>8} {'%':>6} "
        f"{'AvgReturn':>10} {'AvgRange':>10} {'AvgDur':>7}"
    )
    print(f"  {'-' * 3} {'-' * 20} {'-' * 8} {'-' * 6} {'-' * 10} {'-' * 10} {'-' * 7}")
    for r in analysis["regime_stats"]:
        print(
            f"  {r['regime_id']:>3} {r['label']:<20} {r['count']:>8,} "
            f"{r['pct']:>5.1f}% "
            f"{r['avg_return']:>10.6f} {r['avg_range']:>10.6f} "
            f"{r['avg_duration']:>6.1f}"
        )
    sys.stdout.flush()

    # [9/9] Save
    print(f"\n[9/{total_steps}] Saving results...")
    sys.stdout.flush()

    out_dir = OUTPUT_DIR / f"{symbol}_{timeframe}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Save model
    model_data = {
        "model": model,
        "scaler": scaler,
        "feature_cols": feature_cols,
        "n_components": n_regimes,
        "symbol": symbol,
        "timeframe": timeframe,
        "model_type": "hdp-hmm",
    }
    joblib.dump(model_data, out_dir / "model.pkl")

    # Save regime assignments
    regime_df = pd.DataFrame(
        {
            "ts": timestamps,
            "close": close_prices,
            "regime": analysis["state_sequence"],
            "regime_label": [
                analysis["regime_stats"][s]["label"] for s in analysis["state_sequence"]
            ],
        }
    )
    for k in range(n_regimes):
        regime_df[f"prob_regime_{k}"] = analysis["state_probs"][:, k]
    regime_df["split"] = "train"
    regime_df.iloc[train_val_size:, regime_df.columns.get_loc("split")] = "test"  # type: ignore[index]
    regime_df.to_parquet(out_dir / "regimes.parquet", index=False)

    # Save features
    features_df.to_parquet(out_dir / "features.parquet", index=False)

    # Save convergence
    convergence_data = {"gibbs": model.convergence_history_}
    with open(out_dir / "convergence.json", "w", encoding="utf-8") as f:
        json.dump(convergence_data, f, indent=2, default=str)

    # Quality score
    elapsed = time.time() - t0
    quality_score = _compute_quality_score(model.convergence_history_, wf, oos_results)

    diagnostics = {
        "symbol": symbol,
        "timeframe": timeframe,
        "model_type": "hdp-hmm",
        "n_regimes": n_regimes,
        "n_bars_total": len(features_df),
        "n_bars_train_val": train_val_size,
        "n_bars_test": test_size,
        "n_features": len(feature_cols),
        "feature_names": feature_cols,
        "date_range": {
            "start": str(timestamps[0]),
            "end": str(timestamps[-1]),
            "train_end": str(features_df["ts"].iloc[train_val_size - 1]),
            "test_start": str(features_df["ts"].iloc[train_val_size]),
        },
        "quality_score": quality_score,
        "n_regimes_discovered": n_regimes,
        "gibbs_iterations": gibbs_iter,
        "burn_in": burn_in,
        "hyperparams": {
            "alpha": alpha,
            "gamma": gamma,
            "kappa": kappa,
        },
        "convergence_summary": {
            "n_iterations": len(model.convergence_history_),
            "final_log_likelihood": (
                model.convergence_history_[-1]["log_likelihood"]
                if model.convergence_history_
                else 0
            ),
            "final_active_states": (
                model.convergence_history_[-1]["n_active_states"]
                if model.convergence_history_
                else n_regimes
            ),
        },
        "walk_forward": wf,
        "out_of_sample": oos_results,
        "regime_stats": analysis["regime_stats"],
        "transitions": analysis["transitions"],
        "transition_matrix": (
            model.transmat_.tolist() if model.transmat_ is not None else []
        ),
        "scaler_means": scaler.mean_.tolist() if scaler.mean_ is not None else [],
        "scaler_stds": scaler.scale_.tolist() if scaler.scale_ is not None else [],
        "training_config": {
            "gibbs_iter": gibbs_iter,
            "burn_in": burn_in,
            "test_split": test_split,
            "walk_forward_windows": walk_forward_windows,
            "alpha": alpha,
            "gamma": gamma,
            "kappa": kappa,
        },
        "training_time_sec": round(elapsed, 2),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    with open(out_dir / "diagnostics.json", "w", encoding="utf-8") as f:
        json.dump(diagnostics, f, indent=2, default=str)

    print(f"\n  Saved to {out_dir}/")
    print(
        f"    model.pkl           "
        f"({(out_dir / 'model.pkl').stat().st_size / 1024:.1f} KB)"
    )
    print(
        f"    regimes.parquet     "
        f"({(out_dir / 'regimes.parquet').stat().st_size / 1024:.1f} KB)"
    )
    print(
        f"    features.parquet   "
        f"({(out_dir / 'features.parquet').stat().st_size / 1024:.1f} KB)"
    )
    print("    diagnostics.json")
    print("    convergence.json")
    print(f"\n  Quality Score: {quality_score}/100")
    print(f"  Regimes Discovered: {n_regimes}")
    print(f"  Training complete in {elapsed:.1f}s")
    print(f"{'=' * 60}\n")
    sys.stdout.flush()

    return diagnostics


# ==============================================================================
# Universal Multi-Symbol Training
# ==============================================================================


def train_universal(
    symbols: list[str],
    timeframe: str = "30m",
    start: Optional[str] = None,
    end: Optional[str] = None,
    gibbs_iter: int = 100,
    burn_in: int = 30,
    test_split: float = 0.15,
    walk_forward_windows: int = 5,
    alpha: float = 1.0,
    gamma: float = 5.0,
    kappa: float = 50.0,
    data_files: Optional[dict[Any, Any]] = None,
    include_indicators: bool = False,
    indicator_groups: Optional[list[Any]] = None,
) -> dict:
    """
    Train a UNIVERSAL HDP-HMM on multiple symbols simultaneously.

    Think of it as: training a doctor to recognize patient conditions (regimes)
    by showing them patients from many different hospitals (symbols). Each
    patient's vitals are normalized to their own baseline, so the doctor learns
    "what does a stressed heart look like?" regardless of whether the patient
    is tall or short, heavy or light.

    Steps:
      1. Load data for each symbol independently
      2. Compute features (rolling z-scores normalize each symbol to itself)
      3. Concatenate all symbols' features into one big training matrix
      4. Run a SINGLE StandardScaler on the combined data
      5. Train ONE HDP-HMM that sees patterns from ALL symbols
      6. Walk-forward + OOS validation on the combined dataset
      7. Save as universal__{timeframe}/ model
    """
    t0 = time.time()
    total_steps = 9

    print(f"{'=' * 60}")
    print("UNIVERSAL HDP-HMM Regime Training")
    print(f"  Symbols: {', '.join(symbols)} ({len(symbols)} total)")
    print(f"  Timeframe: {timeframe}")
    print(f"  Gibbs Iterations: {gibbs_iter} (burn-in: {burn_in})")
    print(f"  Test Split: {test_split:.0%}")
    print(f"  Hyperparams: alpha={alpha}, gamma={gamma}, kappa={kappa}")
    print("  NOTE: All features are self-normalized (rolling z-scores)")
    if include_indicators:
        groups_str = ", ".join(indicator_groups) if indicator_groups else "all"
        print(f"  Indicators: ENABLED (groups: {groups_str})")
    print("  NOTE: # regimes discovered automatically (no cap)")
    print(f"{'=' * 60}")
    sys.stdout.flush()

    # [1/9] Load data for all symbols
    print(f"\n[1/{total_steps}] Loading OHLCV data for {len(symbols)} symbols...")
    sys.stdout.flush()

    symbol_data: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
    symbol_boundaries: list[dict] = []
    total_bars = 0

    for sym in symbols:
        try:
            data_file_path = data_files.get(sym) if data_files else None
            df = load_ohlcv_data(sym, timeframe, start, end, data_file_path)

            if len(df) < 500:
                print(f"  SKIP {sym}: only {len(df)} bars (need 500+)")
                continue

            features_df = compute_features(df)

            # Optionally merge indicator features
            if include_indicators:
                features_df = merge_features_with_indicators(
                    features_df, sym, timeframe, indicator_groups
                )

            symbol_data[sym] = (df, features_df)
            n = len(features_df)
            symbol_boundaries.append(
                {
                    "symbol": sym,
                    "start_idx": total_bars,
                    "end_idx": total_bars + n,
                    "n_bars": n,
                    "date_range": (
                        f"{features_df['ts'].iloc[0]} -> {features_df['ts'].iloc[-1]}"
                    ),
                }
            )
            total_bars += n
            print(
                f"  OK {sym}: {n:,} bars "
                f"({features_df['ts'].iloc[0]} -> {features_df['ts'].iloc[-1]})"
            )
        except (ValueError, RuntimeError, OSError) as e:
            print(f"  SKIP {sym}: {e}")
        sys.stdout.flush()

    if len(symbol_data) < 2:
        raise ValueError(
            f"Need at least 2 symbols for universal training, got {len(symbol_data)}"
        )

    active_symbols = list(symbol_data.keys())
    print(f"\n  Total: {total_bars:,} bars from {len(active_symbols)} symbols")
    sys.stdout.flush()

    # [2/9] Concatenate features
    print(f"\n[2/{total_steps}] Concatenating features from all symbols...")
    sys.stdout.flush()

    all_features_list: list[pd.DataFrame] = []
    all_timestamps_list: list[np.ndarray] = []
    all_close_list: list[np.ndarray] = []
    all_symbol_labels: list[str] = []

    for sym in active_symbols:
        df, features_df = symbol_data[sym]
        all_features_list.append(features_df)
        all_timestamps_list.append(np.asarray(features_df["ts"].values))
        aligned_df = df.iloc[WARMUP_BARS:].reset_index(drop=True)
        all_close_list.append(aligned_df["close"].values.astype(np.float64))
        all_symbol_labels.extend([sym] * len(features_df))

    combined_features = pd.concat(all_features_list, ignore_index=True)
    feature_cols = [c for c in combined_features.columns if c != "ts"]
    combined_timestamps = np.concatenate(all_timestamps_list)
    combined_close = np.concatenate(all_close_list)

    print(
        f"  Combined matrix: {len(combined_features):,} bars "
        f"x {len(feature_cols)} features"
    )
    sys.stdout.flush()

    # [3/9] Train/Test Split (chronological per symbol, then combine)
    print(
        f"\n[3/{total_steps}] Splitting data per-symbol "
        f"(train+val {1 - test_split:.0%} / test {test_split:.0%})..."
    )
    sys.stdout.flush()

    train_indices: list[int] = []
    test_indices: list[int] = []
    offset = 0

    for sym in active_symbols:
        _, features_df = symbol_data[sym]
        n = len(features_df)
        test_size = int(n * test_split)
        train_size = n - test_size

        train_indices.extend(range(offset, offset + train_size))
        test_indices.extend(range(offset + train_size, offset + n))
        offset += n

    train_val_df = combined_features.iloc[train_indices].copy()
    test_df = combined_features.iloc[test_indices].copy()
    train_val_size = len(train_indices)
    test_size_total = len(test_indices)

    print(f"  Train+Val: {train_val_size:,} bars")
    print(f"  Test:      {test_size_total:,} bars")
    sys.stdout.flush()

    # [4/9] Standardize (single scaler across all symbols)
    print(
        f"\n[4/{total_steps}] Standardizing features "
        f"(single scaler across all symbols)..."
    )
    sys.stdout.flush()

    scaler = StandardScaler()
    X_train_val = scaler.fit_transform(train_val_df[feature_cols].values)
    X_test = scaler.transform(test_df[feature_cols].values)
    X_all = scaler.transform(combined_features[feature_cols].values)

    X_train_val = np.clip(X_train_val, -5, 5)
    X_test = np.clip(X_test, -5, 5)
    X_all = np.clip(X_all, -5, 5)

    print(
        f"  Train+Val stats: mean={X_train_val.mean():.4f}, "
        f"std={X_train_val.std():.4f}, "
        f"range=[{X_train_val.min():.2f}, {X_train_val.max():.2f}]"
    )
    print(
        f"  Test stats:      mean={X_test.mean():.4f}, "
        f"std={X_test.std():.4f}, "
        f"range=[{X_test.min():.2f}, {X_test.max():.2f}]"
    )
    sys.stdout.flush()

    # [5/9] Gibbs sampling
    print(f"\n[5/{total_steps}] Running UNIVERSAL HDP-HMM Gibbs sampler...")
    sys.stdout.flush()

    # Emit timestamps for live chart coloring
    train_val_ts = train_val_df["ts"].values
    ts_epoch = np.array(
        [int(pd.Timestamp(t).timestamp()) for t in train_val_ts], dtype=np.int64
    )
    model_id = f"universal_{timeframe}"
    live_dir = OUTPUT_DIR / model_id
    live_dir.mkdir(parents=True, exist_ok=True)
    ts_file = str(live_dir / "live_timestamps.bin")
    ts_epoch.tofile(ts_file)
    print(
        f'__REGIME_META__{{"count":{len(ts_epoch)},'
        f'"first_ts":{int(ts_epoch[0])},'
        f'"last_ts":{int(ts_epoch[-1])}}}'
    )
    sys.stdout.flush()

    T_train = len(train_val_df)
    snapshot_every = 1 if T_train < 10000 else 5 if T_train < 50000 else 10
    snapshot_file = str(live_dir / "live_snapshot.bin")

    def emit_regime_snapshot(iteration: int, assignments: np.ndarray) -> None:
        if iteration % snapshot_every == 0 or iteration == 1:
            np.array(assignments, dtype=np.uint8).tofile(snapshot_file)
            print(f'__REGIME_SNAP__{{"iter":{iteration}}}')
            sys.stdout.flush()

    model = StickyHDPHMM(
        alpha=alpha,
        gamma=gamma,
        kappa=kappa,
        max_states=30,
        n_iter=gibbs_iter,
        burn_in=burn_in,
        random_state=42,
    )
    model.fit(X_train_val, snapshot_callback=emit_regime_snapshot)
    n_regimes = model.n_components

    print(
        f"\n  --> Discovered {n_regimes} regimes across {len(active_symbols)} symbols"
    )
    sys.stdout.flush()

    # [6/9] Walk-forward validation
    print(
        f"\n[6/{total_steps}] Walk-forward validation "
        f"({walk_forward_windows} windows)..."
    )
    sys.stdout.flush()

    wf = walk_forward_validation(
        X_train_val,
        n_windows=walk_forward_windows,
        gibbs_iter=max(30, gibbs_iter // 2),
        burn_in=max(10, burn_in // 2),
        random_state=42,
        kappa=kappa,
        gamma=gamma,
        alpha=alpha,
    )

    for w in wf["window_results"]:
        if not w.get("failed", False):
            dist_str = " ".join([f"{p:.1%}" for p in w["regime_distribution"]])
            print(
                f"    Window {w['window']}: k={w['n_regimes_found']} "
                f"train={w['train_ll_per_sample']:.4f}  "
                f"test={w['test_ll_per_sample']:.4f}  "
                f"regimes=[{dist_str}]"
            )
            sys.stdout.flush()

    print(f"\n  Walk-Forward Stability: {wf['stability_score']:.3f}")
    sys.stdout.flush()

    # [7/9] Out-of-sample evaluation
    print(f"\n[7/{total_steps}] Out-of-sample evaluation...")
    sys.stdout.flush()

    oos_results = assess_oos_stability(model, X_train_val, X_test, feature_cols)

    print(f"  Distribution Similarity: {oos_results['distribution_similarity']:.3f}")
    print(f"  Avg Profile Correlation: {oos_results['avg_profile_correlation']:.3f}")
    sys.stdout.flush()

    # [8/9] Full dataset analysis
    print(
        f"\n[8/{total_steps}] Analyzing {n_regimes} regimes on full combined dataset..."
    )
    sys.stdout.flush()

    analysis = analyze_regimes(
        model, X_all, feature_cols, combined_timestamps, combined_close
    )

    print(f"\n  Regime Summary ({len(active_symbols)} symbols combined):")
    print(
        f"  {'ID':>3} {'Label':<20} {'Bars':>8} {'%':>6} "
        f"{'AvgReturn':>10} {'AvgRange':>10} {'AvgDur':>7}"
    )
    print(f"  {'-' * 3} {'-' * 20} {'-' * 8} {'-' * 6} {'-' * 10} {'-' * 10} {'-' * 7}")
    for r in analysis["regime_stats"]:
        print(
            f"  {r['regime_id']:>3} {r['label']:<20} {r['count']:>8,} "
            f"{r['pct']:>5.1f}% "
            f"{r['avg_return']:>10.6f} {r['avg_range']:>10.6f} "
            f"{r['avg_duration']:>6.1f}"
        )
    sys.stdout.flush()

    # [9/9] Save
    print(f"\n[9/{total_steps}] Saving universal model...")
    sys.stdout.flush()

    out_dir = OUTPUT_DIR / model_id
    out_dir.mkdir(parents=True, exist_ok=True)

    model_data = {
        "model": model,
        "scaler": scaler,
        "feature_cols": feature_cols,
        "n_components": n_regimes,
        "symbols": active_symbols,
        "timeframe": timeframe,
        "model_type": "hdp-hmm-universal",
        "symbol_boundaries": symbol_boundaries,
    }
    joblib.dump(model_data, out_dir / "model.pkl")

    # Save combined regime assignments
    regime_df = pd.DataFrame(
        {
            "ts": combined_timestamps,
            "close": combined_close,
            "symbol": all_symbol_labels,
            "regime": analysis["state_sequence"],
            "regime_label": [
                analysis["regime_stats"][s]["label"] for s in analysis["state_sequence"]
            ],
        }
    )
    for k in range(n_regimes):
        regime_df[f"prob_regime_{k}"] = analysis["state_probs"][:, k]
    regime_df.to_parquet(out_dir / "regimes.parquet", index=False)

    # Save features
    combined_features["symbol"] = all_symbol_labels
    combined_features.to_parquet(out_dir / "features.parquet", index=False)

    # Save convergence
    convergence_data = {"gibbs": model.convergence_history_}
    with open(out_dir / "convergence.json", "w", encoding="utf-8") as f:
        json.dump(convergence_data, f, indent=2, default=str)

    # Per-symbol regime assignments
    offset = 0
    for sym in active_symbols:
        _, features_df = symbol_data[sym]
        n = len(features_df)
        sym_dir = out_dir / "per_symbol" / sym
        sym_dir.mkdir(parents=True, exist_ok=True)

        sym_regime_df = regime_df.iloc[offset : offset + n].copy()
        sym_regime_df.to_parquet(sym_dir / "regimes.parquet", index=False)
        offset += n

    elapsed = time.time() - t0

    quality_score = _compute_quality_score(model.convergence_history_, wf, oos_results)

    diagnostics = {
        "symbol": "UNIVERSAL",
        "symbols": active_symbols,
        "timeframe": timeframe,
        "model_type": "hdp-hmm-universal",
        "n_regimes": n_regimes,
        "n_bars_total": total_bars,
        "n_bars_train_val": train_val_size,
        "n_bars_test": test_size_total,
        "n_features": len(feature_cols),
        "feature_names": feature_cols,
        "n_symbols": len(active_symbols),
        "symbol_boundaries": symbol_boundaries,
        "quality_score": quality_score,
        "n_regimes_discovered": n_regimes,
        "gibbs_iterations": gibbs_iter,
        "burn_in": burn_in,
        "hyperparams": {"alpha": alpha, "gamma": gamma, "kappa": kappa},
        "convergence_summary": {
            "n_iterations": len(model.convergence_history_),
            "final_log_likelihood": (
                model.convergence_history_[-1]["log_likelihood"]
                if model.convergence_history_
                else 0
            ),
            "final_active_states": (
                model.convergence_history_[-1]["n_active_states"]
                if model.convergence_history_
                else n_regimes
            ),
        },
        "walk_forward": wf,
        "out_of_sample": oos_results,
        "regime_stats": analysis["regime_stats"],
        "transitions": analysis["transitions"],
        "transition_matrix": (
            model.transmat_.tolist() if model.transmat_ is not None else []
        ),
        "scaler_means": scaler.mean_.tolist() if scaler.mean_ is not None else [],
        "scaler_stds": scaler.scale_.tolist() if scaler.scale_ is not None else [],
        "training_config": {
            "gibbs_iter": gibbs_iter,
            "burn_in": burn_in,
            "test_split": test_split,
            "walk_forward_windows": walk_forward_windows,
            "alpha": alpha,
            "gamma": gamma,
            "kappa": kappa,
        },
        "training_time_sec": round(elapsed, 2),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    with open(out_dir / "diagnostics.json", "w", encoding="utf-8") as f:
        json.dump(diagnostics, f, indent=2, default=str)

    print(f"\n  Saved to {out_dir}/")
    print(
        f"    model.pkl           "
        f"({(out_dir / 'model.pkl').stat().st_size / 1024:.1f} KB)"
    )
    print(
        f"    regimes.parquet     "
        f"({(out_dir / 'regimes.parquet').stat().st_size / 1024:.1f} KB)"
    )
    print(
        f"    features.parquet    "
        f"({(out_dir / 'features.parquet').stat().st_size / 1024:.1f} KB)"
    )
    print("    diagnostics.json")
    print("    convergence.json")
    print(f"    per_symbol/         ({len(active_symbols)} symbol subdirs)")
    print(f"\n  Quality Score: {quality_score}/100")
    print(f"  Regimes Discovered: {n_regimes}")
    print(f"  Training complete in {elapsed:.1f}s")
    print(f"{'=' * 60}\n")
    sys.stdout.flush()

    return diagnostics
