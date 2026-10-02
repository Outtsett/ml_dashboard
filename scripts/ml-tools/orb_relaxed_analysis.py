"""
Quick re-run with relaxed success criteria: MFE >= 1.0x range, MFE/MAE >= 1.0.
Also checks a profitable-trade definition: end_excursion > 0 (price still in BO direction after 60 min).
"""

import os

import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(SCRIPT_DIR + "/orb_analysis_results.csv")

# Relaxed success: MFE >= 1.0x range AND MFE/MAE >= 1.0
df["success_relaxed"] = (df["mfe_range_ratio"] >= 1.0) & (df["mfe_mae_ratio"] >= 1.0)
# Profitable: end excursion > 0
df["profitable"] = df["end_excursion"] > 0

for label, col in [
    ("Strict (1.5x, 1.5 ratio)", "success"),
    ("Relaxed (1.0x, 1.0 ratio)", "success_relaxed"),
    ("Profitable (end_exc > 0)", "profitable"),
]:
    n = len(df)
    s = int(df[col].sum())
    print(f"\n{label}: {s}/{n} = {s / n * 100:.1f}%")

    # Key filter test
    filters = {
        "Baseline": df,
        "Range<20 + Vol>0.8 + ADX>20": df[
            (df["range_width"] <= 20) & (df["vol_ratio"] >= 0.8) & (df["ADX_14"] >= 20)
        ],
        "Range<20 + Vol>0.8": df[(df["range_width"] <= 20) & (df["vol_ratio"] >= 0.8)],
        "Range<15 + Vol>1.0 + ADX>20": df[
            (df["range_width"] <= 15) & (df["vol_ratio"] >= 1.0) & (df["ADX_14"] >= 20)
        ],
    }

    for fname, fd in filters.items():
        if len(fd) < 5:
            continue
        fs = int(fd[col].sum())
        rate = fs / len(fd) * 100
        mfe = fd["mfe"].mean()
        mae = fd["mae"].mean()
        print(
            f"  {fname:<45} | {fs:>3}/{len(fd):<4} ({rate:>5.1f}%) | MFE {mfe:>5.1f} | MAE {mae:>5.1f} | Net {fd['end_excursion'].mean():>+5.1f}"
        )

# Expectancy analysis
print(f"\n{'=' * 80}")
print("EXPECTANCY ANALYSIS (pts per trade)")
print(f"{'=' * 80}")

filters2 = {
    "All breakouts": df,
    "Range<20": df[df["range_width"] <= 20],
    "Range<20 + Vol>0.8": df[(df["range_width"] <= 20) & (df["vol_ratio"] >= 0.8)],
    "Range<20 + Vol>0.8 + ADX>20": df[
        (df["range_width"] <= 20) & (df["vol_ratio"] >= 0.8) & (df["ADX_14"] >= 20)
    ],
    "Range<15 + Vol>1.0 + ADX>20": df[
        (df["range_width"] <= 15) & (df["vol_ratio"] >= 1.0) & (df["ADX_14"] >= 20)
    ],
    "Range<15 + BB<0.55 + Vol>1.0 + ADX>20": df[
        (df["range_width"] <= 15)
        & (df["bb_width"] <= 0.55)
        & (df["vol_ratio"] >= 1.0)
        & (df["ADX_14"] >= 20)
    ],
}

print(
    f"{'Filter':<50} | {'Trades':>6} | {'Avg End Exc':>10} | {'Med End Exc':>10} | {'Avg MFE':>7} | {'Avg MAE':>7} | {'%Profitable':>11}"
)
print("-" * 120)
for fname, fd in filters2.items():
    if len(fd) < 5:
        continue
    prof = (fd["end_excursion"] > 0).sum() / len(fd) * 100
    print(
        f"{fname:<50} | {len(fd):>6} | {fd['end_excursion'].mean():>+10.2f} | {fd['end_excursion'].median():>+10.2f} | {fd['mfe'].mean():>7.1f} | {fd['mae'].mean():>7.1f} | {prof:>10.1f}%"
    )

# Year-by-year for balanced filter
print(f"\n{'=' * 80}")
print("YEAR-BY-YEAR: Range<20 + Vol>0.8 + ADX>20")
print(f"{'=' * 80}")
filt = df[(df["range_width"] <= 20) & (df["vol_ratio"] >= 0.8) & (df["ADX_14"] >= 20)]
filt = filt.copy()
filt["year"] = pd.to_datetime(filt["date"]).dt.year
for yr in sorted(filt["year"].unique()):
    yd = filt[filt["year"] == yr]
    prof = (yd["end_excursion"] > 0).sum()
    strict = int(yd["success"].sum())
    print(
        f"  {yr}: {len(yd):>3} trades | {prof}/{len(yd)} profitable ({prof / len(yd) * 100:.0f}%) | {strict} strict success | Avg end exc: {yd['end_excursion'].mean():>+.1f} | MFE {yd['mfe'].mean():.1f}"
    )
