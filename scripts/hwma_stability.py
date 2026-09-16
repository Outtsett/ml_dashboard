"""Where the Holt-Winters moving average is stable, and where it is not.

HWMA carries three states — level, velocity, acceleration — and each is a blend
of "carry the previous estimate forward" and "correct toward what just happened".
Written without the carry weights it is a double integrator with positive
feedback and diverges for every parameter choice; that defect took the Market
page down on 2026-09-15 (values reached 1e93, past the chart's 9.007e13
assertion). Written correctly it is stable for SOME (na, nb, nc) and not others,
and nothing in the indicator panel constrains the choice.

This measures the boundary, on real MNQ front-month closes:

  hwma_parameter_grid   one row per (na, nb, nc): the spectral radius of the
                        state matrix, and what the recursion actually did on the
                        data - lowest value, highest value, whether it went
                        negative, how many bars it emitted before leaving the
                        data's range.
  hwma_price_series     the closes every run was measured against.
  hwma_run_information  what was measured, when, and against which snapshot.

    E:\\source\\repos\\datalake\\.venv\\Scripts\\python.exe scripts/hwma_stability.py
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, r"E:\source\repos\datalake\src")

import duckdb  # noqa: E402
import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
from lake.catalog import duckdb_connect  # noqa: E402

RESULTS_DATABASE = Path(os.environ.get("HWMA_STABILITY_DATABASE", r"E:\lake-workspace\hwma_stability.duckdb"))
#: the snapshot the dashboard's own DuckDB serves
SNAPSHOT = os.environ.get("LAKE_SERVING_SNAPSHOT", "derived/recipe=questdb_full_2026-09-09")
SYMBOL = "MNQH6"
BAR_COUNT = 2_000
GRID = np.round(np.arange(0.05, 1.0, 0.05), 2)
DEFAULTS = (0.2, 0.1, 0.1)
#: how far past the data's own range a price average may wander before the run
#: is called diverging - the same bound calcHWMA uses to stop emitting
RANGE_MULTIPLE = 10.0


def closes_from_lake() -> pl.DataFrame:
    """The last BAR_COUNT one-minute closes of the front-month contract."""
    connection = duckdb_connect(duckdb.connect())
    try:
        table = connection.execute(f"""
            SELECT "timestamp", close FROM read_parquet(
                's3://{SNAPSHOT}/table=ohlcv_1m/**/*.parquet')
            WHERE symbol = '{SYMBOL}' AND volume > 0
            ORDER BY "timestamp" DESC LIMIT {BAR_COUNT}""").to_arrow_table()
    finally:
        connection.close()
    return pl.from_arrow(table).sort("timestamp").with_row_index("bar_index")


def state_matrix(na: float, nb: float, nc: float) -> np.ndarray:
    """The 3x3 that maps [level, velocity, acceleration] to its next value.

    The price term is an input, not part of the loop, so stability is decided by
    this matrix alone: every eigenvalue inside the unit circle means a shock
    decays, one outside means it compounds.
    """
    level = np.array([1 - na, 1 - na, 0.5 * (1 - na)])
    level_change = level - np.array([1.0, 0.0, 0.0])
    velocity = nb * level_change + np.array([0.0, 1 - nb, 1 - nb])
    velocity_change = velocity - np.array([0.0, 1.0, 0.0])
    acceleration = nc * velocity_change + np.array([0.0, 0.0, 1 - nc])
    return np.vstack([level, velocity, acceleration])


def spectral_radius(na: float, nb: float, nc: float) -> float:
    return float(np.max(np.abs(np.linalg.eigvals(state_matrix(na, nb, nc)))))


def run(closes: np.ndarray, na: float, nb: float, nc: float) -> dict:
    """The recursion as the chart runs it, including the stop-emitting bound."""
    low, high = float(closes.min()), float(closes.max())
    span = max(high - low, abs(high) * 1e-6, 1e-9)
    floor, ceiling = low - RANGE_MULTIPLE * span, high + RANGE_MULTIPLE * span

    # The loop runs to the end either way. Breaking at the bound is what the
    # chart does, but a run that stops there hides what the recursion would have
    # done next — and "does it ever go negative" is a question about the
    # recursion, not about the guard. So: emit until the bound, keep iterating
    # after it, and record both.
    level, velocity, acceleration = float(closes[0]), 0.0, 0.0
    emitted = [level]
    unbounded_minimum, unbounded_maximum = level, level
    left_at = None
    with np.errstate(over="ignore", invalid="ignore"):
        for index in range(1, len(closes)):
            previous_level, previous_velocity, previous_acceleration = level, velocity, acceleration
            level = (1 - na) * (previous_level + previous_velocity + 0.5 * previous_acceleration) + na * closes[index]
            velocity = (1 - nb) * (previous_velocity + previous_acceleration) + nb * (level - previous_level)
            acceleration = (1 - nc) * previous_acceleration + nc * (velocity - previous_velocity)
            if np.isfinite(level):
                unbounded_minimum = min(unbounded_minimum, level)
                unbounded_maximum = max(unbounded_maximum, level)
            if left_at is None:
                if not np.isfinite(level) or level < floor or level > ceiling:
                    left_at = index
                else:
                    emitted.append(level)
    values = np.array(emitted, dtype=float)
    return {
        "bars_emitted": len(values),
        "left_range_at_bar": left_at,
        "emitted_minimum": float(values.min()),
        "emitted_maximum": float(values.max()),
        "unbounded_minimum": float(unbounded_minimum),
        "unbounded_maximum": float(unbounded_maximum),
        "went_negative_unbounded": bool(unbounded_minimum < 0),
        "went_negative_emitted": bool(values.min() < 0),
    }


def main() -> int:
    started = time.time()
    prices = closes_from_lake()
    closes = prices["close"].to_numpy().astype(float)
    print(f"{len(closes)} closes {prices['timestamp'][0]} .. {prices['timestamp'][-1]} "
          f"({closes.min():.2f}..{closes.max():.2f})")

    rows = []
    for na in GRID:
        for nb in GRID:
            for nc in GRID:
                radius = spectral_radius(na, nb, nc)
                rows.append({"na": float(na), "nb": float(nb), "nc": float(nc),
                             "spectral_radius": radius, "spectrally_stable": radius < 1.0,
                             **run(closes, float(na), float(nb), float(nc))})
    grid = pl.DataFrame(rows)

    unstable = grid.filter(~pl.col("spectrally_stable")).height
    negative = grid.filter(pl.col("went_negative_unbounded")).height
    stopped = grid.filter(pl.col("left_range_at_bar").is_not_null()).height
    print(f"grid {grid.height} combinations: {unstable} spectrally unstable, "
          f"{negative} would go negative unbounded, {stopped} stopped early under the range bound")
    print(f"emitted values negative anywhere: {grid.filter(pl.col('went_negative_emitted')).height}")

    information = pl.DataFrame([{
        "generated_at": datetime.now(timezone.utc),
        "symbol": SYMBOL, "bars": len(closes), "snapshot": SNAPSHOT,
        "grid_step": 0.05, "grid_size": grid.height,
        "default_na": DEFAULTS[0], "default_nb": DEFAULTS[1], "default_nc": DEFAULTS[2],
        "default_spectral_radius": spectral_radius(*DEFAULTS),
        "range_multiple": RANGE_MULTIPLE,
        "source": "ml_dashboard/scripts/hwma_stability.py",
        "measures": "src/client/src/market/lib/calculators/overlay/averages.ts::calcHWMA",
        "build_seconds": time.time() - started,
    }])

    database = duckdb.connect(str(RESULTS_DATABASE))
    try:
        for name, frame in (("hwma_parameter_grid", grid),
                            ("hwma_price_series", prices),
                            ("hwma_run_information", information)):
            database.register("incoming", frame.to_arrow())
            database.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM incoming")
            database.unregister("incoming")
            print(f"table {name}: {frame.height:,} rows")
        database.execute("CHECKPOINT")
    finally:
        database.close()
    print(f"done in {time.time() - started:.0f}s -> {RESULTS_DATABASE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
