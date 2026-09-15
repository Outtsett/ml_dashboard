"""
Domain-agnostic dataset loading — the ``DataSource`` descriptor + ``load_dataset``.

``data.py::load_ohlcv_arrays`` hard-codes an OHLCV (Open-High-Low-Close-Volume)
shape: ``FROM ohlcv ... SAMPLE BY {interval}``, a mandatory ``symbol`` column,
and a fixed ``{open, high, low, close, volume, timestamp}`` return dict. That
is one possible dataset, not the interface. This module generalizes the data
layer so the workspace can train on any table in the lake or any parquet file —
while leaving every existing OHLCV caller byte-for-byte unchanged.

Every non-parquet read goes through ``lake.serving`` — DuckDB in-process over
the Iceberg lake at ``E:/lake``.

Three ``DataSource`` kinds. The two ``questdb_*`` kind strings are a frozen wire
contract (stored dataset configs and the dashboard both send them); they name
the shape of the request, not the engine serving it:

  - ``questdb_ohlcv``  {symbol, timeframe, date_range?, max_bars?}
    The OHLCV path, preserved exactly. Delegates to ``load_ohlcv_arrays``.
  - ``questdb_table``  {table, time_column, filters?, sample_by?, max_bars?}
    Any lake table, arbitrary column shape.
  - ``parquet``        {path}
    A local parquet file; the time column (if any) is auto-detected.

``load_dataset(source)`` returns::

    {
        "columns": dict[str, np.ndarray],   # every non-time-axis column
        "index": np.ndarray,                # time axis (datetime64[us]) or a row ordinal
        "provided_columns": list[str],      # keys of "columns", for the feature-offering filter
        "identity": {
            "query_template": str,          # the SQL issued (or "parquet:<path>")
            "content_hash": str,             # sha256 over the materialized data — see _content_hash
            "row_count": int,
            "first_ts": str | None,          # ISO string, or None for an ordinal (non-time) index / 0 rows
            "last_ts": str | None,
        },
    }

Feature offering is mechanical: a ``features.json`` entry is offerable iff its
``requires[]`` is a subset of ``provided_columns`` — see ``offerable_features``.
When nothing qualifies (a dataset with none of the OHLCV column names), the
dataset's own numeric columns become the feature matrix via
``raw_columns_matrix`` — the fallback pipeline, not a per-dataset special case.
"""

from __future__ import annotations

import dataclasses
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from .data import _validate_date, _validate_sql_input, load_ohlcv_arrays
from .protocol import emit_log, emit_progress

# Columns exposed by the OHLCV path. "timestamp" is deliberately
# excluded — it becomes the returned dataset's `index`, not a feature column,
# matching how features.json `requires[]` never names "timestamp".
_OHLCV_PROVIDED_COLUMNS: tuple[str, ...] = ("open", "high", "low", "close", "volume")

# ── DataSource descriptor ───────────────────────────────────────────────────


@dataclass(frozen=True)
class DataSource:
    """Descriptor for where a dataset comes from. See module docstring for the
    three supported ``kind`` values and their fields."""

    kind: str

    # questdb_ohlcv
    symbol: str | None = None
    timeframe: str | None = None
    date_range: dict | None = None

    # questdb_table
    table: str | None = None
    time_column: str | None = None
    filters: dict[str, Any] | None = None
    sample_by: str | None = None

    # shared by questdb_ohlcv and questdb_table (0 == unbounded)
    max_bars: int = 0

    # parquet
    path: str | None = None

    @staticmethod
    def from_dict(d: dict) -> "DataSource":
        """Build a DataSource from a plain dict, rejecting unknown keys.

        This is the entry point for descriptors that cross a JSON boundary
        (e.g. from the Node orchestrator) — ``load_dataset`` accepts either a
        ``DataSource`` or a dict and normalizes via this constructor.
        """
        if "kind" not in d:
            raise ValueError("DataSource dict missing required key 'kind'")
        known = {f.name for f in dataclasses.fields(DataSource)}
        extra = set(d) - known
        if extra:
            raise ValueError(f"DataSource: unknown keys {sorted(extra)}")
        return DataSource(**d)


def load_dataset(source: DataSource | dict) -> dict:
    """Load a dataset per its ``DataSource`` descriptor.

    Returns ``{columns, index, provided_columns, identity}`` — see the module
    docstring for the exact shape. Raises ``ValueError`` for an unknown
    ``kind`` or missing required fields (no silent fallback to a default
    dataset — an unmapped source is a bug, not something to paper over).
    """
    if isinstance(source, dict):
        source = DataSource.from_dict(source)

    if source.kind == "questdb_ohlcv":
        return _load_questdb_ohlcv(source)
    if source.kind == "questdb_table":
        return _load_questdb_table(source)
    if source.kind == "parquet":
        return _load_parquet(source)
    raise ValueError(
        f"Unknown DataSource kind: {source.kind!r} "
        "(expected one of: questdb_ohlcv, questdb_table, parquet)"
    )


