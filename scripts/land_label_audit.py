"""Land the 2026-09-26 label audit as a derived dataset.

The audit read every label producer in the repository and the six label tables
in the lake, then fixed what it could. This lands the record so the notebook
`notebooks/label_catalog.py` and the SQL console can read it as
``derived_label_audit_<table>``:

    generators      every generator id: category, encoding, horizon parameter, what changed
    findings        the ranked defects with where they were, severity and what was done
    legacy_tables   the six label tables that predate the contract: rows, span, producer, status
    suite           the canonical suite ("label the data") as landed

    s3://derived/label_audit/recipe=audit_2026_09_26/table=<name>/part-0.parquet

Run with the datalake interpreter (it carries the ``lake`` package):

    E:/source/repos/datalake/.venv/Scripts/python.exe scripts/land_label_audit.py
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import polars as pl
import pyarrow.parquet as pq
from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key, derived_root
from lake.writer import COMPRESSION, COMPRESSION_LEVEL

DATASET = "label_audit"
RECIPE = "audit_2026_09_26"

GENERATORS = [
    # id, category, encoding, horizon parameter, describes the bar itself, what the audit changed
    ("direction", "classification", "signed_direction", "horizonBars", False, "parameter names to full words; resolution_bars emitted"),
    ("next_close_direction", "classification", "signed_direction", "horizonBars", False, "parameter names to full words; resolution_bars emitted"),
    ("signal", "classification", "signed_direction", "holdPeriodBars", False, "parameter names to full words; resolution_bars emitted"),
    ("regime", "classification", "class_id", None, True, "PERCENT_RANK over the whole range replaced by a trailing median; 3-regime cutoff in volatility units; warmup NULL"),
    ("future_return", "regression", "continuous", "horizonBars", False, "whole-range z-score replaced by trailing statistics of the backward return; CTE renamed off a reserved word"),
    ("future_volatility", "regression", "continuous", "horizonBars", False, "rolling deviation guarded (NULL until the window is full); resolution_bars emitted"),
    ("multi_step", "sequence", "binary_meta", "horizons", False, "resolution_bars = the furthest horizon"),
    ("triple_barrier", "classification", "signed_direction", "holdingPeriodBars", False, "barriers in volatility units (ATR or return std) with asymmetric multiples; fill at the barrier or the gap open; same-bar touch flagged, not guessed; vertical exit labelled by sign; minimum return marks usable=false instead of dropping"),
    ("npmm", "classification", "signed_direction", "lookforwardBars", False, "parameter names to full words; CTE renamed off a reserved word"),
    ("volatility_adaptive", "classification", "signed_direction", "horizonBars", False, "rolling deviation guarded; output columns to full words"),
    ("trend_scanning", "classification", "signed_direction", "horizon_bars (per row)", False, "real least-squares t on log close over the forward window; Šidák-adjusted threshold for the horizons tested; scaled t emitted"),
    ("meta_label", "classification", "binary_meta", "horizonBars", False, "rendered through its self-contained builder; window filter qualified by alias; net_pnl to net_profit_fraction"),
    ("range_bucket", "classification", "class_id", "horizonBars", False, "parameter names to full words; delta_pts to delta_points"),
    ("structural", "classification", "class_id", None, True, "output columns to full words; resolution_bars = 0"),
    ("pseudo_confidence", "semi-supervised", "signed_direction", "horizonBars", False, "warmup rows dropped instead of scaled by zero; resolution_bars emitted"),
    ("consistency_perturbation", "semi-supervised", "signed_direction", "1 (fixed)", False, "resolution_bars emitted"),
    ("talib_candle_pattern (+16 per-pattern ids)", "candle-pattern", "signed_direction", None, True, "resolution_bars = 0 on computed rows"),
    ("contrastive_temporal / statistical / augmentation", "contrastive", "pairs", None, True, "SQL routed through the sampled bars at the requested timeframe (window was counted in sub-minute rows)"),
]

FINDINGS = [
    # severity, area, where, finding, action
    ("high", "server", "sqlLabelGenerators/helpers.ts rollingStd", "warmup rows evaluated to exactly 0 (AVG(x^2) - AVG(x)^2 over a one-row frame), so a barrier in volatility units collapsed onto the entry price for the first rows of every bounded request", "fixed: every trailing aggregate is guarded by a row count and NULL until the frame is full"),
    ("high", "server", "sqlLabelGenerators/trendScanning.ts", "max |pseudo-t| over 18 horizons with no correction; 93% of MNQ 5m bars labelled significant at t >= 2", "fixed: least-squares t on log close, Šidák-adjusted threshold, scaled t beside it"),
    ("high", "python", "packages/ml-engine/packages/shared/src/labels.py triple barrier", "fixed basis-point barrier only; the reference model had measured 14.6% keep rate on daily bars vs 94% ATR-scaled", "fixed: ATR-scaled kernel is the shared one; xgb_classifier re-exports it"),
    ("high", "python", "_walk_forward.py.j2 / codegen.router.ts", "purge defaulted to 0 and was never derived from the label horizon", "fixed: purge = max(requested, label horizon) in the template; codegen clamps and warns; a landed set carries its purge"),
    ("high", "lake", "mnq_tbl_5m, mnq_swing_5m", "1,409,553 + 469,851 rows with no producer in any repository", "reported: kept as legacy; the suite lands triple-barrier and structural sets with a recorded recipe"),
    ("medium", "server", "futureReturn.ts normalize, marketRegime.ts PERCENT_RANK", "whole-series statistics: a bar's label changed with the query's end date", "fixed: trailing windows; the truncation gate now fails any generator that does this"),
    ("medium", "server", "tripleBarrier.ts", "realised return was the horizon-end close even when a barrier resolved the row; same-bar double touch guessed by proximity; vol_scale used the whole-sample mean volatility", "fixed: fill price at the barrier or the gap open; ambiguity flagged; causal scale"),
    ("medium", "server", "contrastivePairs.ts", "read the sub-minute table directly, so a 60-bar window was ~3 minutes of ticks", "fixed: routed through the sampled bars"),
    ("medium", "server", "generated_labels", "no idempotency (three identical requests made ids 6, 7, 8) and no horizon or resolution recorded", "fixed: recipe identity with a unique index; max_horizon_bars, purge_bars, embargo_bars, validation, source fingerprint on the row"),
    ("medium", "lake", "derived/recipe=lake_full_2026-09-09", "the snapshot the dashboard serves has no ingest manifest", "reported"),
    ("medium", "lake", "mnq_labels_1m vs mnq_labels_1m_new", "byte-identical (full EXCEPT both ways = 0 rows); the migration plan marked the first obsolete and the drop never ran", "reported: deleting data is not the dashboard's call"),
    ("medium", "lake", "mnq_zigzag_1m", "580 timestamps (2026-03-02 to 2026-03-27) that are not in mnq_ohlcv_1m", "reported"),
    ("medium", "lake", "derived/ layout", "two layouts on disk: derived/<dataset>/recipe=... (documented) and derived/recipe=.../table=... (hand-built)", "fixed for labels: landed under the documented layout; the dashboard's derived views follow the manifests"),
    ("low", "server", "tests", "only 4 of 33 generator ids had their SQL executed by any test", "fixed: every registry generator is executed, checked for the contract columns, and put through the truncation test"),
    ("low", "server", "output and parameter names", "abbreviations in landed columns and UI parameters (rolling_vol, delta_pts, takeProfitPct, minProfitBps, ...)", "fixed: full words with units; legacy names still accepted at the API"),
    ("low", "python", "test_labels_mnq.py", "cites a rule file that does not exist on disk; reads a repo-local parquet snapshot rather than the lake", "reported: the contract tests read the lake"),
    ("low", "python", "labeling/structural.py vs labels.py structural_labels", "two unrelated things named structural (regime naming vs a swing label)", "reported"),
    ("low", "quant", "cnn_transformer/direction_labels.py", "returns `horizon` where the sibling generators return `forward_reach`", "reported"),
    ("low", "lake", "legacy label tables", "abbreviated columns (dir_h1, tbl_label, rng_bucket_h1, zz_pct, w_uniqueness, ...) not in the naming migration inventory", "reported: added to docs/column-naming-migration.md"),
]

LEGACY_TABLES = [
    # table, rows, first, last, producer, status
    ("mnq_labels_1m", 2_340_445, "2019-05-05", "2025-12-24", "none found; byte-identical to mnq_labels_1m_new", "obsolete duplicate (reported, not deleted)"),
    ("mnq_labels_1m_new", 2_340_445, "2019-05-05", "2025-12-24", "Trading/quant/model/scripts/build_label_dataset.py", "legacy: 49 abbreviated columns; 6 days behind the bars"),
    ("mnq_tbl_5m", 1_409_553, "2019-05-05", "2025-12-30", "none in any repository", "irreplaceable; superseded by the suite's triple-barrier recipes"),
    ("mnq_swing_5m", 469_851, "2019-05-05", "2025-12-30", "none in any repository", "irreplaceable; carries w_uniqueness and w_proximity"),
    ("mnq_zigzag_1m", 647_506, "2024-03-01", "2026-03-27", "Trading/quant/analytics/zigzag/columns.py (loader deleted)", "580 timestamps not in mnq_ohlcv_1m; repainting columns not marked by name"),
    ("talib_candle_patterns", 216_540, "2025-09-30", "2025-12-30", "analytics/structure/to_lake.py (file gone)", "three months only; the chart computes patterns itself"),
]


def write_table(name: str, frame: pl.DataFrame, source: str) -> None:
    root = derived_root(DATASET, RECIPE) / f"table={name}"
    key = arrow_key(root / "part-0.parquet")
    with arrow_fs().open_output_stream(key) as sink:
        pq.write_table(frame.to_arrow(), sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
    size = arrow_fs().get_file_info(key).size
    entry = {
        "written_at": datetime.now(timezone.utc).isoformat(), "dataset": DATASET, "table": name,
        "zone": "derived", "recipe": RECIPE, "source": source, "rows": frame.height,
        "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None,
    }
    with (INGEST_MANIFESTS / f"{DATASET}.jsonl").open("a", encoding="utf-8") as manifest:
        manifest.write(json.dumps(entry) + "\n")
    print(f"  {name}: {frame.height} rows, {frame.width} columns, {size:,} bytes")


def suite_frame() -> pl.DataFrame:
    """The suite as the dashboard declares it (`apps/api/infrastructure/lib/labels/labelSuite.ts`), read from the running server."""
    import urllib.request

    with urllib.request.urlopen("http://127.0.0.1:5000/api/labels/suite", timeout=30) as response:
        payload = json.load(response)
    rows = [
        {
            "name": e["name"], "generator_type": e["generatorType"], "symbol": e["symbol"],
            "timeframe_minutes": e["timeframeMinutes"], "parameters": json.dumps(e["params"], sort_keys=True),
        }
        for e in payload["entries"]
    ]
    return pl.DataFrame(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skip-suite", action="store_true", help="do not read the suite from the dashboard")
    args = parser.parse_args()
    print(f"landing {DATASET} recipe={RECIPE}")
    write_table("generators", pl.DataFrame(
        [{"generator_id": g[0], "category": g[1], "label_encoding": g[2], "horizon_parameter": g[3], "describes_the_bar_itself": g[4], "audit_change": g[5]} for g in GENERATORS]
    ), source="apps/api/infrastructure/lib/labels/sqlLabelGenerators")
    write_table("findings", pl.DataFrame(
        [{"severity": f[0], "area": f[1], "location": f[2], "finding": f[3], "action": f[4]} for f in FINDINGS]
    ), source="docs/plans/2026-09-26-label-lifecycle.md")
    write_table("legacy_tables", pl.DataFrame(
        [{"table_name": t[0], "row_count": t[1], "first_day": t[2], "last_day": t[3], "producer": t[4], "status": t[5]} for t in LEGACY_TABLES]
    ), source="lake serving snapshot derived/recipe=lake_full_2026-09-09")
    if not args.skip_suite:
        write_table("suite", suite_frame(), source="GET /api/labels/suite")
    print(f"done: s3://derived/{DATASET}/recipe={RECIPE}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

