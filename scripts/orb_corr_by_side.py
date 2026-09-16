"""Correlation by side — LONG vs SHORT separately."""

import json
import os

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(SCRIPT_DIR + "/orb_analysis_results.csv")

indicators = [
    ("ATRr_14", "ATR"),
    ("ADX_14", "ADX"),
    ("rsi", "RSI"),
    ("roc", "ROC"),
    ("mom", "Momentum"),
    ("MACD_12_26_9", "MACD"),
    ("MACDh_12_26_9", "MACD Hist"),
    ("MACDs_12_26_9", "MACD Signal"),
    ("cci", "CCI"),
    ("willr", "Williams %R"),
    ("bb_width", "BB Width"),
    ("bb_pct_b", "BB %B"),
    ("vol_ratio", "Vol Ratio"),
    ("clv", "CLV"),
    ("natr", "NATR"),
    ("mfi", "MFI"),
    ("STOCHk_14_3_3", "Stoch %K"),
    ("STOCHd_14_3_3", "Stoch %D"),
    ("DMP_14", "DM+"),
    ("DMN_14", "DM-"),
    ("AROONOSC_25", "Aroon Osc"),
    ("range_width", "Range Width"),
]

indicators = [(c, n) for c, n in indicators if c in df.columns]

print(
    f"{'Indicator':<16} | {'ALL r':>7} | {'LONG r':>7} ({'n':>3}) | {'SHORT r':>7} ({'n':>3}) | Notes"
)
print("-" * 100)

for col, name in indicators:
    all_v = df[[col, "mfe"]].dropna()
    long_v = df[df["side"] == "LONG"][[col, "mfe"]].dropna()
    short_v = df[df["side"] == "SHORT"][[col, "mfe"]].dropna()

    r_all = all_v[col].corr(all_v["mfe"])
    r_long = long_v[col].corr(long_v["mfe"]) if len(long_v) >= 10 else np.nan
    r_short = short_v[col].corr(short_v["mfe"]) if len(short_v) >= 10 else np.nan

    # Note interpretation
    note = ""
    if abs(r_long - r_short) > 0.2:
        if r_long > r_short:
            note = "stronger for LONG"
        else:
            note = "stronger for SHORT"
    if (r_long > 0 and r_short < 0) or (r_long < 0 and r_short > 0):
        note = "OPPOSITE DIRECTION by side"

    print(
        f"{name:<16} | {r_all:>+7.3f} | {r_long:>+7.3f} ({len(long_v):>3}) | {r_short:>+7.3f} ({len(short_v):>3}) | {note}"
    )

# Also do correlation with end_excursion by side
print(f"\n\n--- r vs END EXCURSION (positive = price stayed in breakout direction) ---")
print(f"{'Indicator':<16} | {'ALL r':>7} | {'LONG r':>7} | {'SHORT r':>7} | Notes")
print("-" * 90)

for col, name in indicators:
    all_v = df[[col, "end_excursion"]].dropna()
    long_v = df[df["side"] == "LONG"][[col, "end_excursion"]].dropna()
    short_v = df[df["side"] == "SHORT"][[col, "end_excursion"]].dropna()

    r_all = all_v[col].corr(all_v["end_excursion"])
    r_long = long_v[col].corr(long_v["end_excursion"]) if len(long_v) >= 10 else np.nan
    r_short = short_v[col].corr(short_v["end_excursion"]) if len(short_v) >= 10 else np.nan

    note = ""
    if (r_long > 0 and r_short < 0) or (r_long < 0 and r_short > 0):
        note = "OPPOSITE DIRECTION by side"

    print(f"{name:<16} | {r_all:>+7.3f} | {r_long:>+7.3f} | {r_short:>+7.3f} | {note}")

# Save all correlations to JSON
output = {"mfe_correlations": {}, "end_excursion_correlations": {}}
for col, name in indicators:
    for target, key in [
        ("mfe", "mfe_correlations"),
        ("end_excursion", "end_excursion_correlations"),
    ]:
        all_v = df[[col, target]].dropna()
        long_v = df[df["side"] == "LONG"][[col, target]].dropna()
        short_v = df[df["side"] == "SHORT"][[col, target]].dropna()
        r_all = float(all_v[col].corr(all_v[target]))
        r_long = float(long_v[col].corr(long_v[target])) if len(long_v) >= 10 else None
        r_short = float(short_v[col].corr(short_v[target])) if len(short_v) >= 10 else None
        opposite = (
            r_long is not None
            and r_short is not None
            and ((r_long > 0 and r_short < 0) or (r_long < 0 and r_short > 0))
        )
        output[key][name] = {
            "column": col,
            "r_all": round(r_all, 4),
            "r_long": round(r_long, 4) if r_long else None,
            "r_short": round(r_short, 4) if r_short else None,
            "n_long": len(long_v),
            "n_short": len(short_v),
            "opposite_by_side": opposite,
        }

json_path = os.path.join(SCRIPT_DIR, "orb_correlations_by_side.json")
with open(json_path, "w") as f:
    json.dump(output, f, indent=2)
print(f"\nSaved: {json_path}")
