"""Inside the model for neural networks (explainKind ``neural``).

Two kinds of network are explained here, both read from the fitted object,
never re-derived from a formula of our own:

- **PyTorch networks** (``cycle.networks.NeuralAdapter``: multilayer
  perceptron / feedforward network, long short-term memory, recurrent, gated
  recurrent unit, attention recurrent, temporal convolution network,
  transformer encoder). The adapter's own ``trace(features, row)`` runs the
  network once on the exact window ``predict_*`` reads, in eval mode on the
  CPU, and records every hidden layer with forward hooks plus the attention of
  the last position; ``describe()`` is the same without values;
  ``head_input`` / ``apply_head`` re-apply the prediction head for gate G4.

- **scikit-learn's multilayer perceptron** (``MLPClassifier`` /
  ``MLPRegressor`` inside ``cycle.sklearn_adapter.SklearnEstimatorAdapter``).
  scikit-learn exposes no per-layer hook, so the forward pass is read out of
  the fitted ``coefs_`` / ``intercepts_`` with scikit-learn's own activation
  function (``sklearn.neural_network._base.ACTIVATIONS[estimator.activation]``),
  on the inputs after the adapter's own scaler. The logit is the output
  layer's value before its output activation; gate G4 holds it against the
  library's ``predict_proba`` / ``predict``.

Replies (``src/shared/cycle/explain.ts``):

    structure.neural  {network, layers [{name, kind, outputShape}], sequenceLength, hasAttention}
    bar.neural        {layers [{name, kind, shape, values}], attention [{layer, head, weights}], logit}
    bar.output.raw    the logit: log-odds of up (direction) or the target itself (price)

Layer names are plain words (the activation named in full); every attention
entry's ``layer`` is the ``name`` of the layer it belongs to, and its weights
run oldest bar first over the same positions as ``inputs.window``. Nothing is
downsampled here: the view downsamples for drawing and keeps hover exact.

A direction-from-price model (``cycle.derived.DerivedDirectionAdapter``) is
explained through its price network (``context.explained_adapter``): the
logit is that network's forecast, which the logistic curve turns into P(up).

Gates (``check``): G2 — the link applied to the logit reproduces the reported
output (1e-6); G4 — the head applied to the recorded last activation
reproduces the logit (1e-5), and for scikit-learn also the library's own
prediction.
"""

from __future__ import annotations

import math
import re

import numpy as np

from . import NotExplained

G2_TOLERANCE = 1e-6
G4_TOLERANCE = 1e-5

# The activation named in a layer's name, in full words.
ACTIVATION_WORDS = {
    "gelu": "Gaussian error linear unit",
    "relu": "rectified linear unit",
    "tanh": "hyperbolic tangent",
    "logistic": "logistic sigmoid",
    "identity": "no activation",
}
_ACTIVATION_IN_NAME = re.compile(r"\((gelu|relu|tanh|logistic|identity)\)")

SCIKIT_LEARN_NETWORK = "scikit_learn_multilayer_perceptron"


def full_words(name: str) -> str:
    """A layer name with its activation written out: "Hidden layer 1 (gelu)" ->
    "Hidden layer 1 (Gaussian error linear unit)". Structure and bar names go
    through the same function, so they stay equal."""
    return _ACTIVATION_IN_NAME.sub(lambda match: f"({ACTIVATION_WORDS[match.group(1)]})", name)


# ─── which network this is ─────────────────────────────────────────────────


def _is_torch(adapter) -> bool:
    return all(hasattr(adapter, name) for name in ("trace", "describe", "apply_head")) and \
        getattr(adapter, "network", None) is not None


def _scikit_learn_perceptron(adapter):
    estimator = getattr(adapter, "estimator", None)
    if estimator is None:
        return None
    if all(hasattr(estimator, name) for name in ("coefs_", "intercepts_", "activation", "out_activation_")):
        return estimator
    return None


