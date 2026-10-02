"""
ORB Filter Validation — Test indicator filter combinations on the breakout dataset.
Reads the CSV output from orb_indicator_analysis.py and tests various filter combinations.
"""

import os

import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(SCRIPT_DIR, "orb_analysis_results.csv")

df = pd.read_csv(CSV_PATH)
n_total = len(df)
n_success = df["success"].sum()

print(f"BASELINE: {n_success}/{n_total} success ({n_success / n_total * 100:.1f}%)")
print(f"  Avg MFE: {df['mfe'].mean():.1f} | Avg MAE: {df['mae'].mean():.1f}")
print(f"  Avg MFE/Range: {df['mfe_range_ratio'].mean():.2f}x")
print()

# ============================================================
# Define filter sets to test
# ============================================================
filters = {
    # --- Individual filters ---
    "Range Width < 20": lambda d: d["range_width"] <= 20,
    "Range Width < 15": lambda d: d["range_width"] <= 15,
    "NATR < 0.14": lambda d: d["natr"] <= 0.14,
    "BB Width < 0.55": lambda d: d["bb_width"] <= 0.55,
    "Vol Ratio > 1.0": lambda d: d["vol_ratio"] >= 1.0,
    "Vol Ratio > 0.8": lambda d: d["vol_ratio"] >= 0.80,
    "ADX > 20": lambda d: d["ADX_14"] >= 20,
    "ADX > 25": lambda d: d["ADX_14"] >= 25,
    "RSI 40-60": lambda d: (d["rsi"] >= 40) & (d["rsi"] <= 60),
    "CCI -100 to 100": lambda d: (d["cci"] >= -100) & (d["cci"] <= 100),
    "Williams -80 to -20": lambda d: (d["willr"] >= -80) & (d["willr"] <= -20),
    "MFI 30-70": lambda d: (d["mfi"] >= 30) & (d["mfi"] <= 70),
    "ATR < 18": lambda d: d["ATRr_14"] <= 18,
    # --- Combined filters ---
    "Range<20 + Vol>0.8": lambda d: (d["range_width"] <= 20) & (d["vol_ratio"] >= 0.8),
    "Range<20 + ADX>20": lambda d: (d["range_width"] <= 20) & (d["ADX_14"] >= 20),
    "Range<20 + BB<0.55": lambda d: (d["range_width"] <= 20) & (d["bb_width"] <= 0.55),
    "Range<20 + NATR<0.14": lambda d: (d["range_width"] <= 20) & (d["natr"] <= 0.14),
    "Range<15 + Vol>1.0": lambda d: (d["range_width"] <= 15) & (d["vol_ratio"] >= 1.0),
    "Range<15 + ADX>20": lambda d: (d["range_width"] <= 15) & (d["ADX_14"] >= 20),
    "Range<15 + BB<0.55": lambda d: (d["range_width"] <= 15) & (d["bb_width"] <= 0.55),
    # --- Triple filters ---
    "Range<20 + Vol>0.8 + ADX>20": lambda d: (
        (d["range_width"] <= 20) & (d["vol_ratio"] >= 0.8) & (d["ADX_14"] >= 20)
    ),
    "Range<20 + Vol>0.8 + BB<0.55": lambda d: (
        (d["range_width"] <= 20) & (d["vol_ratio"] >= 0.8) & (d["bb_width"] <= 0.55)
    ),
    "Range<20 + BB<0.55 + ADX>20": lambda d: (
        (d["range_width"] <= 20) & (d["bb_width"] <= 0.55) & (d["ADX_14"] >= 20)
    ),
    "Range<15 + Vol>0.8 + ADX>20": lambda d: (
        (d["range_width"] <= 15) & (d["vol_ratio"] >= 0.8) & (d["ADX_14"] >= 20)
    ),
    "Range<15 + Vol>1.0 + ADX>20": lambda d: (
        (d["range_width"] <= 15) & (d["vol_ratio"] >= 1.0) & (d["ADX_14"] >= 20)
    ),
    "Range<15 + BB<0.55 + ADX>20": lambda d: (
        (d["range_width"] <= 15) & (d["bb_width"] <= 0.55) & (d["ADX_14"] >= 20)
    ),
    # --- Quad filters ---
    "Range<20 + Vol>0.8 + ADX>20 + BB<0.55": lambda d: (
        (d["range_width"] <= 20)
        & (d["vol_ratio"] >= 0.8)
        & (d["ADX_14"] >= 20)
        & (d["bb_width"] <= 0.55)
    ),
    "Range<15 + Vol>0.8 + ADX>20 + BB<0.55": lambda d: (
        (d["range_width"] <= 15)
        & (d["vol_ratio"] >= 0.8)
        & (d["ADX_14"] >= 20)
        & (d["bb_width"] <= 0.55)
    ),
    "Range<20 + Vol>0.8 + ADX>20 + NATR<0.14": lambda d: (
        (d["range_width"] <= 20)
        & (d["vol_ratio"] >= 0.8)
        & (d["ADX_14"] >= 20)
        & (d["natr"] <= 0.14)
    ),
    # --- With momentum/oscillator filters ---
    "Range<20 + ADX>20 + RSI40-60": lambda d: (
        (d["range_width"] <= 20) & (d["ADX_14"] >= 20) & (d["rsi"] >= 40) & (d["rsi"] <= 60)
    ),
    "Range<20 + ADX>20 + CCI[-100,100]": lambda d: (
        (d["range_width"] <= 20) & (d["ADX_14"] >= 20) & (d["cci"] >= -100) & (d["cci"] <= 100)
    ),
    "Range<20 + ADX>20 + Willr[-80,-20]": lambda d: (
        (d["range_width"] <= 20) & (d["ADX_14"] >= 20) & (d["willr"] >= -80) & (d["willr"] <= -20)
    ),
    "Range<20 + ADX>20 + MFI[30,70]": lambda d: (
        (d["range_width"] <= 20) & (d["ADX_14"] >= 20) & (d["mfi"] >= 30) & (d["mfi"] <= 70)
    ),
    # --- Best candidates ---
    "Range<20 + BB<0.55 + Vol>0.8 + ADX>20 + NATR<0.14": lambda d: (
        (d["range_width"] <= 20)
        & (d["bb_width"] <= 0.55)
        & (d["vol_ratio"] >= 0.8)
        & (d["ADX_14"] >= 20)
        & (d["natr"] <= 0.14)
    ),
    "Range<15 + BB<0.55 + Vol>1.0 + ADX>20": lambda d: (
        (d["range_width"] <= 15)
        & (d["bb_width"] <= 0.55)
        & (d["vol_ratio"] >= 1.0)
        & (d["ADX_14"] >= 20)
    ),
}

