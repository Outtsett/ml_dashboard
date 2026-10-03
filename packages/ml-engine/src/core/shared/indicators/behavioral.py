"""Behavioral embedding for every TA-Lib indicator, from one generic engine.

The MACD decomposition specified for a single indicator — normalise the level,
take its delta and acceleration, bin it into a categorical state, record
crossovers with how long ago they happened and where they started, and measure
divergence from price — is not a MACD feature. It is a decomposition that any
indicator admits, so it is implemented once here and driven by a declarative
`BehaviorSpec` per registry entry.

Three kinds of registry entry get three different treatments, because they are
three different kinds of quantity:

  continuous  a level that moves (144 outputs). Full decomposition: level,
              dynamics, categorical state, events, event memory, divergence.
  pattern     a categorical event that fires (61 outputs). No level to
              normalise; instead occurrence, run length, recency, and a
              decayed firing rate over a window.
  operator    a transform with no natural scale (29 outputs). Not embedded —
              these are the normalisers the other two use, and embedding a
              subtraction would learn nothing the inputs do not already carry.

Causality is load-bearing here and not a stylistic choice: every window is
trailing with `min_periods == window`, so warm-up rows are NaN rather than 0,
and nothing is back- or forward-filled. A feature that peeks one bar ahead
looks spectacular in-sample and is worthless live, so the tests assert it.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
import pandas as pd
from numba import njit

__all__ = [
    "BehaviorSpec",
    "IndicatorBehavior",
    "load_registry",
    "build_specs",
    "compute_behavior",
    "behavior_feature_names",
]

# Registries land in packages/config; the engine lives beside them in source.
_REGISTRY_CANDIDATES = (
    os.path.join("packages", "config", "talib_features.json"),
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "config", "talib_features.json"
    ),
)

# How fast an event's influence decays. One halflife is 8 bars: an indicator
# cross keeps shaping the next few bars and has largely said what it says by
# the next couple of dozen. Patterns fire less often and are given 32.
_EVENT_HALFLIFE_CONTINUOUS = 8
_EVENT_HALFLIFE_PATTERN = 32

# Rolling window for causal distributional context (own volatility, own
# percentile, divergence). 50 bars matches normalizer.ROLLING_WINDOW so the two
# modules agree on what "recent" means.
_WINDOW = 50

# Clamp on z-scores and normalised levels. Prevents one 2020-style wick from
# dominating a whole training run without discarding genuine extremes.
_CLIP = 8.0

Kind = Literal["continuous", "pattern", "operator"]
StateMode = Literal["quadrant", "zbin", "none"]

# The registry calls the continuous family "indicator"; the engine calls it
# "continuous" because that is what it is doing to it. The mapping is stated
# here once rather than spread through the builders.
_REGISTRY_KIND = {"indicator": "continuous", "continuous": "continuous", "pattern": "pattern", "operator": "operator"}


@dataclass(frozen=True)
class BehaviorSpec:
    """What the engine needs to embed one registry entry.

    Attributes:
        name: canonical registry name, free of parameter digits by construction.
        talib_function / talib_output: identity in the source library, so a
            stored column can be matched back without name heuristics.
        kind: which of the three treatments applies.
        normalizer / normalizer_params: verbatim from normalizer's
            `classify_normalization`, so level scaling is the dashboard's
            single existing definition rather than a second one.
        state_mode: how to bin the series into a categorical state.
        state_bins: number of bins for `zbin`; ignored otherwise.
        pairs: pairs of sibling outputs whose difference defines a crossover —
            e.g. ("macd", "macd_signal"), or ("bbands_upper", "bbands_lower").
            Derived from the registry's own output names rather than a
            hand-kept list, because a hand-kept list is guaranteed to be wrong
            the next time TA-Lib renames anything (it renamed PLUSDI to
            PLUS_DI in 0.8.0). Empty when a function has one output.
        thresholds: absolute levels that count as events, e.g. (70, -30) for
            a 0-100 oscillator. Empty when the function has no natural bound.
        polarity: +1 when a high reading means bullish, -1 when bearish, 0
            when the function has no directional reading. Flips the sign of
            the level and of every signed derived feature so that "high" means
            the same thing across all 144 continuous outputs.
    """

    name: str
    talib_function: str
    talib_output: str
    kind: Kind
    normalizer: str = "passthrough"
    normalizer_params: dict[str, Any] = field(default_factory=dict)
    state_mode: StateMode = "none"
    state_bins: int = 5
    pairs: tuple[tuple[str, str], ...] = ()
    owns_pairs: bool = False
    thresholds: tuple[float, ...] = ()
    polarity: int = 0
    event_halflife: int = _EVENT_HALFLIFE_CONTINUOUS

    @property
    def embedded(self) -> bool:
        """Operators normalise; they are not embedded in their own right."""
        return self.kind in ("continuous", "pattern")


@dataclass
class IndicatorBehavior:
    """One embedded indicator's behavioural block: a dict of column -> array.

    Holding a dict rather than a matrix keeps the names attached to the values,
    which is the difference between a column called `macd_state` and one called
    `feature_37` when someone reads the table six months from now.
    """

    spec: BehaviorSpec
    columns: dict[str, np.ndarray]

    def __len__(self) -> int:
        return len(self.columns)


# --------------------------------------------------------------------------
# Causal primitives. Every one of these is trailing-only.
# --------------------------------------------------------------------------


@njit(cache=True)
def _true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    n = high.shape[0]
    out = np.full(n, np.nan)
    for i in range(1, n):
        prev_close = close[i - 1]
        a = high[i] - low[i]
        b = abs(high[i] - prev_close)
        c = abs(low[i] - prev_close)
        m = a
        if b > m:
            m = b
        if c > m:
            m = c
        out[i] = m
    return out


@njit(cache=True)
def _wilder_mean(values: np.ndarray, period: int) -> np.ndarray:
    """Wilder's smoothing — ATR's own average, seeded on the first full window."""
    n = values.shape[0]
    out = np.full(n, np.nan)
    if n < period:
        return out
    total = 0.0
    for i in range(period):
        v = values[i]
        if np.isnan(v):
            return out
        total += v
    out[period - 1] = total / period
    prev = out[period - 1]
    for i in range(period, n):
        v = values[i]
        if np.isnan(v):
            out[i] = prev
        else:
            prev = (prev * (period - 1) + v) / period
            out[i] = prev
    return out


def causal_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Wilder ATR over trailing windows. NaN until the first full period."""
    return _wilder_mean(_true_range(high, low, close), period)


