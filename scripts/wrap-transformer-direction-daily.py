#!/usr/bin/env python3
"""
PythonRunner-to-trading_model wrapper for the daily-direction Transformer HPO.

Adapts the Node.js orchestrator's CLI contract to
``E:\\source\\repos\\trading_model\\scripts\\train_daily_direction_hpo.py``.
The underlying script reads its full daily range from the parquet repo
automatically — date filters are not forwarded.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

TRADING_MODEL_REPO = r"E:\source\repos\trading_model"
SCRIPT = os.path.join(TRADING_MODEL_REPO, "scripts", "train_daily_direction_hpo.py")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="1d")
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--max-bars", type=int, default=0)
    parser.add_argument("--date-start", type=str, default=None)
    parser.add_argument("--date-end", type=str, default=None)

    parser.add_argument("--n-trials", type=int, default=20)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--n-folds", type=int, default=4)
    parser.add_argument("--fold-months", type=int, default=12)
    parser.add_argument("--purge-bars", type=int, default=2)
    parser.add_argument("--final-epochs", type=int, default=30)
    parser.add_argument("--horizon", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)

    parser.add_argument("--json", action="store_true")
    args, _unknown = parser.parse_known_args()

    out_dir = os.path.join("data", "models", args.model_id)
    os.makedirs(out_dir, exist_ok=True)

    cmd: list[str] = [
        sys.executable,
        SCRIPT,
        "--symbol",
        args.symbol,
        "--timeframe",
        args.timeframe,
        "--n-trials",
        str(args.n_trials),
        "--epochs",
        str(args.epochs),
        "--batch-size",
        str(args.batch_size),
        "--n-folds",
        str(args.n_folds),
        "--fold-months",
        str(args.fold_months),
        "--purge-bars",
        str(args.purge_bars),
        "--final-epochs",
        str(args.final_epochs),
        "--horizon",
        str(args.horizon),
        "--seed",
        str(args.seed),
        "--out-dir",
        out_dir,
        "--headless",
        "--no-browser",
    ]

    sys.stdout.write(
        f'{{"event":"log","data":{{"message":"wrap-transformer-direction-daily '
        f'cwd={TRADING_MODEL_REPO} model_id={args.model_id}","level":"info"}}}}\n'
    )
    sys.stdout.flush()

    sys.exit(subprocess.call(cmd, cwd=TRADING_MODEL_REPO))


if __name__ == "__main__":
    main()
