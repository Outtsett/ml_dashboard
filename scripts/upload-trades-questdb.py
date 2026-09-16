"""
Upload trade parquet files to QuestDB via /imp endpoint.
Uses DuckDB to convert parquet to CSV (avoids pyarrow timezone issues).
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

import duckdb

QUESTDB_URL = os.environ.get("QUESTDB_HOST", "http://localhost:9000")
TRADES_DIR = r"E:\lake\raw\vendor=databento\dataset=GLBX.MDP3"
TEMP_CSV = os.path.join(os.environ.get("TEMP", "/tmp"), "trades_upload.csv")

# All daily trade parquet files
TRADE_FILES = sorted(
    [
        os.path.join(TRADES_DIR, f)
        for f in os.listdir(TRADES_DIR)
        if f.endswith(".trades.parquet") and "merged" not in f
    ]
)


def questdb_exec(sql):
    url = f"{QUESTDB_URL}/exec?query={urllib.parse.quote(sql)}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def check_table_exists():
    """Verify trades table exists in QuestDB."""
    try:
        result = questdb_exec("SELECT count() as cnt FROM trades")
        count = result["dataset"][0][0]
        print(f"[trades] Current row count: {count:,}")
        return True
    except Exception as e:
        print(f"[trades] Table check failed: {e}")
        return False


def convert_and_upload(parquet_path):
    """Convert parquet to CSV via DuckDB, upload to QuestDB /imp."""
    basename = os.path.basename(parquet_path)
    print(f"\n[{basename}] Converting parquet to CSV...")

    start = time.time()
    con = duckdb.connect()
    con.execute("SET TimeZone = 'UTC'")

    # Read parquet, format timestamps as ISO 8601 with T separator (QuestDB requirement)
    # Cast TIMESTAMPTZ -> TIMESTAMP to strip timezone, then replace space with T
    con.execute(f"""
        COPY (
            SELECT
                replace(CAST(ts_event::TIMESTAMP AS VARCHAR), ' ', 'T') as ts_event,
                rtype::INTEGER as rtype,
                publisher_id::INTEGER as publisher_id,
                instrument_id::BIGINT as instrument_id,
                action,
                side,
                depth::INTEGER as depth,
                price,
                size::BIGINT as size,
                flags::INTEGER as flags,
                ts_in_delta,
                sequence::BIGINT as sequence,
                symbol,
                replace(CAST(ts_recv::TIMESTAMP AS VARCHAR), ' ', 'T') as ts_recv
            FROM read_parquet('{parquet_path.replace(os.sep, "/")}')
        ) TO '{TEMP_CSV.replace(os.sep, "/")}' (HEADER, DELIMITER ',')
    """)
    con.close()

    csv_size = os.path.getsize(TEMP_CSV)
    convert_time = time.time() - start
    print(f"[{basename}] CSV ready: {csv_size / 1024 / 1024:.1f} MB ({convert_time:.1f}s)")

    # Upload via curl
    print(f"[{basename}] Uploading to QuestDB...")
    upload_start = time.time()
    result = subprocess.run(
        [
            "curl",
            "-s",
            "-w",
            "%{http_code}",
            "-F",
            f"data=@{TEMP_CSV}",
            f"{QUESTDB_URL}/imp?name=trades&timestamp=ts_event&partitionBy=DAY",
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    upload_time = time.time() - upload_start

    http_code = result.stdout[-3:] if len(result.stdout) >= 3 else "???"

    if http_code == "200":
        print(f"[{basename}] Uploaded OK ({upload_time:.1f}s)")
    else:
        print(f"[{basename}] Upload FAILED (HTTP {http_code})")
        print(f"  stdout: {result.stdout[:500]}")
        print(f"  stderr: {result.stderr[:500]}")

    # Clean up temp CSV
    try:
        os.remove(TEMP_CSV)
    except:
        pass

    return http_code == "200"


def main():

    print(f"=== Trade Parquet -> QuestDB Upload ===")
    print(f"Found {len(TRADE_FILES)} trade parquet files\n")

    if not check_table_exists():
        print("ERROR: trades table doesn't exist in QuestDB. Create it first.")
        sys.exit(1)

    success = 0
    failed = []

    for i, f in enumerate(TRADE_FILES):
        print(f"\n--- File {i + 1}/{len(TRADE_FILES)} ---")
        if convert_and_upload(f):
            success += 1
        else:
            failed.append(os.path.basename(f))

    # Final verification
    print(f"\n=== Results ===")
    print(f"Success: {success}/{len(TRADE_FILES)}")
    if failed:
        print(f"Failed: {', '.join(failed)}")

    try:
        result = questdb_exec("SELECT count() as cnt FROM trades")
        count = result["dataset"][0][0]
        print(f"\nFinal trades row count: {count:,}")

        result = questdb_exec("SELECT symbol, count() as cnt FROM trades ORDER BY cnt DESC")
        print("\nRows per symbol:")
        for row in result["dataset"]:
            print(f"  {row[0]}: {row[1]:,}")
    except Exception as e:
        print(f"Verification failed: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
