"""Build and land the in-depth metric tables for every Model Cycle run already in the lake.

A run that finishes now lands its seven report tables itself (``cycle/store.py``
calls ``cycle/report.py`` at every fold end); this back-fills the runs recorded
before that. For each recipe under ``s3://derived/model_cycle_runs/`` it reads the
run's own record through the dashboard's views (``derived_model_cycle_runs_*``),
builds the tables, checks that the thirty scoreboard metrics they carry equal what
each fold recorded (and the run's final ones when the run table exists), and lands
them under the same recipe with one manifest line per table:

    s3://derived/model_cycle_runs/recipe=<run>/table=<model_metrics|trading_metrics|
        calibration_bins|confusion_matrix|distributions|drawdowns|daily_results>/part-0.parquet

A run recorded before 2026-09-27 has no per-bar net profit (it is taken from the
change in the recorded equity) and no per-bar exposure (those metrics stay null, with
the reason in ``note``). A run whose tables do not reproduce what it recorded is not
landed.

    .venv/Scripts/python.exe scripts/land_model_cycle_metrics.py [--dry-run] [--recipe <recipe>] [--no-refresh]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import urllib.request
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY / "src" / "ml"))

from cycle import report, store  # noqa: E402
from cycle.metrics import METRIC_NAMES  # noqa: E402

DASHBOARD_REFRESH = "http://127.0.0.1:5000/api/labels/catalog/refresh"


def connect():
    from lake.serving import connect as serving_connect

    connection = serving_connect(with_derived=True)
    connection.execute("SET TimeZone='UTC'")
    return connection


def view_exists(connection, name: str) -> bool:
    return bool(connection.execute("SELECT count(*) FROM duckdb_views() WHERE view_name = ?", [name]).fetchone()[0])


def read(connection, table: str, recipe: str):
    name = f"derived_model_cycle_runs_{table}"
    if not view_exists(connection, name):
        return None
    arrow = connection.execute(f'SELECT * EXCLUDE (recipe) FROM "{name}" WHERE recipe = ?', [recipe])
    arrow = arrow.to_arrow_table() if hasattr(arrow, "to_arrow_table") else arrow.fetch_arrow_table()
    return arrow if arrow.num_rows else None


def mismatches(tables, folds, run_row) -> list[str]:
    """Scoreboard metrics that differ from what the run recorded."""
    out: list[str] = []

    def compare(label: str, ours: dict, recorded: dict) -> None:
        for name in METRIC_NAMES:
            a, b = ours.get(name), recorded.get(name)
            b = None if b is None or (isinstance(b, float) and math.isnan(b)) else b
            if a is None and b is None:
                continue
            if a is None or b is None or abs(a - b) > 1e-9 * max(1.0, abs(b)):
                out.append(f"{label} {name}: report {a} vs recorded {b}")

    for row in (folds.to_pylist() if folds is not None else []):
        metrics = json.loads(row["metrics"]) if isinstance(row.get("metrics"), str) and row["metrics"] else {}
        if metrics:
            compare(f"fold {row['fold_index'] + 1}", report.scoreboard_values(tables, "fold", row["fold_index"]), metrics)
    if run_row is not None and run_row.get("final_metrics"):
        compare("run", report.scoreboard_values(tables, "run", None), json.loads(run_row["final_metrics"]))
    return out


def build(connection, recipe: str):
    predictions = read(connection, "predictions", recipe)
    trades = read(connection, "trades", recipe)
    folds = read(connection, "folds", recipe)
    runs = read(connection, "runs", recipe)
    if predictions is None:
        return None, ["no predictions"], None
    run_row = runs.to_pylist()[0] if runs is not None else None
    model_id = run_row["model_id"] if run_row else recipe.replace("_walk_forward_cycle_", "+walk_forward_cycle_")
    symbol = run_row["symbol"] if run_row else recipe.split("_", 1)[0]
    if trades is None:   # a run that closed no trade
        trades = pa.table({"net_profit_usd": pa.array([], type=pa.float64())})
    inputs = report.inputs_from_tables(model_id, symbol, predictions, trades, folds,
                                       run_row.get("bars_per_year") if run_row else None)
    tables = report.build_report(inputs)
    problems = mismatches(tables, folds, run_row)
    if inputs.predictions["exposed"] is None:
        # the run recorded no per-bar exposure: its tables carry it as unknown, not as a difference
        problems = [line for line in problems if "exposure_fraction: report None" not in line]
    return tables, problems, inputs


def recipes(connection) -> list[str]:
    found: set[str] = set()
    for table in ("predictions", "runs", "folds"):
        name = f"derived_model_cycle_runs_{table}"
        if view_exists(connection, name):
            found |= {row[0] for row in connection.execute(f'SELECT DISTINCT recipe FROM "{name}"').fetchall()}
    return sorted(found)


def land(recipe: str, model_id: str, tables) -> dict:
    """Write the tables to a temporary folder and land them with the run record's own
    landing (one manifest line per (recipe, table), appended once)."""
    with tempfile.TemporaryDirectory() as folder:
        paths = {}
        for name, table in tables.items():
            paths[name] = str(Path(folder) / f"{name}.parquet")
            pq.write_table(table, paths[name], compression="zstd")
        job = {"dataset": store.DATASET, "recipe": recipe, "tables": paths, "manifest_for": list(paths),
               "source": f"in-depth metric tables back-filled for model cycle run {model_id} (scripts/land_model_cycle_metrics.py)"}
        return store._land_job(job)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="build and check every run; land nothing")
    parser.add_argument("--recipe", help="only this recipe")
    parser.add_argument("--no-refresh", action="store_true", help="do not ask the dashboard to redefine its views")
    args = parser.parse_args()
    connection = connect()
    targets = [args.recipe] if args.recipe else recipes(connection)
    print(f"{len(targets)} runs")
    landed = failed = 0
    for recipe in targets:
        tables, problems, inputs = build(connection, recipe)
        if tables is None:
            print(f"  {recipe}: skipped ({'; '.join(problems)})")
            failed += 1
            continue
        blocking = problems
        counts = ", ".join(f"{name} {table.num_rows}" for name, table in tables.items())
        status = "checked" if not blocking else f"{len(blocking)} scoreboard differences"
        print(f"  {recipe}: {status}; {counts}")
        for line in problems[:6]:
            print(f"      {line}")
        if blocking:
            print("      not landed: the report does not reproduce what the run recorded")
            failed += 1
            continue
        if args.dry_run:
            continue
        result = land(recipe, inputs.model_id, tables)
        written = sum(1 for info in result.values() if info["manifest"] == "written")
        unlisted = [name for name, info in result.items() if info["manifest"].startswith("not written")]
        print(f"      landed {len(result)} tables ({written} new manifest lines)" + (f"; manifest NOT written for {unlisted}" if unlisted else ""))
        landed += 1
    print(f"landed {landed}, not landed {failed}" + (" (dry run)" if args.dry_run else ""))
    if landed and not args.no_refresh:
        try:
            request = urllib.request.Request(DASHBOARD_REFRESH, method="POST")
            with urllib.request.urlopen(request, timeout=60) as response:
                print(f"dashboard views refreshed ({response.status})")
        except OSError as error:
            print(f"the dashboard did not refresh its views ({error}); it will on its next start")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
