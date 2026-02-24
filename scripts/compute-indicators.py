"""
Compute technical indicators for all symbols × timeframes.

Reads OHLCV from DuckDB market.duckdb (read-only), computes ~344 indicator
columns via pandas-ta, writes category-partitioned parquets with metadata.

Output structure:
    data/indicators/{timeframe}/{symbol}/
        overlap.parquet      # SMA, EMA, Bollinger, Keltner, Donchian, etc.
        momentum.parquet     # RSI, MACD, Stochastic, CCI, etc.
        volatility.parquet   # ATR, NATR, True Range, etc.
        volume.parquet       # OBV, AD, CMF, MFI, etc.
        trend.parquet        # ADX, AROON, PSAR, etc.
        candle.parquet       # CDL_* patterns
        statistics.parquet   # Entropy, Kurtosis, Skew, etc.
        cycle.parquet        # EBSW, Reflex
        performance.parquet  # Log Return, Percent Return
        _meta.json           # Metadata, column catalog, file sizes

Usage:
    python scripts/compute-indicators.py
    python scripts/compute-indicators.py --symbols ES,MNQ --timeframes 1d,1h
    python scripts/compute-indicators.py --timeframes 1m --workers 2
    python scripts/compute-indicators.py --force --workers 4
    python scripts/compute-indicators.py --migrate   # Convert old flat files

Requires: pandas-ta>=0.4.71b0, duckdb>=1.2.0, pyarrow
"""

import argparse
import json
import os
import sys
import time
import traceback
import warnings
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

import duckdb
import pandas as pd
import pandas_ta as ta

# Suppress pandas-ta runtime warnings (log10 divide-by-zero in volume indicators, etc.)
warnings.filterwarnings("ignore", category=RuntimeWarning)

# ==============================================================================
# Configuration
# ==============================================================================

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = str(ROOT / "data" / "market.duckdb")
OUT_DIR = ROOT / "data" / "indicators"

# Global: resolved path to use (may be a snapshot copy if file is locked)
_RESOLVED_DB_PATH: str | None = None

TIMEFRAMES = {
    "1w": 604800,
    "1d": 86400,
    "4h": 14400,
    "1h": 3600,
    "30m": 1800,
    "15m": 900,
    "5m": 300,
    "1m": 60,
}

FUTURES_ROOTS = ["ES", "NQ", "YM", "RTY", "MNQ", "MES", "MYM", "M2K"]

# QuestDB connection settings (PG wire protocol)
QUESTDB_HOST = os.environ.get("QUESTDB_HOST", "localhost")
QUESTDB_PG_PORT = int(os.environ.get("QUESTDB_PG_PORT", "8812"))

# Parquet output settings
PARQUET_COMPRESSION = "zstd"
PARQUET_COMPRESSION_LEVEL = 3  # 1-22; 3 = fast with good ratio

# ==============================================================================
# DuckDB Lock Bypass (Windows single-writer lock)
# ==============================================================================

import shutil
import tempfile
import atexit

_SNAPSHOT_DIR: tempfile.TemporaryDirectory | None = None


