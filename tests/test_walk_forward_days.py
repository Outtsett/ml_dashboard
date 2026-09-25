"""iter_day_folds — the calendar-day walk-forward iterator the Model Cycle uses
(src/ml/shared/walk_forward.py).

Every expected index below is worked out by hand from the synthetic timestamp
grid, not recomputed with the function under test.
"""

from __future__ import annotations

import numpy as np
import pytest

from shared.walk_forward import Fold, iter_day_folds

DAY = 86_400
HOUR = 3_600
# Monday 2026-01-05 00:00:00 UTC
MONDAY = int(np.datetime64("2026-01-05T00:00:00", "s").astype(np.int64))


def hourly(day_count: int, start: int = MONDAY) -> np.ndarray:
    """24 bars a day, on the hour, for ``day_count`` calendar days."""
    return (start + HOUR * np.arange(24 * day_count)).astype(np.int64)


def folds_of(timestamps, *args, **kwargs) -> list[Fold]:
    return list(iter_day_folds(timestamps, *args, **kwargs))


# ─── window geometry ───────────────────────────────────────────────────────


def test_rolling_windows_are_whole_calendar_days_half_open():
    ts = hourly(10)  # rows 24*d .. 24*d + 23 are day d
    folds = folds_of(ts, 3, 2, 2)
    # test windows start on days 3, 5, 7 (range(3, 10 - 2 + 1, 2)); day 9 has no
    # room for a two-day test window, so there is no fourth fold
    assert [f.idx for f in folds] == [0, 1, 2]
    for fold, test_day in zip(folds, (3, 5, 7)):
        assert fold.test_idx.tolist() == list(range(24 * test_day, 24 * (test_day + 2)))
        assert fold.train_idx.tolist() == list(range(24 * (test_day - 3), 24 * test_day))
        # half-open: the last training bar is 23:00 the day before the test starts,
        # the last test bar is 23:00 on the test window's last day
        assert int(fold.train_end.astype(np.int64)) == MONDAY + DAY * test_day - HOUR
        assert int(fold.test_start.astype(np.int64)) == MONDAY + DAY * test_day
        assert int(fold.test_end.astype(np.int64)) == MONDAY + DAY * (test_day + 2) - HOUR


def test_a_bar_exactly_at_midnight_belongs_to_the_day_it_opens():
    # a bar every 12 hours: 00:00 and 12:00
    ts = (MONDAY + 12 * HOUR * np.arange(2 * 6)).astype(np.int64)
    (fold, *_rest) = folds_of(ts, 2, 1, 1)
    # day 2 starts at row 4 (00:00 of day 2) — it is the first test bar, never a training bar
    assert fold.test_idx.tolist() == [4, 5]
    assert fold.train_idx.tolist() == [0, 1, 2, 3]


def test_day_boundaries_are_utc_midnight_even_when_bars_start_mid_day():
    start = MONDAY + 13 * HOUR + 30 * 60  # first bar 13:30 UTC
    ts = (start + 300 * np.arange(12 * 20)).astype(np.int64)  # 5-minute bars, 20 hours
    folds = folds_of(ts, 1, 1, 1)
    # the first data day is 2026-01-05 (the bars from 13:30 to 23:55: 126 of them);
    # the test window is 2026-01-06 00:00 .. 2026-01-07 00:00
    first_test_row = int(np.searchsorted(ts, MONDAY + DAY))
    assert first_test_row == 126
    assert folds[0].train_idx.tolist() == list(range(0, 126))
    assert folds[0].test_idx[0] == 126
    assert all(ts[folds[0].test_idx] < MONDAY + 2 * DAY)


def test_a_test_window_must_fit_inside_the_data():
    ts = hourly(7)
    # 3-day test windows after 2 training days, step 3: a window starting on day 5
    # would need days 5..7 and the data ends on day 6, so only day 2 starts one
    folds = folds_of(ts, 2, 3, 3)
    assert len(folds) == 1
    assert folds[0].test_idx[-1] == 24 * 5 - 1
    assert folds_of(hourly(4), 3, 2, 2) == []


# ─── purge and embargo ─────────────────────────────────────────────────────


def test_purge_trims_the_end_of_training_and_embargo_the_start_of_test():
    ts = hourly(10)
    plain = folds_of(ts, 3, 2, 2)
    trimmed = folds_of(ts, 3, 2, 2, purge_bars=5, embargo_bars=7)
    assert len(plain) == len(trimmed) == 3
    for a, b in zip(plain, trimmed):
        assert b.train_idx.tolist() == a.train_idx[:-5].tolist()
        assert b.test_idx.tolist() == a.test_idx[7:].tolist()
        # the purge leaves exactly 5 unused rows between the last training row and
        # the (un-embargoed) test start; the embargo adds 7 more before the first test row
        assert a.test_idx[0] - b.train_idx[-1] - 1 == 5
        assert b.test_idx[0] - b.train_idx[-1] - 1 == 5 + 7


