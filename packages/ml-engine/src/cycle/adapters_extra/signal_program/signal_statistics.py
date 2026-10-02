"""Train-span statistics of the fold's causal feature signals.

Every program of the family reads the same summary of the training span. For
signal (feature column) j and training row t:

    y_t      the scaled forward move (``MarketView.price_targets``), clipped at
             the training span's 1st / 99th percentiles and divided by the
             clipped values' standard deviation (``target_scale``), so it is
             dimensionless and keeps its sign
    x_tj     the causal feature value the engine hands to ``fit``, divided by
             its standard deviation over the training rows (``signal_scale``),
             so a cap or a budget means the same for every signal; it is not
             re-centred, so a positive signal still means "long"
    p_tj     = x_tj * y_t, the profit stream of trading signal j alone
             (long when the signal is positive, short when negative)

    mu_j            mean of p_tj: the signal's information coefficient
                    (covariance form; about the correlation for a unit-scale signal)
    covariance      Ledoit-Wolf shrunk covariance of the profit streams (F x F):
                    the risk of a weighted book of signals
    correlation     Pearson correlation of the signals themselves (F x F)
    gram, cross     X'X / n and X'y / n: least squares on the signals
    pnl_deviation   standard deviation of each profit stream

Causality: only rows the caller passes are read (the adapter passes the
training rows whose price target is known: targets of training rows resolve
before validation starts, see ``cycle.market``). A column with no variation on
those rows is marked unusable and gets no weight from any program. Programs
return weights on the standardised signals; ``to_feature_weights`` turns them
into weights on the feature columns the model scores at predict time.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

MINIMUM_DEVIATION = 1e-12
CLIP_QUANTILES = (0.01, 0.99)


@dataclass
class SignalStatistics:
    names: tuple[str, ...]
    usable: np.ndarray                 # bool (F,)
    mu: np.ndarray                     # (F,)
    covariance: np.ndarray             # (F, F), zero rows and columns for unusable signals
    correlation: np.ndarray            # (F, F), identity on the diagonal
    pnl_deviation: np.ndarray          # (F,)
    gram: np.ndarray                   # (F, F) X'X / n
    cross: np.ndarray                  # (F,) X'y / n
    target_second_moment: float        # y'y / n
    row_count: int
    target_scale: float = 1.0          # standard deviation of the clipped target (target units)
    target_clip: tuple[float, float] = (-np.inf, np.inf)
    design: np.ndarray | None = None   # (n, F) the training signals (float64)
    target: np.ndarray | None = None   # (n,) the standardised target y
    labels: np.ndarray | None = None   # (n,) 1 up / 0 down, when the caller has them
    pnl: np.ndarray | None = None      # (n, F) the profit streams
    categories: tuple[str, ...] = field(default_factory=tuple)
    signal_scale: np.ndarray | None = None   # (F,) training deviation of each feature (None: not standardised)

    @property
    def signal_count(self) -> int:
        return len(self.names)

    def usable_columns(self) -> np.ndarray:
        return np.flatnonzero(self.usable).astype(np.int64)

    def scatter(self, values_on_usable) -> np.ndarray:
        """A full-length weight vector from values on the usable columns (zeros elsewhere)."""
        out = np.zeros(self.signal_count, dtype=np.float64)
        out[self.usable_columns()] = np.asarray(values_on_usable, dtype=np.float64)
        return out

    def to_feature_weights(self, weights) -> np.ndarray:
        """Weights on the standardised signals -> weights on the raw feature columns (w_j / scale_j)."""
        weights = np.asarray(weights, dtype=np.float64)
        if self.signal_scale is None:
            return weights.copy()
        scale = np.where(self.usable & (self.signal_scale > MINIMUM_DEVIATION), self.signal_scale, 1.0)
        return np.where(self.usable, weights / scale, 0.0)

    def normalised_risk(self) -> np.ndarray:
        """Each usable signal's profit-stream deviation over their mean (mean 1); 0 for unusable ones."""
        risk = np.zeros(self.signal_count, dtype=np.float64)
        columns = self.usable_columns()
        if columns.size:
            deviation = self.pnl_deviation[columns]
            mean = float(np.mean(deviation))
            risk[columns] = deviation / mean if mean > MINIMUM_DEVIATION else 1.0
        return risk

    @classmethod
    def from_arrays(cls, mu, covariance, correlation=None, names=None, *, gram=None, cross=None,
                    target_second_moment: float = 1.0, pnl_deviation=None, row_count: int = 0,
                    categories=None) -> SignalStatistics:
        """Statistics given directly (the unit tests' toy programs)."""
        mu = np.asarray(mu, dtype=np.float64)
        count = mu.size
        covariance = np.asarray(covariance, dtype=np.float64)
        names = tuple(names) if names is not None else tuple(f"signal_{index}" for index in range(count))
        correlation = np.eye(count) if correlation is None else np.asarray(correlation, dtype=np.float64)
        pnl_deviation = np.sqrt(np.clip(np.diag(covariance), 0.0, None)) if pnl_deviation is None \
            else np.asarray(pnl_deviation, dtype=np.float64)
        return cls(names=names, usable=np.ones(count, dtype=bool), mu=mu, covariance=covariance,
                   correlation=correlation, pnl_deviation=pnl_deviation,
                   gram=np.eye(count) if gram is None else np.asarray(gram, dtype=np.float64),
                   cross=mu.copy() if cross is None else np.asarray(cross, dtype=np.float64),
                   target_second_moment=float(target_second_moment), row_count=int(row_count),
                   categories=tuple(categories) if categories is not None else tuple("other" for _ in range(count)))

    @classmethod
    def from_rows(cls, features: np.ndarray, targets: np.ndarray, rows: np.ndarray, names,
                  labels: np.ndarray | None = None, categories=None) -> SignalStatistics:
        """The statistics of ``rows`` (training rows with a known target)."""
        from sklearn.covariance import LedoitWolf

        rows = np.asarray(rows, dtype=np.int64)
        design = np.asarray(features[rows], dtype=np.float64)
        raw_target = np.asarray(targets, dtype=np.float64)[rows]
        keep = np.all(np.isfinite(design), axis=1) & np.isfinite(raw_target)
        design, raw_target = design[keep], raw_target[keep]
        label_values = None if labels is None else np.asarray(labels, dtype=np.float64)[rows][keep]
        count, signal_count = design.shape
        names = tuple(str(name) for name in names) if names is not None and len(names) == signal_count \
            else tuple(f"signal_{index}" for index in range(signal_count))
        categories = tuple(categories) if categories is not None else tuple("other" for _ in range(signal_count))
        if count >= 2:
            low, high = (float(value) for value in np.quantile(raw_target, CLIP_QUANTILES))
        else:
            low, high = -np.inf, np.inf
        clipped = np.clip(raw_target, low, high)
        scale = float(np.std(clipped)) if count >= 2 else 0.0
        if not np.isfinite(scale) or scale <= MINIMUM_DEVIATION:
            scale = 1.0
        target = clipped / scale
        signal_deviation = design.std(axis=0) if count else np.zeros(signal_count)
        usable = signal_deviation > MINIMUM_DEVIATION if count >= 2 else np.zeros(signal_count, dtype=bool)
        signal_scale = np.where(usable, signal_deviation, 1.0)
        design = np.where(usable, design / signal_scale, 0.0)
        pnl = design * target[:, None]
        mu = pnl.mean(axis=0) if count else np.zeros(signal_count)
        mu = np.where(usable, mu, 0.0)
        covariance = np.zeros((signal_count, signal_count))
        correlation = np.eye(signal_count)
        columns = np.flatnonzero(usable)
        if columns.size:
            covariance[np.ix_(columns, columns)] = LedoitWolf().fit(pnl[:, columns]).covariance_
            if columns.size > 1:
                block = np.corrcoef(design[:, columns], rowvar=False)
                correlation[np.ix_(columns, columns)] = np.nan_to_num(block, nan=0.0)
            np.fill_diagonal(correlation, 1.0)
        pnl_deviation = np.where(usable, pnl.std(axis=0) if count else 0.0, 0.0)
        gram = design.T @ design / count if count else np.zeros((signal_count, signal_count))
        cross = design.T @ target / count if count else np.zeros(signal_count)
        second = float(target @ target / count) if count else 0.0
        return cls(names=names, usable=usable, mu=mu, covariance=covariance, correlation=correlation,
                   pnl_deviation=pnl_deviation, gram=gram, cross=np.where(usable, cross, 0.0),
                   target_second_moment=second, row_count=int(count), target_scale=scale,
                   target_clip=(low, high), design=design, target=target, labels=label_values, pnl=pnl,
                   categories=categories, signal_scale=signal_scale)


__all__ = ["SignalStatistics"]
