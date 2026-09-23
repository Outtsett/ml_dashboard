"""Build the lake series catalog the Market tab draws from.

Every column in the lake becomes a chart series, and this script decides what
each one IS: which family it belongs to, what its numbers look like, and
therefore how a chart may draw it without lying about it.

The decisions are made from MEASURED values, not from the column's name. A
column is drawn on the price scale only if its values actually sit where the
closes sit; a z-score gets its own pane with a zero line and its clip
boundaries marked; a label computed from later bars is flagged forward-looking
so it can never be mistaken for a signal that existed at that bar.

    uv run python scripts/build_series_catalog.py
    uv run python scripts/build_series_catalog.py --symbol ES --sample-rows 20000

Writes src/config/series_catalog.json, read by the server at startup.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lake.serving import connect

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPO_ROOT / "src" / "config" / "series_catalog.json"

# The one schema outlier: every other object names its time column `timestamp`.
TIMESTAMP_COLUMN_OVERRIDE = {"bars": "ts"}
SYMBOL_COLUMN_OVERRIDE = dict.fromkeys(
    [
        "fx_ohlcv_1m",
        "fx_ohlcv_5m",
        "fx_ohlcv_15m",
        "fx_ohlcv_30m",
        "fx_ohlcv_1h",
        "fx_ohlcv_4h",
        "fx_ohlcv_1d",
    ],
    "pair",
)
FOREX_SAMPLE_SYMBOL = "EURUSD"

# Objects that carry one row per event rather than one row per bar. Their
# columns describe a trade setup that resolves later, so they only ever mark
# the bar they belong to.
EVENT_OBJECTS = {"mnq_swing_5m", "mnq_tbl_5m", "talib_candle_patterns"}
DIMENSION_OBJECTS = {"symbols"}

# Objects the chart does not draw, because it already draws the same thing from
# the bars on screen. Excluding them keeps one indicator from appearing twice,
# computed two different ways over two different windows.
CHART_EXCLUDED_OBJECTS = {
    "ta_indicators_1m": (
        "The chart computes these natively from the bars on screen — rsi, macd, bbands, "
        "atr, obv, ema, sma and vwap are all in the indicator list. This view covers only "
        "a sliver of MNQ, so the lake copy would disagree with the native one."
    ),
    "mnq_zigzag_1m": (
        "The chart draws its own causal zigzag from the bars on screen — the ZZ toggle in "
        "the toolbar."
    ),
}

# Objects whose every column is computed from bars after the one it sits on.
LABEL_OBJECTS = {"mnq_labels_1m", "mnq_labels_1m_new"}

# Columns that identify a row rather than measure anything.
REFERENCE_COLUMNS = {
    "symbol",
    "pair",
    "asset_class",
    "root",
    "year",
    "vendor",
    "timeframe",
    "tf",
    "exchange",
    "config",
    "currency",
}

# Columns that are bounded at 0 and 100 by construction, not by coincidence.
OSCILLATOR_NAMES = re.compile(
    r"^(rsi|stoch|stochrsi|mfi|adx|dmi|aroon|willr|cmo|uo|ultosc|percent_?[kd]|pct_?[kd])",
    re.IGNORECASE,
)

NUMERIC_TYPES = {
    "BIGINT",
    "INTEGER",
    "DOUBLE",
    "FLOAT",
    "DECIMAL",
    "HUGEINT",
    "SMALLINT",
    "TINYINT",
    "UBIGINT",
    "UINTEGER",
    "REAL",
}

OBJECT_DESCRIPTIONS = {
    "bars": "The Iceberg system of record, one-second bars straight from the lake.",
    "ohlcv": "One-second bars across every asset class, frozen at the 2026-09-09 snapshot.",
    "candle_anatomy": "Per-bar candle arithmetic — body, wicks and range.",
    "candle_anatomy_1m": "Per-bar candle arithmetic at one minute.",
    "candle_geometry_1m": "Scale-free candle shape plus causal rolling z-scores.",
    "mnq_indicators_norm_1m": "Batch-computed normalized MNQ indicators.",
    "mnq_zigzag_1m": "Causal zigzag pivots and leg geometry.",
    "ta_indicators_1m": "The classic indicator stack computed in the lake.",
    "mnq_labels_1m": "Forward-looking training targets. Every column reads bars this one cannot see.",
    "mnq_labels_1m_new": "Forward-looking training targets, second generation.",
    "mnq_swing_5m": "One row per swing setup, with how it resolved.",
    "mnq_tbl_5m": "One row per triple-barrier setup, with which barrier was hit.",
    "talib_candle_patterns": "Detected candlestick patterns, one row per hit.",
    "symbols": "Instrument reference data. Not a time series.",
}

# ─── Family ──────────────────────────────────────────────────────────────────
# Ordered: the first pattern that matches wins, so the specific ones come first.
FAMILY_PATTERNS: list[tuple[str, str]] = [
    (r"^(bid|ask)_(open|high|low|close)$", "microstructure"),
    (r"^(vol|trades)_at_(bid|ask)$", "microstructure"),
    (r"^trades$", "microstructure"),
    (r"^(volume|obv)", "volume"),
    (r"volume_(sma_ratio|zscore|z)$", "volume"),
    (r"^vol_regime$|^rng_bucket", "regime"),
    (r"^(atr|natr)", "volatility"),
    (r"(logrange|realized_vol|_vol_|vol_logrange|squeeze)", "volatility"),
    (r"^(total_range|range_pts|range_z)$", "volatility"),
    (r"^(rsi|macd|roc_|ret_|return_|stc|mom|tsi|cci)", "momentum"),
    (r"^(ema_|sma_\d|zz_slope|tbeta)", "trend"),
    (r"(_dev_|deviation|bb_position)", "mean_reversion"),
    (r"_z(score)?$", "statistics"),
    (r"^(open|high|low|close)(_norm)?$", "price_structure"),
    (r"(body|wick|_norm$|is_bullish|^zz_)", "price_structure"),
    (r"^(entry_px|stop_px|target_px|prior_low|prior_high|upper|lower|exit_px)$", "trade_level"),
    (r"^(k_up|k_dn|risk_pts|barrier_gap_pts)$", "trade_level"),
    (r"^pattern$|^direction$|^value$", "pattern"),
]

LABEL_PATTERNS = [
    r"^fwd_",
    r"^dir_h\d+$",
    r"^dir_delta_pts_h\d+$",
    r"^tbl_",
    r"^meta_",
    r"^swing_(label|ret_pts)$",
    r"_h\d+$",
    r"^outcome$",
    r"^label$",
    r"^exit_(bar|ts|px)$",
    r"^(mfe|mae|edge)_",
    r"^r_(struct|long|short)$",
    r"^ret_pts$",
    r"^next_pivot_",
    r"^amp_to_pivot_",
    r"^(ambiguous|gap_crossed|usable)$",
    r"^w_(uniqueness|proximity)$",
    r"^strength$",
    r"^zero_range$",
]

FULL_WORD_LABELS = {
    "ts": "timestamp",
    "rsi_14": "relative strength index, 14 bars",
    "macd_line": "MACD line",
    "macd_signal": "MACD signal line",
    "macd_histogram": "MACD histogram",
    "atr_14": "average true range, 14 bars",
    "atr_ratio": "average true range as a ratio of price",
    "atr_pct_14": "average true range, percent of price, 14 bars",
    "obv": "on-balance volume",
    "obv_slope": "on-balance volume slope",
    "bb_position": "position within the Bollinger bands",
    "bb_squeeze": "Bollinger band squeeze",
    "vwap_deviation": "distance from the volume-weighted average price",
    "volume_sma_ratio": "volume over its moving average",
    "volume_zscore": "volume z-score",
    "total_range": "total range",
    "body_magnitude": "body size as a fraction of range",
    "upper_wick_pct": "upper wick as a fraction of range",
    "lower_wick_pct": "lower wick as a fraction of range",
    "is_bullish": "closed above its open",
    "range_z": "range z-score",
    "body_z": "body z-score",
    "wick_z": "wick imbalance z-score",
    "return_z": "return z-score",
    "volume_z": "volume z-score",
    "open_norm": "open within the candle, scale-free",
    "close_norm": "close within the candle, scale-free",
    "body_norm": "body within the candle, scale-free",
    "upper_norm": "upper wick within the candle, scale-free",
    "lower_norm": "lower wick within the candle, scale-free",
    "zz_slope": "zigzag leg slope",
    "zz_pct": "zigzag leg move, percent",
    "zz_dev_units": "zigzag deviation, units",
    "zz_bars": "zigzag leg length, bars",
    "zz_dir": "zigzag direction",
    "zz_run_pct": "zigzag run from the pivot, percent",
    "zz_leg_id": "zigzag leg identifier",
    "zz_is_pivot": "is a confirmed zigzag pivot",
    "zz_provisional": "zigzag pivot still provisional",
    "vol_at_bid": "volume traded at the bid",
    "vol_at_ask": "volume traded at the ask",
    "trades_at_bid": "trade count at the bid",
    "trades_at_ask": "trade count at the ask",
    "mae_atr": "maximum adverse excursion, in average true ranges",
    "mfe_atr": "maximum favorable excursion, in average true ranges",
    "mae_r": "maximum adverse excursion, in risk units",
    "mfe_r": "maximum favorable excursion, in risk units",
    "entry_px": "entry price",
    "stop_px": "stop price",
    "target_px": "target price",
    "exit_px": "exit price",
    "vol_regime": "volatility regime",
}


def human_label(column: str) -> str:
    """Full words for anything a person reads, per the naming rule."""
    if column in FULL_WORD_LABELS:
        return FULL_WORD_LABELS[column]
    text = column.replace("_", " ")
    text = re.sub(r"\bpts\b", "points", text)
    text = re.sub(r"\bpct\b", "percent", text)
    text = re.sub(r"\bret\b", "return", text)
    text = re.sub(r"\bfwd\b", "forward", text)
    text = re.sub(r"\bdir\b", "direction", text)
    text = re.sub(r"\btbl\b", "triple barrier", text)
    text = re.sub(r"\bh(\d+)\b", r"\1 bars ahead", text)
    text = re.sub(r"\bz\b", "z-score", text)
    return text


def is_numeric(duckdb_type: str) -> bool:
    return duckdb_type.split("(")[0].upper() in NUMERIC_TYPES


def is_timestamp(duckdb_type: str) -> bool:
    upper = duckdb_type.upper()
    return upper.startswith("TIMESTAMP") or upper == "DATE"


def assign_family(object_name: str, column: str) -> str:
    if column in REFERENCE_COLUMNS:
        return "reference"
    if object_name in LABEL_OBJECTS or matches_any(column, LABEL_PATTERNS):
        if object_name in EVENT_OBJECTS and re.match(
            r"^(entry_px|stop_px|target_px|upper|lower|k_up|k_dn|risk_pts|atr|prior_)", column
        ):
            return "trade_level"
        return "label"
    if object_name == "talib_candle_patterns":
        return "pattern"
    for pattern, family in FAMILY_PATTERNS:
        if re.search(pattern, column):
            return family
    return "statistics"


def matches_any(column: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, column) for pattern in patterns)


def is_forward_looking(object_name: str, column: str) -> bool:
    if column in REFERENCE_COLUMNS or column in ("timestamp", "ts"):
        return False
    if object_name in LABEL_OBJECTS:
        return True
    if object_name in ("mnq_swing_5m", "mnq_tbl_5m"):
        # The setup's own levels are known at the bar; how it RESOLVED is not.
        known_at_bar = {
            "entry_px",
            "stop_px",
            "target_px",
            "upper",
            "lower",
            "k_up",
            "k_dn",
            "risk_pts",
            "atr",
            "prior_low",
            "prior_high",
            "horizon",
        }
        return column not in known_at_bar
    return matches_any(column, LABEL_PATTERNS)


def finite(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def classify_shape(
    column: str,
    duckdb_type: str,
    stats: dict[str, Any],
    close_average: float | None,
) -> str:
    if is_timestamp(duckdb_type):
        return "timestamp"
    if duckdb_type.upper() == "BOOLEAN":
        return "binary"
    if not is_numeric(duckdb_type):
        return "text"

    distinct = stats.get("distinct_approximate") or 0
    minimum = finite(stats.get("minimum"))
    maximum = finite(stats.get("maximum"))
    mean = finite(stats.get("mean"))

    if (
        minimum is not None
        and maximum is not None
        and distinct <= 2
        and {minimum, maximum} <= {0.0, 1.0}
    ):
        return "binary"
    if (
        distinct
        and distinct <= 12
        and duckdb_type.split("(")[0].upper()
        in ("BIGINT", "INTEGER", "SMALLINT", "TINYINT", "DOUBLE")
        and minimum is not None
        and maximum is not None
        and abs(maximum - minimum) <= 12
    ):
        return "categorical"

    if re.search(r"^obv$|cumulative", column):
        return "cumulative"

    price_named = bool(
        re.match(
            r"^(open|high|low|close|vwap|ema_|sma_|entry_px|stop_px|target_px|exit_px|prior_low|prior_high|upper|lower)$|^(ema_|sma_)\d+$",
            column,
        )
    )
    if price_named and close_average and mean is not None and close_average > 0:
        ratio = abs(mean) / close_average
        if 0.1 <= ratio <= 10:
            return "price_level"

    if minimum is not None and maximum is not None:
        # A column is a 0-100 oscillator because it is BOUNDED at 0 and 100 by
        # construction, not because one sample happened to land there. The
        # average true range of MNQ spans roughly 0 to 100 points, and on the
        # coincidence alone it was being drawn with oversold and overbought
        # lines that mean nothing for a volatility measure.
        if -1 <= minimum <= 5 and 95 <= maximum <= 105 and OSCILLATOR_NAMES.search(column):
            return "bounded_oscillator"
        if -1.01 <= minimum and maximum <= 1.01 and (maximum - minimum) > 0:
            return "bounded_ratio"
        if minimum >= 0:
            return "positive_magnitude"
    return "centered_unbounded"


def choose_render_mode(
    column: str,
    family: str,
    shape: str,
    object_name: str,
    fired_fraction: float | None,
) -> str:
    """How the chart draws it.

    `fired_fraction` is how often a flag is actually on. A flag that fires on a
    few bars is an event and gets a mark on those bars; one that is on half the
    time is a state, and a state is a step, never a line interpolated between
    two states that never existed.
    """
    if object_name in EVENT_OBJECTS or family == "pattern":
        # Only a flag or a state marks a bar. The chart draws a marker's sign as
        # bullish or bearish direction, so an exit price or an excursion in
        # average true ranges would have been drawn as a direction it does not
        # carry; those take a pane instead.
        if shape in ("binary", "categorical") or family == "pattern":
            return "markers"
        return "pane_line"
    if shape in ("binary", "categorical"):
        if shape == "binary" and fired_fraction is not None and fired_fraction <= 0.2:
            return "markers"
        return "background" if family == "regime" else "pane_step"
    if family == "label":
        # A forward-looking number is still a number: draw it as a line in its
        # own pane, where the forward-looking badge sits beside it. Turning two
        # million returns into markers would only make it unreadable.
        return "pane_line"
    if shape == "price_level":
        return "price_overlay"
    if family == "regime":
        return "background"
    if re.search(r"histogram$", column):
        return "pane_histogram"
    if family == "volume" and shape != "cumulative":
        return "pane_histogram"
    return "pane_line"


def reference_lines(column: str, shape: str, family: str) -> list[dict[str, Any]]:
    # Percent-B is read against the bands themselves: 0 is the lower band, 1 the
    # upper, and outside that range the price has left the channel.
    if re.search(r"^bb_position$|percent_b$", column):
        return [
            {"value": 0, "label": "lower band", "kind": "level"},
            {"value": 0.5, "label": "middle band", "kind": "level"},
            {"value": 1, "label": "upper band", "kind": "level"},
        ]
    if shape == "bounded_oscillator":
        return [
            {"value": 30, "label": "oversold", "kind": "level"},
            {"value": 50, "label": "midpoint", "kind": "level"},
            {"value": 70, "label": "overbought", "kind": "level"},
        ]
    if shape == "bounded_ratio":
        return [{"value": 0, "label": "zero", "kind": "zero"}]
    if shape == "centered_unbounded":
        lines: list[dict[str, Any]] = [{"value": 0, "label": "zero", "kind": "zero"}]
        if family == "statistics" or column.endswith("_z") or column.endswith("_zscore"):
            # The rolling z-scores are clipped at five standard deviations, so a
            # flat run at the edge is the clip, not the market.
            lines.append({"value": 5, "label": "clip at +5 standard deviations", "kind": "clip"})
            lines.append({"value": -5, "label": "clip at -5 standard deviations", "kind": "clip"})
        return lines
    return []


def measure_object(
    connection: Any, name: str, symbol: str, sample_rows: int
) -> dict[str, Any] | None:
    schema = connection.execute(f'DESCRIBE "{name}"').fetchall()
    columns = [(row[0], row[1]) for row in schema]
    column_names = [column for column, _ in columns]

    timestamp_column = TIMESTAMP_COLUMN_OVERRIDE.get(
        name, "timestamp" if "timestamp" in column_names else None
    )
    symbol_column = SYMBOL_COLUMN_OVERRIDE.get(name, "symbol" if "symbol" in column_names else None)
    sample_symbol = FOREX_SAMPLE_SYMBOL if symbol_column == "pair" else symbol

    if name in DIMENSION_OBJECTS:
        sample_sql = f'SELECT * FROM "{name}"'
    elif symbol_column and timestamp_column:
        sample_sql = (
            f'SELECT * FROM "{name}" WHERE "{symbol_column}" = \'{sample_symbol}\' '
            f'ORDER BY "{timestamp_column}" DESC LIMIT {sample_rows}'
        )
    else:
        sample_sql = f'SELECT * FROM "{name}" USING SAMPLE {sample_rows} ROWS'

    view = f"_series_sample_{name}"
    connection.execute(f'CREATE OR REPLACE TEMP VIEW "{view}" AS {sample_sql}')
    sampled = connection.execute(f'SELECT count(*) FROM "{view}"').fetchone()[0]
    if not sampled:
        return None

    close_average = None
    if "close" in column_names:
        close_average = finite(
            connection.execute(
                f'SELECT avg(close) FROM "{view}" WHERE close IS NOT NULL'
            ).fetchone()[0]
        )

    expressions = ["count(*) AS total_rows"]
    for column, duckdb_type in columns:
        expressions.append(f'count("{column}") AS "{column}__nonnull"')
        expressions.append(f'approx_count_distinct("{column}") AS "{column}__distinct"')
        if is_numeric(duckdb_type):
            for function, suffix in (
                ("min", "min"),
                ("max", "max"),
                ("avg", "mean"),
                ("stddev_samp", "std"),
            ):
                expressions.append(f'{function}("{column}") AS "{column}__{suffix}"')
            for quantile, suffix in ((0.01, "p01"), (0.5, "p50"), (0.99, "p99")):
                expressions.append(f'quantile_cont("{column}", {quantile}) AS "{column}__{suffix}"')
        elif duckdb_type.upper() == "BOOLEAN":
            # For a flag the average IS the fraction of bars it is on, and that
            # fraction decides whether it draws as an event or as a state.
            cast = f'CAST("{column}" AS DOUBLE)'
            expressions.append(f'min({cast}) AS "{column}__min"')
            expressions.append(f'max({cast}) AS "{column}__max"')
            expressions.append(f'avg({cast}) AS "{column}__mean"')

    cursor = connection.execute(f'SELECT {", ".join(expressions)} FROM "{view}"')
    row = dict(zip([description[0] for description in cursor.description], cursor.fetchone()))
    total = row["total_rows"] or 1

    row_count = connection.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]

    first_seconds = last_seconds = None
    timeframe = None
    if timestamp_column:
        # Bounds come from the whole table, never the sample: series.router.ts
        # and regression.router.ts clamp requests to them, and the sample is the
        # newest `sample_rows` rows of one symbol, so its minimum cut every lake
        # column off decades short (mnq_indicators_norm_1m read as starting
        # 2025-11-06 when it holds rows from 2019-05-05).
        bounds = connection.execute(
            f'SELECT min("{timestamp_column}"), max("{timestamp_column}") FROM "{name}"'
        ).fetchone()
        first_seconds = int(bounds[0].timestamp()) if bounds[0] else None
        last_seconds = int(bounds[1].timestamp()) if bounds[1] else None
        spacing = connection.execute(
            f'SELECT median(gap) FROM (SELECT epoch("{timestamp_column}") - '
            f'lag(epoch("{timestamp_column}")) OVER (ORDER BY "{timestamp_column}") AS gap FROM "{view}") '
            f"WHERE gap > 0"
        ).fetchone()[0]
        timeframe = seconds_to_timeframe(finite(spacing))

    symbols: list[str] = []
    if symbol_column and name not in DIMENSION_OBJECTS:
        symbols = [
            r[0]
            for r in connection.execute(
                f'SELECT DISTINCT "{symbol_column}" FROM "{name}" LIMIT 500'
            ).fetchall()
            if r[0]
        ]

    grain = (
        "dimension"
        if name in DIMENSION_OBJECTS
        else "per_event"
        if name in EVENT_OBJECTS
        else "per_bar"
    )

    catalog_columns = []
    for column, duckdb_type in columns:
        non_null = row.get(f"{column}__nonnull") or 0
        stats = {
            "distinct_approximate": int(row.get(f"{column}__distinct") or 0),
            "minimum": finite(row.get(f"{column}__min")),
            "maximum": finite(row.get(f"{column}__max")),
            "mean": finite(row.get(f"{column}__mean")),
        }
        null_fraction = round(1 - non_null / total, 6)

        shape = classify_shape(column, duckdb_type, stats, close_average)
        family = assign_family(name, column)
        forward = is_forward_looking(name, column)
        # For a 0/1 column the mean IS the fraction of bars the flag is on.
        fired_fraction = stats["mean"] if shape == "binary" else None
        mode = choose_render_mode(column, family, shape, name, fired_fraction)

        unavailable = None
        if name in CHART_EXCLUDED_OBJECTS:
            unavailable = CHART_EXCLUDED_OBJECTS[name]
        elif column in (timestamp_column,):
            unavailable = "This is the time axis itself."
        elif family == "reference" or shape == "text":
            unavailable = "Identifies the row rather than measuring anything."
        elif re.search(r"_id$|^config$|^horizon$", column):
            unavailable = "An identifier, not a measurement."
        elif shape == "timestamp":
            unavailable = "A timestamp, not a value to plot."
        elif null_fraction >= 0.9999:
            unavailable = f"Empty for {sample_symbol} — every sampled row is null."
        elif grain == "dimension":
            unavailable = "Reference data, not a time series."

        catalog_columns.append(
            {
                "id": f"lake:{name}:{column}",
                "object": name,
                "column": column,
                "label": human_label(column),
                "family": family,
                "valueShape": shape,
                "renderMode": mode,
                "duckdbType": duckdb_type,
                "nullFraction": null_fraction,
                "distinctApproximate": stats["distinct_approximate"],
                "minimum": stats["minimum"],
                "maximum": stats["maximum"],
                "percentile01": finite(row.get(f"{column}__p01")),
                "percentile50": finite(row.get(f"{column}__p50")),
                "percentile99": finite(row.get(f"{column}__p99")),
                "referenceLines": reference_lines(column, shape, family),
                "forwardLooking": forward,
                **({"unavailableReason": unavailable} if unavailable else {}),
            }
        )

    return {
        "object": name,
        "description": OBJECT_DESCRIPTIONS.get(name, f"Lake object {name}."),
        "timestampColumn": timestamp_column or "",
        "symbolColumn": symbol_column,
        "timeframe": timeframe,
        "rowCount": int(row_count),
        "firstTimestampSeconds": first_seconds,
        "lastTimestampSeconds": last_seconds,
        "symbols": sorted(symbols),
        "grain": grain,
        "columns": catalog_columns,
    }


def seconds_to_timeframe(seconds: float | None) -> str | None:
    if not seconds or seconds <= 0:
        return None
    table = [
        (1, "1s"),
        (60, "1m"),
        (300, "5m"),
        (900, "15m"),
        (1800, "30m"),
        (3600, "1h"),
        (14400, "4h"),
        (86400, "1d"),
        (604800, "1w"),
    ]
    for value, name in table:
        if abs(seconds - value) <= max(1.0, value * 0.2):
            return name
    return f"{int(seconds)}s"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--symbol", default="MNQ", help="Symbol the column statistics are measured on."
    )
    parser.add_argument("--sample-rows", type=int, default=50000)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    arguments = parser.parse_args()

    connection = connect()
    objects = [row[0] for row in connection.execute("SHOW TABLES").fetchall()]
    print(f"{len(objects)} objects in the serving connection", flush=True)

    catalog_objects = []
    started = time.time()
    for name in sorted(objects):
        object_started = time.time()
        try:
            measured = measure_object(connection, name, arguments.symbol, arguments.sample_rows)
        except Exception as error:  # noqa: BLE001 - one bad object must not lose the rest
            print(f"  {name}: FAILED {str(error)[:160]}", flush=True)
            continue
        if measured is None:
            print(f"  {name}: no rows for {arguments.symbol}, skipped", flush=True)
            continue
        catalog_objects.append(measured)
        chartable = sum(1 for column in measured["columns"] if "unavailableReason" not in column)
        print(
            f"  {name}: {len(measured['columns'])} columns, {chartable} chartable, "
            f"{measured['timeframe']} grain, {time.time() - object_started:.1f}s",
            flush=True,
        )

    column_count = sum(len(entry["columns"]) for entry in catalog_objects)
    chartable_count = sum(
        1
        for entry in catalog_objects
        for column in entry["columns"]
        if "unavailableReason" not in column
    )
    catalog = {
        "generatedAtIso": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": f"lake.serving over s3://derived/recipe=questdb_full_2026-09-09 plus live Iceberg bars; "
        f"statistics measured on {arguments.symbol} over the most recent {arguments.sample_rows} rows",
        "objectCount": len(catalog_objects),
        "columnCount": column_count,
        "chartableColumnCount": chartable_count,
        "objects": catalog_objects,
    }

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(
        f"\n{len(catalog_objects)} objects, {column_count} columns, {chartable_count} chartable "
        f"in {time.time() - started:.1f}s -> {arguments.output}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