def _network(context):
    """("torch", adapter) or ("scikit_learn", estimator); NotExplained otherwise."""
    adapter = context.explained_adapter
    if _is_torch(adapter):
        return "torch", adapter
    estimator = _scikit_learn_perceptron(adapter)
    if estimator is not None:
        return "scikit_learn", estimator
    raise NotExplained(f"{type(adapter).__name__} holds no network the neural explainer can read")


# ─── PyTorch ───────────────────────────────────────────────────────────────


def _torch_structure(context, adapter) -> dict:
    described = context.cache.get("neural_describe")
    if described is None:
        described = adapter.describe()
        described = {**described, "layers": [{**layer, "name": full_words(layer["name"])}
                                             for layer in described["layers"]]}
        context.cache["neural_describe"] = described
    return described


def _torch_bar(context, adapter, row: int) -> dict:
    traced = adapter.trace(context.features, int(row))
    return {
        "layers": [{**layer, "name": full_words(layer["name"])} for layer in traced["layers"]],
        "attention": [{**entry, "layer": full_words(entry["layer"])} for entry in traced["attention"]],
        "logit": float(traced["logit"]),
    }


# ─── scikit-learn ──────────────────────────────────────────────────────────


def _activation_function(name: str):
    from sklearn.neural_network._base import ACTIVATIONS

    if name not in ACTIVATIONS:
        raise NotExplained(f"scikit-learn has no activation {name!r}")
    return ACTIVATIONS[name]


def _up_sign(estimator) -> float:
    """+1 when the output unit is P(up), -1 when it is P(down) (a classifier whose
    second class is not "up"); +1 for a regressor."""
    classes = getattr(estimator, "classes_", None)
    if classes is None:
        return 1.0
    classes = np.asarray(classes)
    if classes.size != 2:
        raise NotExplained(f"a classifier with {classes.size} classes is not a direction model")
    return 1.0 if classes[1] == 1 else -1.0


def _hidden_name(number: int, activation: str) -> str:
    return f"Hidden layer {number} ({ACTIVATION_WORDS.get(activation, activation.replace('_', ' '))})"


def _scikit_learn_structure(estimator) -> dict:
    activation = str(estimator.activation)
    hidden = estimator.coefs_[:-1]
    return {
        "network": SCIKIT_LEARN_NETWORK,
        "layers": [{"name": _hidden_name(number, activation), "kind": "dense", "outputShape": [int(weights.shape[1])]}
                   for number, weights in enumerate(hidden, 1)],
        "sequenceLength": 1,
        "hasAttention": False,
    }


def _scikit_learn_forward(estimator, inputs: np.ndarray) -> tuple[list[np.ndarray], float]:
    """Every hidden layer's activation for one row of model inputs, and the
    output layer's value before its output activation (the logit, as the
    log-odds of up for a classifier)."""
    activate = _activation_function(str(estimator.activation))
    activation = np.asarray(inputs, dtype=np.float64).reshape(1, -1)
    hidden: list[np.ndarray] = []
    last = len(estimator.coefs_) - 1
    for layer, (weights, intercept) in enumerate(zip(estimator.coefs_, estimator.intercepts_)):
        activation = activation @ weights + intercept
        if layer != last:
            activate(activation)
            hidden.append(activation[0].copy())
    if activation.shape[1] != 1:
        raise NotExplained(f"the output layer has {activation.shape[1]} units; a direction or price model has one")
    return hidden, _up_sign(estimator) * float(activation[0, 0])


def _scikit_learn_bar(context, estimator, row: int) -> dict:
    inputs, _ = context.model_inputs([row])
    hidden, logit = _scikit_learn_forward(estimator, inputs[0])
    activation = str(estimator.activation)
    return {
        "layers": [{"name": _hidden_name(number, activation), "kind": "dense", "shape": [int(values.size)],
                    "values": values} for number, values in enumerate(hidden, 1)],
        "attention": [],
        "logit": logit,
    }


def _scikit_learn_head(estimator, activation: np.ndarray) -> float:
    """The output layer applied to one last-hidden-layer vector, as the logit of up."""
    value = np.asarray(activation, dtype=np.float64).reshape(1, -1) @ estimator.coefs_[-1] + estimator.intercepts_[-1]
    return _up_sign(estimator) * float(value[0, 0])


