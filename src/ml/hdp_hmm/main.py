#!/usr/bin/env python3
"""
Sticky HDP-HMM Regime Detection  (Fox et al. 2011 / Teh et al. 2006)

Entry point spawned by Node.js pythonRunner.ts. Loads OHLCV from QuestDB,
computes config-driven features, trains the HDP-HMM Gibbs sampler, and
writes results back to QuestDB.

Usage:
  python src/ml/hdp_hmm/main.py --symbol ES --timeframe 1h \
    --gibbs-iter 500 --burn-in 100 --alpha 1.0 --gamma 1.0 --kappa 50.0 \
    --test-split 0.15 --overlay-interval 25 --json
"""

import argparse
import os
import sys
import time

# Add src/ml/ to sys.path so shared.* and hdp_hmm.* imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np

from shared.protocol import emit_progress, emit_metric, emit_overlay, emit_log, emit_done, emit_error
from shared.features import compute_features, normalize_features, _load_feature_config
from shared.data import load_ohlcv_arrays
from hdp_hmm.model import StickyHDPHMM
from hdp_hmm.io import relabel_states, save_model

try:
    from shared.wandb_logger import create_logger
    _WANDB_AVAILABLE = True
except ImportError:
    _WANDB_AVAILABLE = False


def parse_args():
    parser = argparse.ArgumentParser(description="Sticky HDP-HMM Regime Detection")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--model-id", type=str, default=None, help="Model ID from server (used for output dir and QuestDB)")
    parser.add_argument("--max-bars", type=int, default=0, help="Max bars to load (0 = all available data)")
    parser.add_argument("--date-start", type=str, default=None)
    parser.add_argument("--date-end", type=str, default=None)
    parser.add_argument("--gibbs-iter", type=int, default=500)
    parser.add_argument("--burn-in", type=int, default=100)
    parser.add_argument("--alpha", type=float, default=1.0)
    parser.add_argument("--gamma", type=float, default=1.0)
    parser.add_argument("--kappa", type=float, default=50.0)
    parser.add_argument("--test-split", type=float, default=0.15)
    parser.add_argument("--overlay-interval", type=int, default=25)
    parser.add_argument("--feature-categories", type=str, default=None,
                        help="Comma-separated feature categories (default: all)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--run-significance-tests", action="store_true", default=False,
                        help="Run expensive significance tests (permutation, bootstrap)")
    parser.add_argument("--n-permutations", type=int, default=1000,
                        help="Number of permutations for significance test")
    parser.add_argument("--n-bootstrap", type=int, default=100,
                        help="Number of bootstrap resamples")
    parser.add_argument("--wandb", action=argparse.BooleanOptionalAction, default=True,
                        help="Enable/disable W&B logging (default: enabled)")
    parser.add_argument("--wandb-project", type=str, default=None,
                        help="Override W&B project name")
    return parser.parse_args()


