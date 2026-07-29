"""
Tests for ml.shared.dataset — the domain-agnostic DataSource descriptor +
load_dataset(), plus the feature-offering filter and raw_columns fallback.

Per the project's no-synthetic-data rule, every test that actually loads a
*dataset* hits the real, running QuestDB instance (http://127.0.0.1:9000) or a
real parquet file already on disk (data/rollovers.parquet) — nothing here is
fabricated market data. Pure-function unit tests (content-hash mechanics,
the requires[]-subset filter) use small hand-built arrays/dicts, matching the
existing convention in tests/ml/conftest.py's `small_ohlcv` fixture.

Import style follows tests/ml/shared/test_shmem.py: `import ml.shared.X` —
NOT `from shared.X import ...` or `import shared.X`, because
tests/ml/shared/__init__.py shadows src/ml/shared/ under a bare `shared`
top-level name (see tests/ml/test_diagnostics_schema.py's comment on the same
gotcha). Going through the `ml` namespace package (rooted at `src`, on
pythonpath per pyproject.toml) avoids the collision.
"""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest

import ml.shared.data as data
import ml.shared.dataset as dataset

# ── DataSource validation (no network) ─────────────────────────────────────


def test_datasource_from_dict_requires_kind():
    with pytest.raises(ValueError, match="missing required key 'kind'"):
        dataset.DataSource.from_dict({"table": "x"})


def test_datasource_from_dict_rejects_unknown_keys():
    with pytest.raises(ValueError, match="unknown keys"):
        dataset.DataSource.from_dict({"kind": "parquet", "path": "x", "bogus": 1})


def test_datasource_from_dict_accepts_known_keys():
    ds = dataset.DataSource.from_dict({"kind": "questdb_ohlcv", "symbol": "MNQ", "timeframe": "1m"})
    assert ds.kind == "questdb_ohlcv"
    assert ds.symbol == "MNQ"
    assert ds.max_bars == 0  # default


def test_load_dataset_unknown_kind():
    with pytest.raises(ValueError, match="Unknown DataSource kind"):
        dataset.load_dataset({"kind": "not_a_real_kind"})


def test_load_dataset_questdb_ohlcv_missing_fields():
    with pytest.raises(ValueError, match="requires 'symbol' and 'timeframe'"):
        dataset.load_dataset({"kind": "questdb_ohlcv"})


def test_load_dataset_questdb_table_missing_fields():
    with pytest.raises(ValueError, match="requires 'table' and 'time_column'"):
        dataset.load_dataset({"kind": "questdb_table", "table": "candle_geometry_1m"})


def test_load_dataset_parquet_missing_path():
    with pytest.raises(ValueError, match="requires 'path'"):
        dataset.load_dataset({"kind": "parquet"})


def test_load_dataset_parquet_missing_file():
    with pytest.raises(FileNotFoundError):
        dataset.load_dataset({"kind": "parquet", "path": "data/does_not_exist_xyz.parquet"})


# ── SQL-injection rejection (validated before any HTTP call — no network) ──


def test_questdb_table_rejects_unsafe_table_name():
    injected = "candle_geometry_1m" + chr(59) + " SELECT 1"
    with pytest.raises(ValueError, match="Invalid table"):
        dataset.load_dataset({"kind": "questdb_table", "table": injected, "time_column": "timestamp"})


def test_questdb_table_rejects_unsafe_filter_value():
    injected = "MNQ" + chr(39) + chr(59) + " SELECT 1"
    with pytest.raises(ValueError, match="Invalid filters value"):
        dataset.load_dataset({
            "kind": "questdb_table",
            "table": "candle_geometry_1m",
            "time_column": "timestamp",
            "filters": {"symbol": injected},
        })


def test_questdb_table_rejects_unsafe_sample_by():
    with pytest.raises(ValueError, match="Invalid sample_by"):
        dataset.load_dataset({
            "kind": "questdb_table",
            "table": "candle_geometry_1m",
            "time_column": "timestamp",
            "sample_by": "5m; SELECT 1",
        })


# ── content_hash — pure function, small hand-built arrays ──────────────────


