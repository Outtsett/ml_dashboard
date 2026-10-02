"""Land a round's tables in the lake: ``s3://derived/ta_strategy_600_ticks/recipe=<recipe>/table=<name>/``.

Uses the Model Cycle's landing job (``cycle.store._land_job``: one zstd parquet
per table plus one manifest line per (recipe, table) in
``meta/ingest_manifests/ta_strategy_600_ticks.jsonl``), in process when the
``lake`` writer imports here and in the datalake interpreter otherwise. The
dashboard serves each table as ``derived_ta_strategy_600_ticks_<table>`` after
``POST /api/labels/catalog/refresh`` or its next start.
"""

from __future__ import annotations

import json
import os
import subprocess

import pandas as pd

DATASET = "ta_strategy_600_ticks"


def write_local(tables: dict[str, pd.DataFrame], directory: str) -> dict[str, str]:
    os.makedirs(directory, exist_ok=True)
    paths: dict[str, str] = {}
    for name, frame in tables.items():
        path = os.path.join(directory, f"{name}.parquet")
        frame.to_parquet(path, index=False)
        paths[name] = path
    return paths


def land(paths: dict[str, str], recipe: str, source: str, dataset: str = DATASET) -> dict:
    from cycle.store import _LANDING_SCRIPT, DEFAULT_LAKE_PYTHON, _land_job

    job = {"dataset": dataset, "recipe": recipe, "tables": paths, "manifest_for": list(paths), "source": source}
    try:
        import lake.layout  # noqa: F401
        import lake.writer  # noqa: F401
    except ImportError:
        interpreter = os.environ.get("CYCLE_LAKE_PYTHON", DEFAULT_LAKE_PYTHON)
        completed = subprocess.run([interpreter, "-c", _LANDING_SCRIPT, json.dumps(job)], capture_output=True,
                                   text=True, timeout=1800, stdin=subprocess.DEVNULL)
        if completed.returncode != 0:
            tail = (completed.stderr or completed.stdout).strip().splitlines()[-1:] or ["no output"]
            raise RuntimeError(f"landing exited {completed.returncode}: {tail[0]}")
        return json.loads(completed.stdout.strip().splitlines()[-1])
    return _land_job(job)