# Test each filter
print(
    f"{'Filter':<52} | {'Pass':>5} | {'Succ':>5} | {'Rate%':>6} | {'Lift':>6} | {'AvgMFE':>7} | {'AvgMAE':>7} | {'MFE/R':>6}"
)
print("-" * 115)

results = []
for name, fn in filters.items():
    try:
        mask = fn(df)
        filtered = df[mask]
        n = len(filtered)
        if n < 5:
            continue
        s = int(filtered["success"].sum())
        rate = s / n * 100
        lift = rate / (n_success / n_total * 100)
        avg_mfe = filtered["mfe"].mean()
        avg_mae = filtered["mae"].mean()
        mfe_r = filtered["mfe_range_ratio"].mean()

        print(
            f"{name:<52} | {n:>5} | {s:>5} | {rate:>5.1f}% | {lift:>5.2f}x | {avg_mfe:>7.1f} | {avg_mae:>7.1f} | {mfe_r:>5.2f}x"
        )

        results.append(
            {
                "filter": name,
                "pass_count": n,
                "success_count": s,
                "success_rate": rate,
                "lift": lift,
                "avg_mfe": avg_mfe,
                "avg_mae": avg_mae,
                "mfe_range": mfe_r,
            }
        )
    except Exception as e:
        # Never swallow silently — a filter referencing a missing column would
        # otherwise vanish from the report with no trace.
        print(f"{name:<52} | SKIPPED: {type(e).__name__}: {e}")

# Sort by success rate (min 10 trades)
print(f"\n{'=' * 80}")
print("TOP 15 FILTERS BY SUCCESS RATE (min 10 trades)")
print(f"{'=' * 80}")
res_df = pd.DataFrame(results)
res_df = res_df[res_df["pass_count"] >= 10].sort_values("success_rate", ascending=False)
for _, row in res_df.head(15).iterrows():
    print(
        f"  {row['filter']:<52} | {row['pass_count']:>4} trades | {row['success_rate']:>5.1f}% ({row['lift']:.2f}x lift) | MFE {row['avg_mfe']:.1f}"
    )

# Per-year stability check for top filter
print(f"\n{'=' * 80}")
print("YEAR-BY-YEAR STABILITY CHECK")
print(f"{'=' * 80}")

if len(res_df) > 0:
    top_filter_name = res_df.iloc[0]["filter"]
    top_fn = filters[top_filter_name]
    print(f"\nFilter: {top_filter_name}")

    df["year"] = pd.to_datetime(df["date"]).dt.year
    for year in sorted(df["year"].unique()):
        yr_df = df[df["year"] == year]
        yr_filtered = yr_df[top_fn(yr_df)]
        n = len(yr_filtered)
        if n > 0:
            s = int(yr_filtered["success"].sum())
            print(
                f"  {year}: {s}/{n} success ({s / n * 100:.0f}%) | MFE {yr_filtered['mfe'].mean():.1f} | MAE {yr_filtered['mae'].mean():.1f}"
            )
        else:
            print(f"  {year}: 0 trades")

# Side breakdown for top filter
if len(res_df) > 0:
    top_fn = filters[res_df.iloc[0]["filter"]]
    filtered = df[top_fn(df)]
    print(f"\nSide breakdown for top filter:")
    for side in ["LONG", "SHORT"]:
        sd = filtered[filtered["side"] == side]
        if len(sd) > 0:
            s = int(sd["success"].sum())
            print(
                f"  {side}: {s}/{len(sd)} success ({s / len(sd) * 100:.0f}%) | MFE {sd['mfe'].mean():.1f}"
            )
