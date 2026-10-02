"""
ORB Signal Quality Assessment — No backtesting needed.
Tests whether signals actually predict breakout outcomes using:
1. Information Coefficient (Spearman rank correlation with forward return)
2. Quantile spread (top vs bottom quintile return)
3. Monte Carlo permutation test (statistical significance)
4. Mutual Information (non-linear predictive power)
"""

import json
import os

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import mutual_info_score

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(SCRIPT_DIR + "/orb_analysis_results.csv")

# Forward return = MFE (favorable) and end_excursion (actual result)
# Use end_excursion as the "return" — how much the breakout actually made
# Positive = breakout followed through, negative = failed

SIGNALS = [
    ("ATRr_14", "ATR"),
    ("ADX_14", "ADX"),
    ("rsi", "RSI"),
    ("roc", "ROC"),
    ("mom", "Momentum"),
    ("cci", "CCI"),
    ("willr", "Williams %R"),
    ("bb_width", "BB Width"),
    ("bb_pct_b", "BB %B"),
    ("natr", "NATR"),
    ("vol_ratio", "Vol Ratio"),
    ("clv", "CLV"),
    ("mfi", "MFI"),
    ("STOCHk_14_3_3", "Stoch %K"),
    ("DMP_14", "DM+"),
    ("DMN_14", "DM-"),
    ("AROONOSC_25", "Aroon Osc"),
    ("range_width", "Range Width"),
    ("MACDh_12_26_9", "MACD Hist"),
]
SIGNALS = [(c, n) for c, n in SIGNALS if c in df.columns]

# Directional adjustment: for shorts, flip the sign of end_excursion
# (a successful short has positive end_excursion already in our data)
y_mfe = df["mfe"].values
y_end = df["end_excursion"].values
y_mfer = df["mfe_range_ratio"].values

N_PERMUTATIONS = 10000

print(f"{'=' * 120}")
print(f"SIGNAL QUALITY ASSESSMENT — {len(df)} breakouts, no backtesting")
print(f"{'=' * 120}")

# ============================================================
# 1. Information Coefficient (Spearman rank correlation)
# ============================================================
print(f"\n{'=' * 80}")
print(f"1. INFORMATION COEFFICIENT (Spearman r with forward return)")
print(f"   IC > 0.05 = useful signal, IC > 0.10 = strong signal")
print(f"{'=' * 80}")

print(
    f"\n  {'Signal':<16} | {'IC vs MFE':>10} {'p':>8} | {'IC vs EndExc':>12} {'p':>8} | {'IC vs MFE/R':>10} {'p':>8} | {'Verdict':<20}"
)
print(f"  {'-' * 110}")

ic_results = {}
for col, name in SIGNALS:
    vals = df[[col, "mfe", "end_excursion", "mfe_range_ratio"]].dropna()
    if len(vals) < 20:
        continue

    ic_mfe, p_mfe = stats.spearmanr(vals[col], vals["mfe"])
    ic_end, p_end = stats.spearmanr(vals[col], vals["end_excursion"])
    ic_mfer, p_mfer = stats.spearmanr(vals[col], vals["mfe_range_ratio"])

    verdict = ""
    if abs(ic_end) > 0.15 and p_end < 0.05:
        verdict = "STRONG"
    elif abs(ic_end) > 0.10 and p_end < 0.10:
        verdict = "MODERATE"
    elif abs(ic_end) > 0.05:
        verdict = "WEAK"
    else:
        verdict = "NOISE"

    sig_mfe = "*" if p_mfe < 0.05 else " "
    sig_end = "*" if p_end < 0.05 else " "
    sig_mfer = "*" if p_mfer < 0.05 else " "

    print(
        f"  {name:<16} | {ic_mfe:>+10.4f} {p_mfe:>7.4f}{sig_mfe} | {ic_end:>+12.4f} {p_end:>7.4f}{sig_end} | {ic_mfer:>+10.4f} {p_mfer:>7.4f}{sig_mfer} | {verdict}"
    )

    ic_results[name] = {
        "ic_mfe": round(float(ic_mfe), 4),
        "p_mfe": round(float(p_mfe), 4),
        "ic_end": round(float(ic_end), 4),
        "p_end": round(float(p_end), 4),
        "ic_mfer": round(float(ic_mfer), 4),
        "p_mfer": round(float(p_mfer), 4),
        "verdict": verdict,
    }

print(f"\n  * = p < 0.05 (statistically significant)")

# ============================================================
# 2. Quantile Spread Analysis
# ============================================================
print(f"\n{'=' * 80}")
print(f"2. QUANTILE SPREAD (avg return by signal quintile)")
print(f"   Monotonic increase/decrease = real signal")
print(f"{'=' * 80}")

for col, name in SIGNALS:
    vals = df[[col, "mfe", "end_excursion", "mfe_range_ratio"]].dropna()
    if len(vals) < 25:
        continue

    try:
        vals["q"] = pd.qcut(vals[col], 5, labels=["Q1", "Q2", "Q3", "Q4", "Q5"], duplicates="drop")
    except ValueError:
        continue

    groups = vals.groupby("q")
    q_mfe = groups["mfe"].mean()
    q_end = groups["end_excursion"].mean()

    spread = q_end.iloc[-1] - q_end.iloc[0] if len(q_end) >= 2 else 0
    monotonic = all(q_end.iloc[i] <= q_end.iloc[i + 1] for i in range(len(q_end) - 1)) or all(
        q_end.iloc[i] >= q_end.iloc[i + 1] for i in range(len(q_end) - 1)
    )

    print(f"\n  {name}: spread={spread:+.2f} {'MONOTONIC' if monotonic else ''}")
    for q in q_mfe.index:
        g = vals[vals["q"] == q]
        print(
            f"    {q}: n={len(g):>3} | MFE={g['mfe'].mean():>+6.1f} | EndExc={g['end_excursion'].mean():>+6.1f} | MFE/R={g['mfe_range_ratio'].mean():>+5.2f}"
        )

