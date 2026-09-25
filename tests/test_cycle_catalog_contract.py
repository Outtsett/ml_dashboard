"""The Model Cycle registry contract, Python side (`src/ml/cycle/catalog.py`).

The TypeScript side (`src/shared/cycle/models.ts`) is held to the same fixtures
by `tests/shared/cycleModels.test.ts`: both must accept the real registry and
reject every case in `tests/fixtures/cycle_models_invalid/`.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from cycle import catalog  # noqa: E402

REGISTRY = ROOT / "src" / "config" / "cycle_models"
INVALID = ROOT / "tests" / "fixtures" / "cycle_models_invalid"
LEGACY_FIXTURE = ROOT / "tests" / "fixtures" / "cycle_runners_legacy.json"
LEGACY_KEYS = ("logistic_regression", "random_forest", "xgboost", "lightgbm", "multilayer_perceptron", "lstm",
               "temporal_convolution_network", "transformer_encoder")


def _read_registry_files() -> dict[str, dict]:
    return {path.name: json.loads(path.read_text(encoding="utf-8")) for path in sorted(REGISTRY.glob("*.json"))}


def _walk(document, path):
    for part in path[:-1]:
        document = document[part]
    return document


def _apply(files: dict[str, dict], operations: list[dict]) -> dict[str, dict]:
    files = copy.deepcopy(files)
    for operation in operations:
        if operation["op"] == "set":
            _walk(files[operation["file"]], operation["path"])[operation["path"][-1]] = operation["value"]
        elif operation["op"] == "delete":
            del _walk(files[operation["file"]], operation["path"])[operation["path"][-1]]
        elif operation["op"] == "copy":
            value = copy.deepcopy(_walk(files[operation["fromFile"]], operation["fromPath"])[operation["fromPath"][-1]])
            _walk(files[operation["toFile"]], operation["toPath"])[operation["toPath"][-1]] = value
        else:
            raise AssertionError(f"unknown fixture operation {operation['op']}")
    return files


def _write(files: dict[str, dict], directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name, document in files.items():
        (directory / name).write_text(json.dumps(document), encoding="utf-8")
    return directory


def test_the_real_registry_loads():
    registry = catalog.load_registry(REGISTRY)
    assert set(LEGACY_KEYS) <= set(registry["models"])
    for key in LEGACY_KEYS:
        assert registry["models"][key]["runnable"], key
        assert registry["models"][key]["adapter"] == "legacy"


@pytest.mark.parametrize("case", sorted(path.stem for path in INVALID.glob("*.json")))
def test_every_invalid_fixture_is_rejected(case, tmp_path):
    fixture = json.loads((INVALID / f"{case}.json").read_text(encoding="utf-8"))
    broken = _apply(_read_registry_files(), fixture["operations"])
    with pytest.raises(catalog.RegistryError):
        catalog.load_registry(_write(broken, tmp_path / case))


def test_importing_the_registry_does_not_import_numpy():
    # main.py reads the registry before numpy to decide whether torch goes first.
    code = (
        "import sys; sys.path.insert(0, r'%s'); import cycle.catalog as c; c.registry(); "
        "print('numpy' in sys.modules, 'torch' in sys.modules)" % (ROOT / "src" / "ml")
    )
    output = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.split()
    assert output == ["False", "False"]


def test_legacy_parameters_are_exactly_the_old_runner_blocks():
    legacy = json.loads(LEGACY_FIXTURE.read_text(encoding="utf-8"))["runners"]
    registry = catalog.load_registry(REGISTRY)
    shared = registry["shared"]
    for key in LEGACY_KEYS:
        block = legacy[f"{key}+walk_forward_cycle"]["defaultHyperparameters"]
        model = {name: spec for name, spec in block.items() if spec["group"] == "Model"}
        cycle = {name: spec for name, spec in block.items() if spec["group"] != "Model"}
        assert registry["models"][key]["parameters"] == model, key
        assert shared["cycleParameters"] == cycle, key


def test_legacy_defaults_keep_their_python_types():
    from cycle import models

    for key in LEGACY_KEYS:
        registry_defaults = catalog.defaults(key)
        legacy_defaults = models.default_parameters(key)
        assert registry_defaults == legacy_defaults, key
        for name, value in legacy_defaults.items():
            assert type(registry_defaults[name]) is type(value), (key, name)


def test_every_parameter_name_has_one_type_and_one_flag():
    types = catalog.parameter_types()
    assert types["max_depth"] == "int" and types["learning_rate"] == "float" and types["kernel"] == "categorical"
    assert catalog.flag("min_child_weight") == "--min-child-weight"


def test_resolve_checks_types_and_bounds():
    resolved = catalog.resolve_parameters("extra_trees", {"tree_count": "250", "max_features_fraction": 0.3})
    assert resolved["tree_count"] == 250 and isinstance(resolved["tree_count"], int)
    with pytest.raises(ValueError, match="at least"):
        catalog.resolve_parameters("extra_trees", {"tree_count": 1})
    with pytest.raises(ValueError, match="whole number"):
        catalog.resolve_parameters("extra_trees", {"tree_count": 250.5})
    with pytest.raises(ValueError, match="one of"):
        catalog.resolve_parameters("support_vector_machine", {"kernel": "cubic"})


def test_estimator_arguments_follow_roles_and_fixed_arguments():
    parameters = catalog.resolve_parameters("classification_and_regression_tree", {})
    direction = catalog.estimator_arguments("classification_and_regression_tree", parameters, "direction")
    price = catalog.estimator_arguments("classification_and_regression_tree", parameters, "price")
    assert direction["criterion"] == "gini" and "criterion" not in price
    quantile = catalog.estimator_arguments("quantile_regression", catalog.resolve_parameters("quantile_regression", {}), "price")
    assert quantile["solver"] == "highs" and quantile["quantile"] == 0.5
    with pytest.raises(ValueError, match="no price model"):
        catalog.estimator_arguments("naive_bayes", catalog.resolve_parameters("naive_bayes", {}), "price")


class _RecordingTrial:
    def __init__(self):
        self.calls = []

    def suggest_float(self, name, low, high, log=False):
        self.calls.append(("float", name, low, high, log))
        return low

    def suggest_int(self, name, low, high, log=False):
        self.calls.append(("int", name, low, high, log))
        return low

    def suggest_categorical(self, name, choices):
        self.calls.append(("categorical", name, tuple(choices)))
        return choices[0]


def test_optuna_search_reads_the_registry():
    trial = _RecordingTrial()
    suggested = catalog.suggest_parameters(trial, "k_nearest_neighbors", {})
    assert ("int", "neighbor_count", 5, 500, True) in trial.calls
    assert suggested["neighbor_count"] == 5
    with pytest.raises(ValueError, match="legacy"):
        catalog.suggest_parameters(_RecordingTrial(), "xgboost", {})


def test_unavailable_reasons_cover_the_catalog():
    reason = catalog.unavailable_reason("anything", "reinforcement-learning", "policy")
    assert "policy" in reason
    assert "graph" in catalog.unavailable_reason("x", "neural-network", "graph-neural-networks")
