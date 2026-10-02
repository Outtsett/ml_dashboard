"""The reserved parameter names of the bridge families and their one type.

``main.py`` registers every model parameter as ONE command-line flag for all
models, so ``catalog._validate_cross`` refuses a name that has two types. With
two dozen families landing in parallel, the shared names are fixed here before
any of them is written: a family reuses a reserved name with its reserved type,
or invents a new full-word name that no other family uses.

Rules a bridge parameter name follows (``check_parameter``, enforced for every
bridge entry by ``tests/test_cycle_bridges.py``):

1. it matches the registry's key pattern (lower case, digits, underscores);
2. a reserved name keeps its reserved type — the names every existing registry
   model already uses (``catalog.parameter_types()``) and the new shared ones in
   ``SHARED_PARAMETER_TYPES``;
3. a name in ``FORBIDDEN_NAMES`` is not used (each says what to use instead);
4. a new name is written in full words: none of its underscore-separated
   tokens is an abbreviation or a Greek letter from ``ABBREVIATION_TOKENS``
   (``discount_factor``, never ``gamma``; ``iteration_count``, never ``n_iter``).
"""

from __future__ import annotations

import re

# New shared names (2026-09-29): the parameters several bridge families have in common.
SHARED_PARAMETER_TYPES: dict[str, str] = {
    "discount_factor": "float",        # reward discount per step, 0..1
    "entropy_coefficient": "float",    # policy entropy bonus
    "latent_dimension": "int",         # size of a learned latent state
    "component_count": "int",          # mixture components
    "cluster_count": "int",            # clusters / discrete states
    "temperature": "float",            # a softmax or annealing temperature
    "path_count": "int",               # simulated paths per prediction
    "labeled_fraction": "float",       # share of training blocks whose labels are kept (semi-supervised)
    "bin_count": "int",                # quantile bins per feature or target
    "iteration_count": "int",          # solver / sampler iterations
    "population_size": "int",          # candidates per generation
    "history_bars": "int",             # bars of history a series model reads (fixed, never searched)
    "planning_horizon": "int",         # steps a planner looks ahead
    # names the existing registry already uses, repeated here because the bridges lean on them
    "learning_rate": "float",
    "epochs": "int",
    "patience": "int",
    "batch_size": "int",
    "hidden_size": "int",
    "layer_count": "int",
    "dropout": "float",
    "weight_decay": "float",
    "sequence_length": "int",
    "neighbor_count": "int",
    "kernel": "categorical",
    "embedding_size": "int",
}

FORBIDDEN_NAMES: dict[str, str] = {
    "window_bars": "use sequence_length (a window of bars a model reads) or history_bars (a series model's fixed history)",
    "gamma": "use discount_factor",
    "n_estimators": "use tree_count",
    "n_components": "use component_count",
    "n_clusters": "use cluster_count",
    "lr": "use learning_rate",
}

# Tokens that mark an abbreviated or Greek-letter name. A reserved name (above or already in the
# registry, e.g. max_depth) is allowed as it is; a NEW name may not contain these tokens.
ABBREVIATION_TOKENS = frozenset({
    "lr", "num", "n", "nb", "iter", "iters", "dim", "dims", "hid", "emb", "prob", "probs", "coef", "coeff",
    "cfg", "param", "params", "eps", "std", "avg", "tmp", "len", "idx", "thresh", "reg", "pct", "ms", "ts",
    "tf", "max", "min", "est", "obs", "act", "val", "vol", "ret", "rets", "mom", "freq", "pos", "neg",
    "alpha", "beta", "gamma", "delta", "epsilon", "eta", "theta", "lambda", "mu", "nu", "rho", "sigma",
    "tau", "phi", "psi", "omega", "kappa", "xi",
})

KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,39}$")


def reserved_types(registry_types: dict[str, str] | None = None) -> dict[str, str]:
    """Every reserved name and its type: the registry's own names
    (``catalog.parameter_types()`` unless ``registry_types`` is given) plus
    ``SHARED_PARAMETER_TYPES``. Raises ValueError when the two disagree."""
    if registry_types is None:
        from cycle import catalog

        registry_types = catalog.parameter_types()
    merged = dict(registry_types)
    for name, kind in SHARED_PARAMETER_TYPES.items():
        if name in merged and merged[name] != kind:
            raise ValueError(f"reserved parameter {name!r} is {kind} here but {merged[name]} in the registry")
        merged[name] = kind
    return merged


def check_parameter(name: str, kind: str, reserved: dict[str, str] | None = None) -> list[str]:
    """The problems with one bridge parameter (empty when it follows the rules)."""
    reserved = reserved_types() if reserved is None else reserved
    problems: list[str] = []
    if not KEY_PATTERN.match(name):
        problems.append(f"{name!r} does not match {KEY_PATTERN.pattern}")
    if name in FORBIDDEN_NAMES:
        problems.append(f"{name!r} is not used: {FORBIDDEN_NAMES[name]}")
    if name in reserved:
        if reserved[name] != kind:
            problems.append(f"{name!r} is reserved as {reserved[name]}, declared {kind}")
        return problems
    abbreviated = [token for token in name.split("_") if token in ABBREVIATION_TOKENS]
    if abbreviated:
        problems.append(f"{name!r} is not in full words (tokens {abbreviated})")
    return problems
