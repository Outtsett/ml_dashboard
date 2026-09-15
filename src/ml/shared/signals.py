"""
Signal Contract — Compute rich regime metadata from model outputs.

SRP: Computes signal columns only. Does NOT persist anything.
OCP: Add new columns by adding functions here — save.py calls compute_signal_columns().

Produces 6 columns for regime assignment CSVs:
  confidence      — max(posterior[t]), probability of chosen regime (0-1)
  entropy         — normalized Shannon entropy of posterior (0-1), high = uncertain
  magnitude       — mean log return in current regime (expected return)
  volatility      — stdev of log returns in current regime (expected vol)
  duration_bars   — average consecutive run length of current regime
  transition_prob — 1 - P(stay in same regime) from transition matrix
"""

from typing import Optional

import numpy as np


def compute_signal_columns(
    assignments: np.ndarray,           # (T,) int regime assignments
    posteriors: Optional[np.ndarray],  # (T, K) posterior probabilities per bar (or None)
    close: np.ndarray,                 # (T,) close prices
    transition_matrix: Optional[np.ndarray],  # (K, K) row-stochastic transition probs (or None)
) -> dict:
    """
    Compute 6 signal columns from model outputs.

    Returns dict of {column_name: np.ndarray of shape (T,)}.
    All arrays are the same length as `assignments`.
    """
    T = len(assignments)
    if T == 0:
        return {k: np.array([]) for k in
                ["confidence", "entropy", "magnitude", "volatility", "duration_bars", "transition_prob"]}

    K = int(assignments.max()) + 1

    # ── Confidence: max posterior probability per bar ──
    if posteriors is not None and posteriors.ndim == 2 and posteriors.shape[1] > 1:
        confidence = posteriors.max(axis=1)
    else:
        confidence = np.ones(T)  # No posteriors → confidence = 1.0

    # ── Entropy: normalized Shannon entropy of posterior distribution ──
    if posteriors is not None and posteriors.ndim == 2 and posteriors.shape[1] > 1:
        p = np.clip(posteriors, 1e-10, 1.0)
        entropy = -np.sum(p * np.log(p), axis=1)
        max_entropy = np.log(K) if K > 1 else 1.0
        entropy = entropy / max_entropy  # Normalize to [0, 1]
    else:
        entropy = np.zeros(T)

    # ── Magnitude: per-regime mean log return ──
    log_returns = np.diff(np.log(np.maximum(close, 1e-10)))
    log_returns = np.concatenate([[0.0], log_returns])  # Pad to length T

    regime_mean = {}
    for k in range(K):
        mask = assignments == k
        if mask.sum() > 1:
            regime_mean[k] = float(np.mean(log_returns[mask]))
        else:
            regime_mean[k] = 0.0
    magnitude = np.array([regime_mean.get(int(a), 0.0) for a in assignments])

    # ── Volatility: per-regime return stdev ──
    regime_vol = {}
    for k in range(K):
        mask = assignments == k
        if mask.sum() > 2:
            regime_vol[k] = float(np.std(log_returns[mask]))
        else:
            regime_vol[k] = 0.0
    volatility = np.array([regime_vol.get(int(a), 0.0) for a in assignments])

    # ── Duration: average consecutive run length per regime ──
    regime_durations = _compute_regime_durations(assignments, K)
    duration_bars = np.array([regime_durations.get(int(a), 1) for a in assignments])

    # ── Transition probability: P(switch regime at this bar) ──
    if transition_matrix is not None:
        transition_prob = np.array([
            1.0 - float(transition_matrix[int(a)][int(a)])
            if int(a) < len(transition_matrix) else 0.0
            for a in assignments
        ])
    else:
        transition_prob = np.zeros(T)

    return {
        "confidence": confidence.astype(np.float64),
        "entropy": entropy.astype(np.float64),
        "magnitude": magnitude.astype(np.float64),
        "volatility": volatility.astype(np.float64),
        "duration_bars": duration_bars.astype(np.int32),
        "transition_prob": transition_prob.astype(np.float64),
    }


def _compute_regime_durations(assignments: np.ndarray, K: int) -> dict:
    """Compute average consecutive run length per regime."""
    durations = {k: [] for k in range(K)}
    if len(assignments) == 0:
        return {k: 1 for k in range(K)}

    current = int(assignments[0])
    run_len = 1

    for i in range(1, len(assignments)):
        if int(assignments[i]) == current:
            run_len += 1
        else:
            durations[current].append(run_len)
            current = int(assignments[i])
            run_len = 1
    durations[current].append(run_len)  # Last run

    return {k: int(np.mean(v)) if v else 1 for k, v in durations.items()}