@njit(cache=True)
def _causal_std(values: np.ndarray, window: int) -> np.ndarray:
    n = values.shape[0]
    out = np.full(n, np.nan)
    for i in range(window - 1, n):
        acc = 0.0
        total = 0.0
        for j in range(i - window + 1, i + 1):
            v = values[j]
            if np.isnan(v):
                acc = np.nan
                break
            acc += v * v
            total += v
        if np.isnan(acc):
            continue
        mean = total / window
        var = acc / window - mean * mean
        out[i] = np.sqrt(var) if var > 0.0 else 0.0
    return out


@njit(cache=True)
def _causal_rank(values: np.ndarray, window: int) -> np.ndarray:
    """Fraction of the trailing window at or below the current value.

    Naive O(n*w), which is fine at the w this module uses and is honest about
    not borrowing from the future the way a full-sample rank would.
    """
    n = values.shape[0]
    out = np.full(n, np.nan)
    for i in range(window - 1, n):
        cur = values[i]
        if np.isnan(cur):
            continue
        below = 0
        seen = 0
        for j in range(i - window + 1, i + 1):
            v = values[j]
            if np.isnan(v):
                continue
            seen += 1
            if v <= cur:
                below += 1
        if seen > 0:
            out[i] = below / seen
    return out


@njit(cache=True)
def _diff(values: np.ndarray, order: int) -> np.ndarray:
    """Difference at `order` bars back; order 0 is the identity, not zeros.

    Written as a subtraction of the value one bar back, so order 0 has to be
    handled explicitly or every call with a zero lag silently returns a column
    of zeros.
    """
    n = values.shape[0]
    out = np.full(n, np.nan)
    if order == 0:
        for i in range(n):
            out[i] = values[i]
        return out
    for i in range(order, n):
        out[i] = values[i] - values[i - order]
    return out


def _divide(numerator: np.ndarray, denominator: np.ndarray) -> np.ndarray:
    """Elementwise divide that keeps an unknown input unknown.

    NumPy and DuckDB both treat division by zero as inf rather than NaN, which
    turns a flat series into a column of infinities that then poisons every
    scale downstream. A zero or non-finite denominator is a genuine unknown
    here, so it is written as NaN rather than computed.
    """
    num = np.asarray(numerator, dtype=np.float64)
    den = np.asarray(denominator, dtype=np.float64)
    out = np.full(num.shape, np.nan, dtype=np.float64)
    usable = np.isfinite(num) & np.isfinite(den) & (den != 0.0)
    np.divide(num, den, out=out, where=usable)
    return out


@njit(cache=True)
def _clip(arr: np.ndarray, limit: float) -> np.ndarray:
    n = arr.shape[0]
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        v = arr[i]
        if np.isnan(v):
            out[i] = np.nan
        elif v > limit:
            out[i] = limit
        elif v < -limit:
            out[i] = -limit
        else:
            out[i] = v
    return out


