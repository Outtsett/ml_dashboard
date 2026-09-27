"""Land the 2026-09-26 Model Cycle audit as a derived dataset.

The audit read the Model Cycle end to end (engine, tuning, record, wire,
client), the model catalog against the Cycle's registry, and what each run
leaves behind; most of what it found was then fixed. This lands the record so
`notebooks/model_cycle_runs.py` and the SQL console read it as
``derived_model_cycle_audit_<table>``:

    findings      every finding: where, severity, what, what was done
    coverage      every written catalog spec: runnable in the Cycle (registry key) or why not
    record        every table a run lands: one row per, columns, landed per fold

    s3://derived/model_cycle_audit/recipe=audit_2026_09_26/table=<name>/part-0.parquet

Run with the datalake interpreter (it carries the ``lake`` package):

    E:/source/repos/datalake/.venv/Scripts/python.exe scripts/land_model_cycle_audit.py
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import pyarrow.parquet as pq
from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key, derived_root
from lake.writer import COMPRESSION, COMPRESSION_LEVEL

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY / "src" / "ml"))

DATASET = "model_cycle_audit"
RECIPE = "audit_2026_09_26"

# (area, severity, where, finding, status, what was done)
FINDINGS = [
    ("record", "high", "src/ml/cycle/engine.py run()", "Only StopRequested was caught: any other exception wrote no run record at all (predictions, trades, folds, scoreboard lost)", "fixed", "run() catches every exception, writes the record with status failed and re-raises; the record is also written at the end of every fold"),
    ("record", "high", "src/ml/cycle/store.py", "The lake copy of a run carried no configuration (parameters, tuned values, label horizon, cost model, features) and only 3 of the run's tables", "fixed", "8 tables land per run: runs (plan, parameters, status, the 30 final metrics), bars (every bar read), predictions, trades, folds (parameters used), epochs, trials, metrics; landed in-process at every fold end"),
    ("record", "medium", "src/ml/cycle/simulate.py:145 / engine.py", "The `position` column on the wire and in parquet was the NEXT bar's target, not the position held through the bar", "fixed", "predictions carry target_position and position_held; the wire carries positionHeld; bar_net_profit_usd and exposed are recorded too"),
    ("record", "medium", "src/server/training/cycle.ts", "The server kept 5 runs in memory; a restart or the sixth run lost every bar, trade and trial; nothing per bar reached SQLite", "fixed", "GET /api/training/cycle lists live and archived runs; GET /api/training/cycle/:modelId rebuilds any run from the lake (src/server/training/cycleArchive.ts); the page has a run picker"),
    ("forecast", "high", "src/ml/cycle/engine.py:999-1010", "predicted_close = close + output x scale was never rounded: 5,307 of 5,307 forecasts of one run sat off the 0.25 grid", "fixed", "round_to_tick at the one place the forecast is made; predicted_move_points follows the rounded close; the model's own number is kept as predicted_move_raw_points"),
    ("forecast", "medium", "src/ml/cycle/simulate.py:318-328", "Stop and take-profit levels were entry +/- ticks x tick_size with a 0.5-tick step, so a level could sit off the grid and fill there", "fixed", "levels are rounded onto the grid in the adverse direction (level_on_tick)"),
    ("labels", "medium", "src/ml/cycle/labels.py", "Labels, price targets and forecasts ignored session breaks, weekends and outages: 2.2% of one 5m run's test labels spanned a break (largest test gap 49 h)", "fixed", "horizon_crosses_gap: a bar whose horizon crosses a gap over label_gap_multiple x the typical bar interval (default 3) gets no label, target or forecast; the plan reports the count"),
    ("tuning", "high", "src/ml/cycle/engine.py:687-691", "Optuna tuning ran once on fold 0's window and its result was reused by every fold; the plan's parameters were emitted before tuning and never corrected", "fixed", "tuning runs inside every fold on that fold's own training window; cycle_parameters announces what each fold used; trials carry fold_index"),
    ("tuning", "high", "src/config/cycle_models/_cycle.json", "tuning_trials defaulted to 0: every run was hand-configured", "fixed", "tuning_mode defaults to tuned with a budget of 20 trials per fold (or seconds); reviewed_defaults is the explicit opt-out; pins hold a dial by hand"),
    ("tuning", "medium", "src/server/training/cycleRunners.ts:54 / models.py:257-316", "The server stripped every search block before the client saw it; the 8 legacy families' search spaces lived only in Python", "fixed", "search blocks live in the registry JSON for every model and travel to the form (Tunables panel: range, pin, pinned value)"),
    ("tuning", "low", "src/ml/cycle/catalog.py", "A model with no search space would run N identical trials", "fixed", "a fold without a searchable parameter uses the run's parameters and says so"),
    ("data", "medium", "src/ml/cycle/main.py:247-251", "A failed contract lookup continued on raw spliced prices with a warning; a roll would be booked as a price move", "fixed", "the run fails with the reason"),
    ("data", "low", "src/ml/cycle/sklearn_adapter.py:498-514", "Stacking built its out-of-fold predictions with an unpurged KFold (inside the training window only)", "reported", "left as is: it stays inside the training window; a purged time-series split is the improvement"),
    ("data", "low", "src/ml/cycle/engine.py:183-197", "Futures timestamps are Pacific wall clock stored as UTC, so calendar-day folds split mid-session", "reported", "the lake re-stamping is its own job (open finding since 2026-09-23)"),
    ("data", "low", "src/ml/cycle/rolls.py:120-123", "A back-adjusted level includes the gaps of rolls after it; holding across a roll is charged no roll cost", "reported", "documented; the bars table records roll_adjustment_points per bar"),
    ("metrics", "low", "src/ml/cycle/models.py:720 / networks.py:722", "Class-balanced weighting pulls P(up) toward a 50/50 prior, biasing log loss and Brier and making 0.5 mean 'above the prior'", "reported", "documented"),
    ("engine", "low", "src/ml/cycle/engine.py:1017-1019", "The last bar of a fold exits at its close while every other exit fills at the next open", "reported", "documented; a fold's last bar has no next open inside the fold"),
    ("catalog", "medium", "src/config/cycle_models/*.json", "24 of 33 registry models were flipped to runnable in an uncommitted working tree; 9 written specs the Cycle could run had no entry; 108 are rightly unavailable by category", "fixed", "the flips committed; the 9 built as their own modules and registry entries (a stacked-ensemble alias plus 8 new models); every other written spec carries a reason"),
    ("catalog", "medium", "src/config/cost_model.json", "Only MNQ was priced, so the Cycle refused ES, NQ, YM, RTY, MES, MYM and M2K; the NFA fee of $0.02 was stale ($0.01 from 2026-07-01)", "fixed", "all eight lake roots priced from the published CME/CBOT exchange fees and the NFA schedule; clearing, CQG and commission assumed equal to the MNQ account figures until an AMP statement says otherwise"),
    ("tests", "low", "tests/test_cycle_networks.py", "The pytest process exited 0xC0000409 at interpreter teardown after CUDA use, so a green suite read as red", "fixed", "tests/conftest.py terminates the process with the session's own exit status after reporting, like main.py does for a run"),
]

RECORD_TABLES = [
    ("runs", "the run", "plan, base parameters, status (complete / stopped / failed), the 30 final scoreboard metrics as columns, tuning mode and budget, cost model, price adjustment", True),
    ("bars", "every bar the model read, each once", "timestamp, fold, role (context / processed), roll-adjusted OHLCV, roll_adjustment_points", True),
    ("predictions", "every processed test bar", "P(up), predicted direction, target_position, position_held, bar net USD, exposure, equity, actual direction, correct, predicted_move_points (on the tick grid), predicted_move_raw_points, predicted_close, forecast_timestamp, forecast_error_points, crosses_gap", True),
    ("trades", "every trade", "side, contracts, entry and exit fills, bars held, P(up) at entry, gross, cost, net, exit reason", True),
    ("folds", "every fold", "spans, bar counts, timings, metrics, model paths, status, parameters used, tuning objective / trial count / best trial / best value", True),
    ("epochs", "every training step summary", "fold, trial, model role, epoch, losses, accuracy, F1, learning rate, gradient norm, is_best", True),
    ("trials", "every Optuna trial", "fold, trial, state, objective, value, block values, parameters, best so far", True),
    ("metrics", "every emitted metric", "name, value, iteration, total, fold, trial, seconds elapsed", True),
]


def coverage_rows() -> list[dict]:
    """Every written catalog spec against the Cycle's registry, at the time this runs."""
    from cycle import catalog  # noqa: PLC0415

    registry = catalog.registry()
    claimed: dict[str, str] = {}
    for key, entry in registry["models"].items():
        for spec_id in [entry["catalogSpecId"], *entry.get("alsoCatalogSpecIds", [])]:
            if spec_id:
                claimed[spec_id] = key
    fixture = json.loads((REPOSITORY / "tests" / "fixtures" / "catalog-written-specs.json").read_text(encoding="utf-8"))
    rows: list[dict] = []
    specs = fixture if isinstance(fixture, list) else fixture.get("specs") or [s for group in fixture.values() for s in (group if isinstance(group, list) else [])]
    for spec in specs:
        spec_id = spec.get("id") or spec.get("specId")
        if not spec_id:
            continue
        category = spec.get("category") or spec_id.split("-")[0]
        subcategory = spec.get("subcategory") or ""
        key = claimed.get(spec_id)
        if key:
            entry = registry["models"][key]
            status = "runnable" if entry["runnable"] else "registry entry, not runnable"
            reason = entry.get("unavailableReason") or ""
            implementation = entry["implementation"]
            adapter = entry["adapter"]
        else:
            status = "unavailable"
            reason = catalog.unavailable_reason(spec_id, category, subcategory, registry)
            implementation = ""
            adapter = ""
        rows.append({
            "catalog_spec_id": spec_id, "category": category, "subcategory": subcategory,
            "status": status, "registry_key": key or "", "implementation": implementation, "adapter": adapter,
            "reason": reason,
        })
    return rows


