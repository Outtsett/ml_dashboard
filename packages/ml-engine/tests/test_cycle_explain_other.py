"""The neighbors, naive Bayes, support vector, calibration and stacking
explainers (``packages/ml-engine/src/cycle/explain/{neighbors,probabilistic,composite}.py``)
against real Model Cycle runs.

Small runs are made in-process on the synthetic MNQ-like 5-minute market of
``tests/test_cycle_explain_core.py`` (copied): each registry model through its
real adapter (``cycle.sklearn_adapter``), on CPU, two folds, with its price
model where it has one. Then, through the in-process explainer:

- every structure and bar carries its kind's block, schema-shaped and NaN-free;
- the verify script's gates pass on every sampled test bar: G1 (the reloaded
  model reproduces what the engine streamed, 1e-12) and G2 (the kind's
  decomposition adds up to the model's output, 1e-6);
- what the blocks say is what the fitted estimator holds: neighbors and
  support vectors are real training rows at their timestamps, the naive Bayes
  priors / means / variances are the fitted ones in [down, up] order, the
  calibration map is sampled over the validation scores in the calibrator's
  own units, the stack's base answers are what its meta-learner reads;
- one reply of each kind is written to ``tests/fixtures/cycle_explain/``
  (``CYCLE_EXPLAIN_WRITE_FIXTURES=1``) and parsed with the zod schemas.
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
from cycle.explain import KIND_MODULES, kind_module
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
SUPPORT_VECTOR_CAP = 700


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
    model_id = f"cycle_explain_{name}"
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


# name -> (registry key, parameter overrides, the fixture label its replies are written under)
RUNS: dict[str, tuple[str, dict, str]] = {
    "neighbors": ("k_nearest_neighbors", {}, "neighbors"),
    "neighbors_uniform": ("k_nearest_neighbors", {"neighbor_count": 7, "neighbor_weighting": "uniform"}, ""),
    "naive_bayes": ("naive_bayes", {}, "naive_bayes"),
    "support_vectors": ("support_vector_machine", {"maximum_training_bars": SUPPORT_VECTOR_CAP}, "support_vectors"),
    "support_vectors_polynomial": ("support_vector_machine",
                                   {"kernel": "poly", "kernel_scale_rule": "auto", "maximum_training_bars": 400}, ""),
    "calibration": ("calibrated_classifier", {}, "calibration"),
    "calibration_isotonic": ("calibrated_classifier",
                             {"base_model": "naive_bayes", "calibration_method": "isotonic"}, "calibration_isotonic"),
    "stacking": ("stacked_generalization", {"tree_count": 30, "max_depth": 3, "stacking_folds": 3}, "stacking"),
}


@pytest.fixture(scope="module")
def market():
    return synthetic_market()


@pytest.fixture(scope="module")
def runs(market, tmp_path_factory) -> dict[str, Made]:
    root = tmp_path_factory.mktemp("cycle_explain_other_runs")
    return {name: make_run(root, name, key, overrides, market) for name, (key, overrides, _) in RUNS.items()}


@pytest.fixture(scope="module")
def explainer() -> Explainer:
    return Explainer()


def rows_tested(explainer: Explainer, made: Made, fold: int) -> list[int]:
    context = explainer.context(str(made.directory), fold, "direction")
    return [int(row) for row in context.index["test"] if context.valid(int(row))]


def timestamp_of(made: Made, row: int) -> int:
    return int(made.engine.data.timestamps[row])


def roles(made: Made) -> tuple[str, ...]:
    manifest = json.loads((made.directory / "explain" / "manifest.json").read_text(encoding="utf-8"))
    return ("direction", "price") if manifest["hasPriceModel"] else ("direction",)


def load_verify_script():
    specification = importlib.util.spec_from_file_location("verify_cycle_explain", VERIFY_SCRIPT)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


# ═══ the dispatch ══════════════════════════════════════════════════════════


@pytest.mark.parametrize("kind", ["neighbors", "naive_bayes", "support_vectors", "calibration", "stacking"])
def test_each_kind_has_a_module_with_the_whole_contract(kind):
    module = kind_module(kind)
    assert module is not None, KIND_MODULES[kind]
    for function in ("structure_block", "bar_block", "check"):
        assert callable(getattr(module, function)), f"{kind}: {function}"


# ═══ the gates, on every sampled test bar ══════════════════════════════════


@pytest.mark.parametrize("name", list(RUNS))
def test_the_gates_pass_on_every_sampled_bar(runs, name):
    verify = load_verify_script()
    made = runs[name]
    summary = verify.verify_run(made.directory, bars=25, seed=11, schema=False)
    assert summary["passed"] is True, summary["failures"] or summary["errors"]
    role_count = len(roles(made))
    assert summary["gates"]["G1"] == {**summary["gates"]["G1"], "failed": 0, "skipped": 0, "passed": 2 * role_count * 25}
    assert summary["gates"]["G1"]["maximumError"] <= 1e-12
    assert summary["gates"]["G2"]["failed"] == 0 and summary["gates"]["G2"]["passed"] == 2 * role_count * 25
    assert summary["gates"]["G2"]["maximumError"] <= 1e-6
    print(f"\n{name}: G1 max {summary['gates']['G1']['maximumError']!r}, G2 max {summary['gates']['G2']['maximumError']!r}")


# ═══ k-nearest neighbors ═══════════════════════════════════════════════════


@pytest.mark.parametrize("role", ["direction", "price"])
def test_the_neighbors_are_real_training_bars_and_their_vote_is_the_output(runs, explainer, role):
    made = runs["neighbors"]
    context = explainer.context(str(made.directory), 1, role)
    estimator = context.explained_adapter.estimator
    structure = explainer.structure(str(made.directory), 1, role)
    assert structure["link"] == ("vote" if role == "direction" else "identity")
    assert structure["neighbors"] == {"neighborCount": 50, "weighting": "distance",
                                      "trainingBarCount": int(context.explained_adapter.training_rows.size)}
    row = rows_tested(explainer, made, 1)[31]
    bar = explainer.explain(str(made.directory), 1, role, timestamp_of(made, row))
    block = bar["neighbors"]
    k = 50
    assert len(block["timestamps"]) == len(block["distances"]) == len(block["targets"]) == len(block["weights"]) == 75
    # the first k are exactly the neighbors predict uses, closest first
    matrix, scaled = context.model_inputs([row])
    assert scaled is True
    distances, positions = estimator.kneighbors(matrix, n_neighbors=k)
    np.testing.assert_array_equal(block["distances"][:k], distances[0])
    assert block["distances"] == sorted(block["distances"])
    # each neighbor is a training row: its timestamp's inputs are the fitted row, at the stated distance
    stamp_to_row = {int(t): i for i, t in enumerate(made.engine.data.timestamps)}
    neighbor_rows = np.array([stamp_to_row[t] for t in block["timestamps"]])
    assert set(neighbor_rows.tolist()) <= set(context.explained_adapter.training_rows.tolist())
    assert all(t < bar["timestamp"] for t in block["timestamps"])
    fitted, _ = context.model_inputs(neighbor_rows)
    np.testing.assert_array_equal(estimator._fit_X[positions[0]], fitted[:k])
    np.testing.assert_allclose(block["distances"], np.linalg.norm(fitted - matrix, axis=1), rtol=0, atol=1e-9)
    # weights: 1 / distance; targets: what those bars did
    np.testing.assert_allclose(block["weights"], 1.0 / np.array(block["distances"]), rtol=1e-15)
    if role == "direction":
        np.testing.assert_array_equal(block["targets"], (context.labels[neighbor_rows] >= 0.5).astype(float))
    else:
        low, high = context.explained_adapter.target_clip
        np.testing.assert_allclose(block["targets"], np.clip(context.price_target[neighbor_rows], low, high),
                                   rtol=0, atol=1e-6)
    weights, targets = np.array(block["weights"][:k]), np.array(block["targets"][:k])
    vote = float(weights @ targets / weights.sum())
    assert vote == pytest.approx(bar["output"]["raw"], abs=1e-12)
    assert vote == pytest.approx(bar["engineReload"], abs=1e-12)


def test_uniform_neighbors_each_weigh_one(runs, explainer):
    made = runs["neighbors_uniform"]
    structure = explainer.structure(str(made.directory), 0, "direction")
    assert structure["neighbors"]["neighborCount"] == 7 and structure["neighbors"]["weighting"] == "uniform"
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, rows_tested(explainer, made, 0)[5]))
    assert len(bar["neighbors"]["weights"]) == 14 and set(bar["neighbors"]["weights"]) == {1.0}
    assert bar["output"]["raw"] == pytest.approx(sum(bar["neighbors"]["targets"][:7]) / 7, abs=1e-15)


def test_a_neighbor_at_distance_zero_takes_the_whole_vote(runs, explainer):
    """scikit-learn's rule: when the bar IS a training bar, it alone votes."""
    from cycle.explain import neighbors

    made = runs["neighbors"]
    context = explainer.context(str(made.directory), 0, "direction")
    training_row = int(context.explained_adapter.training_rows[100])
    block = neighbors.bar_block(context, training_row)
    assert block["neighbors"]["distances"][0] == 0.0
    assert block["neighbors"]["timestamps"][0] == timestamp_of(made, training_row)
    weights = np.asarray(block["neighbors"]["weights"])
    assert weights[0] == 1.0 and np.all(weights[np.asarray(block["neighbors"]["distances"]) > 0] == 0.0)
    assert block["output"]["raw"] == float(context.labels[training_row] >= 0.5)


