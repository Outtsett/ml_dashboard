"""Inside the model for the scikit-learn models built out of other pieces:
support vector machines (``support_vectors``), calibrated classifiers
(``calibration``) and stacked generalization (``stacking``). One module, three
kinds; ``context.explain_kind`` picks the one.

Support vector machine (``SVC`` direction, ``SVR`` price)
    decision value = intercept + Σ_i dual_i × K(support vector_i, x). The
    fitted estimator gives ``support_`` (positions in its fitted matrix, which
    are rows of ``adapter.training_rows``, the capped most recent training
    rows), ``support_vectors_``, ``dual_coef_``, ``intercept_`` (scikit-learn
    already flips both for a two-class ``SVC`` so they add up to its
    ``decision_function``) and the resolved ``_gamma``; the kernel values come
    from ``sklearn.metrics.pairwise.pairwise_kernels`` with the fitted kernel,
    gamma, degree and coef0. The 25 largest |dual × kernel| are listed with
    their timestamps, the rest summed into ``otherContribution``;
    ``decisionValue`` is the library's own ``decision_function`` (``predict``
    for SVR). A direction model's P(up) is the validation logistic curve of
    the decision value (``structure.logisticCurve``); a price model's decision
    value is its forecast (identity).

Calibrated classifier (``CalibratedClassifierCV`` over a frozen base model)
    The base model scores the bar in the units its calibrator takes — the
    library's own rule, ``decision_function`` when the base has one, else
    ``predict_proba`` P(up) (``sklearn.utils._response._get_response_values``,
    what the calibrated classifier calls) — and the calibration map fitted on
    the validation bars turns that score into P(up) (the mean over the fitted
    calibrators; one with a frozen base). ``output.raw`` is the base score.
    The structure samples the map over the validation bars' score range
    (101 points, plus an isotonic map's own breakpoints inside the range).

Stacked generalization (``StackingClassifier`` / ``StackingRegressor``)
    ``transform(x)`` is each base model's answer exactly as the meta-learner
    sees it (``stack_method_``: a classifier's P(up) column, a regressor's
    prediction); the meta-learner's ``coef_`` × answer are the
    ``metaContributions`` and its ``intercept_`` the base value, so
    ``output.raw`` = the meta-learner's ``decision_function`` (direction,
    log-odds) or ``predict`` (price).

``check`` (gate G2, 1e-6):
    support vectors   intercept + Σ listed + other = decisionValue = the
                      library's decision value; the link of it = the output
    calibration       the map at the base score = the model's P(up)
    stacking          link(intercept + Σ metaContributions) = the output, and
                      intercept + Σ = the library's meta decision value
"""

from __future__ import annotations

import math
import re

import numpy as np

from . import NotExplained

G2_TOLERANCE = 1e-6
LISTED_SUPPORT_VECTORS = 25
CALIBRATION_SAMPLES = 101

KERNEL_WORDS = {
    "rbf": "radial basis function",
    "linear": "linear",
    "poly": "polynomial",
    "sigmoid": "sigmoid",
}
# scikit-learn class names whose words read oddly split on capitals
CLASS_WORDS = {
    "SVC": "support vector classifier",
    "SVR": "support vector regressor",
    "MLPClassifier": "multilayer perceptron classifier",
    "MLPRegressor": "multilayer perceptron regressor",
    "GaussianNB": "Gaussian naive Bayes",
    "KNeighborsClassifier": "k-nearest neighbors classifier",
    "KNeighborsRegressor": "k-nearest neighbors regressor",
}


def _gate(error: float, detail: str) -> dict:
    return {"gate": "G2", "passed": error <= G2_TOLERANCE, "error": error, "tolerance": G2_TOLERANCE,
            "detail": detail}


def _missing(block: str) -> list[dict]:
    return [{"gate": "G2", "passed": False, "error": None, "tolerance": G2_TOLERANCE,
             "detail": f"the bar carries no {block}"}]


