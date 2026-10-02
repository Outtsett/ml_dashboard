"""Model Cycle entry point (packages/ml-engine/src/cycle/main.py) against the model registry.

Checked: the model flags are exactly the registry's parameter names with their
declared types (bool as --name / --no-name); the eight legacy families keep the
flag types and defaults the hand-written table gave them; parameters resolve
through models.resolve_parameters (legacy) or catalog.resolve_parameters
(everything else); flags of other models are named; a key the registry marks
not runnable fails with its reason before any data is read; and torch is
imported before numpy exactly when the registry says the model is built on
torch or the device is not forced to cpu.
"""

from __future__ import annotations

import argparse
import copy
import importlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from cycle import catalog
from shared import protocol

MAIN_PATH = Path(__file__).resolve().parents[1] / "src" / "ml" / "cycle" / "main.py"

# The flag types and defaults main.py's hand-written table gave the eight
# families before the registry (FAMILY_DEFAULTS at 251c9e3).
OLD_FAMILY_DEFAULTS: dict[str, dict[str, object]] = {
    "logistic_regression": {"regularization_strength": 1.0, "max_iterations": 300},
    "random_forest": {"tree_count": 300, "max_depth": 8, "min_samples_leaf": 20, "max_features_fraction": 0.5},
    "xgboost": {"boosting_rounds": 400, "max_depth": 6, "learning_rate": 0.05, "subsample": 0.8,
                "column_subsample": 0.8, "min_child_weight": 1.0, "l2_regularization": 1.0, "early_stopping_rounds": 50},
    "lightgbm": {"boosting_rounds": 400, "leaf_count": 31, "learning_rate": 0.05, "subsample": 0.8,
                 "column_subsample": 0.8, "min_child_samples": 20, "l2_regularization": 1.0, "early_stopping_rounds": 50},
    "multilayer_perceptron": {"hidden_size": 128, "layer_count": 2, "dropout": 0.2, "learning_rate": 0.001,
                              "weight_decay": 0.0001, "batch_size": 256, "epochs": 20, "patience": 5},
    "lstm": {"sequence_length": 32, "hidden_size": 64, "layer_count": 1, "dropout": 0.2, "learning_rate": 0.001,
             "weight_decay": 0.0001, "batch_size": 256, "epochs": 20, "patience": 5},
    "temporal_convolution_network": {"sequence_length": 32, "channel_count": 32, "kernel_size": 3, "layer_count": 3,
                                     "dropout": 0.2, "learning_rate": 0.001, "weight_decay": 0.0001,
                                     "batch_size": 256, "epochs": 20, "patience": 5},
    "transformer_encoder": {"sequence_length": 32, "model_dimension": 32, "head_count": 4, "layer_count": 2,
                            "dropout": 0.1, "learning_rate": 0.0005, "weight_decay": 0.0001, "batch_size": 256,
                            "epochs": 20, "patience": 5},
}
PYTHON_TYPES = {"int": int, "float": float, "categorical": str}


@pytest.fixture
def main(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["main.py", "--device", "cpu"])   # keeps the import from loading torch
    return importlib.import_module("cycle.main")


def model_actions(parser: argparse.ArgumentParser) -> dict[str, argparse.Action]:
    return {action.dest[len("model__"):]: action for action in parser._actions if action.dest.startswith("model__")}


def parse(main, *extra: str, family: str = "xgboost") -> argparse.Namespace:
    arguments = ["--symbol", "MNQ", "--timeframe", "5m", "--model-id", "run", "--model-family", family, *extra]
    args, unknown = main.build_parser().parse_known_args(arguments)
    assert unknown == []
    return args


# ─── flags ─────────────────────────────────────────────────────────────────

def test_model_flags_are_the_registry_parameters_with_their_declared_types(main):
    actions = model_actions(main.build_parser())
    declared = catalog.parameter_types()
    assert set(actions) == set(declared)
    for name, action in actions.items():
        assert action.option_strings == [catalog.flag(name)] or catalog.flag(name) in action.option_strings
        assert action.default is None, name   # "not given" stays distinguishable from a default
        if declared[name] == "bool":
            assert isinstance(action, argparse.BooleanOptionalAction), name
        else:
            assert action.type is PYTHON_TYPES[declared[name]], name


