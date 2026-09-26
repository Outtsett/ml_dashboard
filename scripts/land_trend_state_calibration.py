"""Land a TrendState calibration record in the lake.

``Trading/quant/analytics/trend/calibrate.py`` writes one parquet per table under
``Trading/quant/analytics/outputs/trend_state_calibration/<recipe>/``. This copies them to

    s3://derived/trend_state_calibration/recipe=<recipe>/table=<name>/part-0.parquet

and appends a manifest line per table to meta/ingest_manifests/. Tables:

    null_quantiles    per rung and session type, the null |scaled t| quantiles under both schemes
    threshold_grid    null false-entry rate, on-share, episode length and chatter per (p_entry, p_exit)
    thresholds        the chosen entry (τ) and exit (η) levels per rung and session type
    metrics           the acceptance protocol's numbers with their intervals and nulls
    episodes          every real flag episode with its label agreement and net points
    distributions     eight-number rows for episode lengths, net points and the statistic
    overfitting       probability of backtest overfitting and deflated Sharpe over the grid
    sample_bars       the block's per-bar record on the last ten Globex days
    settings          the run's settings, data span, gates and verdict

Run with the datalake interpreter (it carries the ``lake`` package):

    E:/source/repos/datalake/.venv/Scripts/python.exe scripts/land_trend_state_calibration.py --recipe <recipe>
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import pyarrow.parquet as pq
from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key, derived_root
from lake.writer import COMPRESSION, COMPRESSION_LEVEL

DATASET = "trend_state_calibration"
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "Trading" / "quant" / "analytics" / "outputs" / DATASET


def write_table(name: str, frame: pl.DataFrame, recipe: str, source: str) -> None:
    root = derived_root(DATASET, recipe) / f"table={name}"
    key = arrow_key(root / "part-0.parquet")
    with arrow_fs().open_output_stream(key) as sink:
        pq.write_table(frame.to_arrow(), sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
    size = arrow_fs().get_file_info(key).size
    entry = {
        "written_at": datetime.now(timezone.utc).isoformat(), "dataset": DATASET, "table": name,
        "zone": "derived", "recipe": recipe, "source": source, "rows": frame.height,
        "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None,
    }
    with (INGEST_MANIFESTS / f"{DATASET}.jsonl").open("a", encoding="utf-8") as manifest:
        manifest.write(json.dumps(entry) + "\n")
    print(f"  {name}: {frame.height:,} rows, {frame.width} columns, {size:,} bytes")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", required=True, help="the output directory name under outputs/trend_state_calibration")
    parser.add_argument("--output-root", type=Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    directory = args.output_root / args.recipe
    if not directory.is_dir():
        raise SystemExit(f"no calibration output at {directory}")
    tables = sorted(directory.glob("*.parquet"))
    if not tables:
        raise SystemExit(f"no parquet tables in {directory}")
    print(f"landing {len(tables)} tables from {directory} as recipe={args.recipe}")
    for path in tables:
        write_table(path.stem, pl.read_parquet(path), args.recipe, source=str(path))
    print(f"done: s3://derived/{DATASET}/recipe={args.recipe}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
