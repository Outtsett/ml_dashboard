"""The Model Cycle's model registry: `src/config/cycle_models/*.json`.

One registry is the single source of truth for which models the Cycle can run,
read by this module (the engine and `main.py`) and by the server
(`src/server/training/cycleRunners.ts`, zod schema in
`src/shared/cycle/models.ts`). `_cycle.json` holds what every model shares (the
runner template, the cycle-wide parameters, the group order and the reasons
catalog specs outside the registry cannot run); every other file holds
`{"models": {<key>: <entry>}}`, one file per group of the catalog.

This module imports only the standard library: `main.py` reads it BEFORE numpy
to decide whether torch must be imported first (the Windows CUDA deadlock), so
nothing here may pull in numpy, torch or a model library.

An entry (see `docs/plans/2026-09-26-cycle-catalog-inside-view.md` for every
field): the catalog link (`catalogSpecId`, `alsoCatalogSpecIds`, fallback
`category` / `subcategory` / `displayName`), how it is built (`implementation`,
`adapter`, `legacyFamily`, `direction`, `price`, `preprocess`, `progress`,
`stepUnit`), how it is explained (`explainKind`), whether it reads a window of
bars (`sequence`, `network`), and its `parameters` — each typed, bounded,
labelled, with an optional estimator `argument`, the `roles` it applies to and
an Optuna `search` space. A parameter's type is its declared `type`, never
inferred from its default (a float parameter may have a whole-number default).

`adapter == "legacy"` marks the eight families that predate the registry; their
validation and Optuna search spaces stay in `models.py` unchanged, so their runs
are bitwise the same as before.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

REGISTRY_DIRECTORY = Path(__file__).resolve().parents[2] / "config" / "cycle_models"
SHARED_FILE = "_cycle.json"

KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
PARAMETER_TYPES = ("int", "float", "bool", "categorical", "string")
IMPLEMENTATIONS = ("sklearn", "xgboost", "lightgbm", "catboost", "statsmodels", "torch")
ADAPTERS = ("legacy", "scikit_learn", "catboost", "statsmodels", "neural",
            # adapters in their own modules (models.ADAPTER_CLASSES), one per catalog spec
            "tree_boosted_neural_embedding", "attention_weighted_forecast_stack", "bayesian_neural_hybrid")
DIRECTION_MODES = ("classifier", "from_price")
PROBABILITY_SOURCES = ("legacy", "predict_proba", "logistic_curve_on_validation", "network", "probit")
PROGRESS_KINDS = ("legacy", "warm_start_trees", "warm_start_rounds", "per_round", "per_epoch", "single_fit")
STEP_UNITS = ("epoch", "boosting_round", "tree_batch", "solver_pass", "single_fit")
# "opaque": a runnable model with no Inside view yet (the panel says so instead of guessing)
EXPLAIN_KINDS = ("trees", "oblivious_trees", "linear", "neighbors", "naive_bayes", "support_vectors", "calibration", "stacking", "neural", "opaque")
NETWORKS = ("multilayer_perceptron", "lstm", "temporal_convolution_network", "transformer_encoder",
            "recurrent", "gated_recurrent_unit", "attention_recurrent",
            # kinds in their own modules (networks.NETWORK_EXTENSION_MODULES)
            "mixture_of_experts", "recurrent_convolution_hybrid", "hypernetwork", "neural_turing_machine", "dual_pathway")
SPEEDS = ("fast", "medium", "slow")
PREPROCESS_STEPS = ("standard_scaler",)
ROLES = ("direction", "price")
SEARCH_KINDS = ("float", "int", "categorical")

ENTRY_FIELDS = (
    "catalogSpecId", "alsoCatalogSpecIds", "displayName", "category", "subcategory", "kind", "summary",
    "implementationNote", "runnable", "unavailableReason", "implementation", "adapter", "legacyFamily",
    "direction", "price", "preprocess", "progress", "stepUnit", "explainKind", "sequence", "network",
    "speed", "estimatedTrainingTime", "gpu", "parameters",
)
PARAMETER_FIELDS = ("type", "default", "min", "max", "step", "logScale", "choices", "label", "group",
                    "description", "argument", "roles", "search")


class RegistryError(ValueError):
    """The registry on disk breaks its own contract."""


# ─── loading ────────────────────────────────────────────────────────────────


def _read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RegistryError(f"{path.name}: not valid JSON ({error})") from error


def load_registry(directory: str | Path | None = None) -> dict:
    """Read and validate a registry folder. Returns
    ``{"shared": <_cycle.json>, "models": {key: entry}, "files": {key: file name}}``.
    Raises `RegistryError` naming the file and field on any contract break."""
    root = Path(directory) if directory is not None else REGISTRY_DIRECTORY
    shared_path = root / SHARED_FILE
    if not shared_path.is_file():
        raise RegistryError(f"{root}: no {SHARED_FILE}")
    shared = _read(shared_path)
    _validate_shared(shared)
    models: dict[str, dict] = {}
    files: dict[str, str] = {}
    for path in sorted(root.glob("*.json")):
        if path.name == SHARED_FILE:
            continue
        document = _read(path)
        if not isinstance(document, dict) or not isinstance(document.get("models"), dict):
            raise RegistryError(f"{path.name}: must be an object with a 'models' object")
        for key, entry in document["models"].items():
            if key in models:
                raise RegistryError(f"{path.name}: model key {key!r} is also defined in {files[key]}")
            _validate_entry(key, entry, shared, path.name)
            models[key] = entry
            files[key] = path.name
    if not models:
        raise RegistryError(f"{root}: no models")
    _validate_cross(models, shared)
    return {"shared": shared, "models": models, "files": files}


@lru_cache(maxsize=1)
def _default_registry() -> dict:
    return load_registry()


def registry() -> dict:
    """The repository's registry (cached for the process)."""
    return _default_registry()


