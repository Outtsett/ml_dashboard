"""Land the chart-CNN pattern-recognition round in the lake for the study page.

Replaces what ``Trading/quant/chart_cnn/synth/report_synth.py`` (a marimo
notebook) computed on every open. The notebook read three local files:

    synth/runs/seed0/real_test_results.csv   one row per TA-Lib pattern (AUC, AP, prevalence)
    synth/runs/seed0/real_test_pred.npz      network scores p, TA-Lib labels y, 256-d embedding, per window
    data/test_real.parquet                   the 126,624 real MNQ 5-minute windows (five bars of OHLC)

This reads them read-only, computes the one thing the notebook computed from
them that the page cannot compute in SQL (the two-component PCA of a 20,000-row
sample of the embedding, with the notebook's own seeds), and lands five tables
under ``s3://derived/study_chart_cnn_pattern_recognition/recipe=synth_seed0/``
with a manifest line each, so the dashboard serves them as
``derived_study_chart_cnn_pattern_recognition_<table>``:

    pattern_scores          61 rows: the results CSV with full-word columns and each pattern's bar count
    windows                 126,624 rows: the window's target, sign, bars and five bars of OHLC
    window_scores           126,624 rows: network score and TA-Lib verdict per pattern (wide, 2 x 61 columns)
    embedding_projection    20,000 rows: the sampled windows on the first two principal components
    embedding_components    2 rows: explained-variance ratio of each component

Run once:  E:\\source\\repos\\datalake\\.venv\\Scripts\\python.exe packages/ml-engine/src/studies/chart_cnn_pattern_recognition/build.py
It refuses to land when the recipe is already in the manifest (write-once).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "Trading" / "quant" / "chart_cnn" / "pkg"))

from render_pattern import NBARS  # noqa: E402  the notebook's own bar count per pattern

CHART_CNN = ROOT / "Trading" / "quant" / "chart_cnn"
RUN = CHART_CNN / "synth" / "runs" / "seed0"
DATASET = "study_chart_cnn_pattern_recognition"
RECIPE = "synth_seed0"
SAMPLE_SIZE = 20_000


def load() -> tuple[pd.DataFrame, np.lib.npyio.NpzFile, pd.DataFrame]:
    results = pd.read_csv(RUN / "real_test_results.csv")
    predictions = np.load(RUN / "real_test_pred.npz")  # every array is numeric or fixed-width unicode: no pickle
    windows = pd.read_parquet(CHART_CNN / "data" / "test_real.parquet")
    if not np.array_equal(predictions["target"], windows["target"].to_numpy().astype(str)):
        raise SystemExit("real_test_pred.npz and test_real.parquet are not in the same row order")
    if not np.array_equal(predictions["nbars"], windows["nbars"].to_numpy()):
        raise SystemExit("bar counts differ between the predictions and the windows")
    return results, predictions, windows


def pattern_scores(results: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        "pattern_name": results["pattern"].astype(str),
        "pattern_bar_count": results["pattern"].map(NBARS).astype("int64"),
        "visible_window_count": results["n_visible"].astype("int64"),
        "positive_window_count": results["n_pos"].astype("int64"),
        "area_under_curve": results["auc"].astype("float64"),
        "average_precision": results["avg_precision"].astype("float64"),
        "prevalence": results["prevalence"].astype("float64"),
    })
    return out.sort_values("pattern_name").reset_index(drop=True)


def window_table(windows: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        "window_id": np.arange(len(windows), dtype=np.int64),
        "target_pattern": windows["target"].astype(str).to_numpy(),
        "pattern_sign": windows["sign"].astype("int64").to_numpy(),
        "window_bar_count": windows["nbars"].astype("int64").to_numpy(),
        "source_bar_index": windows["bar_index"].astype("int64").to_numpy(),
        "window_time_new_york": windows["time"].astype(str).to_numpy(),
    })
    for bar in range(1, 6):
        for letter, word in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close")):
            out[f"bar_{bar}_{word}"] = windows[f"{letter}{bar}"].astype("float64").to_numpy()
    return out


def window_scores(predictions) -> pd.DataFrame:
    names = [str(name) for name in predictions["names"]]
    columns: dict[str, np.ndarray] = {
        "window_id": np.arange(predictions["p"].shape[0], dtype=np.int64),
        "window_bar_count": predictions["nbars"].astype(np.int64),
    }
    for index, name in enumerate(names):
        columns[f"network_score_{name.lower()}"] = predictions["p"][:, index].astype(np.float32)
    for index, name in enumerate(names):
        columns[f"talib_fires_{name.lower()}"] = predictions["y"][:, index].astype(np.int8)
    return pd.DataFrame(columns)


def embedding_projection(predictions, windows: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """The notebook's cell verbatim: default_rng(0).choice of 20,000 rows, PCA(2, random_state=0)."""
    embedding = predictions["emb"]
    generator = np.random.default_rng(0)
    selected = generator.choice(len(embedding), min(SAMPLE_SIZE, len(embedding)), replace=False)
    pca = PCA(2, random_state=0)
    projected = pca.fit_transform(embedding[selected])
    counts = windows["target"].value_counts()
    rank = {name: position + 1 for position, name in enumerate(counts.index)}
    target = windows["target"].astype(str).to_numpy()[selected]
    projection = pd.DataFrame({
        "window_id": selected.astype(np.int64),
        "sample_order": np.arange(len(selected), dtype=np.int64),
        "target_pattern": target,
        "target_frequency_rank": np.array([rank[name] for name in target], dtype=np.int64),
        "pattern_sign": windows["sign"].astype("int64").to_numpy()[selected],
        "window_bar_count": windows["nbars"].astype("int64").to_numpy()[selected],
        "principal_component_1": projected[:, 0].astype(np.float64),
        "principal_component_2": projected[:, 1].astype(np.float64),
    })
    components = pd.DataFrame({
        "component_number": np.array([1, 2], dtype=np.int64),
        "explained_variance_ratio": pca.explained_variance_ratio_.astype(np.float64),
        "embedding_dimension_count": np.array([embedding.shape[1]] * 2, dtype=np.int64),
        "sample_window_count": np.array([len(selected)] * 2, dtype=np.int64),
    })
    return projection, components


