"""Artifact adapters — a model directory read into one canonical record.

Four shapes exist on disk today (``LensSourceSchema`` in
``src/shared/lens/types.ts``):

``probability_parquet``
    ``oos_predictions.parquet`` with (ts, prob_up, label, realized_return_bp),
    written by the hand-written ``src/ml/xgb_classifier``. It carries no prices,
    and two generations of that trainer wrote it:

    - older runs scored trades H ROWS ahead in this file. The lake's current
      1-minute series does NOT reproduce those runs' realized returns (measured
      2026-09-15: only 2,029 of 2,565 out-of-sample timestamps are present at
      all, and the closes that are present disagree by a median of 6.9 basis
      points), so the prices are recovered from the model's own record; see
      ``reconstruct_close``.
    - since 2026-09-22 the trainer scores trades H BARS ahead on the raw bar
      grid (bars whose label was dropped carry no prediction and are flat), so
      the row chain no longer holds. Those records are rebuilt on the lake's own
      bar grid and accepted only when the lake reproduces every stored realized
      return and one round-trip cost explains every recorded trade; see
      ``_probability_parquet_on_lake_grid``.

``cycle_run``
    A Model Cycle run directory (``predictions.parquet`` + ``config.json``);
    read by ``lens.runs``.

``ohlc_probability_npz``
    ``oos_predictions.npz`` with (timestamps, open, high, low, close, probs,
    labels), written by the cnn-transformer trainer. Prices are real.

``class_confidence_parquet``
    ``oos_predictions.parquet`` with (timestamp, symbol, prediction, confidence)
    and, since 2026-09-15, (probability_up, label) — what every generated
    template writes. Those models are trained from the current lake, so their
    prices are READ from it and the join is verified row by row.

Anything else is refused with a reason a person can act on.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[3]
COST_MODEL_PATH = PROJECT_ROOT / "src" / "config" / "cost_model.json"

#: Bar length per timeframe label, in seconds.
TIMEFRAME_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}


class Refusal(Exception):
    """The directory holds no out-of-sample record this lens can read."""


@dataclass
class Record:
    """One model's out-of-sample record, canonicalised."""

    model_id: str
    source_schema: str
    symbol: str
    timeframe: str
    horizon_bars: int
    horizon_source: str
    label_definition: str
    default_threshold: float
    timestamp_seconds: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    probability_up: np.ndarray
    label: np.ndarray  # float64, NaN where absent
    realized_return_basis_points: np.ndarray
    reference: dict
    notes: list[str] = field(default_factory=list)
    verification: list[dict] = field(default_factory=list)
    source_files: list[dict] = field(default_factory=list)
    #: (feature_names, shap[n, f], values[n, f] or None)
    attribution: tuple[list[str], np.ndarray, np.ndarray | None] | None = None
    attribution_reason: str | None = None
    attribution_method: str | None = None
    #: Price jumps across a break in trading (contract roll or session gap).
    roll_gaps: list[dict] = field(default_factory=list)
    #: The cost the model's own evaluator charged, when it is known and differs
    #: from (or cannot be read from) the current src/config/cost_model.json.
    #: None means the builder reads cost_model.json for the symbol.
    cost: dict | None = None
    #: Record row of each prediction row, when the record holds bars that carry
    #: no prediction (the lake-grid reading). None means row i is prediction i.
    prediction_rows: np.ndarray | None = None

    @property
    def row_count(self) -> int:
        return int(self.timestamp_seconds.size)


def check(name: str, passed: bool, measured: str, expected: str) -> dict:
    return {"name": name, "passed": bool(passed), "measured": measured, "expected": expected}


