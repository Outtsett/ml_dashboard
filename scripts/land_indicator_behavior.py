"""Land the behavioural embedding of every TA-Lib indicator for a symbol and timeframe.

Reads the landed TA-Lib columns (``derived_mnq_talib_<tf>``), resolves them onto the
canonical registry names in ``packages/config/talib_features.json`` by joining on
``(talib_function, talib_output)`` — never on a name string, because the lake appends the
parameterization to its column names (``rsi_14``, ``macd_12_26_9``) and the registry exists
to replace that naming — and runs the one generic engine in
``packages/ml-engine/src/core/shared/indicators/behavioral.py`` over the result.

The output is one row per bar and one column per behavioural feature: level, change,
acceleration, window change, causal rank, categorical state, threshold events with age,
origin and recency, divergence and hidden divergence for each continuous indicator;
occurrence, run length, age, recency, origin and firing rate for each candlestick pattern;
and one set of crossover columns per function whose outputs are comparable.

    .venv/Scripts/python.exe scripts/land_indicator_behavior.py --symbol MNQ --timeframe 1m

Lands as ``derived_indicator_behavior_<timeframe>``.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "ml-engine" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "ml-engine" / "src" / "core"))

from core.shared.indicators.behavioral import (  # noqa: E402
    build_specs,
    compute_behavior,
    landed_column_names,
    rename_to_landed,
)

DATASET = "indicator_behavior"
TALIB_TABLE = "derived_mnq_talib_{tf}"
PRICE_TABLE = "ohlcv_full_{tf}"


def log(message: str) -> None:
    print(message, flush=True)


def load_frame(symbol: str, timeframe: str) -> pd.DataFrame:
    """The landed indicator columns joined to the bars they were computed from."""
    from lake.serving import connect

    con = connect()
    indicators = con.execute(
        f"SELECT * FROM {TALIB_TABLE.format(tf=timeframe)} ORDER BY timestamp"
    ).fetchdf()
    prices = con.execute(
        f"SELECT timestamp, open, high, low, close FROM {PRICE_TABLE.format(tf=timeframe)} "
        f"WHERE symbol = '{symbol}' ORDER BY timestamp"
    ).fetchdf()
    log(f"[data] {symbol} {timeframe}: {len(indicators):,} bars with "
        f"{len(indicators.columns)} landed columns, {len(prices):,} bars of {symbol} prices")
    return indicators.merge(prices, on="timestamp", how="left", suffixes=("", "_price"))


def behaviour_table(frame: pd.DataFrame, timeframe: str, symbol: str) -> tuple[pd.DataFrame, list]:
    """Run the engine over everything present and stack the blocks into one table."""
    specs = build_specs()
    mapping = landed_column_names(specs, timeframe)
    frame = rename_to_landed(frame, mapping)
    log(f"[names] resolved {len(mapping)} registry names onto landed columns")

    specs = build_specs(landed=mapping)
    present = [s for s in specs if s.embedded and s.name in frame.columns]
    skipped = len([s for s in specs if s.kind != "operator"]) - len(present)
    log(f"[engine] {len(present)} indicators embedded, {skipped} registry entries not landed "
        f"for this timeframe")

    started = time.monotonic()
    blocks = compute_behavior(present, frame)
    log(f"[compute] {len(blocks)} blocks in {time.monotonic() - started:.1f}s")

    columns: dict[str, pd.Series] = {}
    for block in blocks.values():
        for name, values in block.columns.items():
            columns[name] = pd.Series(values)
    table = pd.DataFrame(columns, index=frame.index)
    table.insert(0, "timestamp", frame["timestamp"])
    table.insert(0, "timeframe", timeframe)
    table.insert(0, "symbol", symbol)
    return table, present


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--recipe", default=None)
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "indicator_behavior"))
    parser.add_argument("--no-land", action="store_true")
    parser.add_argument("--preview-bars", type=int, default=0)
    args = parser.parse_args()

    started = time.monotonic()
    frame = load_frame(args.symbol, args.timeframe)
    table, present = behaviour_table(frame, args.timeframe, args.symbol)
    feature_columns = [c for c in table.columns if "__" in c]
    log(f"[table] {len(table):,} rows x {len(feature_columns)} behavioural columns "
        f"({len(present)} indicators)")

    recipe = args.recipe or f"{args.symbol}_{args.timeframe}_talib{len(present)}"
    directory = os.path.join(args.output_dir, f"{DATASET}_{recipe}")
    from ta_strategy import store

    paths = store.write_local({f"mnq_{args.timeframe}": table}, directory)
    landing = None
    if not args.no_land:
        landing = store.land(
            paths,
            recipe,
            f"behavioural embedding of every landed TA-Lib indicator for {args.symbol} {args.timeframe}",
            dataset=f"{DATASET}_{args.timeframe}",
        )
        for name, info in landing.items():
            log(f"[save] {name}: {info['rows']:,} rows -> {info['uri']}")

    if args.preview_bars:
        log("")
        log(table.tail(args.preview_bars)[["timestamp", *feature_columns[:12]]].to_string())

    log(f"[done] {time.monotonic() - started:.1f}s  recipe={recipe}")
    if landing:
        log(f"[lake] dataset derived_{DATASET}_{args.timeframe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())