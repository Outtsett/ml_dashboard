"""
ORB Signal Weight Optimization via Quadratic Programming.

Formulation:
- Each trade has a vector of indicator signals (continuous values at entry)
- PnL is the outcome
- Find weights w that maximize: E[score * pnl] - lambda * Var[score * pnl]
  where score = w'x (weighted sum of normalized indicator values)
- This is equivalent to Markowitz mean-variance optimization on signal contributions
- Constraints: w >= 0, ||w||_1 = 1 (weights sum to 1, all non-negative)

Uses cvxpy for convex optimization.
"""

import pandas as pd
import numpy as np
import os
import sys
import json

try:
    import cvxpy as cp
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'cvxpy'])
    import cvxpy as cp

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Load the audit results (trades with indicator values at entry)
df = pd.read_csv(SCRIPT_DIR + '/orb_audit_results.csv')

print(f"Loaded {len(df)} trades")
print(f"PnL range: {df['pnl'].min():+.1f} to {df['pnl'].max():+.1f}, total: {df['pnl'].sum():+.1f}")

# Indicator columns available at entry
SIGNAL_COLS = ['adx', 'bbw', 'roc', 'clv', 'vol_ratio', 'macdh', 'bb_pctb', 'atr', 'range_w', 'score']

# Check which columns exist
available = [c for c in SIGNAL_COLS if c in df.columns]
print(f"Signal columns: {available}")

# Build signal matrix X (normalize each column to [0,1])
X_raw = df[available].copy()
X_raw = X_raw.fillna(0)

# Normalize
X_min = X_raw.min()
X_max = X_raw.max()
X_range = X_max - X_min
X_range[X_range == 0] = 1  # avoid div by zero
X_norm = (X_raw - X_min) / X_range

# PnL vector
y = df['pnl'].values

# Also create directional signals: for shorts, flip the sign of directional indicators
# ROC, CLV, MACDh, BB%B should be inverted for short trades
is_short = (df['side'] == 'SHORT').values
X_dir = X_norm.copy()
directional_cols = ['roc', 'clv', 'macdh', 'bb_pctb']
for col in directional_cols:
    if col in X_dir.columns:
        X_dir.loc[is_short, col] = 1.0 - X_dir.loc[is_short, col]

X = X_dir.values  # n_trades x n_signals
n_trades, n_signals = X.shape

print(f"\nSignal matrix: {n_trades} trades x {n_signals} signals")
print(f"Signal names: {available}")

# ============================================================
# Method 1: Mean-Variance QP on signal-weighted PnL
# ============================================================
# For each weight vector w, the "portfolio return" per trade is: r_i = (w'x_i) * y_i
# We want to maximize E[r] - lambda * Var[r]
# This is a QP: max w'mu - lambda * w'Sigma*w
# where mu_j = E[x_j * y] (average contribution of signal j to PnL)
#       Sigma_jk = Cov[x_j * y, x_k * y]

# Compute signal-PnL contribution matrix
# Each column is the element-wise product of signal j values and PnL
S = X * y[:, np.newaxis]  # n_trades x n_signals

mu = S.mean(axis=0)  # expected contribution per signal
Sigma = np.cov(S.T)  # covariance of contributions
if Sigma.ndim == 1:
    Sigma = np.array([[Sigma]])

# Ensure Sigma is positive semidefinite
eigvals = np.linalg.eigvalsh(Sigma)
if eigvals.min() < 0:
    Sigma += (-eigvals.min() + 1e-6) * np.eye(n_signals)

print(f"\nSignal contribution means (mu):")
for i, col in enumerate(available):
    print(f"  {col:<12}: {mu[i]:>+8.4f}")

print(f"\nSolving QP for optimal weights...")

# Solve for multiple risk aversion levels
results = []
for lam in [0.01, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0]:
    w = cp.Variable(n_signals)
    objective = cp.Maximize(mu @ w - lam * cp.quad_form(w, Sigma))
    constraints = [w >= 0, cp.sum(w) == 1]
    prob = cp.Problem(objective, constraints)

    try:
        prob.solve(solver=cp.SCS)
        if prob.status == 'optimal' or prob.status == 'optimal_inaccurate':
            weights = w.value
            # Compute resulting scores and simulate
            scores = X @ weights
            # Use median score as threshold
            threshold = np.median(scores)
            follow = scores >= threshold
            follow_pnl = y[follow].sum()
            reverse_pnl = -y[~follow].sum()  # reverse trades get opposite PnL
            total = follow_pnl + reverse_pnl
            follow_trades = follow.sum()
            reverse_trades = (~follow).sum()

            results.append({
                'lambda': lam,
                'weights': weights,
                'total_pnl': total,
                'follow_pnl': follow_pnl,
                'reverse_pnl': reverse_pnl,
                'follow_trades': int(follow_trades),
                'reverse_trades': int(reverse_trades),
                'threshold': threshold,
            })

            print(f"\n  lambda={lam:>5.2f} | PnL={total:>+8.1f} (follow={follow_pnl:>+.1f}, reverse={reverse_pnl:>+.1f}) | "
                  f"Trades: {follow_trades} follow, {reverse_trades} reverse")
            for j, col in enumerate(available):
                bar = '#' * int(weights[j] * 50)
                print(f"    {col:<12}: {weights[j]:>6.3f} {bar}")
    except Exception as e:
        print(f"  lambda={lam}: solver failed - {e}")