# ─── validation ─────────────────────────────────────────────────────────────


def _fail(where: str, message: str) -> None:
    raise RegistryError(f"{where}: {message}")


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _validate_shared(shared: Any) -> None:
    where = SHARED_FILE
    if not isinstance(shared, dict):
        _fail(where, "must be an object")
    for field in ("version", "task", "displayNameSuffix", "runnerTemplate", "groupOrder", "estimatorPrefixes", "cycleParameters",
                  "unavailableByCategory", "unavailableBySubcategory", "unavailableBySpec"):
        if field not in shared:
            _fail(where, f"missing {field}")
    if not isinstance(shared["cycleParameters"], dict) or not shared["cycleParameters"]:
        _fail(where, "cycleParameters must be a non-empty object")
    for name, spec in shared["cycleParameters"].items():
        _validate_parameter(f"{where} cycleParameters.{name}", name, spec, model_parameter=False)
    if not all(isinstance(prefix, str) and prefix.endswith(".") for prefix in shared["estimatorPrefixes"]):
        _fail(where, "estimatorPrefixes must be module prefixes ending in '.'")


def _validate_parameter(where: str, name: str, spec: Any, *, model_parameter: bool) -> None:
    if not KEY_PATTERN.match(name):
        _fail(where, f"parameter name {name!r} must match {KEY_PATTERN.pattern}")
    if not isinstance(spec, dict):
        _fail(where, "must be an object")
    unknown = set(spec) - set(PARAMETER_FIELDS)
    if unknown:
        _fail(where, f"unknown fields {sorted(unknown)}")
    kind = spec.get("type")
    if kind not in PARAMETER_TYPES:
        _fail(where, f"type must be one of {PARAMETER_TYPES}, got {kind!r}")
    if not isinstance(spec.get("label"), str) or not spec["label"]:
        _fail(where, "needs a label")
    if not isinstance(spec.get("group"), str) or not spec["group"]:
        _fail(where, "needs a group")
    if model_parameter and spec["group"] != "Model":
        _fail(where, "a model parameter's group must be 'Model'")
    default = spec.get("default")
    if kind == "bool":
        if not isinstance(default, bool):
            _fail(where, "a bool parameter's default must be true or false")
    elif kind == "string":
        if not isinstance(default, str):
            _fail(where, "a string parameter's default must be text")
        for bound in ("min", "max", "step", "choices", "search"):
            if bound in spec:
                _fail(where, f"a string parameter has no {bound}")
    elif kind == "categorical":
        choices = spec.get("choices")
        if not isinstance(choices, list) or not choices:
            _fail(where, "a categorical parameter needs choices")
        if default not in choices:
            _fail(where, f"default {default!r} is not one of its choices")
    else:
        if not _is_number(default):
            _fail(where, f"default {default!r} must be a finite number")
        if kind == "int" and float(default) != int(default):
            _fail(where, f"an int parameter's default must be whole, got {default!r}")
        for bound in ("min", "max"):
            if bound in spec and not _is_number(spec[bound]):
                _fail(where, f"{bound} must be a finite number")
        if "min" in spec and "max" in spec and spec["min"] > spec["max"]:
            _fail(where, "min is above max")
        if "min" in spec and default < spec["min"] or "max" in spec and default > spec["max"]:
            _fail(where, f"default {default!r} is outside [{spec.get('min')}, {spec.get('max')}]")
    if "roles" in spec:
        if not isinstance(spec["roles"], list) or not spec["roles"] or any(role not in ROLES for role in spec["roles"]):
            _fail(where, f"roles must be a non-empty subset of {ROLES}")
    if "argument" in spec and (not isinstance(spec["argument"], str) or not spec["argument"]):
        _fail(where, "argument must be a non-empty string")
    if "search" in spec:
        _validate_search(where + ".search", kind, spec["search"])


