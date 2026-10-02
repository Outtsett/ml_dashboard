"""Land the tables of the `candle-pattern-gallery` study.

The notebook this replaced (Trading/quant/chart_cnn/pkg/gallery.py) browsed PNG
files that chart_cnn's gallery_patterns.py / synth_rare_patterns.py wrote, listed
by two CSVs (pattern_images/index.csv and summary.csv). The CSVs kept only the
bars of the pattern itself, with the prices as Python repr strings
("[np.float64(7558.75), ...]"), and the PNGs for the last-8-bars and 48-bar views
were never written into pattern_images/. This build reads both CSVs read-only and
lands, for all 1,013 examples, the full 48-bar window that every one of the
notebook's three views is a crop of, so the page draws them natively:

    derived/study_candle_pattern_gallery/recipe=<recipe>/table=<name>/part-0.parquet
    meta/ingest_manifests/study_candle_pattern_gallery.jsonl        one line per table

served by the dashboard as ``derived_study_candle_pattern_gallery_<name>``:

    summary       61 rows: hits on MNQ 5-minute bars, bullish / bearish split, examples kept
                  (the notebook's summary.csv, full-word columns, plus each pattern's bar count)
    examples      1,013 rows: one per example (914 real, 99 synthetic), with the bar's lake timestamp
                  for the real ones (the notebook's index.csv without the repr-string price columns)
    window_bars   48,624 rows: the 48 bars ending at each example's firing bar, open / high / low /
                  close labelled absolute price, plus volume

How the windows are found (the window's bars are NEVER invented; every example's pattern bars are
checked against the notebook's index.csv to 1e-9 and the build stops on any difference):
    real example       bar_index addresses chart_cnn's own 5-minute resample of mnq_1m.parquet
                       (`data.load(..., resample='5min')`, the notebook package's function, imported),
                       so the window is the 48 rows ending there. Its timestamp is the parquet's stamp
                       (the lake's clock: Pacific wall-clock stored as UTC). The notebook's example id
                       (20191002_1315_bear) reads that stamp as true UTC and shifts it to New York, so
                       its clock is offset from the lake's; the id is kept verbatim for continuity.
    synthetic example  the notebook kept only the pattern's own bars, but its series came from seeded
                       random searches (gallery_patterns.py, seed 0; synth_rare_patterns.py, seed 1).
                       Those loops are replayed here statement for statement (the scripts run at import
                       and write files, so they cannot be imported) and every example's pattern bars are
                       matched to index.csv; 39 + 60 of 99 synthetic examples must reproduce exactly.

Run with the interpreter that has TA-Lib 0.7.1 (the one the notebook's indices were made with) and lake:
    E:/source/repos/ml_dashboard/Trading/quant/.venv/Scripts/python.exe packages/ml-engine/src/studies/candle_pattern_gallery/build.py
It refuses to land a recipe that already exists (write-once). ``--dry-run`` computes and prints only.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import talib

ROOT = Path(__file__).resolve().parents[4]
CHART_CNN = ROOT / "Trading" / "quant" / "chart_cnn"
PACKAGE = CHART_CNN / "pkg"
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(PACKAGE))

from render_pattern import NBARS  # noqa: E402  the notebook's own bar count per pattern

from data import load  # noqa: E402  the notebook package's own loader and 5-minute resample
from ta_strategy.store import land  # noqa: E402  the Model Cycle landing job

DATASET = "study_candle_pattern_gallery"
RECIPE = "mnq_5m_talib_gallery_2026_09_30"
WINDOW = 48  # render.W, the CNN input width in bars
PRICE_TOLERANCE = 1e-9
FLOAT_IN_REPR = re.compile(r"np\.float64\(([^)]+)\)")


def parse_prices(text: str) -> list[float]:
    """index.csv stores each OHLC list as its Python repr: "[np.float64(7558.75), ...]"."""
    return [float(token) for token in FLOAT_IN_REPR.findall(text)]


def replay_random_search_synthetics(open_, high, low, close, names: list[str]) -> dict[tuple[str, str], dict]:
    """gallery_patterns.py's synthetic top-up, statement for statement (seed 0, patterns in sorted order)."""
    rng = np.random.default_rng(0)
    wanted = 12
    found: dict[tuple[str, str], dict] = {}
    for name in names:
        output = getattr(talib, name)(open_, high, low, close)
        hits = np.flatnonzero(output != 0)
        hits = hits[hits >= WINDOW]
        kept = 0
        for sign in (1, -1):
            signed = hits[np.sign(output[hits]) == sign]
            if len(signed):
                kept += min(wanted, len(signed))
        made = 0
        if kept < wanted:
            need = wanted - kept
            tries = 0
            while made < need and tries < 400:
                tries += 1
                length = 400
                base = 100 * np.exp(rng.normal(0, 0.004, length).cumsum())
                series_open = base * np.exp(rng.normal(0, 0.003, length))
                series_close = base * np.exp(rng.normal(0, 0.003, length))
                wick = np.abs(rng.normal(0, 0.003, length))
                series_high = np.maximum(series_open, series_close) * (1 + wick)
                series_low = np.minimum(series_open, series_close) * (1 - np.abs(rng.normal(0, 0.003, length)))
                series_volume = rng.integers(50, 500, length).astype(float)
                synthetic = getattr(talib, name)(series_open, series_high, series_low, series_close)
                firing = np.flatnonzero(synthetic != 0)
                firing = firing[firing >= WINDOW]
                for index in firing[: max(1, need - made)]:
                    direction = "bull" if synthetic[index] > 0 else "bear"
                    key = (name, f"syn{tries:03d}_{index}_{direction}_synthetic")
                    found[key] = dict(open=series_open, high=series_high, low=series_low, close=series_close,
                                      volume=series_volume, index=int(index), sign=int(np.sign(synthetic[index])))
                    made += 1
                    if made >= need:
                        break
    return found