def already_landed() -> bool:
    from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key

    key = arrow_key(INGEST_MANIFESTS / f"{DATASET}.jsonl")
    try:
        with arrow_fs().open_input_stream(key) as source:
            text = source.read().decode("utf-8")
    except (FileNotFoundError, OSError):
        return False
    return any(json.loads(line).get("recipe") == RECIPE for line in text.splitlines() if line.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="compute and print row counts, land nothing")
    arguments = parser.parse_args()

    results, predictions, windows = load()
    projection, components = embedding_projection(predictions, windows)
    tables = {
        "pattern_scores": pattern_scores(results),
        "windows": window_table(windows),
        "window_scores": window_scores(predictions),
        "embedding_projection": projection,
        "embedding_components": components,
    }
    for name, frame in tables.items():
        print(f"{name}: {len(frame):,} rows x {frame.shape[1]} columns")
    print("explained variance ratio:", components["explained_variance_ratio"].round(6).tolist())
    if arguments.dry_run:
        return
    if already_landed():
        raise SystemExit(f"{DATASET} recipe={RECIPE} is already in the manifest; write-once, nothing landed")

    from ta_strategy.store import land, write_local

    with tempfile.TemporaryDirectory(prefix="chart_cnn_study_") as directory:
        paths = write_local(tables, directory)
        landed = land(paths, RECIPE, source="chart_cnn synth seed0: real_test_results.csv, real_test_pred.npz, test_real.parquet "
                      "(Trading/quant/chart_cnn), PCA as report_synth.py", dataset=DATASET)
    print(json.dumps(landed, indent=1))


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    main()
