"""
2-State Gaussian HMM — Baum-Welch EM algorithm.

Classical parametric HMM with fixed K=2 states (Bullish / Bearish).
Uses diagonal Gaussian emissions and maximum-likelihood EM training
with random restarts to avoid local optima.
"""

import time

import numpy as np

from shared.protocol import emit_progress, emit_metric, emit_overlay, emit_log
from hmm_2state.config import N_STATES, CONVERGENCE_TOL


class GaussianHMM2State:
    """
    2-State Hidden Markov Model with diagonal Gaussian emissions.

    Training via Baum-Welch EM:
      E-step: forward-backward → posterior responsibilities gamma(t,k)
              and transition posteriors xi(t,i,j)
      M-step: closed-form MLE updates for means, variances, transitions, pi0

    Final state sequence decoded via Viterbi algorithm (MAP path).

    Attribute interface matches StickyHDPHMM for analysis module reuse.
    """

    def __init__(self):
        self.K = N_STATES
        self.means = None           # (K, D) emission means
        self.vars = None            # (K, D) emission variances (diagonal)
        self.transition_matrix = None  # (K, K)
        self.pi0 = None             # (K,) initial state distribution
        self.state_sequence = None  # (T,) Viterbi-decoded states
        self.log_likelihoods = []

    # ── Initialization ────────────────────────────────────────────────────

    def _init_params(self, X, random=False):
        """Initialize parameters. Median-split or random."""
        T, D = X.shape
        K = self.K

        if random:
            # Random initialization: pick 2 random data points as centroids
            idx = np.random.choice(T, size=K, replace=False)
            self.means = X[idx].copy()
            self.vars = np.tile(np.var(X, axis=0) + 1e-4, (K, 1))
        else:
            # Deterministic: split by median of return_1 (first feature)
            median = np.median(X[:, 0])
            mask_low = X[:, 0] < median
            mask_high = ~mask_low

            self.means = np.zeros((K, D))
            self.vars = np.zeros((K, D))

            if np.sum(mask_low) > 0:
                self.means[0] = np.mean(X[mask_low], axis=0)
                self.vars[0] = np.var(X[mask_low], axis=0) + 1e-4
            else:
                self.means[0] = np.mean(X, axis=0) - np.std(X, axis=0)
                self.vars[0] = np.var(X, axis=0) + 1e-4

            if np.sum(mask_high) > 0:
                self.means[1] = np.mean(X[mask_high], axis=0)
                self.vars[1] = np.var(X[mask_high], axis=0) + 1e-4
            else:
                self.means[1] = np.mean(X, axis=0) + np.std(X, axis=0)
                self.vars[1] = np.var(X, axis=0) + 1e-4

        # Sticky transition initialization
        self.transition_matrix = np.array([[0.95, 0.05], [0.05, 0.95]])
        self.pi0 = np.array([0.5, 0.5])
        self.log_likelihoods = []

    # ── Emission Probabilities ────────────────────────────────────────────

    def _compute_log_likelihood(self, X):
        """Log emission probability under diagonal Gaussian N(mu_k, diag(sigma2_k))."""
        T, D = X.shape
        K = self.K
        log_lik = np.zeros((T, K))

        for k in range(K):
            diff = X - self.means[k]
            var_k = np.maximum(self.vars[k], 1e-8)
            log_det = np.sum(np.log(var_k))
            mahal = np.sum(diff ** 2 / var_k[None, :], axis=1)
            log_lik[:, k] = -0.5 * (D * np.log(2 * np.pi) + log_det + mahal)

        return log_lik

    # ── Forward-Backward (log-space, pure numpy) ─────────────────────────

    def _forward(self, log_lik):
        """Forward pass. Returns (log_alpha, log_scales) for numerical stability."""
        T, K = log_lik.shape
        log_A = np.log(self.transition_matrix + 1e-300)
        log_pi = np.log(self.pi0 + 1e-300)

        log_alpha = np.zeros((T, K))
        log_alpha[0] = log_pi + log_lik[0]

        for t in range(1, T):
            for j in range(K):
                vals = log_alpha[t - 1] + log_A[:, j]
                max_val = np.max(vals)
                log_alpha[t, j] = max_val + np.log(np.sum(np.exp(vals - max_val)) + 1e-300) + log_lik[t, j]

        # Total log-likelihood
        max_final = np.max(log_alpha[T - 1])
        total_ll = max_final + np.log(np.sum(np.exp(log_alpha[T - 1] - max_final)) + 1e-300)

        return log_alpha, total_ll

    def _backward(self, log_lik):
        """Backward pass. Returns log_beta."""
        T, K = log_lik.shape
        log_A = np.log(self.transition_matrix + 1e-300)

        log_beta = np.zeros((T, K))
        # log_beta[T-1] = 0 (log(1))

        for t in range(T - 2, -1, -1):
            for i in range(K):
                vals = log_A[i, :] + log_lik[t + 1] + log_beta[t + 1]
                max_val = np.max(vals)
                log_beta[t, i] = max_val + np.log(np.sum(np.exp(vals - max_val)) + 1e-300)

        return log_beta

    # ── E-Step ────────────────────────────────────────────────────────────

    def _e_step(self, X):
        """
        E-step: compute posterior responsibilities.

        Returns:
          gamma: (T, K) — P(z_t = k | X)
          xi: (T-1, K, K) — P(z_t = i, z_{t+1} = j | X)
          total_ll: float — log P(X | params)
        """
        log_lik = self._compute_log_likelihood(X)
        log_alpha, total_ll = self._forward(log_lik)
        log_beta = self._backward(log_lik)

        T, K = log_lik.shape
        log_A = np.log(self.transition_matrix + 1e-300)

        # Gamma: P(z_t = k | X) = alpha(t,k) * beta(t,k) / P(X)
        log_gamma = log_alpha + log_beta
        # Normalize per timestep
        for t in range(T):
            max_val = np.max(log_gamma[t])
            log_gamma[t] -= max_val + np.log(np.sum(np.exp(log_gamma[t] - max_val)) + 1e-300)
        gamma = np.exp(log_gamma)
        # Clip to ensure valid probabilities
        gamma = np.clip(gamma, 1e-300, None)
        gamma /= gamma.sum(axis=1, keepdims=True)

        # Xi: P(z_t = i, z_{t+1} = j | X)
        xi = np.zeros((T - 1, K, K))
        for t in range(T - 1):
            for i in range(K):
                for j in range(K):
                    xi[t, i, j] = log_alpha[t, i] + log_A[i, j] + log_lik[t + 1, j] + log_beta[t + 1, j]
            max_val = np.max(xi[t])
            xi[t] -= max_val + np.log(np.sum(np.exp(xi[t] - max_val)) + 1e-300)
        xi = np.exp(xi)
        # Normalize each (T-1) slice
        xi_sum = xi.sum(axis=(1, 2), keepdims=True)
        xi /= np.maximum(xi_sum, 1e-300)

        return gamma, xi, total_ll

    # ── M-Step ────────────────────────────────────────────────────────────

    def _m_step(self, X, gamma, xi):
        """M-step: closed-form MLE parameter updates."""
        T, D = X.shape
        K = self.K

        # Initial state distribution
        self.pi0 = gamma[0] / (gamma[0].sum() + 1e-300)

        # Transition matrix
        for i in range(K):
            xi_sum_i = xi[:, i, :].sum(axis=0)
            denom = xi_sum_i.sum()
            if denom > 1e-10:
                self.transition_matrix[i] = xi_sum_i / denom
            else:
                self.transition_matrix[i] = 1.0 / K
        # Floor small values for stability
        self.transition_matrix = np.maximum(self.transition_matrix, 1e-6)
        self.transition_matrix /= self.transition_matrix.sum(axis=1, keepdims=True)

        # Emission parameters
        for k in range(K):
            gamma_k = gamma[:, k]
            nk = gamma_k.sum()

            if nk > 1e-10:
                self.means[k] = (gamma_k[:, None] * X).sum(axis=0) / nk
                diff = X - self.means[k]
                self.vars[k] = (gamma_k[:, None] * diff ** 2).sum(axis=0) / nk
                self.vars[k] = np.maximum(self.vars[k], 1e-6)
            # else: keep previous values

    # ── Viterbi Decoding ──────────────────────────────────────────────────

    def _viterbi(self, X):
        """Viterbi algorithm: MAP state sequence."""
        log_lik = self._compute_log_likelihood(X)
        T, K = log_lik.shape
        log_A = np.log(self.transition_matrix + 1e-300)
        log_pi = np.log(self.pi0 + 1e-300)

        # Viterbi trellis
        delta = np.zeros((T, K))
        psi = np.zeros((T, K), dtype=np.int64)

        delta[0] = log_pi + log_lik[0]

        for t in range(1, T):
            for j in range(K):
                scores = delta[t - 1] + log_A[:, j]
                psi[t, j] = np.argmax(scores)
                delta[t, j] = scores[psi[t, j]] + log_lik[t, j]

        # Backtrack
        states = np.zeros(T, dtype=np.int64)
        states[T - 1] = np.argmax(delta[T - 1])
        for t in range(T - 2, -1, -1):
            states[t] = psi[t + 1, states[t + 1]]

        return states

    # ── Main Training Loop ────────────────────────────────────────────────

    def fit(self, X, n_iter=100, tol=CONVERGENCE_TOL, overlay_interval=10,
            timestamps=None, n_restarts=5):
        """
        Fit via Baum-Welch EM with random restarts.

        Runs EM n_restarts times with different initializations.
        Keeps the model with highest final log-likelihood.
        Final state sequence decoded via Viterbi.

        Returns (self, iteration_metrics).
        """
        T, D = X.shape
        emit_log(f"Starting Baum-Welch EM: {n_restarts} restarts, max {n_iter} iter, "
                 f"{T} bars, {D} features, K={self.K}")

        best_ll = -np.inf
        best_params = None
        global_metrics = []
        global_iter = 0
        total_iters = n_restarts * n_iter  # upper bound for progress
        t_start = time.time()

        for restart in range(n_restarts):
            emit_log(f"Restart {restart + 1}/{n_restarts}")

            # First restart uses deterministic init, rest use random
            self._init_params(X, random=(restart > 0))

            prev_ll = -np.inf
            converged = False

            for it in range(1, n_iter + 1):
                global_iter += 1

                # E-step
                gamma, xi, total_ll = self._e_step(X)

                # M-step
                self._m_step(X, gamma, xi)

                self.log_likelihoods.append(total_ll)

                # Convergence metrics
                delta = total_ll - prev_ll
                avg_self_trans = float(np.mean(np.diag(self.transition_matrix)))
                switch_rate = float(np.mean(gamma[1:].argmax(axis=1) != gamma[:-1].argmax(axis=1)))

                global_metrics.append({
                    "iter": global_iter,
                    "restart": restart + 1,
                    "em_iter": it,
                    "log_likelihood": float(total_ll),
                    "n_active_states": self.K,
                    "delta": float(delta),
                    "self_transition": round(avg_self_trans, 6),
                    "switch_rate": round(switch_rate, 6),
                })

                # Emit SSE events
                emit_progress(global_iter, total_iters, "em_training")
                emit_metric("log_likelihood", total_ll, global_iter, total_iters)
                emit_metric("num_regimes", self.K, global_iter, total_iters)
                emit_metric("mean_self_transition", avg_self_trans, global_iter, total_iters)

                # Emit overlay at intervals
                if timestamps is not None and it % overlay_interval == 0:
                    states_now = gamma.argmax(axis=1)
                    # Relabel: higher mean return = state 0 (Bullish)
                    mean_ret = [np.mean(X[states_now == k, 0]) if np.sum(states_now == k) > 0 else 0.0
                                for k in range(self.K)]
                    label_map = {0: "Bullish", 1: "Bearish"}
                    if mean_ret[0] < mean_ret[1]:
                        # Swap labels
                        label_map = {0: "Bearish", 1: "Bullish"}

                    colors = {}
                    labels = {}
                    for k in range(self.K):
                        colors[str(k)] = ["#22c55e", "#ef4444"][k]  # green, red
                        labels[str(k)] = label_map[k]

                    emit_overlay(timestamps, states_now.tolist(), colors, labels)

                # Convergence check
                if abs(delta) < tol and it > 1:
                    emit_log(f"  Converged at iter {it} (ΔLL={delta:.2e})")
                    converged = True
                    break

                prev_ll = total_ll

                # Periodic log
                if it % 20 == 0:
                    elapsed = time.time() - t_start
                    emit_log(f"  Iter {it}/{n_iter} | LL={total_ll:.1f} | "
                             f"selfTrans={avg_self_trans:.3f} | {elapsed:.1f}s")

            if not converged:
                emit_log(f"  Did not converge in {n_iter} iterations (ΔLL={delta:.2e})")

            # Track best restart
            final_ll = self.log_likelihoods[-1] if self.log_likelihoods else -np.inf
            if final_ll > best_ll:
                best_ll = final_ll
                best_params = {
                    "means": self.means.copy(),
                    "vars": self.vars.copy(),
                    "transition_matrix": self.transition_matrix.copy(),
                    "pi0": self.pi0.copy(),
                    "log_likelihoods": list(self.log_likelihoods),
                }
                emit_log(f"  New best: LL={best_ll:.1f} (restart {restart + 1})")

        # Restore best parameters
        if best_params is not None:
            self.means = best_params["means"]
            self.vars = best_params["vars"]
            self.transition_matrix = best_params["transition_matrix"]
            self.pi0 = best_params["pi0"]
            self.log_likelihoods = best_params["log_likelihoods"]

        # Viterbi decode final state sequence
        emit_log("Running Viterbi decoding for MAP state sequence...")
        self.state_sequence = self._viterbi(X)

        elapsed = time.time() - t_start
        emit_log(f"Training complete: {elapsed:.1f}s, best LL={best_ll:.1f}")

        return self, global_metrics
