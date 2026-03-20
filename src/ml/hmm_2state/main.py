#!/usr/bin/env python3
"""
2-State Bull/Bear HMM Regime Detection (Baum-Welch EM)

Entry point spawned by Node.js pythonRunner.ts. Loads OHLCV from QuestDB,
computes config-driven features, trains a 2-state Gaussian HMM, and
writes results back to QuestDB.

Usage:
  python src/ml/hmm_2state/main.py --symbol ES --timeframe 1h \
    --em-iter 100 --n-restarts 5 --test-split 0.15 --json
"""

import argparse
import os
import sys
import time

# Add src/ml/ to sys.path so shared.* and hmm_2state.* imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np

from shared.protocol import emit_progress, emit_log, emit_done, emit_error
from shared.features import compute_features, normalize_features, _load_feature_config
from shared.data import load_ohlcv_arrays
from hmm_2state.model import GaussianHMM2State
from hmm_2state.io import save_model

try:
    from shared.wandb_logger import create_logger
    _WANDB_AVAILABLE = True
except ImportError:
    _WANDB_AVAILABLE = False


def parse_args():
    parser = argparse.ArgumentParser(description="2-State Bull/Bear HMM")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--model-id", type=str, default=None, help="Model ID from server (used for output dir and QuestDB)")
    parser.add_argument("--max-bars", type=int, default=0, help="Max bars to load (0 = all)")
    parser.add_argument("--date-start", type=str, default=None)
    parser.add_argument("--date-end", type=str, default=None)
    parser.add_argument("--em-iter", type=int, default=100)
    parser.add_argument("--n-restarts", type=int, default=5)
    parser.add_argument("--test-split", type=float, default=0.15)
    parser.add_argument("--overlay-interval", type=int, default=10)
    parser.add_argument("--feature-categories", type=str, default=None,
                        help="Comma-separated feature categories (default: all)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--run-significance-tests", action="store_true", default=False,
                        help="Run expensive significance tests")
    parser.add_argument("--n-permutations", type=int, default=1000)
    parser.add_argument("--n-bootstrap", type=int, default=100)
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
                model_type="hmm-2state",
                symbol=args.symbol,
                timeframe=args.timeframe,
                wandb_enabled=args.wandb,
            )
            if args.wandb_project:
                wandb_logger.project = args.wandb_project
            wandb_logger.init_run(
                config={
                    "model_type": "hmm-2state",
                    "symbol": args.symbol,
                    "timeframe": args.timeframe,
                    "em_iter": args.em_iter,
                    "n_restarts": args.n_restarts,
                    "test_split": args.test_split,
                    "max_bars": args.max_bars,
                    "feature_categories": args.feature_categories,
                },
                name=f"hmm-2state-{args.symbol}-{args.timeframe}",
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

        # 2. Compute features (config-driven)
        emit_progress(0, args.em_iter * args.n_restarts, "computing_features")
        categories = args.feature_categories.split(",") if args.feature_categories else None
        cat_label = ", ".join(categories) if categories else "all"
        emit_log(f"Computing features from raw OHLCV (categories: {cat_label})...")
        X_raw, feature_names, timestamps = compute_features(data, categories=categories)
        emit_log(f"Computed {len(feature_names)} features: {', '.join(feature_names[:5])}...")

        # 3. Normalize
        feat_config = _load_feature_config()
        norm_cfg = feat_config.get("normalization", {})
        lookback = norm_cfg.get("lookback", 250)
        clip_range = tuple(norm_cfg.get("clip", [-5, 5]))
        emit_progress(0, args.em_iter * args.n_restarts, "normalizing")
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
        model = GaussianHMM2State()
        model, iteration_metrics = model.fit(
            X_valid,
            n_iter=args.em_iter,
            overlay_interval=args.overlay_interval,
            timestamps=timestamps_valid,
            n_restarts=args.n_restarts,
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
                            "restart": m.get("restart"),
                            "em_iter": m.get("em_iter"),
                            "switch_rate": m.get("switch_rate"),
                            "self_transition": m.get("self_transition"),
                        },
                        step=m.get("iter", 0),
                    )
            except Exception:
                pass

        # 4b. Resolve close values for save pipeline
        close_valid = [float(c) for c, v in zip(data["close"], valid_mask) if v]

        # 5. Save (includes evaluation pipeline Stages 1-5)
        total_iter = args.em_iter * args.n_restarts
        emit_progress(total_iter, total_iter, "saving")
        elapsed = time.time() - t_start
        model_path, diagnostics = save_model(
            model, timestamps_valid, features_valid, feature_names, args, elapsed,
            iteration_metrics=iteration_metrics,
            close_vals=close_valid,
        )

        eval_grade = diagnostics.get("evaluation", {}).get("grade", "F")
        emit_log(f"Evaluation grade: {eval_grade}")

        # --- W&B: log visualizations and save artifact ---
        if wandb_logger:
            try:
                iters = [m.get("iter", i) for i, m in enumerate(iteration_metrics)]
                lls = [m.get("log_likelihood", 0) for m in iteration_metrics]
                wandb_logger.log_convergence_plot(iters, lls)
            except Exception:
                pass
            try:
                wandb_logger.log_transition_matrix(
                    model.transition_matrix,
                    ["Bullish", "Bearish"],
                )
            except Exception:
                pass
            try:
                wandb_logger.log_regime_distribution(
                    model.state_sequence,
                    ["Bullish", "Bearish"],
                )
            except Exception:
                pass
            try:
                wandb_logger.save_model_artifact(
                    model_path,
                    name=f"hmm-2state-{args.symbol}-{args.timeframe}",
                    metadata={
                        "symbol": args.symbol,
                        "timeframe": args.timeframe,
                        "em_iter": args.em_iter,
                        "n_restarts": args.n_restarts,
                        "evaluation_grade": eval_grade,
                    },
                )
            except Exception:
                pass

        # 6. Done
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