# ── OHLCV kind — delegates to data.py, byte-for-byte identical ────────────


def _load_questdb_ohlcv(source: DataSource) -> dict:
    if not source.symbol or not source.timeframe:
        raise ValueError("questdb_ohlcv source requires 'symbol' and 'timeframe'")

    raw = load_ohlcv_arrays(
        source.symbol, source.timeframe, max_bars=source.max_bars, date_range=source.date_range
    )
    index = _timestamps_to_index(raw["timestamp"])
    columns = {name: raw[name] for name in _OHLCV_PROVIDED_COLUMNS}

    # Provenance label for the run, not an executable string: the real SQL is
    # built per call by data.py::_build_sample_sql, which reads the lake's
    # pre-aggregated view for <interval> when one exists and resamples the base
    # ohlcv view when it does not.
    query_template = (
        "lake.serving: SELECT symbol, timestamp, open, high, low, close, volume "
        "FROM <view for <interval>, else resample of ohlcv> "
        "WHERE symbol = <symbol> ORDER BY timestamp"
    )
    identity = _build_identity(query_template, index, columns)
    return {
        "columns": columns,
        "index": index,
        "provided_columns": list(_OHLCV_PROVIDED_COLUMNS),
        "identity": identity,
    }


# ── questdb_table — arbitrary lake table, generic schema ──────────────────


def _load_questdb_table(source: DataSource) -> dict:
    if not source.table or not source.time_column:
        raise ValueError("questdb_table source requires 'table' and 'time_column'")

    table = _validate_sql_input(source.table, "table")
    time_column = _validate_sql_input(source.time_column, "time_column")
    where = _build_generic_where(source.filters)
    limit = f" LIMIT {int(source.max_bars)}" if source.max_bars else ""

    if source.sample_by:
        # Every non-key column needs an aggregate under a time bucket. The
        # intent is "most recent value in the bucket", which in DuckDB is
        # arg_max(col, time_column) - NOT last(), which is order-unspecified
        # inside a group and would drift between runs. The column list is
        # discovered, not hard-coded, so this stays one generic path whatever
        # shape the table has.
        sample_by = _validate_sql_input(source.sample_by, "sample_by", pattern=r"^[0-9]+[a-zA-Z]$")
        other_cols = _fetch_table_columns(table, exclude=time_column)
        # Every identifier is quoted: a discovered column list is not under this
        # module's control and can collide with a DuckDB reserved word.
        select_list = ", ".join(
            [f'time_bucket(INTERVAL {_interval_literal(sample_by)}, "{time_column}") AS "{time_column}"']
            + [f'arg_max("{c}", "{time_column}") AS "{c}"' for c in other_cols]
        )
        sql = (
            f"SELECT {select_list} FROM {table}{where} "
            f"GROUP BY 1 ORDER BY {time_column}{limit}"
        )
    else:
        sql = f"SELECT * FROM {table}{where} ORDER BY {time_column}{limit}"

    emit_log(f"[dataset] Loading table '{table}' via DuckDB over the lake...")
    df = _fetch_csv_dataframe(sql)
    if df is None or df.height == 0:
        raise ValueError(f"No rows returned for questdb_table '{table}'")
    if time_column not in df.columns:
        raise ValueError(
            f"questdb_table '{table}': time_column '{time_column}' not present in result "
            f"(columns returned: {df.columns})"
        )

    index = _column_to_index(df[time_column])
    columns: dict[str, np.ndarray] = {
        name: _series_to_array(df[name]) for name in df.columns if name != time_column
    }

    emit_progress(df.height, df.height, "loading_data")
    identity = _build_identity(sql, index, columns)
    return {
        "columns": columns,
        "index": index,
        "provided_columns": list(columns.keys()),
        "identity": identity,
    }


_INTERVAL_UNIT = {"s": "second", "m": "minute", "h": "hour", "d": "day", "w": "week"}


def _interval_literal(sample_by: str) -> str:
    """The timeframe shorthand ``5m`` as a DuckDB interval literal, ``'5 minutes'``.

    ``m`` means minute here - never month. A month would be ``M`` and no caller
    uses one, so an unknown unit raises rather than guessing at a bucket size.
    """
    count, unit = sample_by[:-1], sample_by[-1]
    if unit not in _INTERVAL_UNIT or not count.isdigit():
        raise ValueError(
            f"unsupported sample_by {sample_by!r}; expected <int>[{''.join(_INTERVAL_UNIT)}]"
        )
    return f"'{int(count)} {_INTERVAL_UNIT[unit]}s'"


