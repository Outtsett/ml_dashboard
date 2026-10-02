#!/usr/bin/env python3
"""
PythonRunner-to-trading_model wrapper for the range-bucket Transformer HPO.

The Node.js training orchestrator (apps/api/training/runners/pythonRunner.ts)
spawns child processes with a fixed CLI contract:

  --symbol --timeframe --model-id [--max-bars] [--date-start] [--date-end] --json

The trading_model HPO driver at
``E:\\source\\repos\\trading_model\\scripts\\train_range_hpo.py`` uses a
different convention (``--start-date``/``--end-date``, no ``--model-id``,
``--out-dir`` for output), so this wrapper translates and invokes it.

The wrapper does not parse model output — protocol.emit_* JSON lines from the
underlying script flow through stdout/stderr untouched and the orchestrator's
parser registry handles them.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

TRADING_MODEL_REPO = r"E:\source\repos\trading_model"
SCRIPT = os.path.join(TRADING_MODEL_REPO, "scripts", "train_range_hpo.py")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--max-bars", type=int, default=0)
    parser.add_argument("--date-start", type=str, default=None)
    parser.add_argument("--date-end", type=str, default=None)

    # Hyperparameters surfaced as CLI flags via cliFlags in models.json
    parser.add_argument("--n-trials", type=int, default=10)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--n-folds", type=int, default=0)
    parser.add_argument("--fold-months", type=int, default=6)
    parser.add_argument("--purge-bars", type=int, default=120)
    parser.add_argument("--final-epochs", type=int, default=0)
    parser.add_argument("--horizon", type=int, default=15)
    parser.add_argument("--bucket-size-pts", type=float, default=2.0)
    parser.add_argument("--window-size", type=int, default=128)

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
        "--horizon",
        str(args.horizon),
        "--bucket-size-pts",
        str(args.bucket_size_pts),
        "--window-size",
        str(args.window_size),
        "--out-dir",
        out_dir,
        "--headless",
        "--no-browser",
    ]

    if args.max_bars > 0:
        cmd.extend(["--max-bars", str(args.max_bars)])
    if args.date_start:
        cmd.extend(["--start-date", args.date_start])
    if args.date_end:
        cmd.extend(["--end-date", args.date_end])
    if args.n_folds > 0:
        cmd.extend(["--n-folds", str(args.n_folds)])
    if args.fold_months > 0:
        cmd.extend(["--fold-months", str(args.fold_months)])
    if args.purge_bars > 0:
        cmd.extend(["--purge-bars", str(args.purge_bars)])
    if args.final_epochs > 0:
        cmd.extend(["--final-epochs", str(args.final_epochs)])

    sys.stdout.write(
        f'{{"event":"log","data":{{"message":"wrap-transformer-range '
        f'cwd={TRADING_MODEL_REPO} model_id={args.model_id}","level":"info"}}}}\n'
    )
    sys.stdout.flush()

    sys.exit(subprocess.call(cmd, cwd=TRADING_MODEL_REPO))


if __name__ == "__main__":
    main()