def _validate_search(where: str, parameter_kind: str, search: Any) -> None:
    if not isinstance(search, dict) or search.get("kind") not in SEARCH_KINDS:
        _fail(where, f"kind must be one of {SEARCH_KINDS}")
    kind = search["kind"]
    if kind == "categorical":
        if not isinstance(search.get("choices"), list) or not search["choices"]:
            _fail(where, "a categorical search needs choices")
    else:
        if not (_is_number(search.get("low")) and _is_number(search.get("high"))) or search["low"] >= search["high"]:
            _fail(where, "needs numeric low < high")
        if search.get("log") and search["low"] <= 0:
            _fail(where, "a log search needs low > 0")
        if kind == "int" and parameter_kind != "int":
            _fail(where, "an int search needs an int parameter")


def _validate_entry(key: str, entry: Any, shared: dict, file_name: str) -> None:
    where = f"{file_name} {key}"
    if not KEY_PATTERN.match(key):
        _fail(where, f"model key must match {KEY_PATTERN.pattern}")
    if not isinstance(entry, dict):
        _fail(where, "must be an object")
    missing = [field for field in ENTRY_FIELDS if field not in entry]
    if missing:
        _fail(where, f"missing fields {missing}")
    unknown = set(entry) - set(ENTRY_FIELDS)
    if unknown:
        _fail(where, f"unknown fields {sorted(unknown)}")
    for field in ("displayName", "category", "subcategory", "kind", "summary", "estimatedTrainingTime"):
        if not isinstance(entry[field], str) or not entry[field]:
            _fail(where, f"{field} must be a non-empty string")
    if entry["catalogSpecId"] is not None and not isinstance(entry["catalogSpecId"], str):
        _fail(where, "catalogSpecId must be a string or null")
    if not isinstance(entry["alsoCatalogSpecIds"], list) or not all(isinstance(s, str) for s in entry["alsoCatalogSpecIds"]):
        _fail(where, "alsoCatalogSpecIds must be a list of strings")
    if not isinstance(entry["runnable"], bool):
        _fail(where, "runnable must be true or false")
    if entry["runnable"] == (entry["unavailableReason"] is not None):
        _fail(where, "a runnable model has no unavailableReason; a model that is not runnable needs one")
    for field, allowed in (("implementation", IMPLEMENTATIONS), ("adapter", ADAPTERS), ("progress", PROGRESS_KINDS),
                           ("stepUnit", STEP_UNITS), ("explainKind", EXPLAIN_KINDS), ("speed", SPEEDS)):
        if entry[field] not in allowed:
            _fail(where, f"{field} must be one of {allowed}, got {entry[field]!r}")
    if (entry["adapter"] == "legacy") != (entry["legacyFamily"] is not None):
        _fail(where, "legacyFamily is set exactly when adapter is 'legacy'")
    if (entry["adapter"] == "legacy") != (entry["progress"] == "legacy"):
        _fail(where, "progress is 'legacy' exactly when adapter is 'legacy'")
    if not isinstance(entry["sequence"], bool) or not isinstance(entry["gpu"], bool):
        _fail(where, "sequence and gpu must be true or false")
    if entry["network"] is not None and entry["network"] not in NETWORKS:
        _fail(where, f"network must be one of {NETWORKS} or null")
    if entry["sequence"] and entry["network"] is None:
        _fail(where, "a sequence model needs a network")
    if entry["adapter"] == "neural" and entry["network"] is None:
        _fail(where, "a neural adapter needs a network")
    if not isinstance(entry["preprocess"], list) or any(step not in PREPROCESS_STEPS for step in entry["preprocess"]):
        _fail(where, f"preprocess must be a list drawn from {PREPROCESS_STEPS}")
    direction = entry["direction"]
    if not isinstance(direction, dict) or direction.get("mode") not in DIRECTION_MODES:
        _fail(where, f"direction.mode must be one of {DIRECTION_MODES}")
    if direction.get("probability") not in PROBABILITY_SOURCES:
        _fail(where, f"direction.probability must be one of {PROBABILITY_SOURCES}")
    if not isinstance(direction.get("fixed", {}), dict):
        _fail(where, "direction.fixed must be an object")
    price = entry["price"]
    if price is not None and (not isinstance(price, dict) or not isinstance(price.get("fixed", {}), dict)):
        _fail(where, "price must be null or an object with a 'fixed' object")
    if direction["mode"] == "from_price":
        if price is None or not price.get("estimator"):
            _fail(where, "a from_price model needs a price estimator")
        if direction["probability"] != "logistic_curve_on_validation":
            _fail(where, "a from_price model reads P(up) through logistic_curve_on_validation")
    prefixes = tuple(shared["estimatorPrefixes"])
    for role, block in (("direction", direction), ("price", price)):
        estimator = (block or {}).get("estimator")
        if estimator is not None and (not isinstance(estimator, str) or not estimator.startswith(prefixes)):
            _fail(where, f"{role}.estimator {estimator!r} must start with one of {prefixes}")
        if entry["adapter"] in ("scikit_learn", "catboost", "statsmodels") and entry["runnable"] and role == "direction":
            if direction["mode"] == "classifier" and not estimator:
                _fail(where, "a runnable library model needs a direction estimator")
    if not isinstance(entry["parameters"], dict):
        _fail(where, "parameters must be an object")
    for name, spec in entry["parameters"].items():
        if name in shared["cycleParameters"]:
            _fail(where, f"parameter {name!r} collides with a cycle-wide parameter")
        _validate_parameter(f"{where} parameters.{name}", name, spec, model_parameter=True)


