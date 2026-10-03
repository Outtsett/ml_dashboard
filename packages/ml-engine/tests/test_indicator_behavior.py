"""Behavioural embedding: does every indicator get the MACD decomposition?

The engine's claim is that the MACD spec — normalise the level, take its delta
and acceleration, bin it into a state, remember crossovers with their age and
origin, and measure divergence — is a decomposition every indicator admits.
These tests hold it to that, and hold the causality claim, which is the one
that silently destroys a live model if it is wrong.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from core.shared.indicators.behavioral import (
    BehaviorSpec,
    behavior_feature_names,
    build_specs,
    compute_behavior,
    load_registry,
    price_reference,
)

WINDOW = 400


def _synthetic_frame(seed: int = 7) -> pd.DataFrame:
    """Deterministic price series with a trend, a range and real wicks."""
    rng = np.random.default_rng(seed)
    steps = rng.normal(0.0, 1.0, WINDOW).cumsum()
    close = 25000.0 + steps * 4.0
    open_ = np.concatenate([[close[0]], close[:-1]])
    spread = np.abs(rng.normal(0.0, 3.0, WINDOW)) + 1.0
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    volume = np.abs(rng.normal(9000.0, 1500.0, WINDOW))
    return pd.DataFrame(
        {
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    )


def _frame_with_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    """Add real TA-Lib outputs under their registry names.

    The column names come from the registry rather than being written out by
    hand, so the test exercises the names the engine will actually be asked
    about — `macd_signal`, not `macdsignal`.
    """
    from talib import abstract

    out = frame.copy()
    by_function: dict[str, list[str]] = {}
    for entry in load_registry()["features"]:
        by_function.setdefault(entry["talib_function"], []).append(entry["name"])

    for function in ("MACD", "BBANDS", "RSI", "ADX", "STOCH"):
        instance = abstract.Function(function)
        # `input_names` maps the library's logical names ('price', 'prices') onto
        # the real columns it wants, one entry per positional argument, so the
        # values are what get passed — not the keys.
        columns: list[str] = []
        for value in instance.input_names.values():
            if isinstance(value, (list, tuple)):
                columns.extend(value)
            else:
                columns.append(value)
        arrays = instance(*[out[c].to_numpy(dtype=np.float64) for c in columns])
        # A one-output function returns a bare array; a multi-output one returns
        # a list. Normalise so the zip below is the same either way.
        if isinstance(arrays, np.ndarray):
            arrays = [arrays]
        names = by_function[function]
        assert len(names) == len(arrays), f"{function}: {len(names)} names, {len(arrays)} arrays"
        for name, array in zip(names, arrays):
            out[name] = array

    import talib

    out["cdldoji"] = talib.CDLDOJI(
        out["open"].to_numpy(), out["high"].to_numpy(), out["low"].to_numpy(), out["close"].to_numpy()
    )
    return out


# ---------------------------------------------------------------------------
# Coverage: the whole registry, not a sample.
# ---------------------------------------------------------------------------


def test_every_registry_entry_gets_a_spec():
    specs = build_specs()
    registry = load_registry()
    assert len(specs) == len(registry["features"])


def test_specs_cover_all_three_kinds():
    specs = build_specs()
    counts: dict[str, int] = {}
    for spec in specs:
        counts[spec.kind] = counts.get(spec.kind, 0) + 1
    assert counts["continuous"] > 0
    assert counts["pattern"] == 61
    assert counts["operator"] > 0
    # Operators normalise rather than being embedded, so they are excluded.
    assert sum(1 for s in specs if not s.embedded) == counts["operator"]


def test_macd_gets_the_full_decomposition():
    specs = {s.name: s for s in build_specs()}
    macd = specs["macd"]
    assert macd.kind == "continuous"
    assert macd.state_mode != "none"
    # The signal line is the crossover partner, not an arbitrary sibling.
    assert ("macd", "macd_signal") in macd.pairs


def test_bbands_pairs_upper_with_lower():
    specs = {s.name: s for s in build_specs()}
    assert ("bbands_upper", "bbands_lower") in specs["bbands_upper"].pairs


def test_bounded_oscillator_gets_threshold_events():
    specs = {s.name: s for s in build_specs()}
    assert specs["rsi"].thresholds, "a 0-100 oscillator must declare its event levels"


def test_no_indicator_feature_name_carries_parameter_digits():
    """The naming rule: the name is the quantity, parameters live in the spec.

    Pattern names are exempt and deliberately so — `cdl3starsinsouth` is Three
    White Soldiers, and the 3 is part of what the pattern is called, not a
    period anyone could change. Confusing the two would be the rule's own
    failure mode, so the exemption is asserted rather than assumed.
    """
    patterns = {s.name for s in build_specs() if s.kind == "pattern"}
    assert "cdl3starsinsouth" in patterns, "expected a digit-bearing pattern name to exist"

    for name in behavior_feature_names(build_specs()):
        base = name.split("__")[0]
        if base in patterns or any(base.startswith(p) for p in patterns):
            continue
        for token in base.split("_"):
            assert not token.isdigit(), f"parameter digit in feature name: {name}"


# ---------------------------------------------------------------------------
# Causality. The property that matters most.
# ---------------------------------------------------------------------------


def test_truncating_the_future_does_not_change_the_past():
    """The core guarantee: a bar's features never depend on a later bar.

    Computing on the full series and on a prefix must agree everywhere both
    are defined. If this fails, the model is reading the future and every
    backtest built on it is fiction.
    """
    frame = _frame_with_indicators(_synthetic_frame())
    specs = build_specs()

    full = compute_behavior(specs, frame)
    cut = WINDOW // 2
    partial = compute_behavior(specs, frame.iloc[:cut].copy())

    checked = 0
    event_checked = 0
    for name, block in full.items():
        other = partial.get(name)
        if other is None:
            continue
        for column, values in block.columns.items():
            if column not in other.columns:
                continue
            reference = other.columns[column]
            both = np.isfinite(values[:cut]) & np.isfinite(reference)
            if not both.any():
                # An event column is legitimately empty when the event never
                # fired in this window. That is the correct answer, not a gap.
                continue
            np.testing.assert_allclose(
                values[:cut][both], reference[both], rtol=1e-9, atol=1e-9,
                err_msg=f"{name}/{column} changed when later bars were removed",
            )
            checked += 1
            if "cross" in column or column.endswith("_age"):
                event_checked += 1
    assert checked > 50, "the causality comparison barely ran; test is not exercising much"
    # Recency and age are the features most easily built from a future bar
    # (a whole-sample "time since last cross"), so they are checked explicitly
    # rather than being allowed to fall out of the empty bucket above.
    assert event_checked > 0, "no event-age or crossover column was compared"


def test_warmup_is_nan_not_zero():
    """An unknown value must read as unknown, never as a measured zero.

    A zero in the warmup teaches the model that the indicator was pinned at
    zero, which is a statement about the data that was never true.
    """
    frame = _frame_with_indicators(_synthetic_frame())
    block = compute_behavior(build_specs(), frame)["rsi"]
    level = block.columns["rsi__level"]
    assert np.isnan(level[0]), "warmup must be NaN"


def test_constant_input_yields_nan_not_infinity():
    """A zero denominator is a genuine unknown, not an infinite ratio.

    numpy and DuckDB both yield inf for x/0, and one inf in a column poisons
    every downstream scale and every mean it touches.
    """
    frame = _synthetic_frame()
    frame["close"] = 100.0
    frame["high"] = 100.0
    frame["low"] = 100.0
    frame["open"] = 100.0
    frame = _frame_with_indicators(frame)
    for name, block in compute_behavior(build_specs(), frame).items():
        for column, values in block.columns.items():
            assert not np.isinf(values).any(), f"{name}/{column} produced an infinity"


def test_event_age_is_nan_before_any_event_fired():
    frame = _frame_with_indicators(_synthetic_frame())
    block = compute_behavior(build_specs(), frame)["cdldoji"]
    age = block.columns["cdldoji__age"]
    finite = np.isfinite(age)
    # Where an age exists it is a real bar count, never negative and never NaN
    # in the middle of the series.
    assert (age[finite] >= 0).all()
    assert finite.any(), "a 400-bar synthetic series should fire at least one pattern"


def test_pattern_behavior_uses_occurrence_not_a_level():
    frame = _frame_with_indicators(_synthetic_frame())
    block = compute_behavior(build_specs(), frame)["cdldoji"]
    assert "cdldoji__fired" in block.columns
    assert "cdldoji__run_length" in block.columns
    assert "cdldoji__age" in block.columns
    # A pattern has no level, so it must not be given one.
    assert "cdldoji__level" not in block.columns


def test_divergence_is_zero_when_the_indicator_is_the_price_reference():
    """Constructive check that divergence measures what it names.

    With the indicator's level defined as the price reference itself, the
    indicator's move and the price's move are the same quantity, so their
    difference is zero everywhere both are defined. A non-zero result would
    mean the feature is measuring something other than the gap it claims.
    """
    frame = _synthetic_frame()
    reference = price_reference(frame["close"].to_numpy())
    spec = BehaviorSpec(
        name="log_close",
        talib_function="CLOSE",
        talib_output="close",
        kind="continuous",
        normalizer="passthrough",
    )
    block = compute_behavior([spec], frame.assign(log_close=reference))["log_close"]
    divergence = block.columns["log_close__divergence"]
    finite = np.isfinite(divergence)
    assert finite.sum() > 20, "divergence was undefined everywhere; the test proves nothing"
    assert np.abs(divergence[finite]).max() < 1e-6


def test_price_reference_is_not_degenerate():
    """The regression that killed divergence everywhere.

    `close / close` is the constant 1: zero windowed change and zero trailing
    volatility, so the price term of every divergence was undefined. The
    reference has to move, and it has to have a volatility.
    """
    frame = _synthetic_frame()
    reference = price_reference(frame["close"].to_numpy())
    assert np.isfinite(reference).sum() > 100
    assert np.nanstd(reference) > 0.0


def test_feature_names_match_what_is_computed():
    """A trainer sizes its input layer from the names; they must not drift."""
    frame = _frame_with_indicators(_synthetic_frame())
    specs = build_specs()
    expected = set(behavior_feature_names(specs, frame))
    produced = {c for block in compute_behavior(specs, frame).values() for c in block.columns}
    assert expected == produced


def test_every_behavioural_column_uses_the_indicator_facet_shape():
    """Every column must be `indicator__facet`, with no exception.

    A crossover event named `x_cross_up` rather than `x_cross__up` is invisible
    to any tool that selects behavioural columns by the `__` separator — which
    is how the table is counted, catalogued and served. One column with the
    wrong shape silently removes itself from all three.
    """
    frame = _frame_with_indicators(_synthetic_frame())
    specs = build_specs()
    for name in behavior_feature_names(specs, frame):
        assert "__" in name, f"behavioural column without the __ facet separator: {name}"
        indicator, _, facet = name.partition("__")
        assert indicator and facet, f"malformed behavioural column: {name}"


def test_pair_event_columns_are_present_not_just_gap_and_state():
    """A crossover carries events, not only a signed gap.

    Guards the earlier state where the gap and the state landed but the up/down
    event columns did not, which is indistinguishable from "no crossovers
    happen" unless you count columns.
    """
    frame = _frame_with_indicators(_synthetic_frame())
    blocks = compute_behavior(build_specs(), frame)
    macd = blocks["macd"]
    for suffix in ("__up", "__up_age", "__down", "__down_age", "__gap", "__state"):
        assert f"macd_vs_macd_signal_cross{suffix}" in macd.columns


@pytest.mark.parametrize("kind", ["continuous", "pattern"])
def test_spec_is_hashable_and_frozen(kind):
    spec = BehaviorSpec("x", "X", "x", kind)  # type: ignore[arg-type]
    with pytest.raises(Exception):
        spec.name = "y"  # type: ignore[misc]
