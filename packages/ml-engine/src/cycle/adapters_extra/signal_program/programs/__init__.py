"""The programs of the ``signal_program`` family, one module each.

Every program is a generator function

    solve(statistics, parameters, log, task) -> yields PassUpdate ..., returns ProgramResult

``statistics`` is a ``SignalStatistics`` of the training span, ``parameters``
the resolved registry parameters, ``log`` a callable taking one ASCII line,
``task`` "classification" (direction model) or "regression" (price model):
only the interior-point program fits a different loss per task.
An iterative program (augmented Lagrangian, dual decomposition, Lagrangian
relaxation, branch and bound) yields a ``PassUpdate`` after every solver pass
but the last, which it returns; the adapter reports one epoch per pass and
checks for Pause / Stop between passes. A one-shot program (``one_shot``)
returns at once. Weights are full length (one per feature column), zero for a
signal the program leaves out.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from typing import Callable, Iterator

import numpy as np


@dataclass
class ProgramResult:
    weights: np.ndarray
    status: str
    objective: float
    intercept: float = 0.0
    #: "linear": s = w . x + intercept is a score (P(up) from a validation curve, price = beta * s);
    #: "native": for a classifier P(up) = sigmoid(s), for a price model s is the forecast itself
    link: str = "linear"
    diagnostics: dict = field(default_factory=dict)


@dataclass
class PassUpdate:
    pass_number: int
    pass_count: int
    weights: np.ndarray
    objective: float
    violation: float | None = None
    intercept: float = 0.0


Program = Callable[..., Iterator[PassUpdate]]

VARIANT_MODULES = {
    "lp": "linear",
    "ilp": "integer",
    "mip": "mixed_integer",
    "qp": "quadratic",
    "interior_point": "interior_point",
    "convex_cvar": "conditional_value_at_risk",
    "augmented_lagrangian": "augmented_lagrangian",
    "dual_decomposition": "dual_decomposition",
    "lagrangian_relaxation": "lagrangian_relaxation",
    "branch_and_bound": "branch_and_bound",
    "greedy": "greedy",
    "submodular": "submodular",
}
VARIANTS = tuple(VARIANT_MODULES)


def program(variant: str) -> Program:
    """The ``solve`` generator of a variant."""
    if variant not in VARIANT_MODULES:
        raise ValueError(f"unknown signal program {variant!r}; known: {', '.join(VARIANTS)}")
    module = importlib.import_module(f"{__name__}.{VARIANT_MODULES[variant]}")
    return module.solve


def planned_passes(variant: str, parameters: dict) -> int:
    """How many solver passes the variant plans (the epoch count the chart shows)."""
    module = importlib.import_module(f"{__name__}.{VARIANT_MODULES[variant]}")
    planner = getattr(module, "planned_passes", None)
    return max(1, int(planner(parameters))) if planner is not None else 1


def one_shot(function: Callable[..., ProgramResult]) -> Program:
    """A program solved in one call, as a generator that yields nothing."""

    def solve(statistics, parameters, log, task="classification"):
        return function(statistics, parameters, log, task=task)
        yield  # noqa: B901 - unreachable: makes this a generator function

    solve.__doc__ = function.__doc__
    solve.__name__ = function.__name__
    return solve


def run_to_end(solve: Program, statistics, parameters: dict, log=lambda message: None,
               task: str = "classification") -> ProgramResult:
    """Drive a program to its result without reporting (tests, tools)."""
    generator = solve(statistics, parameters, log, task)
    while True:
        try:
            next(generator)
        except StopIteration as finished:
            return finished.value


def split_passes(iteration_count: int, maximum_passes: int = 20) -> tuple[int, int]:
    """(pass count, iterations per pass) for ``iteration_count`` iterations."""
    iteration_count = max(1, int(iteration_count))
    passes = min(maximum_passes, iteration_count)
    per_pass = -(-iteration_count // passes)
    return -(-iteration_count // per_pass), per_pass


def number(value: float) -> str:
    """A float for an ASCII log line."""
    value = float(value)
    if not np.isfinite(value):
        return str(value)
    return f"{value:.6g}"


def selected_names(statistics, weights: np.ndarray, limit: int = 8) -> str:
    order = np.argsort(-np.abs(weights), kind="stable")
    chosen = [f"{statistics.names[column]}={number(weights[column])}" for column in order[:limit]
              if weights[column] != 0.0]
    more = int(np.count_nonzero(weights)) - len(chosen)
    return (", ".join(chosen) or "none") + (f" (+{more} more)" if more > 0 else "")


__all__ = ["PassUpdate", "ProgramResult", "VARIANTS", "number", "one_shot", "planned_passes", "program", "run_to_end",
           "selected_names", "split_passes"]
