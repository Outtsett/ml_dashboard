"""Tolerant labels: a pattern still counts when the candles are a little off TA-Lib's exact rule.

TA-Lib's rules are all-or-nothing — a body 1 % longer than "short" is not short. Real candles never
repeat the textbook shape exactly, so each window is redrawn ``draws`` times with every open, high, low
and close nudged independently by up to ``tolerance`` x the window's average bar range (uniform), the
highs and lows widened to keep each candle valid, and TA-Lib run on every version.

  soft label        the share of the versions (the bars as they are, plus the nudged ones) on which
                    TA-Lib fires the class — 1 = the pattern survives any nudge, 0.1 = only one nudge
                    in ten makes it; the training target
  tolerant label    fires on the bars as they are OR on at least one nudged version; what "recognised
                    within tolerance" is scored against
  exact label       TA-Lib on the bars as they are

Windows are independent (one TA-Lib pass over them laid end to end, read at each window's last bar —
TA-Lib decides a bar from its last 15 bars), so the work splits across processes by chunk.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

from .synth import verdicts


def _chunk(windows: np.ndarray, tolerance: float, draws: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    total = verdicts(windows).astype(np.float32)
    scale = (windows[:, :, 1] - windows[:, :, 2]).mean(1)[:, None, None] * tolerance
    for _ in range(draws):
        nudged = windows + rng.uniform(-1.0, 1.0, windows.shape) * scale
        nudged[..., 1] = np.maximum(nudged[..., 1], nudged[..., [0, 3]].max(-1))
        nudged[..., 2] = np.minimum(nudged[..., 2], nudged[..., [0, 3]].min(-1))
        total += verdicts(nudged)
    return (total / (draws + 1)).astype(np.float16)


CACHE = Path(__file__).resolve().parents[3] / "data" / ".cache" / "candle_vision"


def soft_labels(windows: np.ndarray, tolerance: float, draws: int, seed: int = 0, chunk: int = 50_000,
                jobs: int = 12, log=print, cache: bool = True) -> np.ndarray:
    """(N, K) float16 soft labels for (N, W, 4) price windows.

    Cached under ``data/.cache/candle_vision/`` keyed by a hash of the exact windows and settings, so a
    run started without a console (pythonw, whose process-pool workers cannot start) reuses labels
    computed beforehand by ``main.py --prepare-only``."""
    if tolerance <= 0 or draws <= 0:
        return verdicts(windows).astype(np.float16)
    digest = hashlib.blake2b(np.ascontiguousarray(windows).tobytes(), digest_size=16)
    digest.update(f"{tolerance}|{draws}|{seed}|{chunk}".encode())
    path = CACHE / f"tolerance_{digest.hexdigest()}.npy"
    if cache and path.exists():
        log(f"tolerant labels: {len(windows):,} windows read from {path.name}")
        return np.load(path)
    from joblib import Parallel, delayed

    starts = list(range(0, len(windows), chunk))
    log(f"tolerant labels: {len(windows):,} windows x {draws + 1} versions, nudge up to {tolerance:.0%} of the average bar range")
    parts = Parallel(n_jobs=jobs)(delayed(_chunk)(windows[s:s + chunk], tolerance, draws, seed + k) for k, s in enumerate(starts))
    out = np.concatenate(parts)
    if cache:
        CACHE.mkdir(parents=True, exist_ok=True)
        np.save(path, out)
    return out
