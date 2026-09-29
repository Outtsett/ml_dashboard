"""The acceptance gate: one look at the locked holdout for one frozen candidate.

    python -m multimodal.gate --trial <model id of a development trial> --reason "<why this candidate>"

1. Reads the frozen candidate's configuration from its development record
   (`data/models/<trial>/summary.json`) — nothing about it is chosen here.
2. Fixes the trading policy from the candidate's OWN development out-of-sample
   predictions (`derived_multimodal_runs_predictions`): the grid setting that
   earned the most over every development quarter, the same rule the
   walk-forward used quarter by quarter.
3. Opens the holdout ONCE (`holdout.look`, recorded in state.json and budgeted),
   builds its features and labels from the lake exactly as the development
   tables were built, trains the family on all development rows (the last
   60 development sessions held back for early stopping and calibration), and
   predicts the holdout.
4. Trades it with the fixed policy and scores G1-G6; lands the gate record in
   `derived/multimodal_gate/recipe=<trial>`.

The gate never moves a threshold and never retries: a second look is refused.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SRC_ML = Path(__file__).resolve().parents[1]
if str(SRC_ML) not in sys.path:
    sys.path.insert(0, str(SRC_ML))

from multimodal import dataset as dataset_module  # noqa: E402
from multimodal import (  # noqa: E402
    features,
    holdout,
    labels,
    metrics,
    policy,
    runs,
    sources,
    walkforward,
)
from multimodal.data import decision_bars, load_minutes  # noqa: E402
from multimodal.dataset import Dataset, Head, head_name  # noqa: E402

MODELS_DIR = SRC_ML.parents[1] / "data" / "models"
HOLDOUT_START, HOLDOUT_END = "2025-07-01", "2025-12-31"
LEAD_IN_START = "2025-05-01"     # warm-up bars before the holdout (ATR, 20-session statistics); never scored


def build_period(start: str, end: str, lead_in_start: str, blocks: list[str]) -> Dataset:
    """Features and labels for [start, end) built in memory the way the development tables were built.
    The lead-in [lead_in_start, start) warms the trailing statistics and is dropped."""
    minutes = load_minutes(lead_in_start, end)
    bars = decision_bars(minutes)
    parts = [bars.frame[["timestamp", "session", "is_decision"]].rename(columns={"timestamp": "decision_timestamp"})]
    for block in blocks:
        if block == "time":
            parts.append(features.time_block(bars))
        elif block == "price":
            parts.append(features.price_block(bars))
        elif block == "flow":
            parts.append(features.flow_block(bars, sources.flow_minutes(lead_in_start, end)))
        elif block == "cross":
            others = {root: sources.other_minutes(root, lead_in_start, end) for root in ("ES", "RTY", "YM")}
            parts.append(features.cross_block(bars, others, sources.daily_closes(["ZN", "ZB", "ZT", "GC", "HG", "DXY"])))
        elif block == "context":
            parts.append(features.context_block(bars, minutes))
        elif block == "calendar":
            parts.append(features.calendar_block(bars, sources.calendar_events()))
        elif block == "news":
            parts.append(features.news_block(bars, sources.gdelt_news(lead_in_start, end)))
        else:
            raise ValueError(f"unknown block {block!r}")
    frame = pd.concat(parts, axis=1)
    start_stamp = int(pd.Timestamp(start).timestamp())
    frame = frame[frame["is_decision"] & (frame["decision_timestamp"] >= start_stamp)].reset_index(drop=True)
    outcomes = labels.label(bars)
    outcomes = outcomes[outcomes["decision_timestamp"] >= start_stamp]
    frame = frame[frame["decision_timestamp"].isin(outcomes["decision_timestamp"].unique())].reset_index(drop=True)
    keys = frame[["decision_timestamp", "session"]].copy()
    data = Dataset(keys=keys, features=frame.drop(columns=["decision_timestamp", "session", "is_decision"]).astype("float32"))
    index = pd.Index(keys["decision_timestamp"].to_numpy())
    for reward in (2.0, 3.0):
        for side in (1, -1):
            part = outcomes[(outcomes["side"] == side) & (outcomes["reward_multiple"] == reward)].set_index("decision_timestamp").reindex(index)
            net = part["net_points"].to_numpy(float)
            data.heads[head_name(side, reward)] = Head(side, reward, (net > 0).astype(np.int8), net, part["stop_points"].to_numpy(float),
                                                       part["target_points"].to_numpy(float), part["entry_timestamp"].to_numpy(float),
                                                       part["exit_timestamp"].to_numpy(float), part["net_points"].notna().to_numpy())
    return data


def concatenate(first: Dataset, second: Dataset) -> Dataset:
    columns = list(first.features.columns)
    out = Dataset(keys=pd.concat([first.keys, second.keys], ignore_index=True),
                  features=pd.concat([first.features, second.features.reindex(columns=columns)], ignore_index=True).astype("float32"))
    for name, head in first.heads.items():
        other = second.heads[name]
        out.heads[name] = Head(head.side, head.reward_multiple, *(np.concatenate([getattr(head, f), getattr(other, f)]) for f in
                               ("win", "net_points", "stop_points", "target_points", "entry_timestamp", "exit_timestamp", "available")))
    return out


def fixed_policy(trial: str, development: Dataset) -> tuple[policy.PolicyParameters, float]:
    """The grid setting that earned the most over all of the trial's development out-of-sample quarters."""
    from lake.serving import connect

    connection = connect(with_bars=False, with_derived=False)
    recipe = runs.recipe_of(trial)
    predictions = connection.execute(
        f"SELECT * FROM read_parquet('s3://derived/multimodal_runs/recipe={recipe}/table=predictions/*.parquet', hive_partitioning = false)"
    ).df()
    position = pd.Series(np.arange(len(development.keys)), index=development.keys["decision_timestamp"].to_numpy())
    rows = position.reindex(predictions["decision_timestamp"].to_numpy()).to_numpy()
    keep = np.isfinite(rows)
    rows = rows[keep].astype(np.int64)
    probabilities = {}
    for name in development.heads:
        column = np.full(len(development.keys), np.nan)
        column[rows] = predictions.loc[keep, f"{name}_probability"].to_numpy(float)
        probabilities[name] = column
    best, best_net = None, -np.inf
    for parameters in policy.grid():
        trades = policy.simulate(development, rows, probabilities, parameters)
        net = float(trades["net_points"].sum()) if not trades.empty else -np.inf
        if net > best_net:
            best, best_net = parameters, net
    return best, best_net


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="The acceptance gate: one holdout look for one frozen candidate")
    parser.add_argument("--trial", required=True)
    parser.add_argument("--reason", required=True)
    args = parser.parse_args(argv)
    record = json.loads((MODELS_DIR / args.trial / "summary.json").read_text(encoding="utf-8"))
    configuration = record["configuration"]
    blocks = [b for b in configuration["blocks"].split(",") if b]
    history = configuration.get("history", "mnq")
    development = dataset_module.load(blocks, history=history)
    chosen, development_net = fixed_policy(args.trial, development)
    print(f"candidate {args.trial}: family {configuration['family']}, blocks {blocks}, history {history}")
    print(f"policy fixed from its development record: {chosen} (development net {development_net:,.1f} points)")

    with holdout.look(f"acceptance gate for {args.trial}: {args.reason}"):
        period = build_period(HOLDOUT_START, HOLDOUT_END, LEAD_IN_START, blocks)
        combined = concatenate(development, period)
        n_dev = len(development.keys)
        sessions = combined.keys["session"].to_numpy()
        dev_sessions = np.unique(sessions[:n_dev])
        validation_sessions = dev_sessions[-walkforward.VALIDATION_SESSIONS:]
        train_sessions = dev_sessions[: dev_sessions.size - walkforward.VALIDATION_SESSIONS - walkforward.PURGE_SESSIONS]
        fold = walkforward.Fold(0, "holdout", np.flatnonzero(np.isin(sessions, train_sessions)),
                                np.flatnonzero(np.isin(sessions, validation_sessions)), np.arange(n_dev, len(combined.keys)))
        probabilities = {name: np.full(len(combined.keys), np.nan) for name in combined.heads}
        importances: list = []
        from multimodal.main import fit_family, parse_args

        family_args = parse_args(["--model-id", args.trial, *sum(([f"--{k.replace('_', '-')}", str(v)] for k, v in configuration.items()
                                                                  if k not in ("model_id", "symbol", "timeframe") and v is not None), [])])
        fit_family(family_args, combined, fold, tuple(combined.heads), probabilities, importances)
        trades = policy.simulate(combined, fold.test, probabilities, chosen)
        quarter_of_session = {int(s): q for s, q in zip(sessions[fold.test], walkforward.quarter_of(sessions[fold.test]))}
        summary = metrics.summary(trades, sessions[fold.test], quarter_of_session)
    modalities = sorted({c.split("_", 1)[0] for c in combined.features.columns})
    summary["gate"]["G6"] = len(modalities) > 1
    verdict = all(summary["gate"].values())
    print(json.dumps({k: v for k, v in summary.items() if k != "quarter_net_points"}, indent=1, default=float))
    print(f"VERDICT: {'PASS' if verdict else 'FAIL'} — {summary['gate']}")
    runs.land(f"gate_{args.trial}", {
        "trades": trades,
        "summary": pd.DataFrame([{"trial": args.trial, "reason": args.reason, "policy": json.dumps(chosen.__dict__),
                                  "summary_json": json.dumps(summary, default=float), "verdict": "PASS" if verdict else "FAIL"}]),
    }, source="src/ml/multimodal/gate.py")
    return 0 if verdict else 2


if __name__ == "__main__":
    sys.exit(main())
