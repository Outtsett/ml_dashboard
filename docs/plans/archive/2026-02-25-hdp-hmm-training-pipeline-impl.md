# HDP-HMM Training Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire end-to-end HDP-HMM training: press Train → Python model runs → terminal logs stream → chart overlays paint → Training Center shows live analytics.

**Architecture:** Server exports raw OHLCV from QuestDB to temp parquet, spawns Python HDP-HMM via PythonRunner, parses stdout JSON events, streams via SSE to all connected clients. Model computes its own features and normalizes on the fly.

**Tech Stack:** Python (numpy, numba, scipy, pyarrow), TypeScript (Express SSE, xterm.js, Recharts), existing infrastructure (PythonRunner, Orchestrator, TrainingContext).

**Design doc:** `docs/plans/2026-02-25-hdp-hmm-training-pipeline-design.md`

---

## Task 1: Register HDP-HMM in models.json

**Files:**
- Modify: `src/config/models.json`
- Modify: `src/config/features.json`

**Step 1: Populate models.json with HDP-HMM entry**

```json
{
  "version": 1,
  "models": {
    "hdp-hmm": {
      "name": "Sticky HDP-HMM Regime Detection",
      "category": "unsupervised",
      "subcategory": "clustering",
      "runner": "python",
      "script": "src/ml/hdp_hmm.py",
      "featurePipeline": "self-contained",
      "outputs": ["regimes", "transition_matrix", "convergence"],
      "chartOverlay": "regime_zones",
      "outputDir": "data/models",
      "requiresDataExport": true,
      "defaultHyperparameters": {
        "gibbsIter": { "value": 500, "min": 100, "max": 2000, "step": 50, "label": "Gibbs Iterations" },
        "burnIn": { "value": 100, "min": 0, "max": 500, "step": 50, "label": "Burn-in Iterations" },
        "alpha": { "value": 1.0, "min": 0.01, "max": 10.0, "step": 0.1, "label": "Alpha (state DP concentration)" },
        "gamma": { "value": 1.0, "min": 0.01, "max": 10.0, "step": 0.1, "label": "Gamma (top-level DP concentration)" },
        "kappa": { "value": 50.0, "min": 1.0, "max": 200.0, "step": 1.0, "label": "Kappa (sticky self-transition bias)" },
        "testSplit": { "value": 0.15, "min": 0.05, "max": 0.4, "step": 0.05, "label": "Test Split Ratio" },
        "overlayInterval": { "value": 25, "min": 5, "max": 100, "step": 5, "label": "Overlay Emit Interval (iterations)" }
      }
    }
  }
}
```

**Step 2: Add self-contained feature pipeline to features.json**

```json
{
  "pipelines": {
    "self-contained": {
      "description": "Model computes and normalizes its own features from raw OHLCV",
      "type": "internal"
    }
  },
  "featureSets": {
    "full-344": {
      "description": "All available pre-computed indicators",
      "columns": "*"
    }
  }
}
```

**Step 3: Verify config loads**

Run: `node -e "const r = require('./src/server/training/registry'); r.reloadConfigs(); console.log(r.getModelConfig('hdp-hmm'))"`

This won't work directly (ESM), so verify by starting dev server and checking GET /api/training/config.

**Step 4: Commit**

```bash
git add src/config/models.json src/config/features.json
git commit -m "feat(training): register HDP-HMM model in training config"
```

---

## Task 2: Wire Data Export into Orchestrator

The orchestrator currently passes `ResolvedTrainingConfig` to the runner WITHOUT exporting data first. Models with `requiresDataExport: true` need a parquet file exported before spawning.

**Files:**
- Modify: `src/server/training/orchestrator.ts:74-98`

**Step 1: Add data export step before runner.start()**

In `orchestrator.ts`, between the config resolution (line 88) and runner spawning (line 98), add the data export step:

```typescript
// After line 88 (const resolved = { ... })
// Before line 90 (const runner = getRunner(...))

// 4a. Export data if model requires it
if (registry.requiresDataExport) {
  const { exportTrainingData } = await import('./dataExporter');
  console.log(`[training] Exporting data for ${modelId}...`);
  const exportResult = await exportTrainingData(sym, tf, request.dateRange);
  resolved.dataFile = exportResult.dataFile;
  console.log(`[training] Exported ${exportResult.totalBars} bars to ${exportResult.dataFile}`);
}
```

**Step 2: Add overlayInterval to hypMap in pythonRunner.ts**

In `src/server/training/runners/pythonRunner.ts`, add to the hypMap object (around line 40-51):

```typescript
overlayInterval: "--overlay-interval",
```

**Step 3: Verify data export works end-to-end**

Start dev server, make sure QuestDB is running, then test via:
```bash
curl -X POST http://localhost:5000/api/training/start -H "Content-Type: application/json" -d '{"modelType":"hdp-hmm","symbol":"ES","timeframe":"1h"}'
```

