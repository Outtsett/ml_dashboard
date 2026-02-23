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
from scipy.stats import invwishart, multivariate_normal  # type: ignore[import-untyped]


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
    """

    def __init__(
        self,
        alpha: float = 1.0,
        gamma: float = 5.0,
        kappa: float = 50.0,
        max_states: int = 30,
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
        max_states : truncation level for the infinite state space.
                     Not a hard cap -- just a computational ceiling.
                     Active states will be much fewer.
        n_iter : total Gibbs sampling iterations.
        burn_in : iterations to discard before collecting samples.
        random_state : reproducibility seed.
        """
        self.alpha = alpha
        self.gamma = gamma
        self.kappa = kappa
        self.max_states = max_states
        self.n_iter = n_iter
        self.burn_in = burn_in
        self.rng = np.random.RandomState(random_state)  # type: ignore[attr-defined]  # pylint: disable=no-member

        # Model state (populated during fit)
        self.means_: Optional[np.ndarray] = None  # (K, D) emission means
        self.covars_: Optional[np.ndarray] = None  # (K, D, D) emission covariances
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
        Sample Gaussian emission parameters for each state from posterior.

        Think of it as: after we know which bars belong to which regime,
        we ask "what's the typical behavior of bars in regime k?" and
        sample the answer from a posterior that combines our prior beliefs
        with the actual data.
        """
        # Normal-Inverse-Wishart prior
        mu_0 = np.zeros(D)  # prior mean = zero (data is standardized)
        kappa_0 = 0.1  # weak prior strength on mean
        nu_0 = D + 2.0  # prior degrees of freedom (minimum + 2)
        Psi_0 = np.eye(D) * 0.5  # prior scale matrix

        means = np.zeros((K, D))
        covars = np.zeros((K, D, D))

        for k in range(K):
            mask = assignments == k
            n_k = mask.sum()

            if n_k < 2:
                # Not enough data -- sample from prior
                means[k] = self.rng.multivariate_normal(mu_0, np.eye(D) * 0.5)
                covars[k] = invwishart.rvs(df=nu_0, scale=Psi_0, random_state=self.rng)
                continue

            X_k = X[mask]
            x_bar = X_k.mean(axis=0)

            # Posterior parameters (Normal-Inverse-Wishart conjugacy)
            kappa_n = kappa_0 + n_k
            mu_n = (kappa_0 * mu_0 + n_k * x_bar) / kappa_n
            nu_n = nu_0 + n_k
            S_k = (X_k - x_bar).T @ (X_k - x_bar)  # scatter matrix
            diff = x_bar - mu_0
            Psi_n = Psi_0 + S_k + (kappa_0 * n_k / kappa_n) * np.outer(diff, diff)

            # Ensure Psi_n is symmetric positive definite
            Psi_n = 0.5 * (Psi_n + Psi_n.T) + np.eye(D) * 1e-6

            # Sample covariance from Inverse-Wishart
            try:
                covars[k] = invwishart.rvs(df=nu_n, scale=Psi_n, random_state=self.rng)
            except (np.linalg.LinAlgError, ValueError):
                covars[k] = np.eye(D) * 0.5

            # Sample mean from Normal
            try:
                cov_mean = covars[k] / kappa_n
                cov_mean = 0.5 * (cov_mean + cov_mean.T) + np.eye(D) * 1e-8
                means[k] = self.rng.multivariate_normal(mu_n, cov_mean)
            except (np.linalg.LinAlgError, ValueError):
                means[k] = x_bar

        return means, covars

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
        self, x: np.ndarray, means: np.ndarray, covars: np.ndarray, K: int, D: int
    ) -> np.ndarray:
        """Compute log P(x | state=k) for all states (single observation)."""
        log_probs = np.full(K, -1e10)
        for k in range(K):
            try:
                cov_k = covars[k]
                cov_k = 0.5 * (cov_k + cov_k.T) + np.eye(D) * 1e-6
                log_probs[k] = multivariate_normal.logpdf(  # type: ignore[arg-type]
                    x, mean=means[k], cov=cov_k
                )
            except (np.linalg.LinAlgError, ValueError):
                log_probs[k] = -1e10
        return log_probs

    def _log_emission_matrix(
        self, X: np.ndarray, means: np.ndarray, covars: np.ndarray, K: int, D: int
    ) -> np.ndarray:
        """
        Vectorized: compute log P(x_t | state=k) for ALL T observations and K states.
        Returns T×K matrix. Uses direct Gaussian logpdf formula with numpy,
        ~100x faster than calling scipy.stats per-bar.
        """
        T = len(X)
        log_em = np.full((T, K), -1e10)
        for k in range(K):
            try:
                cov_k = 0.5 * (covars[k] + covars[k].T) + np.eye(D) * 1e-6
                # Cholesky decomposition for fast batch log-pdf
                L = np.linalg.cholesky(cov_k)
                log_det = 2.0 * np.sum(np.log(np.diag(L)))
                diff = X - means[k]  # T×D
                solved = np.linalg.solve(L, diff.T)  # D×T
                mahal = np.sum(solved**2, axis=0)  # T
                log_em[:, k] = -0.5 * (D * np.log(2 * np.pi) + log_det + mahal)
            except (np.linalg.LinAlgError, ValueError):
                log_em[:, k] = -1e10
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
    ) -> np.ndarray:
        """
        Forward-filtering backward-sampling (FFBS) for state sequence.

        Think of it as: reading the market data forward bar-by-bar and asking
        "what's the probability of each regime here, given everything I've
        seen so far?" Then walking backwards to sample a consistent sequence.
        This is more principled than Viterbi -- it samples from the posterior
        rather than just picking the MAP.
        """
        T = len(X)

        # Pre-compute ALL emission log-probabilities at once (vectorized)
        log_em_all = self._log_emission_matrix(X, means, covars, K, D)  # T×K

        # Forward pass (log scale for numerical stability)
        log_alpha = np.full((T, K), -1e10)

        # Initial
        log_sp = np.log(startprob + 1e-300)
        log_alpha[0] = log_sp + log_em_all[0]

        log_trans = np.log(transmat + 1e-300)  # K×K

        for t in range(1, T):
            # Vectorized: compute log_alpha[t] for all K states at once
            msg = log_alpha[t - 1, :, np.newaxis] + log_trans  # K×K
            log_alpha[t] = log_em_all[t] + sp_logsumexp(msg, axis=0)  # K

        # Backward sampling
        states = np.zeros(T, dtype=int)
        # Sample last state
        log_p = log_alpha[T - 1] - _logsumexp(log_alpha[T - 1])
        states[T - 1] = _sample_categorical(np.exp(log_p), self.rng)

        for t in range(T - 2, -1, -1):
            log_p = log_alpha[t] + log_trans[:, states[t + 1]]
            log_p -= _logsumexp(log_p)
            states[t] = _sample_categorical(np.exp(log_p), self.rng)

        return states

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
        K = self.max_states

        print(
            f"  Gibbs sampler: {self.n_iter} iterations, K_max={K}, kappa={self.kappa}"
        )
        print(f"  Data: {T:,} bars x {D} features")
        sys.stdout.flush()

        # Initialize: use K-means for a warm start
        from sklearn.cluster import KMeans  # type: ignore[import-untyped]

        n_init_clusters = min(8, K)
        try:
            km = KMeans(
                n_clusters=n_init_clusters,
                n_init=3,
                random_state=self.rng.randint(0, 10000),
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

        for iteration in range(1, self.n_iter + 1):
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
            assignments = self._sample_states(
                X, means, covars, transmat, startprob, K, D
            )

            # 4. Sample emission params given new assignments
            means, covars = self._sample_emission_params(X, assignments, K, D)

            # 5. Resample beta via stick-breaking (approximate)
            state_counts = np.bincount(assignments, minlength=K).astype(float)
            # Use counts to influence stick-breaking
            self.beta_ = self._stick_breaking(self.gamma, K)
            # Blend with empirical frequencies for stability
            empirical = state_counts / max(state_counts.sum(), 1e-10)
            self.beta_ = 0.3 * self.beta_ + 0.7 * empirical

            # Track convergence
            n_active = len(np.unique(assignments))
            active_counts.append(n_active)

            # Compute data log-likelihood under current params
            ll = 0.0
            for t in range(T):
                k = assignments[t]
                try:
                    cov_k = 0.5 * (covars[k] + covars[k].T) + np.eye(D) * 1e-6
                    ll += multivariate_normal.logpdf(
                        X[t],
                        mean=means[k],
                        cov=cov_k,  # type: ignore[arg-type]
                    )
                except (np.linalg.LinAlgError, ValueError):
                    ll -= 1e5

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
                f"Delta={delta:>10.1f}  "
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

        # Mode of state assignments across samples
        state_matrix = np.array(state_samples)  # (n_samples, T)
        from scipy.stats import mode as scipy_mode

        mode_result = scipy_mode(state_matrix, axis=0, keepdims=False)
        final_assignments = mode_result.mode.flatten()

        # Average transition matrix
        avg_transmat = np.mean(transmat_samples, axis=0)

        # Average emission params
        avg_means = np.mean(means_samples, axis=0)
        avg_covars = np.mean(covars_samples, axis=0)

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
            f"discovered (from K_max={K})"
        )
        print(f"  Post burn-in samples: {len(state_samples)}")
        sys.stdout.flush()

        return self

    # ------------------------------------------------------------------
    # Prediction & Scoring
    # ------------------------------------------------------------------

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Assign each observation to its most likely state."""
        assert self.means_ is not None and self.covars_ is not None
        assert self.transmat_ is not None
        T = len(X)
        D = X.shape[1]
        K = self.n_active_
        assignments = np.zeros(T, dtype=int)

        for t in range(T):
            log_probs = self._log_emission_prob(X[t], self.means_, self.covars_, K, D)
            if t > 0:
                log_probs += np.log(self.transmat_[assignments[t - 1]] + 1e-300)
            assignments[t] = np.argmax(log_probs)

        return assignments

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Compute posterior state probabilities for each observation."""
        assert self.means_ is not None and self.covars_ is not None
        assert self.transmat_ is not None
        T = len(X)
        D = X.shape[1]
        K = self.n_active_
        probs = np.zeros((T, K))

        for t in range(T):
            log_p = self._log_emission_prob(X[t], self.means_, self.covars_, K, D)
            if t > 0:
                log_p += np.log(self.transmat_[probs[t - 1].argmax()] + 1e-300)
            # Softmax
            log_p -= _logsumexp(log_p)
            probs[t] = np.exp(log_p)

        return probs

    def score(self, X: np.ndarray) -> float:
        """Compute total log-likelihood of data under current model."""
        assert self.means_ is not None and self.covars_ is not None
        T = len(X)
        D = X.shape[1]
        _K = self.n_active_  # noqa: F841
        ll = 0.0
        assignments = self.predict(X)
        for t in range(T):
            k = assignments[t]
            try:
                cov_k = 0.5 * (self.covars_[k] + self.covars_[k].T) + np.eye(D) * 1e-6
                ll += multivariate_normal.logpdf(
                    X[t],
                    mean=self.means_[k],
                    cov=cov_k,  # type: ignore[arg-type]
                )
            except (np.linalg.LinAlgError, ValueError):
                ll -= 1e5
        return float(ll)

    @property
    def n_components(self) -> int:
        """Number of active regime components discovered."""
        return self.n_active_
