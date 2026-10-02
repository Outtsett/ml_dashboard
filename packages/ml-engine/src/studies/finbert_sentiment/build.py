"""Land the news router's two reference tables for the `finbert-sentiment` study.

The notebook this replaced (notebooks/finbert_sentiment.py) read two things
only Python knows: `lake.news.ALL_ROOTS` (its instrument-root dropdown) and
`lake.news.QUERIES_BY_TAG`, which `lake.sentiment.source_reaches` uses to decide
whether a GDELT coverage span says anything about a root (a week of "S&P 500"
queries says nothing about EURUSD). Everything else the page needs (scored
headlines, coverage spans) is read straight from the curated news parquet by the
study's handler, and the nine columns are computed by the ported
`lake.sentiment` (packages/shared/src/studies/finbert-sentiment.ts, parity-tested).

    derived/study_finbert_sentiment/recipe=<RECIPE>/table=<name>/part-0.parquet
    meta/ingest_manifests/study_finbert_sentiment.jsonl   one line per table

Served by the dashboard as `derived_study_finbert_sentiment_<name>`:
    roots         instrument_root, description                      (34 rows)
    query_roots   query_tag, instrument_root, relevance, direction,
                  tier, gdelt_query                                  (one row per rule x root)

Run:  E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/finbert_sentiment/build.py
It refuses to land a recipe that already exists (write-once).
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pandas as pd

REPOSITORY = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPOSITORY / "src" / "ml"))

from lake import news  # noqa: E402

from ta_strategy.store import land  # noqa: E402

DATASET = "study_finbert_sentiment"
RECIPE = "news_router_2026_09_30"


def read_tables() -> dict[str, pd.DataFrame]:
    roots = pd.DataFrame(
        [{"instrument_root": root, "description": news.ROOTS[root]} for root in news.ALL_ROOTS]
    )
    rows = []
    for query in news.QUERIES:
        for root, relevance in query.roots.items():
            rows.append({
                "query_tag": query.tag,
                "instrument_root": root,
                "relevance": float(relevance),
                "direction": int(query.direction(root)),
                "tier": query.tier,
                "gdelt_query": bool(query.gdelt),
            })
    return {"roots": roots, "query_roots": pd.DataFrame(rows)}


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
    with tempfile.TemporaryDirectory(prefix="study_finbert_sentiment_") as directory:
        paths = {}
        for name, frame in tables.items():
            path = os.path.join(directory, f"{name}.parquet")
            frame.to_parquet(path, index=False)
            paths[name] = path
        result = land(paths, RECIPE, "lake.news ALL_ROOTS and QUERIES (datalake src/lake/news.py)", dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