def _validate_cross(models: dict, shared: dict) -> None:
    """One parameter name has one type (and one set of choices) across every model:
    `main.py` registers each flag once for all models."""
    seen: dict[str, tuple[str, str]] = {}
    for key, entry in models.items():
        for name, spec in entry["parameters"].items():
            if name in seen and seen[name][0] != spec["type"]:
                raise RegistryError(f"parameter {name!r} is {spec['type']} in {key} but {seen[name][0]} in {seen[name][1]}")
            seen.setdefault(name, (spec["type"], key))
    spec_ids: dict[str, str] = {}
    for key, entry in models.items():
        for spec_id in [entry["catalogSpecId"], *entry["alsoCatalogSpecIds"]]:
            if spec_id is None:
                continue
            if spec_id in spec_ids:
                raise RegistryError(f"catalog spec {spec_id!r} is claimed by both {spec_ids[spec_id]} and {key}")
            spec_ids[spec_id] = key


# ─── queries ────────────────────────────────────────────────────────────────


def model_keys(reg: dict | None = None) -> tuple[str, ...]:
    return tuple((reg or registry())["models"])


def runnable_keys(reg: dict | None = None) -> tuple[str, ...]:
    return tuple(key for key, entry in (reg or registry())["models"].items() if entry["runnable"])


