"""Augmentations of a feature row or of a causal window, drawn from a seeded generator.

They define what an encoder learns to ignore, so they are the market analogue
of an image's crops and colour jitter:

    jitter          additive Gaussian noise on every cell
    scale           one multiplicative factor per (row, feature): a feature's level moves
    feature_dropout whole features zeroed for a row (the row loses a sensor)
    temporal_mask   whole bars of a window zeroed
    crop_resize     a random sub-window stretched back to the window's length by linear
                    interpolation; the sub-window lies inside the window, so no bar after
                    the embedded bar is ever read (the time-series crop of MoCo v3)
    row_views / window_views   the default composites

Every function takes ``generator`` (a ``torch.Generator`` on the batch's
device) and draws nothing else, so a pretext epoch is reproducible.
"""

from __future__ import annotations

import torch


def _normal(shape, like: torch.Tensor, generator: torch.Generator) -> torch.Tensor:
    return torch.randn(shape, generator=generator, device=like.device, dtype=like.dtype)


def _uniform(shape, like: torch.Tensor, generator: torch.Generator) -> torch.Tensor:
    return torch.rand(shape, generator=generator, device=like.device, dtype=like.dtype)


def jitter(inputs: torch.Tensor, strength: float, generator: torch.Generator) -> torch.Tensor:
    return inputs + float(strength) * _normal(inputs.shape, inputs, generator)


def _feature_shape(inputs: torch.Tensor) -> tuple[int, ...]:
    """One draw per (row, feature): (B, F) for rows, (B, 1, F) for windows."""
    return (inputs.shape[0], inputs.shape[-1]) if inputs.dim() == 2 else (inputs.shape[0], 1, inputs.shape[-1])


def scale(inputs: torch.Tensor, strength: float, generator: torch.Generator) -> torch.Tensor:
    return inputs * (1.0 + float(strength) * _normal(_feature_shape(inputs), inputs, generator))


def feature_dropout(inputs: torch.Tensor, rate: float, generator: torch.Generator) -> torch.Tensor:
    keep = (_uniform(_feature_shape(inputs), inputs, generator) >= float(rate)).to(inputs.dtype)
    return inputs * keep


def temporal_mask(window: torch.Tensor, rate: float, generator: torch.Generator) -> torch.Tensor:
    keep = (_uniform((window.shape[0], window.shape[1], 1), window, generator) >= float(rate)).to(window.dtype)
    return window * keep


def crop_resize(window: torch.Tensor, minimum_fraction: float, generator: torch.Generator) -> torch.Tensor:
    """A random contiguous sub-window of at least ``minimum_fraction`` of the
    bars, linearly resampled back to the full length."""
    batch, length, _ = window.shape
    if length < 2:
        return window
    fraction = float(minimum_fraction) + (1.0 - float(minimum_fraction)) * _uniform((batch, 1), window, generator)
    span = fraction * (length - 1)
    start = _uniform((batch, 1), window, generator) * ((length - 1) - span)
    grid = torch.linspace(0.0, 1.0, length, device=window.device, dtype=window.dtype).unsqueeze(0)
    position = start + span * grid                                   # (B, L), inside [0, L - 1]
    lower = position.floor().clamp(0, length - 1).long()
    upper = (lower + 1).clamp(max=length - 1)
    weight = (position - lower.to(window.dtype)).unsqueeze(-1)
    index_lower = lower.unsqueeze(-1).expand(-1, -1, window.shape[2])
    index_upper = upper.unsqueeze(-1).expand(-1, -1, window.shape[2])
    return (1.0 - weight) * window.gather(1, index_lower) + weight * window.gather(1, index_upper)


def row_views(rows: torch.Tensor, generator: torch.Generator, *, jitter_strength: float, scaling_strength: float,
              dropout_rate: float) -> torch.Tensor:
    """One augmented view of each feature row: scale, drop features, jitter."""
    view = scale(rows, scaling_strength, generator)
    view = feature_dropout(view, dropout_rate, generator)
    return jitter(view, jitter_strength, generator)


def window_views(window: torch.Tensor, generator: torch.Generator, *, jitter_strength: float,
                 scaling_strength: float, crop_fraction: float = 1.0) -> torch.Tensor:
    """One augmented view of each window: crop and resize (when crop_fraction < 1), scale, jitter."""
    view = crop_resize(window, crop_fraction, generator) if crop_fraction < 1.0 else window
    view = scale(view, scaling_strength, generator)
    return jitter(view, jitter_strength, generator)


__all__ = ["crop_resize", "feature_dropout", "jitter", "row_views", "scale", "temporal_mask", "window_views"]
