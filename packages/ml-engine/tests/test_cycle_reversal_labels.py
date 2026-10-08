"""The reversal label: 1 when the next ``horizon`` bars turn against the previous
``horizon`` bars, 0 when they continue; unlabelled inside the threshold, before
the first ``horizon`` bars, past the data and across session gaps."""
import numpy as np
from cycle.labels import make_reversal_labels, trailing_direction


def test_turns_are_one_continuations_zero_and_the_edges_are_unlabelled():
    # horizon 2: closes rise 0..4, fall 4..8, rise 8..12
    close = np.array([0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4], dtype=float)
    labels = make_reversal_labels(close, horizon=2, threshold_ticks=0.0, tick_size=0.25)
    assert np.isnan(labels[:2]).all()            # no trailing move yet
    assert np.isnan(labels[-2:]).all()           # no forward move yet
    # bar 2: trailing 0->2 up, forward 2->4 up: continuation
    assert labels[2] == 0.0
    # bar 4: trailing 2->4 up, forward 4->2 down: a turn
    assert labels[4] == 1.0
    # bar 6: trailing 4->2 down, forward 2->0 down: continuation
    assert labels[6] == 0.0
    # bar 8: trailing 2->0 down, forward 0->2 up: a turn
    assert labels[8] == 1.0


def test_moves_inside_the_threshold_are_unlabelled_and_gaps_are_respected():
    close = np.array([10.0, 10.1, 10.2, 10.3, 10.2, 10.1, 10.0, 9.9, 9.8], dtype=float)
    labels = make_reversal_labels(close, horizon=2, threshold_ticks=1.0, tick_size=0.25)  # threshold 0.25 points
    # bar 2: trailing +0.2 (inside), unlabelled; bar 3: trailing +0.2 inside too
    assert np.isnan(labels[2]) and np.isnan(labels[3])
    # bar 4: trailing 10.2-10.2 = 0 inside; bar 5: trailing 10.1-10.3 = -0.2 inside
    assert np.isnan(labels[4]) and np.isnan(labels[5])
    crosses = np.zeros(close.shape[0], dtype=bool)
    crosses[2] = True
    wide = np.array([10, 11, 12, 13, 12, 11, 10, 9, 8], dtype=float)
    labelled = make_reversal_labels(wide, horizon=2, threshold_ticks=0.0, tick_size=0.25, crosses_gap=crosses)
    # bar 3: trailing 11->13 up, forward 13->11 down: a turn; bar 2 is the gap-crossing bar
    assert np.isnan(labelled[2]) and labelled[3] == 1.0


def test_trailing_direction_is_the_sign_of_the_previous_horizon_move():
    close = np.array([5.0, 6.0, 7.0, 6.5, 6.0], dtype=float)
    assert trailing_direction(close, 0, 2, 0.0, 0.25) == 0
    assert trailing_direction(close, 2, 2, 0.0, 0.25) == 1
    assert trailing_direction(close, 4, 2, 0.0, 0.25) == -1
    assert trailing_direction(close, 4, 2, 10.0, 0.25) == 0   # inside a 2.5-point threshold


def test_the_label_is_causal_at_the_bar_it_is_made_for():
    rng = np.random.default_rng(3)
    close = np.cumsum(rng.normal(size=400)) + 100
    full = make_reversal_labels(close, 5, 0.0, 0.25)
    cut = make_reversal_labels(close[:300], 5, 0.0, 0.25)
    # every label the cut series can make agrees with the full series
    known = ~np.isnan(cut)
    assert np.array_equal(cut[known], full[:300][known])