def land(name: str, frame: pl.DataFrame, *, source: str) -> dict:
    table = frame.to_arrow()
    root = derived_root(DATASET, RECIPE) / f"table={name}"
    key = arrow_key(root / "part-0.parquet")
    with arrow_fs().open_output_stream(key) as sink:
        pq.write_table(table, sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
    size = arrow_fs().get_file_info(key).size
    entry = {"written_at": datetime.now(timezone.utc).isoformat(), "dataset": DATASET, "table": name, "zone": "derived",
             "recipe": RECIPE, "source": source, "rows": table.num_rows, "duplicates_removed": 0, "file_count": 1,
             "bytes": size, "ts_min": None, "ts_max": None}
    with (INGEST_MANIFESTS / f"{DATASET}.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")
    return {"table": name, "rows": table.num_rows, "bytes": size, "uri": "s3://" + key}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="build the tables and print them; land nothing")
    args = parser.parse_args()
    findings = pl.DataFrame(
        [dict(zip(("area", "severity", "location", "finding", "status", "what_was_done"), row)) for row in FINDINGS]
    ).with_row_index("finding_number", offset=1)
    coverage = pl.DataFrame(coverage_rows())
    record = pl.DataFrame([dict(zip(("table_name", "one_row_per", "columns", "landed_at_every_fold"), row)) for row in RECORD_TABLES])
    print(f"findings: {findings.height} rows | coverage: {coverage.height} specs "
          f"({coverage.filter(pl.col('status') == 'runnable').height} runnable) | record: {record.height} tables")
    if args.dry_run:
        print(coverage.group_by("status").len().sort("status").to_dicts())   # ASCII: the console is cp1252
        return 0
    source = "Model Cycle audit 2026-09-26 (scripts/land_model_cycle_audit.py)"
    for name, frame in (("findings", findings), ("coverage", coverage), ("record", record)):
        result = land(name, frame, source=source)
        print(f"landed {result['table']}: {result['rows']} rows, {result['bytes']} bytes -> {result['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
