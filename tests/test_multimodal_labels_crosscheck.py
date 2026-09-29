"""The bracket label against an independent implementation (`ta_strategy.bracket.simulate`, written
separately for the TA study): on random 1-minute paths, a single trade opened at the same minute with
the same stop and target must exit at the same minute, at the same price, for the same reason."""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("numba")

from multimodal.labels import _walk  # noqa: E402
from ta_strategy.bracket import EXIT_SESSION_END, EXIT_STOP, EXIT_TARGET, simulate  # noqa: E402

TICK = 0.25
REASON = {EXIT_STOP: 0, EXIT_TARGET: 1, EXIT_SESSION_END: 2}


@pytest.mark.parametrize("seed", range(20))
def test_same_exit_as_the_independent_simulator(seed):
    rng = np.random.default_rng(seed)
    n = 400
    close = 20000 + np.cumsum(np.round(rng.normal(0, 3, n) / TICK) * TICK)
    open_ = np.r_[close[0], close[:-1]] + np.round(rng.normal(0, 1, n) / TICK) * TICK
    high = np.maximum(open_, close) + np.round(rng.uniform(0, 3, n) / TICK) * TICK
    low = np.minimum(open_, close) - np.round(rng.uniform(0, 3, n) / TICK) * TICK
    session_last = np.zeros(n, bool)
    session_last[-1] = True
    roll_after = np.zeros(n, bool)
    for trial in range(10):
        t = int(rng.integers(5, n - 50))
        side = int(rng.choice([1, -1]))
        stop_ticks = int(rng.integers(8, 60))
        reward = float(rng.choice([2.0, 3.0]))
        stop_distance, target_distance = stop_ticks * TICK, reward * stop_ticks * TICK
        signal = np.zeros(n, np.int8)
        signal[t] = side
        stops = np.full(n, float(stop_ticks))
        e_i, x_i, sd, e_p, x_p, st, why, rc = simulate(open_, high, low, close, signal, stops, session_last, roll_after, TICK, reward, 0.0)
        assert len(e_i) == 1
        exit_index, exit_price, reason = _walk(open_, high, low, close, t + 1, n - 1, side, stop_distance, target_distance)
        assert int(e_i[0]) == t + 1
        assert int(x_i[0]) == int(exit_index), (seed, trial)
        assert float(x_p[0]) == pytest.approx(float(exit_price)), (seed, trial)
        assert REASON[int(why[0])] == int(reason), (seed, trial)
