r"""Land the Lens vector-space study in the lake under a manifested dataset.

The notebook ``Trading/quant/model/notebooks/vector_space_explained.py`` read
four tables from ``s3://derived/recipe=lens_vector_space_study/table=<name>/``,
written on 2026-09-17 by ``Trading/quant/model/scripts/build_vector_space_study.py``
from the Lens run ``multimodal_MNQ_1h``:

    standardized_features   bar_index, feature_name, block_name, value   (4,000 bars x 32 features, z-scored)
    component_spectrum      basis, component_number, eigenvalue, variance_share, cumulative_variance_share
    component_loadings      basis, component_number, feature_name, block_name, loading   (components 1 to 4)
    neighbour_index_recall  basis, neighbour_count, ef_search (0 = exact scan), recall_at_k, mean_query_milliseconds

That path has no ``<dataset>/`` level and no manifest line, so the dashboard's
DuckDB never defined a view over it. This job copies the four tables as they
are, read-only, and lands them with a manifest line, plus two small tables the
page needs:

    walk_node_layers   the layer (0, 1 or 2) of each of the 220 nodes in the HNSW walk demo:
                       numpy default_rng(3).geometric(p=0.5) - 1 clipped to 2, exactly as the notebook drew it
    run_information    one row: the source run, basis sizes, and the probe count of the recall measurement

The probe count is not stored in the source tables. Every recall is
``hits / (neighbour_count * probes)`` with integer hits, so the probe count is
a multiple of the smallest count that makes all fourteen values integers. That
smallest count (60, landed as ``probe_count_inferred``) is a LOWER BOUND on the
granularity, not the measured count: the notebook's prose says 120, which is a
multiple of it, and the script's default of 200 is not (0.9972222 is 1436 hits
in 1,440 = 12 x 120 and cannot be a whole number of hits in 12 x 200).

Landed as ``s3://derived/study_vector_space_explained/recipe=<recipe>/table=<name>/`` and
served as ``derived_study_vector_space_explained_<name>`` after
``POST /api/labels/catalog/refresh`` or the next boot. An existing recipe is
never overwritten; a re-measurement is a new ``--recipe``.

Run with the datalake interpreter:

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/vector_space_explained/build.py
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_vector_space_explained"
DEFAULT_RECIPE = "lens_multimodal_MNQ_1h_2026_09_17"
SOURCE_RECIPE = "s3://derived/recipe=lens_vector_space_study"
SOURCE_RUN = "multimodal_MNQ_1h"
SOURCE_TABLES = ("standardized_features", "component_spectrum", "component_loadings", "neighbour_index_recall")
ORDERINGS = {
    "standardized_features": "feature_name, bar_index",
    "component_spectrum": "basis, component_number",
    "component_loadings": "basis, component_number, feature_name",
    "neighbour_index_recall": "basis, ef_search",
}
WALK_NODE_COUNT = 220
WALK_LAYER_SEED = 3


def read_source_tables() -> dict[str, pd.DataFrame]:
    from lake.serving import connect

    connection = connect()
    connection.execute("SET TimeZone = 'UTC'")
    frames: dict[str, pd.DataFrame] = {}
    for name in SOURCE_TABLES:
        # hive_partitioning off: the path carries recipe=... and table=..., which would become columns.
        frames[name] = connection.execute(
            f"SELECT * FROM read_parquet('{SOURCE_RECIPE}/table={name}/*.parquet', hive_partitioning = false) ORDER BY {ORDERINGS[name]}"
        ).fetchdf()
    return frames


def infer_probe_count(recall: pd.DataFrame) -> int:
    """The smallest probe count for which every recall is a whole number of hits (a lower bound on the measured count)."""
    for probes in range(1, 2001):
        scaled = recall["recall_at_k"].to_numpy(dtype=float) * recall["neighbour_count"].to_numpy(dtype=float) * probes
        if np.all(np.abs(scaled - np.round(scaled)) < 1e-6):
            return probes
    raise RuntimeError("no probe count up to 2000 makes every recall a whole number of hits")


def walk_layers() -> pd.DataFrame:
    # The notebook: rng = default_rng(3); levels = rng.geometric(p=0.5, size=220) - 1; layer_of = clip(levels, 0, 2).
    levels = np.random.default_rng(WALK_LAYER_SEED).geometric(p=0.5, size=WALK_NODE_COUNT) - 1
    layers = np.clip(levels, 0, 2)
    return pd.DataFrame({"node_index": np.arange(WALK_NODE_COUNT, dtype=np.int64), "layer": layers.astype(np.int64)})


def run_information(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    features = tables["standardized_features"]
    spectrum = tables["component_spectrum"]
    recall = tables["neighbour_index_recall"]
    dimensions = spectrum.groupby("basis")["component_number"].max().to_dict()
    return pd.DataFrame([{
        "source_run": SOURCE_RUN,
        "source_location": SOURCE_RECIPE,
        "source_built_on": "2026-09-17",
        "source_script": "Trading/quant/model/scripts/build_vector_space_study.py",
        "bar_count": int(features["bar_index"].nunique()),
        "feature_count": int(features["feature_name"].nunique()),
        "continuous_dimension_count": int(dimensions["continuous"]),
        "full_dimension_count": int(dimensions["full"]),
        "neighbour_count": int(recall["neighbour_count"].iloc[0]),
        "probe_count_inferred": infer_probe_count(recall),
        "walk_node_count": WALK_NODE_COUNT,
        "walk_layer_seed": WALK_LAYER_SEED,
        "loading_components_landed": int(tables["component_loadings"]["component_number"].max()),
    }])


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=standardized_features" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    args = parser.parse_args()

    if recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    tables = read_source_tables()
    for name, frame in tables.items():
        print(f"read {name}: {len(frame):,} rows, {len(frame.columns)} columns")
    tables["walk_node_layers"] = walk_layers()
    tables["run_information"] = run_information(tables)
    print("run information:", tables["run_information"].iloc[0].to_dict())
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local(tables, scratch)
        landed = land(paths, args.recipe, source=f"{SOURCE_RECIPE} (run {SOURCE_RUN}, built 2026-09-17 by build_vector_space_study.py)", dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
