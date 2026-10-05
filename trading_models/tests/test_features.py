"""
Invariant tests for src.features on synthetic two-contract OHLCV.

Run from trading_models/:  python -m pytest tests/test_features.py -q
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import polars as pl
import pytest

from src.features.Blocks import LabelBlock, default_blocks
from src.features.Build import FeaturePipeline
from src.features.Registry import FeatureKind, FeatureRegistry, FeatureSpec
from src.features.Vectors import decode_state, state_matrix

N_PER_CONTRACT = 800
H = 15


def _bars(seed: int = 7) -> pl.LazyFrame:
    """Two contracts with a +2000-point level jump at the roll (back-adjustment gap)."""
    rng = np.random.default_rng(seed)
    t0 = datetime(2024, 1, 2, tzinfo=timezone.utc)
    frames = []
    for i, (sym, base) in enumerate([("MNQH4", 15000.0), ("MNQM4", 17000.0)]):
        close = base + np.cumsum(rng.normal(0, 3, N_PER_CONTRACT))
        open_ = np.concatenate([[base], close[:-1]])
        spread = np.abs(rng.normal(0, 2, N_PER_CONTRACT))
        frames.append(pl.DataFrame({
            "timestamp": [t0 + timedelta(minutes=i * N_PER_CONTRACT + k) for k in range(N_PER_CONTRACT)],
            "contract_symbol": sym,
            "open": open_,
            "high": np.maximum(open_, close) + spread,
            "low": np.minimum(open_, close) - spread,
            "close": close,
            "volume": rng.integers(100, 2000, N_PER_CONTRACT).astype(float),
        }))
    return pl.concat(frames).lazy()


@pytest.fixture(scope="module")
def built() -> tuple[FeaturePipeline, pl.DataFrame]:
    pipe = FeaturePipeline(default_blocks())
    return pipe, pipe.transform(_bars(), "MNQ", "1m").collect()


def test_registry_rejects_label_in_state_bits():
    reg = FeatureRegistry()
    with pytest.raises(ValueError):
        reg.register(FeatureSpec(999, "LBL_X", "label", FeatureKind.LABEL, "x", bit=20))


def test_registry_ids_and_bits_unique(built):
    pipe, _ = built
    frame = pipe.registry.to_frame()
    assert frame["feature_id"].is_unique().all()
    bits = frame.filter(pl.col("bit").is_not_null())["bit"]
    assert bits.is_unique().all()
    assert frame.filter(pl.col("kind") == "label")["bit"].null_count() == frame.filter(pl.col("kind") == "label").height


def test_trend_one_hot_and_ternary(built):
    _, df = built
    assert (df["trend_up"] + df["trend_down"] + df["trend_flat"] == 1).all()
    assert (df["trend_dir"] == df["trend_up"] - df["trend_down"]).all()
    assert set(df["trend_dir"].unique().to_list()) <= {-1, 0, 1}


def test_macd_cross_definition(built):
    _, df = built
    df = df.with_columns(pl.col("macd_hist").shift(1).over("contract_symbol").alias("prev"))
    ups = df.filter(pl.col("macd_cross_up") == 1)
    downs = df.filter(pl.col("macd_cross_down") == 1)
    assert ups.height > 0 and downs.height > 0
    assert ((ups["macd_hist"] > 0) & (ups["prev"] <= 0)).all()
    assert ((downs["macd_hist"] < 0) & (downs["prev"] >= 0)).all()
    assert (df["macd_cross_up"] + df["macd_cross_down"] <= 1).all()


def test_label_is_future_trend_return_within_contract(built):
    """RET_LOG_15M at t must equal trend_ret at t+15 in the same contract (forward label alignment)."""
    _, df = built
    tag = LabelBlock().tag
    aligned = df.with_columns(pl.col("trend_ret").shift(-H).over("contract_symbol").alias("fwd_trend"))
    both = aligned.drop_nulls(["fwd_trend", f"RET_LOG_{tag}"])
    assert both.height > 0
    np.testing.assert_allclose(both[f"RET_LOG_{tag}"].to_numpy(), both["fwd_trend"].to_numpy(), atol=1e-12)


def test_label_null_at_contract_tail(built):
    _, df = built
    tag = LabelBlock().tag
    for sym in ("MNQH4", "MNQM4"):
        tail = df.filter(pl.col("contract_symbol") == sym).tail(H)
        assert tail[f"DIR_TERN_{tag}"].null_count() == H


def test_roll_gap_never_leaks(built):
    """The +2000 jump at the roll must not appear in any return or fire any indicator."""
    _, df = built
    assert df["trend_ret"].abs().max() < 0.05   # a cross-roll return would be ~log(17000/15000)=0.125
    first_m4 = df.filter(pl.col("contract_symbol") == "MNQM4")["timestamp"].min()
    roll_ts = datetime(2024, 1, 2, tzinfo=timezone.utc) + timedelta(minutes=N_PER_CONTRACT)
    assert first_m4 > roll_ts                    # warm-up restarted in the new contract


def test_state_code_roundtrip_and_events(built):
    pipe, df = built
    reg = pipe.registry
    mat = state_matrix(df, reg)
    for i in (0, df.height // 2, df.height - 1):
        code = int(df["state_code"][i])
        on = decode_state(code, reg)
        expected = [s.key for j, s in enumerate(reg.flags_by_bit()) if mat[i, j] == 1]
        assert on == expected
    events = pipe.events(df)
    assert events.height == int(mat.sum())
    assert set(events["feature_id"].unique().to_list()) <= {s.feature_id for s in reg.flags_by_bit()}


def test_no_label_columns_in_state_matrix(built):
    pipe, _ = built
    keys = [s.key for s in pipe.registry.flags_by_bit()]
    assert not any(k.startswith(("LBL_", "DIR_TERN_", "RET_LOG_")) for k in keys)
