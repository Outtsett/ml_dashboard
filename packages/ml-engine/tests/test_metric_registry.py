"""The metric registry (`packages/config/metric_registry.json`) and every model's metrics record.

One definition per quantity: a metric the engine computes carries the engine's own definition,
formula and unit (`cycle.report.DEFINITIONS`), so the registry, the catalog specifications and
the run page cannot describe a number differently from the code that produces it. Every model in
the Model Cycle registry and every catalog specification names its metrics from this registry.
The TypeScript side holds the same files to the same rules in `tests/shared/cycleMetrics.test.ts`.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from cycle import catalog, report  # noqa: E402

CONFIG = ROOT.parent / "config"
REPOSITORY = ROOT.parent.parent
REGISTRY_FILE = CONFIG / "metric_registry.json"
SPECIFICATIONS = REPOSITORY / "Trading" / "_architecture" / "educational" / "algo_models"
RENDERER = REPOSITORY / "scripts" / "data" / "render_model_metrics.py"
ENGINE_DIRECTION = {"higher": "higher", "lower": "lower", "closer_to_zero": "closer_to_zero", "none": "neither"}
# Engine names that abbreviate; the registry gives them full-word ids and keeps the engine's name in engineId.
FULL_WORD_IDS = {
    "log_loss": "logarithmic_loss",
    "roc_auc": "area_under_receiver_operating_characteristic_curve",
    "f1_score": "f_one_score_up",
    "f1_score_down": "f_one_score_down",
    "macro_f1_score": "macro_f_one_score",
}


@pytest.fixture(scope="module")
def registry() -> dict:
    return json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))


def test_ids_are_unique_full_word_snake_case(registry):
    for group, field in (("metrics", "metricId"), ("objectives", "objectiveId"), ("profiles", "profileId"), ("metricTypes", "typeId")):
        ids = [entry[field] for entry in registry[group]]
        assert len(ids) == len(set(ids)), f"duplicate {field}"
        for identifier in ids:
            assert re.fullmatch(r"[a-z][a-z0-9_]*", identifier), identifier
    abbreviations = re.compile(r"(^|_)(auc|roc|mae|rmse|mse|nll|ece|kl|elbo|pnl|oos|mcc|crps|f1)(_|$)")
    for metric in registry["metrics"]:
        assert not abbreviations.search(metric["metricId"]), f"{metric['metricId']} abbreviates"


def test_every_reference_inside_the_registry_resolves(registry):
    types = {entry["typeId"] for entry in registry["metricTypes"]}
    metrics = {entry["metricId"] for entry in registry["metrics"]}
    objectives = {entry["objectiveId"] for entry in registry["objectives"]}
    for metric in registry["metrics"]:
        assert metric["metricType"] in types, metric["metricId"]
        assert metric["availability"] in registry["availabilityValues"], metric["metricId"]
        assert metric["layer"] in ("native", "as_run", "both"), metric["metricId"]
        assert metric["definition"].strip() and metric["formula"].strip(), metric["metricId"]
    for profile in registry["profiles"]:
        assert profile["metrics"], profile["profileId"]
        # architecture_component is only ever an additional profile: it lends diagnostics, never a primary
        if profile["profileId"] != "architecture_component":
            assert any(row["role"] == "primary" for row in profile["metrics"]), f"{profile['profileId']} has no primary metric"
        for row in profile["metrics"] + profile["notApplicable"]:
            assert row["metricId"] in metrics, (profile["profileId"], row["metricId"])
        for row in profile["metrics"]:
            assert row["role"] in registry["roleValues"]
        for objective in profile["typicalObjectives"]:
            assert objective in objectives, (profile["profileId"], objective)


def test_every_engine_metric_is_in_the_registry_with_the_engines_own_text(registry):
    by_engine_id = {metric["engineId"]: metric for metric in registry["metrics"] if metric["engineId"] is not None}
    assert set(by_engine_id) == set(report.DEFINITIONS), (
        f"engine metrics missing from the registry: {sorted(set(report.DEFINITIONS) - set(by_engine_id))}; "
        f"registry engine ids the engine does not define: {sorted(set(by_engine_id) - set(report.DEFINITIONS))}"
    )
    for engine_id, definition in report.DEFINITIONS.items():
        metric = by_engine_id[engine_id]
        assert metric["metricId"] == FULL_WORD_IDS.get(engine_id, engine_id), engine_id
        assert metric["definition"] == definition.definition, engine_id
        assert metric["formula"] == definition.formula, engine_id
        assert metric["units"] == definition.unit, engine_id
        assert metric["direction"] == ENGINE_DIRECTION[definition.better], engine_id
        assert metric["engineTable"] == definition.table, engine_id
        assert metric["availability"] == "computed", engine_id


def test_no_threshold_is_stated_as_a_baseline(registry):
    # A reference point is the same model on the same series, never a number from nowhere.
    invented = re.compile(r"[<>]\s*-?\d|\d\s*%")
    for metric in registry["metrics"]:
        assert not invented.search(metric["baseline"] or ""), (metric["metricId"], metric["baseline"])


def test_every_model_carries_a_record_the_loader_accepts():
    loaded = catalog.load_registry()
    reference = catalog.metric_registry()
    assert loaded["models"], "no models"
    for key, entry in loaded["models"].items():
        block = entry["metrics"]
        assert block["asRun"]["meaningful"], key
        for row in block["native"]["metrics"]:
            assert row["metricId"] in reference["metrics"], (key, row["metricId"])


def test_no_two_models_share_a_native_reason_word_for_word():
    # The reason a metric applies names the model's own mechanism; a sentence reused across
    # unrelated models is a template, which is what this registry replaced.
    # The one exception is the same algorithm specified twice in the catalog (the two Variational
    # Autoencoder specifications; Feedforward Neural Network and Multilayer Perceptron): those share
    # one native block, whole. A partly shared block is a copied sentence and fails.
    loaded = catalog.load_registry()
    natives = {key: json.dumps(entry["metrics"]["native"], sort_keys=True) for key, entry in loaded["models"].items()}
    seen: dict[str, str] = {}
    shared = []
    for key, entry in loaded["models"].items():
        for row in entry["metrics"]["native"]["metrics"]:
            first = seen.setdefault(row["why"], key)
            if first != key and natives[first] != natives[key]:
                shared.append((first, key, row["metricId"]))
    assert not shared, shared[:10]


@pytest.mark.skipif(not SPECIFICATIONS.is_dir(), reason="the specification tree is not on disk")
def test_every_specification_section_is_what_its_record_renders_to():
    result = subprocess.run([sys.executable, str(RENDERER), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