def test_a_bool_parameter_is_a_name_and_no_name_flag(main, monkeypatch):
    monkeypatch.setattr(main.catalog, "parameter_types", lambda reg=None: {"fit_intercept": "bool", "quantile": "float"})
    parser = main.build_parser()
    base = ["--symbol", "MNQ", "--timeframe", "5m", "--model-id", "run", "--model-family", "xgboost"]
    assert parser.parse_args(base).model__fit_intercept is None
    assert parser.parse_args([*base, "--fit-intercept"]).model__fit_intercept is True
    assert parser.parse_args([*base, "--no-fit-intercept"]).model__fit_intercept is False


def test_legacy_flags_keep_the_types_of_the_old_table(main):
    actions = model_actions(main.build_parser())
    for family, defaults in OLD_FAMILY_DEFAULTS.items():
        for name, default in defaults.items():
            assert actions[name].type is (float if isinstance(default, float) else int), (family, name)


def test_every_registry_key_is_a_model_family_choice(main):
    (action,) = [a for a in main.build_parser()._actions if a.dest == "model_family"]
    assert tuple(action.choices) == catalog.model_keys()


# ─── parameters ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("family", list(OLD_FAMILY_DEFAULTS))
def test_legacy_defaults_resolve_exactly_as_before(main, family):
    parameters = main.model_parameters(parse(main, family=family), family)
    assert parameters == OLD_FAMILY_DEFAULTS[family]
    assert list(parameters) == list(OLD_FAMILY_DEFAULTS[family])
    for name, value in parameters.items():
        assert type(value) is type(OLD_FAMILY_DEFAULTS[family][name]), (family, name)


def test_legacy_flags_resolve_through_models(main):
    from cycle import models

    args = parse(main, "--boosting-rounds", "50", "--learning-rate", "0.1", "--hidden-size", "64")
    parameters = main.model_parameters(args, "xgboost")
    assert parameters == models.resolve_parameters("xgboost", {"boosting_rounds": 50, "learning_rate": 0.1})
    assert parameters["boosting_rounds"] == 50 and parameters["learning_rate"] == 0.1
    assert "hidden_size" not in parameters
    with pytest.raises(ValueError, match="subsample must be in"):   # models.py's own sentence
        main.model_parameters(parse(main, "--subsample", "1.5"), "xgboost")


def test_other_models_resolve_through_the_registry(main):
    key, name, choice = next(
        (key, name, spec["choices"][-1])
        for key, entry in catalog.registry()["models"].items() if entry["adapter"] != "legacy"
        for name, spec in entry["parameters"].items() if spec["type"] == "categorical"
    )
    args = parse(main, catalog.flag(name), str(choice), family=key)
    parameters = main.model_parameters(args, key)
    assert parameters == catalog.resolve_parameters(key, {name: choice})
    assert parameters[name] == choice
    assert list(parameters) == list(catalog.entry(key)["parameters"])
    with pytest.raises(ValueError, match=name):
        main.model_parameters(parse(main, catalog.flag(name), "not-a-choice", family=key), key)


def test_flags_that_belong_to_other_models_are_named(main):
    args = parse(main, "--hidden-size", "64", "--max-depth", "4", "--quantile", "0.3")
    assert sorted(main.flags_for_other_models(args, "xgboost")) == ["--hidden-size", "--quantile"]
    assert main.flags_for_other_models(parse(main), "xgboost") == []


# ─── runnable ──────────────────────────────────────────────────────────────

def registry_with_unrunnable(key: str, reason: str) -> dict:
    changed = copy.deepcopy(catalog.registry())
    changed["models"][key]["runnable"] = False
    changed["models"][key]["unavailableReason"] = reason
    return changed


