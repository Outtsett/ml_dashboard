"""Build the canonical TA-Lib feature registry from TA-Lib itself.

The landed table `derived_mnq_talib_1m` names its columns after TA-Lib's own
parameters: `rsi_14`, `macd_12_26_9`, `stoch_slow_k_5_3_0_3_0`. Nothing outside
the builder that made it can predict those names, which is why
`packages/config/feature_extraction.json` matched 6 of 193 columns -- its
`match_prefixes` are pandas-ta spellings (`RSI_14`, `MACDh_`) that the table
never had.

So the name is the expression, not the parameterization: `rsi`, `macd`,
`stoch_slow_k`, `bbands_upper`. Parameters live in the registry's
`parameters` field, exactly once.

Run:
    E:/source/repos/datalake/.venv/Scripts/python.exe packages/config/build_talib_features.py
"""

from __future__ import annotations

import json
from pathlib import Path

import talib
from talib import abstract

OUTPUT = Path(__file__).resolve().parent / "talib_features.json"

# TA-Lib groups that are arithmetic on operand series rather than indicators.
# They need declared operands and are meaningless on a raw price level
# (ACOS of a 20,000 index is NaN), so they carry `requires_normalized_input`.
OPERATOR_GROUPS = {"Math Operators", "Math Transform"}

# The operand pair each two-input operator takes, by convention: price0 = high,
# price1 = low. Declared here rather than inferred, because TA-Lib's abstract
# defaults are the only thing the builder used and they are not the values a
# feature set should be built on.
OPERAND_PAIRS = {"add": ("high", "low"), "sub": ("high", "low"), "mult": ("high", "low"), "div": ("high", "low")}

# Patterns return an integer count on the bar they fire, never a level.
PATTERN_GROUP = "Pattern Recognition"


def operand_for(function: str) -> list[str]:
    return list(OPERAND_PAIRS.get(function, ("close",)))


# TA-Lib's own output names that read as abbreviations or carry a redundant
# function stem. Everything else takes the name verbatim.
OUTPUT_NAME_OVERRIDE = {
    "macdhist": "histogram",
    "macdsignal": "signal",
    "aroondown": "down",
    "aroonup": "up",
    "upperband": "upper",
    "middleband": "middle",
    "lowerband": "lower",
}


def feature_name(function: str, output: str) -> str:
    """The expression's name, never its parameterization.

    `MACD`'s first output is itself called `macd`, so it takes the bare function
    name; every other output is named after both, e.g. `bbands_upper`,
    `stoch_slowk`, `ht_sine_leadsine`.

    `real` and `integer` are TA-Lib's names for a single unnamed return, not the
    name of a series, so a function returning one is named for the function
    alone: `add`, not `add_real`.
    """
    lowered = function.lower()
    if output in {"real", "integer"}:
        return lowered
    named = OUTPUT_NAME_OVERRIDE.get(output, output)
    return lowered if named == lowered else f"{lowered}_{named}"


def build() -> dict:
    groups = talib.get_function_groups()
    entries = []
    for group in sorted(groups):
        for function in sorted(groups[group]):
            info = abstract.Function(function)
            outputs = [str(name) for name in info.output_names]
            parameters = {str(key): value for key, value in info.parameters.items()}
            is_operator = group in OPERATOR_GROUPS
            # Single-output functions take the function's own name. TA-Lib's
            # `macd` output is already called `macd`, so no suffix is added;
            # only the second and third outputs get named after themselves.
            for output in outputs:
                entries.append(
                    {
                        "name": feature_name(function, output),
                        "talib_function": function,
                        "talib_group": group,
                        "talib_output": output,
                        "kind": (
                            "pattern"
                            if group == PATTERN_GROUP
                            else "operator"
                            if is_operator
                            else "indicator"
                        ),
                        "parameters": parameters,
                        "inputs": operand_for(function.lower()) if is_operator else ["ohlcv"],
                        "requires_normalized_input": is_operator,
                        "bounded": group == "Momentum Indicators" and function in BOUNDED_MOMENTUM,
                    }
                )
    entries.sort(key=lambda entry: (entry["talib_group"], entry["name"]))
    return {
        "version": 1,
        "description": (
            "Every TA-Lib function as one feature. The name is the expression; the parameterization "
            "is in `parameters` and is declared once. No parameter suffix appears in any name."
        ),
        "talib_version": talib.__version__,
        "counts": {
            "functions": len({(e["talib_function"]) for e in entries}),
            "features": len(entries),
            "indicator_features": sum(1 for e in entries if e["kind"] == "indicator"),
            "pattern_features": sum(1 for e in entries if e["kind"] == "pattern"),
            "operator_features": sum(1 for e in entries if e["kind"] == "operator"),
        },
        "features": entries,
    }


# Momentum Indicators whose output is bounded and directly comparable across
# assets. Everything else in the group is a rate that scales with price.
BOUNDED_MOMENTUM = {"RSI", "RSX", "STOCHRSI", "MFI", "WILLR", "ULTOSC", "CMO"}


def main() -> int:
    registry = build()
    OUTPUT.write_text(json.dumps(registry, indent=2) + "\n")
    counts = registry["counts"]
    print(f"wrote {OUTPUT}")
    print(
        f"  {counts['functions']} functions -> {counts['features']} features "
        f"({counts['indicator_features']} indicator, {counts['pattern_features']} pattern, "
        f"{counts['operator_features']} operator)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())