def test_content_hash_deterministic_and_order_independent_input_dict():
    index = np.array(["2024-01-01T00:00:00", "2024-01-01T00:01:00"], dtype="datetime64[us]")
    cols_a = {"close": np.array([1.0, 2.0]), "volume": np.array([10.0, 20.0])}
    cols_b = {"volume": np.array([10.0, 20.0]), "close": np.array([1.0, 2.0])}  # different dict insertion order
    h_a = dataset._content_hash(index, cols_a)
    h_b = dataset._content_hash(index, cols_b)
    assert h_a == h_b, "hash must be stable regardless of dict insertion order (documented sort-by-name)"


def test_content_hash_changes_with_data():
    index = np.array(["2024-01-01T00:00:00"], dtype="datetime64[us]")
    h1 = dataset._content_hash(index, {"close": np.array([1.0])})
    h2 = dataset._content_hash(index, {"close": np.array([1.0000001])})
    assert h1 != h2


def test_content_hash_changes_with_index():
    cols = {"close": np.array([1.0])}
    h1 = dataset._content_hash(np.array(["2024-01-01T00:00:00"], dtype="datetime64[us]"), cols)
    h2 = dataset._content_hash(np.array(["2024-01-01T00:01:00"], dtype="datetime64[us]"), cols)
    assert h1 != h2


def test_content_hash_changes_with_column_name():
    index = np.array(["2024-01-01T00:00:00"], dtype="datetime64[us]")
    h1 = dataset._content_hash(index, {"close": np.array([1.0])})
    h2 = dataset._content_hash(index, {"open": np.array([1.0])})
    assert h1 != h2


# ── offerable_features / raw_columns_matrix — pure function, hand-built dataset dicts ──


def test_offerable_features_ohlcv_columns_qualify():
    feats = dataset.offerable_features(["open", "high", "low", "close", "volume"])
    assert len(feats) > 0
    names = {f["name"] for f in feats}
    assert "return_1" in names  # requires: [close]


def test_offerable_features_empty_when_no_ohlcv_columns():
    feats = dataset.offerable_features(["open_norm", "close_norm", "body_norm"])
    assert feats == []


def test_offerable_features_is_pure_subset_test():
    feature_defs = [
        {"name": "a", "requires": ["x"]},
        {"name": "b", "requires": ["x", "y"]},
        {"name": "c", "requires": []},
    ]
    offered = dataset.offerable_features(["x"], feature_defs=feature_defs)
    assert {f["name"] for f in offered} == {"a", "c"}


def test_raw_columns_matrix_uses_numeric_columns_only_sorted():
    ds = {
        "columns": {
            "symbol": np.array(["MNQ", "MNQ"], dtype=object),
            "close_norm": np.array([0.1, 0.2]),
            "body_norm": np.array([0.3, 0.4]),
        },
        "provided_columns": ["symbol", "close_norm", "body_norm"],
    }
    matrix, names = dataset.raw_columns_matrix(ds)
    assert names == ["body_norm", "close_norm"]  # sorted, symbol excluded (object dtype)
    assert matrix.shape == (2, 2)
    np.testing.assert_array_equal(matrix[:, 0], [0.3, 0.4])
    np.testing.assert_array_equal(matrix[:, 1], [0.1, 0.2])


def test_raw_columns_matrix_raises_when_no_numeric_columns():
    ds = {"columns": {"symbol": np.array(["MNQ"], dtype=object)}, "provided_columns": ["symbol"]}
    with pytest.raises(ValueError, match="no numeric columns"):
        dataset.raw_columns_matrix(ds)


# ── questdb_ohlcv — real QuestDB, behavior-compat with load_ohlcv_arrays ───


@pytest.mark.slow
def test_questdb_ohlcv_matches_load_ohlcv_arrays_exactly():
    """load_dataset(questdb_ohlcv) must be element-wise identical to the
    existing load_ohlcv_arrays for the same window — the plan's explicit
    behavior-compatibility requirement. Real data, real QuestDB instance."""
    raw = data.load_ohlcv_arrays("MNQ", "1m", max_bars=500)
    ds = dataset.load_dataset({"kind": "questdb_ohlcv", "symbol": "MNQ", "timeframe": "1m", "max_bars": 500})

    assert ds["identity"]["row_count"] == raw["open"].shape[0]
    for col in ("open", "high", "low", "close", "volume"):
        assert np.array_equal(raw[col], ds["columns"][col]), f"{col} arrays differ"

    assert ds["provided_columns"] == ["open", "high", "low", "close", "volume"]
    assert ds["index"].dtype.kind == "M"
    assert ds["index"].shape[0] == raw["open"].shape[0]
    assert isinstance(ds["identity"]["content_hash"], str) and len(ds["identity"]["content_hash"]) == 64
    assert ds["identity"]["first_ts"] is not None
    assert ds["identity"]["last_ts"] is not None


