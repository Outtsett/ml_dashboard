#!/usr/bin/env python3
"""
Sticky HDP-HMM Regime Detection  (Fox et al. 2011 / Teh et al. 2006)

True non-parametric Bayesian regime discovery via truncated Gibbs sampling:
  - GEM stick-breaking for global base measure beta
  - CRF auxiliary-variable sampling for beta updates (Teh et al. 2006)
  - Override variables for sticky self-transition bias (Fox et al. 2011)
  - Normal-Inverse-Gamma conjugate posterior for emission parameters
  - Numba-JIT forward-filtering backward-sampling for state sequence

Usage:
  python src/ml/hdp_hmm.py --symbol ES --timeframe 1h \
    --gibbs-iter 500 --burn-in 100 --alpha 1.0 --gamma 1.0 --kappa 50.0 \
    --test-split 0.15 --overlay-interval 25 --json
"""

import argparse
import os
import sys
import time

import numpy as np
import pyarrow as pa
from numba import njit

# SRP: Protocol, features, and I/O are separate modules
from protocol import emit_progress, emit_metric, emit_overlay, emit_log, emit_done, emit_error
from features import compute_features, normalize_features
from model_io import relabel_states, save_model


# ── Numba-JIT Forward-Backward ──────────────────────────────────────────────

@njit(cache=True)
def _forward_pass(log_lik, log_pi, log_A, T, K):
    """Forward pass for HMM (log-space). Returns log_alpha matrix."""
    log_alpha = np.full((T, K), -np.inf)
    log_alpha[0] = log_pi + log_lik[0]
    for t in range(1, T):
        for j in range(K):
            max_val = -np.inf
            for i in range(K):
                v = log_alpha[t - 1, i] + log_A[i, j]
                if v > max_val:
                    max_val = v
            sum_exp = 0.0
            for i in range(K):
                sum_exp += np.exp(log_alpha[t - 1, i] + log_A[i, j] - max_val)
            log_alpha[t, j] = max_val + np.log(sum_exp + 1e-300) + log_lik[t, j]
    return log_alpha


@njit(cache=True)
def _backward_sample(log_lik, log_A, log_alpha, T, K):
    """Backward sampling pass. Returns state sequence."""
    states = np.empty(T, dtype=np.int64)

    # Sample last state
    log_p = log_alpha[T - 1].copy()
    max_val = log_p[0]
    for i in range(1, K):
        if log_p[i] > max_val:
            max_val = log_p[i]
    sum_exp = 0.0
    for i in range(K):
        sum_exp += np.exp(log_p[i] - max_val)
    log_norm = max_val + np.log(sum_exp + 1e-300)
    probs = np.exp(log_p - log_norm)
    total = 0.0
    for i in range(K):
        total += probs[i]
    for i in range(K):
        probs[i] /= (total + 1e-300)

    u = np.random.random()
    cum = 0.0
    states[T - 1] = K - 1
    for i in range(K):
        cum += probs[i]
        if u < cum:
            states[T - 1] = i
            break

    # Backward sweep
    for t in range(T - 2, -1, -1):
        for i in range(K):
            log_p[i] = log_alpha[t, i] + log_A[i, states[t + 1]]
        max_val = log_p[0]
        for i in range(1, K):
            if log_p[i] > max_val:
                max_val = log_p[i]
        sum_exp = 0.0
        for i in range(K):
            sum_exp += np.exp(log_p[i] - max_val)
        log_norm = max_val + np.log(sum_exp + 1e-300)
        probs = np.exp(log_p - log_norm)
        total = 0.0
        for i in range(K):
            total += probs[i]
        for i in range(K):
            probs[i] /= (total + 1e-300)

        u = np.random.random()
        cum = 0.0
        states[t] = K - 1
        for i in range(K):
            cum += probs[i]
            if u < cum:
                states[t] = i
                break

    return states


# ── Sticky HDP-HMM Model  (Fox et al. 2011 / Teh et al. 2006) ─────────────

