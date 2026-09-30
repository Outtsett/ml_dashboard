"""Land the tables of the `candle-shape-standouts` study: MNQ 1-minute candles whose body and
wick proportions, or whose size, stand out — with when they happened.

Source bars: ``candle_vision.bars.load`` (``derived_mnq_next_candles_1m``, true UTC, 2021-01-03 ..
2025-06-30; the second half of 2025 is the locked holdout and is not read).

Every measure is causal: a bar is compared only with the bars before it.

  shape cell        the candle's body / upper wick / lower wick as fractions of its range, each in
                    tenths (0 = under 10 % ... 9 = 90 % or more), plus rising / falling / flat —
                    e.g. ``rising b8 u1 l0`` is a near-marubozu up candle
  trailing share    how often that cell occurred in the previous 20,000 bars (about 14 sessions)
  trailing range    the mean range of the previous 60 bars

A bar stands out for any of five reasons (thresholds in the ``rules`` table):
  rare_shape        its cell took under 0.02 % of the previous 20,000 bars (fewer than 4 of them),
                    or had never occurred before
  long_range        range >= 4 x the trailing range
  long_body         body  >= 3 x the trailing range
  long_upper_wick   upper wick >= 2 x the trailing range
  long_lower_wick   lower wick >= 2 x the trailing range

Tables (``derived_study_candle_shape_standouts_<table>``):
  standouts         one row per standing-out bar: prices (labelled absolute), lengths in ticks, every
                    ratio, the reasons, and its time — UTC and New York, trading day, day of the week,
                    month, hour, minute of the session
  shape_catalog     one row per shape cell over the whole span: count, share, first and last seen,
                    counts by trading day of the week and by month
  rules             the thresholds and windows above

Run:  .venv/Scripts/python.exe src/ml/studies/candle_shape_standouts/build.py [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from candle_vision.bars import TICK, load  # noqa: E402
from ta_strategy.store import land  # noqa: E402

DATASET = "study_candle_shape_standouts"
RECIPE = "mnq_1m_2021_2025h1_v1"
SHAPE_WINDOW_BARS = 20_000
RANGE_WINDOW_BARS = 60
RULES = {
    "rare_shape": ("trailing_shape_share_percent", "<", 0.02),
    "long_range": ("range_to_trailing_mean_range_ratio", ">=", 4.0),
    "long_body": ("body_to_trailing_mean_range_ratio", ">=", 3.0),
    "long_upper_wick": ("upper_wick_to_trailing_mean_range_ratio", ">=", 2.0),
    "long_lower_wick": ("lower_wick_to_trailing_mean_range_ratio", ">=", 2.0),
}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"]


def shape_cells(o: np.ndarray, h: np.ndarray, l: np.ndarray, c: np.ndarray) -> tuple[np.ndarray, ...]:
    rng = h - l
    safe = np.where(rng > 0, rng, np.nan)
    body = np.abs(c - o) / safe
    upper = (h - np.maximum(o, c)) / safe
    lower = (np.minimum(o, c) - l) / safe
    tenth = lambda x: np.clip(np.floor(np.nan_to_num(x) * 10 + 1e-9), 0, 9).astype(int)
    direction = np.where(c > o, "rising", np.where(c < o, "falling", "flat"))
    cell = np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(
        direction.astype(str), " b"), tenth(body).astype(str)), " u"), tenth(upper).astype(str)), " l"), tenth(lower).astype(str))
    cell = np.where(rng > 0, cell, "no range")
    return body, upper, lower, cell


def trailing_share(cells: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    """Per bar: the percent of the previous ``window`` bars in the same cell (NaN until ``window``
    bars precede it) and whether this is the cell's first occurrence ever."""
    n = len(cells)
    share = np.full(n, np.nan)
    first = np.zeros(n, dtype=bool)
    codes, inverse = np.unique(cells, return_inverse=True)
    order = np.argsort(inverse, kind="stable")
    boundaries = np.flatnonzero(np.diff(inverse[order])) + 1
    for positions in np.split(order, boundaries):
        k = np.arange(len(positions))                     # occurrences before this one, all time
        before_window = np.searchsorted(positions, positions - window, side="left")
        share[positions] = (k - before_window) / window * 100.0
        first[positions[0]] = True
    share[:window] = np.nan
    return share, first


