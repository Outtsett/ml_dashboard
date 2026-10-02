"""Land one picture per TA-Lib candlestick pattern, cut from where the pattern actually fired in the lake.

Source: the MNQ 1-minute bars of ``derived_mnq_next_candles_1m`` with their TA-Lib pattern columns
(``candle_vision.bars.load``, 2021-01-03 .. 2025-06-30; the second half of 2025 is the locked holdout),
re-checked with TA-Lib 0.8.1 inside each contract.

Each picture shows ONLY the pattern's own candles — one for a one-candle pattern, two for a two-candle
pattern, up to five — as many as TA-Lib's rule reads (``candle_count`` in the datalake's
``talib_candlestick_rules.json``, read from TA-Lib's C source). The candles are the last ``candle_count``
bars ending on a bar where TA-Lib fired, scaled to their own low..high.

Which firing: of every firing of a (pattern, direction), the one whose candles have the most typical
shape — the smallest distance to the median of all firings' shapes (open / high / low / close of each
candle as a fraction of the pattern's own range). One picture per direction a pattern fires in (88);
the page shows one per pattern (61) and switches direction.

Table ``derived_study_candlestick_pattern_images`` (one table, so no suffix): pattern, direction, TA-Lib function, candle
count, firings, the firing's timestamps and contract, each candle's open / high / low / close (labelled
absolute), and the PNG (base64). Run: .venv/Scripts/python.exe packages/ml-engine/src/studies/candlestick_pattern_images/build.py
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from candle_vision import data  # noqa: E402
from candle_vision.bars import load  # noqa: E402
from candle_vision.labels import class_list, pattern_functions  # noqa: E402
from ta_strategy.store import land  # noqa: E402

DATASET = "study_candlestick_pattern_images"
RECIPE = "mnq_1m_2021_2025h1_v1"
RULES = Path("E:/source/repos/datalake/scripts/talib_candlestick_rules.json")

ORANGE, BLUE, INK = (230, 159, 0), (0, 114, 178), (20, 20, 20)
CANDLE, GAP, HEIGHT, PAD = 56, 28, 280, 24


def candle_counts() -> dict[str, int]:
    rules = json.loads(RULES.read_text(encoding="utf-8"))["patterns"]
    return {r["talib_function"]: int(r["candle_count"]) for r in rules}


def draw(candles: np.ndarray) -> bytes:
    """PNG of n candles: rising = hollow orange body, falling = filled blue body, black wicks."""
    n = len(candles)
    width = PAD * 2 + n * CANDLE + (n - 1) * GAP
    image = Image.new("RGB", (width, HEIGHT + PAD * 2), "white")
    pen = ImageDraw.Draw(image)
    low, high = candles[:, 2].min(), candles[:, 1].max()
    span = max(high - low, 1e-9)
    y = lambda price: PAD + (high - price) / span * HEIGHT
    for k, (o, h, lo, c) in enumerate(candles):
        x = PAD + k * (CANDLE + GAP)
        centre = x + CANDLE // 2
        pen.line([(centre, y(h)), (centre, y(lo))], fill=INK, width=3)
        top, bottom = y(max(o, c)), y(min(o, c))
        if bottom - top < 3:
            middle = (top + bottom) / 2
            top, bottom = middle - 1.5, middle + 1.5
        if c >= o:
            pen.rectangle([x, top, x + CANDLE, bottom], fill="white", outline=ORANGE, width=4)
        else:
            pen.rectangle([x, top, x + CANDLE, bottom], fill=BLUE, outline=BLUE, width=1)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def compute() -> pd.DataFrame:
    frame = load()
    values, agreement = data.recompute_labels(frame)
    print(f"{len(frame):,} bars; TA-Lib 0.8.1 vs the lake's 0.7.1: {int(agreement['disagreeing_bars'].sum())} disagreeing bar-patterns")
    prices = frame[["open", "high", "low", "close"]].to_numpy(np.float64)
    position = frame["contract_position"].to_numpy()
    counts = candle_counts()
    functions = pattern_functions()
    rows = []
    for name, function, direction in class_list():
        column = values[:, functions.index(function)]
        fired = {"bullish": column > 0, "bearish": column < 0, "neutral": column != 0}[direction]
        n = counts[function]
        ends = np.flatnonzero(fired & (position >= n - 1))
        base = {"pattern": name.split(":")[0], "direction": direction, "class_name": name, "talib_function": function,
                "candle_count": n, "firings": int(len(ends))}
        if len(ends) == 0:
            rows.append(base)
            continue
        candles = np.stack([prices[e - n + 1:e + 1] for e in ends])                  # (F, n, 4)
        lo = candles[:, :, 2].min(1)[:, None, None]
        hi = candles[:, :, 1].max(1)[:, None, None]
        shapes = ((candles - lo) / np.maximum(hi - lo, 1e-9)).reshape(len(ends), -1)
        typical = int(np.argmin(((shapes - np.median(shapes, 0)) ** 2).sum(1)))
        end = int(ends[typical])
        chosen = prices[end - n + 1:end + 1]
        rows.append({
            **base,
            "first_candle_timestamp": frame["timestamp"].iloc[end - n + 1],
            "signal_candle_timestamp": frame["timestamp"].iloc[end],
            "contract_symbol": frame["contract_symbol"].iloc[end],
            "talib_value": int(column[end]),
            "distance_to_median_shape": float(np.sqrt(((shapes[typical] - np.median(shapes, 0)) ** 2).sum())),
            "candles_absolute_ohlc_json": json.dumps(chosen.round(2).tolist()),
            "image_png_base64": base64.b64encode(draw(chosen)).decode("ascii"),
        })
        print(f"{name:28s} {n} candle(s)  {len(ends):>8,} firings")
    return pd.DataFrame(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--png-dir", default=str(ROOT / "data" / "candlestick_pattern_images"), help="also write each PNG here")
    arguments = parser.parse_args()
    images = compute()
    os.makedirs(arguments.png_dir, exist_ok=True)
    for row in images.dropna(subset=["image_png_base64"]).itertuples():
        Path(arguments.png_dir, f"{row.pattern}_{row.direction}.png").write_bytes(base64.b64decode(row.image_png_base64))
    print(f"{images['image_png_base64'].notna().sum()} pictures of {images['pattern'].nunique()} patterns; "
          f"no firing: {sorted(images.loc[images['image_png_base64'].isna(), 'class_name'])}")
    if arguments.dry_run:
        return 0
    with tempfile.TemporaryDirectory(prefix="candlestick_pattern_images_") as directory:
        path = os.path.join(directory, "images.parquet")
        images.to_parquet(path, index=False)
        result = land({"images": path}, RECIPE, "derived_mnq_next_candles_1m + TA-Lib 0.8.1 (study candlestick-pattern-images build.py)",
                      dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