# ═══ naive Bayes ═══════════════════════════════════════════════════════════


def test_naive_bayes_lists_the_fitted_priors_and_curves_down_then_up(runs, explainer):
    made = runs["naive_bayes"]
    context = explainer.context(str(made.directory), 0, "direction")
    estimator = context.explained_adapter.estimator
    down, up = list(estimator.classes_).index(0), list(estimator.classes_).index(1)
    structure = explainer.structure(str(made.directory), 0, "direction")
    block = structure["naiveBayes"]
    assert structure["link"] == "posterior"
    assert block["logPriors"] == [math.log(estimator.class_prior_[down]), math.log(estimator.class_prior_[up])]
    assert math.exp(block["logPriors"][0]) + math.exp(block["logPriors"][1]) == pytest.approx(1.0, abs=1e-12)
    assert structure["baseValue"] == pytest.approx(block["logPriors"][1] - block["logPriors"][0], abs=1e-15)
    np.testing.assert_array_equal(np.array(block["means"]), estimator.theta_[[down, up]].T)
    np.testing.assert_array_equal(np.array(block["variances"]), estimator.var_[[down, up]].T)
    # the up class's mean of the planted signal is above the down class's
    assert block["means"][0][1] > block["means"][0][0]
    row = rows_tested(explainer, made, 0)[40]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    contributions = bar["contributions"]
    assert contributions["base"] == structure["baseValue"] and len(contributions["values"]) == len(FEATURE_NAMES)
    assert bar["inputs"]["scaled"] is False
    x = np.array(bar["inputs"]["values"])
    mean_up, mean_down = np.array(block["means"])[:, 1], np.array(block["means"])[:, 0]
    variance_up, variance_down = np.array(block["variances"])[:, 1], np.array(block["variances"])[:, 0]
    # the planted signal's evidence is the log ratio of the two bell curves' heights at this bar's value
    from scipy.stats import norm

    expected = norm.logpdf(x, mean_up, np.sqrt(variance_up)) - norm.logpdf(x, mean_down, np.sqrt(variance_down))
    np.testing.assert_allclose(contributions["values"], expected, rtol=0, atol=1e-12)
    total = contributions["base"] + sum(contributions["values"])
    assert total == pytest.approx(bar["output"]["raw"], abs=1e-12)
    assert 1 / (1 + math.exp(-total)) == pytest.approx(bar["output"]["probabilityUp"], abs=1e-12)


