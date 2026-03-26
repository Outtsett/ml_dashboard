"""Save model artifacts — orchestrator for 2-State HMM."""

import io
import json
import time
from pathlib import Path

from datetime import datetime

import numpy as np

# Reuse model-agnostic analysis modules from hdp_hmm.io
from shared.labeling import renumber_states, assign_colors, get_labeler
from hdp_hmm.io.regime_stats import compute_regime_stats, compute_transitions
from hdp_hmm.io.evaluation import compute_oos_evaluation
from hdp_hmm.io.shap import compute_shap_values
from hdp_hmm.io.quality import compute_quality_score
from shared.evaluation import run_all_stages

from hmm_2state.config import LABELS


class _NumpyEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy types (numpy 2.x compatible)."""

    def default(self, obj):
        if hasattr(np, "bool_") and isinstance(obj, np.bool_):
            return bool(obj)
        if hasattr(np, "bool") and isinstance(obj, np.bool):
            return bool(obj)
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.generic):
            return obj.item()
        return super().default(obj)


def _fmt_ts(ts) -> str:
    """Format timestamp for QuestDB /imp: yyyy-MM-ddTHH:mm:ss.000000Z"""
    if isinstance(ts, datetime):
        return ts.strftime("%Y-%m-%dT%H:%M:%S.000000Z")
    s = str(ts).replace(" ", "T")
    if not s.endswith("Z"):
        s += ".000000Z" if "." not in s else "Z"
    return s


def save_model(
    model,
    timestamps,
    features,
    feature_names,
    args,
    elapsed,
    iteration_metrics=None,
    close_vals=None,
):
    """Save model artifacts to data/models/<modelId>/."""
    # Use cwd (set by Node runner) for reliable path resolution
    project_root = Path.cwd()
    model_id = args.model_id if args.model_id else f"{args.symbol}_{args.timeframe}_2state"
    output_dir = project_root / "data" / "models" / model_id
    output_dir.mkdir(parents=True, exist_ok=True)

    T = len(timestamps)
    n_regimes = model.K

    # Use BullBearLabeler via Strategy pattern
    bb_labeler = get_labeler("bull_bear")
    regime_features_by_id = {}
    for k in range(n_regimes):
        mask = model.state_sequence == k
        regime_features_by_id[k] = features[mask] if np.any(mask) else np.empty((0, features.shape[1]))
    bb_labeler.fit(regime_features_by_id)

    # Renumber states and assign colors
    renum = renumber_states(model.state_sequence)
    relabeled, _ = renum.states, renum.n_regimes
    colors = assign_colors(n_regimes)

    # Resolve close values and splits
    split_idx = int(T * (1 - args.test_split))
    splits = ["train"] * split_idx + ["test"] * (T - split_idx)

    # Per-bar labels via BullBearLabeler
    ret_col = 0
    regime_label_map = {}
    regime_category_map = {}
    for k in range(n_regimes):
        mask = relabeled == k
        regime_feats = features[mask]
        avg_ret = float(np.mean(regime_feats[:, ret_col])) if np.any(mask) else 0.0
        avg_vol = float(np.std(regime_feats[:, ret_col])) if np.any(mask) else 0.0
        pct = float(np.sum(mask)) / T * 100
        lr = bb_labeler.label(k, regime_feats, feature_names, avg_ret, avg_vol, 0.0, pct)
        regime_label_map[k] = lr.label
        regime_category_map[k] = lr.category

    regime_label_list = [regime_label_map.get(int(r), f"Regime {r}") for r in relabeled]
    regime_category_list = [regime_category_map.get(int(r), "range") for r in relabeled]

    if close_vals is None:
        close_vals = [0.0] * T
    ts_vals = timestamps

    # 1. Write regime assignments to disk CSV
    csv_buf = io.StringIO()
    csv_buf.write("model_id,symbol,ts,close,regime,regime_label,split,category\n")
    for i in range(T):
        ts_str = _fmt_ts(ts_vals[i])
        rl = str(regime_label_list[i]).replace(",", " ")
        cat = str(regime_category_list[i])
        csv_buf.write(
            f"{model_id},{args.symbol},{ts_str},{float(close_vals[i])},{int(relabeled[i])},{rl},{splits[i]},{cat}\n"
        )

    # 1b. Save assignments to disk as CSV
    assignments_path = output_dir / "assignments.csv"
    try:
        assignments_path.write_text(csv_buf.getvalue(), encoding="utf-8")
    except Exception as e:
        print(
            f"[save] Warning: Failed to write assignments.csv to disk: {e}",
            file=__import__("sys").stderr,
        )

    # 2. convergence.json — EM iteration metrics
    if iteration_metrics:
        convergence = {
            "em": iteration_metrics,
            "n_iterations": len(iteration_metrics),
        }
    else:
        convergence = {
            "em": [
                {"iter": i + 1, "log_likelihood": float(ll)}
                for i, ll in enumerate(model.log_likelihoods)
            ],
            "n_iterations": len(model.log_likelihoods),
        }
    with open(output_dir / "convergence.json", "w") as f:
        json.dump(convergence, f, cls=_NumpyEncoder)

    # 3. Regime stats (reuse from hdp_hmm.io — model-agnostic, with BullBear labeler)
    regime_stats = compute_regime_stats(relabeled, features, feature_names, labeler=bb_labeler)

    # 4. Transitions
    trans_matrix = model.transition_matrix[:n_regimes, :n_regimes].tolist()
    transitions = compute_transitions(trans_matrix, n_regimes)

    # 5. OOS evaluation
    oos = compute_oos_evaluation(relabeled, features, split_idx, n_regimes)

    # 6. SHAP values → diagnostics.json
    shap_matrix, shap_summary = compute_shap_values(
        model, features, relabeled, feature_names, n_regimes
    )

    # 7. Quality score
    quality_score = compute_quality_score(model, relabeled, n_regimes, T, oos=oos)

    # 7b. Statistical evaluation pipeline (Stages 1-5)
    split_mask = np.array([s == "train" for s in splits])
    close_arr = np.array(close_vals, dtype=np.float64)
    # 2-state HMM may have posteriors for confidence
    posteriors = getattr(model, "posteriors_", None)
    conf_arr = posteriors.max(axis=1) if posteriors is not None and posteriors.ndim == 2 else None
    tm = (
        model.transition_matrix[:n_regimes, :n_regimes]
        if hasattr(model, "transition_matrix")
        else None
    )
    run_sig = getattr(args, "run_significance_tests", False)
    eval_iter = getattr(args, "em_iter", 0) * getattr(args, "n_restarts", 1)
    evaluation_results = run_all_stages(
        features=features,
        assignments=np.array(relabeled),
        close=close_arr,
        split_mask=split_mask,
        confidence=conf_arr,
        transition_matrix=tm,
        run_significance=run_sig,
        iteration=eval_iter,
    )

    # 8. Convergence summary
    final_ll = float(model.log_likelihoods[-1]) if model.log_likelihoods else 0.0
    convergence_summary = {
        "n_iterations": len(model.log_likelihoods),
        "final_log_likelihood": final_ll,
        "final_active_states": n_regimes,
    }

    # 9. diagnostics.json
    diagnostics = {
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "n_regimes": n_regimes,
        "n_bars": T,
        "n_bars_total": T,
        "n_bars_train_val": split_idx,
        "n_bars_test": T - split_idx,
        "quality_score": quality_score,
        "date_range": {
            "start": str(timestamps[0]),
            "end": str(timestamps[-1]),
            "train_end": str(timestamps[split_idx - 1]) if split_idx > 0 else str(timestamps[0]),
            "test_start": str(timestamps[split_idx]) if split_idx < T else str(timestamps[-1]),
        },
        "convergence_summary": convergence_summary,
        "walk_forward": None,  # No Gibbs samples → no walk-forward
        "out_of_sample": oos,
        "regime_stats": regime_stats,
        "transitions": transitions,
        "transition_matrix": trans_matrix,
        "training_config": {
            "em_iter": args.em_iter,
            "n_restarts": args.n_restarts,
            "test_split": args.test_split,
        },
        "training_time_sec": round(elapsed, 2),
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "shap_summary": shap_summary,
        "feature_names": feature_names,
        "n_features": len(feature_names),
        "evaluation": evaluation_results,
    }
    with open(output_dir / "diagnostics.json", "w") as f:
        json.dump(diagnostics, f, indent=2, cls=_NumpyEncoder)

    return str(output_dir).replace("\\", "/"), diagnostics