def _scikit_learn_library_output(context, estimator, row: int) -> float:
    """What the library itself predicts for the row: P(up) from predict_proba, or predict."""
    inputs, _ = context.model_inputs([row])
    if hasattr(estimator, "predict_proba"):
        classes = np.asarray(estimator.classes_)
        column = int(np.flatnonzero(classes == 1)[0])
        return float(estimator.predict_proba(inputs)[0, column])
    return float(np.asarray(estimator.predict(inputs), dtype=np.float64).reshape(-1)[0])


# ─── the dispatch contract ─────────────────────────────────────────────────


def structure_block(context) -> dict:
    kind, network = _network(context)
    neural = _torch_structure(context, network) if kind == "torch" else _scikit_learn_structure(network)
    return {"neural": neural, "baseValue": None}


def bar_block(context, row: int) -> dict:
    kind, network = _network(context)
    neural = _torch_bar(context, network, row) if kind == "torch" else _scikit_learn_bar(context, network, row)
    # the logit is the value before the link: log-odds (direction), target units (price), or for a
    # direction-from-price model the price network's forecast, which the logistic curve reads
    return {"neural": neural, "output": {"raw": neural["logit"]}}


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponential = math.exp(value)
    return exponential / (1.0 + exponential)


def linked(context, raw: float) -> float:
    """The link of this role applied to the logit: the output the chart reports."""
    if context.role == "price" or context.link == "identity":
        return raw
    if context.link == "logistic_curve":
        curve = context.logistic_curve()
        if curve is None:
            raise NotExplained("a logistic-curve link without a fitted curve")
        return _sigmoid(curve[0] * raw + curve[1])
    if context.link == "logistic":
        return _sigmoid(raw)
    raise NotExplained(f"a neural network with the {context.link!r} link")


def _head_input(layer: dict) -> np.ndarray:
    values = np.asarray(layer["values"], dtype=np.float64).reshape(layer["shape"])
    return values[-1] if values.ndim == 2 else values


def check(context, row: int, bar: dict) -> list[dict]:
    """G2 and G4 for one explained bar (``bar`` is the full reply)."""
    kind, network = _network(context)
    neural = bar.get("neural")
    if not neural or not neural.get("layers"):
        return [{"gate": "G4", "passed": False, "error": None, "tolerance": G4_TOLERANCE,
                 "detail": "the bar carries no neural block"}]
    logit = float(neural["logit"])
    output = bar["output"]
    reported = output["targetUnits"] if context.role == "price" else output["probabilityUp"]
    raw_error = abs(float(output["raw"]) - logit)
    link_error = abs(linked(context, logit) - float(reported))
    g2_error = max(raw_error, link_error)
    gates = [{"gate": "G2", "passed": g2_error <= G2_TOLERANCE, "error": g2_error, "tolerance": G2_TOLERANCE,
              "detail": f"link {context.link} of the logit {logit!r} against the output {reported!r}; "
                        f"output.raw differs from the logit by {raw_error:.3g}"}]
    last = neural["layers"][-1]
    activation = _head_input(last)
    if kind == "torch":
        head = float(network.apply_head(activation))
        g4_error = abs(head - logit)
        detail = f"the head on the last row of {last['name']!r} gives {head!r} against the logit {logit!r}"
    else:
        head = _scikit_learn_head(network, activation)
        library = _scikit_learn_library_output(context, network, row)
        head_output = _sigmoid(head) if hasattr(network, "predict_proba") else head
        g4_error = max(abs(head - logit), abs(head_output - library))
        detail = (f"the output layer on {last['name']!r} gives {head!r} against the logit {logit!r}; "
                  f"through the output activation {head_output!r} against the library's {library!r}")
    gates.append({"gate": "G4", "passed": g4_error <= G4_TOLERANCE, "error": g4_error, "tolerance": G4_TOLERANCE,
                  "detail": detail})
    return gates


__all__ = ["ACTIVATION_WORDS", "bar_block", "check", "full_words", "linked", "structure_block"]
