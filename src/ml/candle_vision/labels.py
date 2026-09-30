"""TA-Lib's 61 candlestick patterns as 88 (pattern, direction) classes.

The class list is the dashboard's own: ``src/shared/candlePatternTemplates.json`` names every
direction each pattern can fire in (61 patterns -> 88 drawings). A bar's label is TA-Lib 0.8.1's
verdict on that bar: class ``<pattern>:bullish`` is on when the function returns > 0 (100, or 200
for a confirmed hikkake), ``<pattern>:bearish`` when it returns < 0, and ``<pattern>:neutral`` (the six
doji-family patterns, which always return +100) whenever it fires.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import talib

TEMPLATES = Path(__file__).resolve().parents[2] / "shared" / "candlePatternTemplates.json"


def load_templates() -> dict:
    return json.loads(TEMPLATES.read_text(encoding="utf-8"))


def pattern_functions() -> list[str]:
    """The 61 TA-Lib function names in the order ``talib`` lists them."""
    return list(talib.get_function_groups()["Pattern Recognition"])


def class_list() -> list[tuple[str, str, str]]:
    """[(class name, TA-Lib function, direction)], e.g. ('3inside:bullish', 'CDL3INSIDE', 'bullish')."""
    functions = {name[3:].lower(): name for name in pattern_functions()}
    out = []
    for pattern, directions in load_templates()["required_directions"].items():
        for direction in directions:
            out.append((f"{pattern}:{direction}", functions[pattern], direction))
    return out


def talib_values(o: np.ndarray, h: np.ndarray, l: np.ndarray, c: np.ndarray) -> np.ndarray:
    """(N, 61) int16: each TA-Lib pattern function on the series, in ``pattern_functions()`` order."""
    args = [np.ascontiguousarray(x, dtype=np.float64) for x in (o, h, l, c)]
    return np.stack([getattr(talib, name)(*args) for name in pattern_functions()], 1).astype(np.int16)


def to_classes(values: np.ndarray) -> np.ndarray:
    """(N, 61) TA-Lib values -> (N, 88) uint8 multi-hot over ``class_list()``."""
    index = {name: k for k, name in enumerate(pattern_functions())}
    classes = class_list()
    out = np.zeros((len(values), len(classes)), dtype=np.uint8)
    for j, (_, function, direction) in enumerate(classes):
        column = values[:, index[function]]
        out[:, j] = {"bullish": column > 0, "bearish": column < 0, "neutral": column != 0}[direction]
    return out
