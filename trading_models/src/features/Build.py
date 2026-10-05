"""
Feature build orchestrator + CLI.

Input : 1m OHLCV parquet with `timestamp`, `contract_symbol`, OHLCV columns.
Output: <out>/features.parquet          wide table, one row per bar (PK: symbol, timeframe, bar_id)
        <out>/feature_registry.parquet  dimension table (PK: feature_id)
        <out>/events.parquet            long fact table (bar_id, feature_id) for every active flag
        <out>/manifest.json             dataset version hash, config, counts, class balance

Run from trading_models/:
    python -m src.features.Build --source <bars.parquet> --out ../data/features/MNQ/1m
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
import traceback
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import polars as pl

from src.features.Blocks import FeatureBlock, LabelBlock, TrendBlock, default_blocks
from src.features.Registry import FeatureKind, FeatureRegistry

LOG = logging.getLogger("features.Build")
PIPELINE_VERSION = "1.0.0"   # bump when any block's definition changes; feeds the dataset hash
RAW_COLS = ["timestamp", "contract_symbol", "open", "high", "low", "close", "volume"]


@dataclass
class BuildConfig:
    """Everything that determines the output bytes (hashed into dataset_version)."""

    source: str
    out_dir: str
    symbol: str = "MNQ"
    timeframe: str = "1m"
    blocks: list[dict] = field(default_factory=list)   # filled from the block instances for the manifest


class FeaturePipeline:
    """
    Applies FeatureBlocks to an OHLCV LazyFrame and derives keys.

    Depends only on the FeatureBlock abstraction (DIP); I/O lives in `write`.
    """

    def __init__(self, blocks: list[FeatureBlock]):
        self.blocks = blocks
        self.registry = FeatureRegistry()
        for block in blocks:
            self.registry.extend(block.specs())   # raises on any id/key/bit collision

    def transform(self, lf: pl.LazyFrame, symbol: str, timeframe: str) -> pl.LazyFrame:
        """Lazy graph: keys -> block stages -> state_code -> warm-up filter."""
        lf = (
            lf.select(RAW_COLS)
            .sort("timestamp")                                              # every shift/EWM assumes time order
            .with_columns(
                (pl.col("timestamp").dt.epoch("s") // 60).cast(pl.Int64).alias("bar_id"),  # epoch-minute PK
                pl.lit(symbol).alias("symbol"),
                pl.lit(timeframe).alias("timeframe"),
            )
        )
        for block in self.blocks:
            for stage in block.stages():
                lf = lf.with_columns(stage)

        flags = self.registry.flags_by_bit()
        # Bitmask of every backward-looking flag. LABEL specs cannot hold a bit (registry-enforced),
        # so the state code is leakage-free by construction.
        state = pl.sum_horizontal([pl.col(s.key).cast(pl.UInt32) * (1 << s.bit) for s in flags]).cast(pl.UInt32)
        lf = lf.with_columns(state.alias("state_code"))

        helper_cols = [c for c in lf.collect_schema().names() if c.startswith("_")]
        inputs = [s.key for s in self.registry.specs if s.kind is not FeatureKind.LABEL]
        return (
            lf.drop(helper_cols)
            .filter(pl.all_horizontal(pl.col(inputs).is_not_null()))       # drop indicator warm-up rows
            .filter(pl.all_horizontal(pl.col(inputs).cast(pl.Float64).is_finite()))  # numerical invariant: no inf/NaN inputs
        )

    def events(self, df: pl.DataFrame) -> pl.DataFrame:
        """Long-form (bar_id, feature_id) rows for every flag == 1: the FK fact table."""
        flags = self.registry.flags_by_bit()
        key_to_id = pl.DataFrame(
            {"key": [s.key for s in flags], "feature_id": [s.feature_id for s in flags]},
            schema={"key": pl.Utf8, "feature_id": pl.Int16},
        )
        return (
            df.select(["bar_id"] + [s.key for s in flags])
            .unpivot(index="bar_id", variable_name="key", value_name="v")
            .filter(pl.col("v") == 1)
            .join(key_to_id, on="key", how="inner")
            .select("bar_id", "feature_id")
            .sort("bar_id", "feature_id")
        )


def _dataset_version(cfg: BuildConfig, registry: FeatureRegistry) -> str:
    """Content-addressed version: source identity + config + feature definitions + code version."""
    src = Path(cfg.source)
    stat = src.stat()
    payload = json.dumps(
        {
            "source": str(src.resolve()),
            "size": stat.st_size,
            "mtime_ns": stat.st_mtime_ns,
            "config": {k: v for k, v in asdict(cfg).items() if k != "out_dir"},
            "registry": registry.to_frame().to_dicts(),
            "pipeline_version": PIPELINE_VERSION,
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _balance(df: pl.DataFrame, cols: list[str]) -> dict[str, float]:
    """Share of rows where each 0/1 column is 1 (nulls excluded)."""
    row = df.select([pl.col(c).mean().alias(c) for c in cols]).row(0, named=True)
    return {k: round(float(v), 6) if v is not None else None for k, v in row.items()}


def build(cfg: BuildConfig, blocks: list[FeatureBlock]) -> dict:
    """End-to-end build. Returns the manifest dict."""
    t0 = time.perf_counter()
    out = Path(cfg.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    pipe = FeaturePipeline(blocks)
    cfg.blocks = [{"class": type(b).__name__, **asdict(b)} for b in blocks]
    reg = pipe.registry
    LOG.info("registry: %d specs (%d flags -> state bits, %d labels)", len(reg.specs),
             len(reg.of_kind(FeatureKind.FLAG)), len(reg.of_kind(FeatureKind.LABEL)))

    LOG.info("[1/5] scanning %s", cfg.source)
    lf = pl.scan_parquet(cfg.source)
    n_raw = lf.select(pl.len()).collect().item()
    LOG.info("      raw bars: %s", f"{n_raw:,}")

    LOG.info("[2/5] computing features (Polars, all cores)")
    t = time.perf_counter()
    df = pipe.transform(lf, cfg.symbol, cfg.timeframe).collect()
    LOG.info("      %s rows x %d cols in %.2fs (dropped %s warm-up rows)",
             f"{df.height:,}", df.width, time.perf_counter() - t, f"{n_raw - df.height:,}")
    if df.is_empty():
        raise RuntimeError("feature frame is empty after warm-up filter; check source columns/contract groups")

    LOG.info("[3/5] building event fact table")
    t = time.perf_counter()
    ev = pipe.events(df)
    LOG.info("      %s events (%.2f active flags/bar) in %.2fs", f"{ev.height:,}", ev.height / df.height, time.perf_counter() - t)

    LOG.info("[4/5] writing parquet -> %s", out)
    df.write_parquet(out / "features.parquet", compression="zstd", statistics=True)
    reg.to_frame().write_parquet(out / "feature_registry.parquet", compression="zstd")
    ev.write_parquet(out / "events.parquet", compression="zstd", statistics=True)

    LOG.info("[5/5] manifest")
    flag_keys = [s.key for s in reg.flags_by_bit()]
    label_bin = [s.key for s in reg.of_kind(FeatureKind.LABEL) if s.key.startswith("LBL_")]
    tern = [s.key for s in reg.of_kind(FeatureKind.LABEL) if s.key.startswith("DIR_TERN_")]
    manifest = {
        "dataset_version": _dataset_version(cfg, reg),
        "pipeline_version": PIPELINE_VERSION,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "config": asdict(cfg),
        "rows": {"raw": n_raw, "features": df.height, "events": ev.height},
        "time_range_utc": [str(df["timestamp"].min()), str(df["timestamp"].max())],
        "contracts": df["contract_symbol"].n_unique(),
        "distinct_state_codes": df["state_code"].n_unique(),
        "flag_rate": _balance(df, flag_keys),
        "label_balance": _balance(df, label_bin),
        "ternary_counts": {c: {str(k): int(v) for k, v in df[c].drop_nulls().value_counts().sort(c).iter_rows()} for c in tern},
        "files": ["features.parquet", "feature_registry.parquet", "events.parquet"],
        "elapsed_s": round(time.perf_counter() - t0, 2),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str))
    LOG.info("done: version=%s, %s rows, %.2fs", manifest["dataset_version"], f"{df.height:,}", manifest["elapsed_s"])
    return manifest


def _parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build binary market-state features + direction labels.")
    p.add_argument("--source", required=True, help="1m OHLCV parquet (needs timestamp, contract_symbol, OHLCV)")
    p.add_argument("--out", required=True, help="output directory")
    p.add_argument("--symbol", default="MNQ")
    p.add_argument("--timeframe", default="1m")
    p.add_argument("--lookback", type=int, default=15, help="trend lookback bars")
    p.add_argument("--horizon", type=int, default=15, help="forward label horizon bars")
    p.add_argument("--band-k", type=float, default=0.5, help="flat band half-width in sigma units")
    return p.parse_args()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    args = _parse()
    blocks = default_blocks()
    # Swap in CLI-tuned trend/label blocks; all other families keep defaults.
    blocks = [
        TrendBlock(lookback=args.lookback, band_k=args.band_k) if isinstance(b, TrendBlock)
        else LabelBlock(horizon=args.horizon, band_k=args.band_k) if isinstance(b, LabelBlock)
        else b
        for b in blocks
    ]
    try:
        build(BuildConfig(source=args.source, out_dir=args.out, symbol=args.symbol, timeframe=args.timeframe), blocks)
    except Exception:
        LOG.error("feature build failed:\n%s", traceback.format_exc())
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
