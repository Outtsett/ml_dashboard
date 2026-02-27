"""Save model artifacts — orchestrator that wires all analysis steps."""

import json
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from .relabel import relabel_states
from .regime_stats import compute_regime_stats, compute_transitions
from .evaluation import compute_oos_evaluation, compute_walk_forward
from .shap import compute_shap_values
from .quality import compute_quality_score


def save_model(model, timestamps, features, feature_names, args, elapsed,
               iteration_metrics=None, state_samples=None):
    """Save model artifacts to data/models/<modelId>/"""
    # model_io/ is at src/ml/model_io/ — 4 parents to reach project root
    project_root = Path(__file__).parent.parent.parent.parent
    model_id = f"{args.symbol}_{args.timeframe}"
    output_dir = project_root / "data" / "models" / model_id
    output_dir.mkdir(parents=True, exist_ok=True)

    T = len(timestamps)
    relabeled, colors, labels, n_regimes = relabel_states(model.state_sequence, features)

    # 1. regimes.parquet
    split_idx = int(T * (1 - args.test_split))
    splits = ["train"] * split_idx + ["test"] * (T - split_idx)
    regime_label_list = [labels.get(str(int(r)), f"Regime {r}") for r in relabeled]

    table = pq.read_table(args.data_file)
    ts_col = "timestamp" if "timestamp" in table.column_names else "ts"
    close_vals = table.column("close").to_pylist()[:T]
    ts_vals = table.column(ts_col).to_pylist()[:T]

    regime_table = pa.table({
        "ts": ts_vals,
        "close": [float(c) for c in close_vals],
        "regime": [int(r) for r in relabeled],
        "regime_label": regime_label_list,
        "split": splits,
    })
    pq.write_table(regime_table, str(output_dir / "regimes.parquet"))

    # 2. convergence.json — full ConvergencePoint[] format
    if iteration_metrics:
        convergence = {
            "gibbs": iteration_metrics,
            "n_iterations": len(iteration_metrics),
        }
    else:
        # Fallback: legacy format from raw LL array
        convergence = {
            "gibbs": [
                {"iter": i + 1, "log_likelihood": float(ll)}
                for i, ll in enumerate(model.log_likelihoods)
            ],
            "n_iterations": len(model.log_likelihoods),
        }
    with open(output_dir / "convergence.json", "w") as f:
        json.dump(convergence, f)

    # 3. Regime stats (full RegimeStat[] matching UI interface)
    regime_stats = compute_regime_stats(relabeled, features, feature_names)

    # 4. Transitions array
    trans_matrix = model.transition_matrix[:n_regimes, :n_regimes].tolist()
    transitions = compute_transitions(trans_matrix, n_regimes)

    # 5. OOS evaluation
    oos = compute_oos_evaluation(relabeled, features, split_idx, n_regimes)

    # 6. Walk-forward stability from Gibbs samples
    walk_forward = compute_walk_forward(state_samples, n_regimes, n_windows=5)

    # 7. SHAP values (analytical for diagonal Gaussian HMM)
    shap_matrix, shap_summary = compute_shap_values(
        model, features, relabeled, feature_names, n_regimes
    )
    shap_data = {"ts": ts_vals, "regime": pa.array(relabeled.astype(np.int32))}
    for d, name in enumerate(feature_names):
        shap_data[f"shap_{name}"] = pa.array(shap_matrix[:, d])
    pq.write_table(pa.table(shap_data), str(output_dir / "shap_values.parquet"))

    # 8. Quality score (incorporating OOS + WF)
    quality_score = compute_quality_score(model, relabeled, n_regimes, T, oos=oos, walk_forward=walk_forward)

    # 9. Convergence summary
    final_ll = float(model.log_likelihoods[-1]) if model.log_likelihoods else 0.0
    final_active = int(len(np.unique(relabeled)))
    convergence_summary = {
        "n_iterations": len(model.log_likelihoods),
        "final_log_likelihood": final_ll,
        "final_active_states": final_active,
    }

    # 10. diagnostics.json — complete format matching UI Diagnostics interface
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
        "walk_forward": walk_forward,
        "out_of_sample": oos,
        "regime_stats": regime_stats,
        "transitions": transitions,
        "transition_matrix": trans_matrix,
        "training_config": {
            "gibbs_iter": args.gibbs_iter,
            "burn_in": args.burn_in,
            "alpha": args.alpha,
            "gamma": args.gamma,
            "kappa": args.kappa,
            "test_split": args.test_split,
            "walk_forward_windows": 5,
        },
        "training_time_sec": round(elapsed, 2),
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "shap_summary": shap_summary,
        "feature_names": feature_names,
        "n_features": len(feature_names),
        "beta": model.beta.tolist(),
    }
    with open(output_dir / "diagnostics.json", "w") as f:
        json.dump(diagnostics, f, indent=2)

    return str(output_dir).replace("\\", "/"), diagnostics
