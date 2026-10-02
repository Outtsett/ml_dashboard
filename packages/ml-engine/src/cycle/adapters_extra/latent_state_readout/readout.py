"""The readout: what history did after each state, from training rows only.

For states k with responsibilities r_ik (one-hot for a hard assignment, a
posterior for a soft one) over the training rows i with a known target y_i:

    value_k = (sum_i r_ik * y_i + prior_strength * prior) / (sum_i r_ik + prior_strength)

- direction (``task`` classification): y_i is the up label (1 / 0) and the
  prior is the training up-rate, so value_k is the Beta-smoothed up-rate of
  state k (a Beta(prior_strength * base, prior_strength * (1 - base)) prior);
- price (``task`` regression): y_i is the scaled h-bar move and the prior the
  training mean move, so value_k is the shrunk mean move of state k.

A state no training row visits reads the prior. ``smoothing`` (an S x S
non-negative matrix) spreads the evidence between related states before the
division (the self-organising map shares it between neighbouring cells).

A bar's forecast is sum_k r_k(x) * value_k: P(up) for direction, the scaled
move for price. A row whose responsibilities are missing forecasts NaN.

Causality: ``fit`` receives only training rows' responsibilities and targets
(``LatentStateReadoutAdapter`` passes ``train_index`` and nothing else).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class StateReadout:
    values: np.ndarray          # (S,) up-rate or mean scaled move per state
    weights: np.ndarray         # (S,) the (smoothed) training mass behind each value
    prior: float

    @property
    def state_count(self) -> int:
        return int(self.values.size)

    @classmethod
    def fit(cls, responsibilities: np.ndarray, targets: np.ndarray, task: str, prior_strength: float,
            smoothing: np.ndarray | None = None) -> StateReadout:
        responsibilities = np.asarray(responsibilities, dtype=np.float64)
        targets = np.asarray(targets, dtype=np.float64).reshape(-1)
        if responsibilities.shape[0] != targets.size:
            raise ValueError(f"{responsibilities.shape[0]} responsibility rows for {targets.size} targets")
        keep = np.isfinite(targets) & np.all(np.isfinite(responsibilities), axis=1)
        responsibilities, targets = responsibilities[keep], targets[keep]
        if task == "classification":
            targets = (targets >= 0.5).astype(np.float64)
        prior = float(np.mean(targets)) if targets.size else (0.5 if task == "classification" else 0.0)
        mass = responsibilities.sum(axis=0)
        sums = responsibilities.T @ targets
        if smoothing is not None:
            mass = smoothing @ mass
            sums = smoothing @ sums
        strength = max(float(prior_strength), 0.0)
        denominator = mass + strength
        with np.errstate(invalid="ignore", divide="ignore"):
            values = np.where(denominator > 0, (sums + strength * prior) / np.where(denominator > 0, denominator, 1.0),
                              prior)
        return cls(values.astype(np.float64), mass.astype(np.float64), prior)

    def apply(self, responsibilities: np.ndarray) -> np.ndarray:
        responsibilities = np.asarray(responsibilities, dtype=np.float64)
        out = responsibilities @ self.values
        out[~np.all(np.isfinite(responsibilities), axis=1)] = np.nan
        return out

    def arrays(self) -> dict[str, np.ndarray]:
        return {"values": self.values, "weights": self.weights, "prior": np.asarray(self.prior)}

    @classmethod
    def from_arrays(cls, arrays: dict[str, np.ndarray]) -> StateReadout:
        return cls(np.asarray(arrays["values"], dtype=np.float64), np.asarray(arrays["weights"], dtype=np.float64),
                   float(arrays["prior"]))


__all__ = ["StateReadout"]
