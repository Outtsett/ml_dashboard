"""Samples for the pattern recognizer: 20-bar windows of real MNQ 1-minute bars, labelled by TA-Lib.

* Labels are TA-Lib 0.8.1 (the dashboard's version) recomputed inside each contract on the lake's
  bars; the lake's own 0.7.1 columns are compared with them and the agreement is reported.
* A window ends at the bar it labels and lies inside one contract (its first bar is at least the
  contract's 20th); TA-Lib decides every pattern from the last 15 bars, so the window holds all of it.
* Split by trading day in time order: the first 80 % of days train, the next 10 % validate (early
  stopping, per-class thresholds), the last 10 % test (read once). A window whose first bar falls in
  an earlier split is dropped, so no bar is seen by two splits.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .labels import class_list, pattern_functions, talib_values, to_classes
from .render import WINDOW_BARS

SPLITS = ("train", "validation", "test")


@dataclass
class Samples:
    windows: np.ndarray          # (N, W, 4) float64 prices (open, high, low, close)
    labels: np.ndarray           # (N, K) uint8 over class_list()
    split: np.ndarray            # (N,) int8 index into SPLITS
    synthetic: np.ndarray        # (N,) bool
    end_timestamp: np.ndarray    # (N,) datetime64[ns] of the labelled bar (NaT for synthetic)


def recompute_labels(frame: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    """TA-Lib 0.8.1 values (N, 61), per contract, and their agreement with the lake's 0.7.1 columns."""
    values = np.zeros((len(frame), 61), dtype=np.int16)
    runs = (frame["contract_symbol"] != frame["contract_symbol"].shift()).cumsum().to_numpy()
    o, h, l, c = (frame[k].to_numpy(np.float64) for k in ("open", "high", "low", "close"))
    for run in np.unique(runs):
        rows = np.flatnonzero(runs == run)
        values[rows] = talib_values(o[rows], h[rows], l[rows], c[rows])
    agreement = []
    for j, function in enumerate(pattern_functions()):
        column = "candlestick_" + function[3:].lower()
        if column not in frame:
            continue
        stored = frame[column].to_numpy(np.float64)
        known = ~np.isnan(stored)
        agreement.append({
            "talib_function": function,
            "bars_compared": int(known.sum()),
            "fires_version_0_8_1": int((values[known, j] != 0).sum()),
            "fires_version_0_7_1": int((stored[known] != 0).sum()),
            "disagreeing_bars": int((values[known, j] != stored[known]).sum()),
        })
    return values, pd.DataFrame(agreement)


def split_by_day(frame: pd.DataFrame, fractions: tuple[float, float] = (0.8, 0.1)) -> tuple[np.ndarray, list[dict]]:
    days = np.sort(frame["trading_day"].astype(str).unique())
    first_validation = days[int(len(days) * fractions[0])]
    first_test = days[int(len(days) * (fractions[0] + fractions[1]))]
    day = frame["trading_day"].astype(str).to_numpy()
    split = np.where(day < first_validation, 0, np.where(day < first_test, 1, 2)).astype(np.int8)
    spans = []
    for k, name in enumerate(SPLITS):
        mask = split == k
        spans.append({"split": name, "first_bar": frame["timestamp"][mask].min(), "last_bar": frame["timestamp"][mask].max(),
                      "trading_days": int(len(np.unique(day[mask]))), "bars": int(mask.sum())})
    return split, spans


def real_samples(frame: pd.DataFrame, values: np.ndarray, split: np.ndarray) -> Samples:
    w = WINDOW_BARS
    prices = frame[["open", "high", "low", "close"]].to_numpy(np.float64)
    ends = np.flatnonzero(frame["contract_position"].to_numpy() >= w - 1)
    ends = ends[split[ends - (w - 1)] == split[ends]]
    windows = np.lib.stride_tricks.sliding_window_view(prices, (w, 4))[:, 0][ends - (w - 1)]
    return Samples(
        windows=np.ascontiguousarray(windows),
        labels=to_classes(values[ends]),
        split=split[ends],
        synthetic=np.zeros(len(ends), dtype=bool),
        end_timestamp=frame["timestamp"].dt.tz_localize(None).to_numpy()[ends],
    )


def unseen_directions(values: np.ndarray) -> list[str]:
    """(pattern, direction) pairs TA-Lib emitted that the class list does not name — should be none."""
    named = {(f, d) for _, f, d in class_list()}
    out = []
    for j, function in enumerate(pattern_functions()):
        column = values[:, j]
        for direction, fired in (("bullish", (column > 0).any()), ("bearish", (column < 0).any())):
            if fired and (function, direction) not in named and (function, "neutral") not in named:
                out.append(f"{function}:{direction}")
    return out


def concatenate(parts: list[Samples]) -> Samples:
    return Samples(*(np.concatenate([getattr(p, f) for p in parts]) for f in
                     ("windows", "labels", "split", "synthetic", "end_timestamp")))
