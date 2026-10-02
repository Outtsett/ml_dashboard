"""Every textbook candlestick drawing the chart shows is one TA-Lib would mark.

The hover card on a pattern arrow compares the candles that fired with a
textbook drawing of the pattern. If that drawing would not itself fire TA-Lib,
the comparison teaches the wrong shape, so each template is run through the
same library the chart's pattern worker uses and must emit its stated value on
its last bar.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

talib = pytest.importorskip("talib")

TEMPLATES = Path(__file__).resolve().parent.parent / "src" / "shared" / "candlePatternTemplates.json"
DOCUMENT = json.loads(TEMPLATES.read_text(encoding="utf-8"))


def _ids(template: dict) -> str:
    return f"{template['pattern']}-{template['direction']}"


@pytest.mark.parametrize("template", DOCUMENT["templates"], ids=_ids)
def test_template_fires_its_own_pattern(template: dict) -> None:
    bars = np.asarray(template["context"] + template["pattern_bars"], dtype=np.float64)
    output = getattr(talib, template["talib_function"])(bars[:, 0], bars[:, 1], bars[:, 2], bars[:, 3])
    assert int(output[-1]) == template["expected_value"]
    sign = int(np.sign(template["expected_value"]))
    if template["direction"] == "bullish":
        assert sign > 0
    elif template["direction"] == "bearish":
        assert sign < 0


def test_every_pattern_and_direction_is_drawn() -> None:
    have = {(t["pattern"], t["direction"]) for t in DOCUMENT["templates"]}
    missing = [
        f"{name}/{direction}"
        for name, directions in DOCUMENT["required_directions"].items()
        for direction in directions
        if (name, direction) not in have
    ]
    assert len(DOCUMENT["required_directions"]) == 61
    assert missing == []
