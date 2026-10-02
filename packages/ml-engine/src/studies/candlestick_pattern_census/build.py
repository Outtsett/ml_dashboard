"""Land the pattern-vocabulary tables for the `candlestick-pattern-census` study.

The notebook this replaced (datalake/notebooks/candlestick_pattern_census.py)
read one lake dataset, ``derived/mnq_candlestick_pattern_census`` (305 rows =
61 TA-Lib patterns x 5 timeframes), which the dashboard already serves as
``derived_mnq_candlestick_pattern_census``. Two things it showed were typed into
the notebook instead of stored: the table of seven pattern registries on this
machine, and the TA-Lib library counts (161 functions, 61 candlestick). This
script COUNTS each of them from its source, and lands the result, so the page
shows measured definition counts instead of literals:

    derived/study_candlestick_pattern_census/recipe=pattern_registries_2026_09_30/table=<name>/part-0.parquet
    meta/ingest_manifests/study_candlestick_pattern_census.jsonl        one line per table

served by the dashboard as ``derived_study_candlestick_pattern_census_<name>``:

    registries        7 rows: registry, how many pattern definitions it holds (counted from the
                      source file or library), what kind of definition, where it lives, and the
                      count the notebook had typed
    talib_provenance  one row per TA-Lib in play: the datalake interpreter (0.7.1, which built the
                      census), the dashboard interpreter (0.8.1, which verifies the chart's 88
                      drawings) and the version the rules file states; with function counts

Run once:  E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/candlestick_pattern_census/build.py
It refuses to land a recipe that already exists (write-once). ``--dry-run`` prints the tables and lands nothing.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from ta_strategy.store import (
    land,  # noqa: E402  the Model Cycle landing job, as the TA strategy rounds use it
)

DATALAKE = Path(os.environ.get("DATALAKE_REPOSITORY", r"E:\source\repos\datalake"))
DASHBOARD_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
DATASET = "study_candlestick_pattern_census"
RECIPE = "pattern_registries_2026_09_30"

REGISTRY_FILE = ROOT / "apps/web/src/market/lib/candles/registry.ts"
TAXONOMY_FILE = ROOT / "packages/shared/src/mlTaxonomy.ts"
CHART_CNN_FILE = ROOT / "Trading/quant/chart_cnn/pkg/patterns.py"
PRIMITIVES_FILE = ROOT / "Trading/quant/primitives/packages/ml-engine/packages/shared/src/primitives/features.py"
RULES_FILE = DATALAKE / "scripts" / "talib_candlestick_rules.json"


def load_module(name: str, path: Path):
    """Import one file by path (the datalake scripts are not a package)."""
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def talib_counts() -> tuple[str, int, int]:
    import talib

    groups = talib.get_function_groups()
    return str(talib.__version__), len(talib.get_functions()), len(groups["Pattern Recognition"])


def dashboard_talib() -> tuple[str, int, int]:
    """The dashboard interpreter's TA-Lib, asked in its own process."""
    code = (
        "import json, talib; g = talib.get_function_groups(); "
        "print(json.dumps([str(talib.__version__), len(talib.get_functions()), len(g['Pattern Recognition'])]))"
    )
    completed = subprocess.run([str(DASHBOARD_PYTHON), "-c", code], capture_output=True, text=True, timeout=120,
                               stdin=subprocess.DEVNULL)
    if completed.returncode != 0:
        raise RuntimeError(f"dashboard interpreter failed: {(completed.stderr or completed.stdout)[-300:]}")
    version, total, patterns = json.loads(completed.stdout.strip().splitlines()[-1])
    return version, total, patterns


def count_registry_detectors() -> int:
    source = REGISTRY_FILE.read_text(encoding="utf-8-sig")
    body = source[source.index("PATTERN_DETECTORS"):]
    return len(re.findall(r"\{\s*name:\s*'CDL_", body))


def count_taxonomy_candle_patterns() -> int:
    return len(re.findall(r"category:\s*'candle-pattern'", TAXONOMY_FILE.read_text(encoding="utf-8-sig")))


def count_primitive_candle_functions() -> int:
    source = PRIMITIVES_FILE.read_text(encoding="utf-8-sig")
    return len(re.findall(r"^def _(?:doji|engulfing)_strength\(", source, flags=re.MULTILINE))


