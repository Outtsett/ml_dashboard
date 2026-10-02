"""Color assignment for regime visualization.

Single responsibility: map regime IDs to hex color strings.
"""

from __future__ import annotations

# 20 visually distinct regime colors (Material Design palette)
REGIME_COLORS = [
    "#4CAF50",
    "#2196F3",
    "#FF9800",
    "#E91E63",
    "#9C27B0",
    "#00BCD4",
    "#FFEB3B",
    "#795548",
    "#607D8B",
    "#F44336",
    "#8BC34A",
    "#3F51B5",
    "#FF5722",
    "#009688",
    "#CDDC39",
    "#673AB7",
    "#FFC107",
    "#03A9F4",
    "#FF4081",
    "#00E676",
]


def assign_colors(
    n_regimes: int,
    *,
    palette: list[str] | None = None,
) -> dict[str, str]:
    """Map regime IDs (as strings) to hex colors.

    Cycles through the palette if there are more regimes than colors.

    Args:
        n_regimes: Number of active regimes (0..n_regimes-1).
        palette:   Optional custom color list.  Defaults to REGIME_COLORS.

    Returns:
        Dict mapping ``str(regime_id)`` → ``"#RRGGBB"``.
    """
    if palette is None:
        palette = REGIME_COLORS

    return {str(i): palette[i % len(palette)] for i in range(n_regimes)}
