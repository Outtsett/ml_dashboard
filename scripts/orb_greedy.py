"""
ORB Greedy Signal Selection.

Forward selection: start empty, add the signal that improves PnL most at each step.
Backward elimination: start with all, remove the signal whose removal helps most.
Determines optimal signal COUNT and ranking.
"""

import json
import os
from itertools import combinations

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(SCRIPT_DIR + '/orb_audit_results.csv')

SIGNALS = ['adx', 'bbw', 'roc', 'clv', 'vol_ratio', 'macdh', 'bb_pctb', 'atr', 'range_w']
SIGNALS = [c for c in SIGNALS if c in df.columns]

# Build normalized directional signal matrix
X_raw = df[SIGNALS].fillna(0).copy()
X_min = X_raw.min(); X_max = X_raw.max()
X_range = X_max - X_min; X_range[X_range == 0] = 1
X_norm = (X_raw - X_min) / X_range

# Flip directional signals for shorts
is_short = (df['side'] == 'SHORT').values
for col in ['roc', 'clv', 'macdh', 'bb_pctb']:
    if col in X_norm.columns:
        X_norm.loc[is_short, col] = 1.0 - X_norm.loc[is_short, col]

y = df['pnl'].values
n = len(y)


def evaluate(signal_set, threshold_pct=0.5):
    """Score a set of signals: equal-weight, find best threshold, return PnL."""
    if not signal_set:
        return 0, 0, 0.5

    cols = list(signal_set)
    X = X_norm[cols].values
    scores = X.mean(axis=1)  # equal weight across selected signals

    best_pnl = -9999
    best_thresh = 0.5
    best_pct = 0.5

    for pct in np.arange(0.2, 0.85, 0.05):
        thresh = np.quantile(scores, pct)
        follow = scores >= thresh
        if follow.sum() < 3 or (~follow).sum() < 3:
            continue
        f_pnl = y[follow].sum()
        r_pnl = -y[~follow].sum()
        total = f_pnl + r_pnl
        if total > best_pnl:
            best_pnl = total
            best_thresh = thresh
            best_pct = pct

    follow = scores >= best_thresh
    return best_pnl, follow.sum(), best_pct


def evaluate_weighted(signal_set, weights):
    """Score with specific weights."""
    if not signal_set:
        return 0, 0, 0.5

    cols = list(signal_set)
    X = X_norm[cols].values
    w = np.array([weights[c] for c in cols])
    if w.sum() == 0:
        return 0, 0, 0.5
    w = w / w.sum()
    scores = X @ w

    best_pnl = -9999
    best_pct = 0.5
    for pct in np.arange(0.2, 0.85, 0.05):
        thresh = np.quantile(scores, pct)
        follow = scores >= thresh
        if follow.sum() < 3 or (~follow).sum() < 3:
            continue
        total = y[follow].sum() + (-y[~follow].sum())
        if total > best_pnl:
            best_pnl = total
            best_pct = pct

    return best_pnl, 0, best_pct


# ============================================================
# Forward Greedy Selection
# ============================================================
print(f"{'='*100}")
print(f"FORWARD GREEDY SELECTION (start empty, add best signal each step)")
print(f"{'='*100}")

selected = []
remaining = list(SIGNALS)
forward_log = []

for step in range(len(SIGNALS)):
    best_gain = -9999
    best_signal = None
    best_pnl_after = 0
    best_follow = 0
    best_pct = 0.5

    current_pnl, _, _ = evaluate(set(selected))

    for sig in remaining:
        candidate = selected + [sig]
        pnl, fol, pct = evaluate(set(candidate))
        gain = pnl - current_pnl

        if gain > best_gain:
            best_gain = gain
            best_signal = sig
            best_pnl_after = pnl
            best_follow = fol
            best_pct = pct

    if best_signal is None:
        break

    selected.append(best_signal)
    remaining.remove(best_signal)

    forward_log.append({
        'step': step + 1,
        'added': best_signal,
        'signals': list(selected),
        'pnl': best_pnl_after,
        'marginal_gain': best_gain,
        'follow_trades': best_follow,
        'threshold_pct': best_pct,
    })

    marker = "+" if best_gain > 0 else "-"
    print(f"  Step {step+1}: Add '{best_signal}' | PnL={best_pnl_after:>+8.1f} | Gain={best_gain:>+8.1f} {marker} | "
          f"Follow={best_follow} trades | Thresh={best_pct:.0%} | Signals: {selected}")

