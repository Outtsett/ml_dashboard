"""Discrete factors and exact inference by variable elimination (numpy).

A ``Factor`` is a non-negative table over named discrete variables (one axis
per variable, in ``variables`` order). ``variable_elimination`` answers
P(query | evidence) on a product of factors: every factor is first reduced to
the evidence, then each remaining non-query variable is summed out in greedy
min-size order (the variable whose elimination builds the smallest factor goes
first), and the product of what is left is normalised. ``enumerate_joint`` is
the brute-force reference the tests hold it to.
"""

from __future__ import annotations

import itertools
import string
from dataclasses import dataclass

import numpy as np

LETTERS = string.ascii_letters


@dataclass
class Factor:
    variables: tuple[str, ...]
    table: np.ndarray

    def __post_init__(self) -> None:
        self.table = np.asarray(self.table, dtype=np.float64)
        if self.table.ndim != len(self.variables):
            raise ValueError(f"factor over {self.variables} has a {self.table.ndim}-dimensional table")

    def reduce(self, evidence: dict[str, int]) -> Factor:
        """Slice the observed variables out at their observed states."""
        index = tuple(evidence[name] if name in evidence else slice(None) for name in self.variables)
        kept = tuple(name for name in self.variables if name not in evidence)
        return Factor(kept, self.table[index])

    def sum_out(self, name: str) -> Factor:
        axis = self.variables.index(name)
        return Factor(tuple(v for v in self.variables if v != name), self.table.sum(axis=axis))


def multiply(factors: list[Factor]) -> Factor:
    """The product of factors over the union of their variables (einsum)."""
    union: list[str] = []
    for factor in factors:
        for name in factor.variables:
            if name not in union:
                union.append(name)
    if len(union) > len(LETTERS):
        raise ValueError(f"{len(union)} variables are too many for one product")
    letter = {name: LETTERS[position] for position, name in enumerate(union)}
    inputs = ",".join("".join(letter[name] for name in factor.variables) for factor in factors)
    output = "".join(letter[name] for name in union)
    return Factor(tuple(union), np.einsum(f"{inputs}->{output}", *[factor.table for factor in factors]))


def _cardinalities(factors: list[Factor]) -> dict[str, int]:
    sizes: dict[str, int] = {}
    for factor in factors:
        for name, size in zip(factor.variables, factor.table.shape):
            sizes[name] = size
    return sizes


def variable_elimination(factors: list[Factor], query: str, evidence: dict[str, int] | None = None) -> np.ndarray:
    """P(query | evidence) as a probability vector (exact)."""
    evidence = dict(evidence or {})
    working = [factor.reduce(evidence) for factor in factors]
    sizes = _cardinalities(working)
    hidden = [name for name in sizes if name != query]
    while hidden:
        def cost(name):
            involved = set()
            for factor in working:
                if name in factor.variables:
                    involved |= set(factor.variables)
            involved.discard(name)
            return int(np.prod([sizes[v] for v in involved])) if involved else 1, name

        name = min(hidden, key=cost)
        hidden.remove(name)
        touching = [factor for factor in working if name in factor.variables]
        rest = [factor for factor in working if name not in factor.variables]
        working = rest + [multiply(touching).sum_out(name)]
    result = multiply(working)
    if result.variables != (query,):
        result = Factor(result.variables, result.table)
        for name in result.variables:
            if name != query:
                result = result.sum_out(name)
    marginal = result.table.reshape(-1)
    total = marginal.sum()
    return marginal / total if total > 0 else np.full(marginal.shape, 1.0 / marginal.size)


def enumerate_joint(factors: list[Factor], query: str, evidence: dict[str, int] | None = None) -> np.ndarray:
    """Brute force: sum the full joint over every assignment consistent with the evidence."""
    evidence = dict(evidence or {})
    sizes = _cardinalities(factors)
    names = list(sizes)
    marginal = np.zeros(sizes[query])
    for assignment in itertools.product(*[range(sizes[name]) for name in names]):
        state = dict(zip(names, assignment))
        if any(state[name] != value for name, value in evidence.items()):
            continue
        weight = 1.0
        for factor in factors:
            weight *= factor.table[tuple(state[name] for name in factor.variables)]
        marginal[state[query]] += weight
    return marginal / marginal.sum()


__all__ = ["Factor", "enumerate_joint", "multiply", "variable_elimination"]