@njit(cache=True)
def _event_memory(mask: np.ndarray, halflife: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Age, event index and decayed presence of the most recent event.

    `age` is bars since the last True, NaN before any event has happened — an
    event that has never fired is unknown, not "0 bars ago", because the two
    mean opposite things to a model. `origin` is the bar index of that event, so
    a caller can read off the value the indicator held when it happened, which
    is what makes "it crossed above 70 from 62" recoverable. `decay` is
    exp(-ln2 * age / halflife), so recency enters as a bounded quantity the
    network can use without also being handed the raw age.
    """
    n = mask.shape[0]
    age = np.full(n, np.nan)
    origin = np.full(n, np.nan)
    decay = np.full(n, np.nan)
    log2 = np.log(2.0)
    last_index = -1
    for i in range(n):
        if mask[i]:
            last_index = i
        if last_index < 0:
            continue
        a = i - last_index
        age[i] = a
        origin[i] = last_index
        decay[i] = np.exp(-log2 * a / halflife)
    return age, origin, decay


@njit(cache=True)
def _run_length(mask: np.ndarray) -> np.ndarray:
    """Consecutive True count ending at each bar; 0 where False."""
    n = mask.shape[0]
    out = np.zeros(n, dtype=np.float64)
    run = 0.0
    for i in range(n):
        if mask[i]:
            run += 1.0
        else:
            run = 0.0
        out[i] = run
    return out


@njit(cache=True)
def _windowed_change(values: np.ndarray, window: int) -> np.ndarray:
    n = values.shape[0]
    out = np.full(n, np.nan)
    for i in range(window, n):
        a = values[i]
        b = values[i - window]
        if np.isnan(a) or np.isnan(b):
            continue
        out[i] = a - b
    return out


@njit(cache=True)
def _zbin_state(z: np.ndarray, bins: int) -> np.ndarray:
    """Categorical bin of a causal z-score. 0 is reserved for unknown."""
    n = z.shape[0]
    out = np.zeros(n, dtype=np.float64)
    for i in range(n):
        v = z[i]
        if np.isnan(v):
            continue
        if v <= -1.0:
            out[i] = 1.0
        elif v < 0.0:
            out[i] = 2.0
        elif v == 0.0:
            out[i] = 3.0
        else:
            out[i] = 4.0
        if bins <= 4:
            continue
        out[i] = min(out[i], float(bins))
    return out


@njit(cache=True)
def _quadrant_state(level: np.ndarray, change: np.ndarray) -> np.ndarray:
    """Four-state sign quadrant of (level, change); 0 where unknown.

    This is the state the MACD spec asked for, stated once so every indicator
    with a sign gets it: rising-and-positive, rising-and-negative, falling-and-
    positive, falling-and-negative.
    """
    n = level.shape[0]
    out = np.zeros(n, dtype=np.float64)
    for i in range(n):
        lv = level[i]
        ch = change[i]
        if np.isnan(lv) or np.isnan(ch):
            continue
        if lv >= 0.0:
            out[i] = 1.0 if ch >= 0.0 else 2.0
        else:
            out[i] = 3.0 if ch >= 0.0 else 4.0
    return out


# --------------------------------------------------------------------------
# Normalisation, delegated to the dashboard's existing definition.
# --------------------------------------------------------------------------


def _normalize_level(
    values: np.ndarray,
    spec: BehaviorSpec,
    close: np.ndarray,
    atr: np.ndarray,
) -> np.ndarray:
    """Put one indicator's level on a comparable scale, causally.

    The normalizer choice comes from normalizer.classify_normalization, so a
    Bollinger band, an RSI and a MACD line each get scaled the way the rest of
    the dashboard already scales them.
    """
    kind = spec.normalizer
    params = spec.normalizer_params

    if kind == "passthrough":
        return values.copy()

    if kind == "rolling_zscore":
        window = int(params.get("window", _WINDOW))
        scale = _causal_std(values, window)
        mean = _rolling_mean_trail(values, window)
        return _clip(_divide(_diff(values, 0) - mean, scale), _CLIP)

    if kind == "pct_from_close":
        return _clip(_divide(values - close, close), _CLIP)

    if kind == "price_ratio":
        return _clip(_divide(values, close), _CLIP)

    if kind == "bounded":
        lo = float(params.get("min", 0.0))
        hi = float(params.get("max", 1.0))
        span = hi - lo
        if span <= 0:
            return values.copy()
        return _clip(_divide(values - lo, span) * 2.0 - 1.0, _CLIP)

    if kind == "binary":
        # A ±100/0/±1 signal has no magnitude to normalise; its level is its
        # sign, and the dynamics carry the rest.
        return _clip(values / 100.0, _CLIP)

    if kind == "cumulative":
        return _clip(values, _CLIP)

    if kind == "skip":
        return values.copy()

    # Anything whose magnitude is a price distance is divided by ATR, which is
    # the one scale that means the same thing on MNQ and on a bond future.
    return _clip(_divide(values, atr), _CLIP)


@njit(cache=True)
def _rolling_mean_trail(values: np.ndarray, window: int) -> np.ndarray:
    n = values.shape[0]
    out = np.full(n, np.nan)
    for i in range(window - 1, n):
        total = 0.0
        for j in range(i - window + 1, i + 1):
            v = values[j]
            if np.isnan(v):
                total = np.nan
                break
            total += v
        if not np.isnan(total):
            out[i] = total / window
    return out


# --------------------------------------------------------------------------
# The two behavioural treatments.
# --------------------------------------------------------------------------


def landed_column_names(
    specs: list[BehaviorSpec],
    timeframe: str = "1m",
    catalogue: str = "derived_study_talib_indicator_catalogue_column_statistics",
) -> dict[str, str]:
    """Map each registry name onto the lake column that holds it.

    The lake names its columns with the parameterization appended —
    `rsi_14`, `macd_12_26_9`, `bbands_upper_band_5_2_2_0` — which is precisely
    the naming the registry exists to replace. So the two are never matched by
    string. They are matched on `(talib_function, talib_output)`, which is what
    the library itself defines an output to be, and which no rename of a
    default parameter can change.

    Entries with no landed column are simply absent from the result: a
    registry entry the lake has not built yet is a fact about the lake, and the
    caller computes over what exists.
    """
    import sys

    datalake = os.environ.get("DATALAKE_SRC", r"E:\source\repos\datalake\src")
    if datalake not in sys.path:
        sys.path.insert(0, datalake)
    from lake.serving import connect  # noqa: PLC0415 - optional lake dependency

    rows = connect().execute(
        f"SELECT column_name, talib_function, talib_output FROM {catalogue} "
        f"WHERE timeframe = '{timeframe}'"
    ).fetchall()

    by_key: dict[tuple[str, str], str] = {}
    for column_name, function, output in rows:
        by_key.setdefault((str(function).upper(), str(output).lower()), str(column_name))

    resolved: dict[str, str] = {}
    for spec in specs:
        column = by_key.get((spec.talib_function.upper(), spec.talib_output.lower()))
        if column:
            resolved[spec.name] = column
    return resolved


def rename_to_landed(frame: pd.DataFrame, mapping: dict[str, str]) -> pd.DataFrame:
    """Apply a registry->landed mapping to a bar frame, in place of guessing.

    Only renames columns that are actually present, and never overwrites a
    column the frame already carries under its registry name — a frame that has
    already been cleaned keeps its clean names.
    """
    renames = {
        landed: registry_name
        for registry_name, landed in mapping.items()
        if landed in frame.columns and registry_name not in frame.columns
    }
    return frame.rename(columns=renames) if renames else frame


def price_reference(close: np.ndarray) -> np.ndarray:
    """The price baseline divergence is measured against: log close.

    Deliberately not `close / close`. A ratio of a series to itself is the
    constant 1, whose windowed change is 0 and whose trailing volatility is 0,
    so the price term of the divergence would be undefined for every indicator
    and the feature would be dead everywhere. Log close has a moving level and
    a non-zero volatility, and its windowed change is the log return, which is
    exactly the quantity an indicator is supposed to be compared with.
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.log(np.asarray(close, dtype=np.float64))
    out[~np.isfinite(out)] = np.nan
    return out


def _continuous_behavior(
    spec: BehaviorSpec,
    values: np.ndarray,
    close: np.ndarray,
    atr: np.ndarray,
    reference: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """Level, dynamics, state, events, event memory and divergence for one level.

    This is the MACD decomposition, and it is the same decomposition for RSI,
    ADX, the Bollinger middle band and every other continuous output.
    """
    n = values.shape[0]
    level = _normalize_level(values, spec, close, atr)
    if spec.polarity < 0:
        level = -level

    columns: dict[str, np.ndarray] = {}
    columns[f"{spec.name}__level"] = level

    # Dynamics: the first and second difference of the level, each divided by
    # the level's own trailing volatility so that a quiet instrument and a
    # violent one contribute comparable magnitudes.
    scale = _causal_std(level, _WINDOW)
    change = _divide(_diff(level, 1), scale)
    columns[f"{spec.name}__change"] = _clip(change, _CLIP)
    columns[f"{spec.name}__acceleration"] = _clip(_divide(_diff(level, 2), scale), _CLIP)
    columns[f"{spec.name}__window_change"] = _clip(
        _divide(_windowed_change(level, _WINDOW), scale), _CLIP
    )
    columns[f"{spec.name}__rank"] = _causal_rank(level, _WINDOW)

    # Categorical state. `quadrant` when the level has a sign that means
    # something, `zbin` when it is a magnitude with no natural zero.
    if spec.state_mode == "quadrant":
        columns[f"{spec.name}__state"] = _quadrant_state(level, change)
    elif spec.state_mode == "zbin":
        columns[f"{spec.name}__state"] = _zbin_state(change, spec.state_bins)

    # Threshold events against any natural bound the function has.
    for level_value in spec.thresholds:
        tag = _format_level(level_value)
        if spec.polarity < 0:
            hit = values >= -level_value
        else:
            hit = values >= level_value
        age, origin, decay = _event_memory(hit, spec.event_halflife)
        columns[f"{spec.name}__above_{tag}"] = hit.astype(np.float64)
        columns[f"{spec.name}__above_{tag}_age"] = age
        columns[f"{spec.name}__above_{tag}_recency"] = decay
        columns[f"{spec.name}__above_{tag}_origin"] = origin

    # Divergence: over a trailing window, how much further the indicator moved
    # than price did, in units of each one's own trailing volatility. A large
    # positive value is the indicator refusing to follow price — the classical
    # divergence, stated as a number instead of a drawing.
    price_level = reference if reference is not None else price_reference(close)
    indicator_move = _divide(_windowed_change(level, _WINDOW), scale)
    price_move = _divide(_windowed_change(price_level, _WINDOW), _causal_std(price_level, _WINDOW))
    columns[f"{spec.name}__divergence"] = _clip(indicator_move - price_move, _CLIP)

    # Explicit hidden-divergence flag: price set a new trailing-window extreme
    # while the indicator did not. The continuous divergence above can be large
    # for a reason that has nothing to do with a new extreme, and a model
    # benefits from the two being distinguishable.
    price_extreme = _is_new_extreme(price_level, _WINDOW)
    indicator_extreme = _is_new_extreme(level, _WINDOW)
    columns[f"{spec.name}__hidden_divergence"] = (price_extreme & ~indicator_extreme).astype(np.float64)

    assert all(v.shape[0] == n for v in columns.values())
    return columns


@njit(cache=True)
def _is_new_extreme(values: np.ndarray, window: int) -> np.ndarray:
    """True where the bar's own value is the extreme of its trailing window.

    Compare-and-equal is intentional: the flag is about this bar making the
    extreme, and a value merely tying one is not a new extreme.
    """
    n = values.shape[0]
    out = np.zeros(n, dtype=np.bool_)
    for i in range(window, n):
        cur = values[i]
        if np.isnan(cur):
            continue
        is_max = True
        is_min = True
        for j in range(i - window + 1, i):
            v = values[j]
            if np.isnan(v):
                continue
            if v > cur:
                is_max = False
            if v < cur:
                is_min = False
        out[i] = is_max or is_min
    return out


def _format_level(value: float) -> str:
    """Turn a threshold into a name fragment, with the sign made explicit."""
    if value > 0:
        return f"p{value:g}".replace(".", "")
    if value < 0:
        return f"n{abs(value):g}".replace(".", "")
    return "0"


def _pattern_behavior(spec: BehaviorSpec, values: np.ndarray) -> dict[str, np.ndarray]:
    """Occurrence, run length, recency and firing rate for a pattern output.

    A candlestick pattern is not a level, so normalising it or taking its
    acceleration would be inventing behaviour that is not there. What a pattern
    does have is when it fired, how long the run is, how long ago it was, and
    how often it fires — all of which are what a model can actually use.
    """
    fired = np.isfinite(values) & (values != 0.0)
    columns: dict[str, np.ndarray] = {}
    columns[f"{spec.name}__fired"] = fired.astype(np.float64)
    columns[f"{spec.name}__run_length"] = _run_length(fired)

    age, origin, decay = _event_memory(fired, spec.event_halflife)
    columns[f"{spec.name}__age"] = age
    columns[f"{spec.name}__recency"] = decay
    columns[f"{spec.name}__origin"] = origin

    rate = _causal_mean(fired.astype(np.float64), _WINDOW)
    columns[f"{spec.name}__rate"] = rate
    columns[f"{spec.name}__rate_ratio"] = _divide(
        rate, _causal_mean(fired.astype(np.float64), _WINDOW * 5)
    )
    return columns


@njit(cache=True)
def _causal_mean(values: np.ndarray, window: int) -> np.ndarray:
    n = values.shape[0]
    out = np.full(n, np.nan)
    for i in range(window - 1, n):
        total = 0.0
        for j in range(i - window + 1, i + 1):
            total += values[j]
        out[i] = total / window
    return out


# --------------------------------------------------------------------------
# Spec construction from the registry.
# --------------------------------------------------------------------------


def load_registry(path: str | None = None) -> dict[str, Any]:
    """Read packages/config/talib_features.json, the single source of truth."""
    candidates = [path] if path else list(_REGISTRY_CANDIDATES)
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            with open(candidate, encoding="utf-8") as handle:
                return json.load(handle)
    raise FileNotFoundError(
        f"talib_features.json not found; looked in {candidates}. "
        "Generate it with packages/config/build_talib_features.py."
    )


def _ta_name(spec_entry: dict[str, Any]) -> str:
    """The name classify_normalization expects: TA-Lib function, with output."""
    function = spec_entry["talib_function"]
    output = spec_entry["talib_output"]
    if output.lower() == function.lower():
        return function
    return f"{function}_{output}"


def build_specs(
    registry: dict[str, Any] | None = None,
    landed: dict[str, str] | None = None,
) -> list[BehaviorSpec]:
    """One BehaviorSpec per registry entry, with behaviour chosen by category.

    `landed` maps registry name -> the lake's column name. When it is supplied
    the normalizer is chosen by running `classify_normalization` on the lake's
    own name (`bbands_upper_band_5_2_2_0`, `natr_14`) rather than on a name
    this module invented. That is the vocabulary the classifier was written
    against, and it matters: classifying a moving average as `rolling_zscore`
    z-scores a price around its own trailing mean, which saturates the clip and
    flattens the feature to a constant.

    The behavioural treatment is derived from what kind of quantity each entry
    is, and from the normalizer the dashboard already assigns it — not from a
    hand-maintained list of indicator names that would drift the next time
    TA-Lib ships a new function.
    """
    from ..normalizer import classify_normalization

    data = registry if registry is not None else load_registry()
    entries = data["features"] if isinstance(data, dict) and "features" in data else data

    specs: list[BehaviorSpec] = []
    by_function: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        by_function.setdefault(entry["talib_function"], []).append(entry)

    pair_owner_claimed: set[str] = set()

    for entry in entries:
        function = entry["talib_function"]
        kind = _REGISTRY_KIND.get(entry.get("kind", "indicator"), "continuous")
        name = entry["name"]
        series = pd.Series(dtype=float)
        classify_name = (landed or {}).get(name) or _ta_name(entry)
        normalizer, params = classify_normalization(classify_name, series)
        if normalizer in ("skip", "binary"):
            # A pattern output is a -100/0/100 event, handled as an event.
            normalizer, params = "passthrough", {}

        outputs = [e["name"] for e in by_function[function]]
        pairs: tuple[tuple[str, str], ...] = ()
        owns_pairs = False
        if kind == "continuous" and len(outputs) >= 2:
            pairs = _derive_pairs(outputs)
            # Every output of a function would otherwise carry the same pair and
            # recompute the same crossover columns, colliding on one name. The
            # first output of the function owns them, once.
            owns_pairs = function not in pair_owner_claimed
            if owns_pairs:
                pair_owner_claimed.add(function)

        state_mode: StateMode = "none"
        state_bins = 5
        if kind == "continuous":
            if normalizer in ("bounded", "passthrough", "rolling_zscore", "binary", "pct_from_close"):
                state_mode = "quadrant"
            else:
                state_mode = "zbin"
                state_bins = 5

        thresholds = _thresholds_for(normalizer, params)
        polarity = _polarity_for(function, name)

        specs.append(
            BehaviorSpec(
                name=name,
                talib_function=function,
                talib_output=entry["talib_output"],
                kind=kind,  # type: ignore[arg-type]
                normalizer=normalizer,
                normalizer_params=params,
                state_mode=state_mode,
                state_bins=state_bins,
                pairs=pairs,
                owns_pairs=owns_pairs,
                thresholds=thresholds,
                polarity=polarity,
                event_halflife=(
                    _EVENT_HALFLIFE_PATTERN if kind == "pattern" else _EVENT_HALFLIFE_CONTINUOUS
                ),
            )
        )
    return specs


def _derive_pairs(outputs: list[str]) -> tuple[tuple[str, str], ...]:
    """Which sibling outputs are meant to be compared, derived from their names.

    A crossover is only meaningful between two series the library defines as
    comparable. Arbitrarily pairing the first and last output of a
    three-output function would manufacture crossings that mean nothing, so
    the rule is stated once, in order of how explicit the naming is:

      1. a `signal` output against the function's other non-derivative level
         (MACD vs its signal, STOCHRSI vs its fast/slow %D)
      2. a high/low or upper/lower pair
      3. exactly two outputs, which are a pair by construction
    """
    lowered = {name.lower(): name for name in outputs}

    def _find(substring: str) -> str | None:
        for low, original in lowered.items():
            if substring in low:
                return original
        return None

    signal = _find("signal")
    if signal is not None:
        for low, name in lowered.items():
            if name == signal or "hist" in low:
                continue
            return ((name, signal),)

    for upper_part, lower_part in (("upper", "lower"), ("high", "low"), ("fast", "slow")):
        upper = _find(upper_part)
        lower = _find(lower_part)
        if upper is not None and lower is not None and upper != lower:
            return ((upper, lower),)

    if len(outputs) == 2:
        return ((outputs[0], outputs[1]),)

    return ()


def _thresholds_for(normalizer: str, params: dict[str, Any]) -> tuple[float, ...]:
    """Absolute levels that count as events, when the function has a bound."""
    if normalizer != "bounded":
        return ()
    lo = params.get("min")
    hi = params.get("max")
    if lo is None or hi is None:
        return ()
    # Symmetric oscillators (-100..100, 0..100) get both tails; one-sided ones
    # get the single bound that is meaningful.
    if abs(lo) < 1e-9 and hi > 0:
        return (hi * 0.7, hi * 0.3)
    if abs(hi) < 1e-9 and lo < 0:
        return (lo * 0.7, lo * 0.3)
    if lo < 0 < hi and abs(lo) == abs(hi):
        return (hi * 0.7, lo * 0.7)
    return ()


# Direction of a high reading, by function. 0 when the function has no
# directional reading (volatility, volume, shape) — those are not flipped, and
# their level is not signed either.
# Direction of a high reading, by function name as TA-Lib 0.8.1 spells it
# (PLUS_DI, not the 0.7 PLUSDI). 0 means the function has no directional
# reading — volatility, volume, shape — so nothing is flipped and no signed
# claim is made about it.
_BULLISH = {
    "ADX", "ADXR", "APO", "AROON", "AROONOSC", "BOP", "CCI", "CMF", "DX", "MACD",
    "MFI", "MOM", "PPO", "PVT", "ROC", "RSI", "SAR", "TRIX", "UO", "WILLR",
    "CMO", "KAMA", "MINUS_DI", "PLUS_DI", "ULTOSC", "AROONOSC",
}
_BEARISH = {"AD", "MFI", "SKL", "TRIX", "WCLPRICE"}


def _polarity_for(function: str, name: str) -> int:
    if function in _BEARISH and function not in _BULLISH:
        return -1
    if function in _BULLISH:
        return 1
    lowered = name.lower()
    if lowered.startswith("minus") or lowered.endswith("_down"):
        return -1
    return 0


# --------------------------------------------------------------------------
# Public entry point.
# --------------------------------------------------------------------------


def compute_behavior(
    specs: list[BehaviorSpec],
    frame: pd.DataFrame,
    symbols: dict[str, np.ndarray] | None = None,
) -> dict[IndicatorBehavior]:
    """Compute the behavioural block for every spec against a bar frame.

    `frame` needs the columns named in each spec's `name`, plus `open`, `high`,
    `low`, `close` and `volume`. Series that are not present — an operator that
    was never landed, a pattern absent from a window — yield no block rather
    than an error, because a registry entry with no data is a fact about the
    data, not a bug in the caller.
    """
    close = np.ascontiguousarray(frame["close"].to_numpy(dtype=np.float64))
    high = np.ascontiguousarray(frame["high"].to_numpy(dtype=np.float64))
    low = np.ascontiguousarray(frame["low"].to_numpy(dtype=np.float64))
    atr = causal_atr(high, low, close, 14)
    reference = price_reference(close)

    out: dict[IndicatorBehavior] = {}
    for spec in specs:
        if not spec.embedded:
            continue
        if spec.name not in frame.columns:
            continue
        values = np.ascontiguousarray(frame[spec.name].to_numpy(dtype=np.float64))
        if not np.isfinite(values).any():
            continue
        if spec.kind == "pattern":
            columns = _pattern_behavior(spec, values)
        else:
            columns = _continuous_behavior(spec, values, close, atr, reference)
        if spec.pairs and spec.owns_pairs:
            for left_name, right_name in spec.pairs:
                columns.update(_pair_events(spec, left_name, right_name, frame, close, atr))
        out[name_key(spec)] = IndicatorBehavior(spec=spec, columns=columns)
    return out


def name_key(spec: BehaviorSpec) -> str:
    return spec.name


def _pair_events(
    spec: BehaviorSpec,
    left_name: str,
    right_name: str,
    frame: pd.DataFrame,
    close: np.ndarray,
    atr: np.ndarray,
) -> dict[str, np.ndarray]:
    """Crossover between a function's two comparable outputs.

    This is the MACD histogram's gold and silver cross generalised: whichever
    two outputs the registry says are comparable, the difference is taken, its
    sign is the state, and each change of sign is an event with an age, an
    origin and a recency.
    """
    if left_name not in frame.columns or right_name not in frame.columns:
        return {}
    left = np.ascontiguousarray(frame[left_name].to_numpy(dtype=np.float64))
    right = np.ascontiguousarray(frame[right_name].to_numpy(dtype=np.float64))
    left_spec = BehaviorSpec(left_name, spec.talib_function, left_name, "continuous", spec.normalizer, spec.normalizer_params)
    right_spec = BehaviorSpec(right_name, spec.talib_function, right_name, "continuous", spec.normalizer, spec.normalizer_params)
    left_n = _normalize_level(left, left_spec, close, atr)
    right_n = _normalize_level(right, right_spec, close, atr)
    gap = left_n - right_n
    scale = _causal_std(gap, _WINDOW)
    gap_n = _divide(gap, scale)
    tag = f"{left_name}_vs_{right_name}_cross"

    up = np.zeros(gap_n.shape[0], dtype=np.bool_)
    down = np.zeros(gap_n.shape[0], dtype=np.bool_)
    for i in range(1, gap_n.shape[0]):
        a, b = gap_n[i], gap_n[i - 1]
        if np.isnan(a) or np.isnan(b):
            continue
        up[i] = (a > 0) and (b <= 0)
        down[i] = (a <= 0) and (b > 0)

    columns: dict[str, np.ndarray] = {
        f"{tag}__gap": _clip(gap_n, _CLIP),
        f"{tag}__state": _quadrant_state(gap_n, _diff(gap_n, 1)),
    }
    for direction, mask, sign in (("up", up, 1.0), ("down", down, -1.0)):
        age, origin, decay = _event_memory(mask, spec.event_halflife)
        # `__` before the direction, like every other facet. A crossover event
        # named `_cross_up` instead would be the only column in the table
        # without the `indicator__facet` shape, and so invisible to anything
        # that selects behavioural columns by that separator.
        columns[f"{tag}__{direction}"] = mask.astype(np.float64) * sign
        columns[f"{tag}__{direction}_age"] = age
        columns[f"{tag}__{direction}_recency"] = decay
        columns[f"{tag}__{direction}_origin"] = origin
    return columns


def behavior_feature_names(specs: list[BehaviorSpec], frame: pd.DataFrame | None = None) -> list[str]:
    """Every column the engine will emit, without computing it.

    Useful for a trainer to size its input layer and to assert that the
    feature count it was configured for still matches the registry.
    """
    names: list[str] = []
    for spec in specs:
        if not spec.embedded:
            continue
        if frame is not None and spec.name not in frame.columns:
            continue
        if spec.kind == "pattern":
            names.extend(
                [
                    f"{spec.name}__fired",
                    f"{spec.name}__run_length",
                    f"{spec.name}__age",
                    f"{spec.name}__recency",
                    f"{spec.name}__origin",
                    f"{spec.name}__rate",
                    f"{spec.name}__rate_ratio",
                ]
            )
            continue
        base = spec.name
        names.extend(
            [
                f"{base}__level",
                f"{base}__change",
                f"{base}__acceleration",
                f"{base}__window_change",
                f"{base}__rank",
                f"{base}__divergence",
                f"{base}__hidden_divergence",
            ]
        )
        if spec.state_mode != "none":
            names.append(f"{base}__state")
        for value in spec.thresholds:
            tag = _format_level(value)
            names.extend(
                [
                    f"{base}__above_{tag}",
                    f"{base}__above_{tag}_age",
                    f"{base}__above_{tag}_recency",
                    f"{base}__above_{tag}_origin",
                ]
            )
        for pair in spec.pairs if spec.owns_pairs else ():
            tag = f"{pair[0]}_vs_{pair[1]}_cross"
            names.extend([f"{tag}__gap", f"{tag}__state"])
            for direction in ("up", "down"):
                names.extend(
                    [
                        f"{tag}__{direction}",
                        f"{tag}__{direction}_age",
                        f"{tag}__{direction}_recency",
                        f"{tag}__{direction}_origin",
                    ]
                )
    return names
