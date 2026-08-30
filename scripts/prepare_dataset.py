"""Export a training window from QuestDB and split it 80/20 into parquet.

Runs as a child process of the training job runner, which passes the job id and
the instrument/timeframe the user picked in the UI. Those three values reach a
SQL string and a filesystem path, so each is checked here rather than trusted
from the caller — the router that spawns this validates too, but a script that
is safe only while one caller stays disciplined is not safe.
"""

import argparse
import os
import re
import sys

import duckdb

# An instrument or timeframe becomes part of a QuestDB table name that is
# interpolated into SQL, so it is restricted to what a table name may contain.
IDENTIFIER_RE = re.compile(r"[A-Za-z0-9_]{1,64}")

# A job id becomes a directory name under the run root.
JOB_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,128}")

# QuestDB's Postgres wire endpoint. Credentials come from the environment so
# they are set per deployment rather than written into the repository; the
# fallbacks are QuestDB's documented defaults for a local unauthenticated
# instance, which is what this development stack runs.
QUESTDB_PG_HOST = os.environ.get("QUESTDB_PG_HOST", "127.0.0.1")
QUESTDB_PG_PORT = os.environ.get("QUESTDB_PG_PORT", "8812")
QUESTDB_PG_USER = os.environ.get("QUESTDB_PG_USER", "admin")
QUESTDB_PG_PASSWORD = os.environ.get("QUESTDB_PG_PASSWORD", "quest")
QUESTDB_PG_DATABASE = os.environ.get("QUESTDB_PG_DATABASE", "qdb")

RUN_ROOT = os.environ.get("ML_DATA_ROOT", "D:/ml_data/runs")

# A DuckDB ATTACH string is one single-quoted, space-separated literal, so a
# quote, a backslash, a space or a line break in any field would end it early.
FORBIDDEN_CONNECTION_CHARS = tuple(chr(c) for c in (39, 92, 32, 10, 13))


def checked(pattern: re.Pattern, value: str, label: str) -> str:
    """Return `value` when it matches `pattern` end to end, else exit non-zero."""
    if not pattern.fullmatch(value) or value in (".", ".."):
        print(f"[prepare_dataset] Invalid {label}: {value!r}", file=sys.stderr)
        sys.exit(2)
    return value


def connection_field(value: str, label: str) -> str:
    """A DuckDB ATTACH string is space-separated and single-quoted as a whole.

    A quote or backslash in a field would end that literal early, so those are
    refused rather than escaped — no legitimate host, user or database name
    needs them.
    """
    if not value or any(c in value for c in FORBIDDEN_CONNECTION_CHARS):
        print(f"[prepare_dataset] Invalid {label} in QuestDB connection settings", file=sys.stderr)
        sys.exit(2)
    return value


def run_dir(job_id: str) -> str:
    """Resolve this job's output directory and refuse anything outside RUN_ROOT.

    `job_id` is already restricted to a plain identifier, so this is the second
    of two checks: it also catches a symlinked root and any future caller that
    reaches this function without going through the regex.
    """
    root = os.path.abspath(RUN_ROOT)
    resolved = os.path.abspath(os.path.join(root, job_id))
    if resolved != root and not resolved.startswith(root + os.sep):
        print(f"[prepare_dataset] Job id escapes the run root: {job_id!r}", file=sys.stderr)
        sys.exit(2)
    return resolved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--data-size", required=True, type=int)
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()

    instrument = checked(IDENTIFIER_RE, args.instrument, "instrument")
    timeframe = checked(IDENTIFIER_RE, args.timeframe, "timeframe")
    job_id = checked(JOB_ID_RE, args.job_id, "job id")

    attach = (
        f"host={connection_field(QUESTDB_PG_HOST, 'host')} "
        f"port={connection_field(QUESTDB_PG_PORT, 'port')} "
        f"user={connection_field(QUESTDB_PG_USER, 'user')} "
        f"password={connection_field(QUESTDB_PG_PASSWORD, 'password')} "
        f"dbname={connection_field(QUESTDB_PG_DATABASE, 'database')}"
    )

    # The auto-activation mandate: "Always aim for institutional-grade processing speed... zero-copy"
    con = duckdb.connect()
    con.execute("INSTALL postgres; LOAD postgres;")
    con.execute(f"ATTACH '{attach}' AS qdb (TYPE POSTGRES);")

    out_dir = run_dir(job_id)
    os.makedirs(out_dir, exist_ok=True)

    train_path = f"{out_dir}/train.parquet"
    test_path = f"{out_dir}/test.parquet"

    table_name = f"{instrument}_ohlcv_{timeframe}"
    # data_size is parsed by argparse as an int, so it cannot carry SQL.
    limit_clause = f"LIMIT {args.data_size}" if args.data_size > 0 else ""

    # First, dump all to a temporary parquet to avoid multiple heavy queries to QuestDB
    temp_path = f"{out_dir}/temp_full.parquet"
    print(f"Exporting data from QuestDB to {temp_path}...")
    con.execute(f"COPY (SELECT * FROM qdb.{table_name} ORDER BY timestamp ASC {limit_clause}) TO '{temp_path}' (FORMAT PARQUET);")

    # Get count from parquet
    count = con.execute(f"SELECT COUNT(*) FROM '{temp_path}'").fetchone()[0]
    split_idx = int(count * 0.8)

    print(f"Total rows: {count}. Splitting at {split_idx}...")

    con.execute(f"COPY (SELECT * FROM '{temp_path}' ORDER BY timestamp ASC LIMIT {split_idx}) TO '{train_path}' (FORMAT PARQUET);")
    con.execute(f"COPY (SELECT * FROM '{temp_path}' ORDER BY timestamp ASC OFFSET {split_idx}) TO '{test_path}' (FORMAT PARQUET);")

    # Cleanup temp
    os.remove(temp_path)

    print(f"DATASET_READY:{train_path},{test_path}")


if __name__ == "__main__":
    main()
