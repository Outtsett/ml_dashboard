"""
Walk-forward fold iterator for time-series ML models.

Yields rolling (or expanding) train/test fold pairs over a sorted timestamp
array, with optional purge (trim end of train) and embargo (trim start of
test) gaps to prevent label-horizon leakage between train and test sets.

Calendar-aware: month boundaries are honored via numpy.datetime64[M] arithmetic
(handles uneven month lengths — Feb has 28/29 days, Jan/Mar have 31, etc.).

Public API (``iter_day_folds`` is the calendar-day variant the Model Cycle uses):

    from core.shared.walk_forward import iter_folds, iter_day_folds, Fold

    for fold in iter_folds(
        timestamps=ts,         # int64 epoch seconds, sorted ascending
        train_months=12,
        test_months=3,
        step_months=3,
        purge_bars=5,
        embargo_bars=5,
        expanding=False,
    ):
        X_tr, y_tr = X[fold.train_idx], y[fold.train_idx]
        X_te, y_te = X[fold.test_idx],  y[fold.test_idx]
        ...

Consumed by every generated `main.py` produced by `scripts/generate_model.py`
in W2+. Standardized fold boundaries (train_start/end, test_start/end as
numpy.datetime64[s]) so the dashboard ExperimentLedger can render fold ranges
without re-deriving them from the raw timestamp array.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import numpy as np


@dataclass(frozen=True)
class Fold:
    """One walk-forward fold.

    Attributes:
      idx          : 0-based fold index
      train_start  : timestamp of first training row (datetime64[s])
      train_end    : timestamp of last training row (datetime64[s], inclusive)
      test_start   : timestamp of first test row (datetime64[s])
      test_end     : timestamp of last test row (datetime64[s], inclusive)
      train_idx    : int64 indices into the original timestamp array
      test_idx     : int64 indices into the original timestamp array
    """

    idx: int
    train_start: np.datetime64
    train_end: np.datetime64
    test_start: np.datetime64
    test_end: np.datetime64
    train_idx: np.ndarray
    test_idx: np.ndarray


def _to_datetime64_s(timestamps: np.ndarray) -> np.ndarray:
    """Coerce input to numpy datetime64[s] array.

    Accepts:
      - int64 epoch seconds (the documented contract)
      - any datetime64[*] subtype (cast to seconds)
      - object array of python datetimes (best-effort coercion)
    """
    arr = np.asarray(timestamps)
    if np.issubdtype(arr.dtype, np.datetime64):
        return arr.astype("datetime64[s]")
    if np.issubdtype(arr.dtype, np.integer):
        return arr.astype("int64").view("datetime64[s]")
    # Best-effort: let numpy try
    return arr.astype("datetime64[s]")


def iter_folds(
    timestamps: np.ndarray,
    train_months: int,
    test_months: int,
    step_months: int,
    purge_bars: int = 0,
    embargo_bars: int = 0,
    *,
    expanding: bool = False,
) -> Iterator[Fold]:
    """Yield one Fold per walk-forward split.

    Args:
      timestamps   : int64 epoch seconds, sorted ascending. Each row in the
                     feature matrix corresponds to one entry here.
      train_months : training window size in calendar months
      test_months  : test window size in calendar months
      step_months  : how many months to advance the test window per fold
                     (must be > 0; usually equals test_months for non-overlap)
      purge_bars   : trim this many bars off the END of each fold's train_idx
                     to prevent label-horizon leakage into the test set
      embargo_bars : trim this many bars off the START of each fold's test_idx
                     to give the model a settling period

    Keyword-only:
      expanding    : if True, training window grows from data start each fold
                     (anchored origin); if False (default), training window
                     slides forward with the test window (rolling origin).

    Yields:
      Fold instances in chronological order. If the data is shorter than
      train_months + test_months, no folds are yielded (and no error raised).
    """
    if train_months < 1:
        raise ValueError(f"train_months must be >= 1, got {train_months}")
    if test_months < 1:
        raise ValueError(f"test_months must be >= 1, got {test_months}")
    if step_months < 1:
        raise ValueError(f"step_months must be >= 1, got {step_months}")
    if purge_bars < 0:
        raise ValueError(f"purge_bars must be >= 0, got {purge_bars}")
    if embargo_bars < 0:
        raise ValueError(f"embargo_bars must be >= 0, got {embargo_bars}")

    ts = _to_datetime64_s(timestamps)
    n = ts.shape[0]
    if n == 0:
        return

    # Sanity: confirm sorted ascending. Avoid full sort to keep cost O(n).
    # (Minor cost — single pass — and catches contract violations early.)
    if n > 1:
        # np.diff on datetime64 returns timedelta64 — compare to zero td.
        zero_td = np.timedelta64(0, "s")
        if not (np.diff(ts) >= zero_td).all():
            raise ValueError("timestamps must be sorted ascending")

    data_start_m = ts[0].astype("datetime64[M]")
    data_end_m = ts[-1].astype("datetime64[M]")
    total_months = int((data_end_m - data_start_m).astype("int64")) + 1
    if total_months < train_months + test_months:
        return

    one_month = np.timedelta64(1, "M")

    fold_idx = 0
    # Test-window starts at offset = train_months from anchor; advance by step_months.
    for test_offset_months in range(train_months, total_months - test_months + 1, step_months):
        if expanding:
            train_start_m = data_start_m
        else:
            train_start_m = data_start_m + (test_offset_months - train_months) * one_month
        train_end_m_exclusive = data_start_m + test_offset_months * one_month
        test_start_m = train_end_m_exclusive
        test_end_m_exclusive = test_start_m + test_months * one_month

        # Convert month boundaries to second-resolution for searchsorted on ts.
        train_start_s = train_start_m.astype("datetime64[s]")
        train_end_s = train_end_m_exclusive.astype("datetime64[s]")
        test_start_s = test_start_m.astype("datetime64[s]")
        test_end_s = test_end_m_exclusive.astype("datetime64[s]")

        # half-open intervals: [start, end)
        tr_lo = int(np.searchsorted(ts, train_start_s, side="left"))
        tr_hi = int(np.searchsorted(ts, train_end_s, side="left"))
        te_lo = int(np.searchsorted(ts, test_start_s, side="left"))
        te_hi = int(np.searchsorted(ts, test_end_s, side="left"))

        # Apply purge to end of train, embargo to start of test.
        tr_hi_purged = max(tr_lo, tr_hi - purge_bars)
        te_lo_emb = min(te_hi, te_lo + embargo_bars)

        if tr_hi_purged <= tr_lo or te_hi <= te_lo_emb:
            # No samples remain in train or test after trimming — skip fold.
            continue

        train_idx = np.arange(tr_lo, tr_hi_purged, dtype=np.int64)
        test_idx = np.arange(te_lo_emb, te_hi, dtype=np.int64)

        yield Fold(
            idx=fold_idx,
            train_start=ts[train_idx[0]],
            train_end=ts[train_idx[-1]],
            test_start=ts[test_idx[0]],
            test_end=ts[test_idx[-1]],
            train_idx=train_idx,
            test_idx=test_idx,
        )
        fold_idx += 1


def iter_day_folds(
    timestamps: np.ndarray,
    train_days: int,
    test_days: int,
    step_days: int,
    purge_bars: int = 0,
    embargo_bars: int = 0,
    *,
    expanding: bool = False,
) -> Iterator[Fold]:
    """Calendar-DAY walk-forward folds — the Model Cycle's iterator.

    Same `Fold` dataclass and the same conventions as :func:`iter_folds`, with
    windows measured in whole UTC calendar days instead of months:

      - day boundaries are ``datetime64[D]`` of the epoch-second timestamps
        (UTC midnight), windows are half-open ``[start, end)``;
      - the first test window starts ``train_days`` after the first data day,
        later ones advance by ``step_days``;
      - a window is only yielded when its whole test span lies inside the data
        (the last fold's test window ends on or before the last data day + 1);
      - ``purge_bars`` trims the END of the training rows, ``embargo_bars``
        trims the START of the test rows; a fold left empty by either is skipped;
      - ``expanding=True`` anchors every training window at the first data day.

    ``step_days`` smaller than ``test_days`` would test a bar twice and is an
    error here, not a silent overlap.
    """
    if train_days < 1:
        raise ValueError(f"train_days must be >= 1, got {train_days}")
    if test_days < 1:
        raise ValueError(f"test_days must be >= 1, got {test_days}")
    if step_days < test_days:
        raise ValueError(
            f"step_days ({step_days}) must be >= test_days ({test_days}); "
            "a smaller step would test the same bar in two folds"
        )
    if purge_bars < 0:
        raise ValueError(f"purge_bars must be >= 0, got {purge_bars}")
    if embargo_bars < 0:
        raise ValueError(f"embargo_bars must be >= 0, got {embargo_bars}")

    ts = _to_datetime64_s(timestamps)
    n = ts.shape[0]
    if n == 0:
        return
    if n > 1 and not (np.diff(ts) >= np.timedelta64(0, "s")).all():
        raise ValueError("timestamps must be sorted ascending")

    first_day = ts[0].astype("datetime64[D]")
    last_day = ts[-1].astype("datetime64[D]")
    total_days = int((last_day - first_day).astype("int64")) + 1
    one_day = np.timedelta64(1, "D")

    fold_idx = 0
    for test_offset_days in range(train_days, total_days - test_days + 1, step_days):
        test_start_d = first_day + test_offset_days * one_day
        test_end_d = test_start_d + test_days * one_day
        train_start_d = first_day if expanding else test_start_d - train_days * one_day

        tr_lo = int(np.searchsorted(ts, train_start_d.astype("datetime64[s]"), side="left"))
        tr_hi = int(np.searchsorted(ts, test_start_d.astype("datetime64[s]"), side="left"))
        te_lo = tr_hi
        te_hi = int(np.searchsorted(ts, test_end_d.astype("datetime64[s]"), side="left"))

        tr_hi_purged = max(tr_lo, tr_hi - purge_bars)
        te_lo_emb = min(te_hi, te_lo + embargo_bars)
        if tr_hi_purged <= tr_lo or te_hi <= te_lo_emb:
            continue

        train_idx = np.arange(tr_lo, tr_hi_purged, dtype=np.int64)
        test_idx = np.arange(te_lo_emb, te_hi, dtype=np.int64)
        yield Fold(
            idx=fold_idx,
            train_start=ts[train_idx[0]],
            train_end=ts[train_idx[-1]],
            test_start=ts[test_idx[0]],
            test_end=ts[test_idx[-1]],
            train_idx=train_idx,
            test_idx=test_idx,
        )
        fold_idx += 1


__all__ = ["Fold", "iter_folds", "iter_day_folds"]
