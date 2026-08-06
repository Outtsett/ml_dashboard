"""Envelope contract tests for `src/ml/shared/protocol.py`.

The envelope (schema v1) is the wire contract between every Python runner and
the Node parsers. Two properties are load-bearing and are asserted here:

1. Every emitted line carries the full envelope, so a raw stdout line is
   self-identifying without the spawn record.
2. The historical FLAT payload survives verbatim alongside the new nested
   `data` copy. `XgbClassifierParser` reads the flat fields with no Zod schema
   and no passthrough; a nested-only cutover breaks it on the first event.
"""

from __future__ import annotations

import contextlib
import io
import json

import pytest
from src.ml.shared import protocol

ENVELOPE_FIELDS = (
    "v",
    "kind",
    "type",
    "ts",
    "mono_ns",
    "seq",
    "run_id",
    "experiment_id",
    "catalog_id",
    "trial_idx",
    "fold_idx",
    "config_hash",
    "manifest_hash",
    "data",
)


def _capture(fn, *args, **kwargs) -> list[dict]:
    """Run an emitter, capture stdout, return the parsed JSON lines."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*args, **kwargs)
    return [json.loads(line) for line in buf.getvalue().splitlines() if line.strip()]


@pytest.fixture
def identity(monkeypatch) -> dict:
    """Populate the ML_* identity variables and refresh the module context."""
    values = {
        "ML_RUN_ID": "run_01K3QZ7ABCDEFGHJKMNPQRSTV",
        "ML_EXPERIMENT_ID": "exp_01K3QZ6ABCDEFGHJKMNPQRSTV",
        "ML_CATALOG_ID": "xgboost",
        "ML_CONFIG_HASH": "9f3c1a2e5b70d4c8",
        "ML_MANIFEST_HASH": "7ad04ef1c9b3220a",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    protocol.refresh_env_context()
    protocol.set_active_fold(None)
    protocol.set_active_trial(None)
    yield values
    for key in values:
        monkeypatch.delenv(key, raising=False)
    protocol.refresh_env_context()
    protocol.set_active_fold(None)
    protocol.set_active_trial(None)


def test_metric_carries_full_envelope(identity):
    (event,) = _capture(protocol.emit_metric, "val_auc", 0.6134, 42, 200)

    missing = [field for field in ENVELOPE_FIELDS if field not in event]
    assert not missing, f"missing envelope fields: {missing}"

    assert event["v"] == 1
    assert event["kind"] == "training"
    assert event["type"] == "metric"
    assert event["run_id"] == identity["ML_RUN_ID"]
    assert event["experiment_id"] == identity["ML_EXPERIMENT_ID"]
    assert event["catalog_id"] == identity["ML_CATALOG_ID"]
    assert event["config_hash"] == identity["ML_CONFIG_HASH"]
    assert event["manifest_hash"] == identity["ML_MANIFEST_HASH"]


def test_flat_legacy_fields_survive_alongside_nested_data(identity):
    """XgbClassifierParser reads these flat keys with no schema — they must stay."""
    (event,) = _capture(protocol.emit_metric, "val_auc", 0.6134, 42, 200)

    assert event["name"] == "val_auc"
    assert event["value"] == pytest.approx(0.6134)
    assert event["iteration"] == 42
    assert event["total"] == 200
    assert event["data"] == {
        "name": "val_auc",
        "value": pytest.approx(0.6134),
        "iteration": 42,
        "total": 200,
    }


def test_timestamp_is_rfc3339_utc_milliseconds(identity):
    (event,) = _capture(protocol.emit_log, "hello")
    ts = event["ts"]
    assert ts.endswith("Z")
    assert len(ts) == len("2026-07-28T18:03:11.284Z")
    # Round-trips as an aware UTC datetime.
    from datetime import datetime, timezone

    parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == timezone.utc.utcoffset(None)


def test_mono_ns_is_monotonic_and_relative_to_import(identity):
    first = _capture(protocol.emit_log, "one")[0]
    second = _capture(protocol.emit_log, "two")[0]
    assert isinstance(first["mono_ns"], int)
    assert second["mono_ns"] > first["mono_ns"]
    # Relative to process start, not an absolute clock: bounded well under a
    # century of nanoseconds even for a long-running test session.
    assert first["mono_ns"] < 10**18


def test_seq_increments_by_one_across_emitters(identity):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        protocol.emit_log("a")
        protocol.emit_progress(1, 10, phase="fit")
        protocol.emit_metric("loss", 0.5, 1, 10)
    seqs = [json.loads(line)["seq"] for line in buf.getvalue().splitlines() if line.strip()]
    assert seqs == [seqs[0], seqs[0] + 1, seqs[0] + 2]


def test_active_fold_and_trial_stamp_every_event(identity):
    protocol.set_active_trial(17)
    protocol.set_active_fold(2)
    (event,) = _capture(protocol.emit_metric, "val_auc", 0.61, 1, 10)
    assert event["trial_idx"] == 17
    assert event["fold_idx"] == 2

    protocol.set_active_trial(None)
    protocol.set_active_fold(None)
    (cleared,) = _capture(protocol.emit_metric, "val_auc", 0.61, 1, 10)
    assert cleared["trial_idx"] is None
    assert cleared["fold_idx"] is None


def test_fold_complete_payload_fold_idx_wins_over_active_fold(identity):
    """An emitter that carries its own coordinate must not be nulled by the
    module-level one — otherwise fold_complete would report the wrong fold."""
    protocol.set_active_fold(2)
    (event,) = _capture(protocol.emit_fold_complete, 3, {"profit_factor": 1.32})
    assert event["fold_idx"] == 3
    assert event["data"]["fold_idx"] == 3
    assert event["metrics"]["profit_factor"] == pytest.approx(1.32)


def test_missing_env_yields_null_identity_not_empty_string(monkeypatch):
    """A headless run has no orchestrator identity. `None` — never `""` — so
    the Node side can tell 'absent' from 'present but useless'."""
    for key in ("ML_RUN_ID", "ML_EXPERIMENT_ID", "ML_CATALOG_ID", "ML_CONFIG_HASH", "ML_MANIFEST_HASH"):
        monkeypatch.delenv(key, raising=False)
    protocol.refresh_env_context()
    (event,) = _capture(protocol.emit_log, "headless")
    assert event["run_id"] is None
    assert event["experiment_id"] is None
    assert event["catalog_id"] is None
    assert event["config_hash"] is None
    assert event["manifest_hash"] is None
    # The payload is unaffected by the absent identity.
    assert event["message"] == "headless"


def test_empty_env_var_is_treated_as_absent(monkeypatch):
    monkeypatch.setenv("ML_RUN_ID", "")
    protocol.refresh_env_context()
    (event,) = _capture(protocol.emit_log, "blank")
    assert event["run_id"] is None
    monkeypatch.delenv("ML_RUN_ID", raising=False)
    protocol.refresh_env_context()


def test_envelope_still_routes_through_the_nan_sanitizer(identity):
    """`emit()` was rewritten to go through `dumps_safe`; the envelope must not
    bypass it. A bare NaN token makes the whole line unparseable in Node."""
    (event,) = _capture(protocol.emit_metric, "val_auc", float("nan"), 1, 10)
    assert event["value"] is None
    assert event["data"]["value"] is None
    assert "NaN" not in json.dumps(event)


def test_every_emitter_produces_an_enveloped_line(identity):
    cases = [
        (protocol.emit_progress, (1, 10), {}),
        (protocol.emit_metric, ("loss", 0.5, 1, 10), {}),
        (protocol.emit_fold_complete, (0, {"auc": 0.5}), {}),
        (protocol.emit_overlay, ([1_700_000_000], [0], ["#0072B2"], ["calm"]), {}),
        (protocol.emit_log, ("msg",), {}),
        (protocol.emit_done, ("data/models/x", {"quality_score": 0.5}), {}),
        (protocol.emit_model_state, (1, 10, {"k": 3}), {}),
        (protocol.emit_sampler_diagnostics, (1, 10, {"ess": 120.0}), {}),
        (protocol.emit_metric_declarations, ({"loss": {"renderer": "number"}},), {}),
        (protocol.emit_error, ("boom", "traceback"), {}),
    ]
    assert len(cases) == 10, "all 10 emitters must be covered"

    for fn, args, kwargs in cases:
        (event,) = _capture(fn, *args, **kwargs)
        missing = [field for field in ENVELOPE_FIELDS if field not in event]
        assert not missing, f"{fn.__name__} missing envelope fields: {missing}"
        assert event["v"] == 1
        assert event["kind"] == "training"
        assert event["run_id"] == identity["ML_RUN_ID"]
        assert isinstance(event["data"], dict)


def test_emitter_type_discriminators_are_unchanged(identity):
    """The `type` vocabulary is the parser's discriminator — the envelope must
    not have renamed or shadowed any of it."""
    expected = {
        protocol.emit_progress: ("progress", (1, 10)),
        protocol.emit_metric: ("metric", ("loss", 0.5, 1, 10)),
        protocol.emit_fold_complete: ("fold_complete", (0, {"auc": 0.5})),
        protocol.emit_log: ("log", ("msg",)),
        protocol.emit_done: ("done", ("path", {})),
        protocol.emit_model_state: ("model_state", (1, 10, {})),
        protocol.emit_sampler_diagnostics: ("sampler_diagnostics", (1, 10, {})),
        protocol.emit_metric_declarations: ("metric_declarations", ({},)),
        protocol.emit_error: ("error", ("boom",)),
    }
    for fn, (event_type, args) in expected.items():
        (event,) = _capture(fn, *args)
        assert event["type"] == event_type
