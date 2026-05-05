"""
QuestDB Schema Migration: Unified Multi-Asset Architecture
==========================================================
In-place migration using ALTER TABLE ADD COLUMN + UPDATE (no data copy).

ALTER TABLE ADD COLUMN is instant (metadata-only, no rewrite).
UPDATE only rewrites the 2 new SYMBOL column files per partition (copy-on-write),
not all 9 columns. This is orders of magnitude faster than INSERT AS SELECT.

Usage:
    python scripts/migrate-questdb-schema.py [--phase PHASE] [--dry-run]

Phases:
    1  Discover symbols, classify, show plan (read-only)
    2  ALTER TABLE ADD COLUMN (instant) + UPDATE to backfill asset_class/root
    3  Drop old materialized views, create new ones
    4  Drop old views, create new regular views
    5  Alter label/indicator tables (add asset_class/root)
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from typing import Optional

QUESTDB_HTTP = "http://localhost:9000"

# ---------------------------------------------------------------------------
# Symbol classification
# ---------------------------------------------------------------------------

MONTH_CODES = set("FGHJKMNQUVXZ")
CONTRACT_RE = re.compile(r"^([A-Z][A-Z0-9]*)[FGHJKMNQUVXZ]\d{1,2}$")
SPREAD_RE = re.compile(
    r"^([A-Z][A-Z0-9]*[FGHJKMNQUVXZ]\d{1,2})-([A-Z][A-Z0-9]*[FGHJKMNQUVXZ]\d{1,2})$"
)
FOREX_RE = re.compile(r"^[A-Z]{6}$")

KNOWN_FOREX = {
    "EURUSD", "GBPUSD", "USDJPY", "USDCAD", "USDCHF", "AUDUSD", "NZDUSD",
    "EURGBP", "EURJPY", "EURCHF", "GBPAUD", "GBPJPY", "GBPCHF", "AUDJPY",
    "CADJPY", "CHFJPY", "NZDJPY", "EURAUD",
}

KNOWN_ROOTS = {"ES", "NQ", "MNQ", "MES", "YM", "MYM", "RTY", "M2K"}


def classify_symbol(sym: str) -> tuple[str, str]:
    """Returns (asset_class, root) for a symbol."""
    if sym in KNOWN_FOREX or (FOREX_RE.match(sym) and not any(c.isdigit() for c in sym)):
        return "forex", sym

    spread_match = SPREAD_RE.match(sym)
    if spread_match:
        leg1 = spread_match.group(1)
        root_match = CONTRACT_RE.match(leg1)
        if root_match:
            return "futures", root_match.group(1)
        return "futures", sym

    contract_match = CONTRACT_RE.match(sym)
    if contract_match:
        return "futures", contract_match.group(1)

    if sym in KNOWN_ROOTS:
        return "futures", sym

    return "unknown", sym


# ---------------------------------------------------------------------------
# QuestDB HTTP helpers
# ---------------------------------------------------------------------------


def query(sql: str, timeout: int = 600) -> dict:
    """Execute SQL via QuestDB HTTP API, return parsed JSON response."""
    url = f"{QUESTDB_HTTP}/exec?query={urllib.parse.quote(sql)}&count=true"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        print(f"  SQL: {sql[:200]}", file=sys.stderr)
        raise


def exec_ddl(sql: str, label: str = "") -> bool:
    """Execute DDL statement, return success."""
    tag = f" [{label}]" if label else ""
    try:
        query(sql, timeout=600)
        print(f"  OK{tag}")
        return True
    except Exception as e:
        print(f"  FAILED{tag}: {e}", file=sys.stderr)
        return False


def get_scalar(sql: str) -> Optional[int]:
    """Execute SQL returning a single scalar value."""
    try:
        result = query(sql)
        if result.get("dataset") and result["dataset"][0]:
            return result["dataset"][0][0]
    except Exception:
        pass
    return None


def get_rows(sql: str) -> list:
    """Execute SQL returning list of row tuples."""
    result = query(sql, timeout=600)
    return result.get("dataset", [])


# ---------------------------------------------------------------------------
# Phase 1: Discover and classify symbols
# ---------------------------------------------------------------------------


def phase1_discover():
    print("=" * 60)
    print("PHASE 1: Discover symbols and classify")
    print("=" * 60)

    print("\nQuerying distinct symbols from ohlcv_1d...")
    rows = get_rows("SELECT DISTINCT symbol FROM ohlcv_1d ORDER BY symbol")
    symbols = [r[0] for r in rows]
    print(f"  Found {len(symbols)} distinct symbols")

    # Classify each symbol
    root_groups = defaultdict(list)  # root -> [(symbol, asset_class)]
    asset_classes = defaultdict(list)
    unknowns = []

    for sym in symbols:
        ac, root = classify_symbol(sym)
        if ac == "unknown":
            unknowns.append(sym)
        else:
            root_groups[root].append((sym, ac))
            asset_classes[ac].append(sym)

    print(f"\n--- Classification ---")
    print(f"  Futures symbols: {len(asset_classes['futures'])}")
    print(f"  Forex symbols:   {len(asset_classes['forex'])}")
    if unknowns:
        print(f"  Unknown symbols: {len(unknowns)}")
        for u in unknowns:
            print(f"    {u}")

    print(f"\n--- Futures roots ({len([r for r in root_groups if any(ac == 'futures' for _, ac in root_groups[r])])}) ---")
    for root in sorted(root_groups.keys()):
        futures_syms = [s for s, ac in root_groups[root] if ac == "futures"]
        if futures_syms:
            contracts = [s for s in futures_syms if "-" not in s and s != root]
            spreads = [s for s in futures_syms if "-" in s]
            bare = [s for s in futures_syms if s == root]
            parts = []
            if contracts:
                parts.append(f"{len(contracts)} contracts")
            if spreads:
                parts.append(f"{len(spreads)} spreads")
            if bare:
                parts.append("1 bare root")
            print(f"  {root}: {', '.join(parts)}")

    print(f"\n--- Forex pairs ({len(asset_classes['forex'])}) ---")
    print(f"  {', '.join(sorted(asset_classes['forex']))}")

    print(f"\n--- Current row counts ---")
    ohlcv_count = get_scalar("SELECT count() FROM ohlcv")
    forex_count = get_scalar("SELECT count() FROM ohlcv_forex")
    print(f"  ohlcv:       {ohlcv_count:>15,}")
    print(f"  ohlcv_forex: {forex_count:>15,}")

    return root_groups, asset_classes, unknowns


# ---------------------------------------------------------------------------
# Phase 2: In-place ALTER TABLE + UPDATE
# ---------------------------------------------------------------------------


def phase2_alter_and_update(root_groups: dict, dry_run: bool = False):
    print("\n" + "=" * 60)
    print("PHASE 2: ALTER TABLE ADD COLUMN + UPDATE (in-place)")
    print("=" * 60)

    # Step 1: Add columns (instant, metadata-only)
    print("\n  Step 1: Adding columns to ohlcv table (instant)...")

    columns_to_add = [
        ("asset_class", "SYMBOL CAPACITY 10 CACHE INDEX"),
        ("root", "SYMBOL CAPACITY 50 CACHE INDEX"),
    ]

    for col_name, col_type in columns_to_add:
        if dry_run:
            print(f"    [DRY RUN] ALTER TABLE ohlcv ADD COLUMN {col_name} {col_type}")
        else:
            # Use separate statements (avoid IF NOT EXISTS WAL bug #5369)
            sql = f"ALTER TABLE ohlcv ADD COLUMN {col_name} {col_type}"
            try:
                exec_ddl(sql, f"ADD {col_name}")
            except Exception:
                # Column may already exist
                print(f"    Column {col_name} may already exist, continuing...")

    # Step 2: Backfill via UPDATE, batched by root
    print("\n  Step 2: Backfilling asset_class and root via UPDATE...")
    print("  (UPDATE only rewrites the 2 new column files per partition, not all data)")

    total_updated = 0

    for root in sorted(root_groups.keys()):
        syms_and_classes = root_groups[root]
        ac = syms_and_classes[0][1]  # All syms in a root share asset_class
        sym_list = [s for s, _ in syms_and_classes]

        if dry_run:
            print(f"    [DRY RUN] UPDATE {ac}/{root}: {len(sym_list)} symbols")
            continue

        # Build IN clause for all symbols in this root
        in_values = ", ".join(f"'{s}'" for s in sym_list)

        # For forex, root = symbol (each forex pair is its own root)
        if ac == "forex" and len(sym_list) == 1:
            update_sql = (
                f"UPDATE ohlcv SET asset_class = '{ac}', root = symbol "
                f"WHERE symbol = '{sym_list[0]}' AND asset_class IS NULL"
            )
        else:
            update_sql = (
                f"UPDATE ohlcv SET asset_class = '{ac}', root = '{root}' "
                f"WHERE symbol IN ({in_values}) AND asset_class IS NULL"
            )

        print(f"\n    Updating {ac}/{root} ({len(sym_list)} symbols)...")
        t0 = time.time()
        try:
            query(update_sql, timeout=600)
            elapsed = time.time() - t0
            total_updated += len(sym_list)
            print(f"      Done in {elapsed:.1f}s")
        except Exception as e:
            print(f"      FAILED: {e}", file=sys.stderr)

    # Step 3: Verify
    if not dry_run:
        print("\n  Step 3: Verification...")
        rows = get_rows(
            "SELECT asset_class, count() as cnt FROM ohlcv GROUP BY asset_class ORDER BY asset_class"
        )
        print("  Asset class distribution:")
        for r in rows:
            label = r[0] if r[0] else "NULL (unclassified)"
            print(f"    {label}: {r[1]:,}")

        rows = get_rows(
            "SELECT root, count() as cnt FROM ohlcv GROUP BY root ORDER BY cnt DESC LIMIT 10"
        )
        print("\n  Top roots by row count:")
        for r in rows:
            label = r[0] if r[0] else "NULL"
            print(f"    {label}: {r[1]:,}")

    return total_updated


# ---------------------------------------------------------------------------
# Phase 3: Drop old mat views, create new ones
# ---------------------------------------------------------------------------

OLD_MAT_VIEWS = [
    "ohlcv_1m",
    "ohlcv_5m", "ohlcv_15m", "ohlcv_30m", "ohlcv_1h", "ohlcv_4h", "ohlcv_1d", "ohlcv_1w",
    "ohlcv_forex_5m", "ohlcv_forex_15m", "ohlcv_forex_30m",
    "ohlcv_forex_1h", "ohlcv_forex_4h", "ohlcv_forex_1d", "ohlcv_forex_1w",
    "futures_ohlcv_5m", "futures_ohlcv_15m", "futures_ohlcv_30m",
    "futures_ohlcv_1h", "futures_ohlcv_4h", "futures_ohlcv_1d", "futures_ohlcv_1w",
]

NEW_MAT_VIEWS = [
    ("ohlcv_5m",  "5m",  "MONTH", "2 YEARS"),
    ("ohlcv_15m", "15m", "MONTH", "2 YEARS"),
    ("ohlcv_30m", "30m", "MONTH", "3 YEARS"),
    ("ohlcv_1h",  "1h",  "MONTH", "3 YEARS"),
    ("ohlcv_4h",  "4h",  "YEAR",  "5 YEARS"),
    ("ohlcv_1d",  "1d",  "YEAR",  "10 YEARS"),
    ("ohlcv_1w",  "1w",  "YEAR",  "10 YEARS"),
]


def phase3_mat_views(dry_run: bool = False):
    print("\n" + "=" * 60)
    print("PHASE 3: Drop old materialized views, create new ones")
    print("=" * 60)

    print("\n  Dropping old materialized views...")
    for v in OLD_MAT_VIEWS:
        if dry_run:
            print(f"    [DRY RUN] DROP MATERIALIZED VIEW IF EXISTS {v}")
        else:
            exec_ddl(f"DROP MATERIALIZED VIEW IF EXISTS {v}", f"DROP {v}")

    print("\n  Creating new materialized views...")
    for name, interval, partition, ttl in NEW_MAT_VIEWS:
        ddl = f"""
        CREATE MATERIALIZED VIEW {name} AS (
          SELECT timestamp, symbol, asset_class, root,
            first(open) as open,
            max(high) as high,
            min(low) as low,
            last(close) as close,
            sum(volume) as volume
          FROM ohlcv
          SAMPLE BY {interval} ALIGN TO CALENDAR
        ) PARTITION BY {partition} TTL {ttl}
        """

        if dry_run:
            print(f"    [DRY RUN] CREATE MATERIALIZED VIEW {name} (SAMPLE BY {interval})")
        else:
            print(f"\n    Creating {name} (SAMPLE BY {interval})...")
            t0 = time.time()
            exec_ddl(ddl, f"CREATE {name}")
            elapsed = time.time() - t0
            print(f"    Backfill completed in {elapsed:.1f}s")

    if not dry_run:
        print("\n  Verifying materialized views...")
        rows = get_rows("SELECT view_name, view_status FROM materialized_views() ORDER BY view_name")
        for r in rows:
            status = "OK" if r[1] == "active" else r[1]
            print(f"    {r[0]}: {status}")


# ---------------------------------------------------------------------------
# Phase 4: Create regular views
# ---------------------------------------------------------------------------


def phase4_views(dry_run: bool = False):
    print("\n" + "=" * 60)
    print("PHASE 4: Drop old views, create new regular views")
    print("=" * 60)

    old_views = [
        "view_futures_panama_adj",
        "view_current_front_month",
        "view_futures_inventory",
        "view_forex_inventory",
        "view_futures_latest_rollovers",
        "view_futures_active_contracts",
    ]

    print("\n  Dropping old views...")
    for v in old_views:
        if dry_run:
            print(f"    [DRY RUN] DROP VIEW IF EXISTS {v}")
        else:
            exec_ddl(f"DROP VIEW IF EXISTS {v}", f"DROP {v}")

    new_views = [
        (
            "view_current_front_month",
            """CREATE VIEW view_current_front_month AS (
              SELECT root, symbol, timestamp, close, volume
              FROM ohlcv
              WHERE asset_class = 'futures'
              LATEST ON timestamp PARTITION BY root
            )""",
        ),
        (
            "view_instrument_inventory",
            """CREATE VIEW view_instrument_inventory AS (
              SELECT symbol, asset_class, root,
                count() as bar_count,
                min(timestamp) as first_bar,
                max(timestamp) as last_bar
              FROM ohlcv_1d
              GROUP BY symbol, asset_class, root
            )""",
        ),
        (
            "view_latest_rollovers",
            """CREATE VIEW view_latest_rollovers AS (
              SELECT root, rollover_date, from_contract, to_contract,
                from_close, to_close, price_gap, cumulative_adjustment
              FROM rollovers
              LATEST ON rollover_date PARTITION BY root
            )""",
        ),
        (
            "view_latest_prices",
            """CREATE VIEW view_latest_prices AS (
              SELECT symbol, asset_class, root, timestamp, close, volume
              FROM ohlcv_1d
              LATEST ON timestamp PARTITION BY symbol
            )""",
        ),
    ]

    print("\n  Creating new views...")
    for name, ddl in new_views:
        if dry_run:
            print(f"    [DRY RUN] CREATE VIEW {name}")
        else:
            exec_ddl(ddl, f"CREATE {name}")


# ---------------------------------------------------------------------------
# Phase 5: Alter label/indicator tables
# ---------------------------------------------------------------------------


def phase5_alter_tables(root_groups: dict, dry_run: bool = False):
    print("\n" + "=" * 60)
    print("PHASE 5: Alter label and indicator tables")
    print("=" * 60)

    # Add asset_class to label tables
    label_tables = ["labels", "swing_labels", "triple_barrier_labels"]
    print("\n  Adding asset_class to label tables...")
    for table in label_tables:
        if dry_run:
            print(f"    [DRY RUN] ALTER TABLE {table} ADD COLUMN asset_class")
            print(f"    [DRY RUN] UPDATE {table} SET asset_class = 'futures'")
        else:
            try:
                exec_ddl(
                    f"ALTER TABLE {table} ADD COLUMN asset_class SYMBOL CAPACITY 10 CACHE INDEX",
                    f"ADD asset_class to {table}",
                )
            except Exception:
                print(f"    Column may already exist on {table}")

            print(f"    Backfilling {table} asset_class = 'futures'...")
            t0 = time.time()
            exec_ddl(
                f"UPDATE {table} SET asset_class = 'futures' WHERE asset_class IS NULL",
                f"UPDATE {table}",
            )
            print(f"    Done in {time.time() - t0:.1f}s")

    # Add root to indicator tables
    indicator_tables = [
        "indicators_5m", "indicators_15m", "indicators_30m",
        "indicators_1h", "indicators_4h", "indicators_1d", "indicators_1w",
    ]
    print("\n  Adding root column to indicator tables...")
    for table in indicator_tables:
        if dry_run:
            print(f"    [DRY RUN] ALTER TABLE {table} ADD COLUMN root")
        else:
            try:
                exec_ddl(
                    f"ALTER TABLE {table} ADD COLUMN root SYMBOL CAPACITY 50 CACHE INDEX",
                    f"ADD root to {table}",
                )
            except Exception:
                print(f"    Column may already exist on {table}")

    # Backfill root in indicator tables
    if not dry_run:
        print("\n  Backfilling root in indicator tables...")
        for table in indicator_tables:
            try:
                rows = get_rows(f"SELECT DISTINCT symbol FROM {table}")
                syms = [r[0] for r in rows]
                if not syms:
                    print(f"    {table}: empty, skipping")
                    continue

                print(f"    {table}: {len(syms)} symbols")
                # Group by root for batch updates
                by_root = defaultdict(list)
                for sym in syms:
                    _, root = classify_symbol(sym)
                    by_root[root].append(sym)

                for root, root_syms in by_root.items():
                    in_values = ", ".join(f"'{s}'" for s in root_syms)
                    exec_ddl(
                        f"UPDATE {table} SET root = '{root}' WHERE symbol IN ({in_values}) AND root IS NULL",
                        f"{table}/{root} ({len(root_syms)} syms)",
                    )
            except Exception as e:
                print(f"    {table}: FAILED - {e}", file=sys.stderr)

    # Enrich symbols table
    print("\n  Enriching symbols table...")
    new_cols = [
        ("root", "SYMBOL CAPACITY 50 CACHE"),
        ("exchange", "SYMBOL CAPACITY 20 CACHE"),
        ("currency", "SYMBOL CAPACITY 10 CACHE"),
        ("point_value", "DOUBLE"),
        ("pip_size", "DOUBLE"),
        ("contract_size", "DOUBLE"),
        ("decimal_places", "SHORT"),
    ]
    for col, typedef in new_cols:
        if dry_run:
            print(f"    [DRY RUN] ALTER TABLE symbols ADD COLUMN {col} {typedef}")
        else:
            try:
                exec_ddl(
                    f"ALTER TABLE symbols ADD COLUMN {col} {typedef}",
                    f"ADD {col} to symbols",
                )
            except Exception:
                print(f"    Column {col} may already exist on symbols")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="QuestDB Schema Migration (in-place)")
    parser.add_argument(
        "--phase",
        type=int,
        choices=[1, 2, 3, 4, 5],
        help="Run a specific phase (default: all)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without executing",
    )
    args = parser.parse_args()

    print("QuestDB Schema Migration: In-Place ALTER + UPDATE")
    print(f"Target: {QUESTDB_HTTP}")
    if args.dry_run:
        print("MODE: DRY RUN (no changes will be made)")
    print()

    # Phase 1 always runs (needed by later phases)
    root_groups, asset_classes, unknowns = phase1_discover()

    if args.phase and args.phase == 1:
        return

    if not args.phase or args.phase == 2:
        phase2_alter_and_update(root_groups, dry_run=args.dry_run)

    if not args.phase or args.phase == 3:
        phase3_mat_views(dry_run=args.dry_run)

    if not args.phase or args.phase == 4:
        phase4_views(dry_run=args.dry_run)

    if not args.phase or args.phase == 5:
        phase5_alter_tables(root_groups, dry_run=args.dry_run)

    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Verify application code works with new schema")
    print("  2. Drop legacy tables (ohlcv_forex, futures_ohlcv, etc.)")


if __name__ == "__main__":
    main()