TEXTBOOK_TEMPLATES = {
    "CDLKICKING": [(0, -2, 0.02, -2.02), (0.5, 2.5, 2.52, 0.48)],
    "CDLKICKINGBYLENGTH": [(0, -2, 0.02, -2.02), (0.5, 3.5, 3.52, 0.48)],
    "CDL3STARSINSOUTH": [(0, -3, 0.1, -6.5), (-2.5, -3.4, -2.4, -4.5), (-3.0, -3.3, -3.0, -3.3)],
    "CDLCONCEALBABYSWALL": [(0, -3, 0.02, -3.02), (-3, -6, -2.98, -6.02), (-8, -9, -5, -9.02), (-4.5, -9.5, -4.4, -9.6)],
    "CDLMATHOLD": [(0, 4, 4.1, -0.1), (5, 4.6, 5.1, 4.5), (4.5, 3.8, 4.55, 3.7), (3.9, 3.5, 3.95, 3.4), (3.7, 5.5, 5.6, 3.6)],
}


def replay_textbook_synthetics() -> dict[tuple[str, str], dict]:
    """synth_rare_patterns.py's constructions, statement for statement (seed 1, all five patterns)."""
    rng = np.random.default_rng(1)

    def context(count=60, body_scale=0.15):
        base = 100 + rng.normal(0, 0.05, count).cumsum()
        open_ = base
        close = base + rng.normal(0, body_scale, count)
        high = np.maximum(open_, close) + np.abs(rng.normal(0, 0.15, count))
        low = np.minimum(open_, close) - np.abs(rng.normal(0, 0.15, count))
        return open_, close, high, low

    found: dict[tuple[str, str], dict] = {}
    for name, template in TEXTBOOK_TEMPLATES.items():
        made = 0
        tries = 0
        while made < 12 and tries < 3000:
            tries += 1
            o, c, h, l = context(body_scale=0.5 if name in ("CDL3STARSINSOUTH", "CDLMATHOLD") else 0.15)
            scale = 1 + rng.normal(0, 0.15)

            def jitter():
                return rng.normal(0, 0.03)

            base = c[-1]
            template_open, template_close, template_high, template_low = (
                np.array(column)
                for column in zip(*[(base + a * scale + jitter(), base + b * scale + jitter(),
                                     base + high_ * scale + abs(jitter()), base + low_ * scale - abs(jitter()))
                                    for a, b, high_, low_ in template])
            )
            full_open, full_close = np.r_[o, template_open], np.r_[c, template_close]
            full_high = np.maximum(np.r_[h, template_high], np.maximum(full_open, full_close))
            full_low = np.minimum(np.r_[l, template_low], np.minimum(full_open, full_close))
            full_volume = rng.integers(50, 500, len(full_open)).astype(float)
            output = getattr(talib, name)(full_open, full_high, full_low, full_close)
            if output[-1] != 0:
                index = len(full_open) - 1
                key = (name, f'textbook{made:02d}_{"bull" if output[-1] > 0 else "bear"}_synthetic')
                found[key] = dict(open=full_open, high=full_high, low=full_low, close=full_close, volume=full_volume,
                                  index=index, sign=int(np.sign(output[-1])))
                made += 1
    return found


