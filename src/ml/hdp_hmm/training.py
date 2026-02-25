"""
HDP-HMM Training Pipelines
============================

Full training pipelines for single-symbol and universal (multi-symbol) models.

Standalone: no DuckDB, QuestDB, or external database required.
Reads data from pre-computed indicator parquets OR computes features
on-the-fly from raw OHLCV CSV/Parquet files.

Single-symbol pipeline (sequential walk-forward):
  1. Load features from normalized parquet OR compute from OHLCV on-the-fly
  2. Roll a training window through data chronologically, predicting OOS
  3. Train reference model on most recent window (the "live" model)
  4. Re-predict all bars with reference model for consistent labels
  5. Regime analysis + SHAP
  6. Save everything
"""

import io
import json
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional

import joblib  # type: ignore[import-untyped]
import numpy as np
import pandas as pd  # type: ignore[import-untyped]
from sklearn.preprocessing import StandardScaler  # type: ignore[import-untyped]

from pathlib import Path

from .analysis import analyze_regimes
from .config import OUTPUT_DIR, WARMUP_BARS, SKIP_COLUMNS
from .data import load_ohlcv_data
from .model import StickyHDPHMM
from .shap_analysis import compute_shap_explanations, save_shap_results
from .validation import assess_oos_stability, walk_forward_validation

