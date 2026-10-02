"""Land the per-pair FX signal research in the lake for the `fx-pair-signals` study.

The notebook this replaced (Trading/forexmodel/notebooks/19_pair_signals.py)
computed nothing: it read eight CSVs that forexmodel's scripts write
(`scripts/pair_spread.py`, `pair_correlation.py`, `pair_structure.py`) and only
grouped, pivoted and sorted them. Re-running those scripts takes tens of
minutes (a 500-permutation block null over 5,400 tests), so this build lands
their emitted rows unchanged, read the way the notebook read them (polars
`read_csv`), with every column renamed to full words. The study's server
handler does the notebook's group-bys in SQL over the landed tables.

    derived/study_fx_pair_signals/recipe=<RECIPE>/table=<name>/part-0.parquet
    meta/ingest_manifests/study_fx_pair_signals.jsonl   one line per table

Served by the dashboard as `derived_study_fx_pair_signals_<name>`.

Run:  E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/fx_pair_signals/build.py
It refuses to land a recipe that already exists (write-once).
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import polars as pl

REPOSITORY = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPOSITORY / "src" / "ml"))

from ta_strategy.store import land  # noqa: E402

DATASET = "study_fx_pair_signals"
# The CSVs were written by the forexmodel scripts on 2026-09-09.
RECIPE = "forexmodel_pair_results_2026_09_09"
RESULTS = REPOSITORY / "Trading" / "forexmodel" / "results"

STATISTIC_SUFFIX = {
    "n": "count", "mean": "mean", "median": "median", "std": "standard_deviation", "skew": "skewness",
    "kurtosis": "excess_kurtosis", "p25": "percentile_25", "p50": "percentile_50", "p75": "percentile_75",
    "min": "minimum", "max": "maximum", "n_dropped": "dropped_count",
}


def _spread_names(columns: list[str]) -> dict[str, str]:
    """spread_pips_std -> spread_pips_standard_deviation, and so on for both units."""
    names: dict[str, str] = {}
    for column in columns:
        for unit in ("spread_pips_", "spread_basis_points_"):
            if column.startswith(unit):
                suffix = column[len(unit):]
                names[column] = unit + STATISTIC_SUFFIX.get(suffix, suffix)
    return names


TIMESTAMP_COLUMNS = {
    "pair_inventory": ["first_bar_timestamp", "last_bar_timestamp", "first_quote_timestamp", "last_quote_timestamp"],
    "pair_spread": ["first_quote_timestamp", "last_quote_timestamp"],
}

# table name -> (source CSV, explicit renames beyond the spread statistics)
SOURCES: dict[str, tuple[str, dict[str, str]]] = {
    "pair_inventory": ("95_pair_inventory.csv", {
        "symbol": "pair", "bars": "bar_count", "first_bar": "first_bar_timestamp", "last_bar": "last_bar_timestamp",
        "bars_with_quotes": "bars_with_quotes_count", "first_quote": "first_quote_timestamp",
        "last_quote": "last_quote_timestamp", "quote_coverage": "quote_coverage_ratio",
    }),
    "pair_spread": ("96_pair_spread.csv", {"quote_first": "first_quote_timestamp", "quote_last": "last_quote_timestamp"}),
    "pair_spread_hour": ("97_pair_spread_hour.csv", {}),
    "pair_tradability": ("98_pair_tradability.csv", {
        "bars": "bar_count",
        "atr14_price": "average_true_range_14_bars_price",
        "atr14_pips": "average_true_range_14_bars_pips",
        "atr14_basis_points": "average_true_range_14_bars_basis_points",
        "spread_pips": "median_spread_pips",
        "spread_over_atr": "spread_over_average_true_range",
        "roundtrip_over_atr": "round_trip_over_average_true_range",
        "breakeven_move_atr": "breakeven_move_average_true_ranges",
        "breakeven_move_pips": "breakeven_move_pips",
    }),
    "pair_correlation": ("99_pair_correlation.csv", {
        "n_observations": "observation_count", "n_tail_observations": "tail_observation_count",
        "n_residual_observations": "residual_observation_count",
    }),
    "correlation_eigen": ("101_correlation_eigen.csv", {"n_observations": "observation_count"}),
    "structure_screen": ("103_structure_screen.csv", {
        "n_observations": "observation_count", "spearman": "spearman_correlation",
        "null_95_per_feature": "null_95th_percentile_per_feature",
        "null_95_family_wise": "null_95th_percentile_family_wise",
    }),
    "structure_redundancy": ("105_structure_redundancy.csv", {"spearman": "spearman_correlation"}),
}


def read_tables() -> dict[str, pl.DataFrame]:
    tables: dict[str, pl.DataFrame] = {}
    for name, (filename, renames) in SOURCES.items():
        frame = pl.read_csv(RESULTS / filename)
        mapping = {**_spread_names(frame.columns), **renames}
        frame = frame.rename({old: new for old, new in mapping.items() if old in frame.columns})
        for column in TIMESTAMP_COLUMNS.get(name, []):
            frame = frame.with_columns(
                pl.col(column).str.to_datetime("%Y-%m-%dT%H:%M:%S%.f%z", time_zone="UTC").dt.replace_time_zone(None)
            )
        tables[name] = frame
    return tables


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    key = arrow_key(derived_root(DATASET, RECIPE))
    return arrow_fs().get_file_info(key).type != FileType.NotFound


def main() -> int:
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    tables = read_tables()
    with tempfile.TemporaryDirectory(prefix="study_fx_pair_signals_") as directory:
        paths = {}
        for name, frame in tables.items():
            path = os.path.join(directory, f"{name}.parquet")
            frame.write_parquet(path)
            paths[name] = path
        result = land(paths, RECIPE, f"forexmodel results CSVs 95-105 ({RESULTS})", dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