# ═══ support vector machines ═══════════════════════════════════════════════


@pytest.mark.parametrize("role", ["direction", "price"])
def test_support_vectors_are_the_capped_recent_training_bars(runs, explainer, role):
    made = runs["support_vectors"]
    context = explainer.context(str(made.directory), 0, role)
    adapter = context.explained_adapter
    svm = adapter.estimator
    fit_rows = adapter.training_rows
    assert fit_rows.size == SUPPORT_VECTOR_CAP
    whole = context.index["train"] if role == "direction" else context.index["price_train"]
    np.testing.assert_array_equal(fit_rows, whole[-SUPPORT_VECTOR_CAP:])
    structure = explainer.structure(str(made.directory), 0, role)
    block = structure["supportVectors"]
    assert block["kernel"] == "radial basis function" and block["trainingBarCount"] == SUPPORT_VECTOR_CAP
    assert block["supportVectorCount"] == len(svm.support_)
    fitted, _ = context.model_inputs(fit_rows)
    assert block["gamma"] == pytest.approx(1.0 / (fitted.shape[1] * fitted.var()), rel=1e-12)
    assert structure["baseValue"] == pytest.approx(float(svm.intercept_[0]), abs=0)
    if role == "direction":
        assert structure["link"] == "logistic_curve" and structure["logisticCurve"] is not None
    row = rows_tested(explainer, made, 0)[17]
    bar = explainer.explain(str(made.directory), 0, role, timestamp_of(made, row))
    vectors = bar["supportVectors"]
    assert len(vectors["contributions"]) == 25
    magnitudes = np.abs(vectors["contributions"])
    assert np.all(np.diff(magnitudes) <= 0)
    np.testing.assert_allclose(vectors["contributions"], np.array(vectors["dualCoefficients"]) *
                               np.array(vectors["kernelValues"]), rtol=1e-15, atol=0)
    # each listed support vector is a fitted training bar, and its kernel value is exp(-gamma |x - v|^2)
    stamp_to_row = {int(t): i for i, t in enumerate(made.engine.data.timestamps)}
    vector_rows = np.array([stamp_to_row[t] for t in vectors["timestamps"]])
    assert set(vector_rows.tolist()) <= set(fit_rows.tolist())
    inputs, _ = context.model_inputs([row])
    vector_inputs, _ = context.model_inputs(vector_rows)
    np.testing.assert_allclose(vectors["kernelValues"],
                               np.exp(-block["gamma"] * np.sum((vector_inputs - inputs) ** 2, axis=1)), rtol=1e-12)
    decision = float(svm.decision_function(inputs)[0]) if role == "direction" else float(svm.predict(inputs)[0])
    assert vectors["decisionValue"] == decision == bar["output"]["raw"]
    closed = vectors["intercept"] + vectors["otherContribution"] + sum(vectors["contributions"])
    assert closed == pytest.approx(decision, abs=1e-9)
    if role == "direction":
        curve = structure["logisticCurve"]
        probability = 1 / (1 + math.exp(-(curve["slope"] * decision + curve["intercept"])))
        assert probability == pytest.approx(bar["output"]["probabilityUp"], abs=1e-12)
    else:
        assert bar["output"]["targetUnits"] == pytest.approx(decision, abs=1e-15)