class StickyHDPHMM:
    """
    Sticky Hierarchical Dirichlet Process Hidden Markov Model.

    True non-parametric Bayesian regime discovery using truncated Gibbs sampling:

      Generative model (Fox et al. 2011):
        beta | gamma         ~ GEM(gamma)              # global base measure
        pi_j | alpha,beta,kappa ~ Dir(alpha*beta + kappa*delta_j)  # sticky rows
        (mu_k, sigma2_k) | H ~ NIG(mu_0, lambda_0, a_0, b_0)     # emissions
        z_t | z_{t-1}        ~ Cat(pi_{z_{t-1}})       # state sequence
        y_t | z_t            ~ N(mu_{z_t}, diag(sigma2_{z_t}))    # observations

      Gibbs sampler steps per iteration:
        1. Sample z_{1:T}          — forward-filtering backward-sampling (numba JIT)
        2. Sample (mu_k, sigma2_k) — Normal-Inverse-Gamma conjugate posterior
        3. Sample pi_j             — Dirichlet posterior with sticky prior
        4. Sample m_jk             — CRF auxiliary variables (table counts)
        5. Sample bar{m}_jk        — override variables for sticky kappa
        6. Sample beta             — Dirichlet from aggregated table counts

    The number of active regimes is discovered automatically — unused truncation
    components naturally receive zero data and collapse to their prior.
    """

    def __init__(self, alpha=1.0, gamma=1.0, kappa=50.0, K_max=20):
        # DP concentration parameters
        self.alpha = alpha    # state-level DP concentration
        self.gamma = gamma    # top-level DP concentration (controls # states)
        self.kappa = kappa    # sticky self-transition bias
        self.K_max = K_max    # truncation level for the DP
        self.K = K_max

        # Filled during _init_params
        self.means = None       # (K, D) emission means
        self.vars = None        # (K, D) emission variances (diagonal)
        self.beta = None        # (K,) global base measure
        self.transition_matrix = None  # (K, K) transition probs
        self.pi0 = None         # (K,) initial state dist
        self.state_sequence = None
        self.log_likelihoods = []

        # NIG prior hyperparameters (set from data)
        self.mu_0 = None       # prior mean
        self.lambda_0 = None   # prior precision scaling
        self.a_0 = None        # inverse-gamma shape
        self.b_0 = None        # inverse-gamma scale (per dimension)

    # ── Initialization ────────────────────────────────────────────────────

    def _init_params(self, X):
        """Initialize all parameters. Uses k-means for sensible starting states."""
        T, D = X.shape
        K = self.K

        # NIG emission prior: vague but data-informed
        self.mu_0 = np.mean(X, axis=0)                    # center at data mean
        self.lambda_0 = 0.01                                # weak prior on mean
        self.a_0 = 2.0                                      # shape (> 1 for finite mean)
        self.b_0 = np.var(X, axis=0) * (self.a_0 - 1) + 1e-4  # scale ~ data variance

        # K-means initialization for emission parameters
        n_init = min(K, max(3, int(np.sqrt(T / 10))))
        centroids, labels = self._simple_kmeans(X, n_init, max_iter=20)

        self.means = np.tile(self.mu_0, (K, 1))
        self.vars = np.tile(self.b_0 / self.a_0, (K, 1))  # prior mean of variance

        for k in range(min(n_init, K)):
            mask = labels == k
            if np.sum(mask) > 1:
                self.means[k] = np.mean(X[mask], axis=0)
                self.vars[k] = np.var(X[mask], axis=0) + 1e-4

        # GEM stick-breaking for initial beta
        self.beta = self._gem_stick_breaking(self.gamma, K)

        # Sticky transition rows from Dirichlet prior
        self.transition_matrix = np.zeros((K, K))
        for j in range(K):
            alpha_vec = self.alpha * self.beta + 1e-10
            alpha_vec[j] += self.kappa
            self.transition_matrix[j] = np.random.dirichlet(alpha_vec)

        # Initial state distribution ~ beta
        self.pi0 = self.beta.copy()

        # Initial state sequence from k-means
        self.state_sequence = np.zeros(T, dtype=np.int64)
        if n_init <= K:
            self.state_sequence[:] = np.clip(labels, 0, K - 1)

    def _simple_kmeans(self, X, k, max_iter=20):
        """Vectorized k-means (no scipy dependency). Returns (centroids, labels)."""
        T, D = X.shape
        indices = np.random.choice(T, size=k, replace=False)
        centroids = X[indices].copy()
        labels = np.zeros(T, dtype=np.int64)

        for _ in range(max_iter):
            diffs = X[:, np.newaxis, :] - centroids[np.newaxis, :, :]
            dists = np.sum(diffs ** 2, axis=2)
            labels = np.argmin(dists, axis=1)

            new_centroids = centroids.copy()
            for c in range(k):
                mask = labels == c
                if np.sum(mask) > 0:
                    new_centroids[c] = np.mean(X[mask], axis=0)

            if np.allclose(centroids, new_centroids, atol=1e-6):
                break
            centroids = new_centroids

        return centroids, labels

    @staticmethod
    def _gem_stick_breaking(gamma, K):
        """GEM stick-breaking construction: beta ~ GEM(gamma)."""
        v = np.random.beta(1, gamma, size=K - 1)
        beta = np.zeros(K)
        remaining = 1.0
        for k in range(K - 1):
            beta[k] = v[k] * remaining
            remaining *= (1 - v[k])
        beta[K - 1] = remaining
        beta = np.maximum(beta, 1e-10)
        beta /= beta.sum()
        return beta

    # ── Gibbs Step 1: Sample States (FFBS) ────────────────────────────────

    def _compute_log_likelihood(self, X):
        """Log emission probability under diagonal Gaussian N(mu_k, diag(sigma2_k))."""
        T, D = X.shape
        K = self.K
        log_lik = np.full((T, K), -np.inf)

        for k in range(K):
            diff = X - self.means[k]
            var_k = np.maximum(self.vars[k], 1e-8)
            log_det = np.sum(np.log(var_k))
            mahal = np.sum(diff ** 2 / var_k[None, :], axis=1)
            log_lik[:, k] = -0.5 * (D * np.log(2 * np.pi) + log_det + mahal)

        return log_lik

    def _sample_states(self, X, log_lik):
        """Forward-filtering backward-sampling via numba JIT."""
        log_A = np.log(self.transition_matrix + 1e-300)
        log_pi = np.log(self.pi0 + 1e-300)
        T = X.shape[0]
        K = self.K

        log_alpha = _forward_pass(log_lik, log_pi, log_A, T, K)
        states = _backward_sample(log_lik, log_A, log_alpha, T, K)

        final_alpha = log_alpha[T - 1]
        max_val = np.max(final_alpha)
        total_ll = max_val + np.log(np.sum(np.exp(final_alpha - max_val)) + 1e-300)

        return states, total_ll

    # ── Gibbs Step 2: Sample Emissions (NIG Conjugate Posterior) ──────────

    def _sample_emission_params(self, X, states):
        """
        Sample (mu_k, sigma2_k) from Normal-Inverse-Gamma posterior.

        Prior:  mu_k | sigma2_k ~ N(mu_0, sigma2_k / lambda_0)
                sigma2_k,d      ~ IG(a_0, b_0_d)

        Posterior (per dimension d):
                lambda_n = lambda_0 + n_k
                mu_n     = (lambda_0 * mu_0 + n_k * x_bar) / lambda_n
                a_n      = a_0 + n_k / 2
                b_n      = b_0 + ss/2 + lambda_0*n_k*(x_bar - mu_0)^2 / (2*lambda_n)
        """
        T, D = X.shape
        for k in range(self.K):
            mask = states == k
            n_k = np.sum(mask)

            if n_k == 0:
                for d in range(D):
                    self.vars[k, d] = 1.0 / np.random.gamma(
                        self.a_0, 1.0 / (self.b_0[d] + 1e-10)
                    )
                    self.vars[k, d] = max(self.vars[k, d], 1e-8)
                    self.means[k, d] = np.random.normal(
                        self.mu_0[d], np.sqrt(self.vars[k, d] / self.lambda_0)
                    )
            else:
                X_k = X[mask]
                x_bar = np.mean(X_k, axis=0)

                for d in range(D):
                    lambda_n = self.lambda_0 + n_k
                    mu_n = (self.lambda_0 * self.mu_0[d] + n_k * x_bar[d]) / lambda_n
                    a_n = self.a_0 + n_k / 2.0

                    ss = np.sum((X_k[:, d] - x_bar[d]) ** 2)
                    b_n = (self.b_0[d]
                           + ss / 2.0
                           + self.lambda_0 * n_k * (x_bar[d] - self.mu_0[d]) ** 2
                           / (2.0 * lambda_n))

                    self.vars[k, d] = 1.0 / np.random.gamma(a_n, 1.0 / (b_n + 1e-10))
                    self.vars[k, d] = max(self.vars[k, d], 1e-8)
                    self.means[k, d] = np.random.normal(
                        mu_n, np.sqrt(self.vars[k, d] / lambda_n)
                    )

    # ── Gibbs Step 3: Sample Transition Rows (Dirichlet Posterior) ────────

    def _sample_transitions(self, states):
        """
        Sample pi_j ~ Dir(alpha * beta + n_j + kappa * delta_j).
        Returns the transition count matrix for use in beta update.
        """
        K = self.K
        T = len(states)

        counts = np.zeros((K, K))
        for t in range(T - 1):
            counts[int(states[t]), int(states[t + 1])] += 1

        for j in range(K):
            alpha_vec = self.alpha * self.beta + counts[j] + 1e-10
            alpha_vec[j] += self.kappa
            self.transition_matrix[j] = np.random.dirichlet(alpha_vec)

        state0_counts = np.bincount([int(states[0])], minlength=K).astype(np.float64)
        self.pi0 = np.random.dirichlet(self.alpha * self.beta + state0_counts + 1e-10)

        return counts

    # ── Gibbs Steps 4-6: Sample Beta via CRF Auxiliary Variables ─────────

    def _sample_beta(self, transition_counts):
        """
        Sample global base measure beta via the Chinese Restaurant Franchise.
        Steps 4 (CRF table counts), 5 (override variables), 6 (Dirichlet).
        """
        K = self.K

        # Step 4: Sample m_jk (CRF table counts)
        m = np.zeros((K, K))
        for j in range(K):
            for k in range(K):
                n_jk = int(transition_counts[j, k])
                if n_jk == 0:
                    continue
                alpha_beta_k = self.alpha * self.beta[k]
                if j == k:
                    alpha_beta_k += self.kappa
                if alpha_beta_k < 1e-10:
                    continue
                tables = 0
                for i in range(n_jk):
                    if np.random.random() < alpha_beta_k / (alpha_beta_k + i):
                        tables += 1
                m[j, k] = tables

        # Step 5: Override variables for sticky kappa (Fox et al. 2011)
        m_bar = m.copy()
        for j in range(K):
            m_jj = int(m[j, j])
            if m_jj > 0:
                rho_j = (self.alpha * self.beta[j]) / (
                    self.alpha * self.beta[j] + self.kappa + 1e-10
                )
                m_bar[j, j] = np.random.binomial(m_jj, max(rho_j, 1e-10))

        # Step 6: Sample beta from Dirichlet
        m_bar_sums = np.sum(m_bar, axis=0)
        dir_params = m_bar_sums + self.gamma / K + 1e-10
        self.beta = np.random.dirichlet(dir_params)
        self.beta = np.maximum(self.beta, 1e-10)
        self.beta /= self.beta.sum()

    # ── Main Gibbs Sampler ────────────────────────────────────────────────

    def fit(self, X, n_iter=500, burn_in=100, overlay_interval=25, timestamps=None):
        """
        Fit via Gibbs sampling, emitting JSON events on stdout.

        Each iteration:
          1. FFBS to sample state sequence z_{1:T}
          2. NIG posterior to sample emission params (mu_k, sigma2_k)
          3. Dirichlet posterior to sample transition rows pi_j
          4-6. CRF auxiliary variables to sample global beta

        Returns (self, iteration_metrics, state_samples):
          - iteration_metrics: list of per-iteration ConvergencePoint dicts
          - state_samples: list of post-burn-in state sequence arrays
        """
        T, D = X.shape
        emit_log(f"Starting Gibbs sampling: {n_iter} iter, {T} bars, {D} features, K_max={self.K}")
        emit_log(f"Hyperparameters: alpha={self.alpha}, gamma={self.gamma}, kappa={self.kappa}")

        self._init_params(X)

        emit_log("Compiling JIT kernels (first iteration may be slow)...")

        state_samples = []
        iteration_metrics = []
        prev_states = None
        t_start = time.time()

        for it in range(1, n_iter + 1):
            # Step 1: Sample state sequence
            log_lik = self._compute_log_likelihood(X)
            states, total_ll = self._sample_states(X, log_lik)
            self.state_sequence = states
            self.log_likelihoods.append(total_ll)

            # Step 2: Sample emission parameters from NIG posterior
            self._sample_emission_params(X, states)

            # Steps 3-6: Sample transitions and beta
            transition_counts = self._sample_transitions(states)
            self._sample_beta(transition_counts)

            # Count active regimes (> 1% of bars)
            unique, counts = np.unique(states, return_counts=True)
            active = unique[counts > max(1, T * 0.01)]
            n_active = len(active)

            # Collect post-burn-in samples
            if it > burn_in:
                state_samples.append(states.copy())

            # ── Compute per-iteration metrics ──────────────────────────────

            beta_entropy = float(-np.sum(self.beta * np.log(self.beta + 1e-300)))

            active_self_trans = float(np.mean([
                self.transition_matrix[k, k] for k in active
            ])) if len(active) > 0 else 0.0

            # Switch rate: fraction of consecutive bars changing state
            switches = int(np.sum(states[1:] != states[:-1]))
            switch_rate = switches / max(1, T - 1)

            # Max regime percentage
            max_pct = float(np.max(counts) / T) if len(counts) > 0 else 0.0

            # Average dwell time (mean run length)
            run_lengths = []
            current_run = 1
            for t_idx in range(1, T):
                if states[t_idx] == states[t_idx - 1]:
                    current_run += 1
                else:
                    run_lengths.append(current_run)
                    current_run = 1
            run_lengths.append(current_run)
            avg_dwell = float(np.mean(run_lengths))

            # Delta (LL change from previous iteration)
            delta = float(total_ll - self.log_likelihoods[-2]) if len(self.log_likelihoods) >= 2 else 0.0

            # Store ConvergencePoint for convergence.json
            iteration_metrics.append({
                "iter": it,
                "log_likelihood": float(total_ll),
                "n_active_states": int(n_active),
                "delta": delta,
                "entropy": beta_entropy,
                "switch_rate": round(switch_rate, 6),
                "self_transition": round(active_self_trans, 6),
                "max_regime_pct": round(max_pct, 6),
                "avg_dwell": round(avg_dwell, 2),
            })

            # ── Emit SSE events ───────────────────────────────────────────

            emit_progress(it, n_iter, "gibbs_sampling")
            emit_metric("log_likelihood", total_ll, it, n_iter)
            emit_metric("num_regimes", n_active, it, n_iter)
            emit_metric("beta_entropy", beta_entropy, it, n_iter)
            emit_metric("mean_self_transition", active_self_trans, it, n_iter)

            if prev_states is not None:
                assignment_stability = float(np.mean(states == prev_states))
                emit_metric("assignment_stability", assignment_stability, it, n_iter)
            prev_states = states.copy()

            # Emit overlay at intervals
            if timestamps is not None and it % overlay_interval == 0:
                relabeled, colors, labels, n_rel = relabel_states(states, X)
                emit_overlay(timestamps, relabeled, colors, labels,
                             self.transition_matrix[:n_rel, :n_rel], n_rel)

            # Periodic summary log
            if it % 50 == 0:
                elapsed = time.time() - t_start
                ips = it / elapsed
                eta = (n_iter - it) / ips
                emit_log(
                    f"Iter {it}/{n_iter} | LL={total_ll:.1f} | K={n_active} | "
                    f"selfTrans={active_self_trans:.3f} | "
                    f"{ips:.1f} it/s | ETA {eta:.0f}s"
                )

        # Mode assignment from post-burn-in samples
        if state_samples:
            sample_matrix = np.array(state_samples)
            final_states = np.zeros(T, dtype=np.int64)
            for t_idx in range(T):
                vals, cnts = np.unique(sample_matrix[:, t_idx], return_counts=True)
                final_states[t_idx] = vals[np.argmax(cnts)]
            self.state_sequence = final_states

        elapsed = time.time() - t_start
        n_active_final = len(np.unique(self.state_sequence))
        emit_log(f"Training complete: {elapsed:.1f}s, {n_active_final} regimes discovered")
        return self, iteration_metrics, state_samples


