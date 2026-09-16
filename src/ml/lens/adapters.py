"""Artifact adapters — a model directory read into one canonical record.

Two shapes exist on disk today (``LensSourceSchema`` in
``src/shared/lens/types.ts``):

``probability_parquet``
    ``oos_predictions.parquet`` with (ts, prob_up, label, realized_return_bp),
    written by the hand-written ``src/ml/xgb_classifier``. It carries no prices.
    The lake's current 1-minute series does NOT reproduce this run's realized
    returns (measured 2026-09-15: only 2,029 of 2,565 out-of-sample timestamps
    are present at all, and the closes that are present disagree by a median of
    6.9 basis points — the same size as the returns themselves). So the prices
    are recovered from the model's own record instead; see ``reconstruct_close``.

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
    if not trade_net:
        raise Refusal(
            "diagnostics.json carries no trade profit-and-loss series, so prices cannot be recovered"
        )

    close, price_checks = reconstruct_close(
        realized, probability, horizon, threshold, trade_net, cost
    )

    metrics = diagnostics.get("metrics", {})

    def metric(name: str):
        entry = metrics.get(name)
        return float(entry["value"]) if isinstance(entry, dict) and "value" in entry else None

    record = Record(
        model_id=model_id,
        source_schema="probability_parquet",
        symbol=symbol,
        timeframe=timeframe,
        horizon_bars=horizon,
        horizon_source="checkpoint.json params.label_horizon_bars",
        label_definition=(
            f"triple-barrier direction over the next {horizon} bars with a "
            f"{params.get('label_threshold_bp', 5.0)} basis-point barrier "
            "(src/ml/xgb_classifier/labels.py); 1 = up barrier touched first"
        ),
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
        reference={
            "tradeCount": int(pnl_curve.get("n_trades", len(trade_net))),
            "cumulativeNetUsd": float(pnl_curve.get("cum_pnl_dollars", float(np.sum(trade_net)))),
            "longCount": int(pnl_curve["n_long"]) if "n_long" in pnl_curve else None,
            "shortCount": int(pnl_curve["n_short"]) if "n_short" in pnl_curve else None,
            "hitRateAtHalf": metric("hit_rate_50"),
            "areaUnderCurve": metric("auc"),
        },
        notes=[
            "Prices are recovered from this model's own out-of-sample record, not read from the lake: "
            "the lake's current 1-minute series holds only 2,029 of these 2,565 bars and the closes it "
            "does hold disagree with this run's realized returns by a median of 6.9 basis points.",
            "Only the close is recoverable — open, high and low are drawn at the close, so each candle "
            "is flat. The shape of these bars is not data.",
        ],
        verification=price_checks,
        source_files=[
            file_record(p)
            for p in (
                predictions_path,
                model_dir / "checkpoint.json",
                model_dir / "diagnostics.json",
            )
        ],
    )
    _attach_shap(record, model_dir)
    return record


def _attach_shap(record: Record, model_dir: Path) -> None:
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
    # contributions[i] belongs to record row sample_indices[i] — a seeded random
    # permutation, never positional. Zipping them positionally would attribute
    # every bar's reasoning to a different bar.
    inside = (sample_indices >= 0) & (sample_indices < n)
    aligned[sample_indices[inside]] = contributions[inside]

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
    raise Refusal("no oos_predictions artifact in this model directory")


def load_record(model_dir: Path) -> Record:
    schema = detect_schema(model_dir)
    if schema == "probability_parquet":
        return _load_probability_parquet(model_dir, model_dir.name)
    if schema == "class_confidence_parquet":
        return _load_class_confidence_parquet(model_dir, model_dir.name)
    return _load_ohlc_npz(model_dir, model_dir.name)
