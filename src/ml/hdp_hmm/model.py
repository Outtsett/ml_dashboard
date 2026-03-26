"""
Sticky HDP-HMM model — core Gibbs sampler algorithm.

Implements the Sticky Hierarchical Dirichlet Process Hidden Markov Model
(Fox et al. 2011 / Teh et al. 2006) via truncated Gibbs sampling with
Numba-JIT forward-filtering backward-sampling.
"""

import time

import numpy as np
from numba import njit

from shared.protocol import (
    emit_progress, emit_metric, emit_overlay, emit_log,
    emit_model_state, emit_sampler_diagnostics,
)
from shared.diagnostics import (
    compute_cluster_quality,
    compute_feature_attribution,
    compute_emission_heatmap,
    evaluate_quality_gates,
    compute_sampler_diagnostics as _compute_sampler_diagnostics,
)
from hdp_hmm.config import K_TRUNC, NIG_PRIOR


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


# ── Diagnostic Helpers ─────────────────────────────────────────────────────

def _build_regime_profiles(X, states, active_regimes, transition_matrix, close_vals):
    """
    Per-regime summary statistics for the model state snapshot.

    For each active regime: mean_return, volatility (annualized), Sharpe,
    bar_count, mean_dwell, max_dwell, top transition targets.

    Args:
        X:                 (T, D) feature matrix
        states:            (T,) state assignments
        active_regimes:    array of active regime indices
        transition_matrix: (K, K) transition probabilities
        close_vals:        (T,) raw close prices

    Returns dict keyed by regime id.
    """
    T = len(states)
    close_arr = np.asarray(close_vals, dtype=np.float64)

    # Log returns from close prices
    if len(close_arr) > 1 and np.any(close_arr > 0):
        log_returns = np.diff(np.log(np.maximum(close_arr, 1e-10)))
        lr_padded = np.concatenate([[0.0], log_returns])
    else:
        lr_padded = np.zeros(T)

    # Compute dwell runs per regime
    change_points = np.where(np.diff(states) != 0)[0] + 1
    boundaries = np.concatenate([[0], change_points, [T]])
    run_lengths = np.diff(boundaries)
    run_regimes = states[boundaries[:-1]]

    profiles = {}
    for k in active_regimes:
        k_int = int(k)
        mask = states == k
        bar_count = int(np.sum(mask))

        if bar_count == 0:
            continue

        # Return statistics
        regime_lr = lr_padded[mask]
        mean_ret = float(np.mean(regime_lr))
        vol = float(np.std(regime_lr) * np.sqrt(252))  # annualized
        sharpe = float(mean_ret * np.sqrt(252) / max(np.std(regime_lr), 1e-10))

        # Dwell statistics
        regime_runs = run_lengths[run_regimes == k]
        mean_dwell = float(np.mean(regime_runs)) if len(regime_runs) > 0 else float(bar_count)
        max_dwell = int(np.max(regime_runs)) if len(regime_runs) > 0 else bar_count

        # Top transition targets (up to 3)
        K_mat = transition_matrix.shape[0]
        if k_int < K_mat:
            row = transition_matrix[k_int].copy()
            row[k_int] = 0.0  # exclude self-transition
            top_targets = []
            for _ in range(min(3, K_mat)):
                j = int(np.argmax(row))
                prob = float(row[j])
                if prob < 0.01:
                    break
                top_targets.append({"regime": j, "probability": round(prob, 4)})
                row[j] = 0.0
        else:
            top_targets = []

        profiles[str(k_int)] = {
            "mean_return": round(mean_ret, 6),
            "volatility": round(vol, 4),
            "sharpe": round(sharpe, 4),
            "bar_count": bar_count,
            "mean_dwell": round(mean_dwell, 2),
            "max_dwell": max_dwell,
            "top_transitions": top_targets,
        }

    return profiles


def _compute_confidence_histogram(log_lik, states):
    """
    Confidence histogram from softmax of log-likelihoods.

    For each bar, softmax the log-likelihood across regimes to get
    P(k | x_t) for all k, then extract P(assigned state). Bin these
    probabilities into 10 buckets [0-0.1, 0.1-0.2, ..., 0.9-1.0].

    Args:
        log_lik: (T, K) log-likelihood matrix
        states:  (T,) assigned state indices

    Returns dict with: bins (list of 10 floats), edges (list of 11 floats),
    mean_confidence (float)
    """
    T, K = log_lik.shape

    # Softmax per row (numerically stable)
    max_ll = np.max(log_lik, axis=1, keepdims=True)
    exp_ll = np.exp(log_lik - max_ll)
    probs = exp_ll / (np.sum(exp_ll, axis=1, keepdims=True) + 1e-300)

    # Extract probability of assigned state for each bar
    assigned_probs = probs[np.arange(T), states]

    # Histogram into 10 bins
    edges = np.linspace(0.0, 1.0, 11)
    hist_counts, _ = np.histogram(assigned_probs, bins=edges)
    hist_fractions = hist_counts.astype(np.float64) / max(T, 1)

    return {
        "bins": [round(float(f), 4) for f in hist_fractions],
        "edges": [round(float(e), 2) for e in edges],
        "mean_confidence": round(float(np.mean(assigned_probs)), 4),
    }


