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
# Table allowlist
# ---------------------------------------------------------------------------

# The allowlist is READ FROM THE LAKE, not hardcoded.
#
# It used to be three hand-maintained sets naming QuestDB's tables and
# materialized views. QuestDB was retired on 2026-09-10 and the serving layer
# moved to DuckDB over Iceberg, so the list went stale: it rejected 12 of the
# lake's 42 objects, `bars` — the system of record — among them, and every
# forex view. A list of what exists cannot be maintained by hand next to the
# thing that actually has the list.
#
# The injection guard is `_TABLE_NAME_RE` below, which is what actually keeps a
# name safe to interpolate. Membership answers a different question: does this
# object exist? The lake answers that itself.

_object_names: set[str] | None = None


def _load_object_names() -> set[str]:
    """Every object the serving connection exposes, read once and cached."""
    from . import questdb_conn

    rows = questdb_conn.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    )
    return {str(row["table_name"]) for row in rows}


def get_table_allowlist(refresh: bool = False) -> set[str]:
    """The set of readable objects. Pass refresh=True after the lake gains one."""
    global _object_names
    if _object_names is None or refresh:
        _object_names = _load_object_names()
    return _object_names


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
    """Validate the name's format, then confirm the lake actually has that object."""
    safe = validate_table_name(name)
    allowlist = get_table_allowlist()
    if safe not in allowlist:
        # One refresh in case the object was created after this process started.
        allowlist = get_table_allowlist(refresh=True)
    if safe not in allowlist:
        raise ValueError(f"No object named {safe!r} in the lake")
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
    "symbols": 50_000,
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
