"""SQL injection protection, table allowlists, and row limit enforcement.

Three-layer defense:
1. Statement-type allowlist (SELECT, SHOW, DESCRIBE, EXPLAIN, PRAGMA)
2. DML/DDL keyword blocklist
3. Connection-level read-only (SQLite ?mode=ro, QuestDB PGWire is query-only)
"""

from __future__ import annotations

import re
from typing import Literal

# ---------------------------------------------------------------------------
# Table allowlists
# ---------------------------------------------------------------------------

# Base tables — unified multi-asset schema
QUESTDB_BASE_TABLES: set[str] = {
    "ohlcv",
    "rollovers",
    "symbols",
    "labels",
    "swing_labels",
    "triple_barrier_labels",
    "indicators_5m",
    "indicators_15m",
    "indicators_30m",
    "indicators_1h",
    "indicators_4h",
    "indicators_1d",
    "indicators_1w",
}

# Materialized views (SAMPLE BY aggregations — unified, one set for all assets)
QUESTDB_MAT_VIEWS: set[str] = {
    "ohlcv_5m", "ohlcv_15m", "ohlcv_30m",
    "ohlcv_1h", "ohlcv_4h", "ohlcv_1d", "ohlcv_1w",
}

# Regular views
QUESTDB_VIEWS: set[str] = {
    "view_current_front_month",
    "view_instrument_inventory",
    "view_latest_rollovers",
    "view_latest_prices",
}

QUESTDB_TABLE_ALLOWLIST: set[str] = QUESTDB_BASE_TABLES | QUESTDB_MAT_VIEWS | QUESTDB_VIEWS

# ---------------------------------------------------------------------------
# Table name validation
# ---------------------------------------------------------------------------

_TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")


def validate_table_name(name: str) -> str:
    """Validate table name format. Raises ValueError on invalid."""
    if not _TABLE_NAME_RE.match(name):
        raise ValueError(f"Invalid table name format: {name!r}")
    return name


def validate_questdb_table(name: str) -> str:
    """Validate table name format AND check against QuestDB allowlist."""
    safe = validate_table_name(name)
    if safe not in QUESTDB_TABLE_ALLOWLIST:
        raise ValueError(f"Table {safe!r} is not in the QuestDB allowlist")
    return safe


def validate_sqlite_table(name: str, allowlist: set[str]) -> str:
    """Validate table name format AND check against dynamic SQLite allowlist."""
    safe = validate_table_name(name)
    if safe not in allowlist:
        raise ValueError(f"Table {safe!r} is not in the SQLite allowlist")
    return safe


# ---------------------------------------------------------------------------
# Read-only SQL validation
# ---------------------------------------------------------------------------

_ALLOWED_PREFIXES = ("SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "PRAGMA")

_BLOCKED_KEYWORDS = re.compile(
    r"\b(DROP|DELETE|TRUNCATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|CREATE|EXEC|"
    r"ATTACH|DETACH|VACUUM|REINDEX)\b",
    re.IGNORECASE,
)

_DANGEROUS_FUNCTIONS = re.compile(
    r"\b(read_csv|read_json|readfile|writefile|load_extension|fts3_tokenizer)\b",
    re.IGNORECASE,
)


def validate_readonly_sql(sql: str) -> tuple[bool, str | None]:
    """Validate that SQL is read-only.

    Returns:
        (True, None) if safe, (False, error_message) if unsafe.
    """
    stripped = sql.strip()
    if not stripped:
        return False, "Empty SQL statement"

    # Must start with an allowed prefix
    upper = stripped.upper()
    if not any(upper.startswith(prefix) for prefix in _ALLOWED_PREFIXES):
        return False, f"Statement must start with one of: {', '.join(_ALLOWED_PREFIXES)}"

    # Block multiple statements (semicolons within body)
    # Allow trailing semicolon but nothing after it
    body = stripped.rstrip(";")
    if ";" in body:
        return False, "Multiple SQL statements are not allowed"

    # Block DML/DDL keywords
    match = _BLOCKED_KEYWORDS.search(body)
    if match:
        return False, f"Blocked keyword: {match.group(0).upper()}"

    # Block dangerous functions
    match = _DANGEROUS_FUNCTIONS.search(body)
    if match:
        return False, f"Blocked function: {match.group(0)}"

    return True, None


# ---------------------------------------------------------------------------
# Row limits
# ---------------------------------------------------------------------------

QUESTDB_ROW_LIMITS: dict[str, int] = {
    "ohlcv": 50_000,
    "rollovers": 50_000,
    "symbols": 50_000,
    "labels": 50_000,
    "swing_labels": 50_000,
    "triple_barrier_labels": 50_000,
    "indicators_5m": 50_000,
    "indicators_15m": 50_000,
    "indicators_30m": 50_000,
    "indicators_1h": 50_000,
    "indicators_4h": 50_000,
    "indicators_1d": 50_000,
    "indicators_1w": 50_000,
}

QUESTDB_DEFAULT_LIMIT = 100_000
SQLITE_DEFAULT_LIMIT = 50_000

_LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)", re.IGNORECASE)


def get_row_limit(table: str | None, db_type: Literal["questdb", "sqlite"]) -> int:
    """Get the maximum allowed row limit for a table."""
    if db_type == "sqlite":
        return SQLITE_DEFAULT_LIMIT
    if table and table in QUESTDB_ROW_LIMITS:
        return QUESTDB_ROW_LIMITS[table]
    return QUESTDB_DEFAULT_LIMIT


def enforce_row_limit(sql: str, max_rows: int) -> str:
    """Inject or cap a LIMIT clause on a SQL statement.

    If the SQL already has a LIMIT, cap it at max_rows.
    If it doesn't, append LIMIT max_rows.
    """
    stripped = sql.rstrip().rstrip(";")
    match = _LIMIT_RE.search(stripped)

    if match:
        existing_limit = int(match.group(1))
        if existing_limit > max_rows:
            # Replace the existing limit with the cap
            stripped = stripped[: match.start(1)] + str(max_rows) + stripped[match.end(1) :]
        return stripped + ";"
    else:
        return stripped + f" LIMIT {max_rows};"