def registries() -> pd.DataFrame:
    margins = load_module("candlestick_rule_margins", DATALAKE / "scripts" / "candlestick_rule_margins.py")
    reference = load_module("candlestick_reference", DATALAKE / "scripts" / "candlestick_reference.py")
    chart_cnn = load_module("chart_cnn_patterns", CHART_CNN_FILE)
    _version, _total, pattern_count = talib_counts()
    rows = [
        ("TA-Lib Pattern Recognition group", pattern_count, "library",
         "talib.get_function_groups()['Pattern Recognition'] (datalake interpreter)",
         "length of the group, read from the installed library", 61),
        ("ml_dashboard chart-overlay detectors", count_registry_detectors(), "hand-written",
         "ml_dashboard/apps/web/src/market/lib/candles/registry.ts PATTERN_DETECTORS",
         "entries named CDL_* after PATTERN_DETECTORS", 60),
        ("datalake pure-Python margin re-implementations", len(margins.MARGINS), "re-implementation of TA-Lib",
         "datalake/scripts/candlestick_rule_margins.py MARGINS (61 minus the 2 stateful Hikkake rules)",
         "len(MARGINS), imported", 59),
        ("chart_cnn real-bar arithmetic rules", len(chart_cnn.NAMES), "hand-written",
         "Trading/quant/chart_cnn/pkg/patterns.py NAMES",
         "len(NAMES), imported", 17),
        ("ml_dashboard label taxonomy", count_taxonomy_candle_patterns(), "subset of TA-Lib",
         "ml_dashboard/packages/shared/src/mlTaxonomy.ts entries with category 'candle-pattern'",
         "entries with category 'candle-pattern'", 17),
        ("datalake reference re-implementations", len(reference.REFERENCE), "re-implementation of TA-Lib",
         "datalake/scripts/candlestick_reference.py REFERENCE",
         "len(REFERENCE), imported", 6),
        ("584-primitive engine candle primitives", count_primitive_candle_functions(), "continuous primitive",
         "Trading/quant/primitives/packages/ml-engine/packages/shared/src/primitives/features.py _doji_strength, _engulfing_strength "
         "(x8 derivations = 16 columns)",
         "functions named _doji_strength and _engulfing_strength", 2),
    ]
    return pd.DataFrame(rows, columns=[
        "registry_name", "definition_count", "definition_kind", "where_it_lives", "how_counted",
        "definition_count_typed_in_notebook",
    ]).assign(count_matches_notebook=lambda frame: frame["definition_count"] == frame["definition_count_typed_in_notebook"])


def provenance() -> pd.DataFrame:
    rules = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    stated = re.search(r"TA-Lib ([0-9][0-9.]*)", rules["description"])
    version, total, patterns = talib_counts()
    dashboard_version, dashboard_total, dashboard_patterns = dashboard_talib()
    rows = [
        ("datalake interpreter (built the census)", version, total, patterns,
         "the library that computed every firing in derived_mnq_candlestick_pattern_census"),
        ("ml_dashboard interpreter (verifies the chart's pattern drawings)", dashboard_version, dashboard_total, dashboard_patterns,
         "scripts/build_candle_pattern_templates.py refuses any drawing this library does not fire on"),
        ("datalake scripts/talib_candlestick_rules.json (how each pattern is formed)",
         stated.group(1) if stated else "unknown", None, len(rules["patterns"]),
         "the version the rules file says it was read from: " + rules["description"].split(",")[0]),
    ]
    return pd.DataFrame(rows, columns=[
        "source_name", "talib_version", "library_function_count", "candlestick_function_count", "detail",
    ]).astype({"library_function_count": "Int64"})


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    key = arrow_key(derived_root(DATASET, RECIPE))
    return arrow_fs().get_file_info(key).type != FileType.NotFound


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="print the tables and land nothing")
    arguments = parser.parse_args()
    tables = {"registries": registries(), "talib_provenance": provenance()}
    for name, frame in tables.items():
        print(f"--- {name} ({len(frame)} rows)")
        print(frame.to_string(index=False, max_colwidth=70))
    mismatched = tables["registries"].loc[~tables["registries"]["count_matches_notebook"], "registry_name"].tolist()
    if mismatched:
        print(f"counts that differ from the notebook's typed figures: {mismatched}")
    if arguments.dry_run:
        return 0
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    with tempfile.TemporaryDirectory(prefix="study_candlestick_pattern_census_") as directory:
        paths: dict[str, str] = {}
        for name, frame in tables.items():
            path = os.path.join(directory, f"{name}.parquet")
            frame.to_parquet(path, index=False)
            paths[name] = path
        result = land(paths, RECIPE, "counted from each registry's source (study candlestick-pattern-census build.py)",
                      dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
