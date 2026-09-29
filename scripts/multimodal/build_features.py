"""Build the decision-bar features for the development period, one lake table per modality.

    s3://derived/multimodal_features/recipe=<RECIPE>/table=<block>/    block in: time, price, flow, cross, context, calendar, news

Each table has `decision_timestamp` (epoch seconds, the lake's Pacific-stamp
clock, the 5-minute bar's start), `session` and `is_decision`, then its block's
columns; the training loader joins them on `decision_timestamp`. Blocks can be
(re)built independently: `--blocks news` after the GDELT backfill lands, etc.

Development period only (holdout.guard refuses anything later).

    .venv/Scripts/python.exe scripts/multimodal/build_features.py --blocks time,price,flow,cross
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from multimodal import assemble  # noqa: E402
from multimodal.data import decision_bars, load_minutes  # noqa: E402
from multimodal.lake_io import write_table  # noqa: E402

DATASET = "multimodal_features"
RECIPE = "features_v1"                   # MNQ; other roots: <RECIPE>_<root lower>
START, END = "2019-05-05", "2025-07-01"
BLOCKS = ("time", "price", "flow", "cross", "context", "calendar", "news")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--blocks", default="time,price,flow,cross")
    parser.add_argument("--root", default="MNQ", choices=("MNQ", "NQ"))
    parser.add_argument("--start", default=START)
    parser.add_argument("--end", default=END)
    args = parser.parse_args()
    recipe = RECIPE if args.root == "MNQ" else f"{RECIPE}_{args.root.lower()}"
    start, end = args.start, args.end
    wanted = [b.strip() for b in args.blocks.split(",") if b.strip()]
    unknown = set(wanted) - set(BLOCKS)
    if unknown:
        raise SystemExit(f"unknown blocks: {sorted(unknown)}")
    began = time.time()
    minutes = load_minutes(start, end, root=args.root)
    bars = decision_bars(minutes)
    key = bars.frame[["timestamp", "session", "is_decision"]].rename(columns={"timestamp": "decision_timestamp"})
    print(f"{len(key):,} five-minute RTH bars, {int(key['is_decision'].sum()):,} decisions ({time.time() - began:.0f} s)", flush=True)
    for block in wanted:
        frame = assemble.block_frame(block, bars, minutes, start, end, root=args.root)
        table = pd.concat([key.reset_index(drop=True), frame.reset_index(drop=True)], axis=1)
        coverage = frame.loc[key["is_decision"].to_numpy()].notna().mean()
        entry = write_table(DATASET, recipe, block, pa.Table.from_pandas(table, preserve_index=False), source=f"scripts/multimodal/build_features.py --root {args.root}")
        print(f"{block}: {frame.shape[1]} columns, {entry['rows']:,} rows, {entry['bytes']:,} bytes; "
              f"non-null on decisions min {coverage.min():.3f} median {coverage.median():.3f} ({time.time() - began:.0f} s)", flush=True)
    return 0


if __name__ == "__main__":
    np.seterr(all="ignore")
    sys.exit(main())
