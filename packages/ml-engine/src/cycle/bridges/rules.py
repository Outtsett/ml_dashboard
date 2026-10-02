"""The predicate (atom) library the symbolic families reason over.

Read from ``packages/config/cycle_rules.json`` (its ``description`` is the schema).
An **atom** is one test, ``input operator threshold``, on either

- a raw feature column named in the run (``source: "feature"``), read from
  ``MarketView.raw_features`` by name. A name the run does not carry disables
  that atom (and every rule that needs it) with one logged line — never a
  crash, never a silent substitute; or
- a causal indicator of the closes (``source: "indicator"``): the relative
  strength index, the MACD histogram, the Bollinger band position, the
  least-squares trend slope and the volatility ratio, computed here.

A threshold is a number in the input's own units, or ``trainQuantile``: the
quantile of the input over the TRAINING rows, fitted per fold by
``ResolvedLibrary.fit`` (the only step that reads more than one row).

Causality: every indicator at row t reads closes (and the causal move scale)
at rows <= t only — trailing windows with ``min_periods`` equal to the window,
exponential smoothing that starts at the first bar — so an atom's truth at t
is the same on any prefix of the bars that contains t (``tests`` check it).
Warm-up rows are NaN, and an atom on a NaN input is NaN (unknown), never false.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

RULES_PATH = Path(__file__).resolve().parents[3] / "config" / "cycle_rules.json"
OPERATORS = ("<", "<=", ">", ">=")
SUGGESTIONS = ("up", "down", "none")
SOURCES = ("feature", "indicator")


# ─── causal indicators of the closes ────────────────────────────────────────


def relative_strength_index(close: np.ndarray, period: int = 14) -> np.ndarray:
    """Wilder's RSI (0..100): exponential smoothing with alpha = 1 / period,
    started at the first bar; NaN for the first ``period`` rows."""
    series = pd.Series(np.asarray(close, dtype=np.float64))
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    average_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    average_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    with np.errstate(invalid="ignore", divide="ignore"):
        strength = average_gain.to_numpy() / average_loss.to_numpy()
        out = 100.0 - 100.0 / (1.0 + strength)
    out[(average_loss.to_numpy() == 0.0) & np.isfinite(average_gain.to_numpy())] = 100.0
    out[: period] = np.nan
    return out


def macd_histogram(close: np.ndarray, move_scale: np.ndarray, fast_period: int = 12, slow_period: int = 26,
                   signal_period: int = 9) -> np.ndarray:
    """(MACD line - signal line) / move scale: fast and slow exponential
    averages of the closes (span, started at the first bar), the signal an
    exponential average of the MACD line."""
    series = pd.Series(np.asarray(close, dtype=np.float64))
    fast = series.ewm(span=fast_period, adjust=False, min_periods=fast_period).mean()
    slow = series.ewm(span=slow_period, adjust=False, min_periods=slow_period).mean()
    line = fast - slow
    signal = line.ewm(span=signal_period, adjust=False, min_periods=signal_period).mean()
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (line - signal).to_numpy() / np.asarray(move_scale, dtype=np.float64)
    out[~np.isfinite(out)] = np.nan
    return out


def bollinger_band_position(close: np.ndarray, period: int = 20, width: float = 2.0) -> np.ndarray:
    """0 at the lower band (trailing mean - width * std), 1 at the upper."""
    series = pd.Series(np.asarray(close, dtype=np.float64))
    mean = series.rolling(period, min_periods=period).mean().to_numpy()
    spread = series.rolling(period, min_periods=period).std(ddof=0).to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (series.to_numpy() - (mean - width * spread)) / (2.0 * width * spread)
    out[~np.isfinite(out)] = np.nan
    return out


def trend_slope(close: np.ndarray, move_scale: np.ndarray, period: int = 20) -> np.ndarray:
    """Least-squares slope of the last ``period`` closes, points per bar,
    divided by the causal move scale."""
    close = np.asarray(close, dtype=np.float64)
    out = np.full(close.shape[0], np.nan)
    if close.shape[0] >= period:
        positions = np.arange(period, dtype=np.float64) - (period - 1) / 2.0
        windows = np.lib.stride_tricks.sliding_window_view(close, period)
        out[period - 1:] = windows @ positions / float(np.sum(positions ** 2))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = out / np.asarray(move_scale, dtype=np.float64)
    out[~np.isfinite(out)] = np.nan
    return out


def volatility_ratio(one_bar_returns: np.ndarray, short_period: int = 10, long_period: int = 50) -> np.ndarray:
    series = pd.Series(np.asarray(one_bar_returns, dtype=np.float64))
    short = series.rolling(short_period, min_periods=short_period).std(ddof=1).to_numpy()
    long = series.rolling(long_period, min_periods=long_period).std(ddof=1).to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        out = short / long
    out[~np.isfinite(out)] = np.nan
    return out


def indicator_values(name: str, view, settings: dict) -> np.ndarray:
    """One indicator over every row of ``view`` (float64)."""
    if name == "relative_strength_index":
        return relative_strength_index(view.close, int(settings.get("period", 14)))
    if name == "moving_average_convergence_divergence_histogram":
        return macd_histogram(view.close, view.move_scale, int(settings.get("fast_period", 12)),
                              int(settings.get("slow_period", 26)), int(settings.get("signal_period", 9)))
    if name == "bollinger_band_position":
        return bollinger_band_position(view.close, int(settings.get("period", 20)), float(settings.get("width", 2.0)))
    if name == "trend_slope":
        return trend_slope(view.close, view.move_scale, int(settings.get("period", 20)))
    if name == "volatility_ratio":
        return volatility_ratio(view.one_bar_returns(), int(settings.get("short_period", 10)),
                                int(settings.get("long_period", 50)))
    raise ValueError(f"unknown indicator {name!r}")


# ─── atoms and rules ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Atom:
    name: str
    source: str               # feature | indicator
    input: str                # the feature column or the indicator name
    operator: str
    threshold: float | None          # a fixed threshold, or the fitted training quantile
    train_quantile: float | None = None
    suggests: str = "none"
    description: str = ""

    def __post_init__(self) -> None:
        if self.source not in SOURCES:
            raise ValueError(f"atom {self.name}: source must be one of {SOURCES}")
        if self.operator not in OPERATORS:
            raise ValueError(f"atom {self.name}: operator must be one of {OPERATORS}")
        if self.suggests not in SUGGESTIONS:
            raise ValueError(f"atom {self.name}: suggests must be one of {SUGGESTIONS}")
        if self.threshold is None and self.train_quantile is None:
            raise ValueError(f"atom {self.name}: give a threshold or a trainQuantile")
        if self.train_quantile is not None and not 0.0 <= self.train_quantile <= 1.0:
            raise ValueError(f"atom {self.name}: trainQuantile must be in [0, 1]")

    @property
    def fitted(self) -> bool:
        return self.threshold is not None

    def fit(self, training_values: np.ndarray) -> Atom:
        """The atom with its training-quantile threshold fixed (a fixed threshold is kept)."""
        if self.train_quantile is None:
            return self
        values = np.asarray(training_values, dtype=np.float64)
        values = values[np.isfinite(values)]
        threshold = float(np.quantile(values, self.train_quantile)) if values.size else float("nan")
        return replace(self, threshold=threshold)

    def truth(self, values: np.ndarray) -> np.ndarray:
        """1.0 true, 0.0 false, NaN where the input is missing."""
        if self.threshold is None:
            raise RuntimeError(f"atom {self.name}: its training-quantile threshold is not fitted")
        values = np.asarray(values, dtype=np.float64)
        comparisons: dict[str, Callable] = {"<": np.less, "<=": np.less_equal, ">": np.greater, ">=": np.greater_equal}
        out = comparisons[self.operator](values, self.threshold).astype(np.float64)
        out[~np.isfinite(values)] = np.nan
        return out

    def degree(self, values: np.ndarray, width: float) -> np.ndarray:
        """A soft truth in (0, 1): the logistic of the signed distance past the
        threshold over ``width`` (for fuzzy and probabilistic engines)."""
        if self.threshold is None:
            raise RuntimeError(f"atom {self.name}: its training-quantile threshold is not fitted")
        values = np.asarray(values, dtype=np.float64)
        sign = 1.0 if self.operator in (">", ">=") else -1.0
        out = 1.0 / (1.0 + np.exp(-np.clip(sign * (values - self.threshold) / max(width, 1e-12), -500, 500)))
        out[~np.isfinite(values)] = np.nan
        return out

    def to_dict(self) -> dict:
        return {"name": self.name, "source": self.source, "input": self.input, "operator": self.operator,
                "threshold": self.threshold, "trainQuantile": self.train_quantile, "suggests": self.suggests,
                "description": self.description}

    @classmethod
    def from_dict(cls, document: dict) -> Atom:
        return cls(name=document["name"], source=document["source"], input=document["input"],
                   operator=document["operator"], threshold=document.get("threshold"),
                   train_quantile=document.get("trainQuantile"), suggests=document.get("suggests", "none"),
                   description=document.get("description", ""))


@dataclass(frozen=True)
class Rule:
    name: str
    when: tuple[str, ...]
    conclusion: str           # up | down
    certainty: float

    def to_dict(self) -> dict:
        return {"name": self.name, "when": list(self.when), "conclusion": self.conclusion, "certainty": self.certainty}

    @classmethod
    def from_dict(cls, document: dict) -> Rule:
        return cls(document["name"], tuple(document["when"]), document["conclusion"], float(document["certainty"]))


@dataclass
class ResolvedLibrary:
    """The atoms and rules a run can evaluate, in library order."""

    atoms: list[Atom]
    rules: list[Rule]
    indicators: dict[str, dict]
    disabled: dict[str, str] = field(default_factory=dict)     # atom or rule name -> why
    _cache: tuple | None = field(default=None, repr=False, compare=False)

    @property
    def atom_names(self) -> list[str]:
        return [atom.name for atom in self.atoms]

    def inputs(self, view) -> dict[str, np.ndarray]:
        """Every atom input over all rows of ``view`` (computed once per view)."""
        if self._cache is not None and self._cache[0] is view:
            return self._cache[1]
        values: dict[str, np.ndarray] = {}
        for atom in self.atoms:
            if atom.input in values:
                continue
            if atom.source == "indicator":
                values[atom.input] = indicator_values(atom.input, view, self.indicators.get(atom.input, {}))
            else:
                column = view.feature_column(atom.input)
                if column is None:
                    raise ValueError(f"atom {atom.name}: the view has no raw feature {atom.input!r}")
                values[atom.input] = column
        self._cache = (view, values)
        return values

    def fit(self, view, train_rows) -> ResolvedLibrary:
        """Fix every training-quantile threshold on ``train_rows`` (training rows only)."""
        rows = np.asarray(train_rows, dtype=np.int64)
        values = self.inputs(view)
        return ResolvedLibrary([atom.fit(values[atom.input][rows]) for atom in self.atoms], list(self.rules),
                               dict(self.indicators), dict(self.disabled))

    def truth_table(self, view, rows) -> np.ndarray:
        """(len(rows), atom count): 1.0 / 0.0 / NaN."""
        rows = np.asarray(rows, dtype=np.int64)
        values = self.inputs(view)
        if not self.atoms:
            return np.empty((rows.size, 0))
        return np.column_stack([atom.truth(values[atom.input][rows]) for atom in self.atoms])

    def degree_table(self, view, rows, widths: dict[str, float] | None = None) -> np.ndarray:
        """(len(rows), atom count) soft truths. ``widths`` (atom name -> width
        in the input's units) must come from training rows; an atom without one
        uses 1.0. The rows asked for never set a width, so a row's degree does
        not depend on which other rows are scored with it."""
        rows = np.asarray(rows, dtype=np.int64)
        values = self.inputs(view)
        widths = widths or {}
        if not self.atoms:
            return np.empty((rows.size, 0))
        return np.column_stack([atom.degree(values[atom.input][rows], widths.get(atom.name, 1.0)) for atom in self.atoms])

    def rule_firing(self, view, rows) -> np.ndarray:
        """(len(rows), rule count): 1.0 when every atom of the rule is true,
        0.0 when one is false, NaN when none is false and one is unknown."""
        table = self.truth_table(view, rows)
        position = {name: column for column, name in enumerate(self.atom_names)}
        columns = []
        for rule in self.rules:
            parts = table[:, [position[name] for name in rule.when]]
            fired = np.all(parts == 1.0, axis=1).astype(np.float64)
            unknown = np.any(np.isnan(parts), axis=1) & ~np.any(parts == 0.0, axis=1)
            fired[unknown] = np.nan
            columns.append(fired)
        return np.column_stack(columns) if columns else np.empty((table.shape[0], 0))

    def to_dict(self) -> dict:
        return {"atoms": [atom.to_dict() for atom in self.atoms], "rules": [rule.to_dict() for rule in self.rules],
                "indicators": self.indicators, "disabled": self.disabled}

    @classmethod
    def from_dict(cls, document: dict) -> ResolvedLibrary:
        return cls([Atom.from_dict(item) for item in document["atoms"]],
                   [Rule.from_dict(item) for item in document["rules"]],
                   dict(document.get("indicators", {})), dict(document.get("disabled", {})))


@dataclass
class RuleLibrary:
    atoms: list[Atom]
    rules: list[Rule]
    indicators: dict[str, dict]

    @classmethod
    def load(cls, path: str | Path = RULES_PATH) -> RuleLibrary:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
        atoms = [Atom.from_dict(item) for item in document["atoms"]]
        names = [atom.name for atom in atoms]
        if len(set(names)) != len(names):
            raise ValueError(f"{path}: atom names repeat")
        rules = [Rule.from_dict(item) for item in document["rules"]]
        for rule in rules:
            missing = [name for name in rule.when if name not in names]
            if missing:
                raise ValueError(f"{path}: rule {rule.name} names unknown atoms {missing}")
            if rule.conclusion not in ("up", "down"):
                raise ValueError(f"{path}: rule {rule.name} concludes {rule.conclusion!r}")
        indicators = {name: {key: value for key, value in settings.items() if key != "description"}
                      for name, settings in document.get("indicators", {}).items()}
        for atom in atoms:
            if atom.source == "indicator" and atom.input not in indicators:
                raise ValueError(f"{path}: atom {atom.name} reads undeclared indicator {atom.input!r}")
        return cls(atoms, rules, indicators)

    def resolve(self, feature_names, *, raw_available: bool = True,
                log: Callable[[str, str], None] | None = None) -> ResolvedLibrary:
        """The atoms and rules this run can evaluate. A feature atom whose column
        the run does not carry (or whose raw values it did not keep) is disabled
        with one logged line, and so is every rule that needs it."""
        names = set(str(name) for name in feature_names)
        kept: list[Atom] = []
        disabled: dict[str, str] = {}
        for atom in self.atoms:
            if atom.source == "feature" and (not raw_available or atom.input not in names):
                reason = (f"the run has no feature column {atom.input!r}" if atom.input not in names
                          else "the run kept no raw feature values")
                disabled[atom.name] = reason
                if log is not None:
                    log(f"rule atom {atom.name} disabled: {reason}", "info")
                continue
            kept.append(atom)
        kept_names = {atom.name for atom in kept}
        rules = []
        for rule in self.rules:
            missing = [name for name in rule.when if name not in kept_names]
            if missing:
                disabled[rule.name] = f"needs disabled atoms {missing}"
                if log is not None:
                    log(f"rule {rule.name} disabled: needs disabled atoms {', '.join(missing)}", "info")
                continue
            rules.append(rule)
        return ResolvedLibrary(kept, rules, dict(self.indicators), disabled)


__all__ = ["Atom", "RULES_PATH", "ResolvedLibrary", "Rule", "RuleLibrary", "bollinger_band_position",
           "indicator_values", "macd_histogram", "relative_strength_index", "trend_slope", "volatility_ratio"]
