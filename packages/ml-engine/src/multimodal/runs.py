"""The record of a run: predictions, trades, folds and the gate summary, landed in the lake,
plus one line per run in the plan's trials ledger (every configuration evaluated is counted).

    s3://derived/multimodal_runs/recipe=<run id>/table=<predictions|trades|folds|summary|importance>/
    docs/plans/2026-09-29-multimodal/trials.jsonl
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd
import pyarrow as pa

from multimodal.holdout import PLAN_DIR
from multimodal.lake_io import write_table

DATASET = "multimodal_runs"
TRIALS_PATH = PLAN_DIR / "trials.jsonl"


def recipe_of(model_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in model_id)


def land(model_id: str, tables: dict[str, pd.DataFrame], source: str) -> dict[str, dict]:
    recipe = recipe_of(model_id)
    out = {}
    for name, frame in tables.items():
        if frame is None:
            continue
        out[name] = write_table(DATASET, recipe, name, pa.Table.from_pandas(frame, preserve_index=False), source=source)
    return out


def record_trial(model_id: str, configuration: dict, summary: dict, period: str = "development") -> None:
    """Append the run to the trials ledger: the deflated-Sharpe and PBO reports count these lines."""
    line = {
        "at": datetime.now(timezone.utc).isoformat(), "model_id": model_id, "period": period,
        "configuration": configuration,
        "summary": {k: v for k, v in summary.items() if not isinstance(v, dict)},
        "gate": summary.get("gate"),
    }
    with TRIALS_PATH.open("a", encoding="utf-8") as ledger:
        ledger.write(json.dumps(line, default=str) + "\n")