def test_a_polynomial_kernel_carries_its_gamma_in_full_words(runs, explainer):
    made = runs["support_vectors_polynomial"]
    structure = explainer.structure(str(made.directory), 1, "direction")
    assert structure["supportVectors"]["kernel"] == "polynomial"
    assert structure["supportVectors"]["gamma"] == pytest.approx(1.0 / len(FEATURE_NAMES), rel=1e-15)
    assert structure["supportVectors"]["trainingBarCount"] == 400


# ═══ calibrated classifier ═════════════════════════════════════════════════


@pytest.mark.parametrize(("name", "method", "base_model", "score_is_probability"), [
    ("calibration", "sigmoid", "gradient boosting machine", False),
    ("calibration_isotonic", "isotonic", "naive bayes", True),
])
def test_the_calibration_map_is_sampled_in_the_units_it_takes(runs, explainer, name, method, base_model,
                                                                score_is_probability):
    made = runs[name]
    context = explainer.context(str(made.directory), 1, "direction")
    adapter = context.explained_adapter
    structure = explainer.structure(str(made.directory), 1, "direction")
    assert structure["link"] == "calibration_map"
    block = structure["calibration"]
    assert block["method"] == method and block["baseModel"] == base_model
    scores, probabilities = np.array(block["curve"]["baseScore"]), np.array(block["curve"]["probabilityUp"])
    assert scores.size >= 50 and scores.size == probabilities.size and np.all(np.diff(scores) > 0)
    assert np.all((probabilities >= 0) & (probabilities <= 1))
    # sampled over the validation bars' scores, in the calibrator's own units
    base = adapter.estimator.calibrated_classifiers_[0].estimator
    np.testing.assert_array_equal(adapter.calibration_rows, context.index["validation"])
    validation_inputs, _ = context.model_inputs(adapter.calibration_rows)
    if score_is_probability:
        validation_scores = base.predict_proba(validation_inputs)[:, 1]
    else:
        validation_scores = base.decision_function(validation_inputs)
        assert validation_scores.min() < 0 or validation_scores.max() > 1, "a decision value, not a probability"
    assert scores[0] == validation_scores.min() and scores[-1] == validation_scores.max()
    calibrator = adapter.estimator.calibrated_classifiers_[0].calibrators[0]
    np.testing.assert_allclose(probabilities, calibrator.predict(scores), rtol=0, atol=0)
    row = rows_tested(explainer, made, 1)[12]
    bar = explainer.explain(str(made.directory), 1, "direction", timestamp_of(made, row))
    point = bar["calibration"]
    inputs, _ = context.model_inputs([row])
    expected_score = base.predict_proba(inputs)[0, 1] if score_is_probability else base.decision_function(inputs)[0]
    assert point["baseScore"] == float(expected_score) == bar["output"]["raw"]
    assert point["probabilityUp"] == bar["output"]["probabilityUp"] == bar["engineReload"]
    if method == "sigmoid":
        assert 0.0 < point["probabilityUp"] < 1.0
        # the drawn map read at this bar's score (straight lines between samples) lands on its P(up)
        assert np.interp(point["baseScore"], scores, probabilities) == pytest.approx(point["probabilityUp"], abs=5e-3)
    else:
        # an isotonic map is piecewise linear through its own breakpoints, all of which are sampled
        if scores[0] <= point["baseScore"] <= scores[-1]:
            assert np.interp(point["baseScore"], scores, probabilities) == pytest.approx(point["probabilityUp"],
                                                                                         abs=1e-12)