# ── CLI ──────────────────────────────────────────────────────────────────────

def _validate_sql_input(value, name, pattern=r'^[A-Za-z0-9_\-/]+$'):
    """Validate input before SQL interpolation to prevent injection."""
    import re as _re
    if not isinstance(value, str) or not _re.match(pattern, value):
        raise ValueError(f"Invalid {name}: {value!r}")
    return value


def _validate_date(value, name):
    """Validate date string is ISO format before SQL interpolation."""
    import re as _re
    if not isinstance(value, str) or not _re.match(r'^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$', value):
        raise ValueError(f"Invalid {name}: {value!r}")
    return value


def load_ohlcv_from_questdb(symbol, timeframe, max_bars=100000, date_range=None):
    """Load OHLCV data from QuestDB via PG wire protocol. Returns pyarrow Table.

    For base symbols (MNQ, ES, NQ, etc.) performs front-month stitching:
    picks the highest-volume contract per day, then queries each contract
    in its front-month date range. Matches the chart API behavior exactly.
    """
    import psycopg2
    import re

    # Validate inputs before any SQL interpolation
    _validate_sql_input(symbol, "symbol")
    _validate_sql_input(timeframe, "timeframe", r'^[0-9]+[mhdw]$')
    max_bars = int(max_bars)
    if date_range:
        if date_range.get("start"):
            _validate_date(date_range["start"], "date_range.start")
        if date_range.get("end"):
            _validate_date(date_range["end"], "date_range.end")

    host = os.environ.get("QUESTDB_HOST", "localhost")
    port = int(os.environ.get("QUESTDB_PG_PORT", "8812"))
    user = os.environ.get("QUESTDB_USER", "admin")
    password = os.environ.get("QUESTDB_PASSWORD", "quest")
    interval = timeframe if timeframe != "1w" else "7d"

    conn = psycopg2.connect(
        host=host, port=port, user=user, password=password, database="qdb"
    )
    try:
        cur = conn.cursor()

        # Try exact symbol match first (handles individual contracts like MNQH5)
        rows, col_names = _query_single_symbol(cur, symbol, interval, max_bars, date_range)

        # If no data and symbol looks like a base/root (no month+year suffix),
        # try front-month stitching across individual contracts
        if not rows and not re.match(r'.+[FGHJKMNQUVXZ]\d{1,2}$', symbol):
            emit_log(f"No exact match for '{symbol}', trying front-month stitching...")
            rows, col_names = _query_front_month(cur, symbol, interval, max_bars, date_range)

        cur.close()
    finally:
        conn.close()

    if not rows:
        raise ValueError(f"No OHLCV data found for {symbol} at {timeframe}")

    # Build pyarrow Table
    arrays = {}
    for i, col in enumerate(col_names):
        arrays[col] = [row[i] for row in rows]
    return pa.table(arrays)


