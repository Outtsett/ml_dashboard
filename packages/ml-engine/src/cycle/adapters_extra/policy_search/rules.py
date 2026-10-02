"""Evolutionary decision models: genetic programming of trading rules (deap.gp).

A rule is a strongly typed tree over the bar's causal feature row:

    above(feature, threshold) / below(feature, threshold)    -> a condition
    both(rule, rule) / either(rule, rule) / negate(rule)      -> a condition
    always / never                                            -> a condition

(thresholds are ephemeral constants in z-score units, -2..2). A rule is
compiled once into a numpy function of the feature COLUMNS, so a population
is scored with one vectorised call per rule over every training bar, never
bar by bar. As a trader a rule is long when it fires and short when it does
not; its fitness is the tape's net utility per bar minus ``parsimony_penalty``
per node (bloat control), and trees deeper than ``maximum_tree_depth`` are
refused by the variation operators (``gp.staticLimit``).

Each generation: tournament selection, one-point subtree crossover
(``crossover_probability``), then mutation (``mutation_probability``): a new
random subtree or a threshold redrawn, half and half. A hall of fame keeps
the ``ensemble_size`` best distinct rules seen; the ensemble's score is the
share of its rules that fire, mapped to [-1, 1] (2 share - 1). The epoch's
``current`` is that ensemble, so choosing an epoch on validation chooses when
to stop evolving.

As a price model the fitness is the Huber loss of beta x (+1 / -1) against the
scaled move, beta the rule's own least-squares scale on the training bars;
the ensemble's value is beta_ensemble x its score.

DEAP draws from Python's ``random``; every call that draws runs inside the
evolver's private random state.
"""

from __future__ import annotations

import copy
import operator
from functools import lru_cache

import numpy as np

from .objective import HUBER_DELTA, Problem
from .randomness import GlobalRandomState

THRESHOLD_LOW, THRESHOLD_HIGH = -2.0, 2.0


class FeatureColumn:
    """The type of a feature column (a float array over bars)."""


class Threshold:
    """The type of a threshold constant (z-score units)."""


class Condition:
    """The type of a rule (a bool array over bars)."""


def _above(column, threshold):
    return column > threshold


def _below(column, threshold):
    return column < threshold


def _both(first, second):
    return np.logical_and(first, second)


def _either(first, second):
    return np.logical_or(first, second)


def _negate(condition):
    return np.logical_not(condition)


def _threshold():
    import random

    return round(random.uniform(THRESHOLD_LOW, THRESHOLD_HIGH), 2)


@lru_cache(maxsize=None)
def primitive_set(feature_count: int):
    """The typed primitive set over ``feature_count`` columns (arguments feature_0 ...)."""
    from deap import gp

    primitives = gp.PrimitiveSetTyped("policy_rule", [FeatureColumn] * int(feature_count), Condition, "feature_")
    primitives.addPrimitive(_above, [FeatureColumn, Threshold], Condition, name="above")
    primitives.addPrimitive(_below, [FeatureColumn, Threshold], Condition, name="below")
    primitives.addPrimitive(_both, [Condition, Condition], Condition, name="both")
    primitives.addPrimitive(_either, [Condition, Condition], Condition, name="either")
    primitives.addPrimitive(_negate, [Condition], Condition, name="negate")
    primitives.addTerminal(True, Condition, name="always")
    primitives.addTerminal(False, Condition, name="never")
    primitives.addEphemeralConstant("policy_search_threshold", _threshold, Threshold)
    return primitives


def generate(primitives, minimum_depth: int, maximum_depth: int, type_=None):
    """``gp.genGrow`` for a typed set some of whose types have no primitive
    (a feature column, a threshold): such a slot always takes a terminal."""
    import random

    from deap import gp

    type_ = primitives.ret if type_ is None else type_
    expression = []
    height = random.randint(minimum_depth, maximum_depth)
    stack = [(0, type_)]
    while stack:
        depth, kind = stack.pop()
        leaf = (not primitives.primitives[kind] or depth == height
                or (depth >= minimum_depth and random.random() < primitives.terminalRatio))
        if leaf and primitives.terminals[kind]:
            terminal = random.choice(primitives.terminals[kind])
            if isinstance(terminal, gp.MetaEphemeral):
                terminal = terminal()
            expression.append(terminal)
        else:
            primitive = random.choice(primitives.primitives[kind])
            expression.append(primitive)
            for argument in reversed(primitive.args):
                stack.append((depth + 1, argument))
    return expression