# ═══ stacking ══════════════════════════════════════════════════════════════


@pytest.mark.parametrize("role", ["direction", "price"])
def test_the_stack_shows_each_base_answer_and_the_meta_weights(runs, explainer, role):
    made = runs["stacking"]
    context = explainer.context(str(made.directory), 0, role)
    stack = context.explained_adapter.estimator
    structure = explainer.structure(str(made.directory), 0, role)
    block = structure["stacking"]
    first = "logistic regression" if role == "direction" else "ridge regression"
    assert [model["name"] for model in block["baseModels"]] == [first, "random forest", "gradient boosting"]
    assert all("_" not in model["name"] + model["kind"] for model in block["baseModels"])
    kinds = [model["kind"] for model in block["baseModels"]]
    assert kinds == (["Logistic regression", "Random forest classifier", "Gradient boosting classifier"]
                     if role == "direction" else ["Ridge", "Random forest regressor", "Gradient boosting regressor"])
    np.testing.assert_array_equal(block["metaCoefficients"], np.ravel(stack.final_estimator_.coef_))
    assert block["metaIntercept"] == structure["baseValue"] == float(np.ravel(stack.final_estimator_.intercept_)[0])
    assert structure["link"] == ("logistic" if role == "direction" else "identity")
    row = rows_tested(explainer, made, 0)[60]
    bar = explainer.explain(str(made.directory), 0, role, timestamp_of(made, row))
    answers = bar["stacking"]["baseOutputs"]
    assert [answer["name"] for answer in answers] == [model["name"] for model in block["baseModels"]]
    inputs, _ = context.model_inputs([row])
    if role == "direction":
        # what the meta-learner reads from each classifier: its P(up)
        for answer, member in zip(answers, stack.estimators_):
            assert answer["value"] == float(member.predict_proba(inputs)[0, 1])
    else:
        for answer, member in zip(answers, stack.estimators_):
            assert answer["value"] == float(member.predict(inputs)[0])
    np.testing.assert_allclose(bar["stacking"]["metaContributions"],
                               np.array(block["metaCoefficients"]) * [a["value"] for a in answers], rtol=0, atol=0)
    total = block["metaIntercept"] + sum(bar["stacking"]["metaContributions"])
    assert total == pytest.approx(bar["output"]["raw"], abs=1e-12)
    if role == "direction":
        assert 1 / (1 + math.exp(-total)) == pytest.approx(bar["output"]["probabilityUp"], abs=1e-12)
    else:
        assert total == pytest.approx(bar["output"]["targetUnits"], abs=1e-12)


