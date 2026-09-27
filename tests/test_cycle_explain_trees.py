"""The tree explainer (``src/ml/cycle/explain/trees.py``) against real Model
Cycle runs.

Small runs are made in-process on the synthetic MNQ-like 5-minute market of
``tests/test_cycle_explain_core.py`` (copied): every tree model in the
registry (legacy xgboost, lightgbm and random forest; extra trees, the two
single decision trees, the gradient boosting machine, catboost) through its
real adapter, on CPU, two folds, with its price model. Then:

- the verify script's gates pass on every sampled test bar of every fold and
  role: G1 (reload = streamed, 1e-12), G2 (the link on base + Σ leaves, or the
  mean of the leaves, gives the output, 1e-6; also with the model's declared
  base), G3 (every recorded path re-evaluated with the library's comparison
  reaches the recorded leaf, exact);
- xgboost counts only the trees up to its best round; base values are the
  library's (xgboost's base score, lightgbm 0, the boosting machine's initial
  estimator, catboost's bias);
- forests read P(up) in the column of ``classes_ == 1``;
- catboost's leaf index is Σ bit_d · 2^d in the model's split order;
- whole trees are schema-valid and agree with the bar's paths;
- one structure and one bar per model are written to
  ``tests/fixtures/cycle_explain/`` (``CYCLE_EXPLAIN_WRITE_FIXTURES=1``).
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from cycle.control import ControlState
from cycle.engine import CycleEngine, CycleSettings, MarketData
from cycle.explain import ExplainError, kind_module
from cycle.explain import trees as tree_module
from cycle.explain.server import Explainer, encode
from cycle.features import FeatureSet
from cycle.models import build_adapter, default_parameters
from cycle.simulate import load_cost_model
from shared import protocol

REPOSITORY = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = REPOSITORY / "scripts" / "verify_cycle_explain.py"
FIXTURES = REPOSITORY / "tests" / "fixtures" / "cycle_explain"
MNQ = load_cost_model("MNQ")
FIRST_MONDAY = int(datetime(2026, 3, 2, tzinfo=timezone.utc).timestamp())
BARS_PER_DAY = 96
HORIZON = 4
FEATURE_NAMES = ["planted_signal", "planted_signal_previous_bar", "noise_first", "noise_second"]
BARS_SAMPLED = 25


# ═══ a synthetic market and real runs ══════════════════════════════════════


def synthetic_market(calendar_days: int = 49, seed: int = 5) -> tuple[MarketData, FeatureSet]:
    """The market of tests/test_cycle_explain_core.py: bar t+1 drifts with a
    causal AR(1) signal the model is handed as a feature."""
    generator = np.random.default_rng(seed)
    stamps: list[int] = []
    for day in range(calendar_days):
        if day % 7 >= 5:
            continue
        opening = FIRST_MONDAY + day * 86_400 + 13 * 3_600 + 30 * 60
        stamps.extend(opening + 300 * np.arange(BARS_PER_DAY))
    timestamps = np.array(stamps, dtype=np.int64)
    count = timestamps.size
    signal = np.zeros(count)
    innovation = generator.standard_normal(count) * math.sqrt(1 - 0.9 ** 2)
    for t in range(1, count):
        signal[t] = 0.9 * signal[t - 1] + innovation[t]
    step = np.zeros(count)
    step[1:] = 1.5 * signal[:-1] + generator.normal(0, 1.5, count - 1)
    tick = MNQ.tick_size
    close = np.round((18_000 + np.cumsum(step)) / tick) * tick
    open_ = np.empty(count)
    open_[0] = 18_000.0
    open_[1:] = close[:-1] + tick * generator.integers(-1, 2, count - 1)
    high = np.maximum(open_, close) + tick * generator.integers(0, 5, count)
    low = np.minimum(open_, close) - tick * generator.integers(0, 5, count)
    volume = generator.integers(50, 2_000, count).astype(np.float64)
    matrix = np.column_stack([
        signal, np.r_[np.nan, signal[:-1]], generator.standard_normal(count), generator.standard_normal(count),
    ]).astype(np.float32)
    matrix[:30] = np.nan
    raw = (matrix * 2.0 + 10.0).astype(np.float32)
    data = MarketData(timestamps, open_, high, low, close, volume)
    return data, FeatureSet(matrix, list(FEATURE_NAMES), raw=raw)


@dataclass
class Made:
    key: str
    name: str
    directory: Path
    engine: CycleEngine


def make_run(root: Path, name: str, key: str, overrides: dict, market) -> Made:
    data, features = market
    parameters = {**default_parameters(key), **overrides}
    model_id = f"cycle_explain_trees_{name}"
    directory = root / model_id
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=model_id, model_family=key, model_parameters=parameters,
        artifact_directory=str(directory), train_days=21, validation_fraction=0.2, test_days=7, step_days=0,
        fold_limit=2, expanding_window=False, label_horizon_bars=HORIZON, label_threshold_ticks=1.0, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1, tuning_trials=0, tuning_mode="reviewed_defaults",
        bars_per_second=0.0, start_paused=False, quiet_bars=True, log_every_batches=100, device="cpu", seed=42,
        land_in_lake=False,
    )
    engine = CycleEngine(settings, data, features, MNQ,
                         lambda values, task="classification": build_adapter(key, values, "cpu", 42, task=task),
                         control=ControlState(0.0, False))
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(protocol, "emit", lambda event: None)
        engine.run()
    return Made(key, name, directory, engine)


# name -> (registry key, parameter overrides): small, so the module runs in about a minute
RUNS: dict[str, tuple[str, dict]] = {
    # a high learning rate and short patience so early stopping leaves trees after the best round
    "xgboost": ("xgboost", {"boosting_rounds": 150, "early_stopping_rounds": 8, "max_depth": 3, "learning_rate": 0.3}),
    "lightgbm": ("lightgbm", {"boosting_rounds": 120, "early_stopping_rounds": 10, "leaf_count": 7}),
    "random_forest": ("random_forest", {"tree_count": 24, "max_depth": 4}),
    "extra_trees": ("extra_trees", {"tree_count": 24, "max_depth": 4}),
    "classification_and_regression_tree": ("classification_and_regression_tree", {"max_depth": 4}),
    "decision_tree_classifier": ("decision_tree_classifier", {}),
    "gradient_boosting_machine": ("gradient_boosting_machine", {"boosting_rounds": 60, "early_stopping_rounds": 10}),
    "catboost": ("catboost", {"boosting_rounds": 80, "early_stopping_rounds": 15, "max_depth": 4}),
}


@pytest.fixture(scope="module")
def market():
    return synthetic_market()


@pytest.fixture(scope="module")
def runs(market, tmp_path_factory) -> dict[str, Made]:
    root = tmp_path_factory.mktemp("cycle_explain_tree_runs")
    return {name: make_run(root, name, key, overrides, market) for name, (key, overrides) in RUNS.items()}


@pytest.fixture(scope="module")
def explainer() -> Explainer:
    return Explainer()


def rows_tested(explainer: Explainer, made: Made, fold: int, role: str = "direction") -> list[int]:
    context = explainer.context(str(made.directory), fold, role)
    return [int(row) for row in context.index["test"] if context.valid(int(row))]


def timestamp_of(made: Made, row: int) -> int:
    return int(made.engine.data.timestamps[row])


def load_verify_script():
    specification = importlib.util.spec_from_file_location("verify_cycle_explain", VERIFY_SCRIPT)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


# ═══ the dispatch ══════════════════════════════════════════════════════════


@pytest.mark.parametrize("kind", ["trees", "oblivious_trees"])
def test_both_tree_kinds_have_the_module_with_the_whole_contract(kind):
    module = kind_module(kind)
    assert module is tree_module
    for function in ("structure_block", "bar_block", "tree", "check"):
        assert callable(getattr(module, function)), function


def test_every_runnable_tree_model_is_covered_here():
    from cycle import catalog

    tree_keys = {key for key, entry in catalog.registry()["models"].items()
                 if entry["explainKind"] in ("trees", "oblivious_trees") and entry["runnable"]}
    assert tree_keys <= {key for key, _ in RUNS.values()}


# ═══ the gates, on every sampled bar of every fold and role ════════════════


@pytest.mark.parametrize("name", list(RUNS))
def test_the_gates_pass_on_every_sampled_bar(runs, name):
    verify = load_verify_script()
    summary = verify.verify_run(runs[name].directory, bars=BARS_SAMPLED, seed=7, schema=False)
    assert summary["passed"] is True, summary["failures"] or summary["errors"]
    explained = 2 * 2 * BARS_SAMPLED      # folds x roles x bars
    gates = summary["gates"]
    assert gates["G1"]["failed"] == 0 and gates["G1"]["passed"] == explained and gates["G1"]["maximumError"] <= 1e-12
    assert gates["G2"]["failed"] == 0 and gates["G2"]["passed"] == explained and gates["G2"]["maximumError"] <= 1e-6
    assert gates["G3"]["failed"] == 0 and gates["G3"]["passed"] == explained and gates["G3"]["maximumError"] == 0.0
    print(f"\n{name}: G1 max {gates['G1']['maximumError']!r}, G2 max {gates['G2']['maximumError']!r}, "
          f"G3 max {gates['G3']['maximumError']!r}")


@pytest.mark.parametrize("name", list(RUNS))
@pytest.mark.parametrize("role", ["direction", "price"])
def test_the_running_total_ends_at_the_raw_output_and_paths_end_at_the_leaves(runs, explainer, name, role):
    made = runs[name]
    structure = explainer.structure(str(made.directory), 1, role)
    trees = structure["trees"]
    assert structure["explainKind"] == ("oblivious_trees" if name == "catboost" else "trees")
    assert trees["oblivious"] is (name == "catboost")
    assert trees["splitRule"] == {"xgboost": "less_than", "catboost": "greater_than"}.get(name, "less_or_equal")
    forest = name in ("random_forest", "extra_trees", "classification_and_regression_tree", "decision_tree_classifier")
    assert trees["aggregation"] == ("mean" if forest else "sum")
    assert (structure["baseValue"] is None) is forest
    assert sum(trees["depthHistogram"]) == trees["usedTreeCount"] and len(trees["depthHistogram"]) == trees["maxDepth"] + 1
    assert all(usage["splitCount"] > 0 for usage in trees["featureUsage"])
    for row in rows_tested(explainer, made, 1, role)[::97]:
        bar = explainer.explain(str(made.directory), 1, role, timestamp_of(made, row))
        block = bar["trees"]
        used = trees["usedTreeCount"]
        assert len(block["leafValues"]) == len(block["runningTotal"]) == len(block["leafNode"]) == used
        assert len(block["pathOffsets"]) == used + 1 and block["pathOffsets"][-1] == len(block["pathNode"])
        assert block["runningTotal"][-1] == pytest.approx(bar["output"]["raw"], abs=1e-12)
        if forest:
            assert block["baseValue"] == 0.0
            assert block["runningTotal"][0] == block["leafValues"][0]
        else:
            assert block["runningTotal"][0] == pytest.approx(block["baseValue"] + block["leafValues"][0], abs=1e-12)
        if role == "price":
            assert bar["link"] == "identity" and bar["output"]["raw"] == pytest.approx(bar["output"]["targetUnits"], abs=1e-6)
        text = encode({"id": "x", "ok": True, "result": bar})
        assert "NaN" not in text and "Infinity" not in text


# ═══ xgboost: the best round, the base score ═══════════════════════════════


def test_xgboost_counts_only_the_trees_up_to_its_best_round(runs, explainer):
    import xgboost as xgb

    made = runs["xgboost"]
    context = explainer.context(str(made.directory), 0, "direction")
    adapter = context.explained_adapter
    booster = adapter.booster
    structure = explainer.structure(str(made.directory), 0, "direction")
    trees = structure["trees"]
    assert trees["usedTreeCount"] == adapter.best_iteration + 1
    assert trees["treeCount"] == booster.num_boosted_rounds() > trees["usedTreeCount"], \
        "early stopping must leave trees after the best round for this test to mean anything"
    assert trees["learningRate"] == pytest.approx(0.3, abs=1e-7)
    row = rows_tested(explainer, made, 0)[40]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    x = context.features[row:row + 1].astype(np.float32)
    used_range = (0, adapter.best_iteration + 1)
    np.testing.assert_array_equal(bar["trees"]["leafNode"],
                                  booster.predict(xgb.DMatrix(x), pred_leaf=True, iteration_range=used_range)[0])
    margin = float(booster.predict(xgb.DMatrix(x), output_margin=True, iteration_range=used_range)[0])
    assert bar["output"]["raw"] == pytest.approx(margin, abs=1e-7)
    whole = float(booster.predict(xgb.DMatrix(x), output_margin=True)[0])
    assert abs(whole - margin) > 1e-6, "the trees after the best round change the margin; they must not be counted"
    assert 1 / (1 + math.exp(-bar["output"]["raw"])) == pytest.approx(bar["engineReload"], abs=1e-7)
    # the base: the library's base score as a margin, and what the bar's leaves leave over
    configuration = json.loads(booster.save_config())
    base_score = float(configuration["learner"]["learner_model_param"]["base_score"].strip("[]"))
    assert structure["baseValue"] == pytest.approx(math.log(base_score / (1 - base_score)), abs=1e-12)
    assert bar["trees"]["baseValue"] == pytest.approx(structure["baseValue"], abs=1e-6)
    # the leaf values are the dump's leaves
    dump = [json.loads(text) for text in booster.get_dump(dump_format="json")]

    def leaf_value(node, leaf):
        if node["nodeid"] == leaf:
            return node["leaf"]
        for child in node.get("children", []):
            found = leaf_value(child, leaf)
            if found is not None:
                return found
        return None

    for t, leaf in enumerate(bar["trees"]["leafNode"]):
        assert bar["trees"]["leafValues"][t] == pytest.approx(leaf_value(dump[t], leaf), abs=1e-7)


def test_xgboost_price_model_explains_in_target_units(runs, explainer):
    made = runs["xgboost"]
    context = explainer.context(str(made.directory), 0, "price")
    booster = context.explained_adapter.booster
    configuration = json.loads(booster.save_config())
    structure = explainer.structure(str(made.directory), 0, "price")
    assert structure["link"] == "identity"
    assert structure["baseValue"] == pytest.approx(
        float(configuration["learner"]["learner_model_param"]["base_score"].strip("[]")), abs=1e-12)
    row = rows_tested(explainer, made, 0, "price")[12]
    bar = explainer.explain(str(made.directory), 0, "price", timestamp_of(made, row))
    output = bar["output"]
    assert output["raw"] == pytest.approx(output["targetUnits"], abs=1e-12)
    assert sum(bar["trees"]["leafValues"]) + bar["trees"]["baseValue"] == pytest.approx(output["targetUnits"], abs=1e-9)
    assert output["movePoints"] == pytest.approx(output["targetUnits"] * output["scale"], abs=1e-9)


# ═══ lightgbm, gradient boosting machine, catboost: their bases ════════════


def test_lightgbm_has_no_separate_base_and_uses_its_best_round(runs, explainer):
    made = runs["lightgbm"]
    context = explainer.context(str(made.directory), 0, "direction")
    adapter = context.explained_adapter
    structure = explainer.structure(str(made.directory), 0, "direction")
    assert structure["baseValue"] == 0.0
    assert structure["trees"]["usedTreeCount"] == adapter.best_iteration
    row = rows_tested(explainer, made, 0)[33]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    x = context.features[row:row + 1].astype(np.float32)
    raw = float(adapter.booster.predict(x, raw_score=True, num_iteration=adapter.best_iteration)[0])
    assert bar["output"]["raw"] == raw
    assert abs(bar["trees"]["baseValue"]) <= 1e-12
    leaf_index = adapter.booster.predict(x, pred_leaf=True, num_iteration=adapter.best_iteration)[0]
    for t, index in enumerate(leaf_index):
        assert adapter.booster.get_leaf_output(t, int(index)) == bar["trees"]["leafValues"][t]


@pytest.mark.parametrize("role", ["direction", "price"])
def test_the_gradient_boosting_machine_starts_from_its_initial_estimator(runs, explainer, role):
    made = runs["gradient_boosting_machine"]
    context = explainer.context(str(made.directory), 0, role)
    adapter = context.explained_adapter
    estimator = adapter.estimator
    structure = explainer.structure(str(made.directory), 0, role)
    trees = structure["trees"]
    assert trees["usedTreeCount"] == adapter.best_iteration == len(estimator.estimators_)
    assert trees["learningRate"] == estimator.learning_rate
    rows = rows_tested(explainer, made, 0, role)
    x = context.features[rows[:1]].astype(np.float32)
    init = float(estimator._raw_predict_init(x)[0, 0])
    assert structure["baseValue"] == init
    if role == "direction":
        # the prior: the log-odds of the training bars' up share
        up_share = float(np.mean(context.labels[adapter.training_rows] >= 0.5))
        assert init == pytest.approx(math.log(up_share / (1 - up_share)), abs=1e-12)
    bar = explainer.explain(str(made.directory), 0, role, timestamp_of(made, rows[20]))
    x = context.features[rows[20]:rows[20] + 1].astype(np.float64)
    raw = estimator.decision_function(x)[0] if role == "direction" else estimator.predict(x)[0]
    assert bar["output"]["raw"] == raw
    assert bar["trees"]["baseValue"] == pytest.approx(init, abs=1e-12)
    for t, leaf in enumerate(bar["trees"]["leafNode"]):
        tree = estimator.estimators_[t, 0].tree_
        assert bar["trees"]["leafValues"][t] == estimator.learning_rate * tree.value[leaf, 0, 0]


def test_catboost_base_is_its_bias_and_its_leaf_index_spells_the_answers_lowest_level_first(runs, explainer):
    made = runs["catboost"]
    context = explainer.context(str(made.directory), 0, "direction")
    model = context.explained_adapter.model
    structure = explainer.structure(str(made.directory), 0, "direction")
    scale, bias = model.get_scale_and_bias()
    assert structure["baseValue"] == pytest.approx(float(np.ravel(bias)[0]), abs=0)
    assert structure["trees"]["treeCount"] == structure["trees"]["usedTreeCount"] == model.tree_count_
    ensemble = tree_module.ensemble(context)
    lowest_first = highest_first = 0
    checked = 0
    for row in rows_tested(explainer, made, 0)[:200]:
        x = context.features[row:row + 1].astype(np.float32)
        library = model.calc_leaf_indexes(x)[0]
        for t, oblivious in enumerate(ensemble.oblivious_trees):
            bits = [bool(np.float32(x[0, f]) > np.float32(border)) for f, border in zip(oblivious.features, oblivious.borders)]
            depth = len(bits)
            lowest_first += sum(bit << d for d, bit in enumerate(bits)) == library[t]
            highest_first += sum(bit << (depth - 1 - d) for d, bit in enumerate(bits)) == library[t]
            checked += 1
    # what was found: bit d (the model's d-th split, catboost's own order) is worth 2^d, every time;
    # read the other way round the answers would name the wrong leaf for most bars
    assert lowest_first == checked
    assert highest_first < checked
    row = rows_tested(explainer, made, 0)[9]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    raw = float(model.predict(context.features[row:row + 1].astype(np.float32), prediction_type="RawFormulaVal")[0])
    assert bar["output"]["raw"] == raw
    assert bar["trees"]["baseValue"] == pytest.approx(float(np.ravel(bias)[0]), abs=1e-9)
    offsets = bar["trees"]["pathOffsets"]
    for t, leaf in enumerate(bar["trees"]["leafNode"]):
        answers = bar["trees"]["pathWentLeft"][offsets[t]:offsets[t + 1]]
        assert sum(int(answer) << d for d, answer in enumerate(answers)) == leaf
        assert bar["trees"]["pathNode"][offsets[t]:offsets[t + 1]] == list(range(len(answers)))


# ═══ forests: P(up) in the column of the up class ══════════════════════════


@pytest.mark.parametrize("name", ["random_forest", "extra_trees", "classification_and_regression_tree",
                                  "decision_tree_classifier"])
def test_each_tree_votes_its_share_of_up_bars_in_the_up_column(runs, explainer, name):
    made = runs[name]
    context = explainer.context(str(made.directory), 0, "direction")
    adapter = context.explained_adapter
    estimator = adapter.model if name == "random_forest" else adapter.estimator
    members = getattr(estimator, "estimators_", [estimator])
    up = list(estimator.classes_).index(1)
    row = rows_tested(explainer, made, 0)[15]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    x = context.features[row:row + 1].astype(np.float32)
    for t, member in enumerate(members):
        assert bar["trees"]["leafValues"][t] == member.predict_proba(x)[0, up]
    assert bar["output"]["raw"] == pytest.approx(estimator.predict_proba(x)[0, up], abs=1e-12)
    assert bar["output"]["raw"] == bar["engineReload"]
    running = np.cumsum(bar["trees"]["leafValues"]) / np.arange(1, len(members) + 1)
    np.testing.assert_allclose(bar["trees"]["runningTotal"], running, rtol=0, atol=1e-15)
    structure = explainer.structure(str(made.directory), 0, "direction")
    assert structure["link"] == "mean_probability" and structure["trees"]["learningRate"] is None
    importances = sum(member.tree_.compute_feature_importances(normalize=False) for member in members)
    for usage in structure["trees"]["featureUsage"]:
        assert usage["totalGain"] == pytest.approx(importances[usage["featureIndex"]], rel=1e-12)


def test_the_up_column_follows_classes_order_not_position():
    """A tree whose up class (1) is its FIRST class: P(up) is read from column 0."""
    from sklearn.tree import DecisionTreeClassifier

    generator = np.random.default_rng(3)
    x = generator.standard_normal((400, 3)).astype(np.float32)
    labels = np.where(x[:, 0] + 0.3 * generator.standard_normal(400) > 0, 1, 2)      # 1 = up, 2 = the other class
    estimator = DecisionTreeClassifier(max_depth=3, random_state=0).fit(x, labels)
    assert list(estimator.classes_) == [1, 2]
    ensemble = tree_module.ScikitLearnTrees(estimator, "classification")
    assert ensemble.column == 0
    leaf = ensemble.leaves(x[7])
    assert ensemble.leaf_value(0, int(leaf[0])) == estimator.predict_proba(x[7:8])[0, 0]
    assert ensemble.trees[0].value[0] == pytest.approx(np.mean(labels == 1), abs=1e-12)


# ═══ whole trees ═══════════════════════════════════════════════════════════


@pytest.mark.parametrize("name", list(RUNS))
def test_a_whole_tree_agrees_with_the_bars_path_and_passes_its_schema(runs, explainer, name, tmp_path):
    made = runs[name]
    role = "direction"
    structure = explainer.structure(str(made.directory), 0, role)
    row = rows_tested(explainer, made, 0)[3]
    bar = explainer.explain(str(made.directory), 0, role, timestamp_of(made, row))
    samples = []
    for t in sorted({0, structure["trees"]["usedTreeCount"] - 1}):
        drawn = explainer.tree(str(made.directory), 0, role, t)
        samples.append(("tree", f"{name} tree {t}", drawn))
        assert drawn["treeIndex"] == t and drawn["splitRule"] == structure["trees"]["splitRule"]
        leaf = bar["trees"]["leafNode"][t]
        steps = range(bar["trees"]["pathOffsets"][t], bar["trees"]["pathOffsets"][t + 1])
        if structure["trees"]["oblivious"]:
            levels = drawn["obliviousLevels"]
            assert drawn["nodes"]["left"] == [] and len(drawn["obliviousLeafValues"]) == 2 ** len(levels)
            assert [level["feature"] for level in levels] == [bar["trees"]["pathFeature"][s] for s in steps]
            assert [level["threshold"] for level in levels] == [bar["trees"]["pathThreshold"][s] for s in steps]
            assert drawn["obliviousLeafValues"][leaf] == bar["trees"]["leafValues"][t]
            continue
        nodes = drawn["nodes"]
        count = len(nodes["left"])
        assert all(len(nodes[column]) == count for column in nodes)
        assert drawn["obliviousLevels"] is None and drawn["obliviousLeafValues"] is None
        assert nodes["value"][leaf] == bar["trees"]["leafValues"][t]
        assert nodes["feature"][leaf] == -1 and nodes["left"][leaf] == -1 and nodes["threshold"][leaf] is None
        node = 0
        for s in steps:
            assert bar["trees"]["pathNode"][s] == node
            assert nodes["feature"][node] == bar["trees"]["pathFeature"][s]
            assert nodes["threshold"][node] == bar["trees"]["pathThreshold"][s]
            assert nodes["depth"][node] == s - bar["trees"]["pathOffsets"][t]
            node = nodes["left"][node] if bar["trees"]["pathWentLeft"][s] else nodes["right"][node]
        assert node == leaf
        internal = [i for i in range(count) if nodes["left"][i] >= 0]
        assert all(nodes["missingGoesLeft"][i] is not None for i in internal)
        assert max(nodes["depth"]) <= structure["trees"]["maxDepth"] or t >= structure["trees"]["usedTreeCount"]
    with pytest.raises(ExplainError, match="there is no tree"):
        explainer.tree(str(made.directory), 0, role, structure["trees"]["treeCount"])
    result = load_verify_script().zod_validate(samples, tmp_path / "zod")
    if result is None:
        pytest.skip("node and the repository's tsx are needed to load the zod schemas")
    assert result["failures"] == []


# ═══ fixtures for the zod test ═════════════════════════════════════════════


def fixture_samples(runs, explainer) -> list[tuple[str, str, dict]]:
    """One structure and one bar per model (direction), and the price replies of xgboost and the random forest."""
    samples = []
    for name, made in runs.items():
        for role in ("direction", "price") if name in ("xgboost", "random_forest") else ("direction",):
            suffix = "" if role == "direction" else "_price"
            row = rows_tested(explainer, made, 0, role)[8]
            samples.append(("structure", f"structure_trees_{name}{suffix}", explainer.structure(str(made.directory), 0, role)))
            samples.append(("bar", f"bar_trees_{name}{suffix}",
                            explainer.explain(str(made.directory), 0, role, timestamp_of(made, row))))
    return samples


def portable(value, run_directories: list[Path]):
    text = json.dumps(value, allow_nan=False)
    for directory in run_directories:
        text = text.replace(json.dumps(str(directory))[1:-1], "data/models/" + directory.name)
    return json.loads(text)


def test_the_replies_are_schema_valid_and_match_the_fixtures(runs, explainer, tmp_path):
    directories = [made.directory for made in runs.values()]
    samples = [(kind, label, portable(value, directories)) for kind, label, value in fixture_samples(runs, explainer)]
    if os.environ.get("CYCLE_EXPLAIN_WRITE_FIXTURES") == "1":
        FIXTURES.mkdir(parents=True, exist_ok=True)
        for _, label, value in samples:
            (FIXTURES / f"{label}.json").write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    result = load_verify_script().zod_validate(samples, tmp_path / "zod")
    if result is None:
        pytest.skip("node and the repository's tsx are needed to load the zod schemas")
    assert result["failures"] == []
    for _, label, value in samples:
        path = FIXTURES / f"{label}.json"
        assert path.is_file(), f"{path} is missing: run with CYCLE_EXPLAIN_WRITE_FIXTURES=1"
        committed = json.loads(path.read_text(encoding="utf-8"))
        assert sorted(committed) == sorted(value), label
        assert (committed["trees"] is None) is False, label
