"""Time every tabular Model Cycle model on real bars: one walk-forward fold's fits.

Read-only. Loads MNQ 5-minute bars from the lake and builds the causal
features exactly as ``src/ml/cycle/main.py`` does (``shared.data.load_ohlcv_arrays``
-> ``engine.clean_market_data`` -> roll back-adjustment -> ``features.build_features``),
plans the folds with the engine's own planner (60 training days, 20 % of them
validation, the label horizon purged between them), and on the most recent fold
fits, per registry key, at its defaults:

- the direction model on the fold's labelled training / validation rows
  (for a direction-from-price key this IS the price model plus its logistic
  curve, so its price column reads "in direction");
- the price model on the fold's price rows (none when the entry's price is null).

It prints one row per key: fit seconds for each model, the rows they were
fitted on, milliseconds for one single-bar prediction (the test walk's call),
and the speed class the registry should carry (fast < 10 s, medium < 60 s,
slow otherwise, direction + price). Nothing is written.

    .venv/Scripts/python.exe scripts/benchmark_cycle_models.py
    .venv/Scripts/python.exe scripts/benchmark_cycle_models.py --keys support_vector_machine \\
        --set support_vector_machine.maximum_training_bars=12000

Neural and legacy keys are skipped unless named with ``--keys``.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for folder in (ROOT / "src" / "ml", ROOT):
    if str(folder) not in sys.path:
        sys.path.insert(0, str(folder))

import numpy as np  # noqa: E402

from cycle import catalog  # noqa: E402
from shared import protocol  # noqa: E402

SPEED_LIMITS = (("fast", 10.0), ("medium", 60.0))
SINGLE_BAR_CALLS = 200


class SilentReporter:
    """A TrainingReporter that records nothing and never pauses."""

    step_unit = None

    def epoch_started(self, epoch, epoch_count):
        pass

    def batch(self, report):
        pass

    def epoch_finished(self, report):
        pass

    def validating(self, epoch, epoch_count):
        pass

    def checkpoint(self):
        pass

    def log(self, message, level="info"):
        pass


def speed_class(seconds: float) -> str:
    for name, limit in SPEED_LIMITS:
        if seconds < limit:
            return name
    return "slow"


def tabular_keys() -> list[str]:
    models = catalog.registry()["models"]
    return [key for key, entry in models.items()
            if entry["adapter"] in ("scikit_learn", "catboost", "statsmodels")
            and not (entry["unavailableReason"] or "").startswith("Needs") and key != "ordinal_regression"]


def load_market(symbol: str, timeframe: str, start: str, end: str):
    """Bars and features exactly as main.py builds them."""
    from cycle.engine import MarketData, clean_market_data
    from cycle.features import build_features
    from cycle.rolls import back_adjust, contract_rows_from_lake, find_rolls
    from shared.data import _serving, load_ohlcv_arrays

    raw = load_ohlcv_arrays(symbol, timeframe, max_bars=0, date_range={"start": start, "end": end})
    data, _ = clean_market_data(raw)
    rows = contract_rows_from_lake(_serving(), symbol, timeframe, int(data.timestamps[0]), int(data.timestamps[-1]))
    rolls = find_rolls(data.timestamps, data.open, data.close, rows) if rows else []
    if rolls:
        open_prices, high, low, close, _ = back_adjust(data.open, data.high, data.low, data.close, rolls)
        data = MarketData(timestamps=data.timestamps, open=open_prices, high=high, low=low, close=close,
                          volume=data.volume)
    return data, build_features(data.as_dict()), len(rolls)


def planned_engine(data, features, symbol: str, train_days: int, validation_fraction: float):
    """A CycleEngine over the loaded bars, only for its fold planner, labels
    and price target (no run)."""
    from cycle import models
    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model

    settings = CycleSettings(
        symbol=symbol, timeframe="5m", model_id="benchmark_cycle_models", model_family="logistic_regression",
        model_parameters={}, artifact_directory=str(ROOT / "data" / "models" / "benchmark_cycle_models_unused"),
        train_days=train_days, validation_fraction=validation_fraction, test_days=2, step_days=0, fold_limit=1,
        expanding_window=False, label_horizon_bars=6, label_threshold_ticks=0.0, embargo_bars=0, long_only=False,
        holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1, tuning_trials=0,
        bars_per_second=0.0, start_paused=False, quiet_bars=True, log_every_batches=1000, device="cpu", seed=42,
        land_in_lake=False,
    )
    engine = CycleEngine(settings, data, features, load_cost_model(symbol),
                         lambda parameters, task="classification": models.build_adapter(
                             "logistic_regression", parameters, "cpu", 42, task=task))
    return engine, engine.plan_folds(1)[-1]


def time_key(key: str, overrides: dict, engine, spec) -> dict:
    from cycle import models
    from cycle.derived import DerivedDirectionAdapter

    entry = catalog.entry(key)
    parameters = catalog.resolve_parameters(key, overrides)
    features, labels, targets = engine.features, engine.labels, engine.price_targets
    timestamps = engine.data.timestamps
    from_price = entry["direction"]["mode"] == "from_price"
    row = {"key": key, "direction_seconds": None, "price_seconds": None, "direction_rows": None, "price_rows": None}

    started = time.perf_counter()
    if from_price:
        direction = DerivedDirectionAdapter(models.build_adapter(key, parameters, "cpu", 42, task="regression"),
                                            price_target=targets, key=key)
        direction.fit(features, labels, spec.train_index, spec.validation_index, timestamps, SilentReporter(),
                      price_target=targets, price_train_index=spec.price_train_index,
                      price_validation_index=spec.price_validation_index)
        row["direction_rows"] = int(spec.price_train_index.size)
    else:
        direction = models.build_adapter(key, parameters, "cpu", 42)
        direction.fit(features, labels, spec.train_index, spec.validation_index, timestamps, SilentReporter())
        row["direction_rows"] = int(np.asarray(getattr(direction, "training_rows", spec.train_index)).size)
    row["direction_seconds"] = time.perf_counter() - started

    if not from_price and entry["price"] is not None:
        price = models.build_adapter(key, parameters, "cpu", 42, task="regression")
        started = time.perf_counter()
        price.fit(features, targets, spec.price_train_index, spec.price_validation_index, timestamps, SilentReporter())
        row["price_seconds"] = time.perf_counter() - started
        row["price_rows"] = int(np.asarray(getattr(price, "training_rows", spec.price_train_index)).size)

    test_rows = spec.test_index[: SINGLE_BAR_CALLS]
    started = time.perf_counter()
    for bar in test_rows:
        direction.predict_probability(features, np.array([bar]))
    row["single_bar_milliseconds"] = 1000.0 * (time.perf_counter() - started) / max(1, test_rows.size)
    total = row["direction_seconds"] + (row["price_seconds"] or 0.0)
    row["total_seconds"] = total
    row["speed"] = speed_class(total)
    row["registry_speed"] = entry["speed"]
    return row


def parse_overrides(items: list[str]) -> dict[str, dict]:
    overrides: dict[str, dict] = {}
    for item in items:
        name, _, value = item.partition("=")
        key, _, parameter = name.partition(".")
        if not (key and parameter and value):
            raise SystemExit(f"--set expects <key>.<parameter>=<value>, got {item!r}")
        overrides.setdefault(key, {})[parameter] = value
    return overrides


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="5m")
    parser.add_argument("--date-start", default="2025-08-15")
    parser.add_argument("--date-end", default="2025-12-30")
    parser.add_argument("--train-days", type=int, default=60)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--keys", nargs="*", help="registry keys (default: every tabular key)")
    parser.add_argument("--set", action="append", default=[], metavar="KEY.PARAMETER=VALUE")
    parser.add_argument("--json", action="store_true", help="print the rows as JSON lines too")
    args = parser.parse_args(argv)

    events: list[dict] = []
    protocol.emit = events.append     # the loaders and the planner log through the wire protocol; keep stdout for the table
    keys = args.keys or tabular_keys()
    overrides = parse_overrides(args.set)

    started = time.perf_counter()
    data, features, roll_count = load_market(args.symbol, args.timeframe, args.date_start, args.date_end)
    engine, spec = planned_engine(data, features, args.symbol, args.train_days, args.validation_fraction)
    ts = data.timestamps

    def day(t):
        return time.strftime("%Y-%m-%d", time.gmtime(int(t)))

    print(f"{args.symbol} {args.timeframe}: {len(data):,} bars {day(ts[0])}..{day(ts[-1])}, {len(features.names)} features, "
          f"{roll_count} roll(s) back-adjusted, loaded in {time.perf_counter() - started:.1f} s")
    print(f"fold: {spec.train_index.size:,} training rows {day(ts[spec.train_index[0]])}..{day(ts[spec.train_index[-1]])}, "
          f"{spec.validation_index.size:,} validation rows, price model {spec.price_train_index.size:,} / "
          f"{spec.price_validation_index.size:,}")
    header = (f"{'key':<36} {'direction s':>11} {'price s':>9} {'total s':>8} {'rows':>7} "
              f"{'1-bar ms':>8}  speed (registry)")
    print(header)
    print("-" * len(header))
    rows = []
    for key in keys:
        try:
            row = time_key(key, overrides.get(key, {}), engine, spec)
        except Exception as error:  # noqa: BLE001 - one failing key must not hide the others
            print(f"{key:<36} FAILED: {type(error).__name__}: {error}")
            continue
        rows.append(row)
        price = "in dir." if catalog.entry(key)["direction"]["mode"] == "from_price" else (
            "none" if row["price_seconds"] is None else f"{row['price_seconds']:.2f}")
        print(f"{key:<36} {row['direction_seconds']:>11.2f} {price:>9} {row['total_seconds']:>8.2f} "
              f"{row['direction_rows']:>7,} {row['single_bar_milliseconds']:>8.2f}  {row['speed']} ({row['registry_speed']})",
              flush=True)
    if args.json:
        for row in rows:
            print(json.dumps(row))
    over = [row["key"] for row in rows if row["total_seconds"] > 60.0]
    print(f"\n{len(rows)} models timed; over 60 s per fold: {', '.join(over) if over else 'none'}")
    return 1 if over else 0


if __name__ == "__main__":
    raise SystemExit(main())
