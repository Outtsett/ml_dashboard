"""Clear the Model Cycle run history: every recorded run in the lake
(`s3://derived/model_cycle_runs/recipe=<run>/`), its manifest lines, its
artifacts under `data/models/<run>/`, the run entity rows in SQLite
(`cycle_runs` and its children, `saved_analytics`), and the legacy comparisons file.

    uv run python scripts/purge_cycle_runs.py            # list what would go
    uv run python scripts/purge_cycle_runs.py --apply    # delete it

Asked for on 2026-10-07 so the dashboard shows nothing until the first real run.
Irreversible: the lake record and the artifacts are gone once applied.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "ml-engine" / "src"))

DATASET = "model_cycle_runs"
MODELS_DIR = ROOT / "data" / "models"
COMPARISONS = ROOT / "data" / "analytics" / "comparisons.json"
SQLITE = ROOT / "data" / "ml_dashboard.db"
ENTITY_TABLES = ("cycle_run_verdicts", "cycle_run_features", "cycle_run_settings", "cycle_run_configurations", "cycle_runs", "saved_analytics_runs", "saved_analytics")
RUN_SUFFIX = "+walk_forward_cycle_"


def lake_recipes(filesystem, prefix: str) -> list[str]:
    from pyarrow import fs

    selector = fs.FileSelector(prefix, recursive=False, allow_not_found=True)
    return sorted(info.path for info in filesystem.get_file_info(selector) if info.type == fs.FileType.Directory)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="delete; without it only list")
    parser.add_argument("--only", action="append", default=[], metavar="RUN_ID",
                        help="purge only this run (repeatable); the rest of the history is kept")
    args = parser.parse_args()
    only = set(args.only)

    def chosen(name: str) -> bool:
        """A recipe, artifact directory or manifest line belongs to one of the --only runs
        (a recipe spells the id's '+' as '_', as store.lake_recipe does)."""
        if not only:
            return True
        return any(run_id in name or run_id.replace("+", "_") in name for run_id in only)

    from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key
    from pyarrow import fs

    filesystem = arrow_fs()
    # the record's bucket layout is what store.py writes: s3://derived/model_cycle_runs/recipe=.../table=.../
    prefix = "derived/" + DATASET
    recipes = [recipe for recipe in lake_recipes(filesystem, prefix) if chosen(recipe)]
    manifest_key = arrow_key(INGEST_MANIFESTS / f"{DATASET}.jsonl")
    manifest_lines = 0
    kept_manifest: list[str] = []
    if filesystem.get_file_info(manifest_key).type != fs.FileType.NotFound:
        with filesystem.open_input_stream(manifest_key) as source:
            for line in source.read().decode("utf-8").splitlines():
                if not line.strip():
                    continue
                if chosen(line):
                    manifest_lines += 1
                else:
                    kept_manifest.append(line)
    artifact_dirs = sorted(p for p in MODELS_DIR.iterdir() if p.is_dir() and RUN_SUFFIX in p.name and chosen(p.name)) if MODELS_DIR.exists() else []
    comparisons = 0
    if COMPARISONS.exists():
        try:
            comparisons = len(json.loads(COMPARISONS.read_text(encoding="utf-8")))
        except ValueError:
            comparisons = -1

    print(f"lake record recipes under {prefix}: {len(recipes)}")
    for recipe in recipes:
        print("  " + recipe)
    print(f"manifest lines in {manifest_key}: {manifest_lines}")
    print(f"artifact directories under {MODELS_DIR}: {len(artifact_dirs)}")
    for directory in artifact_dirs:
        print("  " + directory.name)
    print(f"saved comparisons (legacy file): {comparisons}")
    entity_rows = {}
    if SQLITE.exists():
        import sqlite3

        with sqlite3.connect(SQLITE) as connection:
            for table in ENTITY_TABLES:
                try:
                    entity_rows[table] = connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                except sqlite3.OperationalError:
                    entity_rows[table] = None
    print("sqlite entity rows: " + ", ".join(f"{table}={count}" for table, count in entity_rows.items()))
    if not args.apply:
        print("\nnothing deleted (pass --apply)")
        return 0

    for recipe in recipes:
        try:
            filesystem.delete_dir(recipe)
        except FileNotFoundError:
            # an object store lists a prefix whose objects are already gone; nothing to delete
            print("already gone " + recipe)
            continue
        print("deleted " + recipe)
    if manifest_lines:
        with filesystem.open_output_stream(manifest_key) as sink:
            sink.write("".join(line + "\n" for line in kept_manifest).encode("utf-8"))
        print(("rewrote " if kept_manifest else "emptied ") + manifest_key + f" ({manifest_lines} line(s) removed, {len(kept_manifest)} kept)")
    for directory in artifact_dirs:
        shutil.rmtree(directory, ignore_errors=False)
        print("removed " + directory.name)
    if COMPARISONS.exists() and not only:
        COMPARISONS.unlink()
        print("removed " + os.fspath(COMPARISONS))
    if SQLITE.exists():
        import sqlite3

        with sqlite3.connect(SQLITE) as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            for table in ENTITY_TABLES:
                if entity_rows.get(table) is None:
                    continue
                if not only:
                    connection.execute(f"DELETE FROM {table}")
                elif table == "saved_analytics":
                    # a saved comparison with no runs left is dropped with them
                    connection.execute("DELETE FROM saved_analytics WHERE analytics_id NOT IN (SELECT analytics_id FROM saved_analytics_runs)")
                else:
                    marks = ",".join("?" for _ in only)
                    connection.execute(f"DELETE FROM {table} WHERE run_id IN ({marks})", sorted(only))
            connection.commit()
        print(("pruned" if only else "emptied") + " sqlite: " + ", ".join(table for table in ENTITY_TABLES if entity_rows.get(table) is not None))
    print("\ndone: " + (f"{len(only)} run(s) purged; the rest of the history is kept" if only else "the run history is empty"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
