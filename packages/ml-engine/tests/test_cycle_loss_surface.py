"""The loss surface a neural adapter hands its reporter after a final fit:
asked for by `loss_surface_resolution`, never for a tuning trial, shaped as
`cycle_loss_surface` carries it, with the kept weights at the grid's centre."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.shared import protocol  # noqa: E402
from cycle.adapter import BatchReport, EpochReport  # noqa: E402
from cycle.models import build_adapter  # noqa: E402

FEATURE_COUNT = 6


class Dataset:
    def __init__(self, row_count: int = 1200, seed: int = 3) -> None:
        generator = np.random.default_rng(seed)
        features = generator.standard_normal((row_count, FEATURE_COUNT)).astype(np.float32)
        signal = features[:, 0] - 0.8 * features[:, 1] + 0.3 * generator.standard_normal(row_count)
        labels = (signal > 0).astype(np.float32)
        labels[-6:] = np.nan
        self.features = features
        self.labels = labels
        self.timestamps = (1_700_000_000 + 300 * np.arange(row_count)).astype(np.int64)
        scored = np.flatnonzero(np.isfinite(labels))
        self.train_index = scored[scored < 800]
        self.validation_index = scored[(scored >= 810) & (scored < 1100)]


class Reporter:
    """The adapter-facing surface of `EngineReporter`, with the resolution dial."""

    def __init__(self, resolution: int) -> None:
        self.step_unit = None
        self.loss_surface_resolution = resolution
        self.epochs: list[EpochReport] = []
        self.logs: list[str] = []
        self.surfaces: list[dict] = []

    def epoch_started(self, epoch, epoch_count):
        pass

    def batch(self, report):
        assert isinstance(report, BatchReport)

    def epoch_finished(self, report):
        self.epochs.append(report)

    def validating(self, epoch, epoch_count):
        pass

    def checkpoint(self):
        pass

    def log(self, message, level="info"):
        self.logs.append(message)

    def loss_surface(self, surface):
        self.surfaces.append(surface)


PARAMETERS = {"epochs": 2, "batch_size": 128, "patience": 5}


def _fit(resolution: int) -> Reporter:
    data = Dataset()
    reporter = Reporter(resolution)
    adapter = build_adapter("feedforward_network", PARAMETERS, "cpu", 0)
    adapter.fit(data.features, data.labels, data.train_index, data.validation_index, data.timestamps, reporter)
    return reporter


def test_a_final_fit_reports_one_surface_with_the_fit_at_its_centre():
    reporter = _fit(7)
    assert len(reporter.surfaces) == 1
    surface = reporter.surfaces[0]
    assert surface["resolution"] == 7
    assert len(surface["alphas"]) == 7 and len(surface["betas"]) == 7
    losses = np.asarray(surface["losses"], dtype=np.float64)
    assert losses.shape == (7, 7)
    assert np.all(np.isfinite(losses))
    # (0, 0) is the kept weights: their validation loss, which a perturbed grid cannot beat by much
    centre = losses[3, 3]
    assert abs(surface["alphas"][3]) < 1e-9 and abs(surface["betas"][3]) < 1e-9
    assert centre <= losses.max()
    assert surface["batch_count"] >= 1
    assert surface["seconds_elapsed"] > 0
    assert set(surface["diagnostics"]) == {"sharpness", "condition_number", "valley_width", "locally_convex"}


def test_resolution_zero_means_no_surface():
    reporter = _fit(0)
    assert reporter.surfaces == []
    assert len(reporter.epochs) == 2


def test_the_surface_fits_the_wire_contract_and_survives_a_round_trip():
    reporter = _fit(5)
    payload = protocol.cycle_loss_surface_payload(fold_index=2, model_role="direction", surface=reporter.surfaces[0])
    assert payload["foldIndex"] == 2 and payload["modelRole"] == "direction"
    assert payload["resolution"] == 5 and payload["range"] == [-1.0, 1.0]
    assert set(payload["diagnostics"]) == {"sharpness", "conditionNumber", "valleyWidth", "locallyConvex"}
    assert isinstance(payload["diagnostics"]["locallyConvex"], bool)
    buffer = io.StringIO()
    stdout = sys.stdout
    sys.stdout = buffer
    try:
        protocol.emit_cycle_loss_surface(fold_index=2, model_role="direction", surface=reporter.surfaces[0])
    finally:
        sys.stdout = stdout
    line = json.loads(buffer.getvalue().strip())
    assert line["type"] == "cycle_loss_surface"
    assert line["losses"] == payload["losses"]


def test_a_bad_model_role_is_refused():
    with pytest.raises(ValueError):
        protocol.cycle_loss_surface_payload(fold_index=0, model_role="both", surface={"alphas": [], "betas": [], "losses": [], "resolution": 3, "range": [-1, 1]})
