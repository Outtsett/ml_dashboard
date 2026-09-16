"""Candle geometry — RELATIVE (scale-free) embedding on the real parquet OHLCV repo.

Implements the canonical candle -> embedding pipeline from the price-normalization
rule. NO raw price levels or raw tick counts are persisted as features — every
column is either range-normalized (in-candle shape) or a causal trailing rolling
z-score (across-time distribution). Non-destructive: overwrites the sibling
``<tf>_candle_geo.parquet``, never the source OHLCV parquet the loader reads.

Persisted feature columns (all relative / stationary):
  In-candle SHAPE (divide by range = high-low; scale-free, flat bar -> neutral):
    open_norm   = (open  - low) / range                 in [0,1]
    close_norm  = (close - low) / range                 in [0,1]   (= body position)
    body_norm   = (close - open) / range                in [-1,1]  (signed)
    upper_norm  = (high  - max(open,close)) / range      in [0,1]
    lower_norm  = (min(open,close) - low) / range        in [0,1]
  Across-time DISTRIBUTION (causal trailing rolling z-score, window W,
  min_periods=W, clipped +/-5; z(x) = (x - mean_W) / std_W):
    range_z   = z(log(range))       # magnitude of the bar, log then z
    body_z    = z(body_norm)
    wick_z    = z(upper_norm - lower_norm)   # wick asymmetry / rejection
    return_z  = z(log(close/close.shift(1))) # close-to-close LOG return, then z
    volume_z  = z(log(volume))

Usage:
    uv run python scripts/candle_geometry.py                       # MNQ + EURUSD, all TFs
    uv run python scripts/candle_geometry.py --symbols MNQ --window 100
"""

import argparse
import os
from pathlib import Path

import numpy as np
import pandas as pd

DEFAULT_ROOT = os.environ.get("OHLCV_PARQUET_ROOT", r"E:\source\repos\ml_dashboard\data\parquet")
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w")
Z_CLIP = 5.0


def _causal_z(x: pd.Series, window: int) -> np.ndarray:
    """Causal trailing rolling z-score; min_periods=window; clipped +/-Z_CLIP.
    Population std (ddof=0). Warmup rows (< window history) -> NaN (honest)."""
    r = x.rolling(window=window, min_periods=window)
    z = (x - r.mean()) / r.std(ddof=0)
    return z.clip(-Z_CLIP, Z_CLIP).to_numpy()


def compute_relative_embedding(df: pd.DataFrame, window: int) -> pd.DataFrame:
    df = df.sort_values("timestamp")
    o = df["open"].to_numpy(float)
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    v = df["volume"].to_numpy(float) if "volume" in df.columns else np.ones(len(df))

    rng = h - l
    pos = rng > 0
    denom = np.where(pos, rng, 1.0)
    # In-candle shape (scale-free). Flat bar (range==0) -> neutral.
    open_norm = np.where(pos, (o - l) / denom, 0.5)
    close_norm = np.where(pos, (c - l) / denom, 0.5)
    body_norm = np.where(pos, (c - o) / denom, 0.0)
    upper_norm = np.where(pos, (h - np.maximum(o, c)) / denom, 0.0)
    lower_norm = np.where(pos, (np.minimum(o, c) - l) / denom, 0.0)

    # Across-time distribution. Floor range/volume at their min positive
    # value (the instrument tick / 1 lot) so log is always defined.
    eps_r = rng[pos].min() if pos.any() else 1.0
    log_range = np.log(np.maximum(rng, eps_r))
    log_vol = np.log(np.maximum(v, 1.0))
    with np.errstate(divide="ignore", invalid="ignore"):
        ret = np.log(c / np.roll(c, 1))
        ret[0] = np.nan

    out = pd.DataFrame({"timestamp": df["timestamp"].to_numpy()})
    if "symbol" in df.columns:
        out["symbol"] = df["symbol"].to_numpy()
    out["open_norm"] = open_norm
    out["close_norm"] = close_norm
    out["body_norm"] = body_norm
    out["upper_norm"] = upper_norm
    out["lower_norm"] = lower_norm
    out["range_z"] = _causal_z(pd.Series(log_range), window)
    out["body_z"] = _causal_z(pd.Series(body_norm), window)
    out["wick_z"] = _causal_z(pd.Series(upper_norm - lower_norm), window)
    out["return_z"] = _causal_z(pd.Series(ret), window)
    out["volume_z"] = _causal_z(pd.Series(log_vol), window)
    return out


def process(symbol: str, root: Path, window: int) -> None:
    sym_dir = root / symbol
    if not sym_dir.is_dir():
        print(f"  [skip] {symbol}: no directory")
        return
    for tf in TIMEFRAMES:
        src = sym_dir / f"{tf}.parquet"
        if not src.exists():
            continue
        emb = compute_relative_embedding(pd.read_parquet(src), window)
        out = sym_dir / f"{tf}_candle_geo.parquet"
        emb.to_parquet(out, index=False, compression="zstd")
        warm = int(emb["range_z"].isna().sum())
        print(
            f"  {symbol}/{tf}: {len(emb):>9,} bars -> {out.name}  "
            f"| body_norm mean {emb['body_norm'].mean():+.4f} "
            f"upper_norm {emb['upper_norm'].mean():.3f} lower_norm {emb['lower_norm'].mean():.3f} "
            f"| range_z sd {emb['range_z'].std():.2f} return_z sd {emb['return_z'].std():.2f} "
            f"warmup(NaN) {warm}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="Relative candle embedding on parquet OHLCV repo")
    ap.add_argument("--symbols", default="MNQ,EURUSD")
    ap.add_argument("--window", type=int, default=100, help="causal z-score lookback (bars)")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    args = ap.parse_args()
    root = Path(args.root)
    print(f"OHLCV_PARQUET_ROOT = {root}  |  z-window = {args.window}")
    for symbol in [s.strip() for s in args.symbols.split(",") if s.strip()]:
        print(f"[{symbol}]")
        process(symbol, root, args.window)
    print("done.")


if __name__ == "__main__":
    main()