SRC_DIR = Path(__file__).parent.parent.parent       # src/
PROJECT_DIR = SRC_DIR.parent                         # project root
FEATURES_DIR = PROJECT_DIR / "data" / "features"


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
    timeframe: str = "1m",
    gibbs_iter: int = 100,
    burn_in: int = 30,
    walk_forward_windows: int = 5,
    alpha: float = 1.0,
    gamma: float = 5.0,
    kappa: float = 50.0,
    indicator_groups: Optional[list[Any]] = None,
    train_window_weeks: int = 8,
    step_weeks: int = 2,
    wf_gibbs_iter: int = 50,
    data_file: Optional[str] = None,
    **kwargs: Any,
) -> dict:
    """
    Train HDP-HMM via sequential walk-forward.

    Simulates live training: rolls a window through data chronologically,
    training on historical bars and predicting the next chunk OOS.
    A reference model trained on the most recent window provides consistent
    regime labels across the entire dataset.

    Standalone: reads from pre-computed normalized.parquet if available,
    otherwise computes features on-the-fly from raw OHLCV data.
    No DuckDB or external database required.
    """
    t0 = time.time()
    SECONDS_PER_WEEK = 7 * 24 * 3600
    D_FEATURES = 0  # set after loading

    # ── [1/7] Load pre-computed features from parquet ─────────────────────
    parquet = data_file or str(FEATURES_DIR / timeframe / symbol / "normalized.parquet")
    parquet = Path(parquet)

    if not parquet.exists():
        raise FileNotFoundError(
            f"No feature parquet at {parquet}. "
            f"Run: python scripts/normalize-indicators.py --symbols {symbol} --timeframes {timeframe}"
        )

    import pyarrow.parquet as pq

    print(f"[1/7] Loading features from {parquet}...")
    sys.stdout.flush()

    pq_schema = pq.read_schema(parquet)
    all_cols = pq_schema.names

    skip = SKIP_COLUMNS | {"ts", "timestamp", "close"}
    feature_cols = sorted(c for c in all_cols if c not in skip)

    # Read metadata: ts + close
    ts_col = "ts" if "ts" in all_cols else "timestamp"
    meta_cols = [ts_col] + (["close"] if "close" in all_cols else [])
    df_meta = pd.read_parquet(parquet, columns=meta_cols)
    n_total = len(df_meta)

    ts_series = pd.to_datetime(df_meta[ts_col])
    ts_min, ts_max = str(ts_series.min()), str(ts_series.max())

    print(f"{'=' * 60}")
    print(f"HDP-HMM | {symbol} {timeframe} | {n_total:,} bars | {len(feature_cols)} features")
    print(f"  {ts_min} -> {ts_max}")
    print(f"  Walk-forward: {train_window_weeks}w train, {step_weeks}w step, {wf_gibbs_iter} Gibbs/window")
    print(f"  Reference: {gibbs_iter} Gibbs (burn-in {burn_in}) | alpha={alpha} gamma={gamma} kappa={kappa}")
    print(f"{'=' * 60}")
    sys.stdout.flush()

    if n_total < 500:
        raise ValueError(f"Only {n_total} bars (need 500+)")

    ts_epoch = (ts_series.astype(np.int64) // 10**9).values.astype(np.int64)
    close_prices = (
        df_meta["close"].values.astype(np.float64)
        if "close" in df_meta.columns
        else np.zeros(n_total)
    )
    D_FEATURES = len(feature_cols)
    del df_meta

    est_mb = n_total * D_FEATURES * 4 // 1024 // 1024
    print(f"  ~{est_mb} MB features | ({n_total}, {D_FEATURES}) lazy loading")
    sys.stdout.flush()

    # Week numbers for windowing
    week_num = (ts_epoch - ts_epoch[0]) // SECONDS_PER_WEEK
    max_week = int(week_num[-1])

    # ── Data accessor: lazy from parquet ──────────────────────────────────
    def _get_features(mask: np.ndarray) -> np.ndarray:
        """Load feature data for rows matching mask."""
        indices = np.where(mask)[0]
        if len(indices) == 0:
            return np.empty((0, D_FEATURES), dtype=np.float32)
        ts_lo = pd.Timestamp(int(ts_epoch[indices[0]]), unit="s")
        ts_hi = pd.Timestamp(int(ts_epoch[indices[-1]]), unit="s")
        df = pd.read_parquet(
            parquet,
            columns=[ts_col] + feature_cols,
            filters=[(ts_col, ">=", ts_lo), (ts_col, "<=", ts_hi)],
        )
        return df[feature_cols].fillna(0).values.astype(np.float32)

    def _get_all_features() -> np.ndarray:
        """Load all feature columns."""
        print(f"  Loading all {n_total:,} x {D_FEATURES} features from parquet...")
        sys.stdout.flush()
        df = pd.read_parquet(parquet, columns=feature_cols)
        return df.fillna(0).values.astype(np.float32)

    # ── [2/7] Sequential walk-forward ─────────────────────────────────────
    # Build window schedule: rolling training window, predict next step
    windows: list[tuple[int, int, int]] = []
    for w_start in range(0, max_week - train_window_weeks + 1, step_weeks):
        w_train_end = w_start + train_window_weeks
        w_predict_end = min(w_train_end + step_weeks, max_week + 1)
        if w_predict_end > w_train_end:
            windows.append((w_start, w_train_end, w_predict_end))

    n_windows = len(windows)
    print(
        f"\n[2/7] Sequential walk-forward ({n_windows} windows, {train_window_weeks}w train, {step_weeks}w step)..."
    )
    sys.stdout.flush()

    wf_results: list[dict[str, Any]] = []
    wf_oos_lls: list[float] = []
    wf_regime_counts: list[int] = []
    wf_burn = max(5, wf_gibbs_iter // 3)

    for wi, (w_start, w_train_end, w_predict_end) in enumerate(windows):
        train_mask_w = (week_num >= w_start) & (week_num < w_train_end)
        predict_mask_w = (week_num >= w_train_end) & (week_num < w_predict_end)
        T_train_w = int(train_mask_w.sum())
        T_predict_w = int(predict_mask_w.sum())

        if T_train_w < 200 or T_predict_w < 50:
            continue

        # Load features for this window only (single parquet read)
        combined_mask = (week_num >= w_start) & (week_num < w_predict_end)
        X_combined = _get_features(combined_mask)
        X_train_w = X_combined[:T_train_w]
        X_predict_w = X_combined[T_train_w:]

        # Standardize per-window (only training data stats)
        mean_w = np.nanmean(X_train_w, axis=0).astype(np.float32)
        std_w = np.nanstd(X_train_w, axis=0, ddof=1).astype(np.float32)
        std_w[std_w <= 0] = 1.0

        X_train_std = np.clip((X_train_w - mean_w) / std_w, -5, 5)
        X_predict_std = np.clip((X_predict_w - mean_w) / std_w, -5, 5)

        # Fit HDP-HMM (suppress per-iteration output for walk-forward windows)
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            mdl = StickyHDPHMM(
                alpha=alpha,
                gamma=gamma,
                kappa=kappa,
                n_iter=wf_gibbs_iter,
                burn_in=wf_burn,
                random_state=42 + wi,
            )
            mdl.fit(X_train_std)
        finally:
            sys.stdout = old_stdout

        n_k = mdl.n_active_
        train_ll = mdl.score(X_train_std)
        oos_ll = mdl.score(X_predict_std)
        train_ll_bar = train_ll / max(T_train_w, 1)
        oos_ll_bar = oos_ll / max(T_predict_w, 1)

        wf_oos_lls.append(oos_ll_bar)
        wf_regime_counts.append(n_k)
        wf_results.append(
            {
                "window": wi + 1,
                "weeks": f"{w_start}-{w_train_end}",
                "predict_weeks": f"{w_train_end}-{w_predict_end}",
                "train_bars": T_train_w,
                "predict_bars": T_predict_w,
                "n_regimes": n_k,
                "train_ll_bar": round(train_ll_bar, 4),
                "oos_ll_bar": round(oos_ll_bar, 4),
            }
        )

        # Emit window progress (parsed by pythonRunner.ts)
        print(
            f"  Window {wi + 1}/{n_windows}: k={n_k} "
            f"train_ll={train_ll_bar:.2f}/bar oos_ll={oos_ll_bar:.2f}/bar "
            f"(weeks {w_start}-{w_train_end} -> {w_predict_end})"
        )
        # Update overall progress
        if (wi + 1) % 5 == 0 or wi == n_windows - 1:
            pct_done = (wi + 1) / n_windows
            print(f"[2/7] Walk-forward {wi + 1}/{n_windows} ({pct_done:.0%})...")
        sys.stdout.flush()

    # Walk-forward summary
    if wf_oos_lls:
        mean_oos_ll = float(np.mean(wf_oos_lls))
        regime_std = float(np.std(wf_regime_counts))
        regime_stability = max(
            0.0, 1.0 - regime_std / max(np.mean(wf_regime_counts), 1)
        )
    else:
        mean_oos_ll = 0.0
        regime_stability = 0.0

    print(f"  Walk-forward complete: {len(wf_results)} windows")
    print(
        f"  Mean OOS LL: {mean_oos_ll:.3f}/bar | Regime stability: {regime_stability:.3f}"
    )
    print(f"Walk-Forward Stability: {regime_stability:.3f}")
    sys.stdout.flush()

    # ── [3/7] Train reference model on most recent window ─────────────────
    ref_start = max(0, max_week - train_window_weeks)
    ref_end = max_week + 1
    ref_mask = (week_num >= ref_start) & (week_num < ref_end)
    X_ref_raw = _get_features(ref_mask)
    ts_ref = ts_epoch[ref_mask]

    # Standardize reference window (this scaler is saved for live use)
    ref_mean = np.nanmean(X_ref_raw, axis=0).astype(np.float32)
    ref_std = np.nanstd(X_ref_raw, axis=0, ddof=1).astype(np.float32)
    ref_std[ref_std <= 0] = 1.0
    X_ref_std = np.clip((X_ref_raw - ref_mean) / ref_std, -5, 5)

    scaler = StandardScaler()
    scaler.mean_ = ref_mean.astype(np.float64)
    scaler.scale_ = ref_std.astype(np.float64)
    scaler.var_ = scaler.scale_**2
    scaler.n_features_in_ = len(feature_cols)
    scaler.n_samples_seen_ = np.full(len(feature_cols), len(X_ref_std), dtype=np.int64)

    print(
        f"\n[3/7] Training reference model (weeks {ref_start}-{ref_end}, {len(X_ref_std):,} bars)..."
    )
    sys.stdout.flush()

    # Live regime coloring for reference model
    live_dir = OUTPUT_DIR / f"{symbol}_{timeframe}"
    live_dir.mkdir(parents=True, exist_ok=True)
    ts_ref.tofile(str(live_dir / "live_timestamps.bin"))
    print(
        f'__REGIME_META__{{"count":{len(ts_ref)},'
        f'"first_ts":{int(ts_ref[0])},"last_ts":{int(ts_ref[-1])}}}'
    )
    sys.stdout.flush()

    T_ref = len(X_ref_std)
    snap_every = 1 if T_ref < 10000 else 5 if T_ref < 50000 else 10
    snap_file = str(live_dir / "live_snapshot.bin")

    def on_snapshot(iteration: int, assignments: np.ndarray) -> None:
        if iteration % snap_every == 0 or iteration == 1:
            np.array(assignments, dtype=np.uint8).tofile(snap_file)
            print(f'__REGIME_SNAP__{{"iter":{iteration}}}')
            sys.stdout.flush()

    model = StickyHDPHMM(
        alpha=alpha,
        gamma=gamma,
        kappa=kappa,
        n_iter=gibbs_iter,
        burn_in=burn_in,
        random_state=42,
    )
    model.fit(X_ref_std, snapshot_callback=on_snapshot)
    n_regimes = model.n_active_

    print(f"\n  Discovered {n_regimes} regimes")
    print(f"Discovered {n_regimes} regimes")
    sys.stdout.flush()

    # ── [4/7] Re-predict all bars with reference model ────────────────────
    print(f"\n[4/7] Predicting all {n_total:,} bars with reference model...")
    sys.stdout.flush()

    # Load all features (deferred until now) and standardize
    X_all = _get_all_features()
    X_all_std = np.clip((X_all - ref_mean) / ref_std, -5, 5)
    del X_all  # free raw features

    # Timestamps as datetime objects for analysis
    timestamps = np.array(
        [np.datetime64(int(e), "s") for e in ts_epoch], dtype="datetime64[s]"
    )

    # ── [5/7] Regime analysis ─────────────────────────────────────────────
    print(f"\n[5/7] Regime analysis...")
    sys.stdout.flush()

    analysis = analyze_regimes(model, X_all_std, feature_cols, timestamps, close_prices)
    for r in analysis["regime_stats"]:
        print(
            f"    R{r['regime_id']}: {r['label']:<18} {r['count']:>8,} "
            f"({r['pct']:.1f}%) ret={r['avg_return']:.6f}"
        )
    sys.stdout.flush()

    # ── [6/7] SHAP explanations ───────────────────────────────────────────
    print(f"\n[6/7] SHAP explanations...")
    sys.stdout.flush()

    shap_results = None
    try:
        shap_results = compute_shap_explanations(
            model=model,
            X=X_all_std,
            feature_names=feature_cols,
            n_background=min(200, len(X_all_std) // 5),
            n_explain=min(500, len(X_all_std) // 3),
            random_state=42,
        )
        if shap_results and "error" in shap_results:
            print(f"  Skipped: {shap_results['error']}")
            shap_results = None
    except Exception as e:
        print(f"  Failed (non-fatal): {e}")
        shap_results = None
    sys.stdout.flush()

    # ── [7/7] Save ────────────────────────────────────────────────────────
    print(f"\n[7/7] Saving...")
    sys.stdout.flush()

    out_dir = OUTPUT_DIR / f"{symbol}_{timeframe}"
    out_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(
        {
            "model": model,
            "scaler": scaler,
            "feature_cols": feature_cols,
            "n_components": n_regimes,
            "symbol": symbol,
            "timeframe": timeframe,
            "model_type": "hdp-hmm",
        },
        out_dir / "model.pkl",
    )

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
    regime_df.to_parquet(out_dir / "regimes.parquet", index=False)

    with open(out_dir / "convergence.json", "w", encoding="utf-8") as f:
        json.dump({"gibbs": model.convergence_history_}, f, indent=2, default=str)

    if shap_results:
        save_shap_results(shap_results, out_dir)

    elapsed = time.time() - t0

    # Quality score from walk-forward + reference model convergence
    quality_components: list[float] = []
    # Convergence quality (25 pts)
    if len(model.convergence_history_) >= 5:
        last_deltas = [h["delta"] for h in model.convergence_history_[-5:]]
        avg_delta = float(np.mean(last_deltas))
        quality_components.append(
            25 if avg_delta < 100 else 15 if avg_delta < 500 else 5
        )
    else:
        quality_components.append(10)
    # Walk-forward OOS quality (25 pts)
    if mean_oos_ll > -50:
        quality_components.append(25)
    elif mean_oos_ll > -100:
        quality_components.append(15)
    else:
        quality_components.append(5)
    # Regime stability across windows (25 pts)
    quality_components.append(regime_stability * 25)
    # Regime count reasonableness (25 pts)
    quality_components.append(
        25 if 3 <= n_regimes <= 15 else 15 if n_regimes <= 25 else 5
    )
    quality = round(sum(quality_components), 1)

    print(f"Quality Score: {quality}")
    sys.stdout.flush()

    diagnostics = {
        "symbol": symbol,
        "timeframe": timeframe,
        "model_type": "hdp-hmm",
        "n_regimes": n_regimes,
        "n_bars_total": n_total,
        "n_features": len(feature_cols),
        "feature_names": feature_cols,
        "date_range": {"start": str(timestamps[0]), "end": str(timestamps[-1])},
        "split_method": f"sequential_walk_forward ({n_windows} windows, {train_window_weeks}w train, {step_weeks}w step)",
        "quality_score": quality,
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
        "walk_forward": {
            "n_windows": len(wf_results),
            "window_results": wf_results,
            "mean_oos_ll_bar": round(mean_oos_ll, 4),
            "regime_stability": round(regime_stability, 4),
            "stability_score": round(regime_stability, 4),
        },
        "regime_stats": analysis["regime_stats"],
        "transitions": analysis["transitions"],
        "transition_matrix": model.transmat_.tolist()
        if model.transmat_ is not None
        else [],
        "scaler_means": scaler.mean_.tolist(),
        "scaler_stds": scaler.scale_.tolist(),
        "training_config": {
            "gibbs_iter": gibbs_iter,
            "burn_in": burn_in,
            "wf_gibbs_iter": wf_gibbs_iter,
            "train_window_weeks": train_window_weeks,
            "step_weeks": step_weeks,
            "alpha": alpha,
            "gamma": gamma,
            "kappa": kappa,
        },
        "training_time_sec": round(elapsed, 2),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "shap": {
            "computed": shap_results is not None,
            "global_top_10": list(shap_results["global_importance"].items())[:10]
            if shap_results
            else [],
            "computation_time_sec": shap_results.get("computation_time_sec", 0)
            if shap_results
            else 0,
        },
    }
    with open(out_dir / "diagnostics.json", "w", encoding="utf-8") as f:
        json.dump(diagnostics, f, indent=2, default=str)

    print(f"\n  Quality: {quality}/100 | Regimes: {n_regimes} | {elapsed:.1f}s")
    print(
        f"  Walk-forward: {len(wf_results)} windows, mean OOS LL={mean_oos_ll:.3f}/bar"
    )
    print(f"  Saved to {out_dir}/")
    print("Training complete")
    print(f"{'=' * 60}")
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
    total_steps = 10

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

    # [1/10] Load data for all symbols
    print(f"\n[1/{total_steps}] Loading OHLCV data for {len(symbols)} symbols...")
    sys.stdout.flush()

    symbol_data: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
    symbol_boundaries: list[dict] = []
    total_bars = 0

    for sym in symbols:
        try:
            pq_path = data_files.get(sym) if data_files else None
            if pq_path is None:
                pq_path = str(FEATURES_DIR / timeframe / sym / "normalized.parquet")

            if not Path(pq_path).exists():
                print(f"  SKIP {sym}: no feature parquet at {pq_path}")
                continue

            features_df = pd.read_parquet(pq_path)
            ts_col = "ts" if "ts" in features_df.columns else "timestamp"

            if len(features_df) < 500:
                print(f"  SKIP {sym}: only {len(features_df)} bars (need 500+)")
                continue

            # Also load OHLCV for close prices used in analysis
            df = load_ohlcv_data(sym, timeframe, start, end)

            symbol_data[sym] = (df, features_df)
            n = len(features_df)
            symbol_boundaries.append(
                {
                    "symbol": sym,
                    "start_idx": total_bars,
                    "end_idx": total_bars + n,
                    "n_bars": n,
                    "date_range": (
                        f"{features_df[ts_col].iloc[0]} -> {features_df[ts_col].iloc[-1]}"
                    ),
                }
            )
            total_bars += n
            print(
                f"  OK {sym}: {n:,} bars "
                f"({features_df[ts_col].iloc[0]} -> {features_df[ts_col].iloc[-1]})"
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

    # [2/10] Concatenate features
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

    # [3/10] Train/Test Split (chronological per symbol, then combine)
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

    # [4/10] Standardize (single scaler across all symbols)
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

    # [5/10] Gibbs sampling
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

    # [6/10] Walk-forward validation
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

    # [7/10] Out-of-sample evaluation
    print(f"\n[7/{total_steps}] Out-of-sample evaluation...")
    sys.stdout.flush()

    oos_results = assess_oos_stability(model, X_train_val, X_test, feature_cols)

    print(f"  Distribution Similarity: {oos_results['distribution_similarity']:.3f}")
    print(f"  Avg Profile Correlation: {oos_results['avg_profile_correlation']:.3f}")
    sys.stdout.flush()

    # [8/10] Full dataset analysis
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

    # [9/10] SHAP explainability
    print(f"\n[9/{total_steps}] Computing SHAP feature explanations...")
    sys.stdout.flush()

    shap_results = None
    try:
        shap_results = compute_shap_explanations(
            model=model,
            X=X_all,
            feature_names=feature_cols,
            n_background=min(200, len(X_all) // 5),
            n_explain=min(500, len(X_all) // 3),
            random_state=42,
        )
        if "error" in shap_results:
            print(f"  SHAP skipped: {shap_results['error']}")
            shap_results = None
    except Exception as e:
        print(f"  SHAP failed (non-fatal): {e}")
        shap_results = None
    sys.stdout.flush()

    # [10/10] Save
    print(f"\n[10/{total_steps}] Saving universal model...")
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

    # Save SHAP results
    if shap_results is not None:
        save_shap_results(shap_results, out_dir)

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
        "shap": {
            "computed": shap_results is not None,
            "global_top_10": (
                list(shap_results["global_importance"].items())[:10]
                if shap_results
                else []
            ),
            "computation_time_sec": (
                shap_results.get("computation_time_sec", 0) if shap_results else 0
            ),
        },
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
    if shap_results is not None:
        print("    shap_summary.json")
        print("    shap_values.npz")
    print(f"    per_symbol/         ({len(active_symbols)} symbol subdirs)")
    print(f"\n  Quality Score: {quality_score}/100")
    print(f"  Regimes Discovered: {n_regimes}")
    print(f"  Training complete in {elapsed:.1f}s")
    print(f"{'=' * 60}\n")
    sys.stdout.flush()

    return diagnostics