def compute() -> dict[str, pd.DataFrame]:
    frame = load(str(CHART_CNN / "mnq_1m.parquet"), None, "5min")
    open_, high, low, close, volume = (frame[column].values.astype(float) for column in ["Open", "High", "Low", "Close", "Volume"])
    stamps = frame.index.tz_convert("UTC")
    names = sorted(talib.get_function_groups()["Pattern Recognition"])

    index_table = pd.read_csv(PACKAGE / "pattern_images" / "index.csv")
    summary_table = pd.read_csv(PACKAGE / "pattern_images" / "summary.csv")
    assert not index_table.duplicated(["pattern", "example"]).any(), "example ids repeat inside a pattern"

    synthetic_sources = {**replay_random_search_synthetics(open_, high, low, close, names), **replay_textbook_synthetics()}

    examples: list[dict] = []
    window_rows: list[dict] = []
    for row in index_table.itertuples():
        pattern_bar_count = int(row.nbars)
        assert pattern_bar_count == NBARS[row.pattern], f"{row.pattern}: bar count disagrees with render_pattern.NBARS"
        notebook_bars = {column: np.array(parse_prices(getattr(row, column))) for column in ("open", "high", "low", "close")}
        if not row.synthetic:
            last = int(row.bar_index)
            source = dict(open=open_, high=high, low=low, close=close, volume=volume)
            source_stamps = stamps
            kind = "real_mnq_5m"
        else:
            key = (row.pattern, row.example)
            if key not in synthetic_sources:
                raise SystemExit(f"synthetic example {key} was not reproduced by the replayed generators")
            found = synthetic_sources[key]
            last = found["index"]
            source = found
            source_stamps = None
            kind = "textbook_synthetic" if row.example.startswith("textbook") else "random_search_synthetic"
            assert found["sign"] == int(row.sign), f"{key}: sign differs"
        first = last - WINDOW + 1
        assert first >= 0
        for column in ("open", "high", "low", "close"):
            replayed = np.asarray(source[column][last - pattern_bar_count + 1:last + 1], dtype=float)
            if not np.allclose(replayed, notebook_bars[column], rtol=0, atol=PRICE_TOLERANCE):
                raise SystemExit(f"{row.pattern} {row.example}: {column} bars differ from the notebook's index.csv")
        examples.append(dict(
            talib_function=row.pattern, example_id=row.example, pattern_side="bullish" if int(row.sign) > 0 else "bearish",
            is_synthetic=bool(row.synthetic), example_source=kind,
            bar_index=int(row.bar_index) if not row.synthetic else None,
            synthetic_series_index=last if row.synthetic else None,
            pattern_bar_count=pattern_bar_count,
            bar_timestamp=source_stamps[last] if source_stamps is not None else pd.NaT,
        ))
        for position in range(WINDOW):
            at = first + position
            window_rows.append(dict(
                talib_function=row.pattern, example_id=row.example, window_position=position,
                bars_before_firing=position - (WINDOW - 1),
                is_pattern_bar=position >= WINDOW - pattern_bar_count,
                bar_timestamp=source_stamps[at] if source_stamps is not None else pd.NaT,
                absolute_open_price=float(source["open"][at]), absolute_high_price=float(source["high"][at]),
                absolute_low_price=float(source["low"][at]), absolute_close_price=float(source["close"][at]),
                volume=float(source["volume"][at]),
            ))

    summary = summary_table.rename(columns={
        "pattern": "talib_function", "real_hits_total": "real_hit_count", "bull": "bullish_real_hit_count",
        "bear": "bearish_real_hit_count", "real_examples": "real_example_count", "synthetic_examples": "synthetic_example_count",
    })
    summary["pattern_bar_count"] = summary["talib_function"].map(NBARS).astype(int)
    examples_frame = pd.DataFrame(examples)
    examples_frame["bar_timestamp"] = pd.to_datetime(examples_frame["bar_timestamp"], utc=True)
    windows_frame = pd.DataFrame(window_rows)
    windows_frame["bar_timestamp"] = pd.to_datetime(windows_frame["bar_timestamp"], utc=True)

    # The summary the notebook showed counts real examples and the random-search synthetics; the textbook
    # constructions were appended to index.csv later (synth_rare_patterns.py) and never reached summary.csv.
    by_source = pd.crosstab(examples_frame["talib_function"], examples_frame["example_source"]).reindex(summary["talib_function"]).fillna(0).astype(int)
    for column in ("real_mnq_5m", "random_search_synthetic", "textbook_synthetic"):
        if column not in by_source:
            by_source[column] = 0
    assert (by_source["real_mnq_5m"].values == summary["real_example_count"].values).all(), "summary real_examples disagrees with index.csv"
    assert (by_source["random_search_synthetic"].values == summary["synthetic_example_count"].values).all(), "summary synthetic_examples disagrees with index.csv"
    summary = summary.rename(columns={"synthetic_example_count": "random_search_synthetic_example_count"})
    summary["textbook_synthetic_example_count"] = by_source["textbook_synthetic"].values
    summary["example_count"] = by_source.sum(axis=1).values
    return {"summary": summary, "examples": examples_frame, "window_bars": windows_frame}


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    return arrow_fs().get_file_info(arrow_key(derived_root(DATASET, RECIPE))).type != FileType.NotFound


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="compute and print; land nothing")
    arguments = parser.parse_args()

    tables = compute()
    for name, frame in tables.items():
        print(f"--- {name}: {len(frame):,} rows, {len(frame.columns)} columns")
    examples = tables["examples"]
    print(f"examples: {(~examples['is_synthetic']).sum()} real, {examples['is_synthetic'].sum()} synthetic "
          f"({(examples['example_source'] == 'random_search_synthetic').sum()} random search, "
          f"{(examples['example_source'] == 'textbook_synthetic').sum()} textbook); "
          f"{examples['talib_function'].nunique()} patterns; TA-Lib {talib.__version__}")
    if arguments.dry_run:
        return 0
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    with tempfile.TemporaryDirectory(prefix="study_candle_pattern_gallery_") as directory:
        paths: dict[str, str] = {}
        for name, frame in tables.items():
            path = os.path.join(directory, f"{name}.parquet")
            frame.to_parquet(path, index=False)
            paths[name] = path
        result = land(
            paths, RECIPE,
            f"Trading/quant/chart_cnn/pkg pattern_images/index.csv + summary.csv, chart_cnn mnq_1m.parquet resampled to 5min, "
            f"TA-Lib {talib.__version__} (study candle-pattern-gallery build.py)",
            dataset=DATASET,
        )
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