def _logistic(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponential = math.exp(value)
    return exponential / (1.0 + exponential)


def _estimator(context, *names: str):
    estimator = getattr(context.explained_adapter, "estimator", None)
    if estimator is None:
        raise NotExplained(f"the {context.role} model has no fitted scikit-learn estimator (.estimator)")
    for name in names:
        if not hasattr(estimator, name):
            raise NotExplained(f"the {context.role} model ({type(estimator).__name__}) has no {name}")
    return estimator


def _fit_rows(context, fitted: int) -> np.ndarray:
    """The run rows the estimator was fitted on, in the order of its fitted matrix."""
    rows = getattr(context.explained_adapter, "training_rows", None)
    rows = np.asarray(rows if rows is not None else [], dtype=np.int64).reshape(-1)
    if rows.size == 0:
        rows = np.asarray(context.training_rows, dtype=np.int64).reshape(-1)
    if rows.size != fitted:
        raise NotExplained(f"the model was fitted on {fitted} bars but {rows.size} training rows are recorded, "
                           "so its support vectors cannot be placed in time")
    return rows


def words(name: str) -> str:
    """``gradient_boosting`` -> ``gradient boosting``."""
    return re.sub(r"[_\-]+", " ", str(name)).strip()


def class_words(estimator) -> str:
    """``RandomForestClassifier`` -> ``Random forest classifier``."""
    name = type(estimator).__name__
    if name == "FrozenEstimator" and hasattr(estimator, "estimator"):
        return class_words(estimator.estimator)
    text = CLASS_WORDS.get(name) or re.sub(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", name).lower()
    return text[:1].upper() + text[1:]


def _row(context, row: int) -> np.ndarray:
    matrix, _ = context.model_inputs([row])
    return matrix


def _link(context, raw: float) -> float:
    """The role's link applied to a raw output: the validation logistic curve, logistic, or identity."""
    if context.role == "price":
        return raw
    if context.link == "logistic_curve":
        curve = context.logistic_curve()
        if curve is None:
            raise NotExplained("the direction model has no validation logistic curve")
        return _logistic(curve[0] * raw + curve[1])
    return _logistic(raw)


def _output(bar: dict, role: str) -> float:
    return float(bar["output"]["probabilityUp"] if role == "direction" else bar["output"]["targetUnits"])


# ═══ support vector machines ═══════════════════════════════════════════════


def _svm(context):
    return _estimator(context, "support_", "dual_coef_", "intercept_", "support_vectors_")


def _kernel_values(svm, matrix: np.ndarray) -> np.ndarray:
    from sklearn.metrics.pairwise import pairwise_kernels

    kernel = svm.kernel
    if callable(kernel) or kernel not in KERNEL_WORDS:
        raise NotExplained(f"kernel {kernel!r} is not one scikit-learn's pairwise kernels computes")
    parameters = {"gamma": float(svm._gamma), "degree": svm.degree, "coef0": float(svm.coef0)}
    return np.asarray(pairwise_kernels(np.asarray(svm.support_vectors_, dtype=np.float64), matrix, metric=kernel,
                                       filter_params=True, **parameters), dtype=np.float64).reshape(-1)


def _decision_value(context, svm, matrix: np.ndarray) -> float:
    if context.role == "price" or not hasattr(svm, "decision_function"):
        return float(np.asarray(svm.predict(matrix), dtype=np.float64).reshape(-1)[0])
    return float(np.asarray(svm.decision_function(matrix), dtype=np.float64).reshape(-1)[0])


def _support_vectors_structure(context) -> dict:
    svm = _svm(context)
    dual = np.asarray(svm.dual_coef_, dtype=np.float64)
    if dual.shape[0] != 1:
        raise NotExplained("the support vector machine has more than two classes")
    kernel = svm.kernel if isinstance(svm.kernel, str) else "custom"
    gamma = float(svm._gamma) if kernel in ("rbf", "poly", "sigmoid") else None
    return {
        "baseValue": float(np.ravel(svm.intercept_)[0]),
        "supportVectors": {
            "supportVectorCount": int(len(svm.support_)),
            "kernel": KERNEL_WORDS.get(kernel, kernel),
            "gamma": gamma,
            "trainingBarCount": int(svm.shape_fit_[0]),
        },
    }


def _support_vectors_bar(context, row: int) -> dict:
    svm = _svm(context)
    fit_rows = _fit_rows(context, int(svm.shape_fit_[0]))
    matrix = _row(context, row)
    dual = np.asarray(svm.dual_coef_, dtype=np.float64)
    if dual.shape[0] != 1:
        raise NotExplained("the support vector machine has more than two classes")
    dual = dual[0]
    kernel = _kernel_values(svm, matrix)
    contributions = dual * kernel
    order = np.argsort(-np.abs(contributions), kind="stable")
    listed, rest = order[:LISTED_SUPPORT_VECTORS], order[LISTED_SUPPORT_VECTORS:]
    decision = _decision_value(context, svm, matrix)
    positions = np.asarray(svm.support_, dtype=np.int64)[listed]
    return {
        "output": {"raw": decision},
        "supportVectors": {
            "timestamps": [int(t) for t in context.timestamps[fit_rows[positions]]],
            "dualCoefficients": dual[listed],
            "kernelValues": kernel[listed],
            "contributions": contributions[listed],
            "otherContribution": math.fsum(contributions[rest].tolist()),
            "intercept": float(np.ravel(svm.intercept_)[0]),
            "decisionValue": decision,
        },
    }


def _support_vectors_check(context, row: int, bar: dict) -> list[dict]:
    block = bar.get("supportVectors")
    if not block:
        return _missing("support vectors")
    total = math.fsum([float(block["intercept"]), float(block["otherContribution"]),
                       *[float(v) for v in block["contributions"]]])
    decision = float(block["decisionValue"])
    library = _decision_value(context, _svm(context), _row(context, row))
    output = _link(context, total)
    error = max(abs(total - decision), abs(decision - library), abs(decision - float(bar["output"]["raw"])),
                abs(output - _output(bar, context.role)), abs(output - float(bar["engineReload"])))
    return [_gate(error, f"intercept + dual x kernel {total!r} against decision value {library!r}; "
                         f"through the link {output!r} against the output {_output(bar, context.role)!r}")]


# ═══ calibrated classifier ═════════════════════════════════════════════════


def _calibrated(context):
    if context.role != "direction":
        raise NotExplained("a calibrated classifier has no price model")
    estimator = _estimator(context, "calibrated_classifiers_", "method", "classes_")
    classifiers = list(estimator.calibrated_classifiers_)
    if not classifiers:
        raise NotExplained("the calibrated classifier holds no fitted calibrators")
    base = classifiers[0].estimator
    if any(item.estimator is not base for item in classifiers[1:]):
        raise NotExplained("the calibrated classifier averages several base models (an ensemble), not one map")
    if estimator.method not in ("sigmoid", "isotonic"):
        raise NotExplained(f"calibration method {estimator.method!r} is not sigmoid or isotonic")
    if np.asarray(estimator.classes_).size != 2 or any(len(item.calibrators) != 1 for item in classifiers):
        raise NotExplained("the calibrated classifier is not a two-class model")
    return estimator, base, classifiers


def _base_scores(base, matrix: np.ndarray) -> np.ndarray:
    """The base model's score in the units its calibrator takes — scikit-learn's own rule."""
    try:
        from sklearn.utils._response import _get_response_values
    except ImportError:  # pragma: no cover - a scikit-learn that moved it
        _get_response_values = None
    if _get_response_values is not None:
        scores, _ = _get_response_values(base, matrix, response_method=["decision_function", "predict_proba"])
    else:  # pragma: no cover
        try:
            scores = base.decision_function(matrix)
        except AttributeError:
            scores = base.predict_proba(matrix)[:, 1]
    return np.asarray(scores, dtype=np.float64).reshape(-1)


def _calibration_map(classifiers, scores: np.ndarray) -> np.ndarray:
    """P(up) at each base score: the mean of the fitted calibrators' own predictions."""
    total = np.zeros(scores.size, dtype=np.float64)
    for item in classifiers:
        total += np.asarray(item.calibrators[0].predict(scores), dtype=np.float64).reshape(-1)
    return total / len(classifiers)


def _base_model_name(context, base) -> str:
    choice = (getattr(context.explained_adapter, "parameters", None) or {}).get("base_model")
    return words(choice) if choice else class_words(base).lower()


def _calibration_structure(context) -> dict:
    estimator, base, classifiers = _calibrated(context)
    rows = getattr(context.explained_adapter, "calibration_rows", None)
    rows = np.asarray(rows if rows is not None else context.validation_rows, dtype=np.int64).reshape(-1)
    rows = np.array([r for r in rows if context.valid(int(r))], dtype=np.int64)
    if rows.size:
        matrix, _ = context.model_inputs(rows)
        scores = _base_scores(base, matrix)
        scores = scores[np.isfinite(scores)]
    else:
        scores = np.empty(0)
    low, high = (float(scores.min()), float(scores.max())) if scores.size else (0.0, 1.0)
    if high <= low:
        low, high = low - 0.5, high + 0.5
    grid = np.linspace(low, high, CALIBRATION_SAMPLES)
    thresholds = getattr(classifiers[0].calibrators[0], "X_thresholds_", None)
    if estimator.method == "isotonic" and thresholds is not None:
        thresholds = np.asarray(thresholds, dtype=np.float64)
        grid = np.unique(np.concatenate([grid, thresholds[(thresholds > low) & (thresholds < high)]]))
    return {
        "baseValue": None,
        "calibration": {
            "method": estimator.method,
            "baseModel": _base_model_name(context, base),
            "curve": {"baseScore": grid, "probabilityUp": _calibration_map(classifiers, grid)},
        },
    }


def _calibration_bar(context, row: int) -> dict:
    estimator, base, classifiers = _calibrated(context)
    matrix = _row(context, row)
    score = float(_base_scores(base, matrix)[0])
    up = int(np.flatnonzero(np.asarray(estimator.classes_) == 1)[0])
    probability = float(estimator.predict_proba(matrix)[0, up])
    return {"output": {"raw": score}, "calibration": {"baseScore": score, "probabilityUp": probability}}


def _calibration_check(context, row: int, bar: dict) -> list[dict]:
    block = bar.get("calibration")
    if not block:
        return _missing("calibration")
    _, _, classifiers = _calibrated(context)
    mapped = float(_calibration_map(classifiers, np.array([float(block["baseScore"])]))[0])
    reported = _output(bar, "direction")
    error = max(abs(mapped - reported), abs(mapped - float(block["probabilityUp"])),
                abs(mapped - float(bar["engineReload"])), abs(float(block["baseScore"]) - float(bar["output"]["raw"])))
    return [_gate(error, f"the calibration map at base score {block['baseScore']!r} gives {mapped!r}; "
                         f"the model's P(up) is {reported!r}")]


# ═══ stacked generalization ════════════════════════════════════════════════


def _stack(context):
    estimator = _estimator(context, "estimators_", "final_estimator_", "stack_method_")
    if getattr(estimator, "passthrough", False):
        raise NotExplained("the stack passes the raw inputs to its meta-learner as well")
    names = [name for name, member in estimator.estimators if member != "drop"]
    if len(names) != len(estimator.estimators_):
        raise NotExplained("the stack's base models do not line up with their names")
    final = estimator.final_estimator_
    coefficients = np.ravel(np.asarray(getattr(final, "coef_", np.empty(0)), dtype=np.float64))
    if coefficients.size != len(names):
        raise NotExplained(f"the meta-learner has {coefficients.size} weights for {len(names)} base models "
                           "(more than two classes, or not a linear meta-learner)")
    intercept = float(np.ravel(np.asarray(final.intercept_, dtype=np.float64))[0])
    return estimator, names, coefficients, intercept


def _meta_raw(context, estimator, answers: np.ndarray) -> float:
    final = estimator.final_estimator_
    if context.role == "price" or not hasattr(final, "decision_function"):
        return float(np.asarray(final.predict(answers), dtype=np.float64).reshape(-1)[0])
    return float(np.asarray(final.decision_function(answers), dtype=np.float64).reshape(-1)[0])


def _stacking_structure(context) -> dict:
    estimator, names, coefficients, intercept = _stack(context)
    return {
        "baseValue": intercept,
        "stacking": {
            "baseModels": [{"name": words(name), "kind": class_words(member)}
                           for name, member in zip(names, estimator.estimators_)],
            "metaIntercept": intercept,
            "metaCoefficients": coefficients,
        },
    }


def _stacking_bar(context, row: int) -> dict:
    estimator, names, coefficients, _ = _stack(context)
    answers = np.asarray(estimator.transform(_row(context, row)), dtype=np.float64)
    if answers.shape[1] != len(names):
        raise NotExplained(f"the stack hands its meta-learner {answers.shape[1]} columns for {len(names)} base models")
    return {
        "output": {"raw": _meta_raw(context, estimator, answers)},
        "stacking": {
            "baseOutputs": [{"name": words(name), "value": float(answers[0, j])} for j, name in enumerate(names)],
            "metaContributions": coefficients * answers[0],
        },
    }


def _stacking_check(context, row: int, bar: dict) -> list[dict]:
    block = bar.get("stacking")
    if not block:
        return _missing("stacking")
    estimator, _, coefficients, intercept = _stack(context)
    total = math.fsum([intercept, *[float(v) for v in block["metaContributions"]]])
    answers = np.array([[float(item["value"]) for item in block["baseOutputs"]]])
    library = _meta_raw(context, estimator, answers)
    output = _link(context, total)
    reported = _output(bar, context.role)
    error = max(abs(total - library), abs(total - float(bar["output"]["raw"])), abs(output - reported),
                abs(output - float(bar["engineReload"])))
    return [_gate(error, f"intercept + weight x answer {total!r} against the meta-learner's {library!r}; "
                         f"through the link {output!r} against the output {reported!r}")]


# ═══ the kind-module contract ══════════════════════════════════════════════

_STRUCTURE = {"support_vectors": _support_vectors_structure, "calibration": _calibration_structure,
              "stacking": _stacking_structure}
_BAR = {"support_vectors": _support_vectors_bar, "calibration": _calibration_bar, "stacking": _stacking_bar}
_CHECK = {"support_vectors": _support_vectors_check, "calibration": _calibration_check, "stacking": _stacking_check}


def _pick(table: dict, context):
    function = table.get(context.explain_kind)
    if function is None:
        raise NotExplained(f"explain kind {context.explain_kind!r} is not one this module explains")
    return function


def structure_block(context) -> dict:
    return _pick(_STRUCTURE, context)(context)


def bar_block(context, row: int) -> dict:
    return _pick(_BAR, context)(context, row)


def check(context, row: int, bar: dict) -> list[dict]:
    return _pick(_CHECK, context)(context, row, bar)


__all__ = ["LISTED_SUPPORT_VECTORS", "bar_block", "check", "class_words", "structure_block", "words"]