def test_a_fold_emptied_by_purge_or_embargo_is_skipped_and_the_rest_renumbered():
    ts = hourly(10)
    # 48 test bars per window: an embargo of 48 empties every test window
    assert folds_of(ts, 3, 2, 2, embargo_bars=48) == []
    # an embargo of 47 leaves exactly one bar
    folds = folds_of(ts, 3, 2, 2, embargo_bars=47)
    assert [f.test_idx.size for f in folds] == [1, 1, 1]
    # no bars on days 5 and 6 (a gap): the fold testing those days is skipped
    gap = ts[(ts < MONDAY + 5 * DAY) | (ts >= MONDAY + 7 * DAY)]
    folds = folds_of(gap, 3, 2, 2)
    assert [int(f.test_start.astype(np.int64)) for f in folds] == [MONDAY + 3 * DAY, MONDAY + 7 * DAY]
    assert [f.idx for f in folds] == [0, 1]
    # a purge longer than the training window empties training
    assert folds_of(ts, 1, 1, 1, purge_bars=24) == []


# ─── expanding vs rolling, step ────────────────────────────────────────────


def test_expanding_anchors_training_at_the_first_day_rolling_slides():
    ts = hourly(12)
    rolling = folds_of(ts, 3, 2, 2)
    expanding = folds_of(ts, 3, 2, 2, expanding=True)
    assert [f.test_idx.tolist() for f in rolling] == [f.test_idx.tolist() for f in expanding]
    for position, (r, e) in enumerate(zip(rolling, expanding)):
        test_day = 3 + 2 * position
        assert e.train_idx[0] == 0
        assert e.train_idx.tolist() == list(range(0, 24 * test_day))
        assert r.train_idx[0] == 24 * (test_day - 3)
        assert r.train_idx.size == 24 * 3
    assert [f.train_idx.size for f in expanding] == [72, 120, 168, 216]


def test_step_must_be_at_least_the_test_window_and_a_larger_step_leaves_gaps():
    ts = hourly(20)
    with pytest.raises(ValueError, match="step_days"):
        folds_of(ts, 3, 2, 1)
    folds = folds_of(ts, 3, 2, 5)
    # test windows start on days 3, 8, 13, 18 (range(3, 20 - 2 + 1, 5)) and last 2 days
    assert [int(f.test_idx[0]) // 24 for f in folds] == [3, 8, 13, 18]
    assert all(f.test_idx.size == 48 for f in folds)
    for a, b in zip(folds, folds[1:]):
        assert b.test_idx[0] - a.test_idx[-1] - 1 == 24 * 3  # three untested days between windows


@pytest.mark.parametrize("expanding", [False, True])
@pytest.mark.parametrize(("purge", "embargo"), [(0, 0), (6, 0), (0, 4), (6, 4)])
def test_train_and_test_never_overlap_and_test_windows_never_repeat(expanding, purge, embargo):
    generator = np.random.default_rng(3)
    # irregular bars: random gaps of 1 minute to 5 hours over ~30 days
    ts = (MONDAY + np.cumsum(generator.integers(60, 5 * HOUR, 400))).astype(np.int64)
    folds = folds_of(ts, 5, 3, 3, purge_bars=purge, embargo_bars=embargo, expanding=expanding)
    assert len(folds) >= 5
    tested: set[int] = set()
    for fold in folds:
        train, test = set(fold.train_idx.tolist()), set(fold.test_idx.tolist())
        assert not train & test
        assert fold.train_idx[-1] < fold.test_idx[0]
        assert fold.test_idx[0] - fold.train_idx[-1] - 1 >= purge + embargo
        assert np.all(np.diff(fold.train_idx) == 1) and np.all(np.diff(fold.test_idx) == 1)
        assert not tested & test
        tested |= test
        assert int(fold.train_start.astype(np.int64)) == ts[fold.train_idx[0]]
        assert int(fold.test_end.astype(np.int64)) == ts[fold.test_idx[-1]]


# ─── input contract ────────────────────────────────────────────────────────


def test_bad_arguments_and_unsorted_timestamps_raise():
    ts = hourly(10)
    for kwargs, match in (
        ({"train_days": 0, "test_days": 1, "step_days": 1}, "train_days"),
        ({"train_days": 1, "test_days": 0, "step_days": 1}, "test_days"),
        ({"train_days": 1, "test_days": 1, "step_days": 1, "purge_bars": -1}, "purge_bars"),
        ({"train_days": 1, "test_days": 1, "step_days": 1, "embargo_bars": -1}, "embargo_bars"),
    ):
        with pytest.raises(ValueError, match=match):
            list(iter_day_folds(ts, **kwargs))
    with pytest.raises(ValueError, match="sorted"):
        folds_of(ts[::-1].copy(), 1, 1, 1)
    assert folds_of(np.array([], dtype=np.int64), 1, 1, 1) == []


def test_datetime64_input_gives_the_same_folds_as_epoch_seconds():
    ts = hourly(9)
    as_datetime = ts.astype("datetime64[s]")
    a = folds_of(ts, 2, 2, 3, purge_bars=2)
    b = folds_of(as_datetime, 2, 2, 3, purge_bars=2)
    assert [(f.train_idx.tolist(), f.test_idx.tolist()) for f in a] == [
        (f.train_idx.tolist(), f.test_idx.tolist()) for f in b
    ]
