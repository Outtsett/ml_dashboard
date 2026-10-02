"""Symbolic regression: genetic programming of a closed-form formula (gplearn).

``gplearn.genetic.SymbolicRegressor`` evolves expression trees over the
feature columns (functions ``FUNCTIONS``, constants in [-1, 1]) to fit the
scaled h-bar move of the TRAINING bars: ramped half-and-half initial trees
up to ``initial_tree_depth``, tournament selection (``tournament_size``),
subtree crossover (``crossover_probability``), subtree / hoist / point
mutation, and ``parsimony_penalty`` per node against bloat; fitness is the
mean absolute error. The regressor is stepped one generation per engine
epoch with ``warm_start`` (gplearn replays its seeds, so the run equals one
long fit); the epoch's ``current`` is that generation's best formula.

The formula is saved as its token list (functions by name, feature indices,
constants) and evaluated here with gplearn's own protected functions
(division and logarithm return 1 and 0 near zero, square root takes |x|), so
a reloaded model computes exactly what the regressor computed without
pickling it.
"""

from __future__ import annotations

import numpy as np

FUNCTIONS = ("add", "sub", "mul", "div", "neg", "abs", "max", "min", "sqrt", "log")
CONSTANT_RANGE = (-1.0, 1.0)


def _function_map():
    from gplearn.functions import _function_map

    return _function_map


def tokens_of(program) -> list[dict]:
    """A gplearn ``_Program``'s prefix list as JSON-able tokens."""
    from gplearn.functions import _Function

    out: list[dict] = []
    for node in program.program:
        if isinstance(node, _Function):
            out.append({"function": node.name, "arity": int(node.arity)})
        elif isinstance(node, (int, np.integer)):
            out.append({"feature": int(node)})
        else:
            out.append({"constant": float(node)})
    return out


def evaluate(tokens: list[dict], inputs: np.ndarray) -> np.ndarray:
    """The formula over (n, F) rows (gplearn's ``_Program.execute``, token by token)."""
    inputs = np.asarray(inputs, dtype=np.float64)
    count = inputs.shape[0]

    def terminal(token):
        if "feature" in token:
            return inputs[:, token["feature"]]
        return np.repeat(float(token["constant"]), count)

    if not tokens:
        return np.full(count, np.nan)
    first = tokens[0]
    if "function" not in first:
        return np.array(terminal(first), dtype=np.float64)
    functions = _function_map()
    stack: list[list] = []
    for token in tokens:
        if "function" in token:
            stack.append([token])
        else:
            stack[-1].append(terminal(token))
        while len(stack[-1]) == stack[-1][0]["arity"] + 1:
            head = stack[-1][0]
            with np.errstate(all="ignore"):
                result = functions[head["function"]](*stack[-1][1:])
            if len(stack) != 1:
                stack.pop()
                stack[-1].append(result)
            else:
                return np.asarray(result, dtype=np.float64)
    raise ValueError("a formula token list that never closes")


def readable(tokens: list[dict], names=None) -> str:
    """The formula in prefix form with feature names (for the log and model.json)."""
    names = list(names or [])
    position = 0

    def walk() -> str:
        nonlocal position
        token = tokens[position]
        position += 1
        if "function" in token:
            arguments = [walk() for _ in range(token["arity"])]
            return f"{token['function']}({', '.join(arguments)})"
        if "feature" in token:
            index = token["feature"]
            return names[index] if index < len(names) else f"X{index}"
        return f"{token['constant']:.3f}"

    return walk() if tokens else ""


class FormulaPolicy:
    """score = the formula's value (NaN on a row with a missing feature); ``scale`` is kept at 1."""

    def __init__(self, tokens: list[dict], feature_count: int) -> None:
        self.tokens = [dict(token) for token in tokens]
        self.feature_count = int(feature_count)

    @property
    def node_count(self) -> int:
        return len(self.tokens)

    def score(self, features: np.ndarray, index) -> np.ndarray:
        rows = np.asarray(index, dtype=np.int64).reshape(-1)
        block = np.asarray(features[rows], dtype=np.float64)
        out = np.full(rows.shape[0], np.nan)
        known = np.all(np.isfinite(block), axis=1)
        if known.any():
            values = evaluate(self.tokens, block[known])
            values[~np.isfinite(values)] = np.nan
            out[known] = values
        return out

    def copy(self) -> FormulaPolicy:
        return FormulaPolicy(self.tokens, self.feature_count)

    def to_dict(self) -> dict:
        return {"form": "formula", "tokens": [dict(token) for token in self.tokens], "feature_count": self.feature_count}

    @classmethod
    def from_dict(cls, document: dict) -> FormulaPolicy:
        return cls(list(document["tokens"]), int(document["feature_count"]))


class FormulaEvolver:
    """gplearn's SymbolicRegressor on (inputs, target), one generation per ``step()``."""

    name = "symbolic regression"

    def __init__(self, inputs: np.ndarray, target: np.ndarray, parameters: dict, seed: int) -> None:
        from gplearn.genetic import SymbolicRegressor

        self.inputs = np.asarray(inputs, dtype=np.float64)
        self.target = np.asarray(target, dtype=np.float64)
        self.parameters = dict(parameters)
        self.feature_count = int(self.inputs.shape[1])
        crossover = float(self.parameters["crossover_probability"])
        mutation = max(0.0, (1.0 - crossover) / 3.0 - 1e-9)
        self.regressor = SymbolicRegressor(
            population_size=max(10, int(self.parameters["population_size"])), generations=0,
            tournament_size=max(2, int(self.parameters["tournament_size"])), stopping_criteria=0.0,
            const_range=CONSTANT_RANGE, init_depth=(2, max(2, int(self.parameters["initial_tree_depth"]))),
            init_method="half and half", function_set=FUNCTIONS, metric="mean absolute error",
            parsimony_coefficient=float(self.parameters["parsimony_penalty"]), p_crossover=crossover,
            p_subtree_mutation=mutation, p_hoist_mutation=mutation, p_point_mutation=mutation, p_point_replace=0.05,
            max_samples=1.0, warm_start=True, n_jobs=1, verbose=0, random_state=int(seed) % (2 ** 31),
            low_memory=True,
        )
        self.generation = 0
        self.statistics: dict = {}
        self.current: FormulaPolicy | None = None

    def step(self) -> float:
        import warnings

        self.generation += 1
        self.regressor.set_params(generations=self.generation)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.regressor.fit(self.inputs, self.target)
        program = self.regressor._program
        self.current = FormulaPolicy(tokens_of(program), self.feature_count)
        self.statistics = {"formula_nodes": int(program.length_), "formula_depth": int(program.depth_)}
        return float(program.raw_fitness_)


__all__ = ["CONSTANT_RANGE", "FUNCTIONS", "FormulaEvolver", "FormulaPolicy", "evaluate", "readable", "tokens_of"]
