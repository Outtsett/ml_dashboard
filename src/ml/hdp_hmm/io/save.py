"""Save model artifacts — orchestrator that wires all analysis steps."""

import io
import json
import os
import time
from pathlib import Path

from datetime import datetime

import numpy as np
import requests

from shared.labeling import renumber_states, assign_colors, get_labeler
from .regime_stats import compute_regime_stats, compute_transitions
from .evaluation import compute_oos_evaluation, compute_walk_forward
from .shap import compute_shap_values
from .quality import compute_quality_score
from shared.signals import compute_signal_columns
from shared.evaluation import run_all_stages


class _NumpyEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy types (numpy 2.x compatible)."""

    def default(self, obj):
        # numpy 2.x: np.bool_ no longer inherits from Python bool
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
        # Catch any remaining numpy generic types
        if isinstance(obj, np.generic):
            return obj.item()
        return super().default(obj)


QUESTDB_HTTP_URL = os.environ.get("QUESTDB_URL", "http://127.0.0.1:9000")


def _write_to_questdb(table_name: str, csv_content: str, ts_col: str = "ts"):
    """Upload CSV data to QuestDB via /imp endpoint.

    Must pass a schema form field specifying the timestamp pattern so QuestDB
    can parse the designated timestamp column on existing WAL tables.
    Schema must come BEFORE data in the multipart form.
    """
    schema = json.dumps(
        [{"name": ts_col, "type": "TIMESTAMP", "pattern": "yyyy-MM-ddTHH:mm:ss.SSSUUUz"}]
    )
    resp = requests.post(
        f"{QUESTDB_HTTP_URL}/imp?name={table_name}",
        files=[
            ("schema", (None, schema, "text/plain")),
            ("data", ("data.csv", csv_content, "text/csv")),
        ],
        timeout=60,
    )
    resp.raise_for_status()


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
    wf_counts=None,
    close_vals=None,
):
    """Save model artifacts to data/models/<modelId>/ and QuestDB tables."""
    # save.py is at src/ml/hdp_hmm/io/ — use cwd (set by Node runner) for reliability
    project_root = Path.cwd()
    model_id = args.model_id if args.model_id else f"{args.symbol}_{args.timeframe}"
    output_dir = project_root / "data" / "models" / model_id
    output_dir.mkdir(parents=True, exist_ok=True)

    T = len(timestamps)
    renum = renumber_states(model.state_sequence)
    relabeled, n_regimes = renum.states, renum.n_regimes
    colors = assign_colors(n_regimes)
    labeler = get_labeler("structural")

    # Compute rich signal columns for model_regimes (OCP — new columns, existing untouched)
    posteriors = getattr(model, "posteriors_", None)  # (T, K) if available from Gibbs/EM
    trans_matrix_full = model.transition_matrix if hasattr(model, "transition_matrix") else None
    signal_cols = compute_signal_columns(
        assignments=np.array(relabeled),
        posteriors=posteriors,
        close=np.array(close_vals if close_vals is not None else [0.0] * T, dtype=np.float64),
        transition_matrix=trans_matrix_full[:n_regimes, :n_regimes]
        if trans_matrix_full is not None
        else None,
    )

    # Resolve close values and timestamps
    split_idx = int(T * (1 - args.test_split))
    splits = ["train"] * split_idx + ["test"] * (T - split_idx)

    # Per-regime rich labels via Strategy pattern
    unique_regimes = sorted(set(int(r) for r in relabeled))
    regime_label_map = {}
    regime_category_map = {}
    for rid in unique_regimes:
        mask = relabeled == rid
        regime_feats = features[mask]
        ret_col = 0
        avg_ret = float(np.mean(regime_feats[:, ret_col])) if np.any(mask) else 0.0
        avg_vol = float(np.std(regime_feats[:, ret_col])) if np.any(mask) else 0.0
        runs = []
        run_len = 0
        for s in relabeled:
            if int(s) == rid:
                run_len += 1
            else:
                if run_len > 0:
                    runs.append(run_len)
                run_len = 0
        if run_len > 0:
            runs.append(run_len)
        avg_dur = float(np.mean(runs)) if runs else 0.0
        pct = round(np.sum(mask) / T * 100, 2)
        lr = labeler.label(rid, regime_feats, feature_names, avg_ret, avg_vol, avg_dur, pct)
        regime_label_map[rid] = lr.label
        regime_category_map[rid] = lr.category

    regime_label_list = [regime_label_map.get(int(r), f"Regime {r}") for r in relabeled]
    regime_category_list = [regime_category_map.get(int(r), "range") for r in relabeled]

    if close_vals is None:
        # Fallback: zeros if not provided (shouldn't happen with new pipeline)
        close_vals = [0.0] * T
    ts_vals = timestamps

    # 1. Write regime assignments to QuestDB model_regimes table
    csv_buf = io.StringIO()
    csv_buf.write(
        "model_id,symbol,ts,close,regime,regime_label,split,confidence,entropy,magnitude,volatility,duration_bars,transition_prob,category\n"
    )
    for i in range(T):
        ts_str = _fmt_ts(ts_vals[i])
        # Escape commas in regime labels
        rl = str(regime_label_list[i]).replace(",", " ")
        cat = str(regime_category_list[i])
        conf = float(signal_cols["confidence"][i])
        ent = float(signal_cols["entropy"][i])
        mag = float(signal_cols["magnitude"][i])
        vol = float(signal_cols["volatility"][i])
        dur = int(signal_cols["duration_bars"][i])
        tp = float(signal_cols["transition_prob"][i])
        csv_buf.write(
            f"{model_id},{args.symbol},{ts_str},{float(close_vals[i])},{int(relabeled[i])},{rl},{splits[i]},{conf},{ent},{mag},{vol},{dur},{tp},{cat}\n"
        )

    try:
        _write_to_questdb("model_regimes", csv_buf.getvalue())
    except Exception as e:
        print(
            f"[save] Warning: Failed to write model_regimes to QuestDB: {e}",
            file=__import__("sys").stderr,
        )

    # 1b. Also save assignments to disk as CSV (durable fallback)
    assignments_path = output_dir / "assignments.csv"
    try:
        assignments_path.write_text(csv_buf.getvalue(), encoding="utf-8")
    except Exception as e:
        print(
            f"[save] Warning: Failed to write assignments.csv to disk: {e}",
            file=__import__("sys").stderr,
        )

    # 2. convergence.json — full ConvergencePoint[] format
    if iteration_metrics:
        convergence = {
            "gibbs": iteration_metrics,
            "n_iterations": len(iteration_metrics),
        }
    else:
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
    regime_stats = compute_regime_stats(relabeled, features, feature_names, labeler=labeler)

    # 4. Transitions array
    trans_matrix = model.transition_matrix[:n_regimes, :n_regimes].tolist()
    transitions = compute_transitions(trans_matrix, n_regimes)

    # 5. OOS evaluation
    oos = compute_oos_evaluation(relabeled, features, split_idx, n_regimes)

    # 6. Walk-forward stability from windowed mode counters
    walk_forward = compute_walk_forward(wf_counts, n_regimes, n_windows=5)

    # 7. SHAP values (analytical for diagonal Gaussian HMM) → QuestDB
    shap_matrix, shap_summary = compute_shap_values(
        model, features, relabeled, feature_names, n_regimes
    )

    csv_buf = io.StringIO()
    shap_cols = [f"shap_{name}" for name in feature_names]
    csv_buf.write(f"model_id,symbol,ts,regime,{','.join(shap_cols)}\n")
    for i in range(T):
        ts_str = _fmt_ts(ts_vals[i])
        shap_vals = ",".join(str(float(shap_matrix[i, d])) for d in range(len(feature_names)))
        csv_buf.write(f"{model_id},{args.symbol},{ts_str},{int(relabeled[i])},{shap_vals}\n")

    try:
        _write_to_questdb("model_shap", csv_buf.getvalue())
    except Exception as e:
        print(
            f"[save] Warning: Failed to write model_shap to QuestDB: {e}",
            file=__import__("sys").stderr,
        )

    # 8. Quality score (incorporating OOS + WF)
    quality_score = compute_quality_score(
        model, relabeled, n_regimes, T, oos=oos, walk_forward=walk_forward
    )

    # 8b. Statistical evaluation pipeline (Stages 1-5)
    split_mask = np.array([s == "train" for s in splits])
    close_arr = np.array(close_vals, dtype=np.float64)
    conf_arr = signal_cols["confidence"] if "confidence" in signal_cols else None
    tm = (
        model.transition_matrix[:n_regimes, :n_regimes]
        if hasattr(model, "transition_matrix")
        else None
    )
    run_sig = getattr(args, "run_significance_tests", False)
    eval_iter = getattr(args, "gibbs_iter", 0)
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
        "evaluation": evaluation_results,
    }
    with open(output_dir / "diagnostics.json", "w") as f:
        json.dump(diagnostics, f, indent=2, cls=_NumpyEncoder)

    return str(output_dir).replace("\\", "/"), diagnostics
