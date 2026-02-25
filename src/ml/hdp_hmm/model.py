"""
Sticky HDP-HMM Gibbs Sampler
=============================

True nonparametric HDP-HMM with Gaussian emissions and sticky transitions.

Think of it as a hotel that builds new rooms on demand:
- alpha (concentration) = how easily the hotel adds a room to its
  "master floor plan" (higher = more rooms globally)
- gamma (top-level) = how much the global menu of room types matters
- kappa (stickiness) = how much a guest prefers to stay in their current
  room rather than switching (higher = longer regime durations, which
  is realistic for markets -- regimes persist for many bars)
"""

from __future__ import annotations

import sys
from typing import Any, Callable, Optional

import numpy as np
from scipy.special import logsumexp as sp_logsumexp  # type: ignore[import-untyped]

# ── Numba JIT acceleration for FFBS ─────────────────────────────────────────
# The forward pass is O(T*K^2) with T potentially > 1M. Pure Python loops are
# ~100x slower than compiled code. Numba JIT compiles these hot loops to LLVM
# machine code, making each Gibbs iteration take seconds instead of minutes.

try:
    from numba import njit

    @njit(cache=True)
    def _forward_pass_jit(log_em: np.ndarray, log_trans: np.ndarray,
                          log_sp: np.ndarray) -> np.ndarray:
        """JIT-compiled forward pass: log_alpha[t,k] for all T timesteps."""
        T = log_em.shape[0]
        K = log_em.shape[1]
        log_alpha = np.empty((T, K))
        for k in range(K):
            log_alpha[0, k] = log_sp[k] + log_em[0, k]
        for t in range(1, T):
            for k in range(K):
                # logsumexp over j: log_alpha[t-1, j] + log_trans[j, k]
                max_val = -1e300
                for j in range(K):
                    v = log_alpha[t - 1, j] + log_trans[j, k]
                    if v > max_val:
                        max_val = v
                acc = 0.0
                for j in range(K):
                    acc += np.exp(log_alpha[t - 1, j] + log_trans[j, k] - max_val)
                log_alpha[t, k] = log_em[t, k] + max_val + np.log(acc + 1e-300)
        return log_alpha

    @njit(cache=True)
    def _backward_sample_jit(log_alpha: np.ndarray, log_trans: np.ndarray,
                             rand_vals: np.ndarray) -> np.ndarray:
        """JIT-compiled backward sampling: draw state sequence from log_alpha."""
        T = log_alpha.shape[0]
        K = log_alpha.shape[1]
        states = np.empty(T, dtype=np.int64)
        probs = np.empty(K)

        # --- Sample last state ---
        max_v = log_alpha[T - 1, 0]
        for k in range(1, K):
            if log_alpha[T - 1, k] > max_v:
                max_v = log_alpha[T - 1, k]
        s = 0.0
        for k in range(K):
            probs[k] = np.exp(log_alpha[T - 1, k] - max_v)
            s += probs[k]
        if s > 0:
            for k in range(K):
                probs[k] /= s
        else:
            for k in range(K):
                probs[k] = 1.0 / K

        cs = 0.0
        states[T - 1] = K - 1
        for k in range(K):
            cs += probs[k]
            if rand_vals[0] < cs:
                states[T - 1] = k
                break

        # --- Backward sampling ---
        for t in range(T - 2, -1, -1):
            sk = states[t + 1]
            max_v = -1e300
            for k in range(K):
                probs[k] = log_alpha[t, k] + log_trans[k, sk]
                if probs[k] > max_v:
                    max_v = probs[k]
            s = 0.0
            for k in range(K):
                probs[k] = np.exp(probs[k] - max_v)
                s += probs[k]
            if s <= 0:
                states[t] = 0
                continue
            for k in range(K):
                probs[k] /= s
            cs = 0.0
            states[t] = K - 1
            for k in range(K):
                cs += probs[k]
                if rand_vals[T - 1 - t] < cs:
                    states[t] = k
                    break
        return states

    @njit(cache=True)
    def _predict_viterbi_jit(log_em: np.ndarray,
                             log_trans: np.ndarray) -> np.ndarray:
        """JIT-compiled greedy Viterbi-like prediction."""
        T = log_em.shape[0]
        K = log_em.shape[1]
        states = np.empty(T, dtype=np.int64)
        # First state: argmax of emission
        best = log_em[0, 0]
        states[0] = 0
        for k in range(1, K):
            if log_em[0, k] > best:
                best = log_em[0, k]
                states[0] = k
        for t in range(1, T):
            prev = states[t - 1]
            best_k = 0
            best_v = log_em[t, 0] + log_trans[prev, 0]
            for k in range(1, K):
                v = log_em[t, k] + log_trans[prev, k]
                if v > best_v:
                    best_v = v
                    best_k = k
            states[t] = best_k
        return states

    _HAS_NUMBA = True
    print("  [numba] JIT acceleration available", flush=True)