def main():
    args = parse_args()
    t_start = time.time()

    # --- W&B logger setup ---
    wandb_logger = None
    if _WANDB_AVAILABLE:
        try:
            wandb_logger = create_logger(
                model_type="hdp-hmm",
                symbol=args.symbol,
                timeframe=args.timeframe,
                wandb_enabled=args.wandb,
            )
            if args.wandb_project:
                wandb_logger.project = args.wandb_project
            wandb_logger.init_run(
                config={
                    "model_type": "hdp-hmm",
                    "symbol": args.symbol,
                    "timeframe": args.timeframe,
                    "gibbs_iter": args.gibbs_iter,
                    "burn_in": args.burn_in,
                    "alpha": args.alpha,
                    "gamma": args.gamma,
                    "kappa": args.kappa,
                    "test_split": args.test_split,
                    "max_bars": args.max_bars,
                    "feature_categories": args.feature_categories,
                },
                name=f"hdp-hmm-{args.symbol}-{args.timeframe}",
                group="regime-detection",
            )
        except Exception:
            wandb_logger = None

    try:
        # 1. Load data from QuestDB (chunked, with progress events)
        date_range = None
        if args.date_start or args.date_end:
            date_range = {"start": args.date_start, "end": args.date_end}
        bars_label = "all" if args.max_bars == 0 else f"max {args.max_bars}"
        emit_log(f"Loading OHLCV from QuestDB for {args.symbol} {args.timeframe} ({bars_label} bars)")

        data = load_ohlcv_arrays(args.symbol, args.timeframe, args.max_bars, date_range)
        n_bars = len(data["close"])
        emit_log(f"Loaded {n_bars} bars for {args.symbol} {args.timeframe}")

        if n_bars < 100:
            emit_error(f"Insufficient data: {n_bars} bars (need >= 100)")
            sys.exit(1)

        # 2. Compute features (config-driven — reads src/config/features.json)
        emit_progress(0, args.gibbs_iter, "computing_features")
        categories = args.feature_categories.split(",") if args.feature_categories else None
        cat_label = ", ".join(categories) if categories else "all"
        emit_log(f"Computing features from raw OHLCV (categories: {cat_label})...")
        X_raw, feature_names, timestamps = compute_features(data, categories=categories)
        emit_log(f"Computed {len(feature_names)} features: {', '.join(feature_names[:5])}...")

        # 3. Normalize (params from config/features.json)
        feat_config = _load_feature_config()
        norm_cfg = feat_config.get("normalization", {})
        lookback = norm_cfg.get("lookback", 250)
        clip_range = tuple(norm_cfg.get("clip", [-5, 5]))
        emit_progress(0, args.gibbs_iter, "normalizing")
        emit_log(f"Normalizing features (rolling z-score, lookback={lookback}, clip={clip_range})...")
        X = normalize_features(X_raw, lookback=lookback, clip_range=clip_range)

        # Drop NaN rows (warmup period)
        valid_mask = ~np.any(np.isnan(X), axis=1)
        X_valid = X[valid_mask]
        timestamps_valid = [t for t, v in zip(timestamps, valid_mask) if v]
        features_valid = X_raw[valid_mask]

        emit_log(f"After normalization: {len(X_valid)} valid bars ({n_bars - len(X_valid)} warmup dropped)")

        if len(X_valid) < 100:
            emit_error(f"Insufficient valid data after normalization: {len(X_valid)} bars")
            sys.exit(1)

        # 4. Train
        model = StickyHDPHMM(
            alpha=args.alpha,
            gamma=args.gamma,
            kappa=args.kappa,
        )
        model, iteration_metrics, wf_counts = model.fit(
            X_valid,
            n_iter=args.gibbs_iter,
            burn_in=args.burn_in,
            overlay_interval=args.overlay_interval,
            timestamps=timestamps_valid,
        )

        # --- W&B: log per-iteration metrics ---
        if wandb_logger:
            try:
                for m in iteration_metrics:
                    wandb_logger.log_metrics(
                        {
                            "log_likelihood": m.get("log_likelihood"),
                            "n_active_states": m.get("n_active_states"),
                            "delta": m.get("delta"),
                            "entropy": m.get("entropy"),
                            "switch_rate": m.get("switch_rate"),
                            "self_transition": m.get("self_transition"),
                            "max_regime_pct": m.get("max_regime_pct"),
                            "avg_dwell": m.get("avg_dwell"),
                        },
                        step=m.get("iter", 0),
                    )
            except Exception:
                pass

        # 4b. Resolve close values for save pipeline
        close_valid = [float(c) for c, v in zip(data["close"], valid_mask) if v]

        # 5. Save (includes evaluation pipeline Stages 1-5)
        emit_progress(args.gibbs_iter, args.gibbs_iter, "saving")
        elapsed = time.time() - t_start
        model_path, diagnostics = save_model(
            model, timestamps_valid, features_valid, feature_names, args, elapsed,
            iteration_metrics=iteration_metrics,
            wf_counts=wf_counts,
            close_vals=close_valid,
        )

        eval_grade = diagnostics.get("evaluation", {}).get("grade", "F")
        emit_log(f"Evaluation grade: {eval_grade}")
        emit_metric("evaluation_grade_ord", ord(eval_grade) - ord("A"), args.gibbs_iter)

        # --- W&B: log visualizations and save artifact ---
        if wandb_logger:
            try:
                iters = [m.get("iter", i) for i, m in enumerate(iteration_metrics)]
                lls = [m.get("log_likelihood", 0) for m in iteration_metrics]
                wandb_logger.log_convergence_plot(iters, lls)
            except Exception:
                pass
            try:
                n_states = model.transition_matrix.shape[0]
                state_labels = [f"S{i}" for i in range(n_states)]
                wandb_logger.log_transition_matrix(model.transition_matrix, state_labels)
            except Exception:
                pass
            try:
                wandb_logger.log_regime_distribution(model.state_sequence)
            except Exception:
                pass
            try:
                wandb_logger.save_model_artifact(
                    model_path,
                    name=f"hdp-hmm-{args.symbol}-{args.timeframe}",
                    metadata={
                        "symbol": args.symbol,
                        "timeframe": args.timeframe,
                        "gibbs_iter": args.gibbs_iter,
                        "n_regimes": int(diagnostics.get("n_regimes", 0)),
                        "evaluation_grade": eval_grade,
                    },
                )
            except Exception:
                pass

        # 6. Final overlay
        relabeled, colors, labels, _ = relabel_states(model.state_sequence, features_valid)
        emit_overlay(timestamps_valid, relabeled, colors, labels)

        # 7. Done
        emit_done(model_path, diagnostics)

    except Exception as e:
        import traceback
        emit_error(str(e), traceback.format_exc())
        sys.exit(1)
    finally:
        if wandb_logger:
            try:
                wandb_logger.finish()
            except Exception:
                pass


if __name__ == "__main__":
    main()
