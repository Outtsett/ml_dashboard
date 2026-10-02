"""Land the MNQ candle-vectors study's results in the lake, so the dashboard's study page reads them.

The research round (datalake ``scripts/build_mnq_candle_vectors.py``, ``build_mnq_shape_embedding.py``,
``build_mnq_next_candles.py``, 2026-09-14/15) wrote its results to a standalone DuckDB file,
``E:\\lake-workspace\\mnq_candle_vectors.duckdb``, which the dashboard cannot attach. This build reads that
file read-only, copies every results table a cell of ``datalake/notebooks/mnq_candle_vectors.py`` reads,
and computes the three things the notebook computed live:

* ``neighbour_lists`` gains ``query_timestamp`` and ``neighbour_timestamp``: the notebook's bar numbers are
  row indexes of the candle-window dataset ordered by time (``load_windows``), which a web request should
  not recompute over 1.77 million rows.
* ``neighbour_query_firings``: the 2025 firings of each pattern that have a neighbour list (section 4's
  slider), numbered in time order as the notebook numbers them.
* ``shape_reconstructions``: section 9.1 runs the five unsupervised shape models (torch) on the chosen
  firing. Every 2025 one-minute firing is rebuilt by every model here (the masked-candle model with its
  default hidden candle, 0 bars back); the first ``MASKED_PRESET_FIRINGS`` firings of each pattern are also
  rebuilt by the masked-candle model with each of ``MASKED_PRESETS`` hidden.
* ``pattern_candle_counts``: how many candles each TA-Lib pattern spans (``PATTERN_CANDLES``), which the
  section 10.3 trade histogram needs to require a pattern's candles to sit in one session stretch.

Everything lands as dataset ``study_candle_vectors``, one recipe, one table per result, with one manifest
line per table (Model Cycle landing job, as ``ta_strategy/store.py`` does). The dashboard serves each as
``derived_study_candle_vectors_<table>``.

Run once with the datalake interpreter (it has torch, TA-Lib, ``vss`` and the ``lake`` writer)::

    E:\\source\\repos\\datalake\\.venv\\Scripts\\python.exe src\\ml\\studies\\candle_vectors\\build.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

DATALAKE = Path(r"E:\source\repos\datalake")
ML_ROOT = Path(__file__).resolve().parents[2]
for _path in (DATALAKE / "src", DATALAKE / "scripts", ML_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import candle_vectors as cv  # noqa: E402

DATASET = "study_candle_vectors"
RECIPE = "candle_vectors_results_v1"
RESULTS_DATABASE = Path(os.environ.get("MNQ_CANDLE_VECTORS_DATABASE", r"E:\lake-workspace\mnq_candle_vectors.duckdb"))
MODEL_FILE = RESULTS_DATABASE.parent / "mnq_candle_vectors_models" / "shape_embedding_models.pt"
TIMEFRAMES = ("1m", "1h", "4h")
MASKED_PRESET_FIRINGS = 100
#: hidden candle sets (bars back) the masked-candle model is also run with, for the first firings of each pattern
MASKED_PRESETS = tuple([str(k) for k in range(16)] + ["0,1", "0,1,2", "0,1,2,3", "1,2,3"])

#: results tables copied as they are (a cell of the notebook reads each one)
COPIED = (
    "recognizer_score_histogram", "recognizer_feature_importance", "recognizer_training_log",
    "recognizer_window_map", "neighbour_forecast_evaluation", "vector_store_recall_check",
    "pattern_average_window", "pattern_average_path", "pattern_market_context_five_years",
    "shape_embedding_neighbour_purity", "shape_embedding_cluster_agreement", "shape_embedding_linear_probe",
    "shape_embedding_volatility_tracking", "shape_embedding_training_log", "shape_embedding_map",
    "shape_vocabulary_codes", "shape_vocabulary_prototypes",
    "next_candles_screen", "next_candles_placebo", "next_candles_frozen_rules", "next_candles_rule_trades",
    "next_candles_average_candles", "next_candles_effects", "next_candles_direction_shares",
    "next_candles_firing_counts", "next_candles_trades_by_pattern", "next_candles_matched_baseline_fit",
    "next_candles_bars", "next_candles_run_information",
)


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def results_connection() -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(str(RESULTS_DATABASE), read_only=True)
    connection.execute("SET TimeZone = 'UTC'")
    connection.execute("LOAD vss")  # the file holds HNSW indexes; vss must be loaded before anything is read
    return connection


def read_results(connection: duckdb.DuckDBPyConnection) -> dict[str, pd.DataFrame]:
    tables: dict[str, pd.DataFrame] = {}
    for name in COPIED:
        tables[name] = connection.execute(f'SELECT * FROM "{name}"').df()
        log(f"read {name}: {len(tables[name]):,} rows")
    # full-word column names in anything read back (the naming rule binds new datasets)
    tables["recognizer_metrics"] = connection.execute(
        'SELECT * RENAME (f1 AS f1_score) FROM recognizer_metrics').df()
    tables["corpora"] = connection.execute("""
        SELECT name AS corpus_name, dim AS dimensions, n_rows AS row_count, knowable_by, usable_from,
               ts_min AS earliest_timestamp, ts_max AS latest_timestamp, metric AS distance_metric,
               horizon AS horizon_bars, stride AS stride_bars
        FROM corpora ORDER BY name""").df()
    return tables


def with_retries(what: str, function, attempts: int = 30):
    for attempt in range(attempts):
        try:
            return function()
        except Exception as error:  # noqa: BLE001 - the object store drops connections when busy
            if attempt == attempts - 1:
                raise
            log(f"{what}: {type(error).__name__}: {str(error)[:100]} (retry {attempt + 1})")
            time.sleep(10)
    return None


#: TA-Lib function -> the candle-window column holding its value (the notebook's firing_mask)
TALIB_COLUMN = {"CDLHAMMER": "candlestick_hammer", "CDLSHOOTINGSTAR": "candlestick_shootingstar",
                "CDLENGULFING": "candlestick_engulfing", "CDLHARAMI": "candlestick_harami",
                "CDLDOJI": "candlestick_doji"}


def firing_mask(frame, pattern: str) -> np.ndarray:
    """The notebook's firing_mask, evaluated: a null TA-Lib value is not a firing."""
    import polars as pl

    function, sign, _ = cv.PATTERNS[pattern]
    column = pl.col(TALIB_COLUMN[function])
    expression = (column != 0) if sign == 0 else (column.sign() == sign)
    return frame.select(expression.fill_null(False).alias("fires"))["fires"].to_numpy()