# ── questdb_table — real QuestDB, non-OHLCV-shaped table ───────────────────


@pytest.mark.slow
def test_questdb_table_non_ohlcv_shape_falls_back_to_raw_columns():
    """candle_geometry_1m has none of the OHLCV column names — no built-in
    feature should qualify, and raw_columns_matrix should pick up its
    numeric columns."""
    ds = dataset.load_dataset({
        "kind": "questdb_table",
        "table": "candle_geometry_1m",
        "time_column": "timestamp",
        "filters": {"symbol": "MNQ"},
        "max_bars": 500,
    })

    assert ds["identity"]["row_count"] == 500
    assert "symbol" in ds["provided_columns"]
    assert "close" not in ds["provided_columns"]  # not OHLCV-shaped
    assert "open" not in ds["provided_columns"]

    offered = dataset.offerable_features(ds["provided_columns"])
    assert offered == [], "no built-in feature requires candle-geometry column names"

    matrix, names = dataset.raw_columns_matrix(ds)
    assert matrix.shape[0] == 500
    assert "symbol" not in names  # object dtype excluded
    assert set(names) == {
        "open_norm", "close_norm", "body_norm", "upper_norm", "lower_norm",
        "range_z", "body_z", "wick_z", "return_z", "volume_z",
    }


@pytest.mark.slow
def test_questdb_table_content_hash_stable_and_window_sensitive():
    src = {
        "kind": "questdb_table", "table": "candle_geometry_1m", "time_column": "timestamp",
        "filters": {"symbol": "MNQ"}, "max_bars": 300,
    }
    h1 = dataset.load_dataset(src)["identity"]["content_hash"]
    h2 = dataset.load_dataset(src)["identity"]["content_hash"]
    assert h1 == h2, "identical query must produce identical content_hash"

    src_wider = dict(src, max_bars=301)
    h3 = dataset.load_dataset(src_wider)["identity"]["content_hash"]
    assert h1 != h3, "a different window must produce a different content_hash"


@pytest.mark.slow
def test_questdb_table_sample_by_downsamples_via_real_query():
    ds = dataset.load_dataset({
        "kind": "questdb_table",
        "table": "candle_geometry_1m",
        "time_column": "timestamp",
        "filters": {"symbol": "MNQ"},
        "sample_by": "5m",
        "max_bars": 50,
    })
    assert ds["identity"]["row_count"] == 50
    assert set(ds["provided_columns"]) >= {"close_norm", "range_z"}


# ── parquet — real file on disk (data/rollovers.parquet) ───────────────────


def test_parquet_loads_real_rollovers_file():
    ds = dataset.load_dataset({"kind": "parquet", "path": "data/rollovers.parquet"})
    assert ds["identity"]["row_count"] == 353
    assert "from_close" in ds["provided_columns"]
    assert "root" in ds["provided_columns"]  # string column present but not numeric-feature material

    offered = dataset.offerable_features(ds["provided_columns"])
    assert offered == [], "rollover columns don't overlap OHLCV requires[]"

    matrix, names = dataset.raw_columns_matrix(ds)
    assert matrix.shape[0] == 353
    assert "root" not in names  # string column excluded from numeric fallback
    assert "from_close" in names


def test_parquet_zero_rows_raises(tmp_path):
    """Zero-row edge case built from the real rollovers file's own schema
    (filtered to no matches) — not fabricated data, just an empty real slice."""
    df = pl.read_parquet("data/rollovers.parquet")
    empty = df.filter(pl.col("root") == "NO_SUCH_ROOT_XYZ")
    assert empty.height == 0
    out_path = tmp_path / "empty_rollovers.parquet"
    empty.write_parquet(out_path)

    with pytest.raises(ValueError, match="zero rows"):
        dataset.load_dataset({"kind": "parquet", "path": str(out_path)})
