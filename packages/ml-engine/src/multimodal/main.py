"""Multimodal bracket model — the dashboard runner (`multimodal_fusion+bracket_meta_label`).

Started by the dashboard's `/api/training/start` (never from a terminal), it
streams the stdout protocol live and lands its record in the lake:

1. load the development-period training table (features per modality + bracket outcomes);
2. walk forward by quarter: fit the model family on each fold's training rows,
   early-stop / calibrate on its validation rows, predict its test quarter;
3. choose the trading policy for each quarter from the EARLIER quarters'
   out-of-sample predictions only, and trade the quarter with it;
4. score every gate criterion on all out-of-sample trades, land the run
   (`derived/multimodal_runs/recipe=<model id>`), count it in the trials ledger.

Families: `gbdt` (LightGBM per head, the baseline), `fusion` (the multimodal network) and
`ensemble` (the average of the two families' calibrated probabilities).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

SRC_ML = Path(__file__).resolve().parents[1]
if str(SRC_ML) not in sys.path:
    sys.path.insert(0, str(SRC_ML))

from multimodal import dataset as dataset_module  # noqa: E402
from multimodal import metrics, policy, runs, walkforward  # noqa: E402
from shared.protocol import (  # noqa: E402
    emit_config,
    emit_done,
    emit_error,
    emit_fold_complete,
    emit_log,
    emit_metric,
    emit_progress,
    set_active_fold,
)

MODELS_DIR = SRC_ML.parents[1] / "data" / "models"
HEADS = ("long_r2", "short_r2", "long_r3", "short_r3")
CANONICAL_FIRST_QUARTER = "2021Q2"


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Multimodal bracket model (walk-forward, gated)")
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="5m")
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--family", default="gbdt", choices=("gbdt", "fusion", "ensemble"))
    parser.add_argument("--blocks", default="time,price,flow,cross")
    parser.add_argument("--first-test-quarter", default="2020Q3")
    parser.add_argument("--history", default="mnq", choices=("mnq", "nq_mnq"))
    parser.add_argument("--seed", type=int, default=7)
    # gbdt
    parser.add_argument("--learning-rate", type=float, default=0.03)
    parser.add_argument("--num-leaves", type=int, default=31)
    parser.add_argument("--min-child-samples", type=int, default=200)
    # fusion
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--sequence-bars", type=int, default=48)
    parser.add_argument("--modality-dropout", type=float, default=0.15)
    parser.add_argument("--batch-size", type=int, default=512)
    args, _unknown = parser.parse_known_args(argv)
    return args


def auc(y: np.ndarray, p: np.ndarray) -> float:
    from sklearn.metrics import roc_auc_score

    mask = np.isfinite(p)
    if mask.sum() < 50 or len(np.unique(y[mask])) < 2:
        return float("nan")
    return float(roc_auc_score(y[mask], p[mask]))


def fit_family(args, data, fold, heads, probabilities, importances):
    if args.family == "ensemble":
        # the average of the two families' calibrated probabilities, head by head
        separate = {}
        extra = {}
        for family in ("gbdt", "fusion"):
            member = {name: np.full(len(data.keys), np.nan) for name in heads}
            member_args = argparse.Namespace(**{**vars(args), "family": family})
            extra.update({f"{family}_{k}": v for k, v in (fit_family(member_args, data, fold, heads, member, importances) or {}).items()})
            separate[family] = member
        for name in heads:
            probabilities[name][fold.test] = (separate["gbdt"][name][fold.test] + separate["fusion"][name][fold.test]) / 2.0
        return extra
    if args.family == "gbdt":
        from multimodal.models.gbdt import GbdtParameters, HeadModel

        names = list(data.features.columns)
        x = data.features.to_numpy(np.float32)
        block_columns = {block: [names.index(c) for c in columns] for block, columns in data.modalities().items()}
        # its own generator: the ablation never moves the global state the fusion member shuffles with
        generator = np.random.default_rng([args.seed, fold.index])
        for name in heads:
            head = data.heads[name]
            train = fold.train[head.available[fold.train]]
            valid = fold.validation[head.available[fold.validation]]
            model = HeadModel(GbdtParameters(learning_rate=args.learning_rate, num_leaves=args.num_leaves,
                                             min_child_samples=args.min_child_samples, seed=args.seed))
            model.fit(x[train], head.win[train], x[valid], head.win[valid], names)
            probabilities[name][fold.test] = model.predict(x[fold.test])
            for feature, gain in model.importance(names).items():
                importances.append({"fold": fold.name, "head": name, "feature": feature, "gain_share": gain})
            # block ablation on the test quarter, the gbdt counterpart of the fusion's token ablation: AUC with
            # one block's columns shuffled together across the quarter's rows (3 shuffles, averaged)
            test = fold.test[head.available[fold.test]]
            full = auc(head.win[test], probabilities[name][test])
            for block, columns in block_columns.items():
                without = []
                for _repeat in range(3):
                    shuffled = x[test].copy()
                    shuffled[:, columns] = shuffled[generator.permutation(test.size)][:, columns]
                    without.append(auc(head.win[test], model.predict(shuffled)))
                auc_without = float(np.mean(without))
                importances.append({"fold": fold.name, "head": name, "feature": f"{block}__token", "gain_share": np.nan,
                                    "auc_full": full, "auc_without": auc_without, "auc_drop": full - auc_without})
        return {}
    from multimodal.models.fusion import FusionParameters, fit_predict

    parameters = FusionParameters(epochs=args.epochs, hidden=args.hidden, dropout=args.dropout,
                                  sequence_bars=args.sequence_bars, modality_dropout=args.modality_dropout,
                                  batch_size=args.batch_size, seed=args.seed)
    return fit_predict(data, fold, heads, probabilities, parameters, importances)


def choose_policies(data, folds, probabilities) -> tuple[pd.DataFrame, list[dict]]:
    """Per test quarter, the policy that earned the most on the earlier quarters' out-of-sample trades."""
    grid = policy.grid()
    per_quarter: dict[str, list[pd.DataFrame]] = {}
    for fold in folds:
        per_quarter[fold.name] = [policy.simulate(data, fold.test, probabilities, parameters) for parameters in grid]
    history = np.zeros(len(grid))
    chosen_trades, choices = [], []
    default = grid.index(policy.PolicyParameters(0.0, 3, 9 * 60, HEADS)) if policy.PolicyParameters(0.0, 3, 9 * 60, HEADS) in grid else 0
    for k, fold in enumerate(folds):
        pick = int(np.argmax(history)) if k >= 2 else default
        trades = per_quarter[fold.name][pick].assign(quarter=fold.name, policy_index=pick)
        chosen_trades.append(trades)
        choices.append({"quarter": fold.name, "policy_index": pick, **grid[pick].__dict__,
                        "history_net_points": float(history[pick]) if k >= 2 else None})
        for g, frame in enumerate(per_quarter[fold.name]):
            history[g] += float(frame["net_points"].sum()) if not frame.empty else 0.0
    return pd.concat(chosen_trades, ignore_index=True), choices


