"""Model Cycle entry point — one process that loads bars from the lake, optionally
tunes, then per walk-forward fold trains, validates and walks the test bars one
at a time, trading and scoring them while the dashboard chart follows.

Spawned by ``pythonRunner.ts`` (cwd = the repository root):

    python packages/ml-engine/src/cycle/main.py --model-family xgboost --symbol MNQ --timeframe 5m \\
        --model-id <id> --json [--max-bars N] [--date-start ...] [--date-end ...] \\
        [--train-days 60 --test-days 10 ... --boosting-rounds 400 ...]

``--model-family`` takes any key of the model registry
(``packages/config/cycle_models/``, read by ``catalog.py``); a key the registry marks
not runnable fails with its ``unavailableReason``. Every flag of
``docs/plans/2026-09-25-model-cycle.md`` is accepted: the cycle-wide groups and
one flag per model parameter name in the registry, typed as the registry
declares it (only the selected model's keys reach its adapter; flags of other
models are logged at warn). Legacy families resolve their parameters through
``models.resolve_parameters`` exactly as before, every other model through
``catalog.resolve_parameters``. Unknown flags are logged at warn and ignored.
Control arrives on stdin (``control.py``); events leave on stdout.

Test hook: ``CYCLE_ADAPTER_FACTORY=<module>:<callable>`` replaces
``models.build_adapter`` (same signature, including ``task=``) — for runs
without the real families.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_ML_ROOT = Path(__file__).resolve().parents[1]
if str(_ML_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_ROOT))

# The registry reader imports only the standard library, so it can run before
# numpy: it decides whether torch has to be imported first.
from cycle import catalog  # noqa: E402


def _argument_value(flag: str) -> str | None:
    argv = sys.argv[1:]
    for position, item in enumerate(argv):
        if item == flag and position + 1 < len(argv):
            return argv[position + 1]
        if item.startswith(flag + "="):
            return item.split("=", 1)[1]
    return None


def torch_goes_first(model_key: str | None, device: str | None) -> bool:
    """Windows + torch cu130: import torch BEFORE numpy or CUDA initialisation
    can deadlock. True when the run can touch CUDA: the model is built on torch
    (the registry's ``implementation``), or the device is not forced to cpu.
    The import costs a couple of seconds, so a tabular model on cpu skips it."""
    try:
        if catalog.uses_torch(model_key):
            return True
    except Exception:  # noqa: BLE001 - a broken registry is reported by run(); decide on the device alone
        pass
    return (device or "auto") != "cpu"


try:
    if torch_goes_first(_argument_value("--model-family"), _argument_value("--device")):
        import torch  # noqa: F401
except Exception:  # noqa: BLE001 - torch is optional for tabular families
    pass

import argparse  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402
import traceback  # noqa: E402

# The repository root goes LAST: numba's on-disk cache for shared.features'
# parallel kernels may have been written by a process that imported the module
# as ``src.ml.shared.features`` (xgb_classifier does), and loading that cache
# re-imports the module by that name. Without the root on the path the load
# fails and the shared engine silently drops the rolling-window features.
_PROJECT_ROOT = _ML_ROOT.parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.append(str(_PROJECT_ROOT))

from cycle.adapter import MODEL_FAMILIES, MODEL_LABELS  # noqa: E402
from shared import protocol  # noqa: E402

# ── the plan's flag tables ─────────────────────────────────────────────────

# (key, type, default, help)
CYCLE_FLAGS: tuple[tuple[str, type, object, str], ...] = (
    ("train_days", int, 60, "calendar days in each training window"),
    ("validation_fraction", float, 0.2, "last fraction of the training window used for validation"),
    ("test_days", int, 10, "calendar days in each test window"),
    ("step_days", int, 0, "days between test windows (0 = test_days; must be >= test_days)"),
    ("fold_limit", int, 3, "0 = all folds, else the most recent N"),
    ("expanding_window", bool, False, "anchor every training window at the first bar"),
    ("label_horizon_bars", int, 6, "bars ahead the direction label looks"),
    ("label_threshold_ticks", float, 0.0, "moves within this many ticks are unlabelled"),
    ("embargo_bars", int, 0, "bars dropped from the start of each test window"),
    ("label_gap_multiple", float, 3.0, "a bar whose horizon crosses a gap over this many typical bar intervals gets no label (0 = off)"),
    ("long_only", bool, False, "never go short"),
    ("holding_bars", int, 0, "bars to hold a position (0 = label horizon)"),
    ("stop_loss_ticks", float, 0.0, "stop loss in ticks from entry (0 = off)"),
    ("take_profit_ticks", float, 0.0, "take profit in ticks from entry (0 = off)"),
    ("contracts", int, 1, "contracts per trade"),
    ("tuning_mode", str, "tuned", "tuned (Optuna inside every fold) | reviewed_defaults"),
    ("tuning_budget_trials", int, 20, "Optuna trials per fold"),
    ("tuning_budget_seconds", int, 0, "time budget per fold in seconds (0 = trials only)"),
    ("tuning_objective", str, "sharpe_ratio", "sharpe_ratio | log_loss | f1_score"),
    ("tuning_folds", int, 2, "inner validation blocks per tuning trial"),
    ("tuning_pinned_parameters", str, "", "comma-separated parameter names held out of the search"),
    ("tuning_trials", int, 0, "legacy: an explicit trial count per fold (overrides the budget)"),
    ("bars_per_second", float, 40.0, "test-walk replay speed (0 = as fast as possible)"),
    ("start_paused", bool, False, "start paused"),
    ("quiet_bars", bool, False, "suppress per-bar log lines"),
    ("log_every_batches", int, 10, "log a training line every N batches"),
    ("device", str, "auto", "auto | cuda | cpu"),
    ("seed", int, 42, "random seed"),
)

IGNORED_FLAGS = ("feature_categories", "include_indicators", "indicator_groups", "all_features", "label_set_parquet")


def _flag(key: str) -> str:
    return "--" + key.replace("_", "-")


# How a registry parameter type becomes an argparse flag. A bool is
# `--name` / `--no-name` (BooleanOptionalAction); a categorical value arrives as
# text and `catalog.coerce` matches it to its choice (numeric choices included).
_FLAG_TYPES: dict[str, type] = {"int": int, "float": float, "categorical": str, "string": str}


def model_flag_types() -> dict[str, str]:
    """Every model parameter name in the registry and its one declared type:
    one flag each, shared by every model that has the parameter."""
    return catalog.parameter_types()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Model Cycle: tune, train, validate and walk test bars one at a time.")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--max-bars", type=int, default=0)
    parser.add_argument("--date-start", default=None)
    parser.add_argument("--date-end", default=None)
    parser.add_argument("--model-family", required=True, choices=MODEL_FAMILIES,
                        help="a model registry key (packages/config/cycle_models/)")
    cycle = parser.add_argument_group("cycle")
    for key, kind, default, help_text in CYCLE_FLAGS:
        if kind is bool:
            cycle.add_argument(_flag(key), dest=key, action="store_true", default=default, help=help_text)
        else:
            cycle.add_argument(_flag(key), dest=key, type=kind, default=default, help=help_text)
    model = parser.add_argument_group("model (defaults and bounds come from the model's registry entry)")
    for key, kind in model_flag_types().items():
        if kind == "bool":
            model.add_argument(_flag(key), dest=f"model__{key}", action=argparse.BooleanOptionalAction, default=None)
        else:
            model.add_argument(_flag(key), dest=f"model__{key}", type=_FLAG_TYPES[kind], default=None)
    ignored = parser.add_argument_group("accepted and ignored")
    for key in IGNORED_FLAGS:
        if key in ("include_indicators", "all_features"):
            ignored.add_argument(_flag(key), dest=f"ignored__{key}", action="store_true", default=False)
        else:
            ignored.add_argument(_flag(key), dest=f"ignored__{key}", default=None)
    return parser


def require_runnable(key: str) -> dict:
    """The key's registry entry, or ValueError with its unavailableReason."""
    entry = catalog.entry(key)
    if not entry["runnable"]:
        raise ValueError(f"{entry['displayName']} ({key}) cannot run in the Model Cycle yet: {entry['unavailableReason']}")
    return entry


def model_parameters(args: argparse.Namespace, family: str) -> dict:
    """The model's resolved parameters: the flags given for its own parameter
    names, the rest from its defaults. Legacy families through
    `models.resolve_parameters` (unchanged rules), every other model through
    `catalog.resolve_parameters` (the registry's types, bounds and choices)."""
    given = {
        key: getattr(args, f"model__{key}")
        for key in model_flag_types() if getattr(args, f"model__{key}", None) is not None
    }
    if catalog.is_legacy(family):
        from cycle import models

        return models.resolve_parameters(family, given)
    return catalog.resolve_parameters(family, given)


def flags_for_other_models(args: argparse.Namespace, family: str) -> list[str]:
    """Model flags that were given but are not parameters of `family`."""
    own = catalog.entry(family)["parameters"]
    return [
        _flag(key) for key in model_flag_types()
        if key not in own and getattr(args, f"model__{key}", None) is not None
    ]


def normalise_date(value: str | None) -> str | None:
    """The loader accepts YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS; trim anything finer."""
    if not value:
        return None
    text = value.strip().replace(" ", "T")
    match = re.match(r"^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2})?", text)
    if not match:
        raise ValueError(f"unreadable date {value!r}; use YYYY-MM-DD")
    return match.group(1) + (match.group(2) or "")


def resolve_device(requested: str) -> tuple[str, str | None]:
    requested = (requested or "auto").lower()
    if requested not in ("auto", "cuda", "cpu"):
        raise ValueError(f"device must be auto, cuda or cpu, got {requested!r}")
    if requested == "cpu":
        return "cpu", None
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda", torch.cuda.get_device_name(0)
    except Exception:  # noqa: BLE001
        pass
    if requested == "cuda":
        raise RuntimeError("--device cuda was requested but CUDA is not available")
    return "cpu", None


def _factory_hook():
    spec = os.environ.get("CYCLE_ADAPTER_FACTORY")
    if not spec:
        return None
    import importlib

    module_name, _, attribute = spec.partition(":")
    return getattr(importlib.import_module(module_name), attribute)


def adjust_for_rolls(symbol: str, timeframe: str, data):
    """Back-adjust a stitched futures root at its contract rolls (see
    `cycle.rolls`). Returns the (possibly adjusted) data and the rolls found."""
    from cycle.engine import MarketData, format_time
    from cycle.rolls import back_adjust, contract_rows_from_lake, find_rolls
    from shared.data import _serving

    try:
        rows = contract_rows_from_lake(_serving(), symbol, timeframe, int(data.timestamps[0]), int(data.timestamps[-1]))
    except Exception as error:  # noqa: BLE001 - a stitched root traded across an unfound roll books the splice as a move
        raise RuntimeError(
            f"could not read {symbol}'s contracts to find its rolls ({type(error).__name__}: {error}); a stitched futures "
            "root is not run unadjusted, because a contract roll would be booked as a price move"
        ) from error
    if not rows:
        return data, []  # not a stitched futures root (a single contract, forex, or no pre-aggregated view)
    rolls = find_rolls(data.timestamps, data.open, data.close, rows)
    if not rolls:
        protocol.emit_log("[data] no contract roll inside the window: prices are as traded")
        return data, []
    open_prices, high, low, close, _ = back_adjust(data.open, data.high, data.low, data.close, rolls)
    for roll in rolls:
        how = "both contracts' closes on the same bar" if roll.exact else "new open minus old close (no common bar)"
        protocol.emit_log(
            f"[data] roll {roll.from_contract} -> {roll.to_contract} at {format_time(roll.timestamp)}: "
            f"splice step {roll.gap_points:+.2f} points ({how})"
        )
    protocol.emit_log(
        f"[data] prices back-adjusted additively at {len(rolls)} roll(s) so a roll is not a price move; "
        f"{rolls[-1].to_contract} bars are as traded, earlier bars are shifted by the steps above"
    )
    adjusted = MarketData(timestamps=data.timestamps, open=open_prices, high=high, low=low, close=close, volume=data.volume)
    return adjusted, rolls


def run(args: argparse.Namespace, unknown: list[str]) -> int:
    from cycle.control import ControlState, start_reader
    from cycle.engine import CycleEngine, CycleSettings, clean_market_data
    from cycle.features import MarketContext, build_features, require_finbert
    from cycle.simulate import load_cost_model
    from shared.sentiment import infer_clock

    started = time.monotonic()
    family = args.model_family
    require_runnable(family)
    # `+` is allowed: the server names runs after the runner key, e.g.
    # MNQ_5m_xgboost+walk_forward_cycle_20260925T103846, and looks for
    # diagnostics.json under exactly that directory name.
    if not re.match(r"^[A-Za-z0-9_.+\-]+$", args.model_id) or ".." in args.model_id:
        raise ValueError(f"model id {args.model_id!r} is not a safe directory name")
    protocol.emit_cycle_cursor(
        "loading", fold_count=0, bars_per_second=args.bars_per_second, paused=bool(args.start_paused)
    )
    protocol.emit_log(f"[data] Model Cycle: {MODEL_LABELS[family]} on {args.symbol} {args.timeframe}, run {args.model_id}")
    if unknown:
        protocol.emit_log(f"[data] ignoring unknown arguments: {' '.join(unknown)}", "warn")
    for key in IGNORED_FLAGS:
        value = getattr(args, f"ignored__{key}")
        if value:
            protocol.emit_log(f"[features] {_flag(key)} is accepted and ignored: the cycle builds its own causal features", "warn")
    parameters = model_parameters(args, family)
    given_parameters = tuple(
        key for key in catalog.entry(family)["parameters"] if getattr(args, f"model__{key}", None) is not None
    )
    other_family_flags = flags_for_other_models(args, family)
    if other_family_flags:
        protocol.emit_log(f"[plan] ignoring flags that belong to other models: {' '.join(other_family_flags)}", "warn")

    device, device_name = resolve_device(args.device)
    protocol.emit_log(f"[device] {device}" + (f" — {device_name}" if device_name else "") + f" (requested {args.device})")

    control = ControlState(args.bars_per_second, args.start_paused)
    start_reader(control, sys.stdin)

    from shared.data import load_ohlcv_arrays

    date_range = {}
    start, end = normalise_date(args.date_start), normalise_date(args.date_end)
    if start:
        date_range["start"] = start
    if end:
        date_range["end"] = end
    raw = load_ohlcv_arrays(args.symbol, args.timeframe, max_bars=int(args.max_bars or 0), date_range=date_range or None)
    data, dropped = clean_market_data(raw)
    if dropped:
        protocol.emit_log(f"[data] dropped {dropped} bars with duplicate or out-of-order timestamps", "warn")
    if len(data) < 2:
        raise ValueError(f"only {len(data)} bars loaded for {args.symbol} {args.timeframe}")
    protocol.emit_log(f"[data] {len(data):,} bars, strictly increasing timestamps (epoch seconds, UTC)")
    data, rolls = adjust_for_rolls(args.symbol, args.timeframe, data)

    feature_started = time.monotonic()
    context = MarketContext(symbol=args.symbol, timeframe=args.timeframe, timestamps=data.timestamps,
                            clock=raw.get("clock") or infer_clock(args.symbol))
    feature_set = build_features(data.as_dict(), context=context)
    require_finbert(feature_set)
    protocol.emit_log(
        f"[features] FinBERT news sentiment: {sum(1 for n in feature_set.names if n.startswith('finbert_'))} columns "
        f"(bars stamped {context.clock}; coverage on "
        f"{float(feature_set.raw[:, feature_set.names.index('finbert_news_coverage_flag')].mean()) * 100:.1f}% of bars)"
    )
    protocol.emit_log(
        f"[features] {len(feature_set.names)} causal features, rolling z-score window {feature_set.lookback} "
        f"clipped to {feature_set.clip[0]:g}..{feature_set.clip[1]:g} ({time.monotonic() - feature_started:.1f} s)"
    )
    for name, reason in feature_set.dropped.items():
        protocol.emit_log(f"[features] dropped {name}: {reason}", "warn" if "looks ahead" in reason else "info")
    if not feature_set.names:
        raise ValueError("no usable features remain")

    cost = load_cost_model(args.symbol)
    hook = _factory_hook()
    if hook is not None:
        build_adapter = hook
        suggest = None
        protocol.emit_log(f"[plan] adapter factory from CYCLE_ADAPTER_FACTORY={os.environ['CYCLE_ADAPTER_FACTORY']}", "warn")
    else:
        from cycle import models

        build_adapter = models.build_adapter
        suggest = models.suggest_parameters

    settings = CycleSettings(
        symbol=args.symbol,
        timeframe=args.timeframe,
        model_id=args.model_id,
        model_family=family,
        model_parameters=parameters,
        artifact_directory=os.path.abspath(os.path.join("data", "models", args.model_id)),
        **{key: getattr(args, key) for key, *_ in CYCLE_FLAGS if key != "device"},
        device=device,
        device_name=device_name,
        given_parameters=given_parameters,
    )
    engine = CycleEngine(
        settings, data, feature_set, cost,
        # task "classification" = the direction classifier, "regression" = the fold's price model
        adapter_factory=lambda parameters, task="classification": build_adapter(family, parameters, device, args.seed,
                                                                                task=task),
        control=control,
        suggest_parameters=(lambda trial, base, pinned=(): suggest(trial, family, base, pinned)) if suggest else None,
    )
    engine.started = started
    engine.price_adjustment = {
        "method": "panama_additive" if rolls else "none",
        "rolls": [roll.as_plan() for roll in rolls],
    }
    engine.run()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args, unknown = parser.parse_known_args(argv)
    try:
        return run(args, unknown)
    except Exception as error:  # noqa: BLE001 - every failure is reported as an event
        try:
            protocol.emit_cycle_cursor("failed", fold_count=0, bars_per_second=getattr(args, "bars_per_second", 0.0))
        except Exception:  # noqa: BLE001
            pass
        protocol.emit_error(f"{type(error).__name__}: {error}", traceback.format_exc())
        return 1


def _leave(exit_code: int) -> None:
    """Exit without unloading native libraries.

    After several cuDNN LSTM models in one process (tuning trials + folds), the
    CUDA/cuDNN DLL-detach routines fast-fail with 0xC0000409 as the process
    exits — AFTER `done` was emitted and every artifact was closed — and the
    runner then records a finished run as failed. Measured 2026-09-25: lstm
    with --tuning-trials 2 on cuda, reproducible; `os._exit` alone still
    crashes because it runs DLL_PROCESS_DETACH. `TerminateProcess` on the
    current process does not. Everything the parent reads is flushed first;
    the pipe keeps it after the process is gone.
    """
    sys.stdout.flush()
    sys.stderr.flush()
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        # Without these, ctypes returns the pseudo-handle -1 as a 32-bit int,
        # TerminateProcess receives an invalid 64-bit handle, fails silently,
        # and the process falls through to the crashing teardown.
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
        kernel32.TerminateProcess.restype = wintypes.BOOL
        kernel32.TerminateProcess(kernel32.GetCurrentProcess(), exit_code)
    os._exit(exit_code)


if __name__ == "__main__":
    _leave(main())