def _query_single_symbol(cur, symbol, interval, max_bars, date_range):
    """Query OHLCV for a specific symbol with SAMPLE BY."""
    where = f"WHERE symbol = '{symbol}'"
    if date_range:
        if date_range.get("start"):
            where += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            where += f" AND timestamp <= '{date_range['end']}'"

    sql = f"""
        SELECT symbol, timestamp,
            first(open) as open, max(high) as high,
            min(low) as low, last(close) as close,
            sum(volume) as volume
        FROM ohlcv
        {where}
        SAMPLE BY {interval} ALIGN TO CALENDAR
        ORDER BY timestamp
        LIMIT {max_bars}
    """
    cur.execute(sql)
    rows = cur.fetchall()
    col_names = [desc[0] for desc in cur.description] if cur.description else []
    return rows, col_names


def _query_front_month(cur, root, interval, max_bars, date_range):
    """Front-month stitching: pick highest-volume contract per day, query each."""
    import re as re_mod

    contract_regex = f'^{re_mod.escape(root)}[FGHJKMNQUVXZ][0-9]{{1,2}}$'

    time_filter = ""
    if date_range:
        if date_range.get("start"):
            time_filter += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            time_filter += f" AND timestamp <= '{date_range['end']}'"

    # Step 1: Daily volume per contract from materialized view
    cur.execute(f"""
        SELECT symbol, timestamp, volume FROM ohlcv_1d
        WHERE symbol ~ '{contract_regex}'{time_filter}
        ORDER BY timestamp
    """)
    daily_bars = cur.fetchall()

    if not daily_bars:
        return [], []

    # Step 2: Pick highest-volume contract per day (= front month)
    leaders = {}
    for sym, ts, vol in daily_bars:
        day = ts.strftime('%Y-%m-%d') if hasattr(ts, 'strftime') else str(ts)[:10]
        v = float(vol) if vol else 0
        if day not in leaders or v > leaders[day][1]:
            leaders[day] = (sym, v)

    # Step 3: Build contiguous date ranges per front-month contract
    ranges = []
    current = None
    for day in sorted(leaders.keys()):
        sym = leaders[day][0]
        if current is None or current[0] != sym:
            if current:
                ranges.append(current)
            current = (sym, day, day)
        else:
            current = (current[0], current[1], day)
    if current:
        ranges.append(current)

    emit_log(f"Front-month stitching: {len(ranges)} contracts, {len(leaders)} trading days")

    # Step 4: Query each contract in its front-month range
    all_rows = []
    col_names = None

    for sym, start, end in ranges:
        s = f"{start}T00:00:00.000Z"
        e = f"{end}T23:59:59.999Z"

        cur.execute(f"""
            SELECT '{sym}' as symbol, timestamp,
                first(open) as open, max(high) as high,
                min(low) as low, last(close) as close,
                sum(volume) as volume
            FROM ohlcv
            WHERE symbol = '{sym}' AND timestamp >= '{s}' AND timestamp <= '{e}'
            SAMPLE BY {interval} ALIGN TO CALENDAR
            ORDER BY timestamp
        """)
        rows = cur.fetchall()
        if col_names is None and cur.description:
            col_names = [desc[0] for desc in cur.description]
        all_rows.extend(rows)

    if not all_rows:
        return [], col_names or []

    # Sort by timestamp and limit
    all_rows.sort(key=lambda r: r[1])
    if len(all_rows) > max_bars:
        all_rows = all_rows[:max_bars]

    return all_rows, col_names