@lru_cache(maxsize=8192)
def compile_rule(text: str, feature_count: int):
    """The numpy function of a rule's text: f(*columns) -> bool array (or a bool)."""
    from deap import gp

    return gp.compile(text, primitive_set(int(feature_count)))


def fires(function, inputs: np.ndarray) -> np.ndarray:
    """One vectorised call of a compiled rule over the (n, F) rows."""
    result = function(*[inputs[:, column] for column in range(inputs.shape[1])])
    return np.broadcast_to(np.asarray(result, dtype=bool), (inputs.shape[0],)).copy()


def readable(text: str, names) -> str:
    """The rule with the feature arguments replaced by their column names (for the log and model.json)."""
    import re

    names = list(names or [])

    def swap(match):
        index = int(match.group(1))
        return names[index] if index < len(names) else match.group(0)

    return re.sub(r"\bfeature_(\d+)\b", swap, text)


class RuleEnsemblePolicy:
    """score = 2 x (share of the rules that fire) - 1; ``scale`` x score is the price model's value."""

    def __init__(self, rules: list[str], feature_count: int, scale: float = 1.0) -> None:
        self.rules = list(rules)
        self.feature_count = int(feature_count)
        self.scale = float(scale)
        self._functions = None

    @property
    def functions(self):
        if self._functions is None:
            self._functions = [compile_rule(text, self.feature_count) for text in self.rules]
        return self._functions

    def score(self, features: np.ndarray, index) -> np.ndarray:
        rows = np.asarray(index, dtype=np.int64).reshape(-1)
        block = np.asarray(features[rows], dtype=np.float64)
        out = np.full(rows.shape[0], np.nan)
        known = np.all(np.isfinite(block), axis=1)
        if known.any() and self.rules:
            votes = np.zeros(int(known.sum()))
            for function in self.functions:
                votes += fires(function, block[known])
            out[known] = 2.0 * votes / len(self.rules) - 1.0
        return out

    def copy(self) -> RuleEnsemblePolicy:
        return RuleEnsemblePolicy(list(self.rules), self.feature_count, self.scale)

    def to_dict(self) -> dict:
        return {"form": "rules", "rules": list(self.rules), "feature_count": self.feature_count, "scale": self.scale}

    @classmethod
    def from_dict(cls, document: dict) -> RuleEnsemblePolicy:
        return cls(list(document["rules"]), int(document["feature_count"]), float(document.get("scale", 1.0)))


def _huber(residual: np.ndarray) -> np.ndarray:
    absolute = np.abs(residual)
    return np.where(absolute <= HUBER_DELTA, 0.5 * residual * residual, HUBER_DELTA * (absolute - 0.5 * HUBER_DELTA))


def least_squares_scale(score: np.ndarray, target: np.ndarray) -> float:
    """beta minimising sum (beta s - y)^2 through the origin (0 when s is all zero)."""
    denominator = float(score @ score)
    return float(score @ target) / denominator if denominator > 0 else 0.0