def neighbour_tables(connection: duckdb.DuckDBPyConnection) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Neighbour lists with timestamps, and the 2025 firings that have one (section 4)."""
    from build_mnq_candle_vectors import load_windows

    lists = []
    firings = []
    frames = {}
    for timeframe in TIMEFRAMES:
        frame = with_retries(f"windows {timeframe}", lambda tf=timeframe: load_windows(tf))
        frames[timeframe] = frame
        stamps = pd.DataFrame({"bar_number": frame["bar_number"].to_numpy(),
                               "timestamp": frame["timestamp"].to_pandas()})
        part = connection.execute(
            "SELECT * FROM neighbour_lists WHERE timeframe = ? ORDER BY vector, query_bar_number, rank",
            [timeframe]).df()
        part = part.merge(stamps.rename(columns={"bar_number": "query_bar_number", "timestamp": "query_timestamp"}),
                          on="query_bar_number", how="left")
        part = part.merge(stamps.rename(columns={"bar_number": "neighbour_bar_number",
                                                 "timestamp": "neighbour_timestamp"}),
                          on="neighbour_bar_number", how="left")
        unmatched = int(part["query_timestamp"].isna().sum() + part["neighbour_timestamp"].isna().sum())
        if unmatched:
            raise RuntimeError(f"{timeframe}: {unmatched} neighbour bar numbers have no window")
        lists.append(part)
        queried = np.sort(part["query_bar_number"].unique())
        bar_numbers = frame["bar_number"].to_numpy()
        timestamps = pd.DatetimeIndex(frame["timestamp"].to_pandas())
        for pattern in cv.PATTERNS:
            chosen = np.flatnonzero(firing_mask(frame, pattern) & np.isin(bar_numbers, queried))
            firings.append(pd.DataFrame({
                "timeframe": timeframe, "pattern": pattern, "occurrence": np.arange(1, len(chosen) + 1),
                "query_bar_number": bar_numbers[chosen], "query_timestamp": timestamps[chosen]}))
        log(f"neighbour lists {timeframe}: {len(part):,} rows")
    return (pd.concat(lists, ignore_index=True).sort_values(["timeframe", "vector", "query_bar_number", "rank"]),
            pd.concat(firings, ignore_index=True), frames)


def shape_reconstructions(frame) -> pd.DataFrame:
    """Section 9.1: every 2025 1m firing rebuilt by every shape model, exactly as the notebook's cell does."""
    import build_mnq_shape_embedding as shape_embedding
    import torch

    saved = torch.load(MODEL_FILE, map_location="cpu", weights_only=False)
    models = {}
    for kind, state in saved["models"].items():
        encoder, decoder, quantizer = shape_embedding.build_model(kind)
        encoder.load_state_dict({k: v.cpu() for k, v in state["encoder"].items()})
        decoder.load_state_dict({k: v.cpu() for k, v in state["decoder"].items()})
        if quantizer is not None:
            quantizer.load_state_dict({k: v.cpu() for k, v in state["quantizer"].items()})
            quantizer.eval()
        models[kind] = (encoder.eval(), decoder.eval(), quantizer)
    mean, sd = saved["part_mean"], saved["part_sd"]
    parts_count, bars = len(shape_embedding.PARTS), cv.WINDOW_BARS

    usable = (frame["bar_minus_0_close_from_last_close_in_average_ranges"].is_not_null()
              & (frame["sample_split"] == "test")).to_numpy()
    any_firing = np.zeros(len(frame), dtype=bool)
    preset_rows = np.zeros(len(frame), dtype=bool)
    for pattern in cv.PATTERNS:
        mask = firing_mask(frame, pattern) & usable
        any_firing |= mask
        preset_rows[np.flatnonzero(mask)[:MASKED_PRESET_FIRINGS]] = True
    chosen = np.flatnonzero(any_firing)
    shape = np.clip(frame.select(cv.SHAPE_COLUMNS).to_numpy()[chosen].astype(np.float32),
                    -cv.SHAPE_CLIP_AVERAGE_RANGES, cv.SHAPE_CLIP_AVERAGE_RANGES)
    parts = shape_embedding.candle_parts(shape)
    x = ((parts.reshape(len(chosen), -1) - mean) / sd).reshape(len(chosen), parts_count, bars).astype(np.float32)
    timestamps = pd.DatetimeIndex(frame["timestamp"].to_pandas())[chosen]
    in_presets = preset_rows[chosen]

    def run(kind: str, rows: np.ndarray, hidden_bars_back: tuple[int, ...]) -> pd.DataFrame:
        encoder, decoder, quantizer = models[kind]
        candles = shape_embedding.MODEL_SPECS[kind]["candles"]
        hidden = np.zeros(bars, dtype=bool)
        for k in hidden_bars_back:
            hidden[bars - 1 - k] = True
        codes = np.full(len(rows), -1, dtype=np.int64)
        with torch.no_grad():
            tensor = torch.from_numpy(x[rows])[:, :, -candles:]
            if kind == "masked candles":
                mask = torch.from_numpy(hidden.astype(np.float32)).view(1, 1, -1)
                z = encoder(torch.cat([tensor * (1 - mask), mask.expand(len(rows), 1, bars)], dim=1))
            else:
                z = encoder(tensor)
                if quantizer is not None:
                    index = quantizer.assign(z)
                    codes = index.numpy().astype(np.int64)
                    z = quantizer.codebook[index]
            rebuilt = decoder(z).numpy()
        mean_c = mean.reshape(parts_count, bars)[:, -candles:].reshape(-1)
        sd_c = sd.reshape(parts_count, bars)[:, -candles:].reshape(-1)
        rebuilt_parts = (rebuilt.reshape(len(rows), -1) * sd_c + mean_c).reshape(len(rows), parts_count, candles)
        prices = shape_embedding.parts_to_prices(rebuilt_parts)          # (n, candles, 4)
        squared = (rebuilt - x[rows][:, :, -candles:]) ** 2
        scored = kind == "masked candles" and hidden.any()
        loss = squared[:, :, hidden].mean(axis=(1, 2)) if scored else squared.mean(axis=(1, 2))
        return pd.DataFrame({
            "timestamp": timestamps[rows], "model_name": kind,
            "hidden_bars_back": ",".join(str(k) for k in hidden_bars_back) if kind == "masked candles" else "",
            "candles_rebuilt": candles, "reconstruction_loss": loss.astype(np.float64),
            "vocabulary_code": pd.array([int(c) if c >= 0 else None for c in codes], dtype="Int64"),
            "rebuilt_open": [p[:, 0].astype(np.float64) for p in prices],
            "rebuilt_high": [p[:, 1].astype(np.float64) for p in prices],
            "rebuilt_low": [p[:, 2].astype(np.float64) for p in prices],
            "rebuilt_close": [p[:, 3].astype(np.float64) for p in prices],
        })

    every = np.arange(len(chosen))
    parts_out = [run(kind, every, (0,)) for kind in shape_embedding.MODEL_SPECS]
    preset_index = np.flatnonzero(in_presets)
    for preset in MASKED_PRESETS:
        if preset == "0":
            continue
        parts_out.append(run("masked candles", preset_index, tuple(int(k) for k in preset.split(","))))
    out = pd.concat(parts_out, ignore_index=True).sort_values(["timestamp", "model_name", "hidden_bars_back"])
    log(f"shape reconstructions: {len(chosen):,} firing bars, {len(out):,} rows")
    return out


