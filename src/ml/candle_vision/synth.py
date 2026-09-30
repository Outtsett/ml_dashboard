"""Synthetic windows for patterns the real bars show too rarely, each one verified by TA-Lib.

For a class (pattern, direction) short of its quota in a split:
  1. take the dashboard's textbook drawing of it (``candlePatternTemplates.json``: context bars + the
     1-5 pattern bars);
  2. put the pattern bars after a real context — the first 20 - m bars of a random real window from
     the SAME split (or, one time in four, the drawing's own context) — rescaled so the drawing's
     average range becomes the real context's, anchored at the context's last close, stretched by a
     random factor, every price jittered and snapped to the 0.25 tick;
  3. run all 61 TA-Lib functions on the window and keep it only if the target fires on its last bar.
     Its label vector is TA-Lib's full verdict, so a synthetic sample is labelled exactly as a real one.

TA-Lib decides a bar from its last 15 bars, so candidates are laid end to end in one series and each is
read at its own last bar: one call per function for thousands of candidates.
"""

from __future__ import annotations

import numpy as np

from .data import Samples
from .labels import class_list, load_templates, talib_values, to_classes
from .render import WINDOW_BARS

TICK = 0.25


def _snap(x: np.ndarray) -> np.ndarray:
    return np.round(x / TICK) * TICK


def _mean_range(bars: np.ndarray) -> np.ndarray:
    return (bars[..., 1] - bars[..., 2]).mean(-1)


def candidates(template: dict, contexts: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """(B, W, 4) candidate windows: a real or drawn context followed by a jittered pattern."""
    w = WINDOW_BARS
    pattern = np.asarray(template["pattern_bars"], dtype=np.float64)
    drawn_context = np.asarray(template["context"], dtype=np.float64)
    m = len(pattern)
    batch = len(contexts)
    context = contexts[:, : w - m].copy()
    use_drawing = rng.random(batch) < 0.25
    if use_drawing.any():
        # the drawing's own context, placed at the real context's level and scale
        drawn = drawn_context[-(w - m):]
        if len(drawn) < w - m:
            drawn = np.concatenate([np.repeat(drawn[:1], w - m - len(drawn), 0), drawn])
        real_scale = np.maximum(_mean_range(context[use_drawing, -10:]), TICK)[:, None, None]
        drawn_scale = max(_mean_range(drawn[-10:]), 1e-9)
        placed = context[use_drawing, -1:, 3][:, :, None] + (drawn[None] - drawn[-1, 3]) * real_scale / drawn_scale
        context[use_drawing] = _snap(placed)
    template_scale = max(_mean_range(drawn_context[-10:]), 1e-9)
    real_scale = np.maximum(_mean_range(context[:, -10:]), TICK)
    stretch = rng.uniform(0.6, 1.6, batch)
    anchor = context[:, -1, 3]
    bars = anchor[:, None, None] + (pattern[None] - drawn_context[-1, 3]) * (real_scale * stretch / template_scale)[:, None, None]
    noise = rng.normal(0.0, 1.0, bars.shape) * (rng.uniform(0.0, 0.12, batch) * real_scale)[:, None, None]
    bars = _snap(bars + noise)
    bars[..., 1] = np.maximum(bars[..., 1], bars[..., [0, 3]].max(-1))
    bars[..., 2] = np.minimum(bars[..., 2], bars[..., [0, 3]].min(-1))
    return np.concatenate([context, bars], 1)


def verdicts(windows: np.ndarray) -> np.ndarray:
    """(B, K) class labels of each window's last bar, from one TA-Lib pass over the windows end to end."""
    series = windows.reshape(-1, 4)
    values = talib_values(series[:, 0], series[:, 1], series[:, 2], series[:, 3])
    return to_classes(values[WINDOW_BARS - 1 :: WINDOW_BARS])


def generate(real: Samples, quotas: dict[tuple[int, int], int], seed: int = 0, batch: int = 4096,
             max_rounds: int = 60, log=print) -> tuple[Samples, list[dict]]:
    """Top up every (split, class) to its quota. ``quotas[(split, class)]`` = synthetic windows wanted."""
    rng = np.random.default_rng(seed)
    classes = class_list()
    templates = {f"{t['pattern']}:{t['direction']}": t for t in load_templates()["templates"]}
    parts: list[tuple[np.ndarray, np.ndarray, int]] = []
    report = []
    for (split, k), wanted in sorted(quotas.items()):
        if wanted <= 0:
            continue
        name = classes[k][0]
        pool = np.flatnonzero(real.split == split)
        kept_windows, kept_labels, tried = [], [], 0
        have = 0
        for _ in range(max_rounds):
            contexts = real.windows[rng.choice(pool, batch)]
            windows = candidates(templates[name], contexts, rng)
            labels = verdicts(windows)
            hit = labels[:, k] == 1
            tried += batch
            kept_windows.append(windows[hit]); kept_labels.append(labels[hit])
            have += int(hit.sum())
            if have >= wanted:
                break
        windows = np.concatenate(kept_windows)[:wanted]
        labels = np.concatenate(kept_labels)[:wanted]
        parts.append((windows, labels, split))
        report.append({"split_index": split, "class_name": name, "wanted": wanted, "made": len(windows),
                       "candidates_tried": tried, "acceptance_percent": have / tried * 100 if tried else float("nan")})
        log(f"synthetic {name} split {split}: {len(windows)}/{wanted} ({have / max(tried, 1) * 100:.1f}% of {tried} accepted)")
    if not parts:
        empty = Samples(np.zeros((0, WINDOW_BARS, 4)), np.zeros((0, len(classes)), np.uint8), np.zeros(0, np.int8),
                        np.zeros(0, bool), np.zeros(0, "datetime64[ns]"))
        return empty, report
    windows = np.concatenate([p[0] for p in parts])
    return Samples(
        windows=windows,
        labels=np.concatenate([p[1] for p in parts]),
        split=np.concatenate([np.full(len(p[0]), p[2], np.int8) for p in parts]),
        synthetic=np.ones(len(windows), dtype=bool),
        end_timestamp=np.full(len(windows), np.datetime64("NaT"), "datetime64[ns]"),
    ), report