def _fetch_table_columns(table: str, *, exclude: str) -> list[str]:
    """Discover a table's column names via SHOW COLUMNS, excluding `exclude`."""
    df = _fetch_csv_dataframe(f"DESCRIBE {table}")
    if df is None or "column_name" not in df.columns:
        raise RuntimeError(f"Could not discover columns for table '{table}'")
    return [c for c in df["column_name"].to_list() if c != exclude]


def _build_generic_where(filters: dict[str, Any] | None) -> str:
    """Build a WHERE clause from a generic filter dict.

    Each value is either a scalar (equality) or a dict with any of
    gte/lte/gt/lt/eq (range/comparison) — the latter is how a time_column
    range restriction is expressed, since the table kind has no dedicated
    date_range field. Every column name and value is regex-validated before
    interpolation — the SQL reaches DuckDB as one composed string, the same
    constraint `data.py` already works under for `_build_where` — never
    concatenated raw.
    """
    if not filters:
        return ""
    op_map = {"gte": ">=", "lte": "<=", "gt": ">", "lt": "<", "eq": "="}
    clauses: list[str] = []
    for col, val in filters.items():
        col_v = _validate_sql_input(col, "filters key")
        if isinstance(val, dict):
            for op_key, sql_op in op_map.items():
                if op_key in val:
                    clauses.append(f"{col_v} {sql_op} {_sql_literal(val[op_key])}")
        else:
            clauses.append(f"{col_v} = {_sql_literal(val)}")
    if not clauses:
        return ""
    return " WHERE " + " AND ".join(clauses)


def _sql_literal(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        if re.match(r"^\d{4}-\d{2}-\d{2}", value):
            _validate_date(value, "filters value")
        else:
            _validate_sql_input(value, "filters value", pattern=r"^[A-Za-z0-9_\-. :]+$")
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"Unsupported filter value type: {type(value)!r}")


def _fetch_csv_dataframe(sql: str) -> pl.DataFrame | None:
    """Generic (schema-agnostic) read from the lake through DuckDB.

    DuckDB hands Polars an Arrow table, so there is no CSV encode/parse in the
    middle and no type inference to get wrong on a table that is not
    OHLCV-shaped - which is why this exists separately from the OHLCV path in
    `data.py`.
    """
    from ml.shared.data import _serving

    try:
        return _serving().execute(sql).pl()
    except Exception as exc:
        emit_log(f"[dataset] lake query failed: {exc}", level="warning")
        return None


# ── parquet ─────────────────────────────────────────────────────────────


def _load_parquet(source: DataSource) -> dict:
    if not source.path:
        raise ValueError("parquet source requires 'path'")
    path = Path(source.path)
    if not path.exists():
        raise FileNotFoundError(f"parquet source not found: {path}")

    df = pl.read_parquet(path)
    if df.height == 0:
        raise ValueError(f"parquet source '{path}' has zero rows")

    time_column = _infer_time_column(df)
    if time_column is not None:
        index = _column_to_index(df[time_column])
        rest_columns = [c for c in df.columns if c != time_column]
    else:
        index = np.arange(df.height, dtype=np.int64)
        rest_columns = list(df.columns)

    columns = {name: _series_to_array(df[name]) for name in rest_columns}
    identity = _build_identity(f"parquet:{path}", index, columns)
    return {
        "columns": columns,
        "index": index,
        "provided_columns": list(columns.keys()),
        "identity": identity,
    }


def _infer_time_column(df: pl.DataFrame) -> str | None:
    for candidate in ("timestamp", "ts", "time", "datetime", "date"):
        if candidate in df.columns:
            return candidate
    for name, dtype in zip(df.columns, df.dtypes):
        if dtype == pl.Datetime:
            return name
    return None


# ── Column / index conversion helpers ──────────────────────────────────────


def _timestamps_to_index(timestamps: Any) -> np.ndarray:
    """Convert `load_ohlcv_arrays`'s `timestamp` (list[datetime]) to datetime64[us]."""
    if isinstance(timestamps, np.ndarray) and timestamps.dtype.kind == "M":
        return timestamps.astype("datetime64[us]")
    return np.array(timestamps, dtype="datetime64[us]")


def _column_to_index(series: pl.Series) -> np.ndarray:
    """Convert a Polars column to the dataset's time index (datetime64[us]),
    falling back to the raw values (row ordinal / numeric) if it isn't a
    recognizable timestamp."""
    if series.dtype == pl.Datetime:
        return series.dt.replace_time_zone(None).to_numpy().astype("datetime64[us]")
    if series.dtype == pl.Utf8:
        try:
            parsed = series.str.strptime(pl.Datetime, strict=False)
            if parsed.null_count() == 0:
                return parsed.to_numpy().astype("datetime64[us]")
        except Exception:
            pass
    return series.to_numpy()


