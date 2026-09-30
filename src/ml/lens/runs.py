"""Model Cycle runs read into the lens record (``LensSourceSchema`` ``cycle_run``).

A run directory (``docs/model-cycle-record.md``) keeps its own out-of-sample
record: ``predictions.parquet`` holds one row per test bar the model walked, with
the bar's open/high/low/close/volume as the run traded them (back-adjusted at
contract rolls by ``src/ml/cycle/rolls.py``), P(up), the fold, and — once the
horizon resolved — the actual direction and whether the call was right.
``config.json`` holds the run plan (label horizon, cost model, trading rule) and
``scoreboard.json`` the run's final numbers.

So the lens reproduces the run from the run's own record: no lake read, no
reconstruction. What the lens can and cannot reproduce:

- the direction scoreboard (accuracy, area under the curve, Brier score) is the
  same arithmetic over the same bars, so it must match the run exactly;
- the trade scoreboard (trade count, net profit) comes from a different rule.
  The run decides at a bar's close and fills at the next bar's open, holding
  and flipping per its plan; the lens replays one fixed rule over every model
  (enter at the close of a bar whose P(up) clears the threshold, exit at the
  close H rows later, one trade at a time). The manifest carries the run's own
  trade numbers in its notes and leaves ``reference.tradeCount`` /
  ``cumulativeNetUsd`` empty rather than fail a comparison between two rules.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from lens.adapters import Record, Refusal, check, file_record

#: Columns every Model Cycle predictions.parquet has carried since 2026-09-25.
REQUIRED_COLUMNS = frozenset(
    {
        "timestamp",
        "fold_index",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "probability_up",
        "actual_direction",
        "correct",
    }
)


def _read_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def is_cycle_run(model_dir: Path) -> bool:
    """A Model Cycle run directory: predictions.parquet beside a config.json run record.

    A run that failed before it walked a test bar is still a cycle run, and is
    refused by ``refuse_unreadable_run`` (and ``load_cycle_run``) with the run's
    own error.
    """
    if not ((model_dir / "predictions.parquet").exists() and (model_dir / "config.json").exists()):
        return False
    config = _read_json(model_dir / "config.json")
    return isinstance(config, dict) and "plan" in config


def refuse_unreadable_run(model_dir: Path) -> None:
    """Refuse, from cheap reads only, a run that has no plan or walked no test bar.

    The model list calls this for every directory, so a failed run reads as
    refused with its own error rather than as a lens waiting to be built.
    """
    import polars as pl

    config = _read_json(model_dir / "config.json") or {}
    if not config.get("plan"):
        error = config.get("error") or "no run plan recorded"
        raise Refusal(
            f"this Model Cycle run {config.get('status', 'ended')} before it walked a test bar: {error}"
        )
    row_count = int(
        pl.scan_parquet(model_dir / "predictions.parquet").select(pl.len()).collect().item()
    )
    if row_count == 0:
        raise Refusal(
            f"this Model Cycle run ({config.get('status', 'status not recorded')}) walked no test bar: "
            f"{config.get('error') or 'predictions.parquet is empty'}"
        )


def _adjustment_words(adjustment) -> str:
    """How the run adjusted its prices at contract rolls, in words."""
    import datetime

    if not isinstance(adjustment, dict):
        return "as recorded (the plan names no roll adjustment)"
    rolls = adjustment.get("rolls") or []
    method = str(adjustment.get("method") or "not named").replace("_", " ")
    if not rolls:
        return f"with no contract roll inside the loaded window (adjustment method {method})"
    described = ", ".join(
        f"{roll.get('fromContract')} to {roll.get('toContract')} on "
        f"{datetime.datetime.fromtimestamp(int(roll['timestamp']), datetime.UTC):%Y-%m-%d} "
        f"({float(roll.get('gapPoints', 0.0)):+.2f} points)"
        for roll in rolls
        if "timestamp" in roll
    )
    return f"back-adjusted by the {method} method at {len(rolls)} contract roll(s) (src/ml/cycle/rolls.py): {described}"


def _trading_rule_words(plan: dict) -> str:
    trading = plan.get("trading") or {}
    holding = trading.get("holdingBars")
    long_only = bool(trading.get("longOnly"))
    entry = trading.get("entryProbability")
    if entry is not None:
        side = (
            f"long when P(up) >= {float(entry):.2f}"
            if long_only
            else f"long when P(up) >= {float(entry):.2f}, short when P(up) <= {1 - float(entry):.2f}"
        )
    else:
        side = (
            "long at P(up) >= 0.50 and flat below"
            if long_only
            else "long at P(up) >= 0.50 and short below, on every prediction"
        )
    parts = [
        f"{side}, decided at a bar's close and filled at the next bar's open",
        f"a {holding}-bar holding period that renews while the call holds" if holding else None,
        "an opposite call reverses at the next open",
    ]
    stop = float(trading.get("stopLossTicks") or 0.0)
    target = float(trading.get("takeProfitTicks") or 0.0)
    if stop > 0 or target > 0:
        parts.append(
            f"stop loss {stop:g} ticks and take profit {target:g} ticks checked inside each bar"
        )
    return "; ".join(part for part in parts if part)


def load_cycle_run(model_dir: Path, model_id: str) -> Record:
    import polars as pl

    config = _read_json(model_dir / "config.json") or {}
    plan = config.get("plan")
    if not plan:
        error = config.get("error") or "no run plan recorded"
        raise Refusal(
            f"this Model Cycle run {config.get('status', 'ended')} before it walked a test bar: {error}"
        )

    predictions_path = model_dir / "predictions.parquet"
    frame = pl.read_parquet(predictions_path)
    missing = sorted(REQUIRED_COLUMNS - set(frame.columns))
    if missing:
        raise Refusal(f"predictions.parquet lacks the Model Cycle columns {missing}")
    if frame.height == 0:
        raise Refusal(
            f"this Model Cycle run ({config.get('status', 'status not recorded')}) walked no test bar: "
            f"{config.get('error') or 'predictions.parquet is empty'}"
        )

    horizon = int(plan.get("labelHorizonBars") or 0)
    if horizon < 1:
        raise Refusal(
            "config.json plan.labelHorizonBars is missing, so the label horizon is unknown"
        )

    timestamps = frame["timestamp"].to_numpy().astype(np.int64)
    fold = frame["fold_index"].to_numpy().astype(np.int64)
    open_ = frame["open"].to_numpy().astype(np.float64)
    high = frame["high"].to_numpy().astype(np.float64)
    low = frame["low"].to_numpy().astype(np.float64)
    close = frame["close"].to_numpy().astype(np.float64)
    volume = frame["volume"].to_numpy().astype(np.float64)
    probability = frame["probability_up"].cast(pl.Float64).fill_null(float("nan")).to_numpy()
    actual = frame["actual_direction"].cast(pl.Float64).fill_null(float("nan")).to_numpy()
    correct = frame["correct"].cast(pl.Float64).fill_null(float("nan")).to_numpy()
    crosses_gap = (
        frame["crosses_gap"].fill_null(False).to_numpy().astype(bool)
        if "crosses_gap" in frame.columns
        else np.zeros(frame.height, dtype=bool)
    )
    n = int(timestamps.size)

    # The run scores a bar only when its horizon resolved inside the same fold,
    # did not cross a session gap and moved past the label threshold, and the
    # model made a call there — `correct` is null otherwise. The lens labels
    # exactly those bars, so its scoreboard is over the run's own scored set.
    scored = np.isfinite(correct) & np.isfinite(probability) & np.isin(actual, (-1.0, 1.0))
    label = np.full(n, np.nan)
    label[scored] = np.where(actual[scored] > 0, 1.0, 0.0)

    # Realized return over the horizon in the run's own row order, only where
    # the run itself could resolve it: inside one fold and not across a gap.
    realized = np.full(n, np.nan)
    if n > horizon:
        same_fold = fold[horizon:] == fold[: n - horizon]
        resolvable = same_fold & ~crosses_gap[: n - horizon]
        forward = np.log(close[horizon:] / close[: n - horizon]) * 10_000.0
        realized[: n - horizon] = np.where(resolvable, forward, np.nan)

    cost_model = plan.get("costModel") or {}
    point_value = float(cost_model.get("pointValueUsd") or 0.0)
    round_trip_usd = cost_model.get("roundTripCostUsd")
    if point_value <= 0 or round_trip_usd is None:
        raise Refusal("config.json plan.costModel carries no point value or round-trip cost")
    contracts = int((plan.get("trading") or {}).get("contracts") or 1)
    cost = {
        "roundTripPoints": float(round_trip_usd) / point_value,
        "pointValueUsd": point_value,
        "tickSize": float(cost_model.get("tickSize") or 0.0),
        "source": (
            f"config.json plan.costModel, the run's own copy of {cost_model.get('source', 'the cost model')} "
            f"({float(round_trip_usd):.2f} US dollars per round trip per contract)"
        ),
    }

    trading = plan.get("trading") or {}
    entry_probability = trading.get("entryProbability")
    default_threshold = float(entry_probability) if entry_probability is not None else 0.5
    default_threshold = min(0.95, max(0.5, default_threshold))

    scoreboard = _read_json(model_dir / "scoreboard.json") or {}
    metrics = scoreboard.get("metrics") or {}

    def metric(name: str):
        value = metrics.get(name)
        return float(value) if isinstance(value, (int, float)) and np.isfinite(value) else None

    reference = {
        "tradeCount": None,
        "cumulativeNetUsd": None,
        "longCount": None,
        "shortCount": None,
        "hitRateAtHalf": metric("accuracy"),
        "areaUnderCurve": metric("roc_auc"),
    }

    trades_path = model_dir / "trades.parquet"
    trades = pl.read_parquet(trades_path) if trades_path.exists() else None
    run_trade_count = metric("trade_count")
    run_net = metric("net_profit_usd")

    symbol = str(plan.get("symbol") or "MNQ")
    timeframe = str(plan.get("timeframe") or "5m")
    threshold_ticks = float(plan.get("labelThresholdTicks") or 0.0)
    fold_count = int(np.unique(fold).size)
    diagnostics = _read_json(model_dir / "diagnostics.json") or {}

    notes = [
        f"Read from the Model Cycle run's own record: {n:,} test bars across {fold_count} walk-forward "
        f"fold{'s' if fold_count != 1 else ''}, laid end to end in the order the model walked them. Prices are "
        f"the ones the run traded, {_adjustment_words(plan.get('priceAdjustment'))}.",
        f"A bar is labelled only where the run scored it: its {horizon}-bar horizon resolved inside the same "
        "fold, did not cross a session gap, moved past the label threshold, and the model made a call. "
        f"{int(scored.sum()):,} of {n:,} bars qualify"
        + (
            f" (the run's scoreboard counts {int(scoreboard['barsScored']):,})."
            if scoreboard.get("barsScored") is not None
            else "."
        ),
        "Trades here follow the lens rule, not the run's: enter at the close of a bar whose P(up) clears the "
        f"threshold (short when it is at or below one minus it), exit at the close {horizon} rows later, one "
        f"trade at a time, charged {cost['roundTripPoints']:.2f} points per round trip. The run's own rule was: "
        f"{_trading_rule_words(plan)}. So the lens trade count and net profit are the lens rule's own; the "
        "direction scoreboard (hit rate, area under the curve, Brier score) is the run's and must match it.",
    ]
    if run_trade_count is not None and run_net is not None:
        notes.append(
            f"Under its own rule the run closed {int(run_trade_count):,} trades for "
            f"{'-' if run_net < 0 else ''}${abs(run_net):,.2f} net (scoreboard.json; every trade in trades.parquet "
            "and on the Model Cycle page)."
        )
    if not scoreboard:
        notes.append(
            "scoreboard.json is empty for this run, so there is no run scoreboard to compare against."
        )
    if diagnostics.get("stopped"):
        notes.append("The run was stopped before it finished; the record holds the bars it walked.")
    if contracts != 1:
        notes.append(f"The run traded {contracts} contracts; the lens prices one.")

    verification = [
        check(
            "timestamps_strictly_increasing",
            bool(np.all(np.diff(timestamps) > 0)),
            f"{n:,} rows, {int((np.diff(timestamps) <= 0).sum())} non-increasing steps",
            "strictly increasing across every fold",
        ),
    ]
    if scoreboard.get("barsScored") is not None:
        verification.append(
            check(
                "lens_labels_are_the_runs_scored_bars",
                int(scored.sum()) == int(scoreboard["barsScored"]),
                f"{int(scored.sum()):,} labelled bars",
                f"exactly {int(scoreboard['barsScored']):,} (scoreboard.json barsScored)",
            )
        )
    # The lens counts a hit as (P(up) >= 0.5) == (label == 1), computed on the
    # float32 probability it stores; the run recorded `correct` per bar.
    stored_probability = probability.astype(np.float32).astype(np.float64)
    lens_hit = (stored_probability[scored] >= 0.5) == (label[scored] == 1.0)
    disagreements = int(np.sum(lens_hit != (correct[scored] > 0.5)))
    verification.append(
        check(
            "lens_direction_call_matches_the_run_on_every_scored_bar",
            disagreements == 0,
            f"{disagreements} of {int(scored.sum()):,} scored bars disagree",
            "0 — the lens reads P(up) >= 0.5 as an up call, as the run did",
        )
    )
    brier_run = metric("brier_score")
    if brier_run is not None and scored.any():
        brier_lens = float(np.mean((stored_probability[scored] - label[scored]) ** 2))
        verification.append(
            check(
                "brier_score_matches_the_run",
                abs(brier_lens - brier_run) <= 1e-6,
                f"difference {abs(brier_lens - brier_run):.2e} (lens {brier_lens:.6f})",
                f"within 1e-6 of {brier_run:.6f} (scoreboard.json brier_score)",
            )
        )
    if trades is not None and run_trade_count is not None and run_net is not None:
        ledger_net = float(trades["net_profit_usd"].sum()) if trades.height else 0.0
        verification.append(
            check(
                "run_trade_ledger_matches_its_scoreboard",
                trades.height == int(run_trade_count) and abs(ledger_net - run_net) <= 0.01,
                f"trades.parquet: {trades.height} trades, {ledger_net:.2f} US dollars net",
                f"{int(run_trade_count)} trades, {run_net:.2f} US dollars (scoreboard.json)",
            )
        )
    tick = cost["tickSize"]
    if tick > 0:
        off_grid = float(np.nanmax(np.abs(close / tick - np.round(close / tick)) * tick))
        verification.append(
            check(
                "prices_land_on_the_instrument_tick_grid",
                off_grid < tick / 100.0,
                f"furthest close from a {tick} point tick: {off_grid:.2e} points",
                f"< {tick / 100.0:.2e} points",
            )
        )
    well_formed = (
        (high >= low) & (high >= open_) & (high >= close) & (low <= open_) & (low <= close)
    )
    verification.append(
        check(
            "price_bars_well_formed",
            bool(np.all(well_formed)),
            f"{int(np.sum(~well_formed))} bars violate high/low bounds",
            "high >= max(open, close) and low <= min(open, close) on every bar",
        )
    )

    source_files = [file_record(predictions_path), file_record(model_dir / "config.json")]
    for name in ("scoreboard.json", "trades.parquet"):
        if (model_dir / name).exists():
            source_files.append(file_record(model_dir / name))

    record = Record(
        model_id=model_id,
        source_schema="cycle_run",
        symbol=symbol,
        timeframe=timeframe,
        horizon_bars=horizon,
        horizon_source="config.json plan.labelHorizonBars",
        label_definition=(
            f"the run's actual direction over the next {horizon} bars (src/ml/cycle/labels.py actual_direction): "
            f"1 when close[t+{horizon}] - close[t] is above {threshold_ticks:g} ticks, 0 when below minus that; "
            "a bar inside the threshold, whose horizon crosses a session gap or the fold end, or where the "
            "model made no call is unlabelled"
        ),
        default_threshold=default_threshold,
        timestamp_seconds=timestamps,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
        probability_up=probability,
        label=label,
        realized_return_basis_points=realized,
        reference=reference,
        notes=notes,
        verification=verification,
        source_files=source_files,
        cost=cost,
    )
    record.attribution_reason = (
        "the Model Cycle record keeps the explainer's inputs (explain/), not per-bar attributions; the "
        "Inside view on the Model Cycle page computes them"
    )
    return record