class RuleEvolver:
    """Genetic programming over rule trees against a ``Problem`` (utility or huber)."""

    name = "genetic programming of decision rules"

    def __init__(self, problem: Problem, parameters: dict, seed: int) -> None:
        from deap import base, gp, tools

        if problem.kind not in ("utility", "huber"):
            raise ValueError(f"rules are evolved against a utility or a huber problem, not {problem.kind!r}")
        self.problem = problem
        self.parameters = dict(parameters)
        self.feature_count = problem.feature_count
        self.primitives = primitive_set(self.feature_count)
        self.random_state = GlobalRandomState(int(seed) + 5)
        depth = max(1, int(self.parameters["maximum_tree_depth"]))

        class RuleFitness(base.Fitness):
            weights = (1.0,)

        class RuleTree(gp.PrimitiveTree):
            def __init__(self, content):
                super().__init__(content)
                self.fitness = RuleFitness()

        self.tree_class = RuleTree
        toolbox = base.Toolbox()
        toolbox.register("expression", generate, self.primitives, 1, depth)
        toolbox.register("mutation_expression",
                         lambda pset, type_: generate(pset, 0, max(1, depth - 1), type_))
        toolbox.register("select", tools.selTournament, tournsize=int(self.parameters["tournament_size"]))
        toolbox.register("mate", gp.cxOnePoint)
        toolbox.register("mutate_subtree", gp.mutUniform, expr=toolbox.mutation_expression, pset=self.primitives)
        toolbox.register("mutate_threshold", gp.mutEphemeral, mode="one")
        limit = gp.staticLimit(key=operator.attrgetter("height"), max_value=depth)
        for name in ("mate", "mutate_subtree"):
            toolbox.decorate(name, limit)
        self.toolbox = toolbox
        self.hall = tools.HallOfFame(max(1, int(self.parameters["ensemble_size"])),
                                     similar=lambda first, second: str(first) == str(second))
        self.generation = 0
        self.evaluations = 0
        self.statistics: dict = {}
        with self.random_state.active():
            self.population = [RuleTree(toolbox.expression())
                               for _ in range(max(4, int(self.parameters["population_size"])))]
        self._score(self.population)
        self.hall.update(self.population)
        self.current = self._ensemble()

    # ── fitness ──
    def rule_positions(self, individuals) -> np.ndarray:
        """(n, population) positions: +1 where a rule fires, -1 where it does not."""
        inputs = self.problem.inputs
        out = np.empty((inputs.shape[0], len(individuals)))
        for column, individual in enumerate(individuals):
            out[:, column] = np.where(fires(compile_rule(str(individual), self.feature_count), inputs), 1.0, -1.0)
        return out

    def _score(self, individuals) -> None:
        if not individuals:
            return
        positions = self.rule_positions(individuals)
        sizes = np.array([len(individual) for individual in individuals], dtype=np.float64)
        penalty = float(self.parameters["parsimony_penalty"]) * sizes
        if self.problem.kind == "utility":
            value = self.problem.utility_from_positions(positions)
        else:
            target = self.problem.target
            betas = positions.T @ target / max(positions.shape[0], 1)          # positions are +-1, so s.s = n
            value = -_huber(positions * betas[None, :] - target[:, None]).mean(axis=0)
        fitness = np.where(np.isfinite(value), value, -1e12) - penalty
        self.evaluations += len(individuals)
        for individual, score in zip(individuals, fitness):
            individual.fitness.values = (float(score),)

    def _ensemble(self) -> RuleEnsemblePolicy:
        policy = RuleEnsemblePolicy([str(individual) for individual in self.hall], self.feature_count)
        if self.problem.kind == "huber":
            rows = np.arange(self.problem.row_count)
            score = policy.score(self.problem.inputs, rows)
            policy.scale = least_squares_scale(score, self.problem.target)
        return policy

    # ── one generation ──
    def step(self) -> float:
        self.generation += 1
        toolbox = self.toolbox
        crossover = float(self.parameters["crossover_probability"])
        mutation = float(self.parameters["mutation_probability"])
        with self.random_state.active():
            import random

            offspring = [copy.deepcopy(individual) for individual in toolbox.select(self.population, len(self.population))]
            for first, second in zip(offspring[::2], offspring[1::2]):
                if random.random() < crossover:
                    toolbox.mate(first, second)
                    del first.fitness.values, second.fitness.values
            for position, child in enumerate(offspring):
                if random.random() < mutation:
                    operator_name = "mutate_subtree" if random.random() < 0.5 else "mutate_threshold"
                    (mutated,) = getattr(toolbox, operator_name)(child)
                    offspring[position] = mutated
                    del mutated.fitness.values
        self._score([child for child in offspring if not child.fitness.valid])
        self.population = offspring
        self.hall.update(self.population)
        self.current = self._ensemble()
        fitness = np.array([individual.fitness.values[0] for individual in self.population])
        self.statistics = {"population_mean_fitness": float(np.mean(fitness)),
                           "mean_rule_size": float(np.mean([len(individual) for individual in self.population]))}
        return -float(self.hall[0].fitness.values[0])


__all__ = ["RuleEnsemblePolicy", "RuleEvolver", "compile_rule", "fires", "generate", "least_squares_scale",
           "primitive_set", "readable"]
