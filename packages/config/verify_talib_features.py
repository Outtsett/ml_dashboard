"""Verify the registry against what the lake already holds, by value.

Coverage first: join `packages/config/talib_features.json` (built from TA-Lib
itself) to `derived_study_talib_indicator_catalogue_column_statistics`, which is
the landed catalogue and names each column's TA-Lib function and output. The
join is on (function, output), never on a column name, so it cannot be fooled by
the parameter suffix the names carry.

Then parity: recompute every column from the bar set's own OHLCV with the
registry's own parameters and compare to the stored values.

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/config/verify_talib_features.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, r"E:\source\repos\datalake\src")
from lake.serving import connect  # noqa: E402

REGISTRY = Path(__file__).resolve().parent / "talib_features.json"
CATALOGUE = "derived_study_talib_indicator_catalogue_column_statistics"
BARS = "derived_mnq_talib_{tf}"


def with_retry(work, attempts: int = 6, delay: float = 3.0):
    """AIStor answers its health check while refusing S3 reads, so a read that
    fails is retried rather than reported as missing data."""
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return work()
        except Exception as error:  # noqa: BLE001 - re-raised after the last attempt
            last = error
            if attempt < attempts:
                print(f"  read failed ({type(error).__name__}), retry {attempt}/{attempts - 1} ...")
                time.sleep(delay)
    raise last  # type: ignore[misc]


def load(timeframe: str) -> tuple[dict, pd.DataFrame, pd.DataFrame]:
    registry = json.loads(REGISTRY.read_text())
    connection = connect()
    connection.execute("SET TimeZone='UTC'")
    # Every column of the bar set, not just OHLCV: the parity test reads back the
    # stored value of each feature it recomputes, and the Hilbert family is stored
    # under a long descriptive name rather than the `ht_*` prefix the rest use.
    catalogue = with_retry(
        lambda: connection.execute(
            f"""
            SELECT column_name, talib_function, talib_output, talib_group, lookback_bars,
                   bar_count, finite_count, finite_percent, nonzero_bar_count, mean, minimum, maximum
            FROM {CATALOGUE}
            WHERE timeframe = '{timeframe}'
            """
        ).fetchdf()
    )
    bars = with_retry(
        lambda: connection.execute(
            f"SELECT * FROM {BARS.format(tf=timeframe)} ORDER BY timestamp"
        ).fetchdf()
    )
    return registry, catalogue, bars


def coverage(registry: dict, catalogue: pd.DataFrame) -> pd.DataFrame:
    wanted = pd.DataFrame(registry["features"])[
        ["name", "talib_function", "talib_output", "kind", "parameters"]
    ]
    have = catalogue[["talib_function", "talib_output", "column_name", "lookback_bars", "finite_percent", "nonzero_bar_count"]]
    merged = wanted.merge(have, on=["talib_function", "talib_output"], how="left")
    merged["present"] = merged["column_name"].notna()
    return merged


def parity(merged: pd.DataFrame, bars: pd.DataFrame) -> pd.DataFrame:
    import talib
    from talib import abstract

    import talib  # noqa: F401 - parity re-runs TA-Lib itself
    from talib import abstract

    # The builder hands every function this exact dict, so the operators' operands
    # and any implicit input are reproduced rather than guessed.
    inputs = {name: np.ascontiguousarray(bars[name].to_numpy(dtype=np.float64)) for name in ("open", "high", "low", "close", "volume")}

    rows = []
    for entry in merged.itertuples():
        if not entry.present:
            continue
        info = abstract.Function(entry.talib_function)
        if entry.kind == "operator":
            # Operators are reproduced exactly as the builder made them: the same
            # full OHLCV dict, so TA-Lib's own operand defaults decide. If that
            # reproduces the stored column, the operand is settled by parity; if
            # not, the max difference is reported and the definition is open.
            values = info(inputs)
            # MINMAX and MINMAXINDEX return a positional list, not a named mapping.
            recomputed = (
                np.asarray(values[list(info.output_names).index(entry.talib_output)], dtype=float)
                if len(info.output_names) > 1
                else np.asarray(values, dtype=float)
            )
        # MAVP takes a per-bar `periods` array the abstract API cannot infer. The
        # builder supplies a constant vector at `maxperiod` and labels the result
        # degenerate -- exactly a moving average at that period -- so parity here
        # confirms the constant, not a variable-period computation.
        elif entry.talib_function == "MAVP":
            period = float(entry.parameters.get("maxperiod", 30))
            recomputed = np.asarray(
                info({**inputs, "periods": np.full(len(bars), period)}), dtype=float
            )
        else:
            try:
                values = info(bars, **entry.parameters)
            except Exception as error:  # noqa: BLE001 - reported, never swallowed
                rows.append(
                    {
                        "name": entry.name,
                        "function": entry.talib_function,
                        "status": f"error: {type(error).__name__}",
                        "stored": np.nan,
                        "recomputed": np.nan,
                        "max_abs_diff": np.nan,
                    }
                )
                continue
            # The abstract API returns a bare Series for a single-output function
            # and an ordered mapping of output name -> Series otherwise.
            if len(info.output_names) == 1:
                recomputed = np.asarray(values, dtype=float)
            else:
                recomputed = np.asarray(values[entry.talib_output], dtype=float)
        stored = np.asarray(bars[entry.column_name], dtype=float)
        finite = np.isfinite(recomputed) & np.isfinite(stored)
        if finite.sum() == 0:
            status, diff = "no_overlap", np.nan
        else:
            diff = float(np.max(np.abs(recomputed[finite] - stored[finite])))
            status = "match" if diff < 1e-8 else "MISMATCH"
        # A column that is non-finite everywhere, or finite but constant, carries
        # no information and cannot be a feature. Measured, not asserted.
        stored_finite = stored[np.isfinite(stored)]
        if stored_finite.size == 0:
            distinct, variation = 0, 0.0
        else:
            distinct = int(np.unique(np.round(stored_finite, 12)).size)
            variation = float(np.nanstd(stored_finite))
        rows.append(
            {
                "name": entry.name,
                "function": entry.talib_function,
                "status": status,
                "stored": float(np.mean(stored_finite)) if stored_finite.size else np.nan,
                "recomputed": float(np.nanmean(recomputed)) if np.isfinite(recomputed).any() else np.nan,
                "max_abs_diff": diff,
                "finite_bars": int(stored_finite.size),
                "distinct_values": distinct,
                "standard_deviation": variation,
            }
        )
    return pd.DataFrame(rows)


def main(timeframe: str) -> int:
    registry, catalogue, bars = load(timeframe)
    merged = coverage(registry, catalogue)
    missing = merged[~merged["present"]]
    print(f"timeframe: {timeframe}")
    print(f"bars: {len(bars):,}  {bars['timestamp'].min()} -> {bars['timestamp'].max()}")
    print(f"registry features: {len(merged)}  present in lake: {int(merged['present'].sum())}  missing: {len(missing)}")
    if len(missing):
        print("\nMISSING (in registry, no landed column):")
        print(missing["name"].to_string(index=False))
    orphans = catalogue.merge(
        pd.DataFrame(registry["features"])[["talib_function", "talib_output"]],
        on=["talib_function", "talib_output"],
        how="left",
        indicator=True,
    )
    orphans = orphans[orphans["_merge"] == "left_only"]
    if len(orphans):
        print(f"\nLANDED BUT NOT IN REGISTRY: {len(orphans)}")
        print(orphans[["column_name", "talib_function", "talib_output"]].to_string(index=False))

    print("\nrecomputing every present column from the bar set's own OHLCV ...")
    result = parity(merged, bars)
    counts = result["status"].value_counts().to_dict()
    print("\nPARITY:", json.dumps(counts))
    bad = result[result["status"].str.startswith("MISMATCH")]
    if len(bad):
        print(f"\nMISMATCHED ({len(bad)}):")
        print(bad.sort_values("max_abs_diff", ascending=False).to_string(index=False))
    errored = result[result["status"].str.startswith("error")]
    if len(errored):
        print(f"\nERRORED ({len(errored)}):")
        for entry in errored.itertuples():
            print(f"  {entry.name:20s} {entry.function:16s} {entry.status}")

    dead = result[result["finite_bars"] == 0]
    if len(dead):
        print(f"\nNON-FINITE ON EVERY BAR ({len(dead)}) - no information, cannot be a feature:")
        print(dead[["name", "function"]].to_string(index=False))
    constant = result[(result["finite_bars"] > 0) & (result["distinct_values"] <= 1)]
    if len(constant):
        print(f"\nFINITE BUT CONSTANT ({len(constant)}):")
        print(constant[["name", "function", "distinct_values", "stored"]].to_string(index=False))
    usable = len(result) - len(dead) - len(constant)
    print(
        f"\nof {len(result)} verified features: {len(dead)} non-finite, {len(constant)} constant, "
        f"{usable} carrying information"
    )
    return 0
    unattributable = result[result["status"] == "unattributable"]
    if len(unattributable):
        print(f"\nNOT PARITY TESTED ({len(unattributable)}) - operators have no declared operand:")
        print(unattributable["name"].to_string(index=False))
    finite = catalogue["finite_percent"]
    print(f"\nstored finite_percent across {len(catalogue)} landed columns: min {finite.min():.1f} median {finite.median():.1f}")
    empty = catalogue[catalogue["finite_percent"] < 100.0][
        ["column_name", "talib_function", "talib_output", "lookback_bars", "finite_percent"]
    ]
    if len(empty):
        print(f"\ncolumns that are not finite on every bar ({len(empty)} of {len(catalogue)}):")
        print(empty.sort_values("finite_percent").to_string(index=False))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify every registry feature against a landed TA-Lib bar set.")
    parser.add_argument("--timeframe", default="1m", help="1m, 1h or 4h")
    arguments = parser.parse_args()
    raise SystemExit(main(arguments.timeframe))