def resolve_db_path() -> str:
    """Get a usable DuckDB path, creating a snapshot copy if the file is locked.

    On Windows, DuckDB allows only one process to open a file-backed DB
    (even read_only=True fails if another process holds it). This function
    tries the original path first, falling back to a temporary snapshot copy
    using Volume Shadow Copy via robocopy.
    """
    global _RESOLVED_DB_PATH, _SNAPSHOT_DIR

    if _RESOLVED_DB_PATH is not None:
        return _RESOLVED_DB_PATH

    # Try original path
    try:
        con = duckdb.connect(DB_PATH, read_only=True)
        con.close()
        _RESOLVED_DB_PATH = DB_PATH
        return _RESOLVED_DB_PATH
    except Exception:
        pass

    # File is locked - create a snapshot copy using robocopy (handles locked files on Windows)
    print("[indicators] market.duckdb is locked (dev server running?)")
    print("[indicators] Creating read-only snapshot copy via robocopy...")

    _SNAPSHOT_DIR = tempfile.TemporaryDirectory(prefix="indicators_")
    db_file = Path(DB_PATH)
    src_dir = str(db_file.parent)
    dst_dir = _SNAPSHOT_DIR.name

    # robocopy can copy files with shared locks; exit codes 0-7 are success
    import subprocess
    result = subprocess.run(
        ["robocopy", src_dir, dst_dir, db_file.name, "/COPY:DAT", "/R:3", "/W:1"],
        capture_output=True, text=True,
    )
    if result.returncode >= 8:
        raise RuntimeError(f"robocopy failed (exit {result.returncode}): {result.stderr}")

    # Also copy WAL if present
    wal_name = db_file.name + ".wal"
    if (db_file.parent / wal_name).exists():
        subprocess.run(
            ["robocopy", src_dir, dst_dir, wal_name, "/COPY:DAT", "/R:3", "/W:1"],
            capture_output=True, text=True,
        )

    snapshot_path = str(Path(dst_dir) / db_file.name)

    # Verify the snapshot works
    con = duckdb.connect(snapshot_path, read_only=True)
    count = con.sql("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
    con.close()

    size_gb = Path(snapshot_path).stat().st_size / (1024 ** 3)
    print(f"[indicators] Snapshot ready: {size_gb:.1f}GB, {count:,} OHLCV rows")
    _RESOLVED_DB_PATH = snapshot_path
    return _RESOLVED_DB_PATH


def cleanup_snapshot():
    """Remove temporary snapshot on exit."""
    global _SNAPSHOT_DIR
    if _SNAPSHOT_DIR is not None:
        try:
            _SNAPSHOT_DIR.cleanup()
        except Exception:
            pass
        _SNAPSHOT_DIR = None


atexit.register(cleanup_snapshot)


# ==============================================================================
# QuestDB Source (via DuckDB postgres_scanner)
# ==============================================================================


def connect_questdb() -> duckdb.DuckDBPyConnection:
    """Create a DuckDB in-memory connection with QuestDB attached via postgres_scanner."""
    con = duckdb.connect(":memory:")
    con.execute("INSTALL postgres_scanner; LOAD postgres_scanner;")
    con.execute(f"""
        ATTACH 'host={QUESTDB_HOST} port={QUESTDB_PG_PORT} user=admin password=quest dbname=qdb'
        AS questdb (TYPE postgres, READ_ONLY)
    """)
    print(f"[indicators] Connected to QuestDB via postgres_scanner ({QUESTDB_HOST}:{QUESTDB_PG_PORT})")
    return con


def get_instruments_questdb(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Get all symbols from QuestDB ohlcv, grouped by type."""
    # QuestDB has rollovers table too (synced from market.duckdb)
    # But for simplicity, use the known futures roots
    all_symbols = con.sql(
        "SELECT DISTINCT symbol FROM questdb.ohlcv ORDER BY symbol"
    ).fetchall()

    instruments = []
    futures_set = set(FUTURES_ROOTS)

    forex = []
    for (sym,) in all_symbols:
        is_root = sym in futures_set
        is_contract = any(
            sym.startswith(root) and len(sym) > len(root) for root in futures_set
        )
        if not is_root and not is_contract:
            forex.append(sym)

    for root in sorted(futures_set):
        instruments.append({"symbol": root, "type": "futures"})
    for sym in sorted(forex):
        instruments.append({"symbol": sym, "type": "forex"})
    return instruments


def build_continuous_ohlcv_questdb(
    con: duckdb.DuckDBPyConnection,
    root: str,
    tf_seconds: int,
) -> pd.DataFrame:
    """Build continuous contract OHLCV from QuestDB with Panama back-adjustment.

    Uses questdb.ohlcv and questdb.rollovers via postgres_scanner.
    """
    interval = f"{tf_seconds} seconds"
    return con.sql(f"""
        WITH schedule AS (
            SELECT to_contract as contract,
                   rollover_date as start_date,
                   LEAD(rollover_date) OVER (
                       PARTITION BY root ORDER BY rollover_date
                   ) as end_date,
                   cumulative_adjustment as adj
            FROM questdb.rollovers WHERE root = '{root}'
            UNION ALL
            SELECT from_contract as contract,
                   DATE '1900-01-01' as start_date,
                   rollover_date as end_date,
                   cumulative_adjustment + price_gap as adj
            FROM questdb.rollovers
            WHERE root = '{root}'
              AND rollover_date = (
                  SELECT MIN(rollover_date) FROM questdb.rollovers WHERE root = '{root}'
              )
        ),
        stitched AS (
            SELECT o.ts,
                   o.open + s.adj as open,
                   o.high + s.adj as high,
                   o.low  + s.adj as low,
                   o.close + s.adj as close,
                   o.volume
            FROM questdb.ohlcv o
            JOIN schedule s ON o.symbol = s.contract
                AND CAST(o.ts AS DATE) >= s.start_date
                AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
        )
        SELECT
            time_bucket(INTERVAL '{interval}', ts) as timestamp,
            first(open ORDER BY ts) as open,
            max(high) as high,
            min(low) as low,
            last(close ORDER BY ts) as close,
            CAST(sum(volume) AS DOUBLE) as volume
        FROM stitched
        GROUP BY time_bucket(INTERVAL '{interval}', ts)
        ORDER BY timestamp
    """).df()


def build_forex_ohlcv_questdb(
    con: duckdb.DuckDBPyConnection,
    symbol: str,
    tf_seconds: int,
) -> pd.DataFrame:
    """Read forex OHLCV from QuestDB aggregated to timeframe."""
    interval = f"{tf_seconds} seconds"
    return con.sql(f"""
        SELECT
            time_bucket(INTERVAL '{interval}', ts) as timestamp,
            first(open ORDER BY ts) as open,
            max(high) as high,
            min(low) as low,
            last(close ORDER BY ts) as close,
            CAST(sum(volume) AS DOUBLE) as volume
        FROM questdb.ohlcv
        WHERE symbol = '{symbol}'
        GROUP BY time_bucket(INTERVAL '{interval}', ts)
        ORDER BY timestamp
    """).df()


# ==============================================================================
# Column Classification
# ==============================================================================

# Category prefix rules -- ordered to resolve ambiguities correctly.
# More-specific prefixes (e.g., "ADX") are checked before less-specific ("AD").
CATEGORY_PREFIXES = [
    (
        "candle",
        [
            "CDL_",
        ],
    ),
    (
        "trend",
        [
            "ADX",
            "DMP_",
            "DMN_",
            "AROON",
            "CHOP_",
            "CKSP_",
            "DPO_",
            "PSAR",
            "QS_",
            "VTXP_",
            "VTXM_",
            "VHF_",
            "RWI_",
            "LDECAY_",
            "DEC_",
            "INC_",
            "ZIGZAG",
            "SMC_",
            "EXHC_",
            "CHDLREXT",
        ],
    ),
    (
        "volume",
        [
            "OBV",
            "ADOSC_",
            "AD",
            "CMF_",
            "EFI_",
            "EOM",
            "KVO_",
            "MFI_",
            "NVI_",
            "PVI_",
            "PVOL_",
            "PVR_",
            "PVT_",
            "VWAP_",
            "TSV_",
            "AOBV_",
            "VP_",
            "VHM_",
        ],
    ),
    (
        "volatility",
        [
            "ATR",
            "NATR_",
            "TRUERANGE",
            "ABER",
            "THERMO",
            "UI_",
            "PDIST_",
            "MASSI_",
            "HWU_",
            "HWM_",
            "HWL_",
            "TOS_",
            "BBW_",
            "KCW_",
            "RVI_",
        ],
    ),
    (
        "momentum",
        [
            "RSI_",
            "MACD",
            "STOCH",
            "CCI_",
            "WILLR_",
            "MOM_",
            "ROC_",
            "AO_",
            "APO_",
            "PPO_",
            "BIAS_",
            "BOP",
            "CFO_",
            "CG_",
            "CMO_",
            "COPC_",
            "CRSI_",
            "CTI_",
            "ER_",
            "FISHER",
            "INERTIA_",
            "KST_",
            "PGO_",
            "PSL_",
            "QQE",
            "RSX_",
            "RVGI_",
            "STC_",
            "TRIX_",
            "TSI_",
            "UO_",
            "SMI_",
            "TMO_",
            "SQZ",
            "K_",
            "D_",
            "J_",
        ],
    ),
    (
        "cycle",
        [
            "EBSW_",
            "REFLEX_",
        ],
    ),
    (
        "statistics",
        [
            "ENTP",
            "KURT",
            "MAD_",
            "MEDIAN_",
            "QTL_",
            "SKEW_",
            "STDEV_",
            "VAR_",
            "ZS_",
            "SLOPE_",
        ],
    ),
    (
        "performance",
        [
            "LOGRET_",
            "PCTRET_",
            "CUMLOGRET_",
            "CUMPCTRET_",
        ],
    ),
    (
        "overlap",
        [
            "SMA_",
            "EMA_",
            "WMA_",
            "DEMA_",
            "TEMA_",
            "T3_",
            "KAMA_",
            "FWMA_",
            "HMA_",
            "ALMA_",
            "LINREG_",
            "MIDPOINT_",
            "MIDPRICE_",
            "PWMA_",
            "RMA_",
            "SINWMA_",
            "SWMA_",
            "TRIMA_",
            "VIDYA_",
            "VWMA_",
            "HWMA_",
            "MCGD_",
            "SMMA_",
            "JMA_",
            "ZLMA_",
            "ZL_",
            "HT_",
            "HILO",
            "ISA_",
            "ISB_",
            "ITS_",
            "IKS_",
            "ICS_",
            "MAMA_",
            "FAMA_",
            "SSF",
            "BBL_",
            "BBM_",
            "BBU_",
            "BBB_",
            "BBP_",
            "KCL",
            "KCB",
            "KCU",
            "DCL_",
            "DCM_",
            "DCU_",
            "SUPERT",
            "ALPHAT",
            "AMAT",
            "ACCB",
        ],
    ),
]


def classify_column(col: str) -> str:
    """Classify an indicator column name into its category."""
    upper = col.upper()
    for category, prefixes in CATEGORY_PREFIXES:
        for prefix in prefixes:
            if upper.startswith(prefix):
                return category
    return "other"


def classify_columns(columns: list[str]) -> dict[str, list[str]]:
    """Classify multiple columns into category groups."""
    ohlcv = {"timestamp", "open", "high", "low", "close", "volume"}
    groups: dict[str, list[str]] = {}
    for col in columns:
        if col.lower() in ohlcv:
            continue
        cat = classify_column(col)
        groups.setdefault(cat, []).append(col)
    return groups


# ==============================================================================
# DuckDB OHLCV Queries
# ==============================================================================


def get_instruments(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Get all symbols from ohlcv, grouped by type."""
    futures_roots = con.sql(
        "SELECT DISTINCT root FROM rollovers ORDER BY root"
    ).fetchall()
    futures_set = {r[0] for r in futures_roots}

    all_symbols = con.sql(
        "SELECT DISTINCT symbol FROM ohlcv ORDER BY symbol"
    ).fetchall()

    forex = []
    for (sym,) in all_symbols:
        is_futures = any(
            sym.startswith(root) and len(sym) > len(root) for root in futures_set
        )
        if not is_futures and sym not in futures_set:
            forex.append(sym)

    instruments = []
    for root in sorted(futures_set):
        instruments.append({"symbol": root, "type": "futures"})
    for sym in sorted(forex):
        instruments.append({"symbol": sym, "type": "forex"})
    return instruments


def build_continuous_ohlcv(
    con: duckdb.DuckDBPyConnection,
    root: str,
    tf_seconds: int,
) -> pd.DataFrame:
    """Build continuous contract OHLCV with Panama back-adjustment."""
    interval = f"{tf_seconds} seconds"
    return con.sql(f"""
        WITH schedule AS (
            SELECT to_contract as contract,
                   rollover_date as start_date,
                   LEAD(rollover_date) OVER (
                       PARTITION BY root ORDER BY rollover_date
                   ) as end_date,
                   cumulative_adjustment as adj
            FROM rollovers WHERE root = '{root}'
            UNION ALL
            SELECT from_contract as contract,
                   DATE '1900-01-01' as start_date,
                   rollover_date as end_date,
                   cumulative_adjustment + price_gap as adj
            FROM rollovers
            WHERE root = '{root}'
              AND rollover_date = (
                  SELECT MIN(rollover_date) FROM rollovers WHERE root = '{root}'
              )
        ),
        stitched AS (
            SELECT o.ts,
                   o.open + s.adj as open,
                   o.high + s.adj as high,
                   o.low  + s.adj as low,
                   o.close + s.adj as close,
                   o.volume
            FROM ohlcv o
            JOIN schedule s ON o.symbol = s.contract
                AND CAST(o.ts AS DATE) >= s.start_date
                AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
        )
        SELECT
            time_bucket(INTERVAL '{interval}', ts) as timestamp,
            first(open ORDER BY ts) as open,
            max(high) as high,
            min(low) as low,
            last(close ORDER BY ts) as close,
            CAST(sum(volume) AS DOUBLE) as volume
        FROM stitched
        GROUP BY time_bucket(INTERVAL '{interval}', ts)
        ORDER BY timestamp
    """).df()


def build_forex_ohlcv(
    con: duckdb.DuckDBPyConnection,
    symbol: str,
    tf_seconds: int,
) -> pd.DataFrame:
    """Read forex OHLCV aggregated to timeframe."""
    interval = f"{tf_seconds} seconds"
    return con.sql(f"""
        SELECT
            time_bucket(INTERVAL '{interval}', ts) as timestamp,
            first(open ORDER BY ts) as open,
            max(high) as high,
            min(low) as low,
            last(close ORDER BY ts) as close,
            CAST(sum(volume) AS DOUBLE) as volume
        FROM ohlcv
        WHERE symbol = '{symbol}'
        GROUP BY time_bucket(INTERVAL '{interval}', ts)
        ORDER BY timestamp
    """).df()


# ==============================================================================
# Indicator Computation
# ==============================================================================


def compute_indicators(df: pd.DataFrame, symbol: str, tf_name: str) -> pd.DataFrame:
    """Compute ALL pandas-ta indicators on a DataFrame."""
    if df.empty or len(df) < 30:
        print(f"  [{symbol}/{tf_name}] Skip: only {len(df)} bars (need >= 30)")
        return df

    # Normalize columns
    df.columns = [c.lower() for c in df.columns]
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df.set_index("timestamp", inplace=True)

    for col in ["open", "high", "low", "close", "volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df.dropna(subset=["open", "high", "low", "close"], inplace=True)
    if len(df) < 30:
        print(f"  [{symbol}/{tf_name}] Skip after cleanup: only {len(df)} bars")
        return df

    df.ta.cores = 0 if len(df) > 500_000 else 2
    cols_before = len(df.columns)

    # 1) Run AllStudy -- computes all ~300+ indicators
    try:
        df.ta.study(ta.AllStudy, verbose=False)
    except Exception as e:
        print(f"  [{symbol}/{tf_name}] AllStudy error: {e}", flush=True)

    # 2) Extra multi-length variants (common lookback periods)
    extras = ta.Study(
        name="extras",
        ta=[{"kind": "sma", "length": l} for l in [5, 10, 50, 100, 200]]
        + [{"kind": "ema", "length": l} for l in [5, 10, 50, 100, 200]]
        + [
            {"kind": "rsi", "length": 7},
            {"kind": "rsi", "length": 21},
            {"kind": "cci", "length": 14},
            {"kind": "mom", "length": 20},
            {"kind": "roc", "length": 20},
        ],
    )
    try:
        df.ta.study(extras, verbose=False)
    except Exception:
        pass

    new_cols = len(df.columns) - cols_before
    print(
        f"  [{symbol}/{tf_name}] {len(df):,} bars, +{new_cols} indicator columns",
        flush=True,
    )
    return df


# ==============================================================================
# Partitioned Writer
# ==============================================================================


def write_partitioned(
    df: pd.DataFrame,
    symbol: str,
    tf_name: str,
    out_dir: Path,
) -> dict:
    """Write indicator DataFrame to category-partitioned parquet files.

    Each category gets its own parquet file with timestamp + indicator columns.
    Float64 columns are downcast to float32 to halve file size.
    Zstd compression provides ~30-50% better ratio than default snappy.

    Returns metadata dict.
    """
    symbol_dir = out_dir / tf_name / symbol
    symbol_dir.mkdir(parents=True, exist_ok=True)

    # Reset index if timestamp is the index
    if df.index.name == "timestamp":
        df.reset_index(inplace=True)

    # Convert timestamp to epoch milliseconds for consistent storage
    if "timestamp" in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df["timestamp"]):
            df["timestamp"] = df["timestamp"].astype("int64") // 10**6

    # Classify indicator columns into categories
    indicator_cols = [
        c
        for c in df.columns
        if c.lower() not in {"timestamp", "open", "high", "low", "close", "volume"}
    ]
    category_groups = classify_columns(indicator_cols)

    meta = {
        "version": 2,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "symbol": symbol,
        "timeframe": tf_name,
        "row_count": len(df),
        "total_columns": len(indicator_cols),
        "compression": PARQUET_COMPRESSION,
        "float_precision": "float32",
        "categories": {},
    }

    for category, cols in sorted(category_groups.items()):
        if not cols:
            continue

        # Build sub-DataFrame: timestamp + category columns only
        valid_cols = [c for c in cols if c in df.columns]
        if not valid_cols:
            continue

        sub_df = df[["timestamp"] + valid_cols].copy()

        # Downcast float64 -> float32 to halve file size
        # (adequate precision for indicator values; 7 significant digits)
        for c in valid_cols:
            if sub_df[c].dtype == "float64":
                sub_df[c] = sub_df[c].astype("float32")

        # Write with zstd compression
        cat_path = symbol_dir / f"{category}.parquet"
        sub_df.to_parquet(
            str(cat_path),
            index=False,
            engine="pyarrow",
            compression=PARQUET_COMPRESSION,
            compression_level=PARQUET_COMPRESSION_LEVEL,
        )

        file_size = cat_path.stat().st_size
        meta["categories"][category] = {
            "columns": sorted(valid_cols),
            "column_count": len(valid_cols),
            "file_size_bytes": file_size,
            "file_size_mb": round(file_size / (1024 * 1024), 1),
        }

        # Free sub-DataFrame memory
        del sub_df

    # Write metadata
    meta_path = symbol_dir / "_meta.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    total_size = sum(c["file_size_bytes"] for c in meta["categories"].values())
    meta["total_size_mb"] = round(total_size / (1024 * 1024), 1)
    return meta


# ==============================================================================
# Worker Entry Point
# ==============================================================================


def process_symbol(
    symbol: str,
    sym_type: str,
    tf_list: list[tuple[str, int]],
    force: bool,
    db_path: str | None = None,
    source: str = "duckdb",
) -> dict:
    """Process all timeframes for one symbol. Runs in a worker process."""
    if source == "questdb":
        con = connect_questdb()
    else:
        if db_path:
            global _RESOLVED_DB_PATH
            _RESOLVED_DB_PATH = db_path
        db = resolve_db_path()
        con = duckdb.connect(db, read_only=True)
    results = {
        "symbol": symbol,
        "completed": 0,
        "skipped": 0,
        "errors": 0,
    }

    for tf_name, tf_sec in tf_list:
        symbol_dir = OUT_DIR / tf_name / symbol
        meta_path = symbol_dir / "_meta.json"

        # Skip if already computed (partitioned format)
        if meta_path.exists() and not force:
            results["skipped"] += 1
            continue

        # Also skip if old flat file exists and we're not forcing
        old_path = OUT_DIR / f"{symbol}_{tf_name}.parquet"
        if old_path.exists() and not force:
            results["skipped"] += 1
            continue

        combo_start = time.time()
        try:
            # Load OHLCV
            if source == "questdb":
                if sym_type == "futures":
                    df = build_continuous_ohlcv_questdb(con, symbol, tf_sec)
                else:
                    df = build_forex_ohlcv_questdb(con, symbol, tf_sec)
            else:
                if sym_type == "futures":
                    df = build_continuous_ohlcv(con, symbol, tf_sec)
                else:
                    df = build_forex_ohlcv(con, symbol, tf_sec)

            if df.empty:
                print(f"  [{symbol}/{tf_name}] No data", flush=True)
                results["completed"] += 1
                continue

            print(
                f"  [{symbol}/{tf_name}] Loading {len(df):,} bars...",
                flush=True,
            )

            # Compute indicators
            df = compute_indicators(df, symbol, tf_name)

            # Write partitioned
            meta = write_partitioned(df, symbol, tf_name, OUT_DIR)

            elapsed = time.time() - combo_start
            results["completed"] += 1

            cat_sizes = ", ".join(
                f"{k}={v['file_size_mb']}MB"
                for k, v in sorted(meta.get("categories", {}).items())
            )
            print(
                f"  [{symbol}/{tf_name}] Done {elapsed:.1f}s -- "
                f"{meta.get('total_size_mb', 0)}MB total "
                f"({meta.get('total_columns', 0)} cols, "
                f"{meta.get('row_count', 0):,} rows) "
                f"[{cat_sizes}]",
                flush=True,
            )

            # Free memory
            del df

        except Exception as e:
            results["errors"] += 1
            print(f"  [{symbol}/{tf_name}] ERROR: {e}", flush=True)
            traceback.print_exc()

    con.close()
    return results


# ==============================================================================
# Migration: Convert old flat files -> partitioned format
# ==============================================================================


def migrate_flat_files(out_dir: Path, remove_old: bool = False):
    """Migrate old flat {SYMBOL}_{timeframe}.parquet files to partitioned format."""
    flat_files = sorted(out_dir.glob("*.parquet"))
    flat_files = [f for f in flat_files if f.is_file()]

    if not flat_files:
        print("[migrate] No flat files found to migrate")
        return

    print(f"[migrate] Found {len(flat_files)} flat parquet files")
    migrated = 0
    skipped = 0
    errors = 0

    for flat_path in flat_files:
        name = flat_path.stem  # e.g., "ES_1d", "AUDJPY_15m"

        # Parse symbol and timeframe from filename
        symbol = None
        tf_name = None
        for tf in TIMEFRAMES:
            if name.endswith(f"_{tf}"):
                symbol = name[: -(len(tf) + 1)]
                tf_name = tf
                break

        if not symbol or not tf_name:
            print(f"  [migrate] Skip {flat_path.name}: can't parse symbol/timeframe")
            skipped += 1
            continue

        target_dir = out_dir / tf_name / symbol
        if (target_dir / "_meta.json").exists():
            print(f"  [migrate] Skip {symbol}/{tf_name}: already partitioned")
            skipped += 1
            continue

        size_mb = flat_path.stat().st_size / (1024 * 1024)
        print(
            f"  [migrate] {flat_path.name} ({size_mb:.0f}MB) -> {tf_name}/{symbol}/...",
            end="",
            flush=True,
        )

        try:
            con = duckdb.connect(":memory:")
            safe = str(flat_path).replace("\\", "/")
            df = con.sql(f"SELECT * FROM read_parquet('{safe}')").df()
            con.close()

            meta = write_partitioned(df, symbol, tf_name, out_dir)
            del df

            new_size = meta.get("total_size_mb", 0)
            print(f" -> {new_size}MB ({len(meta.get('categories', {}))} categories)")
            migrated += 1

            if remove_old:
                flat_path.unlink()
                print(f"    Removed {flat_path.name}")

        except Exception as e:
            errors += 1
            print(f" ERROR: {e}")

    print(f"\n[migrate] Done: {migrated} migrated, {skipped} skipped, {errors} errors")
    if not remove_old and migrated > 0:
        print(
            "[migrate] Old flat files kept. Re-run with --migrate --remove-old to delete them."
        )


# ==============================================================================
# Main
# ==============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Compute technical indicators (category-partitioned, zstd-compressed)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Output: data/indicators/{timeframe}/{symbol}/{category}.parquet
Categories: candle, overlap, momentum, volatility, volume, trend, statistics, cycle, performance

Examples:
  python scripts/compute-indicators.py                          # All symbols, all timeframes (except 1m)
  python scripts/compute-indicators.py --timeframes 1m          # 1m only (auto-caps workers to 2)
  python scripts/compute-indicators.py --symbols ES,MNQ --force # Recompute specific symbols
  python scripts/compute-indicators.py --migrate                # Convert old flat files
  python scripts/compute-indicators.py --migrate --remove-old   # Migrate and remove old files
        """,
    )
    parser.add_argument(
        "--source", type=str, choices=["duckdb", "questdb"], default="duckdb",
        help="Data source: 'duckdb' reads market.duckdb (default), 'questdb' reads from QuestDB via postgres_scanner",
    )
    parser.add_argument(
        "--db-path", type=str,
        help="Path to DuckDB file (use a copy if dev server holds the lock)",
    )
    parser.add_argument(
        "--symbols", type=str, help="Comma-separated symbols (default: all)"
    )
    parser.add_argument(
        "--timeframes",
        type=str,
        help="Comma-separated timeframes (default: all except 1m)",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    parser.add_argument(
        "--skip-1m", action="store_true", help="Skip 1-minute timeframe"
    )
    parser.add_argument(
        "--workers", type=int, default=3, help="Parallel workers (default: 3)"
    )
    parser.add_argument(
        "--migrate",
        action="store_true",
        help="Migrate old flat files to partitioned format",
    )
    parser.add_argument(
        "--remove-old",
        action="store_true",
        help="Remove old flat files after migration",
    )
    args = parser.parse_args()

    total_start = time.time()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # --- Migration mode ---
    if args.migrate:
        migrate_flat_files(OUT_DIR, remove_old=args.remove_old)
        return

    # --- Normal computation ---
    source = args.source

    if source == "questdb":
        print("[indicators] Source: QuestDB (via postgres_scanner)")
        con = connect_questdb()
        instruments = get_instruments_questdb(con)
        con.close()
    else:
        if args.db_path:
            _override = str(Path(args.db_path).resolve())
            print(f"[indicators] Using provided DB: {_override}")
            global _RESOLVED_DB_PATH
            _RESOLVED_DB_PATH = _override
        print(f"[indicators] Source: DuckDB ({DB_PATH})")
        db = resolve_db_path()
        con = duckdb.connect(db, read_only=True)
        instruments = get_instruments(con)
        con.close()

    n_futures = sum(1 for i in instruments if i["type"] == "futures")
    n_forex = sum(1 for i in instruments if i["type"] == "forex")
    print(
        f"[indicators] {len(instruments)} instruments ({n_futures} futures, {n_forex} forex)"
    )

    if args.symbols:
        selected = set(args.symbols.upper().split(","))
        instruments = [i for i in instruments if i["symbol"] in selected]
        print(f"[indicators] Filtered: {[i['symbol'] for i in instruments]}")

    # Build timeframe list
    tf_list = list(TIMEFRAMES.items())
    if args.timeframes:
        selected_tfs = set(args.timeframes.lower().split(","))
        tf_list = [(k, v) for k, v in tf_list if k in selected_tfs]
    elif not args.timeframes:
        # Default: skip 1m unless explicitly requested via --timeframes
        tf_list = [(k, v) for k, v in tf_list if k != "1m"]
    if args.skip_1m:
        tf_list = [(k, v) for k, v in tf_list if k != "1m"]

    # Cap workers for memory-heavy 1m timeframe
    effective_workers = args.workers
    has_1m = any(tf == "1m" for tf, _ in tf_list)
    if has_1m and effective_workers > 1:
        print("[indicators] 1m detected -- using sequential mode (workers=0) for memory safety")
        effective_workers = 0

    print(f"[indicators] Timeframes: {[t[0] for t in tf_list]}")
    print(f"[indicators] Workers: {effective_workers} {'(sequential)' if effective_workers == 0 else '(parallel)'}")
    print(
        f"[indicators] Output: data/indicators/{{timeframe}}/{{symbol}}/{{category}}.parquet"
    )
    print(
        f"[indicators] Compression: {PARQUET_COMPRESSION} (level {PARQUET_COMPRESSION_LEVEL})"
    )
    print(f"[indicators] Float precision: float32")
    print()

    total_combos = len(instruments) * len(tf_list)
    total_completed = 0
    total_skipped = 0
    total_errors = 0

    resolved_path = _RESOLVED_DB_PATH  # Pass to workers so they don't re-resolve

    if effective_workers == 0:
        # Sequential mode: process one symbol at a time, explicit gc between symbols
        import gc
        for i, inst in enumerate(instruments, 1):
            symbol = inst["symbol"]
            print(f"\n[indicators] === {symbol} ({i}/{len(instruments)}) ===", flush=True)
            try:
                result = process_symbol(
                    symbol, inst["type"], tf_list, args.force, resolved_path,
                    source=source,
                )
                total_completed += result["completed"]
                total_skipped += result["skipped"]
                total_errors += result["errors"]
                done = total_completed + total_skipped + total_errors
                print(
                    f"[indicators] {symbol} done "
                    f"({result['completed']} computed, {result['skipped']} skipped, "
                    f"{result['errors']} errors) "
                    f"[{done}/{total_combos}]",
                    flush=True,
                )
            except Exception as e:
                print(f"[indicators] {symbol} ERROR: {e}", flush=True)
                traceback.print_exc()
                total_errors += len(tf_list)
            # Force garbage collection to free memory between symbols
            gc.collect()
    else:
        # Parallel mode
        with ProcessPoolExecutor(max_workers=effective_workers) as executor:
            futures = {}
            for inst in instruments:
                future = executor.submit(
                    process_symbol,
                    inst["symbol"],
                    inst["type"],
                    tf_list,
                    args.force,
                    resolved_path,
                    source,
                )
                futures[future] = inst["symbol"]

            for future in as_completed(futures):
                symbol = futures[future]
                try:
                    result = future.result()
                    total_completed += result["completed"]
                    total_skipped += result["skipped"]
                    total_errors += result["errors"]
                    done = total_completed + total_skipped + total_errors
                    print(
                        f"[indicators] {symbol} done "
                        f"({result['completed']} computed, {result['skipped']} skipped, "
                        f"{result['errors']} errors) "
                        f"[{done}/{total_combos}]",
                        flush=True,
                    )
                except Exception as e:
                    print(f"[indicators] {symbol} WORKER ERROR: {e}", flush=True)
                    traceback.print_exc()
                    total_errors += len(tf_list)

    total_time = time.time() - total_start

    # Summary
    print(f"\n{'=' * 60}")
    print(f"[indicators] Finished in {total_time:.0f}s")
    print(f"  Computed: {total_completed}")
    print(f"  Skipped:  {total_skipped}")
    print(f"  Errors:   {total_errors}")

    # Disk usage summary
    total_bytes = 0
    file_count = 0
    for p in OUT_DIR.rglob("*.parquet"):
        total_bytes += p.stat().st_size
        file_count += 1
    print(f"  Files:    {file_count} parquets")
    print(f"  Disk:     {total_bytes / (1024**3):.1f} GB")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