# ═══ JSON and the zod schemas ══════════════════════════════════════════════


def schema_samples(runs, explainer) -> tuple[list[tuple[str, str, object]], set[str]]:
    """A structure and a bar of each run and role, labelled for the fixtures,
    and the labels written as fixtures (the runs with a fixture label)."""
    samples: list[tuple[str, str, object]] = []
    fixture_labels: set[str] = set()
    for name, (_, _, label) in RUNS.items():
        made = runs[name]
        row = rows_tested(explainer, made, 0)[8]
        for role in roles(made):
            suffix = "" if role == "direction" else "_price"
            for kind, value in (("structure", explainer.structure(str(made.directory), 0, role)),
                                ("bar", explainer.explain(str(made.directory), 0, role, timestamp_of(made, row)))):
                tagged = f"{kind}_{label or name}{suffix}"
                samples.append((kind, tagged, value))
                if label:
                    fixture_labels.add(tagged)
    return samples, fixture_labels


def test_every_kind_reply_is_nan_free_schema_valid_and_matches_the_fixtures(runs, explainer, tmp_path):
    samples, fixture_labels = schema_samples(runs, explainer)
    blocks = {"neighbors": "neighbors", "naive_bayes": "contributions", "support_vectors": "supportVectors",
              "calibration": "calibration", "stacking": "stacking"}
    structures = {"neighbors": "neighbors", "naive_bayes": "naiveBayes", "support_vectors": "supportVectors",
                  "calibration": "calibration", "stacking": "stacking"}
    for kind, label, value in samples:
        text = encode({"id": "x", "ok": True, "result": value})
        assert "NaN" not in text and "Infinity" not in text, label
        json.dumps(value, allow_nan=False)
        explain_kind = value["explainKind"]
        if kind == "bar":
            assert value[blocks[explain_kind]] is not None, label
        else:
            assert value[structures[explain_kind]] is not None, label
    written = [(kind, label, value) for kind, label, value in samples if label in fixture_labels]
    assert len(written) == 2 * 9   # 6 fixture runs, 3 of them (neighbors, support vectors, stacking) with a price model
    if os.environ.get("CYCLE_EXPLAIN_WRITE_FIXTURES") == "1":
        FIXTURES.mkdir(parents=True, exist_ok=True)
        for _, label, value in written:
            (FIXTURES / f"{label}.json").write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    verify = load_verify_script()
    result = verify.zod_validate(samples, tmp_path / "zod")
    if result is None:
        pytest.skip("node and the repository's tsx are needed to load the zod schemas")
    assert result["failures"] == []
    assert result["counts"] == {"structure": len(samples) // 2, "bar": len(samples) // 2}
    for _, label, value in written:
        path = FIXTURES / f"{label}.json"
        assert path.is_file(), f"{path} is missing: run with CYCLE_EXPLAIN_WRITE_FIXTURES=1"
        committed = json.loads(path.read_text(encoding="utf-8"))
        assert sorted(committed) == sorted(value), label
        assert committed["explainKind"] == value["explainKind"] and committed["role"] == value["role"], label
