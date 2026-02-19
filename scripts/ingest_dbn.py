"""
Ingest Databento DBN OHLCV-1s data into PostgreSQL TimescaleDB hypertable.

Reads the compressed .dbn.zst file, maps instrument IDs to contract names
using the symbology file, and streams batches into the ohlcv_1s hypertable
via COPY for maximum throughput.

Usage:
    python scripts/ingest_dbn.py [--batch-size 50000] [--dry-run]
"""

import argparse
import io
import json
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import databento as db
import psycopg2
from psycopg2 import sql as pgsql

# ── Paths ──────────────────────────────────────────────────────────────
DATA_DIR = Path(r"C:\Users\tyler\Downloads\GLBX-20260110-UCKUBNMN7Y\GLBX-20251231-4HHC9WJQBX")
DBN_FILE = DATA_DIR / "glbx-mdp3-20100606-20251230.ohlcv-1s.dbn.zst"
SYMBOLOGY_FILE = DATA_DIR / "symbology.json"

DB_CONN = "postgresql://postgres:postgres@localhost:5432/ml_dashboard"

# Futures month codes → month number
MONTH_CODES = {
    'F': 1, 'G': 2, 'H': 3, 'J': 4, 'K': 5, 'M': 6,
    'N': 7, 'Q': 8, 'U': 9, 'V': 10, 'X': 11, 'Z': 12
}

# Regex for outright futures contracts: ESH24, MNQZ5, M2KU25, etc.
CONTRACT_RE = re.compile(r'^([A-Z][A-Z0-9]{1,3})([FGHJKMNQUVXZ])(\d{1,2})$')


def build_symbology_map(symbology_path: Path) -> dict:
    """
    Build a lookup: instrument_id → list of (start_date, end_date, contract, base_symbol).

    The symbology.json has structure:
      { "result": { "ESH24": [{"d0": "2023-01-01", "d1": "2024-03-15", "s": "12345"}] } }

    Where "s" is the instrument_id string.
    """
    with open(symbology_path) as f:
        data = json.load(f)

    # instrument_id → [(start_date_str, end_date_str, contract, base_symbol)]
    id_map = defaultdict(list)

    result = data.get("result", {})
    for contract_name, date_ranges in result.items():
        match = CONTRACT_RE.match(contract_name)
        if not match:
            continue  # Skip spreads and non-standard symbols

        base_symbol = match.group(1)

        for dr in date_ranges:
            instrument_id = int(dr["s"])
            id_map[instrument_id].append((
                dr["d0"],
                dr["d1"],
                contract_name,
                base_symbol,
            ))

    # Sort each instrument's ranges by start date
    for iid in id_map:
        id_map[iid].sort(key=lambda x: x[0])

    # Count unique contracts
    contracts = set()
    for ranges in id_map.values():
        for _, _, c, _ in ranges:
            contracts.add(c)

    print(f"Symbology: {len(id_map)} instrument IDs -> {len(contracts)} outright contracts")
    return dict(id_map)


def resolve_contract(instrument_id: int, date_str: str, id_map: dict) -> tuple:
    """Resolve instrument_id + date → (contract_name, base_symbol) or (None, None)."""
    ranges = id_map.get(instrument_id)
    if not ranges:
        return None, None

    for d0, d1, contract, base in ranges:
        if d0 <= date_str <= d1:
            return contract, base

    return None, None


def ns_to_datetime(ts_ns: int) -> datetime:
    """Convert nanosecond Unix timestamp to datetime."""
    return datetime.fromtimestamp(ts_ns / 1_000_000_000, tz=timezone.utc)


def ns_to_date_str(ts_ns: int) -> str:
    """Convert nanosecond Unix timestamp to YYYY-MM-DD string."""
    return datetime.fromtimestamp(ts_ns / 1_000_000_000, tz=timezone.utc).strftime('%Y-%m-%d')


def format_price(raw: int) -> float:
    """Databento prices are in fixed-point with 1e-9 scale factor."""
    return raw / 1_000_000_000


