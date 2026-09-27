"""The label contract, checked against real MNQ bars.

1. Parameter contract — the names the dashboard's SQL generators take (current
   full-word names and the legacy abbreviations) are translated to the names
   the Python kernels read, so what is previewed is what is trained.
2. Parity — on identical bars the SQL preview generators and the Python
   training kernels produce the same labels for the four ML Studio strategies.
3. Smoke — EVERY registry generator's SQL executes on DuckDB and returns the
   contract columns (`timestamp`, `symbol`, `close`, `label`, `resolution_bars`).
4. No lookahead beyond the declared horizon — a generator run on a truncated
   window must reproduce, for every row whose label resolved inside the
   truncation, exactly the label the full window gave it. A whole-series
   statistic (the audit found two: a whole-range z-score and a PERCENT_RANK
   over every bar) fails this gate; a trailing window passes it.
5. Warmup is NULL, never zero — a barrier can never sit on its own entry price.

Bars come from the lake (`ohlcv_1d` in the serving snapshot) per the
no-synthetic-data rule; the DuckDB-backed tests skip when the lake is
unreachable. The SQL is rendered by the real TypeScript generators through
`scripts/dump_label_sql.ts`, so a drift in either implementation fails here.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import warnings

import numpy as np
import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from src.ml.shared.label_sets import label_horizon_bars, translate_label_params  # noqa: E402
from src.ml.shared.labels import (  # noqa: E402
    next_close_direction_labels,
    range_bucket_labels,
    structural_labels,
    triple_barrier_labels,
)

CONTRACT_COLUMNS = ("timestamp", "symbol", "close", "label", "resolution_bars")
BACKWARD_LOOKING = {"structural", "regime"}

# ─── 1. Parameter contract ──────────────────────────────────────────────────


def test_translate_range_bucket_names_reach_the_kernel():
    assert translate_label_params("range_bucket", {"horizonBars": 16, "bucketCount": 21, "bucketWidthPoints": 2}) == {
        "horizon_bars": 16, "n_buckets": 21, "bucket_width_pts": 2,
    }
    assert translate_label_params("range_bucket", {"horizon": 16, "nBuckets": 21, "bucketWidthPts": 2}) == {
        "horizon_bars": 16, "n_buckets": 21, "bucket_width_pts": 2,
    }


def test_translate_structural_pivot_lookback():
    assert translate_label_params("structural", {"pivotLookbackBars": 5}) == {"lookback_bars": 5}
    assert translate_label_params("structural", {"pivotLookback": 5}) == {"lookback_bars": 5}


def test_translate_next_close_direction_horizon():
    assert translate_label_params("next_close_direction", {"horizonBars": 3}) == {"horizon_bars": 3}
    assert translate_label_params("next_close_direction", {"horizon": 3}) == {"horizon_bars": 3}


def test_translate_triple_barrier_percent_units_and_warns_on_unequal_stop():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        out = translate_label_params(
            "triple_barrier",
            {"barrierUnits": "percent", "takeProfitPercent": 1.0, "stopLossPercent": 0.5,
             "holdingPeriodBars": 20, "minimumReturnPercent": 0.1},
        )
    assert out["horizon_bars"] == 20
    assert out["threshold_mode"] == "fixed_bp"
    assert out["threshold_bp"] == pytest.approx(100.0)
    assert "takeProfitPercent" not in out and "stopLossPercent" not in out
    assert any("unequal" in str(w.message) for w in caught)


def test_translate_triple_barrier_legacy_names_mean_percent():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        out = translate_label_params(
            "triple_barrier",
            {"takeProfitPct": 1.0, "stopLossPct": 1.0, "maxHoldingPeriod": 20, "minReturn": 0.1, "volatilityAdjust": True},
        )
    assert out == {"horizon_bars": 20, "atr_window": 20, "threshold_mode": "fixed_bp", "threshold_bp": pytest.approx(100.0)} or (
        out["threshold_mode"] == "fixed_bp" and out["horizon_bars"] == 20
    )


def test_translate_triple_barrier_volatility_units_to_atr():
    out = translate_label_params(
        "triple_barrier",
        {"barrierUnits": "volatility", "upperBarrierMultiple": 2.0, "lowerBarrierMultiple": 2.0,
         "volatilityMeasure": "average_true_range", "volatilityWindowBars": 14, "holdingPeriodBars": 12},
    )
    assert out == {"horizon_bars": 12, "atr_window": 14, "threshold_mode": "atr", "atr_multiple": 2.0}


def test_translate_is_a_no_op_on_kernel_names():
    params = {"horizon_bars": 5, "threshold_bp": 5.0, "threshold_mode": "fixed_bp"}
    assert translate_label_params("triple_barrier", params) == params


def test_label_horizon_bars_is_the_purge():
    assert label_horizon_bars("triple_barrier", {"holdingPeriodBars": 20}) == 20
    assert label_horizon_bars("next_close_direction", {"horizon": 3}) == 3
    assert label_horizon_bars("range_bucket", {"horizonBars": 16}) == 16
    assert label_horizon_bars("structural", {"pivotLookbackBars": 5}) == 0


# ─── Real bars and rendered SQL ─────────────────────────────────────────────


def _lake_daily_bars(n: int = 500):
    """Real MNQ daily bars from the serving snapshot, or None when unreachable."""
    try:
        import duckdb
    except ImportError:
        return None
    endpoint = os.environ.get("LAKE_S3_ENDPOINT", "http://127.0.0.1:9100")
    try:
        con = duckdb.connect()
        con.execute("SET TimeZone='UTC'")
        con.execute("INSTALL httpfs; LOAD httpfs;")
        con.execute(
            "CREATE OR REPLACE SECRET lake_s3 (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, URL_STYLE 'path', USE_SSL false, REGION ?)",
            [os.environ.get("MINIO_USER", "lakeadmin"), os.environ.get("MINIO_PASSWORD", "lakeadmin-dev"),
             endpoint.replace("http://", ""), os.environ.get("LAKE_REGION", "us-east-1")],
        )
        snapshot = os.environ.get("LAKE_SERVING_SNAPSHOT", "derived/recipe=questdb_full_2026-09-09")
        rows = con.execute(
            f"SELECT CAST(epoch_ms(timestamp) AS BIGINT) t, open, high, low, close, volume "
            f"FROM read_parquet('s3://{snapshot}/table=ohlcv_1d/**/*.parquet') "
            f"WHERE symbol = 'MNQ' ORDER BY timestamp DESC LIMIT {n}"
        ).fetchnumpy()
    except Exception:
        return None
    order = np.argsort(rows["t"])
    return {k: np.asarray(v)[order] for k, v in rows.items()}


def _render_sql():
    out = REPO / "tests" / "_label_sql_for_parity.json"
    proc = subprocess.run(
        ["npx", "tsx", "scripts/dump_label_sql.ts", str(out)],
        cwd=REPO, capture_output=True, text=True, shell=(os.name == "nt"),
    )
    if proc.returncode != 0 or not out.exists():
        pytest.skip(f"could not render generator SQL: {proc.stderr[-400:]}")
    rendered = json.loads(out.read_text(encoding="utf-8"))
    out.unlink(missing_ok=True)
    return rendered


def _bars_table(con, bars, n: int | None = None, name: str = "ohlcv"):
    stop = bars["t"].shape[0] if n is None else n
    con.execute(f"DROP TABLE IF EXISTS {name}")
    con.execute(
        f"CREATE TABLE {name} AS SELECT to_timestamp(t/1000.0)::TIMESTAMP AS timestamp, 'MNQ' AS symbol, "
        "o AS open, h AS high, l AS low, c AS close, v AS volume FROM "
        "(SELECT unnest(?) t, unnest(?) o, unnest(?) h, unnest(?) l, unnest(?) c, unnest(?) v)",
        [bars["t"][:stop].tolist(), bars["open"][:stop].tolist(), bars["high"][:stop].tolist(),
         bars["low"][:stop].tolist(), bars["close"][:stop].tolist(), bars["volume"][:stop].astype(float).tolist()],
    )


@pytest.fixture(scope="module")
def parity_fixture():
    bars = _lake_daily_bars()
    if bars is None or bars["t"].shape[0] < 100:
        pytest.skip("lake serving snapshot unreachable; parity needs real MNQ daily bars")
    rendered = _render_sql()
    import duckdb
    con = duckdb.connect()
    con.execute("SET TimeZone='UTC'")
    _bars_table(con, bars)
    return bars, rendered, con


def _sql_labels(con, sql: str, ts: np.ndarray) -> np.ndarray:
    # Epoch milliseconds straight from DuckDB. A naive Python datetime's
    # `.timestamp()` reads the wall clock in the host zone, which on a UTC-7
    # host shifted every key by seven hours and matched nothing.
    rows = con.execute(
        f"SELECT CAST(epoch_ms(timestamp) AS BIGINT) AS t, label FROM ({sql})"
    ).fetchall()
    m = {int(t): label for t, label in rows}
    return np.array([m.get(int(t), np.nan) for t in ts], dtype=float)


def _agreement(sql_labels: np.ndarray, py_labels: np.ndarray, valid: np.ndarray) -> float:
    py = py_labels.astype(float)
    py[~valid] = np.nan
    both = ~np.isnan(sql_labels) & ~np.isnan(py)
    assert both.sum() > 50, "too few comparable bars"
    return float((sql_labels[both] == py[both]).mean())


# ─── 2. Parity on real bars ─────────────────────────────────────────────────


def test_parity_next_close_direction(parity_fixture):
    bars, rendered, con = parity_fixture
    lab, valid = next_close_direction_labels(bars["close"], translate_label_params("next_close_direction", rendered["next_close_direction"]["params"]))
    mapped = np.where(lab == 1, 1.0, -1.0)  # kernel {0,1} -> SQL {-1,1}
    assert _agreement(_sql_labels(con, rendered["next_close_direction"]["sql"], bars["t"]), mapped, valid) == 1.0


def test_parity_range_bucket(parity_fixture):
    bars, rendered, con = parity_fixture
    lab, valid = range_bucket_labels(bars["close"], translate_label_params("range_bucket", rendered["range_bucket"]["params"]))
    assert _agreement(_sql_labels(con, rendered["range_bucket"]["sql"], bars["t"]), lab, valid) == 1.0


def test_parity_structural_semantics_and_window(parity_fixture):
    bars, rendered, con = parity_fixture
    lab, valid = structural_labels(bars["high"], bars["low"], translate_label_params("structural", rendered["structural"]["params"]))
    s = _sql_labels(con, rendered["structural"]["sql"], bars["t"])
    # The two vocabularies differ by convention, not meaning:
    #   SQL  2 HH  ↔ kernel 3 (only high broken)   SQL -2 LL ↔ kernel 0 (only low broken)
    #   SQL -1 outside ↔ kernel 4 (both broken)     SQL 0/1 ↔ kernel 1/2 (neither broken)
    sem_sql = np.where(s == 2, 3, np.where(s == -2, 0, np.where(s == -1, 4, np.where(np.isnan(s), np.nan, 1.5))))
    sem_py = lab.astype(float)
    sem_py[(sem_py == 1) | (sem_py == 2)] = 1.5
    assert _agreement(sem_sql, sem_py, valid) == 1.0
    # Both refuse the first `lookback` bars: the SQL used to label a partial window.
    assert np.isnan(s[:5]).all()


def test_parity_triple_barrier_symmetric_percent(parity_fixture):
    bars, rendered, con = parity_fixture
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        lab, valid = triple_barrier_labels(
            bars["close"], bars["high"], bars["low"],
            translate_label_params("triple_barrier", rendered["triple_barrier"]["params"]),
        )
    mapped = np.where(lab == 1, 1.0, -1.0)
    # The SQL also labels the vertical exit by sign and keeps same-bar double
    # touches with usable = false; the kernel drops both, so agreement is over
    # the rows both label.
    assert _agreement(_sql_labels(con, rendered["triple_barrier"]["sql"], bars["t"]), mapped, valid) == 1.0


# ─── 3. Smoke: every generator executes and carries the contract columns ────


def test_every_generator_executes_with_the_contract_columns(parity_fixture):
    bars, rendered, con = parity_fixture
    assert len(rendered) >= 16, sorted(rendered)
    for generator, entry in rendered.items():
        rows = con.execute(f"SELECT * FROM ({entry['sql']}) LIMIT 2000").fetchdf()
        for column in CONTRACT_COLUMNS:
            assert column in rows.columns, (generator, column, list(rows.columns))
        assert len(rows) > 0, generator
        assert rows["label"].notna().all(), generator
        assert (rows["resolution_bars"] >= 0).all(), generator
        if generator in BACKWARD_LOOKING:
            assert (rows["resolution_bars"] == 0).all(), generator
        else:
            assert (rows["resolution_bars"] >= 1).all(), generator
        # The naming rule: no abbreviated output columns.
        for column in rows.columns:
            assert not any(token in column.split("_") for token in ("pct", "pts", "vol", "bps", "ret", "px", "ts")), (generator, column)


# ─── 4. No lookahead beyond the declared horizon ────────────────────────────


def test_truncation_reproduces_every_resolved_label(parity_fixture):
    """Labels computed on bars[:n] equal the full-window labels for every row
    that resolved by bar n. Anything else means the label read past its own
    resolution bar."""
    bars, rendered, con = parity_fixture
    total = bars["t"].shape[0]
    cut = total * 3 // 5
    _bars_table(con, bars, n=cut, name="ohlcv_truncated")
    failures = {}
    for generator, entry in rendered.items():
        full = con.execute(
            f"SELECT CAST(epoch_ms(timestamp) AS BIGINT) AS t, label, resolution_bars FROM ({entry['sql']})"
        ).fetchall()
        truncated_sql = entry["sql"].replace("FROM ohlcv\n", "FROM ohlcv_truncated\n").replace("FROM ohlcv ", "FROM ohlcv_truncated ")
        assert "ohlcv_truncated" in truncated_sql, generator
        truncated = con.execute(
            f"SELECT CAST(epoch_ms(timestamp) AS BIGINT) AS t, label FROM ({truncated_sql})"
        ).fetchall()
        truncated_by_t = {int(t): label for t, label in truncated}
        last_kept = int(bars["t"][cut - 1])
        index_of = {int(t): i for i, t in enumerate(bars["t"])}
        mismatches = 0
        compared = 0
        for t, label, resolution_bars in full:
            event_index = index_of[int(t)]
            resolution_index = event_index + int(resolution_bars)
            if resolution_index >= cut:
                continue
            compared += 1
            if int(t) not in truncated_by_t or truncated_by_t[int(t)] != label:
                mismatches += 1
        # npmm labels only local extrema, so a few hundred daily bars give it a handful of rows.
        assert compared > 5, (generator, compared, last_kept)
        if mismatches:
            failures[generator] = (mismatches, compared)
    assert failures == {}, failures


# ─── 5. Warmup is NULL, never zero ──────────────────────────────────────────


def test_triple_barrier_warmup_never_collapses_onto_the_entry(parity_fixture):
    bars, rendered, con = parity_fixture
    rows = con.execute(
        "SELECT upper_barrier_price, lower_barrier_price, close FROM ({}) ORDER BY timestamp".format(rendered["triple_barrier"]["sql"])
    ).fetchdf()
    assert (rows["upper_barrier_price"] > rows["close"]).all()
    assert (rows["lower_barrier_price"] < rows["close"]).all()


def test_average_true_range_warmup_is_the_full_window_plus_one(parity_fixture):
    """The first bar has no previous close, so its true range is unknown. DuckDB's
    GREATEST skips NULL arguments, which once made that bar's range `high - low`
    and let the 20-bar ATR fill one bar early. The first event bar is the
    (window + 1)-th bar, and every emitted volatility scale is positive."""
    bars, rendered, con = parity_fixture
    entry = rendered["triple_barrier__average_true_range"]
    window = int(entry["params"]["volatilityWindowBars"])
    rows = con.execute(
        f"SELECT CAST(epoch_ms(timestamp) AS BIGINT) AS t, volatility_scale_points FROM ({entry['sql']}) ORDER BY timestamp"
    ).fetchdf()
    assert int(rows["t"].iloc[0]) == int(bars["t"][window]), (int(rows["t"].iloc[0]), int(bars["t"][window - 1]), int(bars["t"][window]))
    assert rows["volatility_scale_points"].notna().all()
    assert (rows["volatility_scale_points"] > 0).all()


def test_volatility_generators_report_null_not_zero_in_warmup(parity_fixture):
    bars, rendered, con = parity_fixture
    for generator, column in (("volatility_adaptive", "trailing_return_volatility_fraction"),
                              ("regime", "trailing_return_volatility_fraction")):
        rows = con.execute(
            f"SELECT {column} FROM ({rendered[generator]['sql']})"
        ).fetchdf()
        assert rows[column].notna().all(), generator
        assert (rows[column] > 0).all(), generator