def file_record(path: Path) -> dict:
    data = path.read_bytes()
    stat = path.stat()
    return {
        "path": str(path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": stat.st_size,
        "modifiedAtIso": _iso(stat.st_mtime),
    }


def _iso(epoch_seconds: float) -> str:
    import datetime

    return datetime.datetime.fromtimestamp(epoch_seconds, datetime.UTC).isoformat()


def load_cost(symbol: str) -> dict:
    cost = json.loads(COST_MODEL_PATH.read_text(encoding="utf-8"))
    entry = cost.get(symbol.upper())
    if entry is None:
        # eval.py falls back to a basis-point slippage for unknown symbols; the
        # lens states the absence rather than inventing a contract size.
        return {
            "roundTripPoints": 0.0,
            "pointValueUsd": 1.0,
            "tickSize": 0.0,
            "source": f"src/config/cost_model.json has no {symbol.upper()} entry — costs shown as zero",
        }
    return {
        "roundTripPoints": float(
            entry.get("total_round_trip_points", entry.get("total_round_trip", 0.0))
        ),
        "pointValueUsd": float(entry.get("point_value", 1.0)),
        "tickSize": float(entry.get("tick_size", 0.0)),
        "source": f"src/config/cost_model.json {symbol.upper()}",
    }


# ─── Trade replay (mirrors src/ml/xgb_classifier/eval.py simulate_pnl) ────────


def entry_rows(
    probability_up: np.ndarray, threshold: float, horizon_bars: int
) -> list[tuple[int, int]]:
    """Rows where a trade opens, as (row, direction), under the non-overlap rule."""
    out: list[tuple[int, int]] = []
    last_exit = -1
    for i in range(probability_up.size - horizon_bars):
        if i < last_exit:
            continue
        p = probability_up[i]
        if p >= threshold:
            direction = 1
        elif p <= 1.0 - threshold:
            direction = -1
        else:
            continue
        out.append((i, direction))
        last_exit = i + horizon_bars
    return out


def reconstruct_close(
    realized_return_basis_points: np.ndarray,
    probability_up: np.ndarray,
    horizon_bars: int,
    threshold: float,
    trade_net_dollars: list[float],
    cost: dict,
) -> tuple[np.ndarray, list[dict]]:
    """Recover the close series the model's evaluator scored on.

    Two facts pin it. Each realized return fixes a ratio ``H`` rows apart:
    ``close[i + H] = close[i] * exp(r_i / 10000)``, which chains every row into
    one of ``H`` independent sequences (row index modulo ``H``), each with one
    unknown scale. Each executed trade fixes an absolute level at its entry:
    ``net = (close_out - close_in) * direction * point_value - cost``, and with
    ``close_out = close_in * exp(r_in / 10000)`` that solves for ``close_in``.
    Every sequence is anchored by the trades that fall in it, and the spread of
    the anchors within a sequence is the error estimate reported back.
    """
    n = realized_return_basis_points.size
    ratio = np.exp(np.asarray(realized_return_basis_points, dtype=np.float64) / 10_000.0)
    trades = entry_rows(probability_up, threshold, horizon_bars)
    if len(trades) != len(trade_net_dollars):
        raise Refusal(
            f"replayed {len(trades)} trades but the model's diagnostics record "
            f"{len(trade_net_dollars)} — the trade rule in this lens does not match the one that produced them"
        )

    point_value = cost["pointValueUsd"]
    cost_dollars = cost["roundTripPoints"] * point_value

    # close[i] = scale[i % H] * cumulative_ratio[i]
    cumulative = np.full(n, np.nan, dtype=np.float64)
    for residue in range(horizon_bars):
        idx = np.arange(residue, n, horizon_bars)
        running = 1.0
        for position, row in enumerate(idx):
            cumulative[row] = running
            step = ratio[row]
            running = running * step if np.isfinite(step) else np.nan

    anchors: dict[int, list[float]] = {}
    for (row, direction), net in zip(trades, trade_net_dollars):
        step = ratio[row]
        if not np.isfinite(step) or step == 1.0:
            continue
        move_points = (net + cost_dollars) / point_value  # (close_out - close_in) * direction
        close_in = move_points / (direction * (step - 1.0))
        base = close_in / cumulative[row]
        anchors.setdefault(row % horizon_bars, []).append(base)

    missing = [r for r in range(horizon_bars) if r not in anchors]
    if missing:
        raise Refusal(
            f"no executed trade anchors row sequences {missing} — the price level "
            f"of those rows cannot be recovered from this model's artifacts"
        )

    scale = np.array([float(np.median(anchors[r])) for r in range(horizon_bars)])
    spread = max(
        (float(np.max(v) - np.min(v)) * scale[r] / float(np.median(v)) if len(v) > 1 else 0.0)
        for r, v in anchors.items()
    )
    close = cumulative * scale[np.arange(n) % horizon_bars]

    replay_error = 0.0
    for (row, direction), net in zip(trades, trade_net_dollars):
        exit_row = row + horizon_bars
        replayed = (close[exit_row] - close[row]) * direction * point_value - cost_dollars
        replay_error = max(replay_error, abs(replayed - net))

    # The ratio check below is an algebraic identity — close was BUILT from these
    # returns, so it passes even on shuffled garbage. The tick-grid test is the
    # one that uses information the solve never consumed: MNQ trades in 0.25
    # point increments, and a correct reconstruction lands on that grid.
    tick = float(cost.get("tickSize") or 0.0)
    if tick > 0:
        remainder = np.abs(close / tick - np.round(close / tick)) * tick
        off_grid = float(np.nanmax(remainder))
    else:
        off_grid = float("nan")

    checks = [
        check(
            "reconstructed_prices_land_on_the_instrument_tick_grid",
            bool(np.isfinite(off_grid)) and off_grid < max(tick / 100.0, 1e-3),
            f"furthest any recovered close sits from a {tick} point tick: {off_grid:.2e} points",
            f"< {max(tick / 100.0, 1e-3):.2e} points — a price the solve never saw still lands on the grid",
        ),
        check(
            "reconstructed_close_reproduces_trade_profit_and_loss",
            replay_error < 1e-4,
            f"max absolute difference {replay_error:.3e} US dollars over {len(trades)} trades",
            "< 1e-4 US dollars (a hundredth of a cent) — fails on a shuffled return series",
        ),
        check(
            "price_anchor_agreement",
            spread < cost.get("tickSize", 0.25) or spread == 0.0,
            f"widest disagreement between trades anchoring one row sequence: {spread:.2e} index points",
            f"< one tick ({cost.get('tickSize', 0.25)} points)",
        ),
    ]
    return close, checks


# ─── Adapter: probability_parquet ────────────────────────────────────────────


def _load_probability_parquet(model_dir: Path, model_id: str) -> Record:
    import polars as pl

    predictions_path = model_dir / "oos_predictions.parquet"
    checkpoint = json.loads((model_dir / "checkpoint.json").read_text(encoding="utf-8"))
    diagnostics = json.loads((model_dir / "diagnostics.json").read_text(encoding="utf-8"))
    params = checkpoint.get("params", {})

    frame = pl.read_parquet(predictions_path)
    ts = frame["ts"].to_numpy().astype(np.int64)
    if ts.size and int(ts.max()) < 10_000_000:
        raise Refusal(
            "timestamps are row indices (0..N-1), not bar times — the walk-forward "
            "templates dropped them; retrain to regenerate this model's predictions"
        )
    probability = frame["prob_up"].to_numpy().astype(np.float64)
    label = frame["label"].to_numpy().astype(np.float64)
    realized = frame["realized_return_bp"].to_numpy().astype(np.float64)

    symbol = diagnostics.get("symbol", "MNQ")
    timeframe = diagnostics.get("timeframe", "1m")
    horizon = int(params.get("label_horizon_bars", 5))
    threshold = float(params.get("pnl_threshold", 0.55))
    cost = load_cost(symbol)

    pnl_curve = diagnostics.get("pnl_curve", {})
    trade_net = [float(x) for x in pnl_curve.get("trade_pnl_dollars", [])]

    metrics = diagnostics.get("metrics", {})

    def metric(name: str):
        entry = metrics.get(name)
        return float(entry["value"]) if isinstance(entry, dict) and "value" in entry else None

    reference = {
        "tradeCount": int(pnl_curve.get("n_trades", len(trade_net))),
        "cumulativeNetUsd": float(pnl_curve.get("cum_pnl_dollars", float(np.sum(trade_net)))),
        "longCount": int(pnl_curve["n_long"]) if "n_long" in pnl_curve else None,
        "shortCount": int(pnl_curve["n_short"]) if "n_short" in pnl_curve else None,
        "hitRateAtHalf": metric("hit_rate_50"),
        "areaUnderCurve": metric("auc"),
    }
    label_definition = (
        f"triple-barrier direction over the next {horizon} bars with a "
        f"{params.get('label_threshold_bp', 5.0)} basis-point barrier "
        "(src/ml/xgb_classifier/labels.py); 1 = up barrier touched first"
    )
    source_files = [
        file_record(p)
        for p in (predictions_path, model_dir / "checkpoint.json", model_dir / "diagnostics.json")
    ]

    try:
        if not trade_net:
            raise Refusal(
                "diagnostics.json carries no trade profit-and-loss series, so prices cannot be "
                "recovered from the record alone"
            )
        close, price_checks = reconstruct_close(
            realized, probability, horizon, threshold, trade_net, cost
        )
    except Refusal as row_chain_refusal:
        record = _probability_parquet_on_lake_grid(
            model_id=model_id,
            symbol=symbol,
            timeframe=timeframe,
            horizon=horizon,
            threshold=threshold,
            timestamp_seconds=ts,
            probability=probability,
            label=label,
            stored_realized=realized,
            trade_net=trade_net,
            reference=reference,
            label_definition=label_definition,
            source_files=source_files,
            row_chain_reason=str(row_chain_refusal),
        )
        _attach_shap(record, model_dir, record_rows=record.prediction_rows)
        return record

    record = Record(
        model_id=model_id,
        source_schema="probability_parquet",
        symbol=symbol,
        timeframe=timeframe,
        horizon_bars=horizon,
        horizon_source="checkpoint.json params.label_horizon_bars",
        label_definition=label_definition,
        default_threshold=threshold,
        timestamp_seconds=ts,
        open=close.copy(),
        high=close.copy(),
        low=close.copy(),
        close=close,
        volume=np.full(ts.size, np.nan),
        probability_up=probability,
        label=label,
        realized_return_basis_points=realized,
        reference=reference,
        notes=[
            "Prices are recovered from this model's own out-of-sample record, not read from the lake: "
            "the lake's current 1-minute series holds only 2,029 of these 2,565 bars and the closes it "
            "does hold disagree with this run's realized returns by a median of 6.9 basis points.",
            "Only the close is recoverable — open, high and low are drawn at the close, so each candle "
            "is flat. The shape of these bars is not data.",
        ],
        verification=price_checks,
        source_files=source_files,
    )
    _attach_shap(record, model_dir)
    return record


def _probability_parquet_on_lake_grid(
    *,
    model_id: str,
    symbol: str,
    timeframe: str,
    horizon: int,
    threshold: float,
    timestamp_seconds: np.ndarray,
    probability: np.ndarray,
    label: np.ndarray,
    stored_realized: np.ndarray,
    trade_net: list[float],
    reference: dict,
    label_definition: str,
    source_files: list[dict],
    row_chain_reason: str,
) -> Record:
    """The record laid on the lake's bar grid, the way the newer trainer scored it.

    ``src/ml/xgb_classifier/main.py`` (since 2026-09-22) simulates trades over
    the RAW validation bars with each probability placed at its own bar and NaN
    on bars whose label was dropped, and it measures each realized return H
    bars ahead on that grid. So the lens record is every lake bar from the
    first prediction to H bars past the last one: a bar with no prediction
    carries no probability, label or realized return and never trades.

    Accepted only when the lake reproduces the model's own numbers: every
    stored realized return, the recorded trade count, and every recorded trade
    net of one round-trip cost. That cost is recovered from the trades
    themselves (gross from the lake minus the recorded net), because
    src/config/cost_model.json may have been re-priced since the model ran.
    """
    first = int(timestamp_seconds.min())
    last = int(timestamp_seconds.max())
    bar_seconds = TIMEFRAME_SECONDS.get(timeframe, 60)
    # enough calendar room for H bars past the last prediction across weekends
    # and holidays, and never less than two weeks
    tail_seconds = max(14 * 86_400, 4 * (horizon + 1) * bar_seconds)
    lake = _lake_series(symbol, timeframe, first - 86_400, last + tail_seconds)
    lake_ts = lake["timestamp"]

    position = np.searchsorted(lake_ts, timestamp_seconds)
    inside = position < lake_ts.size
    matched = np.zeros(timestamp_seconds.size, dtype=bool)
    matched[inside] = lake_ts[position[inside]] == timestamp_seconds[inside]
    matched_count = int(matched.sum())
    total = int(timestamp_seconds.size)
    if matched_count != total:
        raise Refusal(
            f"{row_chain_reason}; and on the lake's bar grid only {matched_count:,} of this model's "
            f"{total:,} out-of-sample bars exist, so its prices cannot be recovered either way"
        )

    start = int(position[0])
    stop = min(int(position[-1]) + horizon + 1, lake_ts.size)
    grid = slice(start, stop)
    n = stop - start
    rows = (position - start).astype(np.int64)
    close = lake["close"][grid]

    probability_grid = np.full(n, np.nan)
    probability_grid[rows] = probability
    label_grid = np.full(n, np.nan)
    label_grid[rows] = label
    realized_grid = np.full(n, np.nan)
    exit_rows = rows + horizon
    has_exit = exit_rows < n
    realized_grid[rows[has_exit]] = (
        np.log(close[exit_rows[has_exit]] / close[rows[has_exit]]) * 10_000.0
    )

    finite = np.isfinite(stored_realized) & np.isfinite(realized_grid[rows])
    realized_error = (
        float(np.max(np.abs(stored_realized[finite] - realized_grid[rows][finite])))
        if finite.any()
        else float("nan")
    )
    if not (finite.sum() == np.isfinite(stored_realized).sum() and realized_error < 1e-3):
        raise Refusal(
            f"{row_chain_reason}; and the lake's closes do not reproduce this model's stored realized "
            f"returns (largest difference {realized_error:.3e} basis points over {int(finite.sum())} rows)"
        )

    current = load_cost(symbol)
    point_value = current["pointValueUsd"]
    trades = entry_rows(probability_grid, threshold, horizon)
    if len(trades) != len(trade_net):
        raise Refusal(
            f"{row_chain_reason}; and replaying the trade rule on the lake's bar grid gives "
            f"{len(trades)} trades against the {len(trade_net)} the model's diagnostics record"
        )
    gross = np.array(
        [(close[i + horizon] - close[i]) * direction * point_value for i, direction in trades],
        dtype=np.float64,
    )
    charged = gross - np.asarray(trade_net, dtype=np.float64)
    notes = [
        f"Prices are read from the lake on the model's own bar grid. Its evaluator stepped {horizon} BARS "
        f"ahead, not {horizon} rows: this record is the {n:,} lake bars from the first prediction to "
        f"{horizon} bars past the last, {total:,} of which carry a prediction. A bar with no prediction "
        "(its label was dropped in training) carries no probability, label or realized return and never "
        "trades, exactly as in the model's own evaluation.",
        f"The lake reproduces every stored realized return to {realized_error:.1e} basis points.",
    ]
    if trades:
        cost_usd = float(np.median(charged))
        spread = float(np.max(charged) - np.min(charged))
        replay_error = float(np.max(np.abs(gross - cost_usd - np.asarray(trade_net))))
        cost = {
            "roundTripPoints": round(cost_usd / point_value, 10),
            "pointValueUsd": point_value,
            "tickSize": current["tickSize"],
            "source": (
                f"recovered from this model's {len(trades)} recorded trades (gross from the lake's closes "
                f"minus each recorded net): {cost_usd:.2f} US dollars per round trip"
            ),
        }
        if abs(cost["roundTripPoints"] - current["roundTripPoints"]) > 1e-9:
            notes.append(
                f"This record was scored at {cost['roundTripPoints']:.2f} points per round trip, recovered "
                f"from its own trades; src/config/cost_model.json now prices {symbol.upper()} at "
                f"{current['roundTripPoints']:.2f} points. The lens charges what the model's evaluator charged."
            )
        cost_checks = [
            check(
                "one_round_trip_cost_explains_every_recorded_trade",
                spread < 1e-6 and replay_error < 1e-4,
                f"{len(trades)} trades; the cost each implies spans {spread:.2e} US dollars and the "
                f"replay differs from the record by at most {replay_error:.2e} US dollars",
                "every trade implies the same round-trip cost, to a hundredth of a cent",
            )
        ]
    else:
        cost = None
        cost_checks = []
        notes.append(
            "The model's evaluator took no trade at its threshold, so there is no trade to recover the "
            "cost it charged from; the lens shows the current src/config/cost_model.json entry."
        )

    open_, high, low = lake["open"][grid], lake["high"][grid], lake["low"][grid]
    well_formed = (
        (high >= low) & (high >= open_) & (high >= close) & (low <= open_) & (low <= close)
    )
    verification = [
        check(
            "lake_bars_cover_every_out_of_sample_row",
            True,
            f"{matched_count:,} of {total:,} predictions sit on a lake bar at the same second",
            "every prediction sits on a lake bar",
        ),
        check(
            "stored_realized_returns_reproduced_by_lake_closes",
            True,
            f"largest difference {realized_error:.3e} basis points over {int(finite.sum())} rows",
            f"< 1e-3 basis points, stepping {horizon} bars on the lake's grid",
        ),
        check(
            "replayed_trade_count_matches_model_diagnostics",
            True,
            f"{len(trades)} trades replayed on the bar grid",
            f"exactly {len(trade_net)} (diagnostics.json pnl_curve.trade_pnl_dollars)",
        ),
        *cost_checks,
        check(
            "price_bars_well_formed",
            bool(np.all(well_formed)),
            f"{int(np.sum(~well_formed))} bars violate high/low bounds",
            "high >= max(open, close) and low <= min(open, close) on every bar",
        ),
    ]
    notes.append(
        f"The row-by-row price reconstruction does not apply to this record: {row_chain_reason}."
    )

    record = Record(
        model_id=model_id,
        source_schema="probability_parquet",
        symbol=symbol,
        timeframe=timeframe,
        horizon_bars=horizon,
        horizon_source="checkpoint.json params.label_horizon_bars (bars on the raw grid)",
        label_definition=label_definition,
        default_threshold=threshold,
        timestamp_seconds=lake_ts[grid].astype(np.int64),
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=lake["volume"][grid],
        probability_up=probability_grid,
        label=label_grid,
        realized_return_basis_points=realized_grid,
        reference=reference,
        notes=notes,
        verification=verification,
        source_files=source_files,
        cost=cost,
    )
    record.prediction_rows = rows
    record.roll_gaps = detect_price_discontinuities(record.timestamp_seconds, close)
    return record


def _lake_series(symbol: str, timeframe: str, first_second: int, last_second: int) -> dict:
    """The lake's bars for a symbol and timeframe between two seconds, sorted, as arrays."""
    import datetime
    import sys

    sys.path.insert(0, str(PROJECT_ROOT / "src" / "ml"))
    from shared.data import load_ohlcv_arrays

    date_range = {
        "start": datetime.datetime.fromtimestamp(first_second, datetime.UTC).strftime("%Y-%m-%d"),
        "end": datetime.datetime.fromtimestamp(last_second, datetime.UTC).strftime("%Y-%m-%d"),
    }
    raw = load_ohlcv_arrays(symbol, timeframe, 0, date_range)
    timestamps = np.asarray(
        [int(t.timestamp()) if hasattr(t, "timestamp") else int(t) for t in raw["timestamp"]],
        dtype=np.int64,
    )
    order = np.argsort(timestamps, kind="stable")
    out = {"timestamp": timestamps[order]}
    for name in ("open", "high", "low", "close", "volume"):
        out[name] = np.asarray(raw[name], dtype=np.float64)[order]
    return out


def _attach_shap(record: Record, model_dir: Path, record_rows: np.ndarray | None = None) -> None:
    """``record_rows[i]`` is the record row of prediction row ``i`` (identity when None)."""
    shap_path = model_dir / "shap_summary.npz"
    if not shap_path.exists():
        record.attribution_reason = "no shap_summary.npz in this model directory"
        return
    # allow_pickle: feature_names is an object array written by this repo's own
    # trainer (src/ml/xgb_classifier/main.py). Local artifact, not untrusted input.
    with np.load(shap_path, allow_pickle=True) as data:
        contributions = np.asarray(data["contribs"], dtype=np.float32)
        sample_indices = np.asarray(data["sample_indices"], dtype=np.int64)
        names = [str(x) for x in data["feature_names"]]

    n = record.row_count
    aligned = np.full((n, contributions.shape[1]), np.nan, dtype=np.float32)
    # contributions[i] belongs to prediction row sample_indices[i] — a seeded
    # random permutation, never positional. Zipping them positionally would
    # attribute every bar's reasoning to a different bar. On the lake grid a
    # prediction row is a different record row again (record_rows maps it).
    prediction_count = n if record_rows is None else int(record_rows.size)
    inside = (sample_indices >= 0) & (sample_indices < prediction_count)
    target_rows = (
        sample_indices[inside] if record_rows is None else record_rows[sample_indices[inside]]
    )
    aligned[target_rows] = contributions[inside]

    covered = int(np.isfinite(aligned[:, 0]).sum())
    record.attribution = (names, aligned, None)
    record.attribution_method = (
        "TreeSHAP over the validation rows (xgboost pred_contribs), re-aligned to bar order "
        "through shap_summary.npz sample_indices"
    )
    record.verification.append(
        check(
            "shap_rows_realigned_to_bar_order",
            covered > 0 and not np.array_equal(sample_indices, np.arange(sample_indices.size)),
            f"{covered} of {n} bars carry attribution; stored order is a permutation "
            f"(first indices {sample_indices[:3].tolist()})",
            "attribution indexed by sample_indices, not by position",
        )
    )
    record.source_files.append(file_record(shap_path))
    record.notes.append(
        "Feature VALUES are not recoverable for this model (the artifact stores attributions only, and "
        "the lake no longer reproduces its inputs), so the playback shows each feature's contribution "
        "without the value it was computed from."
    )


def detect_price_discontinuities(timestamp_seconds: np.ndarray, close: np.ndarray) -> list[dict]:
    """Bar-to-bar price jumps across a break in trading, measured not assumed.

    An unadjusted front-month series moves in two ways no strategy can trade:
    the front contract changes and the new one prices in the carry, and the
    market closes and reopens somewhere else. Both land as one enormous
    "return" between two adjacent rows. This reports every jump across a break
    that is far outside ordinary intraday movement, and labels it by the kind of
    break it crossed — a date boundary (what a contract roll looks like in this
    data) or a longer session gap (a weekend or holiday reopen). It does not
    claim to know which contract was rolled; nothing in the record says.
    """
    if close.size < 3:
        return []
    step = np.abs(np.diff(close))
    finite = step[np.isfinite(step)]
    if finite.size == 0:
        return []
    threshold = max(float(np.quantile(finite, 0.999)) * 3.0, 50.0)

    elapsed = np.diff(timestamp_seconds)
    day = timestamp_seconds // 86_400
    crosses_day = np.diff(day) != 0
    typical_step = float(np.median(elapsed)) if elapsed.size else 60.0
    long_break = elapsed > max(typical_step * 30, 3 * 3600)
    jump = step > threshold

    out: list[dict] = []
    for row in np.flatnonzero(jump & (crosses_day | long_break)):
        seconds_closed = int(elapsed[row])
        out.append(
            {
                "rowIndex": int(row) + 1,
                "timestampSeconds": int(timestamp_seconds[row + 1]),
                "gapPoints": float(close[row + 1] - close[row]),
                "hoursClosed": round(seconds_closed / 3600.0, 2),
                "kind": "date_boundary" if seconds_closed <= 2 * 3600 else "session_gap",
            }
        )
    return out


# ─── Adapter: class_confidence_parquet (every generated template) ────────────


def _load_class_confidence_parquet(model_dir: Path, model_id: str) -> Record:
    import polars as pl

    predictions_path = model_dir / "oos_predictions.parquet"
    frame = pl.read_parquet(predictions_path)
    columns = set(frame.columns)

    ts = frame["timestamp"].to_numpy().astype(np.int64)
    if ts.size and int(ts.max()) < 10_000_000:
        raise Refusal(
            "timestamps are row indices (0..N-1), not bar times — this model predates the "
            "walk-forward timestamp fix; retrain to regenerate its predictions"
        )

    if "probability_up" in columns:
        probability = frame["probability_up"].to_numpy().astype(np.float64)
    else:
        # `confidence` is the winning class's probability, so a down call carries
        # 1 - P(up). Exactly recoverable for a two-way head, and nothing else.
        prediction = frame["prediction"].to_numpy().astype(np.int64)
        confidence = frame["confidence"].to_numpy().astype(np.float64)
        distinct = set(np.unique(prediction).tolist())
        if not distinct <= {0, 1}:
            raise Refusal(
                f"predictions are multi-class labels {sorted(distinct)}; this lens reads "
                "a two-way direction call"
            )
        probability = np.where(prediction == 1, confidence, 1.0 - confidence)

    label = (
        frame["label"].to_numpy().astype(np.float64)
        if "label" in columns
        else np.full(ts.size, np.nan)
    )
    symbols = frame["symbol"].unique().to_list() if "symbol" in columns else []
    symbol = str(symbols[0]) if len(symbols) == 1 else "MNQ"

    diagnostics_path = model_dir / "diagnostics.json"
    diagnostics = (
        json.loads(diagnostics_path.read_text(encoding="utf-8"))
        if diagnostics_path.exists()
        else {}
    )
    params = diagnostics.get("params") or diagnostics.get("hyperparameters") or {}
    timeframe = str(diagnostics.get("timeframe", "1m"))
    horizon = int(params.get("label_horizon_bars", params.get("forward_n", 1)) or 1)
    threshold = float(params.get("pnl_threshold", 0.55))

    bars, price_checks = _lake_prices(symbol, timeframe, ts)
    close = bars["close"]

    n = ts.size
    realized = np.full(n, np.nan)
    if n > horizon:
        realized[: n - horizon] = np.log(close[horizon:] / close[: n - horizon]) * 10_000.0

    record = Record(
        model_id=model_id,
        source_schema="class_confidence_parquet",
        symbol=symbol,
        timeframe=timeframe,
        horizon_bars=horizon,
        horizon_source=(
            "diagnostics.json params.label_horizon_bars"
            if "label_horizon_bars" in params
            else "no horizon recorded by this trainer; the lens reads it as one bar"
        ),
        label_definition=str(
            diagnostics.get("label_definition")
            or f"class label written by this model's own evaluator ({diagnostics.get('model_type', 'family not recorded')})"
        ),
        default_threshold=threshold,
        timestamp_seconds=ts,
        open=bars["open"],
        high=bars["high"],
        low=bars["low"],
        close=close,
        volume=bars["volume"],
        probability_up=probability,
        label=label,
        realized_return_basis_points=realized,
        reference={
            "tradeCount": None,
            "cumulativeNetUsd": None,
            "longCount": None,
            "shortCount": None,
            "hitRateAtHalf": None,
            "areaUnderCurve": None,
        },
        notes=[
            "Prices are read from the lake and joined to this model's own bar timestamps — it was "
            "trained from the same source, so the join is exact wherever the lake holds the bar.",
        ]
        + (
            []
            if "probability_up" in columns
            else [
                "This model predates the probability_up column, so its probability of up was recovered "
                "from (prediction, confidence) — exact for a two-way call."
            ]
        ),
        verification=price_checks,
        source_files=[file_record(predictions_path)]
        + ([file_record(diagnostics_path)] if diagnostics_path.exists() else []),
    )
    record.attribution_reason = "this trainer writes no attribution artifact"
    return record


def _lake_prices(
    symbol: str, timeframe: str, timestamp_seconds: np.ndarray
) -> tuple[dict, list[dict]]:
    """Join bars from the lake onto a model's out-of-sample timestamps."""
    import datetime
    import sys

    sys.path.insert(0, str(PROJECT_ROOT / "src" / "ml"))
    from shared.data import load_ohlcv_arrays

    first = int(timestamp_seconds.min())
    last = int(timestamp_seconds.max())
    date_range = {
        "start": datetime.datetime.fromtimestamp(first, datetime.UTC).strftime("%Y-%m-%d"),
        "end": datetime.datetime.fromtimestamp(last + 86_400, datetime.UTC).strftime("%Y-%m-%d"),
    }
    raw = load_ohlcv_arrays(symbol, timeframe, 0, date_range)
    lake_ts = np.asarray(
        [int(t.timestamp()) if hasattr(t, "timestamp") else int(t) for t in raw["timestamp"]],
        dtype=np.int64,
    )
    order = np.argsort(lake_ts)
    lake_ts = lake_ts[order]
    position = np.clip(np.searchsorted(lake_ts, timestamp_seconds), 0, max(0, lake_ts.size - 1))
    matched = (
        np.equal(lake_ts[position], timestamp_seconds)
        if lake_ts.size
        else np.zeros(timestamp_seconds.size, dtype=bool)
    )

    def column(name: str) -> np.ndarray:
        values = np.asarray(raw[name], dtype=np.float64)[order]
        out = np.full(timestamp_seconds.size, np.nan)
        if lake_ts.size:
            out[matched] = values[position[matched]]
        return out

    bars = {name: column(name) for name in ("open", "high", "low", "close", "volume")}
    matched_count = int(np.count_nonzero(matched))
    total = int(timestamp_seconds.size)
    coverage = matched_count / total if total else 0.0
    if coverage < 0.99:
        raise Refusal(
            f"the lake holds only {matched_count:,} of this model's {total:,} out-of-sample bars "
            f"({coverage:.1%}) — its prices cannot be shown honestly"
        )
    checks = [
        check(
            "lake_bars_cover_every_out_of_sample_row",
            coverage >= 0.99,
            f"{matched_count:,} of {total:,} bars matched a lake bar at the same second ({coverage:.2%})",
            "at least 99% of rows join to a bar in the lake",
        )
    ]
    return bars, checks


# ─── Adapter: ohlc_probability_npz ───────────────────────────────────────────


def _load_ohlc_npz(model_dir: Path, model_id: str) -> Record:
    predictions_path = model_dir / "oos_predictions.npz"
    diagnostics = json.loads((model_dir / "diagnostics.json").read_text(encoding="utf-8"))

    # Plain numeric + fixed-width string arrays: no pickle needed.
    with np.load(predictions_path) as data:
        raw_timestamps = data["timestamps"]
        open_ = np.asarray(data["open"], dtype=np.float64)
        high = np.asarray(data["high"], dtype=np.float64)
        low = np.asarray(data["low"], dtype=np.float64)
        close = np.asarray(data["close"], dtype=np.float64)
        probability = np.asarray(data["probs"], dtype=np.float64)
        label = np.asarray(data["labels"], dtype=np.float64)

    timestamps = np.array(
        [
            np.datetime64(str(s).replace(" ", "T")).astype("datetime64[s]").astype(np.int64)
            for s in raw_timestamps
        ],
        dtype=np.int64,
    )

    hyperparameters = diagnostics.get("hyperparameters", {})
    horizon = int(hyperparameters.get("forward_n", 20))
    symbol = diagnostics.get("symbol", "MNQ")
    timeframe = diagnostics.get("timeframe", "1m")

    n = timestamps.size
    realized = np.full(n, np.nan)
    if n > horizon:
        realized[: n - horizon] = np.log(close[horizon:] / close[: n - horizon]) * 10_000.0

    labelled = np.isfinite(label)
    label_accuracy = (
        float(((probability[labelled] > 0.5) == (label[labelled] > 0.5)).mean())
        if labelled.any()
        else float("nan")
    )
    forward = realized[: n - horizon]
    comparable = np.isfinite(forward) & labelled[: n - horizon]
    direction_accuracy = (
        float(((probability[: n - horizon][comparable] > 0.5) == (forward[comparable] > 0)).mean())
        if comparable.any()
        else float("nan")
    )

    best = diagnostics.get("best_metrics", {})
    swing_accuracy = float(best.get("swing_accuracy", float("nan")))

    notes = [str(diagnostics[key]) for key in ("note",) if diagnostics.get(key)]
    if diagnostics.get("deprecated"):
        notes.insert(0, "The model's own diagnostics mark this run deprecated.")
    notes.append(
        f"The stored probabilities are the SWING head: they match the stored labels "
        f"{label_accuracy * 100:.1f}% of the time, which is this run's recorded swing accuracy "
        f"({swing_accuracy * 100:.1f}%). Against the sign of the realized {horizon}-bar return they are "
        f"{direction_accuracy * 100:.1f}% — a coin flip. High accuracy here is agreement with an "
        "autocorrelated swing label, not a tradeable direction call."
    )
    discontinuities = detect_price_discontinuities(timestamps, close)
    if discontinuities:
        rolls = [d for d in discontinuities if d["kind"] == "date_boundary"]
        signed = sum(d["gapPoints"] for d in discontinuities)
        roll_signed = sum(d["gapPoints"] for d in rolls)
        notes.append(
            f"Prices are unadjusted front-month. {len(discontinuities)} price jumps in this record "
            f"happen across a break in trading rather than inside it, worth {signed:+.2f} index points "
            f"in total; {len(rolls)} of them sit exactly on a date boundary ({roll_signed:+.2f} points), "
            "which is what a contract roll looks like here. Buy-and-hold contains all of it, and so does "
            "any trade held across one — none of it is a move the model called."
        )
    else:
        notes.append(
            "Prices come from the model's own record (the npz carries open/high/low/close per bar), "
            "unadjusted front-month."
        )

    record = Record(
        model_id=model_id,
        source_schema="ohlc_probability_npz",
        symbol=symbol,
        timeframe=timeframe,
        horizon_bars=horizon,
        horizon_source="diagnostics.json hyperparameters.forward_n",
        label_definition=(
            "swing membership from the causal zigzag labeller (the model's swing head): 1 = the bar "
            "belongs to an up-swing. Neighbouring bars share a swing, so the label is strongly "
            "autocorrelated and its accuracy overstates directional skill."
        ),
        default_threshold=0.55,
        timestamp_seconds=timestamps,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=np.full(n, np.nan),
        probability_up=probability,
        label=label,
        realized_return_basis_points=realized,
        reference={
            "tradeCount": None,
            "cumulativeNetUsd": None,
            "longCount": None,
            "shortCount": None,
            "hitRateAtHalf": None,
            "areaUnderCurve": None,
        },
        notes=notes,
        roll_gaps=discontinuities,
        verification=[
            check(
                "probability_head_identified",
                abs(label_accuracy - swing_accuracy) < 0.01,
                f"probabilities agree with stored labels {label_accuracy:.4f} vs recorded swing accuracy {swing_accuracy:.4f}",
                "within 0.01 — identifies which head the stored probabilities came from",
            ),
            check(
                "timestamps_strictly_increasing",
                bool(np.all(np.diff(timestamps) > 0)),
                f"{n} rows, {int((np.diff(timestamps) <= 0).sum())} non-increasing steps",
                "strictly increasing",
            ),
            check(
                "price_bars_well_formed",
                bool(
                    np.all(
                        (high >= low)
                        & (high >= open_)
                        & (high >= close)
                        & (low <= open_)
                        & (low <= close)
                    )
                ),
                f"{int(np.sum(~((high >= low) & (high >= open_) & (high >= close) & (low <= open_) & (low <= close))))} bars violate high/low bounds",
                "high >= max(open, close) and low <= min(open, close) on every bar",
            ),
        ],
        source_files=[file_record(p) for p in (predictions_path, model_dir / "diagnostics.json")],
    )
    record.attribution_reason = (
        "no attribution artifact for this deep model (SHAP is written only by the tree trainer)"
    )
    return record


# ─── Entry points ────────────────────────────────────────────────────────────


def detect_schema(model_dir: Path) -> str:
    """Which adapter reads this directory, or a Refusal explaining why none does."""
    from lens.runs import is_cycle_run, refuse_unreadable_run

    if is_cycle_run(model_dir):
        refuse_unreadable_run(model_dir)
        return "cycle_run"
    if (model_dir / "oos_predictions.parquet").exists():
        import polars as pl

        frame = pl.read_parquet(model_dir / "oos_predictions.parquet", n_rows=8)
        columns = set(frame.columns)
        if {"ts", "prob_up"} <= columns:
            return "probability_parquet"
        if {"timestamp", "prediction", "confidence"} <= columns:
            head = frame["timestamp"].to_numpy()
            if head.size and int(head.max()) < 10_000_000:
                raise Refusal(
                    "timestamps are row indices (0..N-1), not bar times — the walk-forward templates "
                    "dropped them; retrain to regenerate this model's predictions"
                )
            return "class_confidence_parquet"
        raise Refusal(f"oos_predictions.parquet has unrecognised columns: {sorted(columns)}")
    if (model_dir / "oos_predictions.npz").exists():
        with np.load(model_dir / "oos_predictions.npz") as data:
            keys = set(data.files)
        if {"timestamps", "close", "probs"} <= keys:
            return "ohlc_probability_npz"
        raise Refusal(f"oos_predictions.npz has unrecognised arrays: {sorted(keys)}")
    if (model_dir / "predictions.parquet").exists():
        raise Refusal(
            "predictions.parquet here is not a Model Cycle record (no config.json run plan beside it), "
            "and no oos_predictions artifact exists"
        )
    raise Refusal("no oos_predictions artifact in this model directory")


def load_record(model_dir: Path) -> Record:
    schema = detect_schema(model_dir)
    if schema == "cycle_run":
        from lens.runs import load_cycle_run

        return load_cycle_run(model_dir, model_dir.name)
    if schema == "probability_parquet":
        return _load_probability_parquet(model_dir, model_dir.name)
    if schema == "class_confidence_parquet":
        return _load_class_confidence_parquet(model_dir, model_dir.name)
    return _load_ohlc_npz(model_dir, model_dir.name)
