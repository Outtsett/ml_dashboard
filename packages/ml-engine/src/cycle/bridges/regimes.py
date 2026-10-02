"""Tasks and regimes of a training span, and the forward filter.

- ``chronological_blocks``: the training rows cut into consecutive blocks in
  time order (the "tasks" of the meta-learning families). Blocks never
  interleave, so an inner loop that adapts on one block and scores the next
  never scores a row older than what it adapted on.
- ``KMeansRegimes``: k-means regimes fitted on training rows
  (``binning.ClusterStates``) with each regime's training up-rate.
- ``forward_filter``: P(state_t | observations_1..t) of a hidden Markov
  model, in log space, one step at a time. **This is the only posterior a
  prediction may use**: the smoothed ``forward_backward`` posterior at t reads
  observations after t, and exists here only so tests can show the two differ.
- ``gaussian_log_emissions`` and ``fit_gaussian_hmm`` (hmmlearn, diagonal
  covariances, fitted on the training rows only).

Causality: the filtered state at row t is a function of emission rows <= t
only; a row whose emission is missing (any NaN) is a pure prediction step
(the prior propagated through the transition, no update).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from cycle.bridges.binning import ClusterStates, conditional_means


def chronological_blocks(rows, *, block_count: int | None = None, block_bars: int | None = None) -> list[np.ndarray]:
    """``rows`` (increasing) cut into consecutive blocks: ``block_count`` of
    near-equal size, or blocks spanning ``block_bars`` bars of row numbers."""
    rows = np.asarray(rows, dtype=np.int64).reshape(-1)
    if rows.size == 0:
        return []
    if (block_count is None) == (block_bars is None):
        raise ValueError("give exactly one of block_count or block_bars")
    if block_count is not None:
        if block_count < 1:
            raise ValueError(f"block_count must be >= 1, got {block_count}")
        return [block for block in np.array_split(rows, min(int(block_count), rows.size)) if block.size]
    if block_bars < 1:
        raise ValueError(f"block_bars must be >= 1, got {block_bars}")
    keys = (rows - rows[0]) // int(block_bars)
    cuts = np.flatnonzero(np.diff(keys)) + 1
    return [block for block in np.split(rows, cuts) if block.size]


@dataclass
class KMeansRegimes:
    states: ClusterStates
    up_rates: np.ndarray        # Beta(1, 1)-smoothed training up-rate per regime

    @classmethod
    def fit(cls, features: np.ndarray, labels: np.ndarray, train_index, regime_count: int, seed: int,
            columns=None) -> KMeansRegimes:
        rows = np.asarray(train_index, dtype=np.int64)
        states = ClusterStates.fit(features, rows, regime_count, seed, columns=columns)
        codes = states.assign(features, rows)
        up = np.asarray(labels, dtype=np.float64)[rows]
        rates = conditional_means(codes, (up >= 0.5).astype(np.float64) * np.where(np.isfinite(up), 1.0, np.nan),
                                  regime_count, prior_weight=2.0, prior_mean=0.5)
        return cls(states, rates)

    def assign(self, features: np.ndarray, rows) -> np.ndarray:
        return self.states.assign(features, rows)

    def to_dict(self) -> dict:
        return {"states": self.states.to_dict(), "upRates": [float(v) for v in self.up_rates]}

    @classmethod
    def from_dict(cls, document: dict) -> KMeansRegimes:
        return cls(ClusterStates.from_dict(document["states"]), np.asarray(document["upRates"], dtype=np.float64))


def _log_normalise(values: np.ndarray) -> tuple[np.ndarray, float]:
    peak = float(np.max(values))
    if not np.isfinite(peak):
        return np.full(values.shape, -np.log(values.size)), -np.inf
    total = peak + float(np.log(np.sum(np.exp(values - peak))))
    return values - total, total


def forward_filter(log_emissions: np.ndarray, transition: np.ndarray, initial: np.ndarray) -> tuple[np.ndarray, float]:
    """Filtered state probabilities (n, K) and the log likelihood of the rows
    with emissions. ``log_emissions[t, k]`` = log p(x_t | state k) (a row with
    any NaN is skipped: prediction only); ``transition[i, j]`` = P(j | i);
    ``initial`` = P(state at the first row, before its emission)."""
    log_emissions = np.asarray(log_emissions, dtype=np.float64)
    transition = np.asarray(transition, dtype=np.float64)
    count, states = log_emissions.shape
    log_transition = np.log(np.clip(transition, 1e-300, None))
    log_prior = np.log(np.clip(np.asarray(initial, dtype=np.float64), 1e-300, None))
    log_prior, _ = _log_normalise(log_prior)
    filtered = np.empty((count, states), dtype=np.float64)
    log_likelihood = 0.0
    for t in range(count):
        if t > 0:
            previous = np.log(np.clip(filtered[t - 1], 1e-300, None))
            log_prior = _log_normalise(np.logaddexp.reduce(previous[:, None] + log_transition, axis=0))[0]
        emission = log_emissions[t]
        if np.all(np.isfinite(emission)):
            posterior, evidence = _log_normalise(log_prior + emission)
            log_likelihood += evidence
        else:
            posterior = log_prior
        filtered[t] = np.exp(posterior)
    return filtered, float(log_likelihood)


def forward_backward(log_emissions: np.ndarray, transition: np.ndarray, initial: np.ndarray) -> np.ndarray:
    """The SMOOTHED posterior P(state_t | all rows). Reads the future: for
    tests and diagnostics only, never for a prediction."""
    filtered, _ = forward_filter(log_emissions, transition, initial)
    log_emissions = np.asarray(log_emissions, dtype=np.float64)
    count, states = log_emissions.shape
    log_transition = np.log(np.clip(np.asarray(transition, dtype=np.float64), 1e-300, None))
    log_beta = np.zeros((count, states))
    for t in range(count - 2, -1, -1):
        emission = log_emissions[t + 1]
        emission = emission if np.all(np.isfinite(emission)) else np.zeros(states)
        log_beta[t] = _log_normalise(np.logaddexp.reduce(log_transition + (emission + log_beta[t + 1])[None, :], axis=1))[0]
    smoothed = np.log(np.clip(filtered, 1e-300, None)) + log_beta
    smoothed = np.exp(smoothed - np.logaddexp.reduce(smoothed, axis=1, keepdims=True))
    return smoothed


def gaussian_log_emissions(values: np.ndarray, means: np.ndarray, variances: np.ndarray) -> np.ndarray:
    """log N(x_t | mean_k, diag(variance_k)) for each row and state (n, K); NaN rows stay NaN."""
    values = np.asarray(values, dtype=np.float64)
    if values.ndim == 1:
        values = values[:, None]
    means = np.asarray(means, dtype=np.float64).reshape(-1, values.shape[1])
    variances = np.clip(np.asarray(variances, dtype=np.float64).reshape(-1, values.shape[1]), 1e-12, None)
    difference = values[:, None, :] - means[None, :, :]
    out = -0.5 * (np.log(2.0 * np.pi * variances)[None, :, :] + difference ** 2 / variances[None, :, :]).sum(axis=2)
    out[~np.all(np.isfinite(values), axis=1)] = np.nan
    return out


def fit_gaussian_hmm(values: np.ndarray, state_count: int, seed: int, iteration_count: int = 100) -> dict:
    """A diagonal-covariance Gaussian HMM (hmmlearn) fitted on the finite rows
    of ``values`` (training rows only). Returns ``initial``, ``transition``,
    ``means``, ``variances`` as numpy arrays, states ordered by the mean of the
    first column (so a refit with another seed names the states the same way)."""
    from hmmlearn.hmm import GaussianHMM

    values = np.asarray(values, dtype=np.float64)
    if values.ndim == 1:
        values = values[:, None]
    values = values[np.all(np.isfinite(values), axis=1)]
    model = GaussianHMM(n_components=int(state_count), covariance_type="diag", n_iter=int(iteration_count),
                        random_state=int(seed))
    model.fit(values)
    order = np.argsort(model.means_[:, 0])
    variances = np.asarray([np.diag(covariance) for covariance in model.covars_])
    return {
        "initial": np.asarray(model.startprob_)[order],
        "transition": np.asarray(model.transmat_)[np.ix_(order, order)],
        "means": np.asarray(model.means_)[order],
        "variances": variances[order],
    }


__all__ = ["KMeansRegimes", "chronological_blocks", "fit_gaussian_hmm", "forward_backward", "forward_filter",
           "gaussian_log_emissions"]
