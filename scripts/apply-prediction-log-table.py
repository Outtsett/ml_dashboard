"""Apply prediction_log DDL + 1m rollup mat view to local QuestDB.

Idempotent — every statement is `CREATE ... IF NOT EXISTS`, so re-running is
safe. Connects over PG-wire (port 8812) using psycopg2.

Usage:
    python scripts/apply-prediction-log-table.py            # apply + verify
    python scripts/apply-prediction-log-table.py --dry-run  # print SQL only

The script:
  1. Iterates over scripts/create-prediction-log*.sql in deterministic order
     (table DDL first, then rollup mat view that depends on it).
  2. For each file, asks information_schema whether the target object exists
     BEFORE executing — prints "already exists" or "applied".
  3. After apply, dumps the columns of prediction_log and the list of
     materialized views matching `prediction_log_*`.

Requires QuestDB running locally (electron/start-databases.cjs auto-launches it).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import psycopg2
    from psycopg2 import OperationalError
except ImportError:
    sys.stderr.write(
        "psycopg2 not installed. In the `ml` conda env:\n"
        "    conda activate ml && pip install psycopg2-binary\n"
    )
    sys.exit(1)


ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"

# Apply order matters: the rollup mat view references prediction_log.
SQL_FILES = [
    SCRIPTS / "create-prediction-log-table.sql",
    SCRIPTS / "create-prediction-log-rollup.sql",
]

DSN = "postgresql://admin:quest@127.0.0.1:8812/qdb"


_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
    re.IGNORECASE,
)
_MV_RE = re.compile(
    r"CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
    re.IGNORECASE,
)


def strip_comments(sql: str) -> str:
    """Strip `-- ...` line comments. Keeps quoted strings intact."""
    out_lines: list[str] = []
    for line in sql.splitlines():
        idx = line.find("--")
        if idx >= 0:
            line = line[:idx]
        if line.strip():
            out_lines.append(line)
    return "\n".join(out_lines)


def extract_object(sql: str) -> tuple[str, str]:
    """Return (kind, name) for the CREATE statement.

    kind = 'TABLE' | 'MATERIALIZED VIEW'
    """
    m = _MV_RE.search(sql)
    if m:
        return "MATERIALIZED VIEW", m.group(1)
    m = _TABLE_RE.search(sql)
    if m:
        return "TABLE", m.group(1)
    raise ValueError(f"Could not parse object name from: {sql[:200]!r}")


def object_exists(cur, kind: str, name: str) -> bool:
    """Check QuestDB metadata for an existing object.

    QuestDB exposes both tables and mat views via the `tables()` function;
    mat views are also listed in `materialized_views()`.
    """
    if kind == "MATERIALIZED VIEW":
        cur.execute(
            "SELECT count() FROM materialized_views() WHERE view_name = %s",
            (name,),
        )
    else:
        cur.execute(
            "SELECT count() FROM tables() WHERE table_name = %s",
            (name,),
        )
    (n,) = cur.fetchone()
    return int(n) > 0


def show_columns(cur, table: str) -> list[tuple[str, str]]:
    """Return [(column_name, column_type), ...] for table."""
    cur.execute(f"SHOW COLUMNS FROM {table}")
    rows = cur.fetchall()
    # SHOW COLUMNS columns: column, type, indexed, ... — we want (name, type)
    return [(r[0], r[1]) for r in rows]


def list_mat_views(cur, prefix: str) -> list[str]:
    cur.execute(
        "SELECT view_name FROM materialized_views() "
        "WHERE view_name LIKE %s ORDER BY view_name",
        (f"{prefix}%",),
    )
    return [r[0] for r in cur.fetchall()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print SQL that would be applied, then exit without connecting.",
    )
    args = parser.parse_args()

    files = [(f, f.read_text(encoding="utf-8")) for f in SQL_FILES]
    for f, _ in files:
        if not f.exists():
            print(f"ERROR: missing SQL file: {f}", file=sys.stderr)
            return 2

    if args.dry_run:
        for f, body in files:
            print(f"-- ===== {f.name} =====")
            print(body)
            print()
        return 0

    try:
        conn = psycopg2.connect(DSN)
    except OperationalError as e:
        print(
            "ERROR: cannot connect to QuestDB at 127.0.0.1:8812.\n"
            "  Is the local DB stack running? Launch it with:\n"
            "      node electron/start-databases.cjs\n"
            "  (the Electron app auto-launches it on dev startup.)\n"
            f"  psycopg2 said: {e}",
            file=sys.stderr,
        )
        return 3

    conn.autocommit = True
    rc = 0
    try:
        with conn.cursor() as cur:
            for f, body in files:
                stmt = strip_comments(body).strip().rstrip(";")
                kind, name = extract_object(stmt)
                existed = object_exists(cur, kind, name)
                if existed:
                    print(f"[{f.name}] {kind} {name}: already exists")
                else:
                    cur.execute(stmt)
                    # Confirm
                    if object_exists(cur, kind, name):
                        print(f"[{f.name}] {kind} {name}: applied")
                    else:
                        print(
                            f"[{f.name}] {kind} {name}: WARNING — "
                            "statement executed but object not found",
                            file=sys.stderr,
                        )
                        rc = 4

            # Verify
            print("\n--- prediction_log columns ---")
            cols = show_columns(cur, "prediction_log")
            for name, typ in cols:
                print(f"  {name:<20s} {typ}")

            print("\n--- prediction_log_* materialized views ---")
            mvs = list_mat_views(cur, "prediction_log")
            for mv in mvs:
                print(f"  {mv}")
            if not mvs:
                print("  (none)")

            print("\n--- prediction_log row count ---")
            cur.execute("SELECT count() FROM prediction_log")
            (n,) = cur.fetchone()
            print(f"  count() = {n}")
    finally:
        conn.close()

    return rc


if __name__ == "__main__":
    sys.exit(main())