def parse_args():
    parser = argparse.ArgumentParser(description="Sticky HDP-HMM Regime Detection")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--max-bars", type=int, default=100000)
    parser.add_argument("--date-start", type=str, default=None)
    parser.add_argument("--date-end", type=str, default=None)
    parser.add_argument("--gibbs-iter", type=int, default=500)
    parser.add_argument("--burn-in", type=int, default=100)
    parser.add_argument("--alpha", type=float, default=1.0)
    parser.add_argument("--gamma", type=float, default=1.0)
    parser.add_argument("--kappa", type=float, default=50.0)
    parser.add_argument("--test-split", type=float, default=0.15)
    parser.add_argument("--overlay-interval", type=int, default=25)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    t_start = time.time()

    try:
        # 1. Load data from QuestDB
        date_range = None
        if args.date_start or args.date_end:
            date_range = {"start": args.date_start, "end": args.date_end}
        emit_log(f"Loading OHLCV from QuestDB for {args.symbol} {args.timeframe} (max {args.max_bars} bars)")
        emit_progress(0, args.gibbs_iter, "loading_data")

        table = load_ohlcv_from_questdb(args.symbol, args.timeframe, args.max_bars, date_range)
        n_bars = len(table)
        emit_log(f"Loaded {n_bars} bars for {args.symbol} {args.timeframe}")

        if n_bars < 100:
            emit_error(f"Insufficient data: {n_bars} bars (need >= 100)")
            sys.exit(1)

        # 2. Compute features
        emit_progress(0, args.gibbs_iter, "computing_features")
        emit_log("Computing features from raw OHLCV...")
        X_raw, feature_names, timestamps = compute_features(table)
        emit_log(f"Computed {len(feature_names)} features: {', '.join(feature_names[:5])}...")

        # 3. Normalize
        emit_progress(0, args.gibbs_iter, "normalizing")
        emit_log("Normalizing features (rolling z-score, lookback=250)...")
        X = normalize_features(X_raw, lookback=250)

        # Drop NaN rows (warmup period)
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
        model, iteration_metrics, state_samples = model.fit(
            X_valid,
            n_iter=args.gibbs_iter,
            burn_in=args.burn_in,
            overlay_interval=args.overlay_interval,
            timestamps=timestamps_valid,
        )

        # 5. Save — extract close values aligned with valid timestamps
        close_all = table.column("close").to_pylist()
        close_valid = [c for c, v in zip(close_all, valid_mask) if v]

        emit_progress(args.gibbs_iter, args.gibbs_iter, "saving")
        elapsed = time.time() - t_start
        model_path, diagnostics = save_model(
            model, timestamps_valid, features_valid, feature_names, args, elapsed,
            iteration_metrics=iteration_metrics,
            state_samples=state_samples,
            close_vals=close_valid,
        )

        # 6. Final overlay
        relabeled, colors, labels, _ = relabel_states(model.state_sequence, features_valid)
        emit_overlay(timestamps_valid, relabeled, colors, labels)

        # 7. Done
        emit_done(model_path, diagnostics)

    except Exception as e:
        import traceback
        emit_error(str(e), traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