def test_a_key_that_is_not_runnable_fails_with_its_reason_before_loading_data(main, monkeypatch):
    import shared.data

    key = "xgboost"
    reason = "Being rebuilt for this test."
    changed = registry_with_unrunnable(key, reason)
    monkeypatch.setattr(catalog, "registry", lambda: changed)

    def refuse(*arguments, **keywords):
        raise AssertionError("data was loaded for a model that cannot run")

    monkeypatch.setattr(shared.data, "load_ohlcv_arrays", refuse)
    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", events.append)
    arguments = ["--symbol", "MNQ", "--timeframe", "5m", "--model-id", "run", "--json",
                 "--model-family", key, "--device", "cpu"]
    assert main.main(arguments) == 1
    (error,) = [event for event in events if event["type"] == "error"]
    assert error["message"] == f"ValueError: XGBoost ({key}) cannot run in the Model Cycle yet: {reason}"
    assert not [event for event in events if event["type"] == "log"]


def test_every_unrunnable_registry_key_is_refused_with_its_own_reason(main):
    for key, entry in catalog.registry()["models"].items():
        if entry["runnable"]:
            assert main.require_runnable(key) is entry
        else:
            with pytest.raises(ValueError) as refused:
                main.require_runnable(key)
            assert entry["unavailableReason"] in str(refused.value)
            assert key in str(refused.value)


# ─── torch before numpy ────────────────────────────────────────────────────

def test_torch_goes_first_follows_the_registry_and_the_device(main):
    for key, entry in catalog.registry()["models"].items():
        assert main.torch_goes_first(key, "cpu") is (entry["implementation"] == "torch"), key
        assert main.torch_goes_first(key, "cuda") is True
        assert main.torch_goes_first(key, None) is True      # --device defaults to auto
    assert main.torch_goes_first(None, "cpu") is False
    assert main.torch_goes_first("no_such_model", "cpu") is False


def test_a_broken_registry_decides_on_the_device_alone(main, monkeypatch):
    def broken(*arguments, **keywords):
        raise catalog.RegistryError("broken for this test")

    monkeypatch.setattr(main.catalog, "uses_torch", broken)
    assert main.torch_goes_first("lstm", "cpu") is False
    assert main.torch_goes_first("lstm", "auto") is True


IMPORT_ORDER_SCRIPT = r"""
import importlib.util, json, sys

order = []

class Watch:
    def find_spec(self, name, path=None, target=None):
        top = name.split(".")[0]
        if top in ("torch", "numpy") and top not in order:
            order.append(top)
        return None

sys.meta_path.insert(0, Watch())
sys.argv = ["main.py"] + sys.argv[1:]
spec = importlib.util.spec_from_file_location("cycle_main_under_test", MAIN_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps({"order": order, "torch": "torch" in sys.modules}))
"""


def import_order(*arguments: str) -> dict:
    script = IMPORT_ORDER_SCRIPT.replace("MAIN_PATH", repr(str(MAIN_PATH)))
    result = subprocess.run([sys.executable, "-c", script, *arguments], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def test_a_torch_model_imports_torch_before_numpy():
    pytest.importorskip("torch")
    key = next(key for key in catalog.runnable_keys() if catalog.uses_torch(key))
    seen = import_order("--model-family", key, "--device", "cpu")
    assert seen["torch"] is True
    assert seen["order"][0] == "torch", seen


def test_a_tabular_model_on_cpu_never_imports_torch():
    key = next(key for key in catalog.runnable_keys() if not catalog.uses_torch(key))
    seen = import_order("--model-family", key, "--device", "cpu")
    assert seen["torch"] is False
    assert "torch" not in seen["order"] and "numpy" in seen["order"], seen


def test_a_tabular_model_on_auto_imports_torch_first():
    pytest.importorskip("torch")
    key = next(key for key in catalog.runnable_keys() if not catalog.uses_torch(key))
    seen = import_order("--model-family", key)
    assert seen["torch"] is True and seen["order"][0] == "torch", seen