def compute(frame: pd.DataFrame) -> dict[str, pd.DataFrame]:
    o, h, l, c = (frame[k].to_numpy(np.float64) for k in ("open", "high", "low", "close"))
    body_fraction, upper_fraction, lower_fraction, cells = shape_cells(o, h, l, c)
    rng, body = h - l, np.abs(c - o)
    upper, lower = h - np.maximum(o, c), np.minimum(o, c) - l
    trailing_range = pd.Series(rng).shift(1).rolling(RANGE_WINDOW_BARS, min_periods=RANGE_WINDOW_BARS).mean().to_numpy()
    safe_trailing = np.where(trailing_range > 0, trailing_range, np.nan)
    share, first = trailing_share(cells, SHAPE_WINDOW_BARS)

    new_york = frame["timestamp"].dt.tz_convert("America/New_York")
    trading_day = pd.to_datetime(frame["trading_day"])
    bars = pd.DataFrame({
        "timestamp": frame["timestamp"],
        "new_york_time": new_york.dt.tz_localize(None),
        "trading_day": trading_day.dt.date,
        "trading_day_of_week": trading_day.dt.dayofweek.map(dict(enumerate(WEEKDAYS))),
        "new_york_day_of_week": new_york.dt.dayofweek.map(dict(enumerate(WEEKDAYS))),
        "month": new_york.dt.month.map(dict(enumerate(MONTHS, start=1))),
        "month_number": new_york.dt.month.astype(int),
        "year": new_york.dt.year.astype(int),
        "new_york_hour": new_york.dt.hour.astype(int),
        "minute_of_session": frame["minute_of_session"].astype(int),
        "bars_since_session_break": frame["bars_since_session_break"].astype(int),
        "contract_symbol": frame["contract_symbol"],
        "absolute_open_price": o, "absolute_high_price": h, "absolute_low_price": l, "absolute_close_price": c,
        "volume": frame["volume"].astype(float),
        "direction": np.where(c > o, "rising", np.where(c < o, "falling", "flat")),
        "range_ticks": np.round(rng / TICK, 6),
        "body_ticks": np.round(body / TICK, 6),
        "upper_wick_ticks": np.round(upper / TICK, 6),
        "lower_wick_ticks": np.round(lower / TICK, 6),
        "body_fraction_of_range": body_fraction,
        "upper_wick_fraction_of_range": upper_fraction,
        "lower_wick_fraction_of_range": lower_fraction,
        "upper_to_lower_wick_ratio": np.where(lower > 0, upper / np.where(lower > 0, lower, 1), np.nan),
        "body_to_total_wick_ratio": np.where(upper + lower > 0, body / np.where(upper + lower > 0, upper + lower, 1), np.nan),
        "trailing_mean_range_ticks": trailing_range / TICK,
        "range_to_trailing_mean_range_ratio": rng / safe_trailing,
        "body_to_trailing_mean_range_ratio": body / safe_trailing,
        "upper_wick_to_trailing_mean_range_ratio": upper / safe_trailing,
        "lower_wick_to_trailing_mean_range_ratio": lower / safe_trailing,
        "shape_cell": cells,
        "trailing_shape_share_percent": share,
        "first_occurrence_of_shape": first,
    })
    flags = {}
    for name, (column, op, threshold) in RULES.items():
        values = bars[column].to_numpy(float)
        flags[name] = (values < threshold) if op == "<" else (values >= threshold)
        flags[name] &= ~np.isnan(values)
    flags["rare_shape"] |= first & (np.arange(len(bars)) >= SHAPE_WINDOW_BARS)
    for name, flag in flags.items():
        bars[name] = flag
    bars["reason_count"] = np.sum(list(flags.values()), axis=0).astype(int)
    standout_mask = bars["reason_count"].to_numpy() > 0
    standouts = bars.loc[standout_mask].copy()
    standouts["reasons"] = standouts[list(RULES)].apply(lambda r: ", ".join(n for n in RULES if r[n]), axis=1)

    catalog = bars.groupby("shape_cell").agg(
        bar_count=("timestamp", "size"), first_seen=("timestamp", "min"), last_seen=("timestamp", "max"),
        standout_count=("reason_count", lambda s: int((s > 0).sum())),
    ).reset_index()
    catalog["share_percent"] = catalog["bar_count"] / len(bars) * 100.0
    parts = catalog["shape_cell"].str.extract(r"^(\w+) b(\d) u(\d) l(\d)$")
    catalog["direction"] = parts[0].fillna("no range")
    for k, name in ((1, "body"), (2, "upper_wick"), (3, "lower_wick")):
        catalog[f"{name}_tenth_of_range"] = pd.to_numeric(parts[k], errors="coerce")
    by_weekday = pd.crosstab(bars["shape_cell"], bars["trading_day_of_week"]).reindex(columns=WEEKDAYS[:5] + ["sunday"], fill_value=0)
    by_weekday.columns = [f"{d}_count" for d in by_weekday.columns]
    by_month = pd.crosstab(bars["shape_cell"], bars["month"]).reindex(columns=MONTHS, fill_value=0)
    by_month.columns = [f"{m}_count" for m in by_month.columns]
    catalog = catalog.merge(by_weekday, left_on="shape_cell", right_index=True).merge(by_month, left_on="shape_cell", right_index=True)
    catalog = catalog.sort_values("bar_count").reset_index(drop=True)

    rules = pd.DataFrame([
        {"reason": name, "column": column, "comparison": op, "threshold": threshold,
         "bar_count": int(flags[name].sum()), "share_of_bars_percent": float(flags[name].mean() * 100)}
        for name, (column, op, threshold) in RULES.items()
    ])
    rules["shape_window_bars"] = SHAPE_WINDOW_BARS
    rules["range_window_bars"] = RANGE_WINDOW_BARS
    rules["bars_examined"] = len(bars)
    rules["first_bar"] = bars["timestamp"].min()
    rules["last_bar"] = bars["timestamp"].max()
    return {"standouts": standouts.reset_index(drop=True), "shape_catalog": catalog, "rules": rules}


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    return arrow_fs().get_file_info(arrow_key(derived_root(DATASET, RECIPE))).type != FileType.NotFound


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="compute and print; land nothing")
    arguments = parser.parse_args()
    frame = load(with_patterns=False)
    tables = compute(frame)
    print(f"bars examined: {len(frame):,}  {frame['timestamp'].min()} .. {frame['timestamp'].max()}")
    for name, table in tables.items():
        print(f"--- {name}: {len(table):,} rows, {len(table.columns)} columns")
    print(tables["rules"][["reason", "bar_count", "share_of_bars_percent"]].to_string(index=False))
    if arguments.dry_run:
        return 0
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    with tempfile.TemporaryDirectory(prefix="study_candle_shape_standouts_") as directory:
        paths = {}
        for name, table in tables.items():
            paths[name] = os.path.join(directory, f"{name}.parquet")
            table.to_parquet(paths[name], index=False)
        result = land(paths, RECIPE, "derived_mnq_next_candles_1m 2021-01..2025-06 (study candle-shape-standouts build.py)",
                      dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
