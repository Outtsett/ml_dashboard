"""Feature-family mapping — the Python mirror of the TypeScript contract.

``LENS_FAMILY_CATEGORIES`` and ``LENS_FAMILY_LABELS`` are copied verbatim from
``packages/shared/src/lens/types.ts``. ``packages/ml-engine/tests/test_lens.py`` parses the TypeScript
source and asserts both dictionaries still equal it, so a drift on either side
fails the suite instead of silently mislabelling an attribution legend.
"""

from __future__ import annotations

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]

LENS_FAMILY_CATEGORIES: dict[str, list[str]] = {
    "momentum": ["returns", "momentum", "ma_distance"],
    "volatility": ["volatility", "parkinson"],
    "volume": ["volume"],
    "price_structure": ["price_structure", "anatomy", "microstructure", "swing", "mean_reversion"],
    "macro": [],
}

LENS_FAMILY_LABELS: dict[str, str] = {
    "momentum": "Momentum",
    "volatility": "Volatility",
    "volume": "Volume",
    "price_structure": "Price structure",
    "macro": "Macro",
}

FAMILY_ORDER: tuple[str, ...] = ("momentum", "volatility", "volume", "price_structure", "macro")

#: Family assigned to a feature whose registry category maps to no family.
UNMAPPED_FAMILY = "macro"


def category_to_family() -> dict[str, str]:
    """Invert LENS_FAMILY_CATEGORIES into {features.json category: family key}."""
    out: dict[str, str] = {}
    for family, categories in LENS_FAMILY_CATEGORIES.items():
        for category in categories:
            out[category] = family
    return out


def feature_categories(features_json_path: Path | None = None) -> dict[str, str]:
    """Read packages/config/features.json into {feature name: registry category}."""
    path = features_json_path or (PROJECT_ROOT / "src" / "config" / "features.json")
    registry = json.loads(path.read_text(encoding="utf-8"))
    return {entry["name"]: entry["category"] for entry in registry["features"]}


def assign_families(
    feature_names: list[str],
    features_json_path: Path | None = None,
) -> tuple[list[str], list[dict], list[str]]:
    """Map each feature to its family.

    Returns ``(families_per_feature, family_blocks, unmapped_feature_names)``
    where ``family_blocks`` is the ``LensFeatureFamily[]`` the manifest carries,
    always all five families in a fixed order (``macro`` is usually empty).
    """
    name_to_category = feature_categories(features_json_path)
    cat_to_family = category_to_family()

    per_feature: list[str] = []
    unmapped: list[str] = []
    for name in feature_names:
        category = name_to_category.get(name)
        family = cat_to_family.get(category) if category else None
        if family is None:
            family = UNMAPPED_FAMILY
            unmapped.append(name)
        per_feature.append(family)

    blocks: list[dict] = []
    for family in FAMILY_ORDER:
        members = [n for n, f in zip(feature_names, per_feature) if f == family]
        blocks.append(
            {
                "family": family,
                "label": LENS_FAMILY_LABELS[family],
                "features": members,
                "sourceCategories": list(LENS_FAMILY_CATEGORIES[family]),
            }
        )
    return per_feature, blocks, unmapped
