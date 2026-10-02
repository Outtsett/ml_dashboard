"""A Gaussian hidden Markov model read through its forward filter.

Fit: Baum-Welch (hmmlearn, diagonal covariances, ``iteration_count`` EM
passes) on the training span's bars in time order, each bar's emission its
standardised feature row projected on the training rows' leading
``principal_component_count`` principal components (whitened). States are
ordered by the mean of the first component so a refit names them the same.

Prediction: the FORWARD filter alpha_t(k) = P(state_t = k | rows 1..t)
(``cycle.bridges.regimes.forward_filter``), run from the first bar of the
series the caller passes to the bar asked about. It never uses the smoothed
forward-backward posterior, which at bar t reads the bars after t. A bar
whose features are all missing (the warmup) is a pure prediction step: the
state distribution is carried through the transition matrix with no update.

The filter is cached over the rows already filtered and reused while the
caller's feature rows agree with the rows it was computed from (the same
array object, or equal rows), so the engine's bar-by-bar walk costs one filter
step per bar; a call whose rows differ from the cache recomputes from the
first differing row.
"""

from __future__ import annotations

import weakref

import numpy as np

from cycle.bridges.regimes import fit_gaussian_hmm, forward_filter, gaussian_log_emissions

from .common import Projection, single_thread
from .state_model import FitContext, StateModel


def _rows_equal(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    same = (left == right) | (np.isnan(left) & np.isnan(right))
    return np.all(same, axis=1)


class HiddenMarkovStates(StateModel):
    variant = "hmm_forward"
    soft = True
    sequential = True

    def __init__(self, parameters: dict, seed: int) -> None:
        super().__init__(parameters, seed)
        self._reset_cache()

    def _reset_cache(self) -> None:
        # buffers grown by doubling; rows [0, _cache_length) are valid
        self._cache_rows: np.ndarray | None = None        # the raw feature rows the filter was run over
        self._cache_filtered: np.ndarray | None = None
        self._cache_length = 0
        self._cache_owner = None

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        """``space``: the standardised rows of the training span in time order
        (a row of NaN where the bar's features are all missing)."""
        finite = np.all(np.isfinite(space), axis=1)
        self.projection = Projection.fit(space[finite], int(self.parameters["principal_component_count"]))
        emissions = np.full((space.shape[0], max(1, self.projection.components.shape[0] or space.shape[1])), np.nan)
        emissions[finite] = self.projection.transform(space[finite])
        with single_thread():
            fitted = fit_gaussian_hmm(emissions, int(self.parameters["state_count"]), self.seed,
                                      int(self.parameters["iteration_count"]))
        self.initial = fitted["initial"]
        self.transition = fitted["transition"]
        self.means = fitted["means"]
        self.variances = fitted["variances"]
        self._reset_cache()

    @property
    def state_count(self) -> int:
        return int(self.means.shape[0])

    def log_emissions(self, space: np.ndarray, missing: np.ndarray) -> np.ndarray:
        points = self.projection.transform(space)
        out = gaussian_log_emissions(points, self.means, self.variances)
        out[missing] = np.nan
        return out

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        raise TypeError("the hidden Markov model's state at a bar depends on the bars before it: use filtered()")

    def filtered(self, features: np.ndarray, rows, to_space) -> np.ndarray:
        """alpha_t for each of ``rows`` over the series ``features`` (raw rows;
        ``to_space(features, rows)`` standardises them)."""
        rows = np.asarray(rows, dtype=np.int64).reshape(-1)
        if rows.size == 0:
            return np.zeros((0, self.state_count))
        end = int(rows.max()) + 1
        start = self._reusable(features, end)
        if start < end:
            self._extend(features, start, end, to_space)
        return np.array(self._cache_filtered[rows], copy=True)

    def _reusable(self, features: np.ndarray, end: int) -> int:
        """How many leading rows of the cached filter hold for ``features``."""
        if self._cache_rows is None:
            return 0
        usable = min(self._cache_length, end, features.shape[0])
        owner = self._cache_owner() if self._cache_owner is not None else None
        if owner is features:
            return usable
        agree = _rows_equal(np.asarray(features[:usable], dtype=np.float64), self._cache_rows[:usable])
        if agree.all():
            return usable
        return int(np.argmin(agree))

    def _extend(self, features: np.ndarray, start: int, end: int, to_space) -> None:
        rows = np.arange(start, end)
        raw = np.asarray(features[start:end], dtype=np.float64)
        missing = ~np.any(np.isfinite(raw), axis=1)
        emissions = self.log_emissions(to_space(features, rows), missing)
        if start == 0:
            prior = self.initial
        else:
            prior = self._cache_filtered[start - 1] @ self.transition
        filtered, _ = forward_filter(emissions, self.transition, prior)
        if self._cache_rows is None or self._cache_rows.shape[0] < end or self._cache_rows.shape[1] != raw.shape[1]:
            capacity = max(end, 2 * (0 if self._cache_rows is None else self._cache_rows.shape[0]), 1024)
            rows_buffer = np.empty((capacity, raw.shape[1]), dtype=np.float64)
            filtered_buffer = np.empty((capacity, self.state_count), dtype=np.float64)
            if self._cache_rows is not None and start > 0 and self._cache_rows.shape[1] == raw.shape[1]:
                rows_buffer[:start] = self._cache_rows[:start]
                filtered_buffer[:start] = self._cache_filtered[:start]
            self._cache_rows, self._cache_filtered = rows_buffer, filtered_buffer
        self._cache_rows[start:end] = raw
        self._cache_filtered[start:end] = filtered
        self._cache_length = end
        try:
            self._cache_owner = weakref.ref(features)
        except TypeError:
            self._cache_owner = None

    def arrays(self) -> dict[str, np.ndarray]:
        return {**{f"projection_{k}": v for k, v in self.projection.arrays().items()}, "initial": self.initial,
                "transition": self.transition, "means": self.means, "variances": self.variances}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.projection = Projection.from_arrays({k[len("projection_"):]: v for k, v in arrays.items()
                                                  if k.startswith("projection_")})
        self.initial = np.asarray(arrays["initial"], dtype=np.float64)
        self.transition = np.asarray(arrays["transition"], dtype=np.float64)
        self.means = np.asarray(arrays["means"], dtype=np.float64)
        self.variances = np.asarray(arrays["variances"], dtype=np.float64)
        self._reset_cache()

    def describe(self) -> str:
        stay = ", ".join(f"{value:.3f}" for value in np.diag(self.transition))
        expected = ", ".join(f"{1.0 / max(1.0 - value, 1e-9):.1f}" for value in np.diag(self.transition))
        return (f"hidden Markov model: {self.state_count} states on {self.projection.components.shape[0] or 'all'} "
                f"principal components; stay probabilities {stay} (expected bars per visit {expected}); read through "
                "the forward filter only")


__all__ = ["HiddenMarkovStates"]