def ingest(batch_size: int = 50_000, dry_run: bool = False):
    print(f"Loading symbology from {SYMBOLOGY_FILE}")
    id_map = build_symbology_map(SYMBOLOGY_FILE)

    print(f"Opening DBN file: {DBN_FILE}")
    print(f"  File size: {DBN_FILE.stat().st_size / 1e9:.2f} GB")

    store = db.DBNStore.from_file(str(DBN_FILE))
    print(f"  Schema: {store.schema}")
    print(f"  Dataset: {store.dataset}")
    print(f"  Range: {store.start} -> {store.end}")

    if dry_run:
        print("\n=== DRY RUN: Sampling first 100 records ===")
        count = 0
        for rec in store:
            contract, base = resolve_contract(
                rec.instrument_id,
                ns_to_date_str(rec.ts_event),
                id_map,
            )
            if contract:
                ts = ns_to_datetime(rec.ts_event)
                print(f"  {ts} | {contract} ({base}) | "
                      f"O={format_price(rec.open):.2f} H={format_price(rec.high):.2f} "
                      f"L={format_price(rec.low):.2f} C={format_price(rec.close):.2f} V={rec.volume}")
                count += 1
            if count >= 100:
                break
        return

    # Connect to PostgreSQL
    conn = psycopg2.connect(DB_CONN)
    conn.autocommit = False
    cur = conn.cursor()

    # Check current row count
    cur.execute("SELECT count(*) FROM ohlcv_1s")
    existing = cur.fetchone()[0]
    print(f"  Existing rows in ohlcv_1s: {existing:,}")

    # Streaming ingestion with COPY
    batch = []
    total_inserted = 0
    total_skipped = 0
    stats = defaultdict(int)
    t_start = time.time()
    t_last = t_start

    print(f"\n=== Starting ingestion (batch_size={batch_size:,}) ===")

    for rec in store:
        date_str = ns_to_date_str(rec.ts_event)
        contract, base = resolve_contract(rec.instrument_id, date_str, id_map)

        if not contract:
            total_skipped += 1
            continue

        ts = ns_to_datetime(rec.ts_event)

        batch.append((
            ts.isoformat(),
            contract,
            base,
            format_price(rec.open),
            format_price(rec.high),
            format_price(rec.low),
            format_price(rec.close),
            rec.volume,
        ))
        stats[base] += 1

        if len(batch) >= batch_size:
            _copy_batch(cur, batch)
            conn.commit()
            total_inserted += len(batch)
            batch.clear()

            now = time.time()
            elapsed = now - t_start
            rate = total_inserted / elapsed if elapsed > 0 else 0

            if now - t_last > 5:  # Progress every 5 seconds
                print(f"  {total_inserted:>12,} rows | {rate:>10,.0f} rows/s | "
                      f"skipped: {total_skipped:,} | elapsed: {elapsed:.0f}s")
                t_last = now

    # Final batch
    if batch:
        _copy_batch(cur, batch)
        conn.commit()
        total_inserted += len(batch)

    elapsed = time.time() - t_start
    rate = total_inserted / elapsed if elapsed > 0 else 0

    print(f"\n=== Ingestion Complete ===")
    print(f"  Total inserted: {total_inserted:,}")
    print(f"  Total skipped:  {total_skipped:,}")
    print(f"  Time: {elapsed:.1f}s ({rate:,.0f} rows/s)")
    print(f"\n  Per base symbol:")
    for base, count in sorted(stats.items()):
        print(f"    {base}: {count:,}")

    # Refresh the daily volume materialized view
    print(f"\n  Refreshing daily_contract_volume materialized view...")
    cur.execute("REFRESH MATERIALIZED VIEW daily_contract_volume")
    conn.commit()
    print("  Done.")

    cur.close()
    conn.close()


def _copy_batch(cur, batch: list):
    """Use COPY for fast bulk insert."""
    buf = io.StringIO()
    for row in batch:
        # ts, symbol, base_symbol, open, high, low, close, volume
        buf.write('\t'.join(str(v) for v in row))
        buf.write('\n')
    buf.seek(0)
    cur.copy_from(
        buf,
        'ohlcv_1s',
        columns=('ts', 'symbol', 'base_symbol', 'open', 'high', 'low', 'close', 'volume'),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest Databento DBN → TimescaleDB")
    parser.add_argument("--batch-size", type=int, default=50_000,
                        help="Rows per COPY batch (default: 50000)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print first 100 resolved records without inserting")
    args = parser.parse_args()

    ingest(batch_size=args.batch_size, dry_run=args.dry_run)