def pattern_candle_counts() -> pd.DataFrame:
    import build_mnq_next_candles as nc

    return pd.DataFrame([{"function_name": function, "column_name": nc.column_of(function),
                          "pattern": function.removeprefix("CDL").lower(), "candles": candles,
                          "hikkake_confirmation_bars": nc.HIKKAKE_CONFIRMATION_BARS}
                         for function, candles in sorted(nc.PATTERN_CANDLES.items())])


def main() -> None:
    from ta_strategy.store import land, write_local

    connection = results_connection()
    try:
        tables = read_results(connection)
        lists, firings, frames = neighbour_tables(connection)
    finally:
        connection.close()
    tables["neighbour_lists"] = lists
    tables["neighbour_query_firings"] = firings
    tables["shape_reconstructions"] = shape_reconstructions(frames["1m"])
    tables["pattern_candle_counts"] = pattern_candle_counts()
    directory = Path(tempfile.gettempdir()) / "study_candle_vectors"
    paths = write_local(tables, str(directory))
    log(f"wrote {len(paths)} tables to {directory}; landing")
    result = with_retries("landing", lambda: land(
        paths, RECIPE, source=f"datalake notebooks/mnq_candle_vectors.py results ({RESULTS_DATABASE.name}) "
                              "+ shape reconstructions, via packages/ml-engine/src/studies/candle_vectors/build.py",
        dataset=DATASET), attempts=5)
    for name, info in sorted(result.items()):
        log(f"landed {name}: {info['rows']:,} rows, {info['bytes']:,} bytes, manifest {info['manifest']}")


if __name__ == "__main__":
    main()
