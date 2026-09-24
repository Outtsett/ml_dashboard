"""Write the textbook candlestick drawings the chart's pattern hover card shows.

Input is a JSON list of templates, one per pattern and direction: the bars
before the pattern (which set TA-Lib's trailing averages and show the prior
trend) and the pattern's own bars. Output is src/shared/candlePatternTemplates.json,
which the client imports.

Nothing is written unless EVERY template, run through the real TA-Lib the chart
uses, fires with its expected value on its last bar. A drawing that TA-Lib would
not mark is not a picture of that pattern, whatever it looks like.

    .venv/Scripts/python.exe scripts/build_candle_pattern_templates.py <templates.json>

The directions each pattern can fire in are read from
datalake/scripts/talib_candlestick_rules.json and copied into the output, so the
client test can check coverage without reaching into another repository.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import talib

REPOSITORY = Path(__file__).resolve().parent.parent
OUTPUT = REPOSITORY / "src" / "shared" / "candlePatternTemplates.json"
RULES = REPOSITORY.parent / "datalake" / "scripts" / "talib_candlestick_rules.json"

# TA-Lib emits +100 for these as a flag ("it fired"), not as "bullish".
UNDIRECTED = {"doji", "dragonflydoji", "gravestonedoji", "longleggeddoji", "rickshawman", "takuri"}


def required_directions(rules: list[dict]) -> dict[str, list[str]]:
    """Directions TA-Lib can emit per pattern, from the rules' emitted_values."""
    out: dict[str, list[str]] = {}
    for rule in rules:
        name = rule["talib_function"][3:].lower()
        emitted = rule["emitted_values"]
        if name in UNDIRECTED:
            out[name] = ["neutral"]
        elif re.search(r"-100 only", emitted):
            out[name] = ["bearish"]
        elif re.search(r"\+100 only", emitted):
            out[name] = ["bullish"]
        else:
            out[name] = ["bullish", "bearish"]
    return out


# TA-Lib's source and the candlestick literature say "white" and "black" candles.
# This chart draws rising candles orange and falling ones blue, so those words
# name colours that are not on screen. They become "up" and "down", except inside
# the pattern names that use them ("black crows", "white soldiers").
_COLOUR_WORD = re.compile(r"\b(?:(an?)\s+)?(white|black)\b(?!\s+(?:crows?|soldiers?))", re.IGNORECASE)


def chart_words(text: str) -> str:
    def replace(match: re.Match) -> str:
        article, colour = match.group(1), match.group(2)
        word = "up" if colour.lower() == "white" else "down"
        if colour[0].isupper() and not article:
            word = word.capitalize()
        if article:
            fixed = "an" if word == "up" else "a"
            return (fixed.capitalize() if article[0].isupper() else fixed) + " " + word
        return word

    return _COLOUR_WORD.sub(replace, text)


def run_talib(function: str, bars: list[list[float]]) -> np.ndarray:
    array = np.asarray(bars, dtype=np.float64)
    return getattr(talib, function)(array[:, 0], array[:, 1], array[:, 2], array[:, 3])


def check(template: dict) -> list[str]:
    """Every reason this template cannot be shipped; empty when it can."""
    problems = []
    bars = template["context"] + template["pattern_bars"]
    for i, (open_, high, low, close) in enumerate(bars):
        if not (low <= min(open_, close) <= max(open_, close) <= high):
            problems.append(f"bar {i} is not a valid candle: {bars[i]}")
    output = run_talib(template["talib_function"], bars)
    if int(output[-1]) != int(template["expected_value"]):
        problems.append(f"TA-Lib gives {int(output[-1])} on the last bar, expected {template['expected_value']}")
    if len(template["candle_captions"]) != len(template["pattern_bars"]):
        problems.append("one caption per pattern bar is required")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("templates", type=Path)
    args = parser.parse_args()

    templates = json.loads(args.templates.read_text(encoding="utf-8"))
    rules = json.loads(RULES.read_text(encoding="utf-8"))["patterns"]
    required = required_directions(rules)

    failures = {f"{t['pattern']}/{t['direction']}": check(t) for t in templates}
    failures = {key: problems for key, problems in failures.items() if problems}
    have = {(t["pattern"], t["direction"]) for t in templates}
    missing = [f"{name}/{d}" for name, ds in required.items() for d in ds if (name, d) not in have]

    for key, problems in failures.items():
        print(f"FAIL {key}: {'; '.join(problems)}", file=sys.stderr)
    for key in missing:
        print(f"MISSING {key}", file=sys.stderr)
    if failures or missing:
        return 1

    keep = ("pattern", "talib_function", "expected_value", "direction", "context", "pattern_bars",
            "candle_captions", "reading")
    ordered = sorted(templates, key=lambda t: (t["pattern"], t["direction"]))
    for template in ordered:
        template["candle_captions"] = [chart_words(c) for c in template["candle_captions"]]
        template["reading"] = chart_words(template["reading"])
    document = {
        "description": "Textbook OHLC drawings of the 61 TA-Lib candlestick patterns, one per direction each "
                       "can fire in. Every template makes TA-Lib emit expected_value on its last bar; "
                       "tests/test_candle_pattern_templates.py re-checks that. Built by "
                       "scripts/build_candle_pattern_templates.py.",
        "talib_version": talib.__version__,
        "required_directions": dict(sorted(required.items())),
        "templates": [{key: t[key] for key in keep} for t in ordered],
    }
    OUTPUT.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(ordered)} templates for {len(required)} patterns to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