_NUMERIC_POLARS_DTYPES = (
    pl.Float64, pl.Float32,
    pl.Int64, pl.Int32, pl.Int16, pl.Int8,
    pl.UInt64, pl.UInt32, pl.UInt16, pl.UInt8,
)


def _series_to_array(series: pl.Series) -> np.ndarray:
    """Numeric columns -> float64 ndarray. Everything else (symbol/string/bool)
    -> an object ndarray of Python values, so no data is dropped, but only
    numeric columns are ever offered as feature material (see
    `raw_columns_matrix`)."""
    if series.dtype in _NUMERIC_POLARS_DTYPES:
        return series.to_numpy().astype(np.float64)
    if series.dtype == pl.Boolean:
        return series.to_numpy().astype(np.float64)
    return np.array(series.to_list(), dtype=object)


# ── Identity / content hash ────────────────────────────────────────────────


def _build_identity(query_template: str, index: np.ndarray, columns: dict[str, np.ndarray]) -> dict:
    row_count = int(index.shape[0])
    return {
        "query_template": query_template,
        "content_hash": _content_hash(index, columns),
        "row_count": row_count,
        "first_ts": _index_value_to_str(index[0]) if row_count else None,
        "last_ts": _index_value_to_str(index[-1]) if row_count else None,
    }


def _index_value_to_str(value: Any) -> str:
    if isinstance(value, np.datetime64):
        return str(np.datetime_as_string(value, unit="us")) + "Z"
    return str(value)


def _content_hash(index: np.ndarray, columns: dict[str, np.ndarray]) -> str:
    """sha256 over the materialized dataset — this IS the data-snapshot
    identity used for run provenance. It is computed from the rows actually
    returned, so it identifies the data the same way for a lake table, a
    resampled view and a local parquet file alike.

    Fixed, documented order: the index first (key ``"__index__"``), then
    every entry in ``columns`` sorted alphabetically by name. Within each
    entry the hash covers: name, dtype string, shape, then the raw bytes
    (datetime64 columns are normalized to int64 microseconds; numeric
    columns are byte-order-normalized to little-endian so the hash is
    reproducible across machines; anything else is hashed element-wise via
    its string representation).
    """
    h = hashlib.sha256()
    ordered: list[tuple[str, np.ndarray]] = [("__index__", index)]
    ordered.extend((name, columns[name]) for name in sorted(columns))

    for name, arr in ordered:
        arr = np.asarray(arr)
        h.update(name.encode("utf-8"))
        h.update(b"\x00")
        h.update(str(arr.dtype).encode("utf-8"))
        h.update(b"\x00")
        h.update(np.asarray(arr.shape, dtype=np.int64).tobytes())

        if arr.dtype.kind == "M":
            h.update(arr.astype("datetime64[us]").astype(np.int64).tobytes())
        elif arr.dtype.kind in ("i", "u", "f"):
            normalized = arr.astype(arr.dtype.newbyteorder("<"))
            h.update(np.ascontiguousarray(normalized).tobytes())
        else:
            for v in arr.tolist():
                h.update(str(v).encode("utf-8"))
                h.update(b"\x00")

    return h.hexdigest()


# ── Feature offering ────────────────────────────────────────────────────────


def offerable_features(
    provided_columns: list[str] | set[str], feature_defs: list[dict] | None = None
) -> list[dict]:
    """Features from ``config/features.json`` offerable given ``provided_columns``.

    Mechanical rule, no per-dataset special-casing: a feature is offerable
    iff its existing ``requires[]`` is a subset of ``provided_columns``.
    """
    if feature_defs is None:
        from .features import _load_feature_config  # local import: avoids

        # pulling numba/joblib (features.py's compute deps) onto every
        # dataset.py import path — only needed when the caller doesn't
        # already have the registry loaded.
        feature_defs = _load_feature_config()["features"]
    provided = set(provided_columns)
    return [f for f in feature_defs if set(f.get("requires", [])) <= provided]


def raw_columns_matrix(dataset: dict) -> tuple[np.ndarray, list[str]]:
    """Fallback feature pipeline for a dataset where no built-in feature
    qualifies (`offerable_features` returns empty): pass the dataset's own
    numeric columns through as the feature matrix, sorted by name for a
    stable, reproducible column order.

    Returns (matrix, names) — matrix has shape (n_rows, len(names)).
    """
    columns = dataset["columns"]
    names = sorted(n for n, arr in columns.items() if np.asarray(arr).dtype.kind in ("i", "u", "f"))
    if not names:
        raise ValueError(
            "raw_columns_matrix: dataset has no numeric columns to use as features "
            f"(provided_columns={dataset.get('provided_columns')!r})"
        )
    matrix = np.column_stack([np.asarray(columns[n], dtype=np.float64) for n in names])
    return matrix, names