def main(argv=None) -> int:
    args = parse_args(argv)
    began = time.time()
    np.random.seed(args.seed)
    blocks = [b for b in args.blocks.split(",") if b]
    configuration = {k: v for k, v in vars(args).items() if k not in ("json",)}
    emit_config({"model": {"family": args.family, "heads": list(HEADS)}, "data": {"symbol": args.symbol, "blocks": blocks},
                 "run": configuration}, scope="run", label=args.model_id)
    try:
        from multimodal.provenance import current as current_provenance

        provenance = current_provenance(blocks, args.history)
        data = dataset_module.load(blocks, history=args.history, with_sequences=args.family in ("fusion", "ensemble"))
        sessions = data.keys["session"].to_numpy()
        folds = walkforward.folds(sessions, first_test_quarter=args.first_test_quarter)
        emit_log(f"{len(data.keys):,} decision bars, {data.features.shape[1]} features "
                 f"({', '.join(f'{m} {len(c)}' for m, c in data.modalities().items())}); {len(folds)} walk-forward quarters "
                 f"{folds[0].name}..{folds[-1].name}")
        probabilities = {name: np.full(len(data.keys), np.nan) for name in HEADS}
        importances: list[dict] = []
        fold_rows = []
        for k, fold in enumerate(folds):
            set_active_fold(k)
            emit_progress(k, len(folds), phase=f"fold {fold.name}")
            extra = fit_family(args, data, fold, HEADS, probabilities, importances) or {}
            row = {"fold": fold.name, "train_rows": int(fold.train.size), "validation_rows": int(fold.validation.size), "test_rows": int(fold.test.size)}
            for name in HEADS:
                head = data.heads[name]
                test = fold.test[head.available[fold.test]]
                row[f"{name}_auc"] = auc(head.win[test], probabilities[name][test])
                row[f"{name}_base_rate"] = float(head.win[test].mean())
                row[f"{name}_mean_probability"] = float(np.nanmean(probabilities[name][test]))
                emit_metric(f"{name}_auc", row[f"{name}_auc"] if np.isfinite(row[f"{name}_auc"]) else 0.5, k, len(folds))
            row.update(extra)
            fold_rows.append(row)
            emit_fold_complete(k, {key: value for key, value in row.items() if key != "fold"})
            emit_log(f"fold {fold.name}: " + ", ".join(f"{h} AUC {row[f'{h}_auc']:.3f}" for h in HEADS) + f" ({time.time() - began:.0f} s)")
        trades, choices = choose_policies(data, folds, probabilities)
        test_rows = np.concatenate([f.test for f in folds])
        quarter_of_session = {int(s): q for s, q in zip(sessions[test_rows], walkforward.quarter_of(sessions[test_rows]))}
        # the first two quarters trade with the default policy (no earlier out-of-sample history): report both
        summary = metrics.summary(trades, sessions[test_rows], quarter_of_session)
        tuned_folds = folds[2:]
        tuned_rows = np.concatenate([f.test for f in tuned_folds]) if tuned_folds else test_rows
        tuned = trades[trades["quarter"].isin([f.name for f in tuned_folds])]
        summary_tuned = metrics.summary(tuned, sessions[tuned_rows], quarter_of_session)
        # the canonical development window every trial is compared on (trials 1-3 scored 2021Q2..2025Q2)
        canonical_folds = [f for f in tuned_folds if f.name >= CANONICAL_FIRST_QUARTER]
        canonical_rows = np.concatenate([f.test for f in canonical_folds]) if canonical_folds else tuned_rows
        canonical = metrics.summary(trades[trades["quarter"].isin([f.name for f in canonical_folds])], sessions[canonical_rows], quarter_of_session)
        for key in ("net_profit_usd", "win_rate", "payoff_ratio", "profit_factor", "sessions_traded_share", "trades_per_session",
                    "bootstrap_total_points_lower_95", "quarters_positive_share"):
            value = canonical.get(key)
            if value is not None and np.isfinite(value):
                emit_metric(f"out_of_sample_{key}", value, len(folds), len(folds))
        predictions = data.keys.iloc[test_rows].copy()
        predictions["quarter"] = walkforward.quarter_of(predictions["session"].to_numpy())
        for name in HEADS:
            predictions[f"{name}_probability"] = probabilities[name][test_rows]
            predictions[f"{name}_net_points"] = data.heads[name].net_points[test_rows]
        importance = pd.DataFrame(importances)
        if not importance.empty:
            importance["modality"] = importance["feature"].str.split("_").str[0]
        landed = runs.land(args.model_id, {
            "predictions": predictions, "trades": trades, "folds": pd.DataFrame(fold_rows),
            "policies": pd.DataFrame(choices),
            "summary": pd.DataFrame([{"scope": "all_quarters", "summary_json": json.dumps(summary, default=float)},
                                     {"scope": "policy_tuned_quarters", "summary_json": json.dumps(summary_tuned, default=float)},
                                     {"scope": "canonical_2021q2_2025q2", "summary_json": json.dumps(canonical, default=float)}]),
            "importance": importance if not importance.empty else None,
        }, source="packages/ml-engine/src/multimodal/main.py")
        runs.record_trial(args.model_id, {**configuration, "provenance": provenance}, canonical)
        out_dir = MODELS_DIR / args.model_id
        out_dir.mkdir(parents=True, exist_ok=True)
        # per data modality, the mean test-quarter AUC drop: the fusion zeroes a token, gbdt shuffles a block,
        # an ensemble averages its two members' measurements (gate G6 reads this)
        ablation = {}
        if not importance.empty and "auc_drop" in importance.columns:
            token_modality = {"price__token": "price", "time__token": "price", "context__token": "price", "sequence__token": "price",
                              "flow__token": "flow", "cross__token": "cross", "calendar__token": "calendar", "news__token": "news"}
            for token, group in importance.dropna(subset=["auc_drop"]).groupby("feature"):
                ablation.setdefault(token_modality.get(token, token), []).append(float(group["auc_drop"].mean()))
            ablation = {k: float(np.mean(v)) for k, v in ablation.items()}
        (out_dir / "summary.json").write_text(json.dumps({"all_quarters": summary, "policy_tuned_quarters": summary_tuned, "canonical": canonical,
                                                            "provenance": provenance, "ablation": ablation or None,
                                                            "folds": fold_rows, "policies": choices, "configuration": configuration,
                                                            "landed": {k: v.get("rows") for k, v in landed.items()}},
                                                           indent=2, default=float), encoding="utf-8")
        gate = canonical["gate"]
        emit_log(f"out-of-sample, canonical window {CANONICAL_FIRST_QUARTER}..{folds[-1].name}: "
                 f"net ${canonical.get('net_profit_usd', 0):,.2f}, win {canonical.get('win_rate', float('nan')):.3f}, "
                 f"payoff {canonical.get('payoff_ratio', float('nan')):.2f}, PF {canonical.get('profit_factor', float('nan')):.2f}, "
                 f"sessions traded {canonical.get('sessions_traded_share', 0):.3f}; gate {gate}; "
                 f"all policy-tuned quarters ({len(tuned_folds)}): PF {summary_tuned.get('profit_factor', float('nan')):.2f}, "
                 f"net ${summary_tuned.get('net_profit_usd', 0):,.2f}")
        emit_done(str(out_dir), {"gate": gate, "summary": {k: v for k, v in canonical.items() if not isinstance(v, dict)}})
        return 0
    except Exception as error:  # noqa: BLE001 - reported on the protocol, then re-raised for the exit code
        import traceback

        emit_error(str(error), traceback.format_exc())
        raise


if __name__ == "__main__":
    sys.exit(main())