except ImportError:
    _HAS_NUMBA = False


# ==============================================================================
# Helper Functions
# ==============================================================================


def _logsumexp(log_probs: np.ndarray) -> float:
    """Numerically stable log-sum-exp."""
    log_probs = np.asarray(log_probs, dtype=np.float64)
    max_lp = np.max(log_probs)
    if max_lp == -np.inf or np.isnan(max_lp):
        return -np.inf
    return float(max_lp + np.log(np.sum(np.exp(log_probs - max_lp))))


def _sample_categorical(probs: np.ndarray, rng: np.random.RandomState) -> int:
    """Sample from a categorical distribution, handling edge cases."""
    probs = np.asarray(probs, dtype=np.float64)
    probs = np.maximum(probs, 0)
    total = probs.sum()
    if total <= 0 or np.isnan(total):
        return int(rng.randint(0, len(probs)))
    probs /= total
    return int(rng.choice(len(probs), p=probs))


# ==============================================================================
# StickyHDPHMM Model
# ==============================================================================


class StickyHDPHMM:
    """
    True nonparametric HDP-HMM with Gaussian emissions and sticky transitions.

    The Gibbs sampler works like this:
    1. Start by assigning all bars to random regimes
    2. For each bar, ask: "given all OTHER bars' assignments, which regime
       best explains THIS bar?" Re-assign it probabilistically.
    3. Update the regime parameters (mean return, volatility profile, etc.)
       based on which bars belong to each regime now
    4. Update the transition probabilities (how likely is regime A -> B?)
    5. Let the stick-breaking process potentially create NEW regimes
    6. Repeat for many iterations until assignments stabilize

    Truly nonparametric: no fixed cap on number of states. The state space
    grows dynamically during Gibbs sampling whenever the model needs more
    room. Think of it as a hotel that builds new floors on demand — if
    guests start filling the top floor, the hotel just adds another one.
    """

    def __init__(
        self,
        alpha: float = 1.0,
        gamma: float = 5.0,
        kappa: float = 50.0,
        n_iter: int = 100,
        burn_in: int = 30,
        random_state: int = 42,
    ):
        """
        Parameters
        ----------
        alpha : concentration parameter for transition distributions.
                Higher = more diverse transitions between regimes.
        gamma : top-level DP concentration. Controls how readily new
                regimes are created. Higher = more potential regimes.
        kappa : stickiness. Added to self-transition probability.
                Higher = regimes last longer (markets are sticky!).
        n_iter : total Gibbs sampling iterations.
        burn_in : iterations to discard before collecting samples.
        random_state : reproducibility seed.
        """
        self.alpha = alpha
        self.gamma = gamma
        self.kappa = kappa
        self.n_iter = n_iter
        self.burn_in = burn_in
        self.rng = np.random.RandomState(random_state)  # type: ignore[attr-defined]  # pylint: disable=no-member

        # Model state (populated during fit)
        self.means_: Optional[np.ndarray] = None  # (K, D) emission means
        self.covars_: Optional[np.ndarray] = None  # (K, D) diagonal variances
        self.transmat_: Optional[np.ndarray] = None  # (K, K) transition matrix
        self.startprob_: Optional[np.ndarray] = None  # (K,) initial state distribution
        self.beta_: Optional[np.ndarray] = (
            None  # (K,) global state weights (stick-breaking)
        )
        self.n_active_ = 0  # number of states actually used
        self.state_map_: Optional[dict[Any, int]] = (
            None  # maps truncated indices to active indices
        )
        self.convergence_history_: list[dict[str, Any]] = []
        self._assignments: Optional[np.ndarray] = None
        self._X_train: Optional[np.ndarray] = None

    # ------------------------------------------------------------------
    # Stick-Breaking
    # ------------------------------------------------------------------

    def _stick_breaking(self, gamma: float, K: int) -> np.ndarray:
        """
        Sample global state weights beta via stick-breaking.

        Think of it as: breaking a stick into pieces. You break off a random
        piece from the remaining stick. Bigger gamma = you tend to break off
        smaller pieces, leaving more stick left for potential new states.
        """
        betas = np.zeros(K)
        remaining = 1.0
        for k in range(K - 1):
            v = self.rng.beta(1.0, gamma)
            betas[k] = remaining * v
            remaining *= 1.0 - v
        betas[K - 1] = remaining
        return betas

    # ------------------------------------------------------------------
    # Emission Parameters
    # ------------------------------------------------------------------

    def _sample_emission_params(
        self, X: np.ndarray, assignments: np.ndarray, K: int, D: int
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Sample diagonal Gaussian emission parameters for each state.

        Uses Normal-Inverse-Gamma conjugacy (independent per dimension).
        Stores variances as (K, D) instead of full (K, D, D) covariance.
        """
        # Normal-Inverse-Gamma prior (per dimension)
        mu_0 = 0.0        # prior mean
        kappa_0 = 0.1      # prior mean strength
        alpha_0 = 2.0      # prior shape for variance
        beta_0 = 0.5       # prior rate for variance

        means = np.zeros((K, D))
        variances = np.zeros((K, D))

        for k in range(K):
            mask = assignments == k
            n_k = mask.sum()

            if n_k < 2:
                means[k] = self.rng.normal(0, 0.5, size=D)
                variances[k] = 1.0 / self.rng.gamma(alpha_0, 1.0 / beta_0, size=D)
                continue

            X_k = X[mask]
            x_bar = X_k.mean(axis=0)
            x_var = X_k.var(axis=0, ddof=1)

            # Posterior parameters (Normal-Inverse-Gamma)
            kappa_n = kappa_0 + n_k
            mu_n = (kappa_0 * mu_0 + n_k * x_bar) / kappa_n
            alpha_n = alpha_0 + n_k / 2.0
            beta_n = beta_0 + 0.5 * n_k * x_var + 0.5 * (kappa_0 * n_k / kappa_n) * (x_bar - mu_0) ** 2

            # Sample variance from Inverse-Gamma, then mean from Normal
            variances[k] = 1.0 / self.rng.gamma(alpha_n, 1.0 / np.maximum(beta_n, 1e-10), size=D)
            variances[k] = np.maximum(variances[k], 1e-8)
            means[k] = self.rng.normal(mu_n, np.sqrt(variances[k] / kappa_n))

        return means, variances

    # ------------------------------------------------------------------
    # Transitions
    # ------------------------------------------------------------------

    def _sample_transitions(self, assignments: np.ndarray, K: int) -> np.ndarray:
        """
        Sample transition matrix rows from Dirichlet posterior.

        The sticky part: self-transitions get an extra boost of kappa.
        Think of it as: the market has inertia -- if it's in "trending up"
        mode, it's much more likely to STAY in "trending up" than to suddenly
        jump to "volatile choppy". Kappa enforces this inertia.
        """
        transmat = np.zeros((K, K))
        N_jk = np.zeros((K, K))

        # Count transitions (vectorized)
        if len(assignments) > 1:
            src = assignments[:-1]
            dst = assignments[1:]
            mask = (src < K) & (dst < K)
            np.add.at(N_jk, (src[mask], dst[mask]), 1)

        # Sample each row from Dirichlet
        for j in range(K):
            # Posterior: Dir(alpha * beta + N_j + kappa * delta_jk)
            assert self.beta_ is not None  # populated during fit
            alpha_vec = self.alpha * self.beta_ + N_jk[j]
            alpha_vec[j] += self.kappa  # sticky self-transition boost
            alpha_vec = np.maximum(alpha_vec, 1e-6)  # ensure valid Dirichlet
            transmat[j] = self.rng.dirichlet(alpha_vec)

        return transmat

    # ------------------------------------------------------------------
    # Emission Probabilities
    # ------------------------------------------------------------------

    def _log_emission_prob(
        self, x: np.ndarray, means: np.ndarray, variances: np.ndarray, K: int, D: int
    ) -> np.ndarray:
        """Compute log P(x | state=k) for all states (single observation, diagonal covariance)."""
        # x: (D,), means: (K,D), variances: (K,D)
        diff = x[np.newaxis, :] - means  # (K, D)
        log_probs = -0.5 * (D * np.log(2 * np.pi) + np.sum(np.log(variances + 1e-10), axis=1) + np.sum(diff**2 / (variances + 1e-10), axis=1))
        return log_probs

    def _log_emission_matrix(
        self, X: np.ndarray, means: np.ndarray, variances: np.ndarray, K: int, D: int
    ) -> np.ndarray:
        """
        Vectorized: log P(x_t | state=k) for ALL T observations and K states.
        Returns T×K matrix. Diagonal covariance — O(T*K*D), no Cholesky needed.
        """
        T = len(X)
        log_em = np.empty((T, K))
        log_norm = -0.5 * D * np.log(2 * np.pi)
        for k in range(K):
            var_k = variances[k] + 1e-10  # (D,)
            log_det = np.sum(np.log(var_k))
            diff = X - means[k]  # (T, D)
            mahal = np.sum(diff**2 / var_k, axis=1)  # (T,)
            log_em[:, k] = log_norm - 0.5 * (log_det + mahal)
        return log_em

    # ------------------------------------------------------------------
    # State Sampling (FFBS)
    # ------------------------------------------------------------------

    def _sample_states(
        self,
        X: np.ndarray,
        means: np.ndarray,
        covars: np.ndarray,
        transmat: np.ndarray,
        startprob: np.ndarray,
        K: int,
        D: int,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Forward-filtering backward-sampling (FFBS) for state sequence.

        Returns (assignments, log_emission_matrix) so the caller can reuse
        the emission matrix for log-likelihood without recomputing it.

        Uses Numba JIT when available (~50-100x faster than pure Python loops).
        """
        T = len(X)

        # Pre-compute ALL emission log-probabilities at once (vectorized numpy)
        log_em_all = self._log_emission_matrix(X, means, covars, K, D)  # T×K
        log_sp = np.log(np.asarray(startprob, dtype=np.float64) + 1e-300)
        log_trans = np.log(np.asarray(transmat, dtype=np.float64) + 1e-300)  # K×K

        if _HAS_NUMBA:
            # JIT-compiled forward + backward — ~50-100x faster
            log_alpha = _forward_pass_jit(
                np.ascontiguousarray(log_em_all),
                np.ascontiguousarray(log_trans),
                np.ascontiguousarray(log_sp),
            )
            rand_vals = self.rng.random(T)
            states = _backward_sample_jit(log_alpha, log_trans, rand_vals)
            return states.astype(np.intp), log_em_all

        # Fallback: pure numpy (slow for large T)
        log_alpha = np.full((T, K), -1e10)
        log_alpha[0] = log_sp + log_em_all[0]

        for t in range(1, T):
            msg = log_alpha[t - 1, :, np.newaxis] + log_trans  # K×K
            log_alpha[t] = log_em_all[t] + sp_logsumexp(msg, axis=0)

        states = np.zeros(T, dtype=int)
        log_p = log_alpha[T - 1] - _logsumexp(log_alpha[T - 1])
        states[T - 1] = _sample_categorical(np.exp(log_p), self.rng)

        for t in range(T - 2, -1, -1):
            log_p = log_alpha[t] + log_trans[:, states[t + 1]]
            log_p -= _logsumexp(log_p)
            states[t] = _sample_categorical(np.exp(log_p), self.rng)

        return states, log_em_all

    # ------------------------------------------------------------------
    # Fit (Gibbs Sampling)
    # ------------------------------------------------------------------

    def fit(
        self,
        X: np.ndarray,
        snapshot_callback: Optional[Callable[[int, np.ndarray], None]] = None,
    ) -> StickyHDPHMM:
        """
        Fit the HDP-HMM via Gibbs sampling.

        The Gibbs sampler alternates between:
        1. Sample state assignments (FFBS) given current parameters
        2. Sample emission parameters given assignments
        3. Sample transition matrix given assignments
        4. Sample global weights (beta) given assignment counts

        After burn-in, we average over samples for final estimates.

        Parameters
        ----------
        snapshot_callback : callable, optional
            Called with (iteration, assignments) each iteration.
            Used to stream live regime coloring to the dashboard chart.
        """
        T, D = X.shape

        # ── Dynamic state space ──
        # Cap initial K at 40 — unused states get pruned, expansion adds more if needed
        K = min(40, max(20, int(self.gamma * np.log(max(T, 100)))))
        K_BUFFER = 5

        jit_tag = "numba-JIT" if _HAS_NUMBA else "numpy"
        print(
            f"  Gibbs sampler: {self.n_iter} iterations, "
            f"K_init={K} (diagonal cov, {jit_tag}), kappa={self.kappa}"
        )
        print(f"  Data: {T:,} bars x {D} features")
        sys.stdout.flush()

        # Initialize: K-means warm start
        from sklearn.cluster import MiniBatchKMeans  # type: ignore[import-untyped]

        n_init_clusters = min(10, K)
        try:
            km = MiniBatchKMeans(
                n_clusters=n_init_clusters, batch_size=min(10000, T),
                n_init=3, random_state=self.rng.randint(0, 10000),
            )
            assignments = km.fit_predict(X)
        except (ValueError, RuntimeError):
            assignments = self.rng.randint(0, n_init_clusters, size=T)

        # Initialize beta via stick-breaking
        self.beta_ = self._stick_breaking(self.gamma, K)

        # Sample initial emission params
        means, covars = self._sample_emission_params(X, assignments, K, D)

        # Collect samples after burn-in
        transmat = np.zeros((K, K))  # initialized before loop
        state_samples: list[np.ndarray] = []
        transmat_samples: list[np.ndarray] = []
        means_samples: list[np.ndarray] = []
        covars_samples: list[np.ndarray] = []
        active_counts: list[int] = []

        self.convergence_history_ = []
        prev_ll = -np.inf

        def _expand_state_space(
            K_old: int, K_new: int,
            means_: np.ndarray, vars_: np.ndarray, transmat_: np.ndarray,
        ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
            """Grow all K-indexed arrays to accommodate more states."""
            new_means = np.zeros((K_new, D))
            new_means[:K_old] = means_
            new_means[K_old:] = self.rng.normal(0, 0.5, size=(K_new - K_old, D))
            # Diagonal variances
            new_vars = np.ones((K_new, D)) * 0.5
            new_vars[:K_old] = vars_
            # Transmat
            new_transmat = np.zeros((K_new, K_new))
            new_transmat[:K_old, :K_old] = transmat_
            for k in range(K_old, K_new):
                new_transmat[k, k] = 0.9
                leftover = 0.1 / max(K_new - 1, 1)
                new_transmat[k, :] += leftover
                new_transmat[k, k] = 0.9
            return new_means, new_vars, new_transmat

        for iteration in range(1, self.n_iter + 1):
            # ── Dynamic expansion check ──
            max_assigned = int(assignments.max()) if len(assignments) > 0 else 0
            n_active = len(np.unique(assignments))
            if max_assigned >= K - K_BUFFER or n_active >= K - K_BUFFER:
                K_old = K
                K = K + max(K // 2, 10)  # grow by 50% or at least 10
                print(
                    f"    [dynamic] Expanding state space: {K_old} -> {K} "
                    f"(active={n_active}, max_idx={max_assigned})"
                )
                sys.stdout.flush()
                means, covars, transmat = _expand_state_space(
                    K_old, K, means, covars, transmat
                )
                self.beta_ = self._stick_breaking(self.gamma, K)
                empirical = np.bincount(assignments, minlength=K).astype(float)
                empirical /= max(empirical.sum(), 1e-10)
                self.beta_ = 0.3 * self.beta_ + 0.7 * empirical
            # 1. Sample transition matrix
            transmat = self._sample_transitions(assignments, K)

            # 2. Start probabilities from assignment[0] counts across iterations
            startprob = np.zeros(K)
            startprob[assignments[0]] = 1.0
            # Smooth with beta
            assert self.beta_ is not None  # populated above
            startprob = 0.8 * startprob + 0.2 * self.beta_  # type: ignore[assignment]
            startprob /= startprob.sum()

            # 3. Forward-filtering backward-sampling for state sequence
            assignments, log_em = self._sample_states(
                X, means, covars, transmat, startprob, K, D
            )

            # 4. Sample emission params given new assignments
            means, covars = self._sample_emission_params(X, assignments, K, D)

            # 5. Resample beta via stick-breaking (approximate)
            state_counts = np.bincount(assignments, minlength=K).astype(float)
            self.beta_ = self._stick_breaking(self.gamma, K)
            empirical = state_counts / max(state_counts.sum(), 1e-10)
            self.beta_ = 0.3 * self.beta_ + 0.7 * empirical

            # Track convergence
            n_active = len(np.unique(assignments))
            active_counts.append(n_active)

            # Log-likelihood (reuse emission matrix from FFBS — no recomputation)
            ll = float(np.sum(log_em[np.arange(T), assignments]))

            delta = abs(ll - prev_ll) if prev_ll != -np.inf else 0.0
            prev_ll = ll

            # ── Per-iteration diagnostics ──
            active_counts_arr = state_counts[state_counts > 0]
            probs = active_counts_arr / active_counts_arr.sum()
            entropy = float(-np.sum(probs * np.log2(probs + 1e-12)))

            switches = np.sum(assignments[1:] != assignments[:-1])
            switch_rate = float(switches / max(T - 1, 1))

            active_indices = np.where(state_counts > 0)[0]
            if len(active_indices) > 0:
                diag_vals = [
                    transmat[i, i] for i in active_indices if i < transmat.shape[0]
                ]
                self_trans = float(np.mean(diag_vals)) if diag_vals else 0.0
            else:
                self_trans = 0.0

            max_regime_pct = (
                float(active_counts_arr.max() / T * 100)
                if len(active_counts_arr) > 0
                else 0.0
            )

            diffs = np.where(assignments[1:] != assignments[:-1])[0]
            n_segments = len(diffs) + 1
            avg_dwell = float(T / n_segments)

            self.convergence_history_.append(
                {
                    "iter": iteration,
                    "log_likelihood": float(ll),
                    "n_active_states": int(n_active),
                    "delta": float(delta),
                    "entropy": entropy,
                    "switch_rate": switch_rate,
                    "self_transition": self_trans,
                    "max_regime_pct": max_regime_pct,
                    "avg_dwell": avg_dwell,
                }
            )

            # Collect post-burn-in samples
            if iteration > self.burn_in:
                state_samples.append(assignments.copy())
                transmat_samples.append(transmat.copy())
                means_samples.append(means.copy())
                covars_samples.append(covars.copy())

            # Progress reporting — every iteration for live dashboard feedback
            ll_per_bar = ll / max(T, 1)
            print(
                f"    iter {iteration:>4}/{self.n_iter}: "
                f"Regimes={n_active:<3d} "
                f"Fit={ll_per_bar:>7.2f}/bar  "
                f"LL={ll:>12,.0f}  "
                f"D={delta:>10.1f}  "
                f"Entropy={entropy:.2f}  "
                f"Switch={switch_rate:.3f}  "
                f"SelfTr={self_trans:.2f}  "
                f"MaxReg={max_regime_pct:.1f}%  "
                f"Dwell={avg_dwell:.1f}"
            )
            sys.stdout.flush()

            # Emit live regime snapshot for chart coloring
            if snapshot_callback:
                snapshot_callback(iteration, assignments)

        # Aggregate post-burn-in samples
        if not state_samples:
            # No burn-in collected -- use last iteration
            state_samples = [assignments]
            transmat_samples = [transmat]
            means_samples = [means]
            covars_samples = [covars]

        # Pad all parameter samples to the final K size (dynamic expansion
        # means earlier samples may have smaller K)
        K_final = K
        padded_means: list[np.ndarray] = []
        padded_covars: list[np.ndarray] = []
        padded_trans: list[np.ndarray] = []
        for m, c, tr in zip(means_samples, covars_samples, transmat_samples):
            k_s = m.shape[0]
            if k_s < K_final:
                pm = np.zeros((K_final, D))
                pm[:k_s] = m
                pc = np.ones((K_final, D)) * 0.5  # diagonal variances
                pc[:k_s] = c
                pt = np.zeros((K_final, K_final))
                pt[:k_s, :k_s] = tr
                padded_means.append(pm)
                padded_covars.append(pc)
                padded_trans.append(pt)
            else:
                padded_means.append(m)
                padded_covars.append(c)
                padded_trans.append(tr)

        # Mode of state assignments across samples
        state_matrix = np.array(state_samples)  # (n_samples, T)
        from scipy.stats import mode as scipy_mode

        mode_result = scipy_mode(state_matrix, axis=0, keepdims=False)
        final_assignments = mode_result.mode.flatten()

        # Average transition matrix
        avg_transmat = np.mean(padded_trans, axis=0)

        # Average emission params
        avg_means = np.mean(padded_means, axis=0)
        avg_covars = np.mean(padded_covars, axis=0)

        # Identify truly active states and compact
        active_states = sorted(np.unique(final_assignments))
        self.n_active_ = len(active_states)

        # Build mapping from old indices to new compact indices
        old_to_new = {old: new for new, old in enumerate(active_states)}
        self.state_map_ = old_to_new

        # Remap assignments
        compacted_assignments = np.array([old_to_new[s] for s in final_assignments])

        # Compact parameters to active states only
        K_active = self.n_active_
        self.means_ = avg_means[active_states]
        self.covars_ = avg_covars[active_states]

        # Compact transition matrix
        self.transmat_ = np.zeros((K_active, K_active))
        for i, old_i in enumerate(active_states):
            for j, old_j in enumerate(active_states):
                self.transmat_[i, j] = avg_transmat[old_i, old_j]
            # Renormalize row
            row_sum = self.transmat_[i].sum()
            if row_sum > 0:
                self.transmat_[i] /= row_sum

        self.startprob_ = np.zeros(K_active)
        self.startprob_[old_to_new.get(final_assignments[0], 0)] = 1.0

        # Store for predict()
        self._assignments = compacted_assignments
        self._X_train = X

        print(
            f"\n  Gibbs complete: {self.n_active_} active regimes "
            f"discovered (K_final={K}, dynamic)"
        )
        print(f"  Post burn-in samples: {len(state_samples)}")
        sys.stdout.flush()

        return self

    # ------------------------------------------------------------------
    # Prediction & Scoring
    # ------------------------------------------------------------------

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Assign each observation to its most likely state (greedy Viterbi-like)."""
        assert self.means_ is not None and self.covars_ is not None
        assert self.transmat_ is not None
        D = X.shape[1]
        K = self.n_active_

        # Vectorized emission matrix (all T×K at once)
        log_em = self._log_emission_matrix(X, self.means_, self.covars_, K, D)
        log_trans = np.log(np.asarray(self.transmat_, dtype=np.float64) + 1e-300)

        if _HAS_NUMBA:
            return _predict_viterbi_jit(
                np.ascontiguousarray(log_em),
                np.ascontiguousarray(log_trans),
            ).astype(int)

        # Fallback: Python loop (still fast — just argmax per step)
        T = len(X)
        assignments = np.zeros(T, dtype=int)
        assignments[0] = np.argmax(log_em[0])
        for t in range(1, T):
            log_probs = log_em[t] + log_trans[assignments[t - 1]]
            assignments[t] = np.argmax(log_probs)
        return assignments

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Compute posterior state probabilities for each observation."""
        assert self.means_ is not None and self.covars_ is not None
        assert self.transmat_ is not None
        T = len(X)
        D = X.shape[1]
        K = self.n_active_

        # Vectorized emission matrix
        log_em = self._log_emission_matrix(X, self.means_, self.covars_, K, D)
        log_trans = np.log(np.asarray(self.transmat_, dtype=np.float64) + 1e-300)
        probs = np.zeros((T, K))

        # First timestep
        log_p = log_em[0].copy()
        log_p -= _logsumexp(log_p)
        probs[0] = np.exp(log_p)

        for t in range(1, T):
            log_p = log_em[t] + log_trans[probs[t - 1].argmax()]
            log_p -= _logsumexp(log_p)
            probs[t] = np.exp(log_p)

        return probs

    def score(self, X: np.ndarray) -> float:
        """Compute total log-likelihood of data under current model."""
        assert self.means_ is not None and self.covars_ is not None
        D = X.shape[1]
        K = self.n_active_
        assignments = self.predict(X)
        log_em = self._log_emission_matrix(X, self.means_, self.covars_, K, D)
        return float(np.sum(log_em[np.arange(len(X)), assignments]))

    @property
    def n_components(self) -> int:
        """Number of active regime components discovered."""
        return self.n_active_