Expected: Should fail with "script not found" (Python script doesn't exist yet), but the data export step should succeed and log the parquet path. Check server console for `[training] Exported N bars to ...`.

**Step 4: Commit**

```bash
git add src/server/training/orchestrator.ts src/server/training/runners/pythonRunner.ts
git commit -m "feat(training): wire data export into orchestrator for Python models"
```

---

## Task 3: Create HDP-HMM stdout parser

**Files:**
- Create: `src/server/training/runners/parsers/hdpHmmParser.ts`
- Modify: `src/server/training/runners/parsers/index.ts:15`

**Step 1: Create the parser**

`src/server/training/runners/parsers/hdpHmmParser.ts`:

```typescript
/**
 * HDP-HMM Output Parser
 *
 * Parses structured JSON events from the HDP-HMM Python script.
 * Each stdout line is a JSON object with a "type" field matching
 * the universal training protocol (progress, metric, overlay, log, done, error).
 */

import type { TrainingSession } from '@shared/trainingTypes';
import { emitSessionEvent } from '../types';
import type { IOutputParser, ParserContext } from './types';

export class HdpHmmParser implements IOutputParser {
  parseLine(session: TrainingSession, line: string, ctx: ParserContext): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;

    // Try JSON parse — all HDP-HMM output is structured JSON
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Not JSON — emit as raw log
      emitSessionEvent(session, 'log', { message: trimmed, level: 'info' });
      return true;
    }

    const type = msg.type as string;
    if (!type) {
      emitSessionEvent(session, 'log', { message: trimmed, level: 'info' });
      return true;
    }

    switch (type) {
      case 'progress':
        emitSessionEvent(session, 'progress', {
          phase: msg.phase ?? 'gibbs_sampling',
          step: msg.iteration,
          totalSteps: msg.total,
          pct: msg.total ? ((msg.iteration as number) / (msg.total as number)) * 100 : 0,
          message: msg.message ?? `Iteration ${msg.iteration}/${msg.total}`,
        });
        break;

      case 'metric':
        emitSessionEvent(session, 'metric', {
          iteration: msg.iteration,
          totalIterations: msg.total,
          metrics: { [msg.name as string]: msg.value },
        });
        break;

      case 'overlay':
        emitSessionEvent(session, 'overlay', {
          overlayType: msg.overlayType ?? 'regime_zones',
          timestamps: msg.timestamps,
          assignments: msg.assignments,
          payload: msg.data ?? msg.payload,
        });
        break;

      case 'log':
        emitSessionEvent(session, 'log', {
          message: msg.message,
          level: msg.level ?? 'info',
        });
        break;

      case 'done':
        emitSessionEvent(session, 'done', {
          modelId: ctx.modelId,
          modelPath: msg.modelPath,
          elapsedSec: msg.elapsedSec,
          diagnostics: msg.diagnostics,
        });
        break;

      case 'error':
        emitSessionEvent(session, 'error', {
          message: msg.message,
          details: msg.details,
        });
        break;

      default:
        // Unknown type — emit as log
        emitSessionEvent(session, 'log', { message: trimmed, level: 'debug' });
    }

    return true;
  }
}
```

**Step 2: Register parser in the registry**

Modify `src/server/training/runners/parsers/index.ts`:

```typescript
import type { IOutputParser } from './types';
import { DefaultParser } from './defaultParser';
import { HdpHmmParser } from './hdpHmmParser';

export type { IOutputParser, ParserContext } from './types';

const defaultParser = new DefaultParser();

const PARSERS: Record<string, IOutputParser> = {
  'hdp-hmm': new HdpHmmParser(),
};

/** Get the parser for a model type, falling back to the default log-emitter. */
export function getParser(modelType: string): IOutputParser {
  return PARSERS[modelType] ?? defaultParser;
}
```

**Step 3: Commit**

```bash
git add src/server/training/runners/parsers/hdpHmmParser.ts src/server/training/runners/parsers/index.ts
git commit -m "feat(training): add HDP-HMM stdout parser with JSON event protocol"
```

---

## Task 4: Write HDP-HMM Python model

**Files:**
- Create: `src/ml/hdp_hmm.py`
- Create: `src/ml/requirements.txt` (if not exists)

This is the largest task. The Python script must:
1. Read raw OHLCV parquet
2. Compute features from OHLCV (returns, volatility, volume dynamics, price structure)
3. Normalize features (rolling z-score)
4. Train Sticky HDP-HMM via Gibbs sampling
5. Emit JSON events on stdout per the protocol
6. Save model artifacts to `data/models/<modelId>/`

**Step 1: Create the Python model script**

`src/ml/hdp_hmm.py` — Complete implementation. Key sections:

```python
#!/usr/bin/env python3
"""
Sticky HDP-HMM Regime Detection

Self-contained model: receives raw OHLCV parquet, computes features,
normalizes, trains via Gibbs sampling, emits JSON events on stdout.

Usage:
  python src/ml/hdp_hmm.py --symbol ES --timeframe 1h --data-file /tmp/data.parquet \
    --gibbs-iter 500 --burn-in 100 --alpha 1.0 --gamma 1.0 --kappa 50.0 \
    --test-split 0.15 --overlay-interval 25 --json

Stdout Protocol (JSON lines):
  {"type":"progress", "iteration":N, "total":M, "phase":"..."}
  {"type":"metric", "name":"...", "value":..., "iteration":N}
  {"type":"overlay", "overlayType":"regime_zones", "timestamps":[...], "assignments":[...]}
  {"type":"log", "level":"info|warn|error", "message":"..."}
  {"type":"done", "modelPath":"...", "diagnostics":{...}}
  {"type":"error", "message":"...", "details":"..."}
"""

import argparse
import json
import sys
import time
import os
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from scipy.special import logsumexp
from numba import njit

# ── Stdout Protocol ──────────────────────────────────────────────────────────

def emit(event: dict):
    """Write a JSON event to stdout (unbuffered)."""
    print(json.dumps(event, default=str), flush=True)

def emit_progress(iteration: int, total: int, phase: str = "gibbs_sampling"):
    emit({"type": "progress", "iteration": iteration, "total": total, "phase": phase})

def emit_metric(name: str, value, iteration: int, total: int = 0):
    emit({"type": "metric", "name": name, "value": float(value), "iteration": iteration, "total": total})

def emit_overlay(timestamps, assignments, regime_colors, regime_labels):
    emit({
        "type": "overlay",
        "overlayType": "regime_zones",
        "timestamps": [str(t) for t in timestamps],
        "assignments": [int(a) for a in assignments],
        "payload": {
            "colors": regime_colors,
            "labels": regime_labels,
        },
    })

def emit_log(message: str, level: str = "info"):
    emit({"type": "log", "level": level, "message": message})

def emit_done(model_path: str, diagnostics: dict):
    emit({"type": "done", "modelPath": model_path, "diagnostics": diagnostics})

def emit_error(message: str, details: str = ""):
    emit({"type": "error", "message": message, "details": details})

# ── Feature Computation ──────────────────────────────────────────────────────

def compute_features(df):
    """
    Compute features from raw OHLCV for regime discovery.
    The model decides what's relevant — no external constraint on feature count.

    Returns (feature_matrix, feature_names, timestamps).
    """
    close = df["close"].values.astype(np.float64)
    high = df["high"].values.astype(np.float64)
    low = df["low"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)
    open_ = df["open"].values.astype(np.float64)

    features = {}

    # Returns at multiple horizons
    for h in [1, 5, 10, 20]:
        features[f"return_{h}"] = np.concatenate([np.zeros(h), np.diff(np.log(close + 1e-10), n=h)])

    # Realized volatility (rolling std of returns)
    ret1 = features["return_1"]
    for w in [10, 20, 50]:
        vol = np.array([np.std(ret1[max(0,i-w):i]) if i >= w else np.nan for i in range(len(ret1))])
        features[f"volatility_{w}"] = vol

    # Range-based volatility (Parkinson)
    log_hl = np.log(high / (low + 1e-10))
    for w in [10, 20]:
        parkinson = np.array([
            np.sqrt(np.mean(log_hl[max(0,i-w):i]**2) / (4 * np.log(2)))
            if i >= w else np.nan
            for i in range(len(log_hl))
        ])
        features[f"parkinson_vol_{w}"] = parkinson

    # Volume dynamics
    vol_safe = np.where(volume > 0, volume, 1.0)
    features["volume_ratio_10"] = vol_safe / np.array([
        np.mean(vol_safe[max(0,i-10):i]) if i >= 10 else np.nan
        for i in range(len(vol_safe))
    ])
    features["volume_ratio_20"] = vol_safe / np.array([
        np.mean(vol_safe[max(0,i-20):i]) if i >= 20 else np.nan
        for i in range(len(vol_safe))
    ])

    # Price structure
    features["bar_range"] = (high - low) / (close + 1e-10)
    features["body_ratio"] = np.abs(close - open_) / (high - low + 1e-10)
    features["upper_shadow"] = (high - np.maximum(open_, close)) / (high - low + 1e-10)
    features["lower_shadow"] = (np.minimum(open_, close) - low) / (high - low + 1e-10)

    # Momentum (ROC)
    for h in [5, 10, 20]:
        roc = np.concatenate([np.zeros(h), (close[h:] - close[:-h]) / (close[:-h] + 1e-10)])
        features[f"roc_{h}"] = roc

    # Moving average distance
    for w in [10, 20, 50]:
        ma = np.convolve(close, np.ones(w)/w, mode='full')[:len(close)]
        ma[:w-1] = np.nan
        features[f"ma_dist_{w}"] = (close - ma) / (ma + 1e-10)

    # Stack into matrix, handling NaNs
    names = list(features.keys())
    matrix = np.column_stack([features[n] for n in names])

    # Get timestamps
    ts_col = "timestamp" if "timestamp" in df.column_names else "ts"
    timestamps = df[ts_col].to_pylist()

    return matrix, names, timestamps

def normalize_features(X, lookback=250):
    """Rolling z-score normalization. Clips to [-5, 5]."""
    X_norm = np.full_like(X, np.nan)
    for i in range(lookback, X.shape[0]):
        window = X[max(0, i-lookback):i]
        mu = np.nanmean(window, axis=0)
        sigma = np.nanstd(window, axis=0)
        sigma = np.where(sigma < 1e-10, 1.0, sigma)
        X_norm[i] = (X[i] - mu) / sigma
    X_norm = np.clip(X_norm, -5, 5)
    return X_norm

# ── Sticky HDP-HMM ──────────────────────────────────────────────────────────

@njit(cache=True)
def _forward_pass(log_lik, log_pi, log_A, T, K):
    """Forward pass for HMM (log-space). Returns log_alpha matrix."""
    log_alpha = np.full((T, K), -np.inf)
    log_alpha[0] = log_pi + log_lik[0]
    for t in range(1, T):
        for j in range(K):
            vals = np.empty(K)
            for i in range(K):
                vals[i] = log_alpha[t-1, i] + log_A[i, j]
            max_val = vals[0]
            for i in range(1, K):
                if vals[i] > max_val:
                    max_val = vals[i]
            sum_exp = 0.0
            for i in range(K):
                sum_exp += np.exp(vals[i] - max_val)
            log_alpha[t, j] = max_val + np.log(sum_exp) + log_lik[t, j]
    return log_alpha

@njit(cache=True)
def _backward_sample(log_lik, log_A, log_alpha, T, K):
    """Backward sampling pass. Returns state sequence."""
    states = np.empty(T, dtype=np.int64)
    # Sample last state
    log_p = log_alpha[T-1].copy()
    max_val = log_p[0]
    for i in range(1, K):
        if log_p[i] > max_val:
            max_val = log_p[i]
    sum_exp = 0.0
    for i in range(K):
        sum_exp += np.exp(log_p[i] - max_val)
    log_norm = max_val + np.log(sum_exp)
    probs = np.exp(log_p - log_norm)
    probs = probs / probs.sum()

    # Sample from categorical
    u = np.random.random()
    cum = 0.0
    states[T-1] = K - 1
    for i in range(K):
        cum += probs[i]
        if u < cum:
            states[T-1] = i
            break

    # Backward sweep
    for t in range(T-2, -1, -1):
        log_p = log_alpha[t] + log_A[:, states[t+1]]
        max_val = log_p[0]
        for i in range(1, K):
            if log_p[i] > max_val:
                max_val = log_p[i]
        sum_exp = 0.0
        for i in range(K):
            sum_exp += np.exp(log_p[i] - max_val)
        log_norm = max_val + np.log(sum_exp)
        probs = np.exp(log_p - log_norm)
        probs = probs / probs.sum()

        u = np.random.random()
        cum = 0.0
        states[t] = K - 1
        for i in range(K):
            cum += probs[i]
            if u < cum:
                states[t] = i
                break

    return states

class StickyHDPHMM:
    """
    Sticky Hierarchical Dirichlet Process Hidden Markov Model.

    Nonparametric Bayesian model for regime discovery:
    - Discovers number of regimes automatically (no K to set)
    - Sticky transitions: self-transition bias prevents rapid switching
    - Gibbs sampling for posterior inference
    """

    def __init__(self, alpha=1.0, gamma=1.0, kappa=50.0, max_states=20):
        self.alpha = alpha
        self.gamma = gamma
        self.kappa = kappa
        self.max_states = max_states

        self.K = max_states  # Truncation level for practical inference
        self.means = None
        self.covs = None
        self.transition_matrix = None
        self.state_sequence = None
        self.log_likelihoods = []

    def _init_params(self, X):
        """Initialize parameters using K-means seeding."""
        T, D = X.shape
        K = self.K

        # Initialize emission parameters (means + diagonal covariances)
        # Use K-means++ style seeding
        indices = np.random.choice(T, size=min(K, T), replace=False)
        self.means = X[indices].copy()
        if K > T:
            self.means[T:] = X[np.random.choice(T, size=K-T)].copy()

        self.covs = np.array([np.eye(D) * np.var(X, axis=0) for _ in range(K)])

        # Initialize transition matrix with sticky bias
        beta = np.random.dirichlet(np.ones(K) * self.gamma / K)
        self.transition_matrix = np.zeros((K, K))
        for i in range(K):
            alpha_vec = self.alpha * beta.copy()
            alpha_vec[i] += self.kappa  # Sticky bias
            self.transition_matrix[i] = np.random.dirichlet(alpha_vec + 1e-10)

        # Initialize state sequence uniformly
        self.state_sequence = np.random.randint(0, K, size=T)

        # Initial stationary distribution
        self.pi = np.ones(K) / K

    def _compute_log_likelihood(self, X):
        """Compute log emission probability for each state at each time."""
        T, D = X.shape
        K = self.K
        log_lik = np.full((T, K), -np.inf)

        for k in range(K):
            diff = X - self.means[k]
            cov = self.covs[k]
            # Diagonal covariance for speed
            diag = np.diag(cov)
            diag = np.maximum(diag, 1e-6)
            log_det = np.sum(np.log(diag))
            inv_diag = 1.0 / diag
            mahal = np.sum(diff**2 * inv_diag[None, :], axis=1)
            log_lik[:, k] = -0.5 * (D * np.log(2 * np.pi) + log_det + mahal)

        return log_lik

    def _sample_states(self, X, log_lik):
        """Forward-filtering backward-sampling for state sequence."""
        log_A = np.log(self.transition_matrix + 1e-300)
        log_pi = np.log(self.pi + 1e-300)
        T = X.shape[0]
        K = self.K

        log_alpha = _forward_pass(log_lik, log_pi, log_A, T, K)
        states = _backward_sample(log_lik, log_A, log_alpha, T, K)

        # Compute log-likelihood of data under current model
        final_alpha = log_alpha[T-1]
        max_val = np.max(final_alpha)
        total_ll = max_val + np.log(np.sum(np.exp(final_alpha - max_val)))

        return states, total_ll

    def _update_emission(self, X, states):
        """Update emission parameters given state assignments."""
        T, D = X.shape
        for k in range(self.K):
            mask = states == k
            n_k = np.sum(mask)
            if n_k > D + 1:
                X_k = X[mask]
                self.means[k] = np.mean(X_k, axis=0)
                diff = X_k - self.means[k]
                self.covs[k] = np.diag(np.var(diff, axis=0) + 1e-4)
            elif n_k > 0:
                X_k = X[mask]
                self.means[k] = np.mean(X_k, axis=0)
                # Keep prior covariance for small clusters

    def _update_transitions(self, states):
        """Update transition matrix with sticky Dirichlet prior."""
        K = self.K
        counts = np.zeros((K, K))
        for t in range(len(states) - 1):
            counts[states[t], states[t+1]] += 1

        # Compute global weights (beta) from state frequencies
        state_counts = np.zeros(K)
        for s in states:
            state_counts[s] += 1
        beta = state_counts / (len(states) + 1e-10)
        beta = np.maximum(beta, 1e-10)

        # Sample transition rows with sticky bias
        for i in range(K):
            alpha_vec = self.alpha * beta + counts[i]
            alpha_vec[i] += self.kappa  # Sticky
            alpha_vec = np.maximum(alpha_vec, 1e-10)
            self.transition_matrix[i] = np.random.dirichlet(alpha_vec)

        # Update stationary distribution
        self.pi = state_counts / (np.sum(state_counts) + 1e-10)

    def fit(self, X, n_iter=500, burn_in=100, overlay_interval=25, timestamps=None):
        """
        Fit the model via Gibbs sampling.
        Emits JSON events on stdout for the dashboard.
        """
        T, D = X.shape
        emit_log(f"Starting Gibbs sampling: {n_iter} iterations, {T} bars, {D} features")

        self._init_params(X)

        # Collect post-burn-in samples for averaging
        state_samples = []

        t_start = time.time()

        for it in range(1, n_iter + 1):
            # 1. Compute emission log-likelihoods
            log_lik = self._compute_log_likelihood(X)

            # 2. Sample state sequence
            states, total_ll = self._sample_states(X, log_lik)
            self.state_sequence = states
            self.log_likelihoods.append(total_ll)

            # 3. Update emission parameters
            self._update_emission(X, states)

            # 4. Update transition matrix
            self._update_transitions(states)

            # Count active regimes (states with > 1% of bars)
            unique, counts = np.unique(states, return_counts=True)
            active = unique[counts > max(1, T * 0.01)]
            n_active = len(active)

            # Collect post-burn-in
            if it > burn_in:
                state_samples.append(states.copy())

            # Emit events
            emit_progress(it, n_iter, "gibbs_sampling")
            emit_metric("log_likelihood", total_ll, it, n_iter)
            emit_metric("num_regimes", n_active, it, n_iter)

            # Emit overlay at intervals
            if timestamps is not None and it % overlay_interval == 0:
                # Relabel to contiguous 0..N-1
                relabeled, colors, labels = self._relabel_states(states, X)
                emit_overlay(timestamps, relabeled, colors, labels)

            # Periodic log
            if it % 50 == 0:
                elapsed = time.time() - t_start
                iter_per_sec = it / elapsed
                eta = (n_iter - it) / iter_per_sec
                emit_log(f"Iter {it}/{n_iter} | LL={total_ll:.1f} | K={n_active} | {iter_per_sec:.1f} it/s | ETA {eta:.0f}s")

        # Average state assignments from post-burn-in samples
        if state_samples:
            # Mode assignment per timestep across samples
            sample_matrix = np.array(state_samples)
            final_states = np.zeros(T, dtype=np.int64)
            for t in range(T):
                vals, cnts = np.unique(sample_matrix[:, t], return_counts=True)
                final_states[t] = vals[np.argmax(cnts)]
            self.state_sequence = final_states

        elapsed = time.time() - t_start
        emit_log(f"Training complete: {elapsed:.1f}s, {n_active} regimes discovered")

        return self

    def _relabel_states(self, states, X):
        """Relabel states to contiguous 0..N-1 ordered by frequency. Return colors + labels."""
        unique, counts = np.unique(states, return_counts=True)
        # Filter out tiny regimes (< 1% of bars)
        T = len(states)
        mask = counts > max(1, T * 0.01)
        active = unique[mask]
        active_counts = counts[mask]

        # Sort by frequency (most common first)
        order = np.argsort(-active_counts)
        active = active[order]

        # Build label map
        label_map = {}
        for new_id, old_id in enumerate(active):
            label_map[int(old_id)] = new_id

        # Relabel
        relabeled = np.array([label_map.get(int(s), -1) for s in states])
        # Assign -1 states to nearest active regime
        for i in range(len(relabeled)):
            if relabeled[i] == -1:
                relabeled[i] = relabeled[max(0, i-1)]

        n_regimes = len(active)

        # Compute regime characteristics for labels
        COLORS = [
            "#4CAF50", "#2196F3", "#FF9800", "#E91E63", "#9C27B0",
            "#00BCD4", "#FFEB3B", "#795548", "#607D8B", "#F44336",
            "#8BC34A", "#3F51B5", "#FF5722", "#009688", "#CDDC39",
            "#673AB7", "#FFC107", "#03A9F4", "#FF4081", "#00E676",
        ]

        colors = {}
        labels = {}
        for new_id, old_id in enumerate(active):
            mask = states == old_id
            if np.any(mask):
                regime_returns = X[mask, 0] if X.shape[1] > 0 else np.zeros(np.sum(mask))
                mean_ret = np.mean(regime_returns)
                vol = np.std(regime_returns)

                if mean_ret > 0.001 and vol < 0.01:
                    label = "Low Vol Bull"
                elif mean_ret > 0.001:
                    label = "High Vol Bull"
                elif mean_ret < -0.001 and vol < 0.01:
                    label = "Low Vol Bear"
                elif mean_ret < -0.001:
                    label = "High Vol Bear"
                elif vol < 0.005:
                    label = "Quiet Range"
                elif vol > 0.02:
                    label = "High Volatility"
                else:
                    label = f"Regime {new_id}"
            else:
                label = f"Regime {new_id}"

            colors[str(new_id)] = COLORS[new_id % len(COLORS)]
            labels[str(new_id)] = label

        return relabeled, colors, labels

# ── Model Output ─────────────────────────────────────────────────────────────

def save_model(model, timestamps, features, feature_names, args, elapsed):
    """Save model artifacts to data/models/<modelId>/"""
    project_root = Path(__file__).parent.parent.parent
    model_id = f"{args.symbol}_{args.timeframe}"
    output_dir = project_root / "data" / "models" / model_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # Final relabeled assignments
    relabeled, colors, labels = model._relabel_states(model.state_sequence, features)
    n_regimes = len(set(relabeled))

    # 1. Save regimes.parquet (ts, close, regime, regime_label, split)
    import pyarrow as pa

    T = len(timestamps)
    split_idx = int(T * (1 - args.test_split))
    splits = ["train"] * split_idx + ["test"] * (T - split_idx)
    regime_label_list = [labels.get(str(r), f"Regime {r}") for r in relabeled]

    # Get close prices from the original data
    table = pq.read_table(args.data_file, columns=["timestamp" if "timestamp" in pq.read_schema(args.data_file).names else "ts", "close"])
    close_vals = table.column("close").to_pylist()
    ts_col = "timestamp" if "timestamp" in table.column_names else "ts"
    ts_vals = table.column(ts_col).to_pylist()

    regime_table = pa.table({
        "ts": ts_vals[:T],
        "close": [float(c) for c in close_vals[:T]],
        "regime": [int(r) for r in relabeled],
        "regime_label": regime_label_list,
        "split": splits,
    })
    pq.write_table(regime_table, str(output_dir / "regimes.parquet"))

    # 2. Save convergence.json
    convergence = {
        "log_likelihoods": [float(ll) for ll in model.log_likelihoods],
        "n_iterations": len(model.log_likelihoods),
    }
    with open(output_dir / "convergence.json", "w") as f:
        json.dump(convergence, f)

    # 3. Save diagnostics.json
    unique, counts = np.unique(relabeled, return_counts=True)
    regime_profiles = {}
    for uid, cnt in zip(unique, counts):
        mask = relabeled == uid
        regime_features = features[mask]
        regime_profiles[str(int(uid))] = {
            "label": labels.get(str(uid), f"Regime {uid}"),
            "color": colors.get(str(uid), "#888"),
            "count": int(cnt),
            "pct": float(cnt / T * 100),
            "mean_return": float(np.mean(regime_features[:, 0])) if regime_features.shape[1] > 0 else 0,
            "volatility": float(np.std(regime_features[:, 0])) if regime_features.shape[1] > 0 else 0,
        }

    # Quality score (simple heuristic: stability + separation)
    # Higher is better: more stable regimes + better separated
    transition_self = np.mean([model.transition_matrix[i, i] for i in range(model.K)
                               if np.sum(model.state_sequence == i) > T * 0.01])
    quality_score = min(100, max(0, int(transition_self * 80 + n_regimes * 5)))

    diagnostics = {
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "n_regimes": n_regimes,
        "n_bars": T,
        "n_bars_total": T,
        "n_bars_train_val": split_idx,
        "n_bars_test": T - split_idx,
        "quality_score": quality_score,
        "date_range": {
            "start": str(timestamps[0]),
            "end": str(timestamps[-1]),
        },
        "training_config": {
            "gibbs_iter": args.gibbs_iter,
            "burn_in": args.burn_in,
            "alpha": args.alpha,
            "gamma": args.gamma,
            "kappa": args.kappa,
            "test_split": args.test_split,
        },
        "training_time_sec": elapsed,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "features_used": feature_names,
        "n_features": len(feature_names),
        "regime_profiles": regime_profiles,
        "transition_matrix": model.transition_matrix[:n_regimes, :n_regimes].tolist(),
    }
    with open(output_dir / "diagnostics.json", "w") as f:
        json.dump(diagnostics, f, indent=2)

    return str(output_dir).replace("\\", "/"), diagnostics

# ── CLI ──────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="Sticky HDP-HMM Regime Detection")
    parser.add_argument("--symbol", required=True, help="Trading symbol (e.g., ES)")
    parser.add_argument("--timeframe", required=True, help="Timeframe (e.g., 1h)")
    parser.add_argument("--data-file", required=True, help="Path to OHLCV parquet file")
    parser.add_argument("--gibbs-iter", type=int, default=500, help="Number of Gibbs iterations")
    parser.add_argument("--burn-in", type=int, default=100, help="Burn-in iterations to discard")
    parser.add_argument("--alpha", type=float, default=1.0, help="State-level DP concentration")
    parser.add_argument("--gamma", type=float, default=1.0, help="Top-level DP concentration")
    parser.add_argument("--kappa", type=float, default=50.0, help="Sticky self-transition bias")
    parser.add_argument("--test-split", type=float, default=0.15, help="Test split ratio")
    parser.add_argument("--overlay-interval", type=int, default=25, help="Overlay emit interval")
    parser.add_argument("--json", action="store_true", help="JSON output mode (required)")
    return parser.parse_args()

def main():
    args = parse_args()
    t_start = time.time()

    try:
        # 1. Load data
        emit_log(f"Loading data from {args.data_file}")
        emit_progress(0, args.gibbs_iter, "loading_data")

        table = pq.read_table(args.data_file)
        df = table
        n_bars = len(table)
        emit_log(f"Loaded {n_bars} bars for {args.symbol} {args.timeframe}")

        if n_bars < 100:
            emit_error(f"Insufficient data: {n_bars} bars (need >= 100)")
            sys.exit(1)

        # 2. Compute features
        emit_progress(0, args.gibbs_iter, "computing_features")
        emit_log("Computing features from raw OHLCV...")
        X_raw, feature_names, timestamps = compute_features(df)
        emit_log(f"Computed {len(feature_names)} features: {', '.join(feature_names[:5])}...")

        # 3. Normalize
        emit_progress(0, args.gibbs_iter, "normalizing")
        emit_log("Normalizing features (rolling z-score)...")
        X = normalize_features(X_raw, lookback=250)

        # Drop rows with NaN (warmup period)
        valid_mask = ~np.any(np.isnan(X), axis=1)
        X_valid = X[valid_mask]
        timestamps_valid = [t for t, v in zip(timestamps, valid_mask) if v]
        features_valid = X_raw[valid_mask]

        emit_log(f"After normalization: {len(X_valid)} valid bars ({n_bars - len(X_valid)} warmup dropped)")

        if len(X_valid) < 100:
            emit_error(f"Insufficient valid data after normalization: {len(X_valid)} bars")
            sys.exit(1)

        # 4. Train
        model = StickyHDPHMM(
            alpha=args.alpha,
            gamma=args.gamma,
            kappa=args.kappa,
        )
        model.fit(
            X_valid,
            n_iter=args.gibbs_iter,
            burn_in=args.burn_in,
            overlay_interval=args.overlay_interval,
            timestamps=timestamps_valid,
        )

        # 5. Save
        emit_progress(args.gibbs_iter, args.gibbs_iter, "saving")
        elapsed = time.time() - t_start
        model_path, diagnostics = save_model(
            model, timestamps_valid, features_valid, feature_names, args, elapsed,
        )

        # 6. Final overlay with all timestamps
        relabeled, colors, labels = model._relabel_states(model.state_sequence, features_valid)
        emit_overlay(timestamps_valid, relabeled, colors, labels)

        # 7. Done
        emit_done(model_path, diagnostics)

    except Exception as e:
        import traceback
        emit_error(str(e), traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    main()
```

**Step 2: Delete stale __pycache__**

```bash
rm -rf src/ml/hdp_hmm/__pycache__
```

The old compiled bytecache is from a deleted implementation and should be cleaned up.

**Step 3: Create/verify Python dependencies**

Check that the venv has the required packages:

```bash
.venv/Scripts/python.exe -c "import numpy, scipy, numba, pyarrow; print('All deps available')"
```

If any are missing:
```bash
.venv/Scripts/pip install numpy scipy numba pyarrow
```

**Step 4: Smoke test the script standalone**

First export a test parquet manually, then run the script:

```bash
# The script needs a data file — we'll test the full pipeline in Task 6
.venv/Scripts/python.exe src/ml/hdp_hmm.py --symbol ES --timeframe 1h --data-file test.parquet --gibbs-iter 5 --json 2>&1 | head -20
```

This will fail without a valid parquet file — that's expected. The point is to verify the script starts and emits proper JSON before `pq.read_table` fails.

**Step 5: Commit**

```bash
git add src/ml/hdp_hmm.py
git commit -m "feat(ml): implement Sticky HDP-HMM regime detection model"
```

---

## Task 5: Add Training Log Tab to Market Data Terminal

The terminal in ChartPanel currently shows only PTY tabs. Add a "Training" tab that subscribes to the SSE stream and renders formatted training events.

**Files:**
- Create: `src/client/src/components/terminal/TrainingLogTab.tsx`
- Modify: `src/client/src/components/terminal/TerminalTabs.tsx`
- Modify: `src/client/src/pages/market-data/ChartPanel.tsx:141-142`

**Step 1: Create TrainingLogTab component**

`src/client/src/components/terminal/TrainingLogTab.tsx`:

```tsx
/**
 * TrainingLogTab — Read-only training log viewer.
 *
 * Subscribes to the training SSE stream and renders formatted events
 * in an xterm.js terminal (no PTY — just writes formatted text).
 * Auto-activates when training starts.
 */
import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTrainingContext } from "@/contexts/TrainingContext";

const THEME = {
  background: "#0a0a0a",
  foreground: "#c9d1d9",
  cursor: "#0a0a0a", // Hidden cursor (read-only)
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d353",
  white: "#c9d1d9",
  brightBlack: "#6e7681",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightRed: "#ffa198",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d364",
  brightWhite: "#f0f6fc",
};

// ANSI color codes
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
};

interface TrainingLogTabProps {
  visible?: boolean;
}

export function TrainingLogTab({ visible = true }: TrainingLogTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const training = useTrainingContext();
  const lastEventIdx = useRef(0);

  // Initialize xterm (read-only, no input)
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: THEME,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: "underline",
      scrollback: 10_000,
      disableStdin: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    term.open(containerRef.current);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fit.fit());
    });

    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Resize handling
  useEffect(() => {
    if (!containerRef.current || !fitRef.current) return;
    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch {}
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Re-fit when visibility changes
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => fitRef.current?.fit());
    }
  }, [visible]);

  // Format and write training events
  const writeEvent = useCallback((type: string, data: Record<string, unknown>) => {
    const term = termRef.current;
    if (!term) return;

    switch (type) {
      case "started":
        term.writeln(`${C.bold}${C.green}▶ Training started${C.reset} ${C.dim}${data.modelType} | ${data.symbol} ${data.timeframe}${C.reset}`);
        term.writeln("");
        break;

      case "progress": {
        const pct = Math.round(data.pct as number || 0);
        const filled = Math.round(pct / 5);
        const bar = "█".repeat(filled) + "░".repeat(20 - filled);
        const phase = data.phase || "training";
        term.write(`\r${C.cyan}[${bar}]${C.reset} ${C.bold}${pct}%${C.reset} ${C.dim}${data.step}/${data.totalSteps} ${phase}${C.reset}`);
        break;
      }

      case "metric": {
        const metrics = data.metrics as Record<string, number> || {};
        for (const [name, value] of Object.entries(metrics)) {
          const formatted = typeof value === "number" ? value.toFixed(4) : String(value);
          const color = name === "log_likelihood" ? C.blue : name === "num_regimes" ? C.magenta : C.white;
          term.writeln(`  ${color}${name}${C.reset}: ${C.bold}${formatted}${C.reset}`);
        }
        break;
      }

      case "overlay":
        term.writeln(`\r${C.green}◆ Regime update${C.reset} ${C.dim}overlay refreshed${C.reset}`);
        break;

      case "log": {
        const level = data.level as string || "info";
        const color = level === "error" ? C.red : level === "warn" ? C.yellow : C.dim;
        term.writeln(`${color}${data.message}${C.reset}`);
        break;
      }

      case "done":
        term.writeln("");
        term.writeln(`${C.bold}${C.green}✓ Training complete${C.reset}`);
        if (data.elapsedSec) {
          term.writeln(`${C.dim}  Elapsed: ${(data.elapsedSec as number).toFixed(1)}s${C.reset}`);
        }
        break;

      case "error":
        term.writeln(`${C.bold}${C.red}✗ Error: ${data.message}${C.reset}`);
        if (data.details) {
          term.writeln(`${C.dim}${C.red}${data.details}${C.reset}`);
        }
        break;
    }
  }, []);

  // Subscribe to training events via logs from context
  useEffect(() => {
    if (!training.isTraining && !training.completedModelId) {
      // Reset for next training run
      lastEventIdx.current = 0;
      return;
    }

    // Write header when training starts
    if (training.isTraining && lastEventIdx.current === 0) {
      const term = termRef.current;
      if (term) {
        term.clear();
        writeEvent("started", {
          modelType: training.modelType,
          symbol: training.config?.symbol,
          timeframe: training.config?.timeframe,
        });
      }
    }

    // Process new log entries
    const logs = training.logs || [];
    for (let i = lastEventIdx.current; i < logs.length; i++) {
      const log = logs[i];
      if (log) {
        writeEvent(log.type || "log", log.data || { message: log.message, level: log.level });
      }
    }
    lastEventIdx.current = logs.length;
  }, [training.isTraining, training.logs, training.completedModelId, writeEvent]);

  return (
    <div
      style={{
        flex: "1 1 0%",
        minHeight: 0,
        width: "100%",
        display: visible ? "flex" : "none",
        flexDirection: "column",
      }}
    >
      <div
        ref={containerRef}
        style={{ flex: "1 1 0%", minHeight: 0, padding: "4px 0 0 4px" }}
      />
    </div>
  );
}
```

**Step 2: Add Training tab to TerminalTabs**

Modify `src/client/src/components/terminal/TerminalTabs.tsx`.

Add import at top (after line 15):
```typescript
import { TrainingLogTab } from "./TrainingLogTab";
import { useTrainingContext } from "@/contexts/TrainingContext";
```

Add props to the component interface (replace `TerminalTabsProps`):
```typescript
interface TerminalTabsProps {
  visible?: boolean;
  /** Show training log tab alongside PTY tabs */
  showTrainingTab?: boolean;
}
```

Inside the component, add training context:
```typescript
const training = useTrainingContext();
const showTraining = showTrainingTab || training.isTraining;
```

Add a fixed "Training" tab in the tab bar (before the + button, after the PTY tabs map):
```tsx
{/* Training log tab (fixed, not closeable) */}
{showTraining && (
  <button
    onClick={() => setActiveTabId("__training__")}
    style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 12px', fontSize: '11px', fontFamily: 'monospace',
      borderRight: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
      cursor: 'pointer', border: 'none',
      background: activeTabId === "__training__" ? '#0a0a0a' : 'transparent',
      color: activeTabId === "__training__" ? '#f59e0b' : '#888',
      borderBottom: activeTabId === "__training__" ? '2px solid rgba(245,158,11,0.5)' : '2px solid transparent',
    }}
  >
    <TerminalSquare style={{ width: 12, height: 12 }} />
    <span>Training</span>
    {training.isTraining && (
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
    )}
  </button>
)}
```

Add the TrainingLogTab after the PTY terminal map (after existing `tabs.map`):
```tsx
{/* Training log terminal */}
{showTraining && (
  <TrainingLogTab visible={activeTabId === "__training__"} />
)}
```

Auto-switch to training tab when training starts:
```typescript
useEffect(() => {
  if (training.isTraining) {
    setActiveTabId("__training__");
  }
}, [training.isTraining]);
```

**Step 3: Pass showTrainingTab prop from ChartPanel**

In `src/client/src/pages/market-data/ChartPanel.tsx`, line 142, update TerminalTabs:
```tsx
<TerminalTabs showTrainingTab />
```

**Step 4: Commit**

```bash
git add src/client/src/components/terminal/TrainingLogTab.tsx src/client/src/components/terminal/TerminalTabs.tsx src/client/src/pages/market-data/ChartPanel.tsx
git commit -m "feat(ui): add training log tab to market data terminal"
```

---

## Task 6: Overhaul Training Center Live Panels

Replace stubby panels in the Training page with real SSE-driven visualizations.

**Files:**
- Create: `src/client/src/components/training/live/ConvergenceChart.tsx`
- Create: `src/client/src/components/training/live/RegimeCountTracker.tsx`
- Create: `src/client/src/components/training/live/TransitionMatrixHeatmap.tsx`
- Create: `src/client/src/components/training/live/IterationMetrics.tsx`
- Create: `src/client/src/components/training/live/index.tsx` (barrel + layout)
- Modify: `src/client/src/pages/Training.tsx` (wire live panels)

This task is large and should be broken into sub-steps. Each panel is independent and can be built in parallel.

**Step 1: Create ConvergenceChart**

`src/client/src/components/training/live/ConvergenceChart.tsx`:

A Recharts line chart showing log-likelihood over iterations, updating live from TrainingLiveCtx. Shows the model's fit improving as the Gibbs sampler runs.

- X-axis: iteration number
- Y-axis: log-likelihood
- Auto-scrolling window (last 200 points visible, zoom out on complete)
- Line color: blue for ongoing, green for converged
- Reference line at burn-in mark

**Step 2: Create RegimeCountTracker**

`src/client/src/components/training/live/RegimeCountTracker.tsx`:

Small Recharts area chart showing how many regimes the model has discovered over iterations. Shows the model exploring (count fluctuates) then settling (count stabilizes).

- X-axis: iteration
- Y-axis: regime count (integer)
- Color: magenta gradient fill

**Step 3: Create TransitionMatrixHeatmap**

`src/client/src/components/training/live/TransitionMatrixHeatmap.tsx`:

N×N grid rendered with CSS grid or D3. Each cell shows the transition probability from state i to state j. Updates when overlay events arrive (every `overlayInterval` iterations).

- Diagonal is bright (self-transitions, sticky behavior)
- Off-diagonal fades with lower probability
- Size adapts to number of active regimes
- Color scale: dark → bright green

**Step 4: Create IterationMetrics**

`src/client/src/components/training/live/IterationMetrics.tsx`:

Compact metric cards showing: current iteration, elapsed time, iterations/sec, ETA, active regimes. Purely numeric, updates every event.

**Step 5: Create barrel + LiveTrainingDashboard layout**

`src/client/src/components/training/live/index.tsx`:

Grid layout composing all four panels:
```
┌───────────────┬───────────────┐
│ Convergence   │ Regime Count  │
│ Chart         │ Tracker       │
├───────────────┼───────────────┤
│ Transition    │ Iteration     │
│ Matrix        │ Metrics       │
└───────────────┴───────────────┘
```

Only renders when `training.isTraining` is true.

**Step 6: Wire into Training page**

In `src/client/src/pages/Training.tsx`, import and render `LiveTrainingDashboard` above the existing ModelTabs when training is active.

**Step 7: Commit**

```bash
git add src/client/src/components/training/live/ src/client/src/pages/Training.tsx
git commit -m "feat(ui): add live training analytics dashboard to Training Center"
```

---

## Task 7: Verify Chart Overlay Wiring End-to-End

The chart overlay system is 90% built. This task verifies that overlay events from the Python model actually paint regime zones on the chart.

**Files:**
- Read: `src/client/src/hooks/useTrainingSync.ts`
- Read: `src/client/src/pages/market-data/useChartOverlayData.ts`
- Read: `src/client/src/hooks/useTraining.ts` (overlay event handling)
- Possibly modify: event shapes if there's a mismatch

**Step 1: Trace the overlay data flow**

Verify this chain works:
1. Python emits `{"type":"overlay", "overlayType":"regime_zones", "timestamps":[...], "assignments":[...]}`
2. HdpHmmParser converts to `emitSessionEvent(session, 'overlay', {overlayType, timestamps, assignments, payload})`
3. SSE stream sends `event: overlay\ndata: {...}\n\n`
4. `useTrainingSSE` receives event, calls `onOverlay` callback
5. `useTraining` stores overlay data in state (`liveRegimeTimestamps`, `liveRegimeAssignments`)
6. `TrainingContext` propagates to consumers
7. `useTrainingSync` reads overlay data, feeds to `useChartOverlayData`
8. `ChartPanel` receives `regimeColorMap` prop
9. `IndicatorChartLayout` paints colored candle backgrounds

**Step 2: Check for shape mismatches**

The overlay payload from Python sends `timestamps` as ISO strings and `assignments` as integers. Verify the client hooks expect these exact shapes.

Read `useTraining.ts`'s `onOverlay` handler to see what fields it reads from `SSEOverlayData`.

**Step 3: Fix any mismatches found**

If the shapes don't match (e.g., client expects `data.timestamps` but parser sends `data.payload.timestamps`), fix the parser or the hook to align.

**Step 4: Manual end-to-end test**

Start the dev server, navigate to Market Data, select ES 1h, press Train. Observe:
1. Terminal "Training" tab activates and shows formatted log output
2. Chart starts showing regime-colored zones after first overlay event
3. Training Center shows live convergence chart
4. Training completes, model appears in ModelTabs

**Step 5: Commit any fixes**

```bash
git add -u
git commit -m "fix(training): align overlay event shapes between Python model and client hooks"
```

---

## Task 8: Clean Up Stale Bytecache + Final Integration Test

**Files:**
- Delete: `src/ml/hdp_hmm/__pycache__/` (stale compiled bytecode from deleted old implementation)

**Step 1: Remove stale bytecache**

```bash
rm -rf src/ml/hdp_hmm/__pycache__
rmdir src/ml/hdp_hmm
```

The old `__pycache__` directory contains compiled `.pyc` and Numba `.nbc` files from a deleted implementation. The new model lives at `src/ml/hdp_hmm.py` (a file, not a package directory).

**Step 2: Full integration test**

1. Start QuestDB: `node electron/start-databases.cjs`
2. Start dev server: `npm run dev`
3. Navigate to Market Data page
4. Select symbol ES, timeframe 1h
5. Press Train button
6. Verify:
   - Terminal switches to Training tab, shows formatted progress
   - Training Center shows live convergence chart
   - Chart starts painting regime zones after ~25 iterations
   - Training completes after configured iterations
   - Model appears in data/models/ES_1h/
   - diagnostics.json, convergence.json, regimes.parquet all present
   - Chart shows final regime overlay
   - ModelTabs in Training page shows the new model

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete HDP-HMM training pipeline — press Train to see live regime discovery"
```

---

## Summary: Task Dependencies

```
Task 1: models.json (no deps)
Task 2: orchestrator data export (needs Task 1)
Task 3: stdout parser (no deps)
Task 4: Python model (no deps, but needs Task 1-3 to test end-to-end)
Task 5: training log tab (no deps)
Task 6: training center panels (no deps)
Task 7: overlay verification (needs Tasks 1-6)
Task 8: cleanup + integration test (needs all)
```

Parallelizable groups:
- **Group A** (server): Tasks 1, 2, 3 (sequential — config → export → parser)
- **Group B** (Python): Task 4 (independent, largest single task)
- **Group C** (client): Tasks 5, 6 (independent of each other and server work)
- **Group D** (integration): Tasks 7, 8 (after A+B+C)
