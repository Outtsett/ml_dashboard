"""Walk-forward fold generation for time-series cross-validation.

Expanding window: train always starts at bar 0, grows each fold.
Purge gap between train and test prevents label leakage.
"""
from __future__ import annotations

from datetime import datetime


def generate_folds(
    n_bars: int,
    timestamps: list[str],
    fold_months: int = 6,
    purge_bars: int = 120,
) -> list[dict]:
    """Generate expanding-window walk-forward folds."""
    def parse_ts(ts: str) -> datetime:
        for fmt in (
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(ts, fmt)
            except ValueError:
                continue
        raise ValueError(f"Cannot parse timestamp: {ts}")

    first_dt = parse_ts(timestamps[0])

    folds = []
    fold_num = 0
    min_train_months = 24

    current_month = first_dt.month + min_train_months
    current_year = first_dt.year + (current_month - 1) // 12
    current_month = (current_month - 1) % 12 + 1

    last_dt = parse_ts(timestamps[-1])

    while True:
        test_start_dt = datetime(current_year, current_month, 1)
        end_month = current_month + fold_months
        end_year = current_year + (end_month - 1) // 12
        end_month = (end_month - 1) % 12 + 1
        test_end_dt = datetime(end_year, end_month, 1)

        if test_end_dt > last_dt:
            break

        test_start_idx = _find_bar_at_or_after(timestamps, test_start_dt)
        test_end_idx = _find_bar_at_or_before(timestamps, test_end_dt)

        if test_start_idx is None or test_end_idx is None:
            break
        if test_start_idx >= test_end_idx:
            break

        train_end_idx = test_start_idx - purge_bars - 1
        if train_end_idx < 0:
            break

        fold_num += 1
        folds.append({
            "fold_number": fold_num,
            "train_start": 0,
            "train_end": train_end_idx,
            "purge_bars": purge_bars,
            "test_start": test_start_idx,
            "test_end": test_end_idx,
        })

        current_month += fold_months
        current_year += (current_month - 1) // 12
        current_month = (current_month - 1) % 12 + 1

    return folds


def _find_bar_at_or_after(timestamps: list[str], target: datetime) -> int | None:
    target_str = target.strftime("%Y-%m-%d")
    lo, hi = 0, len(timestamps) - 1
    result = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if timestamps[mid][:10] >= target_str:
            result = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return result


def _find_bar_at_or_before(timestamps: list[str], target: datetime) -> int | None:
    target_str = target.strftime("%Y-%m-%d")
    lo, hi = 0, len(timestamps) - 1
    result = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if timestamps[mid][:10] <= target_str:
            result = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return result
