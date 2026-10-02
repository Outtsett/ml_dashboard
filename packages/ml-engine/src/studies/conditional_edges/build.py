"""Land the `conditional-edges` tables: what happens after a bar of a given kind, on MNQ, tested honestly.

Question: when a bar has a certain volume, size, shape, direction or session, is the next move up more
(or less) often than usual — and is the move big enough to pay for a round trip?

Source bars: ``candle_vision.bars.load`` (``derived_mnq_next_candles_1m``, true UTC, front contract,
2021-01-03 .. 2025-06-30; bars from 2025-07-01 on are the locked holdout and are never read). 5-minute
and 15-minute bars are built from them inside each contract and session (open of the first minute,
highest high, lowest low, close of the last minute, summed volume).

Every bar is described only by itself and the bars before it:
  relative_volume   volume / mean volume of the previous 20 bars of the same contract
  relative_range    (high - low) / mean range of the previous 20 bars
  shape             doji (body <= 10 % of range), lower_rejection (lower wick > 2 x body and longer than
                    the upper wick), upper_rejection (upper wick > 2 x body), large_body (body >= 70 % of
                    range), ordinary, no_range — tested in that order, so each bar has one shape
  direction         rising (close > open), falling, flat
  session           regular (09:30-16:00 New York) or extended

Outcome at horizon h bars (1, 3, 10): the close h bars later minus this close, in ticks (0.25 point),
only when those h bars are in the same contract and session. "Up share" counts moves that are not flat.

Test, so a lucky cell cannot pass:
  discovery     2021-01-01 .. 2023-12-31: the cell's up share against the base rate of all bars, with a
                standard error clustered by trading day (bars on one day are not independent), and
                Benjamini-Hochberg false-discovery control over every cell tested (q < 0.05)
  confirmation  2024-01-01 .. 2025-06-30, never used to choose anything: the same cell must move the
                same way with p < 0.05 (one-sided)
  cost          trading the cell's discovered direction must clear the MNQ round trip of
                ``packages/config/cost_model.json`` (5.56 ticks: fees plus one tick of slippage a side)
Verdicts: edge after costs | real but smaller than costs | not confirmed out of sample | no edge |
too few events (fewer than 200 in discovery or 100 in confirmation).

Tables (``derived_study_conditional_edges_<table>``):
  edges         one row per timeframe x horizon x condition, discovery / confirmation / full statistics
  baselines     the base rate each cell is compared with
  definitions   every threshold and window above

Run:  .venv/Scripts/python.exe packages/ml-engine/src/studies/conditional_edges/build.py [--dry-run]
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
from scipy import stats

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from candle_vision.bars import TICK, load  # noqa: E402
from ta_strategy.store import land  # noqa: E402

DATASET = "study_conditional_edges"
RECIPE = "mnq_2021_2025h1_v1"
TIMEFRAMES = {"1m": 1, "5m": 5, "15m": 15}
HORIZONS = (1, 3, 10)
TRAILING_BARS = 20
DISCOVERY_END = pd.Timestamp("2024-01-01", tz="UTC")
MINIMUM_DISCOVERY = 200
MINIMUM_CONFIRMATION = 100
FALSE_DISCOVERY_RATE = 0.05
CONFIRMATION_P = 0.05
BUCKET_EDGES = [0.0, 0.5, 1.0, 2.0, 3.0, np.inf]
BUCKET_LABELS = ["under 0.5x", "0.5-1x", "1-2x", "2-3x", "3x and over"]
LABEL_PREFIX = {"relative_volume": "volume ", "relative_range": "range ", "shape": "", "direction": "", "session": "session "}
FAMILIES = {
    "relative volume": ["relative_volume"],
    "relative range": ["relative_range"],
    "shape": ["shape"],
    "direction": ["direction"],
    "session": ["session"],
    "relative volume x shape x direction": ["relative_volume", "shape", "direction"],
    "relative range x shape x direction": ["relative_range", "shape", "direction"],
    "relative volume x direction x session": ["relative_volume", "direction", "session"],
}


def round_trip_ticks() -> float:
    cost = json.loads((ROOT / "src" / "config" / "cost_model.json").read_text(encoding="utf-8"))["MNQ"]
    return float(cost["total_round_trip_points"]) / TICK


def resample(bars: pd.DataFrame, minutes: int) -> pd.DataFrame:
    """Bars of ``minutes`` built inside each contract and session; 1 returns the 1-minute bars."""
    frame = bars.copy()
    frame["session_id"] = (frame["bars_since_session_break"] == 0).cumsum()
    if minutes == 1:
        return frame
    frame["bucket"] = frame["timestamp"].dt.floor(f"{minutes}min")
    grouped = frame.groupby(["contract_symbol", "session_id", "bucket"], sort=False)
    out = grouped.agg(timestamp=("timestamp", "first"), trading_day=("trading_day", "first"), open=("open", "first"),
                      high=("high", "max"), low=("low", "min"), close=("close", "last"), volume=("volume", "sum")).reset_index()
    out = out.sort_values("timestamp").reset_index(drop=True)
    out["bars_since_session_break"] = out.groupby(["contract_symbol", "session_id"]).cumcount()
    return out


def describe(frame: pd.DataFrame) -> pd.DataFrame:
    """Causal per-bar conditions: each bar against the 20 bars before it, inside its contract."""
    out = frame.copy()
    body = (out["close"] - out["open"]).abs()
    span = out["high"] - out["low"]
    upper = out["high"] - out[["open", "close"]].max(axis=1)
    lower = out[["open", "close"]].min(axis=1) - out["low"]
    by_contract = out.groupby("contract_symbol", sort=False)
    trailing_volume = by_contract["volume"].transform(lambda s: s.shift(1).rolling(TRAILING_BARS, min_periods=TRAILING_BARS).mean())
    trailing_range = span.groupby(out["contract_symbol"], sort=False).transform(
        lambda s: s.shift(1).rolling(TRAILING_BARS, min_periods=TRAILING_BARS).mean())
    with np.errstate(divide="ignore", invalid="ignore"):
        relative_volume = out["volume"] / trailing_volume
        relative_range = span / trailing_range
    out["relative_volume"] = pd.cut(relative_volume.where(trailing_volume > 0), BUCKET_EDGES, labels=BUCKET_LABELS, right=False)
    out["relative_range"] = pd.cut(relative_range.where(trailing_range > 0), BUCKET_EDGES, labels=BUCKET_LABELS, right=False)
    shape = np.select(
        [span <= 0, body <= 0.10 * span, (lower > 2 * body) & (lower > upper), upper > 2 * body, body >= 0.70 * span],
        ["no_range", "doji", "lower_rejection", "upper_rejection", "large_body"], default="ordinary")
    out["shape"] = shape
    out["direction"] = np.select([out["close"] > out["open"], out["close"] < out["open"]], ["rising", "falling"], default="flat")
    new_york = out["timestamp"].dt.tz_convert("America/New_York")
    minute = new_york.dt.hour * 60 + new_york.dt.minute
    out["session"] = np.where((minute >= 9 * 60 + 30) & (minute < 16 * 60), "regular", "extended")
    out["split"] = np.where(out["timestamp"] < DISCOVERY_END, "discovery", "confirmation")
    for h in HORIZONS:
        later = by_contract["close"].shift(-h)
        same_session = by_contract["bars_since_session_break"].shift(-h) >= h
        move = ((later - out["close"]) / TICK).where(same_session)
        out[f"move_{h}"] = move
    return out


def _cluster_stats(frame: pd.DataFrame, keys: list[str], value: str, base: float | None) -> pd.DataFrame:
    """Per cell: count, mean of (value - base) and its trading-day-clustered standard error."""
    z = frame[value] - (base if base is not None else 0.0)
    work = frame[keys + ["trading_day"]].copy()
    work["z"] = z
    daily = work.groupby(keys + ["trading_day"], observed=True)["z"].agg(["sum", "count"]).reset_index()
    daily["sum_sq"] = daily["sum"] ** 2
    daily["n_sum"] = daily["count"] * daily["sum"]
    daily["n_sq"] = daily["count"] ** 2
    cell = daily.groupby(keys, observed=True).agg(n=("count", "sum"), total=("sum", "sum"), sum_sq=("sum_sq", "sum"),
                                                  n_sum=("n_sum", "sum"), n_sq=("n_sq", "sum"), days=("count", "size")).reset_index()
    mean = cell["total"] / cell["n"]
    within = cell["sum_sq"] - 2 * mean * cell["n_sum"] + mean ** 2 * cell["n_sq"]
    correction = cell["days"] / (cell["days"] - 1).clip(lower=1)
    cell["mean"] = mean
    cell["standard_error"] = np.sqrt((within * correction).clip(lower=0)) / cell["n"]
    return cell[keys + ["n", "mean", "standard_error", "days"]]


def wilson(up: np.ndarray, n: np.ndarray, z: float = 1.959964) -> tuple[np.ndarray, np.ndarray]:
    with np.errstate(divide="ignore", invalid="ignore"):
        p = up / n
        centre = (p + z * z / (2 * n)) / (1 + z * z / n)
        half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return centre - half, centre + half


def split_statistics(frame: pd.DataFrame, keys: list[str], h: int) -> tuple[pd.DataFrame, dict]:
    move = f"move_{h}"
    valid = frame[frame[move].notna()].copy()
    moved = valid[valid[move] != 0].copy()
    moved["up"] = (moved[move] > 0).astype(float)
    base = float(moved["up"].mean())
    base_move = float(valid[move].mean())
    direction = _cluster_stats(moved, keys, "up", base).rename(columns={"n": "moved_count", "mean": "lift", "standard_error": "lift_standard_error"})
    ups = moved.groupby(keys, observed=True)["up"].sum().rename("up_count").reset_index()
    size = _cluster_stats(valid, keys, move, None).rename(columns={"n": "event_count", "mean": "mean_move_ticks",
                                                                     "standard_error": "mean_move_standard_error", "days": "trading_days"})
    absolute = valid.assign(absolute_move=valid[move].abs()).groupby(keys, observed=True)["absolute_move"].mean().rename("mean_absolute_move_ticks").reset_index()
    out = size.merge(direction.drop(columns=["days"]), on=keys, how="left").merge(ups, on=keys, how="left").merge(absolute, on=keys, how="left")
    out["up_share_percent"] = out["up_count"] / out["moved_count"] * 100
    low, high = wilson(out["up_count"].to_numpy(float), out["moved_count"].to_numpy(float))
    out["up_share_low_percent"], out["up_share_high_percent"] = low * 100, high * 100
    out["base_up_share_percent"] = base * 100
    out["lift_percentage_points"] = out["lift"] * 100
    with np.errstate(divide="ignore", invalid="ignore"):
        out["lift_z"] = out["lift"] / out["lift_standard_error"]
        out["move_z"] = (out["mean_move_ticks"] - base_move) / out["mean_move_standard_error"]
    out["base_mean_move_ticks"] = base_move
    return out.drop(columns=["lift", "lift_standard_error"]), {"base_up_share_percent": base * 100, "base_mean_move_ticks": base_move,
                                                               "moved_count": int(len(moved)), "event_count": int(len(valid))}


def benjamini_hochberg(p: np.ndarray) -> np.ndarray:
    q = np.full_like(p, np.nan, dtype=float)
    ok = ~np.isnan(p)
    values = p[ok]
    order = np.argsort(values)
    ranked = values[order] * len(values) / np.arange(1, len(values) + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1].clip(max=1)
    out = np.empty_like(values)
    out[order] = ranked
    q[ok] = out
    return q


def compute(bars: pd.DataFrame) -> dict[str, pd.DataFrame]:
    cost = round_trip_ticks()
    rows, baselines = [], []
    for timeframe, minutes in TIMEFRAMES.items():
        described = describe(resample(bars, minutes))
        for h in HORIZONS:
            for family, keys in FAMILIES.items():
                parts = {}
                for split in ("discovery", "confirmation"):
                    table, base = split_statistics(described[described["split"] == split], keys, h)
                    parts[split] = table.set_index(keys).add_prefix(f"{split}_")
                    if family == "direction":
                        baselines.append({"timeframe": timeframe, "horizon_bars": h, "split": split, **base})
                full, base = split_statistics(described, keys, h)
                if family == "direction":
                    baselines.append({"timeframe": timeframe, "horizon_bars": h, "split": "full", **base})
                merged = full.set_index(keys).add_prefix("full_").join(parts["discovery"], how="left").join(parts["confirmation"], how="left").reset_index()
                labelled = pd.DataFrame({k: LABEL_PREFIX[k] + merged[k].astype(str).str.replace("_", " ") for k in keys})
                merged["condition"] = labelled.agg(" & ".join, axis=1)
                for key in ("relative_volume", "relative_range", "shape", "direction", "session"):
                    merged[key] = merged[key].astype(str) if key in keys else "any"
                merged.insert(0, "family", family)
                merged.insert(0, "horizon_bars", h)
                merged.insert(0, "timeframe", timeframe)
                rows.append(merged)
    edges = pd.concat(rows, ignore_index=True)
    enough = (edges["discovery_moved_count"] >= MINIMUM_DISCOVERY) & (edges["confirmation_moved_count"] >= MINIMUM_CONFIRMATION)
    p_discovery = 2 * stats.norm.sf(edges["discovery_lift_z"].abs())
    edges["discovery_p_value"] = np.where(enough, p_discovery, np.nan)
    edges["discovery_q_value"] = benjamini_hochberg(edges["discovery_p_value"].to_numpy(float))
    sign = np.sign(edges["discovery_lift_percentage_points"])
    edges["favoured_direction"] = np.where(sign > 0, "up", np.where(sign < 0, "down", "none"))
    edges["confirmation_p_value_one_sided"] = stats.norm.sf(sign * edges["confirmation_lift_z"])
    trade_sign = np.sign(edges["discovery_mean_move_ticks"] - edges["discovery_base_mean_move_ticks"]).replace(0, 1)
    trade_sign = np.where(sign != 0, sign, trade_sign)
    edges["confirmation_gross_ticks_per_trade"] = trade_sign * edges["confirmation_mean_move_ticks"]
    edges["confirmation_net_ticks_per_trade"] = edges["confirmation_gross_ticks_per_trade"] - cost
    edges["round_trip_cost_ticks"] = cost
    discovered = enough & (edges["discovery_q_value"] < FALSE_DISCOVERY_RATE)
    confirmed = discovered & (edges["confirmation_p_value_one_sided"] < CONFIRMATION_P)
    edges["verdict"] = np.select(
        [~enough, confirmed & (edges["confirmation_net_ticks_per_trade"] > 0), confirmed, discovered],
        ["too few events", "edge after costs", "real but smaller than costs", "not confirmed out of sample"], default="no edge")
    edges = edges.sort_values(["timeframe", "horizon_bars", "family", "condition"]).reset_index(drop=True)
    definitions = pd.DataFrame([
        {"name": "source", "value": "derived_mnq_next_candles_1m, MNQ front contract, true UTC"},
        {"name": "first_bar", "value": str(bars["timestamp"].min())},
        {"name": "last_bar", "value": str(bars["timestamp"].max())},
        {"name": "discovery_span", "value": "2021-01-01 to 2023-12-31"},
        {"name": "confirmation_span", "value": "2024-01-01 to 2025-06-30"},
        {"name": "trailing_window_bars", "value": str(TRAILING_BARS)},
        {"name": "relative_buckets", "value": ", ".join(BUCKET_LABELS)},
        {"name": "shape_rules", "value": "doji body<=10% range; lower_rejection lower wick>2x body and > upper wick; upper_rejection upper wick>2x body; large_body body>=70% range; else ordinary"},
        {"name": "regular_session", "value": "09:30-16:00 America/New_York"},
        {"name": "horizons_bars", "value": ", ".join(map(str, HORIZONS))},
        {"name": "round_trip_cost_ticks", "value": f"{cost:.2f}"},
        {"name": "false_discovery_rate", "value": str(FALSE_DISCOVERY_RATE)},
        {"name": "confirmation_p_value_one_sided", "value": str(CONFIRMATION_P)},
        {"name": "minimum_moved_events", "value": f"discovery {MINIMUM_DISCOVERY}, confirmation {MINIMUM_CONFIRMATION}"},
        {"name": "standard_errors", "value": "clustered by CME trading day"},
        {"name": "cells_tested", "value": str(int(enough.sum()))},
    ])
    return {"edges": edges, "baselines": pd.DataFrame(baselines), "definitions": definitions}


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    return arrow_fs().get_file_info(arrow_key(derived_root(DATASET, RECIPE))).type != FileType.NotFound


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="compute and print; land nothing")
    arguments = parser.parse_args()
    bars = load(with_patterns=False)
    tables = compute(bars)
    edges = tables["edges"]
    print(f"bars: {len(bars):,}; cells: {len(edges):,}")
    print(edges["verdict"].value_counts().to_string())
    show = ["timeframe", "horizon_bars", "condition", "full_event_count", "full_up_share_percent", "full_base_up_share_percent",
            "confirmation_net_ticks_per_trade", "discovery_q_value", "verdict"]
    print(edges[edges["verdict"].isin(["edge after costs", "real but smaller than costs"])][show].head(40).to_string(index=False))
    if arguments.dry_run:
        return 0
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    with tempfile.TemporaryDirectory(prefix="study_conditional_edges_") as directory:
        paths = {}
        for name, table in tables.items():
            paths[name] = os.path.join(directory, f"{name}.parquet")
            table.to_parquet(paths[name], index=False)
        result = land(paths, RECIPE, "derived_mnq_next_candles_1m 2021-01..2025-06 (study conditional-edges build.py)", dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
