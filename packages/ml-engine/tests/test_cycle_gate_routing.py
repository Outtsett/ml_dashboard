"""A mixture of experts reports which expert the gate chose per bar: the adapter's
`routing()` is the gate's own probabilities, batched; every other kind reports
none; the wire payload carries the winner, the entropy and each expert's share."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.shared import protocol  # noqa: E402
from cycle.models import build_adapter  # noqa: E402
from test_cycle_loss_surface import Dataset, Reporter  # noqa: E402


def _fit(key: str, parameters: dict):
    data = Dataset()
    adapter = build_adapter(key, parameters, "cpu", 0)
    adapter.fit(data.features, data.labels, data.train_index, data.validation_index, data.timestamps, Reporter(0))
    return data, adapter


def test_the_mixture_routes_every_bar_to_experts_summing_to_one():
    data, adapter = _fit("mixture_of_experts", {"epochs": 2, "batch_size": 128, "patience": 5, "expert_count": 3})
    rows = data.validation_index[:40]
    probabilities = adapter.routing(data.features, rows)
    assert probabilities is not None
    assert probabilities.shape == (40, 3)
    assert np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-5)
    assert np.all(probabilities >= 0.0)
    # the same gate the prediction used: a single row routes the same way as the batch
    single = adapter.routing(data.features, rows[:1])
    assert np.allclose(single[0], probabilities[0], atol=1e-5)


def test_a_feedforward_network_has_no_routing():
    data, adapter = _fit("feedforward_network", {"epochs": 1, "batch_size": 128, "patience": 5})
    assert adapter.routing(data.features, data.validation_index[:5]) is None


def test_the_payload_names_the_winner_the_entropy_and_the_usage():
    payload = protocol.cycle_gate_routing_payload(
        fold_index=1, model_role="direction", timestamps=[10, 20, 30],
        probabilities=[[0.7, 0.2, 0.1], [0.1, 0.8, 0.1], [1 / 3, 1 / 3, 1 / 3]],
    )
    assert payload["foldIndex"] == 1 and payload["expertCount"] == 3
    assert payload["chosenExpert"] == [0, 1, 0]
    assert payload["entropy"][2] == pytest.approx(math.log(3), abs=1e-3)
    assert payload["entropy"][0] < payload["entropy"][2]
    assert sum(payload["usage"]) == pytest.approx(1.0, abs=1e-3)
    with pytest.raises(ValueError):
        protocol.cycle_gate_routing_payload(fold_index=0, model_role="direction", timestamps=[1, 2], probabilities=[[1.0]])
