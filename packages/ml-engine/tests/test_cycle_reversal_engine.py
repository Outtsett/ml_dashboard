"""A reversal run speaks in P(up) everywhere outside the model.

The model is fitted on reversal labels and answers P(turn); the engine converts
that to P(up) at the bar (``CycleEngine.probability_up``), so the walk's signal,
the search's Sharpe objective, every probability metric and the baseline all use
one quantity. These tests pin that: the helper's arithmetic, the walk's calls,
the search's inputs and the "always the common direction" baseline.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1] / "src"
# the source roots go in front of the test tree, whose own `shared/` package would
# otherwise shadow `core/shared` (the engine's protocol module)
for _root in (ROOT / "core", ROOT):
    if str(_root) in sys.path:
        sys.path.remove(str(_root))
    sys.path.insert(0, str(_root))
# the test tree goes last: it is only needed for the sibling harness module below
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.append(str(Path(__file__).resolve().parent))

from cycle import tuning  # noqa: E402
from cycle.labels import trailing_direction  # noqa: E402
from cycle.models import build_adapter  # noqa: E402
from shared import (
    protocol,  # noqa: E402  (core/shared, bound before the test tree's shared/ can shadow it)
)
from test_cycle_extra_regime_montecarlo_decision import Capture, Market  # noqa: E402

KEY = "decision_tree_classifier"
HORIZON = 6
PARAMETERS = {"max_depth": 3, "min_samples_leaf": 20}


def _engine(tmp_path, label_kind: str):
    from cycle.engine import CycleEngine, CycleSettings, MarketData  # noqa: PLC0415
    from cycle.features import FeatureSet  # noqa: PLC0415
    from cycle.simulate import load_cost_model  # noqa: PLC0415

    source = Market(days=40, seed=5)
    data = MarketData(source.timestamps, source.open, source.high, source.low, source.close, source.volume)
    features = FeatureSet(source.features.copy(), list(source.feature_names))

    def factory(values, task="classification"):
        return build_adapter(KEY, values, "cpu", 42, task=task)

    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=f"reversal_engine_test_{label_kind}", model_family=KEY,
        model_parameters=dict(PARAMETERS), artifact_directory=str(tmp_path / label_kind), train_days=14,
        validation_fraction=0.2, test_days=4, step_days=0, fold_limit=2, expanding_window=False,
        label_horizon_bars=HORIZON, label_threshold_ticks=0.0, label_kind=label_kind, embargo_bars=0,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1,
        tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0, start_paused=False,
        quiet_bars=True, log_every_batches=1, device="cpu", seed=42, land_in_lake=False,
    )
    return source, CycleEngine(settings, data, features, load_cost_model("MNQ"), factory)


def test_a_direction_model_is_read_as_it_speaks_and_a_reversal_model_is_converted(tmp_path):
    source, direction = _engine(tmp_path, "direction")
    assert direction.probability_up(0.8, 100) == 0.8
    assert direction.probability_up(None, 100) is None

    _, reversal = _engine(tmp_path, "reversal")
    close = np.asarray(source.close, dtype=np.float64)
    tick = reversal.cost.tick_size
    rising = next(i for i in range(HORIZON, close.size) if trailing_direction(close, i, HORIZON, 0.0, tick) > 0)
    falling = next(i for i in range(HORIZON, close.size) if trailing_direction(close, i, HORIZON, 0.0, tick) < 0)
    # a turn after an up-move is a down-move: P(up) = 1 - P(turn)
    assert reversal.probability_up(0.8, rising) == pytest.approx(0.2)
    # a turn after a down-move is an up-move: P(up) = P(turn)
    assert reversal.probability_up(0.8, falling) == pytest.approx(0.8)
    # nothing to turn against before the first horizon bars
    assert reversal.probability_up(0.8, HORIZON - 1) is None
    assert reversal.probability_up(None, rising) is None


def test_the_reversal_walk_calls_long_exactly_where_its_probability_of_up_is_at_least_half(tmp_path, monkeypatch):
    capture = Capture()
    monkeypatch.setattr(protocol, "emit", capture)
    source, engine = _engine(tmp_path, "reversal")
    engine.run()
    close = np.asarray(source.close, dtype=np.float64)
    index_of = {int(stamp): i for i, stamp in enumerate(source.timestamps)}
    processed = [event for event in capture.of("cycle_bars") if event["role"] == "processed" and event.get("span", "test") == "test"]
    called = 0
    for event in processed:
        for stamp, probability, direction in zip(event["timestamps"], event["probabilityUp"], event["predictedDirection"]):
            if probability is None:
                assert direction == 0
                continue
            called += 1
            assert 0.0 <= probability <= 1.0
            assert direction == (1 if probability >= 0.5 else -1)
            # a called bar always has a trailing move to turn against
            assert trailing_direction(close, index_of[stamp], HORIZON, 0.0, engine.cost.tick_size) != 0
    assert called > 100, "the walk made too few calls for the test to mean anything"


def test_the_common_direction_baseline_is_a_direction_whichever_label_the_model_is_fitted_on(tmp_path, monkeypatch):
    majorities = {}
    for label_kind in ("direction", "reversal"):
        capture = Capture()
        monkeypatch.setattr(protocol, "emit", capture)
        _, engine = _engine(tmp_path, label_kind)
        engine.run()
        majorities[label_kind] = [spec.majority_up for spec in engine.folds]
        for spec in engine.folds:
            directions = engine.direction_labels[spec.train_index]
            directions = directions[np.isfinite(directions)]
            assert spec.majority_up == (1 if np.mean(directions) >= 0.5 else 0)
    assert majorities["direction"] == majorities["reversal"]


class _Turns:
    """A stand-in model that always says a turn is 90% likely."""

    def minimum_history(self) -> int:
        return 0

    def predict_probability(self, features, index) -> np.ndarray:
        return np.full(np.asarray(index).shape[0], 0.9)


def test_the_search_trades_the_converted_probability(tmp_path, monkeypatch):
    source, engine = _engine(tmp_path, "reversal")
    rows = np.arange(200, 400, dtype=np.int64)
    seen: dict[int, float] = {}

    def spy(engine_, scored_rows, probability, gate=None):
        seen.update(probability)
        return np.zeros(scored_rows.size)

    monkeypatch.setattr(tuning, "simulate_block", spy)
    tuning._block_objective(engine, "sharpe_ratio", _Turns(), rows)  # noqa: SLF001 - the unit under test
    close = np.asarray(source.close, dtype=np.float64)
    assert seen, "the search scored no bar"
    for row, probability in seen.items():
        trailing = trailing_direction(close, row, HORIZON, 0.0, engine.cost.tick_size)
        assert trailing != 0
        assert probability == pytest.approx(0.1 if trailing > 0 else 0.9)