# ============================================================
# Method 2: Direct PnL maximization with L2 regularization
# ============================================================
print(f"\n{'='*80}")
print("Method 2: Direct score-PnL correlation maximization")
print(f"{'='*80}")

# Find weights that maximize correlation between weighted score and PnL
# max corr(Xw, y) = max (Xw)'y / (||Xw|| * ||y||)
# Equivalent to: max w'X'y subject to w'X'Xw = 1 (unit variance scores)
# This is a generalized eigenvalue problem

XtY = X.T @ y  # n_signals vector
XtX = X.T @ X  # n_signals x n_signals matrix

# Regularize XtX
XtX += 1e-4 * np.eye(n_signals)

# Solve: XtX w = lambda * XtY  =>  w = XtX^-1 XtY (least squares direction)
w_ls = np.linalg.solve(XtX, XtY)

# Project to non-negative and normalize
w_ls = np.maximum(w_ls, 0)
if w_ls.sum() > 0:
    w_ls = w_ls / w_ls.sum()

print(f"\nLeast-squares optimal weights:")
for j, col in enumerate(available):
    bar = '#' * int(w_ls[j] * 50)
    print(f"  {col:<12}: {w_ls[j]:>6.3f} {bar}")

# Test this weighting
scores_ls = X @ w_ls
# Find optimal threshold via sweep
best_pnl = -9999
best_thresh = 0
for pct in np.arange(0.2, 0.8, 0.05):
    thresh = np.quantile(scores_ls, pct)
    follow = scores_ls >= thresh
    f_pnl = y[follow].sum()
    r_pnl = -y[~follow].sum()
    total = f_pnl + r_pnl
    if total > best_pnl:
        best_pnl = total
        best_thresh = thresh
        best_pct = pct

print(f"\nOptimal threshold: {best_thresh:.4f} (percentile {best_pct:.0%})")
print(f"Total PnL with optimal threshold: {best_pnl:+.1f}")

follow = scores_ls >= best_thresh
print(f"Follow: {follow.sum()} trades, PnL={y[follow].sum():+.1f}")
print(f"Reverse: {(~follow).sum()} trades, PnL={-y[~follow].sum():+.1f}")

# ============================================================
# Method 3: Compare current integer weights vs QP weights
# ============================================================
print(f"\n{'='*80}")
print("Comparison: Current weights vs QP-optimized weights")
print(f"{'='*80}")

# Current weights (from the strategy): BB_width=3, ADX=2, Vol=2, ROC=2, BB%B=1
# Map to the signal columns
current_weight_map = {
    'bbw': 3, 'adx': 2, 'vol_ratio': 2, 'roc': 2, 'bb_pctb': 1,
    'clv': 0, 'macdh': 0, 'atr': 0, 'range_w': 0, 'score': 0,
}
w_current = np.array([current_weight_map.get(c, 0) for c in available], dtype=float)
if w_current.sum() > 0:
    w_current_norm = w_current / w_current.sum()
else:
    w_current_norm = np.ones(n_signals) / n_signals

scores_current = X @ w_current_norm

# Best QP result
if results:
    best_qp = max(results, key=lambda r: r['total_pnl'])
    w_qp = best_qp['weights']
    scores_qp = X @ w_qp

    print(f"\n  {'Signal':<12} | {'Current':>8} | {'QP':>8} | {'LS':>8}")
    print(f"  {'-'*48}")
    for j, col in enumerate(available):
        print(f"  {col:<12} | {w_current_norm[j]:>8.3f} | {w_qp[j]:>8.3f} | {w_ls[j]:>8.3f}")

    # Simulate with each
    for name, w in [('Current', w_current_norm), ('QP (best)', w_qp), ('Least-Squares', w_ls)]:
        sc = X @ w
        thresh = np.median(sc)
        follow = sc >= thresh
        f_pnl = y[follow].sum()
        r_pnl = -y[~follow].sum()
        total = f_pnl + r_pnl
        print(f"\n  {name}: total PnL={total:+.1f} | follow={f_pnl:+.1f} ({follow.sum()} trades) | reverse={r_pnl:+.1f} ({(~follow).sum()} trades)")

# Save optimal weights
output = {
    'method': 'quadratic_programming',
    'signal_columns': available,
    'qp_weights': {col: float(w_qp[j]) for j, col in enumerate(available)} if results else {},
    'ls_weights': {col: float(w_ls[j]) for j, col in enumerate(available)},
    'current_weights': {col: float(w_current_norm[j]) for j, col in enumerate(available)},
    'normalization': {col: {'min': float(X_min[col]), 'max': float(X_max[col])} for col in available},
    'optimal_threshold': float(best_thresh),
    'total_trades': int(n_trades),
}
out_path = SCRIPT_DIR + '/orb_qp_weights.json'
with open(out_path, 'w') as f:
    json.dump(output, f, indent=2)
print(f"\nSaved: {out_path}")