# ============================================================
# 3. Monte Carlo Permutation Test
# ============================================================
print(f"\n{'=' * 80}")
print(f"3. MONTE CARLO PERMUTATION TEST ({N_PERMUTATIONS:,} shuffles)")
print(f"   Real IC must be in top 5% of shuffled ICs to be significant")
print(f"{'=' * 80}")

print(
    f"\n  {'Signal':<16} | {'Real IC':>8} | {'Shuffled Mean':>13} | {'Shuffled 95th':>13} | {'p-value':>8} | {'Significant':>11}"
)
print(f"  {'-' * 90}")

mc_results = {}
for col, name in SIGNALS:
    vals = df[[col, "end_excursion"]].dropna()
    if len(vals) < 20:
        continue

    x = vals[col].values
    y = vals["end_excursion"].values

    real_ic = stats.spearmanr(x, y)[0]

    # Shuffle y N times, compute IC each time
    shuffled_ics = np.zeros(N_PERMUTATIONS)
    for i in range(N_PERMUTATIONS):
        np.random.shuffle(y)
        shuffled_ics[i] = stats.spearmanr(x, y)[0]

    # Restore y
    y = vals["end_excursion"].values

    pctl_95 = np.percentile(np.abs(shuffled_ics), 95)
    p_value = (np.abs(shuffled_ics) >= np.abs(real_ic)).mean()
    significant = p_value < 0.05

    print(
        f"  {name:<16} | {real_ic:>+8.4f} | {shuffled_ics.mean():>+13.4f} | {pctl_95:>13.4f} | {p_value:>8.4f} | {'YES' if significant else 'no':>11}"
    )

    mc_results[name] = {
        "real_ic": round(float(real_ic), 4),
        "shuffled_95th": round(float(pctl_95), 4),
        "p_value": round(float(p_value), 4),
        "significant": significant,
    }

# ============================================================
# 4. Mutual Information (non-linear)
# ============================================================
print(f"\n{'=' * 80}")
print(f"4. MUTUAL INFORMATION (non-linear predictive power)")
print(f"   Higher MI = more information about outcome, regardless of linear/non-linear")
print(f"{'=' * 80}")

# Discretize returns into bins for MI calculation
df["return_bin"] = pd.qcut(df["end_excursion"], 5, labels=False, duplicates="drop")

print(f"\n  {'Signal':<16} | {'MI':>8} | {'Normalized MI':>13} | {'Rating':<10}")
print(f"  {'-' * 55}")

mi_results = {}
for col, name in SIGNALS:
    vals = df[[col, "return_bin"]].dropna()
    if len(vals) < 20:
        continue

    # Discretize signal too
    try:
        sig_bins = pd.qcut(vals[col], 10, labels=False, duplicates="drop")
    except ValueError:
        continue

    mi = mutual_info_score(sig_bins, vals["return_bin"])
    # Normalize by max possible MI
    max_mi = np.log(min(sig_bins.nunique(), vals["return_bin"].nunique()))
    nmi = mi / max_mi if max_mi > 0 else 0

    rating = (
        "STRONG" if nmi > 0.05 else "MODERATE" if nmi > 0.02 else "WEAK" if nmi > 0.01 else "NONE"
    )

    print(f"  {name:<16} | {mi:>8.4f} | {nmi:>13.4f} | {rating}")
    mi_results[name] = {"mi": round(float(mi), 4), "nmi": round(float(nmi), 4), "rating": rating}

# ============================================================
# 5. Combined Signal Quality Ranking
# ============================================================
print(f"\n{'=' * 80}")
print(f"5. COMBINED SIGNAL QUALITY RANKING")
print(f"{'=' * 80}")

# Score each signal across all methods
ranking = {}
for col, name in SIGNALS:
    if name not in ic_results or name not in mc_results:
        continue

    ic_score = abs(ic_results[name]["ic_end"])
    mc_sig = 1.0 if mc_results[name]["significant"] else 0.0
    mi_score = mi_results.get(name, {}).get("nmi", 0)

    # Combined score: IC weight 0.4, MC significance 0.3, MI 0.3
    combined = ic_score * 0.4 + mc_sig * 0.3 + mi_score * 0.3 * 10  # scale MI up

    ranking[name] = {
        "ic": ic_score,
        "mc_sig": mc_sig,
        "mi": mi_score,
        "combined": combined,
        "column": col,
    }

sorted_rank = sorted(ranking.items(), key=lambda x: x[1]["combined"], reverse=True)

print(
    f"\n  {'Rank':>4} {'Signal':<16} | {'|IC|':>6} | {'MC Sig':>6} | {'NMI':>6} | {'Combined':>8} | {'Use?':<10}"
)
print(f"  {'-' * 75}")

for i, (name, r) in enumerate(sorted_rank, 1):
    use = "YES" if r["combined"] > 0.1 else "MAYBE" if r["combined"] > 0.05 else "NO"
    print(
        f"  {i:>4} {name:<16} | {r['ic']:>6.4f} | {r['mc_sig']:>6.0f} | {r['mi']:>6.4f} | {r['combined']:>8.4f} | {use}"
    )

# Save
output = {
    "information_coefficient": ic_results,
    "monte_carlo": mc_results,
    "mutual_information": mi_results,
    "ranking": {name: vals for name, vals in sorted_rank},
}
out_path = SCRIPT_DIR + "/orb_signal_quality.json"
with open(out_path, "w") as f:
    json.dump(output, f, indent=2)
print(f"\nSaved: {out_path}")
