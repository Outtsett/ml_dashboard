"""The grounded predicates every symbolic engine reasons over, and rule mining.

A **predicate** is one test ``input operator threshold`` whose truth at bar t
reads only bars <= t:

- the atoms of ``packages/config/cycle_rules.json`` (``cycle.bridges.rules``): causal
  indicators of the closes (``source`` ``indicator``) and named raw feature
  columns (``source`` ``feature``, read from the bound view by name; a column
  the run does not carry was disabled with a logged line when the bank was
  built, and a column missing at predict — the explainer keeps no raw values —
  reads as unknown, never as a substitute);
- **induced** predicates on the model's own feature columns (``source``
  ``column``): "column above its training 2/3 quantile" and "below its 1/3
  quantile" for the ``induced_feature_count`` columns whose two tails differ
  most in their training up-rate. Their suggested direction is the tail's own
  training up-rate against the base rate (rule induction on the training span,
  the honest stand-in where no expert wrote the rule).

Thresholds, soft-truth widths and suggested directions are fixed on training
rows only (``PredicateBank.build``). Truth is 1.0 / 0.0 / NaN (unknown input);
the soft truth (degree) is the logistic of the signed distance past the
threshold over the width.

``mine_rules`` ranks conjunctions of one or two predicates by how far their
training up-rate sits from the base rate (a z-score over the smoothed rate),
keeping rules that fired at least ``minimum_fire_count`` times; the config
file's own rules are always offered with their training calibration.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from cycle.bridges import rules

INDUCED_LOW_QUANTILE = 1.0 / 3.0
INDUCED_HIGH_QUANTILE = 2.0 / 3.0
DIRECTIONS = ("up", "down", "none")


@dataclass(frozen=True)
class Predicate:
    name: str
    source: str          # indicator | feature | column
    input: str           # indicator name, raw feature name, or model column name
    column: int          # the model matrix column for source "column", else -1
    operator: str
    threshold: float
    suggests: str        # up | down | none
    width: float         # soft-truth width in the input's units (training rows)

    @property
    def sign(self) -> float:
        return 1.0 if self.suggests == "up" else -1.0 if self.suggests == "down" else 0.0

    def truth(self, values: np.ndarray) -> np.ndarray:
        values = np.asarray(values, dtype=np.float64)
        comparisons = {"<": np.less, "<=": np.less_equal, ">": np.greater, ">=": np.greater_equal}
        with np.errstate(invalid="ignore"):
            out = comparisons[self.operator](values, self.threshold).astype(np.float64)
        out[~np.isfinite(values)] = np.nan
        return out

    def degree(self, values: np.ndarray) -> np.ndarray:
        values = np.asarray(values, dtype=np.float64)
        direction = 1.0 if self.operator in (">", ">=") else -1.0
        with np.errstate(invalid="ignore", over="ignore"):
            z = np.clip(direction * (values - self.threshold) / max(self.width, 1e-12), -500.0, 500.0)
            out = 1.0 / (1.0 + np.exp(-z))
        out[~np.isfinite(values)] = np.nan
        return out

    def to_dict(self) -> dict:
        return {"name": self.name, "source": self.source, "input": self.input, "column": int(self.column),
                "operator": self.operator, "threshold": float(self.threshold), "suggests": self.suggests,
                "width": float(self.width)}

    @classmethod
    def from_dict(cls, document: dict) -> Predicate:
        return cls(document["name"], document["source"], document["input"], int(document["column"]),
                   document["operator"], float(document["threshold"]), document["suggests"], float(document["width"]))


@dataclass(frozen=True)
class Rule:
    """A conjunction of predicates (indices into the bank) with its training calibration."""

    name: str
    atoms: tuple[int, ...]
    conclusion: str       # up | down
    rate: float           # smoothed training up-rate when the rule fires
    support: int          # training rows it fired on
    strength: float       # z-score of the smoothed rate against the base rate
    source: str           # config | mined

    def to_dict(self) -> dict:
        return {"name": self.name, "atoms": list(self.atoms), "conclusion": self.conclusion, "rate": float(self.rate),
                "support": int(self.support), "strength": float(self.strength), "source": self.source}

    @classmethod
    def from_dict(cls, document: dict) -> Rule:
        return cls(document["name"], tuple(int(a) for a in document["atoms"]), document["conclusion"],
                   float(document["rate"]), int(document["support"]), float(document["strength"]), document["source"])


def _width(values: np.ndarray) -> float:
    values = values[np.isfinite(values)]
    if values.size < 2:
        return 1.0
    spread = float(np.quantile(values, 0.75) - np.quantile(values, 0.25)) / 2.0
    if not math.isfinite(spread) or spread <= 1e-12:
        spread = float(np.std(values))
    return spread if math.isfinite(spread) and spread > 1e-12 else 1.0


def up_target(targets: np.ndarray) -> np.ndarray:
    """1.0 up / 0.0 down / NaN from a label (0/1) or a signed price target."""
    targets = np.asarray(targets, dtype=np.float64)
    out = np.full(targets.shape, np.nan)
    finite = np.isfinite(targets)
    if finite.any() and np.all(np.isin(targets[finite], (0.0, 1.0))):
        out[finite] = targets[finite]
    else:
        out[finite & (targets > 0)] = 1.0
        out[finite & (targets < 0)] = 0.0
    return out


class PredicateBank:
    """The predicates of one fitted model plus the config rules they support."""

    def __init__(self, predicates: list[Predicate], config_rules: list[dict], indicators: dict[str, dict],
                 disabled: dict[str, str]) -> None:
        self.predicates = predicates
        self.config_rules = config_rules          # {"name", "atoms" (indices), "conclusion"}
        self.indicators = indicators
        self.disabled = disabled

    @property
    def names(self) -> list[str]:
        return [predicate.name for predicate in self.predicates]

    @property
    def signs(self) -> np.ndarray:
        return np.array([predicate.sign for predicate in self.predicates], dtype=np.float64)

    # ── building on the training span ──
    @classmethod
    def build(cls, view, features: np.ndarray, train_rows: np.ndarray, direction: np.ndarray,
              induced_feature_count: int, log=None) -> PredicateBank:
        """``train_rows`` training rows with a known ``direction`` (1 up / 0 down)."""
        rows = np.asarray(train_rows, dtype=np.int64)
        names = list(view.feature_names)
        library = rules.RuleLibrary.load().resolve(names, raw_available=view.raw_features is not None, log=log)
        fitted = library.fit(view, rows)
        values = fitted.inputs(view)
        predicates: list[Predicate] = []
        for atom in fitted.atoms:
            if atom.threshold is None or not math.isfinite(float(atom.threshold)):
                continue
            predicates.append(Predicate(atom.name, atom.source, atom.input, -1, atom.operator, float(atom.threshold),
                                        atom.suggests, _width(np.asarray(values[atom.input], dtype=np.float64)[rows])))
        predicates += cls._induced(features, names, rows, direction, int(induced_feature_count))
        position = {predicate.name: index for index, predicate in enumerate(predicates)}
        config_rules = []
        for rule in fitted.rules:
            if all(name in position for name in rule.when):
                config_rules.append({"name": rule.name, "atoms": [position[name] for name in rule.when],
                                     "conclusion": rule.conclusion})
        return cls(predicates, config_rules, dict(fitted.indicators), dict(fitted.disabled))

    @staticmethod
    def _induced(features, names, rows, direction, count) -> list[Predicate]:
        if count <= 0:
            return []
        target = np.asarray(direction, dtype=np.float64)[rows]
        known = np.isfinite(target)
        base = float(np.mean(target[known])) if known.any() else 0.5
        candidates = []
        for column in range(features.shape[1]):
            values = np.asarray(features[rows, column], dtype=np.float64)
            usable = known & np.isfinite(values)
            if usable.sum() < 30:
                continue
            low, high = np.quantile(values[usable], (INDUCED_LOW_QUANTILE, INDUCED_HIGH_QUANTILE))
            if not high > low:
                continue
            upper = usable & (values > high)
            lower = usable & (values < low)
            if upper.sum() < 5 or lower.sum() < 5:
                continue
            rate_upper = float(np.mean(target[upper]))
            rate_lower = float(np.mean(target[lower]))
            candidates.append((abs(rate_upper - rate_lower), column, float(low), float(high), rate_upper, rate_lower,
                               _width(values[usable])))
        candidates.sort(key=lambda item: (-item[0], item[1]))
        chosen = []
        for _, column, low, high, rate_upper, rate_lower, width in candidates[:count]:
            name = str(names[column]) if column < len(names) else f"column_{column}"
            upper_says = "up" if rate_upper > base else "down"
            lower_says = "up" if rate_lower > base else "down"
            chosen.append(Predicate(f"induced_{name}_high", "column", name, column, ">", high, upper_says, width))
            chosen.append(Predicate(f"induced_{name}_low", "column", name, column, "<", low, lower_says, width))
        return chosen

    # ── evaluation (reads rows <= each asked row only) ──
    def values(self, view, features: np.ndarray, rows, cache: dict) -> np.ndarray:
        """(len(rows), predicate count) raw input values; ``cache`` holds the
        indicator series of the bound view (the caller clears it on a new view)."""
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, len(self.predicates)), np.nan)
        for index, predicate in enumerate(self.predicates):
            if predicate.source == "column":
                if predicate.column < features.shape[1]:
                    out[:, index] = features[rows, predicate.column]
                continue
            if view is None:
                continue
            key = (predicate.source, predicate.input)
            if key not in cache:
                if predicate.source == "indicator":
                    cache[key] = rules.indicator_values(predicate.input, view, self.indicators.get(predicate.input, {}))
                else:
                    cache[key] = view.feature_column(predicate.input)
            series = cache[key]
            if series is not None:
                out[:, index] = np.asarray(series, dtype=np.float64)[rows]
        return out

    def truth(self, values: np.ndarray) -> np.ndarray:
        if not self.predicates:
            return np.empty((values.shape[0], 0))
        return np.column_stack([predicate.truth(values[:, index]) for index, predicate in enumerate(self.predicates)])

    def degree(self, values: np.ndarray) -> np.ndarray:
        if not self.predicates:
            return np.empty((values.shape[0], 0))
        return np.column_stack([predicate.degree(values[:, index]) for index, predicate in enumerate(self.predicates)])

    def to_dict(self) -> dict:
        return {"predicates": [predicate.to_dict() for predicate in self.predicates], "configRules": self.config_rules,
                "indicators": self.indicators, "disabled": self.disabled}

    @classmethod
    def from_dict(cls, document: dict) -> PredicateBank:
        return cls([Predicate.from_dict(item) for item in document["predicates"]], list(document["configRules"]),
                   dict(document["indicators"]), dict(document["disabled"]))


# ─── rule mining on the training span ───────────────────────────────────────


def smoothed_rate(up_count, fire_count, base: float, pseudo_count: float):
    return (np.asarray(up_count, dtype=np.float64) + pseudo_count * base) / (np.asarray(fire_count, dtype=np.float64) + pseudo_count)


def rule_strength(rate, fire_count, base: float, pseudo_count: float):
    spread = math.sqrt(max(base * (1.0 - base), 1e-9))
    return (np.asarray(rate) - base) / (spread / np.sqrt(np.asarray(fire_count, dtype=np.float64) + pseudo_count))


def fired(truth: np.ndarray, atoms) -> np.ndarray:
    """1.0 when every atom is true, 0.0 when one is false, NaN when none is false and one is unknown."""
    parts = truth[:, list(atoms)]
    out = np.all(parts == 1.0, axis=1).astype(np.float64)
    unknown = np.any(np.isnan(parts), axis=1) & ~np.any(parts == 0.0, axis=1)
    out[unknown] = np.nan
    return out


def mine_rules(bank: PredicateBank, truth: np.ndarray, target: np.ndarray, *, atom_order: int, minimum_fire_count: int,
               rule_count: int, pseudo_count: float) -> tuple[list[Rule], float]:
    """Rules ranked by |strength| (config rules offered first, then the mined
    conjunctions); returns (rules, base rate). ``truth`` and ``target`` are
    training rows; an unknown atom never fires."""
    target = np.asarray(target, dtype=np.float64)
    known = np.isfinite(target)
    truth = truth[known]
    target = target[known]
    base = float(np.mean(target)) if target.size else 0.5
    base = min(max(base, 1e-3), 1 - 1e-3)
    fire = (truth == 1.0).astype(np.float64)
    candidates: dict[tuple[int, ...], str] = {}
    for rule in bank.config_rules:
        candidates.setdefault(tuple(sorted(int(a) for a in rule["atoms"])), "config:" + rule["name"])
    count = fire.shape[1]
    singles_fire = fire.sum(axis=0)
    singles_up = fire.T @ target
    for atom in range(count):
        candidates.setdefault((atom,), "")
    pair_fire = pair_up = None
    if atom_order >= 2 and count >= 2:
        pair_fire = fire.T @ fire
        pair_up = (fire * target[:, None]).T @ fire
        for first in range(count):
            for second in range(first + 1, count):
                candidates.setdefault((first, second), "")
    out: list[Rule] = []
    names = bank.names
    for atoms, label in candidates.items():
        if len(atoms) == 1:
            fires, ups = singles_fire[atoms[0]], singles_up[atoms[0]]
        elif len(atoms) == 2 and pair_fire is not None:
            fires, ups = pair_fire[atoms[0], atoms[1]], pair_up[atoms[0], atoms[1]]
        else:
            mask = np.all(fire[:, list(atoms)] == 1.0, axis=1)
            fires, ups = float(mask.sum()), float(target[mask].sum())
        source = "config" if label.startswith("config:") else "mined"
        if fires < minimum_fire_count and source == "mined":
            continue
        if fires <= 0:
            continue
        rate = float(smoothed_rate(ups, fires, base, pseudo_count))
        strength = float(rule_strength(rate, fires, base, pseudo_count))
        name = label[len("config:"):] if source == "config" else " and ".join(names[a] for a in atoms)
        out.append(Rule(name, tuple(atoms), "up" if rate >= base else "down", rate, int(fires), strength, source))
    out.sort(key=lambda rule: (-abs(rule.strength), rule.atoms))
    return out[: max(1, int(rule_count))], base


__all__ = ["DIRECTIONS", "Predicate", "PredicateBank", "Rule", "fired", "mine_rules", "rule_strength", "smoothed_rate",
           "up_target"]
