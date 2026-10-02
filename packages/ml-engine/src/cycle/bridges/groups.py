"""Feature columns grouped by what they measure.

Families that treat the feature row as several "views" or "modalities"
(co-training, multi-modal encoders, dual decomposition, graph nodes) group the
columns of the run's feature matrix by the ``category`` each feature has in
``packages/config/features.json``, and the categories into five modalities:

    price_geometry          returns, momentum, moving-average distance, bar anatomy,
                            price structure, mean reversion
    volume_and_order_flow   volume, microstructure (order-book imbalance, absorption, swings)
    volatility              volatility, Parkinson range volatility
    calendar                time of day and day of week (``calendar_channels``; not
                            feature columns: computed from the bar timestamps)
    finbert                 the nine ``finbert_*`` news-sentiment columns

A column the registry does not know (a test's planted feature) belongs to the
group ``other``. Grouping reads names only, never values, so it cannot leak.
``calendar_channels`` reads the bar's own timestamp: causal.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

FEATURES_CONFIG = Path(__file__).resolve().parents[3] / "config" / "features.json"
OTHER = "other"
FINBERT = "finbert"
CALENDAR = "calendar"

CATEGORY_MODALITY = {
    "returns": "price_geometry",
    "momentum": "price_geometry",
    "ma_distance": "price_geometry",
    "anatomy": "price_geometry",
    "price_structure": "price_geometry",
    "mean_reversion": "price_geometry",
    "volume": "volume_and_order_flow",
    "microstructure": "volume_and_order_flow",
    "volatility": "volatility",
    "parkinson": "volatility",
    "sentiment": FINBERT,
}
MODALITIES = ("price_geometry", "volume_and_order_flow", "volatility", CALENDAR, FINBERT)


@lru_cache(maxsize=1)
def _categories() -> dict[str, str]:
    document = json.loads(FEATURES_CONFIG.read_text(encoding="utf-8"))
    return {definition["name"]: definition.get("category") or OTHER for definition in document["features"]}


def feature_category(name: str) -> str:
    """The name's ``features.json`` category; ``sentiment`` for any ``finbert_*``; else ``other``."""
    if name.startswith("finbert_"):
        return "sentiment"
    return _categories().get(name, OTHER)


def feature_modality(name: str) -> str:
    return CATEGORY_MODALITY.get(feature_category(name), OTHER)


def _group(names, key) -> dict[str, list[int]]:
    groups: dict[str, list[int]] = {}
    for column, name in enumerate(names):
        groups.setdefault(key(str(name)), []).append(column)
    return groups


def category_groups(names) -> dict[str, list[int]]:
    """{category: column indices} in first-seen order."""
    return _group(names, feature_category)


def modality_groups(names) -> dict[str, list[int]]:
    """{modality: column indices}; ``calendar`` never appears (it has no columns)."""
    return _group(names, feature_modality)


def finbert_columns(names) -> list[int]:
    return [column for column, name in enumerate(names) if str(name).startswith("finbert_")]


def calendar_channels(timestamps) -> np.ndarray:
    """float32 (n, 4): sine and cosine of the time of day and of the day of the
    week, from each bar's own timestamp (epoch seconds, as the lake stamps it)."""
    seconds = np.asarray(timestamps, dtype=np.int64)
    day = (seconds % 86400) / 86400.0
    week = ((seconds // 86400 + 3) % 7) / 7.0      # 1970-01-01 was a Thursday: Monday = 0
    return np.column_stack([np.sin(2 * np.pi * day), np.cos(2 * np.pi * day),
                            np.sin(2 * np.pi * week), np.cos(2 * np.pi * week)]).astype(np.float32)


def split_views(names, view_count: int, seed: int) -> list[list[int]]:
    """``view_count`` disjoint column sets: the modality groups when there are
    at least that many non-empty ones (merged smallest-first down to
    ``view_count``), else a seeded random split of the columns."""
    groups = [columns for columns in modality_groups(names).values() if columns]
    if len(groups) >= view_count:
        groups = sorted(groups, key=len)
        while len(groups) > view_count:
            first, second = groups.pop(0), groups.pop(0)
            groups.append(sorted(first + second))
            groups = sorted(groups, key=len)
        return [sorted(columns) for columns in groups]
    columns = np.random.default_rng(int(seed)).permutation(len(list(names)))
    return [sorted(int(c) for c in part) for part in np.array_split(columns, view_count) if part.size]


__all__ = ["CALENDAR", "CATEGORY_MODALITY", "FINBERT", "MODALITIES", "OTHER", "calendar_channels", "category_groups",
           "feature_category", "feature_modality", "finbert_columns", "modality_groups", "split_views"]
