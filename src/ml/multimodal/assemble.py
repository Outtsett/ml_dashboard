"""One way to build a feature block, shared by the development tables (scripts/multimodal/build_features.py)
and the gate's in-memory holdout build (gate.build_period), so the two cannot drift.

Coverage rules live here: the calendar is NaN before the sourced calendar begins, the news block is NaN
on any bar whose trailing 24 hours reach a UTC day whose news did not land complete and scored.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from multimodal import features, sources
from multimodal.data import DecisionBars, Minutes

CROSS_ROOTS = ("ES", "RTY", "YM")
DAILY_SYMBOLS = ["ZN", "ZB", "ZT", "GC", "HG", "DXY"]


def block_frame(block: str, bars: DecisionBars, minutes: Minutes, start: str, end: str, root: str = "MNQ") -> pd.DataFrame:
    """The columns of one block for every 5-minute RTH bar of `bars` (read window [start, end))."""
    if block == "time":
        return features.time_block(bars)
    if block == "price":
        return features.price_block(bars)
    if block == "flow":
        return features.flow_block(bars, sources.flow_minutes(start, end, root=root))
    if block == "cross":
        others = {r: sources.other_minutes(r, start, end) for r in CROSS_ROOTS}
        return features.cross_block(bars, others, sources.daily_closes(DAILY_SYMBOLS))
    if block == "context":
        return features.context_block(bars, minutes)
    if block == "calendar":
        coverage_session = int(pd.Timestamp(sources.CALENDAR_COVERAGE_START).timestamp() // 86400)
        return features.calendar_block(bars, sources.calendar_events(), coverage_start_session=coverage_session)
    if block == "news":
        news_start = (pd.Timestamp(start) - pd.Timedelta(days=2)).strftime("%Y-%m-%d")
        news_end = (pd.Timestamp(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        decision_close_utc = sources.stamp_to_utc_seconds(bars.frame["timestamp"].to_numpy() + 60 * 5)
        return features.news_block(bars, sources.gdelt_news(news_start, news_end), sources.finbert_headlines(news_start, news_end),
                                   covered_days=sources.news_coverage(news_start, news_end), decision_close_utc=decision_close_utc)
    raise ValueError(f"unknown block {block!r}")


def sequence_frame(bars: DecisionBars, block_frames: dict[str, pd.DataFrame], columns: tuple[str, ...]) -> tuple[np.ndarray, tuple[str, ...]]:
    """Every 5-minute RTH bar's sequence channels (the dataset's SEQUENCE_COLUMNS that the blocks provide)."""
    merged = pd.concat([frame for frame in block_frames.values()], axis=1)
    present = tuple(c for c in columns if c in merged.columns)
    return merged[list(present)].to_numpy(np.float32), present