# Find optimal stopping point
best_step = max(forward_log, key=lambda x: x['pnl'])
print(f"\n  OPTIMAL: {best_step['step']} signals | PnL={best_step['pnl']:+.1f} | Signals: {best_step['signals']}")

# ============================================================
# Backward Greedy Elimination
# ============================================================
print(f"\n{'='*100}")
print(f"BACKWARD GREEDY ELIMINATION (start with all, remove worst signal each step)")
print(f"{'='*100}")

active = list(SIGNALS)
backward_log = []
all_pnl, all_fol, all_pct = evaluate(set(active))
print(f"  All {len(active)} signals: PnL={all_pnl:+.1f}")

for step in range(len(SIGNALS) - 1):
    best_gain = -9999
    best_remove = None
    best_pnl_after = 0
    best_follow = 0
    best_pct = 0.5

    current_pnl, _, _ = evaluate(set(active))

    for sig in active:
        candidate = [s for s in active if s != sig]
        pnl, fol, pct = evaluate(set(candidate))
        gain = pnl - current_pnl  # positive = removing helps

        if gain > best_gain:
            best_gain = gain
            best_remove = sig
            best_pnl_after = pnl
            best_follow = fol
            best_pct = pct

    if best_remove is None:
        break

    active.remove(best_remove)

    backward_log.append({
        'step': step + 1,
        'removed': best_remove,
        'signals': list(active),
        'pnl': best_pnl_after,
        'marginal_gain': best_gain,
        'follow_trades': best_follow,
        'threshold_pct': best_pct,
    })

    marker = "+" if best_gain > 0 else "-"
    print(f"  Step {step+1}: Remove '{best_remove}' | PnL={best_pnl_after:>+8.1f} | Gain={best_gain:>+8.1f} {marker} | "
          f"Remaining: {active}")

best_back = max(backward_log, key=lambda x: x['pnl'])
print(f"\n  OPTIMAL: {len(best_back['signals'])} signals | PnL={best_back['pnl']:+.1f} | Signals: {best_back['signals']}")

# ============================================================
# Exhaustive search (only 2^9 = 512 combinations)
# ============================================================
print(f"\n{'='*100}")
print(f"EXHAUSTIVE SEARCH (all {2**len(SIGNALS)-1} signal combinations)")
print(f"{'='*100}")

exhaustive = []
for r in range(1, len(SIGNALS) + 1):
    for combo in combinations(SIGNALS, r):
        pnl, fol, pct = evaluate(set(combo))
        exhaustive.append({
            'signals': list(combo),
            'n_signals': r,
            'pnl': pnl,
            'follow_trades': fol,
            'threshold_pct': pct,
        })

edf = pd.DataFrame(exhaustive).sort_values('pnl', ascending=False)

print(f"\n  TOP 15 COMBINATIONS:")
print(f"  {'PnL':>8} {'N':>3} {'Follow':>6} {'Thresh':>6} | Signals")
print(f"  {'-'*80}")
for _, row in edf.head(15).iterrows():
    print(f"  {row['pnl']:>+8.1f} {row['n_signals']:>3} {row['follow_trades']:>6} {row['threshold_pct']:>6.0%} | {row['signals']}")

print(f"\n  BEST BY SIGNAL COUNT:")
for ns in range(1, len(SIGNALS) + 1):
    sub = edf[edf['n_signals'] == ns]
    if len(sub) == 0: continue
    best = sub.iloc[0]
    print(f"  {ns} signals: PnL={best['pnl']:>+8.1f} | {best['signals']}")

# Global best
gb = edf.iloc[0]
print(f"\n  GLOBAL BEST: {gb['signals']} | PnL={gb['pnl']:+.1f} | {gb['n_signals']} signals | threshold={gb['threshold_pct']:.0%}")

# Save
output = {
    'forward_greedy': {
        'optimal_signals': best_step['signals'],
        'pnl': best_step['pnl'],
        'log': forward_log,
    },
    'backward_greedy': {
        'optimal_signals': best_back['signals'],
        'pnl': best_back['pnl'],
        'log': backward_log,
    },
    'exhaustive_best': {
        'signals': gb['signals'],
        'pnl': float(gb['pnl']),
        'n_signals': int(gb['n_signals']),
        'threshold_pct': float(gb['threshold_pct']),
    },
    'exhaustive_top10': edf.head(10).to_dict('records'),
}
out_path = SCRIPT_DIR + '/orb_greedy_results.json'
with open(out_path, 'w') as f:
    json.dump(output, f, indent=2, default=str)
print(f"\nSaved: {out_path}")
