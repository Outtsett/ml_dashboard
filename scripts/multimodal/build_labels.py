"""Build the bracket label over the development period and land it with its base rates.

    s3://derived/multimodal_labels/recipe=<RECIPE>/table=labels/       one row per (decision bar, side, R)
    s3://derived/multimodal_labels/recipe=<RECIPE>/table=base_rates/   per year x side x R, and per decision hour

The base rates are what a coin-flip entry at the same times earns: every model
is measured against them.

    .venv/Scripts/python.exe scripts/multimodal/build_labels.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from multimodal import labels  # noqa: E402
from multimodal.data import decision_bars, load_minutes  # noqa: E402
from multimodal.lake_io import write_table  # noqa: E402

DATASET = "multimodal_labels"
RECIPE = "bracket_atr1_r2_r3_v1"            # MNQ; other roots: <RECIPE>_<root lower>
START, END = "2019-05-05", "2025-07-01"   # END is the holdout's first instant


def summarize(frame: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    def one(group: pd.DataFrame) -> pd.Series:
        wins = group.loc[group["net_points"] > 0, "net_points"]
        losses = group.loc[group["net_points"] <= 0, "net_points"]
        gross_win, gross_loss = wins.sum(), -losses.sum()
        return pd.Series({
            "candidate_count": len(group),
            "session_count": group["session"].nunique(),
            "target_hit_rate": group["target_hit"].mean(),
            "stop_rate": (group["exit_reason"] == labels.EXIT_STOP).mean(),
            "session_end_rate": (group["exit_reason"] == labels.EXIT_SESSION_END).mean(),
            "win_rate": (group["net_points"] > 0).mean(),
            "average_win_points": wins.mean() if len(wins) else np.nan,
            "average_loss_points": -losses.mean() if len(losses) else np.nan,
            "payoff_ratio": (wins.mean() / -losses.mean()) if len(wins) and len(losses) else np.nan,
            "profit_factor": gross_win / gross_loss if gross_loss > 0 else np.nan,
            "expectancy_points": group["net_points"].mean(),
            "median_stop_points": group["stop_points"].median(),
            "median_target_points": group["target_points"].median(),
            "median_minutes_held": group["minutes_held"].median(),
        })

    return frame.groupby(keys).apply(one, include_groups=False).reset_index()


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default="MNQ", choices=("MNQ", "NQ"))
    parser.add_argument("--start", default=START)
    parser.add_argument("--end", default=END)
    args = parser.parse_args()
    recipe = RECIPE if args.root == "MNQ" else f"{RECIPE}_{args.root.lower()}"
    began = time.time()
    minutes = load_minutes(args.start, args.end, root=args.root)
    print(f"minutes: {minutes.timestamp.size:,} ({time.time() - began:.0f} s)", flush=True)
    bars = decision_bars(minutes)
    out = labels.label(bars)
    print(f"labels: {len(out):,} rows over {out['session'].nunique():,} sessions ({time.time() - began:.0f} s)", flush=True)
    out["year"] = pd.to_datetime(out["decision_timestamp"], unit="s").dt.year
    out["decision_hour"] = out["decision_minute_of_day"] // 60
    by_year = summarize(out, ["year", "side", "reward_multiple"]).assign(breakdown="year")
    by_hour = summarize(out, ["decision_hour", "side", "reward_multiple"]).assign(breakdown="decision_hour")
    overall = summarize(out, ["side", "reward_multiple"]).assign(breakdown="all")
    rates = pd.concat([overall, by_year, by_hour], ignore_index=True)
    with pd.option_context("display.width", 200, "display.max_columns", 30):
        print(overall.round(4).to_string(index=False))
        print(by_year[["year", "side", "reward_multiple", "target_hit_rate", "win_rate", "payoff_ratio", "profit_factor", "expectancy_points", "median_stop_points"]].round(4).to_string(index=False))
    stored = out.drop(columns=["decision_hour"]).copy()
    stored["exit_reason"] = stored["exit_reason"].map(labels.EXIT_NAMES)
    for name, frame in (("labels", stored), ("base_rates", rates)):
        entry = write_table(DATASET, recipe, name, pa.Table.from_pandas(frame, preserve_index=False), source=f"scripts/multimodal/build_labels.py --root {args.root}")
        print(f"landed {name}: {entry['rows']:,} rows, {entry['bytes']:,} bytes")
    print(f"done in {time.time() - began:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