def entry(key: str, reg: dict | None = None) -> dict:
    models = (reg or registry())["models"]
    if key not in models:
        raise ValueError(f"unknown model {key!r}; the registry has: {', '.join(models)}")
    return models[key]


def display_name(key: str, reg: dict | None = None) -> str:
    return entry(key, reg)["displayName"]


def is_legacy(key: str, reg: dict | None = None) -> bool:
    return entry(key, reg)["adapter"] == "legacy"


def uses_torch(key: str | None, reg: dict | None = None) -> bool:
    """True when the model's own implementation imports torch."""
    if key is None:
        return False
    models = (reg or registry())["models"]
    return key in models and models[key]["implementation"] == "torch"


def has_price_model(key: str, reg: dict | None = None) -> bool:
    return entry(key, reg)["price"] is not None


def flag(name: str) -> str:
    """The command-line flag for a parameter: `--` plus the name with underscores as hyphens."""
    return "--" + name.replace("_", "-")


def defaults(key: str, reg: dict | None = None) -> dict:
    """The model's parameter defaults with their declared Python types (int, float, bool, str)."""
    return {name: coerce(name, spec, spec["default"], key) for name, spec in entry(key, reg)["parameters"].items()}


def parameter_types(reg: dict | None = None) -> dict[str, str]:
    """Every model parameter name across the registry and its one declared type."""
    types: dict[str, str] = {}
    for model in (reg or registry())["models"].values():
        for name, spec in model["parameters"].items():
            types.setdefault(name, spec["type"])
    return types


def coerce(name: str, spec: dict, value: Any, key: str = "") -> Any:
    """Coerce one raw value to the parameter's declared type and check its bounds
    and choices. Raises ValueError with a sentence naming the model and parameter."""
    kind = spec["type"]
    label = f"{key}: {name}" if key else name
    if kind == "string":
        if value is None:
            return ""
        if isinstance(value, (bool, int, float)) and not isinstance(value, str):
            raise ValueError(f"{label} must be text, got {value!r}")
        return str(value)
    if kind == "bool":
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false", "1", "0"):
            return value.lower() in ("true", "1")
        if isinstance(value, (int, float)) and value in (0, 1):
            return bool(value)
        raise ValueError(f"{label} must be true or false, got {value!r}")
    if kind == "categorical":
        choices = spec["choices"]
        if value in choices:
            return value
        for choice in choices:  # numeric categoricals arrive as strings from the command line
            if str(choice) == str(value):
                return choice
        raise ValueError(f"{label} must be one of {choices}, got {value!r}")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a number, got {value!r}") from None
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite, got {value!r}")
    if kind == "int":
        if not number.is_integer():
            raise ValueError(f"{label} must be a whole number, got {value!r}")
        number = int(number)
    if "min" in spec and number < spec["min"]:
        raise ValueError(f"{label} must be at least {spec['min']}, got {number}")
    if "max" in spec and number > spec["max"]:
        raise ValueError(f"{label} must be at most {spec['max']}, got {number}")
    return number