# ── Sticky HDP-HMM Model ───────────────────────────────────────────────────

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

    def __init__(self, alpha=1.0, gamma=1.0, kappa=50.0, K_max=K_TRUNC):
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
        self.lambda_0 = NIG_PRIOR["lambda_0"]               # weak prior on mean
        self.a_0 = NIG_PRIOR["a_0"]                          # shape (> 1 for finite mean)
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
        """Log emission probability under diagonal Gaussian — fully vectorized.

        Computes all K regimes simultaneously via broadcasting:
          log_lik[t, k] = -0.5 * (D*log(2pi) + sum(log(var_k)) + sum((x_t - mu_k)^2 / var_k))

        Shape algebra: X(T,D), means(K,D), vars(K,D) → log_lik(T,K) in one shot.
        ~5x faster than the per-k loop on CPU, and enables trivial GPU port.
        """
        T, D = X.shape
        K = self.K

        vars_safe = np.maximum(self.vars, 1e-8)          # (K, D)
        log_det = np.sum(np.log(vars_safe), axis=1)       # (K,)
        inv_var = 1.0 / vars_safe                          # (K, D)

        # Broadcast: X(T,1,D) - means(1,K,D) → diff(T,K,D)
        # Then sum over D → mahal(T,K)
        # Memory-efficient: compute mahal without materializing full (T,K,D)
        # mahal[t,k] = sum_d (x_td - mu_kd)^2 / var_kd
        #            = sum_d x_td^2/var_kd - 2*x_td*mu_kd/var_kd + mu_kd^2/var_kd
        #            = x^2 @ inv_var.T - 2 * x @ (mu/var).T + sum(mu^2/var, axis=1)

        X2_invvar = X ** 2 @ inv_var.T                     # (T, K)
        X_mu_invvar = X @ (self.means * inv_var).T          # (T, K)
        mu2_invvar = np.sum(self.means ** 2 * inv_var, axis=1)  # (K,)

        mahal = X2_invvar - 2.0 * X_mu_invvar + mu2_invvar  # (T, K)

        const = D * np.log(2 * np.pi)
        log_lik = -0.5 * (const + log_det[np.newaxis, :] + mahal)

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
        Vectorized across D dimensions — no inner Python loop.
        """
        T, D = X.shape
        for k in range(self.K):
            mask = states == k
            n_k = np.sum(mask)

            if n_k == 0:
                # Sample from prior (vectorized across D)
                self.vars[k] = 1.0 / np.random.gamma(
                    self.a_0, 1.0 / (self.b_0 + 1e-10)
                )
                self.vars[k] = np.maximum(self.vars[k], 1e-8)
                self.means[k] = np.random.normal(
                    self.mu_0, np.sqrt(self.vars[k] / self.lambda_0)
                )
            else:
                X_k = X[mask]
                x_bar = np.mean(X_k, axis=0)                    # (D,)

                lambda_n = self.lambda_0 + n_k                   # scalar
                mu_n = (self.lambda_0 * self.mu_0 + n_k * x_bar) / lambda_n  # (D,)
                a_n = self.a_0 + n_k / 2.0                       # scalar

                ss = np.sum((X_k - x_bar) ** 2, axis=0)          # (D,)
                b_n = (self.b_0
                       + ss / 2.0
                       + self.lambda_0 * n_k * (x_bar - self.mu_0) ** 2
                       / (2.0 * lambda_n))                        # (D,)

                # Sample variance from IG (vectorized)
                self.vars[k] = 1.0 / np.random.gamma(a_n, 1.0 / (b_n + 1e-10))
                self.vars[k] = np.maximum(self.vars[k], 1e-8)

                # Sample mean from conditional Normal (vectorized)
                self.means[k] = np.random.normal(
                    mu_n, np.sqrt(self.vars[k] / lambda_n)
                )

    # ── Gibbs Step 3: Sample Transition Rows (Dirichlet Posterior) ────────

    def _sample_transitions(self, states):
        """
        Sample pi_j ~ Dir(alpha * beta + n_j + kappa * delta_j).
        Returns the transition count matrix for use in beta update.
        Vectorized transition counting via numpy (no Python loop over T).
        """
        K = self.K
        T = len(states)

        # Vectorized transition count: O(T) via fancy indexing
        from_states = states[:-1]
        to_states = states[1:]
        counts = np.zeros((K, K))
        np.add.at(counts, (from_states, to_states), 1)

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

    def fit(self, X, n_iter=500, burn_in=100, overlay_interval=25, timestamps=None,
            feature_names=None, close_vals=None):
        """
        Fit via Gibbs sampling, emitting JSON events on stdout.

        Each iteration:
          1. FFBS to sample state sequence z_{1:T}
          2. NIG posterior to sample emission params (mu_k, sigma2_k)
          3. Dirichlet posterior to sample transition rows pi_j
          4-6. CRF auxiliary variables to sample global beta

        Returns (self, iteration_metrics, wf_counts):
          - iteration_metrics: list of per-iteration ConvergencePoint dicts
          - wf_counts: list of 5 (T, K) int16 arrays for walk-forward stability
        """
        from shared.labeling import renumber_states, assign_colors, get_labeler

        T, D = X.shape
        emit_log(f"Starting Gibbs sampling: {n_iter} iter, {T} bars, {D} features, K_max={self.K}")
        emit_log(f"Hyperparameters: alpha={self.alpha}, gamma={self.gamma}, kappa={self.kappa}")

        self._init_params(X)

        emit_log("Compiling JIT kernels (first iteration may be slow)...")

        # Windowed mode counters — replaces storing every post-burn-in sample
        n_post_burn = max(1, n_iter - burn_in)
        n_wf_windows = 5
        wf_window_size = max(1, n_post_burn // n_wf_windows)
        wf_counts = [np.zeros((T, self.K), dtype=np.int16) for _ in range(n_wf_windows)]
        total_counts = np.zeros((T, self.K), dtype=np.int32)

        iteration_metrics = []
        prev_states = None
        prev_states_for_ari = None  # separate tracker for ARI (not overwritten each iter)
        stability_history = []      # assignment stability per iteration
        t_start = time.time()

        # Resolve close values for diagnostics
        if close_vals is not None:
            close_arr = np.asarray(close_vals, dtype=np.float64)
        else:
            close_arr = np.zeros(T, dtype=np.float64)

        # Default feature names if not provided
        if feature_names is None:
            feature_names = [f"f{i}" for i in range(D)]

        for it in range(1, n_iter + 1):
            # Step 1: Sample state sequence (timed)
            t0 = time.perf_counter()
            log_lik = self._compute_log_likelihood(X)
            states, total_ll = self._sample_states(X, log_lik)
            ffbs_ms = (time.perf_counter() - t0) * 1000.0
            self.state_sequence = states
            self.log_likelihoods.append(total_ll)

            # Step 2: Sample emission parameters from NIG posterior (timed)
            t0 = time.perf_counter()
            self._sample_emission_params(X, states)
            emission_ms = (time.perf_counter() - t0) * 1000.0

            # Steps 3-6: Sample transitions and beta (timed)
            t0 = time.perf_counter()
            transition_counts = self._sample_transitions(states)
            self._sample_beta(transition_counts)
            transition_ms = (time.perf_counter() - t0) * 1000.0

            # Count active regimes (> 1% of bars)
            unique, counts = np.unique(states, return_counts=True)
            active = unique[counts > max(1, T * 0.01)]
            n_active = len(active)

            # Accumulate post-burn-in counts into windowed counters
            if it > burn_in:
                post_idx = it - burn_in - 1
                win = min(post_idx // wf_window_size, n_wf_windows - 1)
                for k in unique:
                    if k < self.K:
                        mask = (states == k)
                        wf_counts[win][mask, k] += 1
                        total_counts[mask, k] += 1

            # ── Compute per-iteration metrics ──────────────────────────────

            beta_entropy = float(-np.sum(self.beta * np.log(self.beta + 1e-300)))

            active_self_trans = float(np.mean([
                self.transition_matrix[k, k] for k in active
            ])) if len(active) > 0 else 0.0

            # Switch rate: fraction of consecutive bars changing state (vectorized)
            state_changes = states[1:] != states[:-1]
            switches = int(np.sum(state_changes))
            switch_rate = switches / max(1, T - 1)

            # Max regime percentage
            max_pct = float(np.max(counts) / T) if len(counts) > 0 else 0.0

            # Average dwell time — vectorized via diff of change indices
            change_indices = np.where(state_changes)[0]
            if len(change_indices) > 0:
                boundaries = np.concatenate([[0], change_indices + 1, [T]])
                run_lengths = np.diff(boundaries)
                avg_dwell = float(np.mean(run_lengths))
            else:
                avg_dwell = float(T)

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
                stability_history.append(assignment_stability)
            emit_metric("switch_rate", switch_rate, it, n_iter)
            emit_metric("avg_dwell", avg_dwell, it, n_iter)

            # ── Sampler diagnostics every 10 iterations ────────────────────
            if it % 10 == 0 and it > 1:
                diag = _compute_sampler_diagnostics(
                    self.log_likelihoods, stability_history
                )
                diag["step_timing"] = {
                    "ffbs_ms": round(ffbs_ms, 2),
                    "emission_ms": round(emission_ms, 2),
                    "transition_ms": round(transition_ms, 2),
                }
                emit_sampler_diagnostics(it, n_iter, diag)

            prev_states_for_ari = prev_states
            prev_states = states.copy()

            # Emit overlay at intervals
            if timestamps is not None and it % overlay_interval == 0:
                _renum = renumber_states(states)
                _colors = assign_colors(_renum.n_regimes)
                _labeler = get_labeler("simple")
                _ret_col = 0
                _means = np.array([
                    float(np.mean(X[_renum.states == rid, _ret_col]))
                    if np.any(_renum.states == rid) else 0.0
                    for rid in range(_renum.n_regimes)
                ])
                _vols = np.array([
                    float(np.std(X[_renum.states == rid, _ret_col]))
                    if np.any(_renum.states == rid) else 0.0
                    for rid in range(_renum.n_regimes)
                ])
                _labeler.fit(_means, _vols)
                _labels = {}
                for rid in range(_renum.n_regimes):
                    _mask = _renum.states == rid
                    _pct = float(np.sum(_mask)) / len(_renum.states) * 100
                    _lr = _labeler.label(rid, X[_mask], [], _means[rid], _vols[rid], 0.0, _pct)
                    _labels[str(rid)] = _lr.label
                emit_overlay(timestamps, _renum.states, _colors, _labels,
                             self.transition_matrix[:_renum.n_regimes, :_renum.n_regimes], _renum.n_regimes)

            # ── Full model state snapshot at overlay intervals ─────────────
            if it % overlay_interval == 0:
                try:
                    active_mask = np.zeros(self.K, dtype=bool)
                    for k in active:
                        active_mask[k] = True

                    # Cluster quality metrics
                    cluster_metrics = compute_cluster_quality(
                        X, states, prev_states_for_ari,
                        self.means, self.vars, close_arr,
                    )
                    cluster_metrics["max_regime_pct"] = max_pct

                    # Feature attribution
                    attribution = compute_feature_attribution(
                        self.means, self.vars, feature_names, active_mask,
                    )

                    # Emission heatmap
                    heatmap = compute_emission_heatmap(
                        self.means, self.vars, active_mask,
                    )

                    # Quality gates
                    gates = evaluate_quality_gates(
                        cluster_metrics, n_active, active_self_trans,
                        switch_rate, avg_dwell, beta_entropy,
                        {"alpha": self.alpha, "gamma": self.gamma, "kappa": self.kappa},
                    )

                    # Regime profiles
                    regime_profiles = _build_regime_profiles(
                        X, states, active, self.transition_matrix, close_arr,
                    )

                    # Confidence histogram
                    confidence_hist = _compute_confidence_histogram(log_lik, states)

                    snapshot = {
                        "cluster_quality": cluster_metrics,
                        "feature_attribution": attribution,
                        "emission_heatmap": heatmap,
                        "quality_gates": gates,
                        "regime_profiles": regime_profiles,
                        "confidence_histogram": confidence_hist,
                        "feature_names": feature_names,
                        "n_active_regimes": int(n_active),
                        "active_regime_ids": [int(k) for k in active],
                    }
                    emit_model_state(it, n_iter, snapshot)
                except Exception as e:
                    emit_log(f"Model state snapshot failed at iter {it}: {e}", level="warn")

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

        # Mode assignment from accumulated counts
        if total_counts.sum() > 0:
            self.state_sequence = np.argmax(total_counts, axis=1).astype(np.int64)

        elapsed = time.time() - t_start
        n_active_final = len(np.unique(self.state_sequence))
        emit_log(f"Training complete: {elapsed:.1f}s, {n_active_final} regimes discovered")
        return self, iteration_metrics, wf_counts
