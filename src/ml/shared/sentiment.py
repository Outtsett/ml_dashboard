"""The dashboard's handle on ``lake.sentiment`` — the mandatory FinBERT family.

The implementation (the causal rule, the columns, the clocks) lives in the
datalake package so every repository computes it the same way; read its module
docstring. This adapter only makes the dashboard's trainers share one DuckDB
connection over the lake (``shared.data._serving``) with it.
"""

from __future__ import annotations

from lake import sentiment as _impl
from lake.sentiment import (  # noqa: F401 - re-exported for the dashboard's trainers and tests
    DISPLAY_NAMES,
    FAMILY_PREFIX,
    FEATURE_NAMES,
    FEATURE_VERSION,
    MODEL,
    PACIFIC,
    UTC,
    ArticleStream,
    bar_open_utc,
    clock_for,
    collapse_rows,
    compute_from_stream,
    is_finbert_column,
    merge_spans,
    root_of,
    timeframe_minutes,
    to_epoch_seconds,
)


def _share_connection() -> None:
    if _impl._CONNECTION is None:
        from .data import _serving

        _impl.set_connection(_serving())


def finbert_features(symbol, timestamps, *, timeframe=None, clock=UTC, stream=None):
    _share_connection()
    return _impl.finbert_features(symbol, timestamps, timeframe=timeframe, clock=clock, stream=stream)


def load_stream(root: str, start_utc: float, end_utc: float) -> ArticleStream:
    _share_connection()
    return _impl.load_stream(root, start_utc, end_utc)


def asset_class_of(symbol: str) -> str:
    _share_connection()
    return _impl.asset_class_of(symbol)


def infer_clock(symbol: str) -> str:
    _share_connection()
    return _impl.infer_clock(symbol)


def data_version() -> str:
    return _impl.data_version()