def resolve_parameters(key: str, parameters: dict | None, reg: dict | None = None) -> dict:
    """The model's parameters from `parameters` (other keys ignored), missing ones
    from the defaults, each coerced and checked against the registry. Legacy
    models are resolved by `models.resolve_parameters` instead (their rules
    predate the registry and must not change)."""
    model = entry(key, reg)
    parameters = parameters or {}
    resolved = {}
    for name, spec in model["parameters"].items():
        raw = parameters.get(name)
        resolved[name] = coerce(name, spec, spec["default"] if raw is None else raw, key)
    return resolved


def estimator_arguments(key: str, parameters: dict, role: str, reg: dict | None = None) -> dict:
    """The keyword arguments a library estimator receives for `role`
    ("direction" or "price"): the role's `fixed` arguments, then every resolved
    parameter that declares an `argument` and applies to the role. Parameters
    without an `argument` are read by the adapter itself (epochs, patience, …)."""
    model = entry(key, reg)
    block = model["direction"] if role == "direction" else model["price"]
    if block is None:
        raise ValueError(f"{key} has no {role} model")
    arguments = dict(block.get("fixed", {}))
    for name, spec in model["parameters"].items():
        if "argument" not in spec or role not in spec.get("roles", list(ROLES)):
            continue
        arguments[spec["argument"]] = parameters[name]
    return arguments


def searchable_parameters(key: str, reg: dict | None = None) -> tuple[str, ...]:
    """The names of the model's parameters that carry a `search` space, in registry order."""
    return tuple(name for name, spec in entry(key, reg)["parameters"].items() if spec.get("search"))


def has_search_space(key: str, reg: dict | None = None) -> bool:
    return bool(searchable_parameters(key, reg))


def suggested_values(trial, key: str, pinned=(), reg: dict | None = None) -> dict:
    """One Optuna suggestion per searchable parameter of ``key`` (registry
    order), skipping ``pinned`` names, which keep the run's own value."""
    model = entry(key, reg)
    held = set(pinned or ())
    values: dict = {}
    for name, spec in model["parameters"].items():
        search = spec.get("search")
        if not search or name in held:
            continue
        if search["kind"] == "categorical":
            values[name] = trial.suggest_categorical(name, list(search["choices"]))
        elif search["kind"] == "int":
            values[name] = trial.suggest_int(name, int(search["low"]), int(search["high"]), log=bool(search.get("log")))
        else:
            values[name] = trial.suggest_float(name, float(search["low"]), float(search["high"]), log=bool(search.get("log")))
    return values


def suggest_parameters(trial, key: str, base_parameters: dict, reg: dict | None = None, pinned=()) -> dict:
    """Optuna search from the registry's `search` spaces: every parameter with a
    `search` (and not in ``pinned``) is suggested under its own name, the rest
    keep the resolved base value. A legacy family's values are resolved by
    `models.resolve_parameters`, whose rules predate the registry."""
    model = entry(key, reg)
    suggested = suggested_values(trial, key, pinned, reg)
    if model["adapter"] == "legacy":
        from cycle import models  # noqa: PLC0415 - models imports this module

        return models.resolve_parameters(key, {**models.resolve_parameters(key, base_parameters), **suggested})
    resolved = resolve_parameters(key, base_parameters, reg)
    resolved.update(suggested)
    return resolve_parameters(key, resolved, reg)


def unavailable_reason(spec_id: str, category: str, subcategory: str, reg: dict | None = None) -> str:
    """Why a catalog spec with no runnable registry entry cannot run in the Cycle."""
    shared = (reg or registry())["shared"]
    if spec_id in shared["unavailableBySpec"]:
        return shared["unavailableBySpec"][spec_id]
    by_subcategory = shared["unavailableBySubcategory"].get(f"{category}/{subcategory}")
    if by_subcategory:
        return by_subcategory
    return shared["unavailableByCategory"].get(category, "Not built for the Cycle yet.")
