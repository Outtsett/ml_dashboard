"""Augmentations of a standardised feature row.

A bar's feature row is tabular (z-scored indicators, flows, calendar channels),
so the image augmentations the papers use (crops, flips, RandAugment) have no
meaning here. The consistency methods perturb the row instead:

- ``gaussian_noise``: x + standard_deviation * N(0, I), the weak view;
- ``strong_view``: FixMatch's strong view: larger noise, a random fraction of
  features masked to 0 (the training mean after standardisation) and a random
  per-row scale in [1 - STRONG_SCALE_RANGE, 1 + STRONG_SCALE_RANGE];
- ``sharpen``: MixMatch's temperature sharpening of a binary probability;
- ``mixup``: the convex combination of two batches with lambda' = max(lambda, 1 - lambda).

Every function draws from torch's current random state, which the trainer
seeds per fit (and isolates for the unsupervised term), so a fit is reproducible.
"""

from __future__ import annotations

import torch

STRONG_SCALE_RANGE = 0.25
PROBABILITY_FLOOR = 1e-6


def gaussian_noise(x: torch.Tensor, standard_deviation: float) -> torch.Tensor:
    if standard_deviation <= 0:
        return x
    return x + float(standard_deviation) * torch.randn_like(x)


def strong_view(x: torch.Tensor, standard_deviation: float, mask_fraction: float) -> torch.Tensor:
    """Noise, then masking of each feature with probability ``mask_fraction``, then a per-row scale."""
    noisy = gaussian_noise(x, standard_deviation)
    if mask_fraction > 0:
        keep = (torch.rand_like(x) >= float(mask_fraction)).to(x.dtype)
        noisy = noisy * keep
    scale = 1.0 + STRONG_SCALE_RANGE * (2.0 * torch.rand(x.shape[0], 1, dtype=x.dtype, device=x.device) - 1.0)
    return noisy * scale


def sharpen(probability: torch.Tensor, temperature: float) -> torch.Tensor:
    """p^(1/T) / (p^(1/T) + (1 - p)^(1/T)) for a binary probability p (MixMatch)."""
    p = probability.clamp(PROBABILITY_FLOOR, 1.0 - PROBABILITY_FLOOR)
    power = 1.0 / max(float(temperature), 1e-3)
    up = p.pow(power)
    down = (1.0 - p).pow(power)
    return up / (up + down)


def mixing_weight(concentration: float) -> float:
    """lambda ~ Beta(a, a), returned as max(lambda, 1 - lambda) so the mixed row stays nearer its own."""
    if concentration <= 0:
        return 1.0
    beta = torch.distributions.Beta(torch.tensor(float(concentration)), torch.tensor(float(concentration)))
    value = float(beta.sample())
    return max(value, 1.0 - value)


def mixup(first: torch.Tensor, second: torch.Tensor, weight: float) -> torch.Tensor:
    return weight * first + (1.0 - weight) * second


__all__ = ["PROBABILITY_FLOOR", "STRONG_SCALE_RANGE", "gaussian_noise", "mixing_weight", "mixup", "sharpen",
           "strong_view"]
