"""The label lifecycle's two contracts, checked against real MNQ bars.

1. Parameter contract — the names the dashboard's SQL generators take are
   translated to the names the Python kernels read, so what is previewed is
   what is trained.
2. Parity — on identical bars the SQL preview generators and the Python
   training kernels produce the same labels. Measured over 500 MNQ daily bars
   when this was first written: 100% agreement on all four ML Studio strategies
   once the parameters are translated.

Bars come from the lake (`ohlcv_1d` in the serving snapshot) per the
no-synthetic-data rule; the parity test skips when the lake is unreachable.
The SQL is rendered by the real TypeScript generators through
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

from src.ml.shared.label_sets import translate_label_params  # noqa: E402
from src.ml.shared.labels import (  # noqa: E402
    next_close_direction_labels,
    range_bucket_labels,
    structural_labels,
    triple_barrier_labels,
)

# ─── 1. Parameter contract ──────────────────────────────────────────────────


def test_translate_range_bucket_names_reach_the_kernel():
    assert translate_label_params("range_bucket", {"horizon": 16, "nBuckets": 21, "bucketWidthPts": 2}) == {
        "horizon_bars": 16, "n_buckets": 21, "bucket_width_pts": 2,
    }


def test_translate_structural_pivot_lookback():
    assert translate_label_params("structural", {"pivotLookback": 5}) == {"lookback_bars": 5}


def test_translate_next_close_direction_horizon():
    assert translate_label_params("next_close_direction", {"horizon": 3}) == {"horizon_bars": 3}


def test_translate_triple_barrier_symmetric_barrier_and_warns_on_unequal_stop():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        out = translate_label_params(
            "triple_barrier",
            {"takeProfitPct": 1.0, "stopLossPct": 0.5, "maxHoldingPeriod": 20, "minReturn": 0.1},
        )
    assert out["horizon_bars"] == 20
    assert out["threshold_bp"] == pytest.approx(100.0)
    assert "takeProfitPct" not in out and "stopLossPct" not in out
    assert any("unequal" in str(w.message) for w in caught)


def test_translate_is_a_no_op_on_kernel_names():
    params = {"horizon_bars": 5, "threshold_bp": 5.0}
    assert translate_label_params("triple_barrier", params) == params


# ─── 2. Parity on real bars ─────────────────────────────────────────────────


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


@pytest.fixture(scope="module")
def parity_fixture():
    bars = _lake_daily_bars()
    if bars is None or bars["t"].shape[0] < 100:
        pytest.skip("lake serving snapshot unreachable; parity needs real MNQ daily bars")
    out = REPO / "tests" / "_label_sql_for_parity.json"
    proc = subprocess.run(
        ["npx", "tsx", "scripts/dump_label_sql.ts", str(out)],
        cwd=REPO, capture_output=True, text=True, shell=(os.name == "nt"),
    )
    if proc.returncode != 0 or not out.exists():
        pytest.skip(f"could not render generator SQL: {proc.stderr[-400:]}")
    sql = json.loads(out.read_text(encoding="utf-8"))
    out.unlink(missing_ok=True)

    import duckdb
    con = duckdb.connect()
    con.execute("SET TimeZone='UTC'")
    con.execute(
        "CREATE TABLE ohlcv AS SELECT to_timestamp(t/1000.0)::TIMESTAMP AS timestamp, 'MNQ' AS symbol, "
        "o AS open, h AS high, l AS low, c AS close, v AS volume FROM "
        "(SELECT unnest(?) t, unnest(?) o, unnest(?) h, unnest(?) l, unnest(?) c, unnest(?) v)",
        [bars["t"].tolist(), bars["open"].tolist(), bars["high"].tolist(), bars["low"].tolist(),
         bars["close"].tolist(), bars["volume"].astype(float).tolist()],
    )
    return bars, sql, con


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


def test_parity_next_close_direction(parity_fixture):
    bars, sql, con = parity_fixture
    lab, valid = next_close_direction_labels(bars["close"], translate_label_params("next_close_direction", {"horizon": 1}))
    mapped = np.where(lab == 1, 1.0, -1.0)  # kernel {0,1} -> SQL {-1,1}
    assert _agreement(_sql_labels(con, sql["next_close_direction"], bars["t"]), mapped, valid) == 1.0


def test_parity_range_bucket(parity_fixture):
    bars, sql, con = parity_fixture
    lab, valid = range_bucket_labels(bars["close"], translate_label_params("range_bucket", {"horizon": 16, "nBuckets": 21, "bucketWidthPts": 2}))
    assert _agreement(_sql_labels(con, sql["range_bucket"], bars["t"]), lab, valid) == 1.0


def test_parity_structural_semantics_and_window(parity_fixture):
    bars, sql, con = parity_fixture
    lab, valid = structural_labels(bars["high"], bars["low"], translate_label_params("structural", {"pivotLookback": 5}))
    s = _sql_labels(con, sql["structural"], bars["t"])
    # The two vocabularies differ by convention, not meaning:
    #   SQL  2 HH  ↔ kernel 3 (only high broken)   SQL -2 LL ↔ kernel 0 (only low broken)
    #   SQL -1 outside ↔ kernel 4 (both broken)     SQL 0/1 ↔ kernel 1/2 (neither broken)
    sem_sql = np.where(s == 2, 3, np.where(s == -2, 0, np.where(s == -1, 4, np.where(np.isnan(s), np.nan, 1.5))))
    sem_py = lab.astype(float)
    sem_py[(sem_py == 1) | (sem_py == 2)] = 1.5
    assert _agreement(sem_sql, sem_py, valid) == 1.0
    # Both refuse the first `lookback` bars: the SQL used to label a partial window.
    assert np.isnan(s[:5]).all()


def test_parity_triple_barrier_symmetric(parity_fixture):
    bars, sql, con = parity_fixture
    lab, valid = triple_barrier_labels(
        bars["close"], bars["high"], bars["low"],
        translate_label_params("triple_barrier", {"takeProfitPct": 1.0, "stopLossPct": 1.0, "maxHoldingPeriod": 20, "minReturn": 0}),
    )
    mapped = np.where(lab == 1, 1.0, -1.0)
    # The SQL also labels the time-barrier exit by sign; the kernel drops those
    # rows, so agreement is over the rows both label.
    assert _agreement(_sql_labels(con, sql["triple_barrier"], bars["t"]), mapped, valid) == 1.0
