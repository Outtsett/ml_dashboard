"""The Model Lens readers added on 2026-09-29.

- ``cycle_run`` (packages/ml-engine/src/lens/runs.py): a Model Cycle run read from its own
  record. The committed fixture tests/fixtures/lens/mnq_5m_xgboost_cycle_run/ is
  a real run (MNQ 5m XGBoost, entry threshold 0.55); synthetic runs in a
  temporary directory pin the refusal and labelling rules.
- ``probability_parquet`` on the lake's bar grid (packages/ml-engine/src/lens/adapters.py
  ``_probability_parquet_on_lake_grid``): the daily XGBoost classifier fixture,
  with the lake read replaced by the fixture's own bars so the test needs no
  lake credentials.
- the interval never hands a bar without a prediction an interval.

Run: E:/source/repos/ml_dashboard/.venv/Scripts/python.exe -m pytest tests/test_lens_cycle_run.py -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import polars as pl
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "src" / "ml") not in sys.path:
    sys.path.insert(0, str(ROOT / "src" / "ml"))

from lens import adapters, runs  # noqa: E402
from lens.adapters import Refusal, detect_schema, load_record  # noqa: E402
from lens.interval import causal_conformal_quantiles  # noqa: E402

CYCLE_FIXTURE = ROOT / "tests" / "fixtures" / "lens" / "mnq_5m_xgboost_cycle_run"
DAILY_FIXTURE = ROOT / "tests" / "fixtures" / "lens" / "mnq_1d_xgboost_direction_classifier"
REAL_RUN = ROOT / "data" / "models" / "MNQ_5m_xgboost+walk_forward_cycle_20260928T185403"


def _scoreboard(directory: Path) -> dict:
    return json.loads((directory / "scoreboard.json").read_text(encoding="utf-8"))


def _direction_scores(record) -> tuple[int, float, float, float]:
    """(labelled bars, accuracy, Brier score, area under the curve) as the lens stores them."""
    from sklearn.metrics import roc_auc_score

    labelled = np.isfinite(record.label)
    probability = record.probability_up.astype(np.float32).astype(np.float64)[labelled]
    label = record.label[labelled]
    accuracy = float(np.mean((probability >= 0.5) == (label == 1.0)))
    brier = float(np.mean((probability - label) ** 2))
    return int(labelled.sum()), accuracy, brier, float(roc_auc_score(label, probability))


# ─── The committed Model Cycle fixture ──────────────────────────────────────


def test_fixture_is_read_as_a_cycle_run() -> None:
    assert runs.is_cycle_run(CYCLE_FIXTURE)
    assert detect_schema(CYCLE_FIXTURE) == "cycle_run"


def test_fixture_reproduces_the_runs_direction_scoreboard() -> None:
    record = load_record(CYCLE_FIXTURE)
    scoreboard = _scoreboard(CYCLE_FIXTURE)
    metrics = scoreboard["metrics"]

    failed = [f"{c['name']}: {c['measured']}" for c in record.verification if not c["passed"]]
    assert failed == []
    labelled, accuracy, brier, auc = _direction_scores(record)
    assert labelled == scoreboard["barsScored"]
    assert record.row_count == scoreboard["barsEvaluated"]
    assert accuracy == pytest.approx(metrics["accuracy"], abs=1e-12)
    assert brier == pytest.approx(metrics["brier_score"], abs=1e-6)
    assert auc == pytest.approx(metrics["roc_auc"], abs=1e-6)
    assert record.reference["hitRateAtHalf"] == metrics["accuracy"]
    assert record.reference["areaUnderCurve"] == metrics["roc_auc"]


def test_fixture_takes_horizon_cost_and_threshold_from_the_run_plan() -> None:
    record = load_record(CYCLE_FIXTURE)
    plan = json.loads((CYCLE_FIXTURE / "config.json").read_text(encoding="utf-8"))["plan"]
    assert record.horizon_bars == plan["labelHorizonBars"]
    assert record.horizon_source == "config.json plan.labelHorizonBars"
    cost = plan["costModel"]
    assert record.cost["roundTripPoints"] == pytest.approx(
        cost["roundTripCostUsd"] / cost["pointValueUsd"]
    )
    assert record.cost["pointValueUsd"] == cost["pointValueUsd"]
    assert record.cost["tickSize"] == cost["tickSize"]
    assert "config.json plan.costModel" in record.cost["source"]
    assert record.default_threshold == plan["trading"]["entryProbability"]
    assert (record.symbol, record.timeframe) == (plan["symbol"], plan["timeframe"])


def test_fixture_names_the_runs_own_trades_instead_of_comparing_two_rules() -> None:
    record = load_record(CYCLE_FIXTURE)
    metrics = _scoreboard(CYCLE_FIXTURE)["metrics"]
    assert record.reference["tradeCount"] is None
    assert record.reference["cumulativeNetUsd"] is None
    own = next(
        note for note in record.notes if note.startswith("Under its own rule the run closed")
    )
    assert f"{int(metrics['trade_count']):,} trades" in own
    assert f"${abs(metrics['net_profit_usd']):,.2f}" in own
    assert any("next bar's open" in note for note in record.notes)


def test_fixture_matches_the_lens_it_was_built_into() -> None:
    record = load_record(CYCLE_FIXTURE)
    bars = pl.read_parquet(CYCLE_FIXTURE / "lens" / "bars.parquet")
    assert bars.height == record.row_count
    assert np.array_equal(bars["timestamp_seconds"].to_numpy(), record.timestamp_seconds)
    assert np.array_equal(bars["close"].to_numpy(), record.close)
    assert np.array_equal(
        bars["probability_up"].to_numpy(), record.probability_up.astype(np.float32)
    )
    stored_label = bars["label"].cast(pl.Float64).fill_null(float("nan")).to_numpy()
    assert np.array_equal(stored_label, record.label, equal_nan=True)


def test_realized_return_stops_at_fold_ends_and_session_gaps() -> None:
    record = load_record(CYCLE_FIXTURE)
    frame = pl.read_parquet(CYCLE_FIXTURE / "predictions.parquet")
    fold = frame["fold_index"].to_numpy()
    horizon = record.horizon_bars
    n = record.row_count
    for row in range(n):
        if row + horizon >= n or fold[row + horizon] != fold[row]:
            assert np.isnan(record.realized_return_basis_points[row]), row
    inside = [r for r in range(n - horizon) if fold[r + horizon] == fold[r]]
    expected = np.log(record.close[[r + horizon for r in inside]] / record.close[inside]) * 10_000.0
    got = record.realized_return_basis_points[inside]
    finite = np.isfinite(got)
    assert np.allclose(got[finite], expected[finite], atol=1e-9)


# ─── Synthetic runs: refusal and labelling rules ────────────────────────────


def _stub_file_record(path: Path) -> dict:
    return {
        "path": path.name,
        "sha256": "0" * 64,
        "bytes": 0,
        "modifiedAtIso": "1970-01-01T00:00:00+00:00",
    }


def _write_run(directory: Path, frame: pl.DataFrame | None, plan: dict | None, **config) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "config.json").write_text(json.dumps({"plan": plan, **config}), encoding="utf-8")
    if frame is not None:
        frame.write_parquet(directory / "predictions.parquet")
    return directory


PLAN = {
    "symbol": "MNQ",
    "timeframe": "5m",
    "labelHorizonBars": 2,
    "labelThresholdTicks": 0.0,
    "costModel": {
        "tickSize": 0.25,
        "pointValueUsd": 2.0,
        "roundTripCostUsd": 2.78,
        "source": "packages/config/cost_model.json:MNQ",
    },
    "trading": {"longOnly": False, "holdingBars": 2, "contracts": 1},
}


def _frame(rows: int = 8) -> pl.DataFrame:
    close = [100.0, 101.0, 100.5, 102.0, 101.0, 103.0, 102.5, 104.0][:rows]
    return pl.DataFrame(
        {
            "timestamp": [1_760_000_000 + 300 * i for i in range(rows)],
            "fold_index": [0, 0, 0, 0, 1, 1, 1, 1][:rows],
            "open": close,
            "high": [c + 0.5 for c in close],
            "low": [c - 0.5 for c in close],
            "close": close,
            "volume": [10.0] * rows,
            "probability_up": [0.6, 0.4, 0.7, 0.45, 0.55, 0.3, 0.8, 0.52][:rows],
            # bar 0: up (right), 1: up (wrong), 2: resolved at the fold end -> null,
            # 4: crosses a gap -> 0 (unscored), 5: down (right)
            "actual_direction": [1, 1, None, None, 0, -1, None, None][:rows],
            "correct": [True, False, None, None, None, True, None, None][:rows],
            "crosses_gap": [False, False, False, False, True, False, False, False][:rows],
        },
        schema_overrides={"actual_direction": pl.Int64, "correct": pl.Boolean},
    )


def test_a_failed_run_is_refused_with_its_own_error(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(runs, "file_record", _stub_file_record)
    run = _write_run(
        tmp_path / "failed", pl.DataFrame(), None, status="failed", error="ValueError: no fold fits"
    )
    assert runs.is_cycle_run(run)
    # Refused already by the cheap schema read, so the model list says why.
    with pytest.raises(Refusal, match="no fold fits"):
        detect_schema(run)
    with pytest.raises(Refusal, match="no fold fits"):
        load_record(run)


def test_an_empty_or_incomplete_record_is_refused(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(runs, "file_record", _stub_file_record)
    empty = _write_run(tmp_path / "empty", _frame().clear(), PLAN, status="stopped")
    with pytest.raises(Refusal, match="walked no test bar"):
        load_record(empty)
    partial = _write_run(tmp_path / "partial", _frame().drop("actual_direction"), PLAN)
    with pytest.raises(Refusal, match="actual_direction"):
        load_record(partial)


def test_predictions_without_a_run_plan_are_not_a_cycle_run(tmp_path) -> None:
    directory = tmp_path / "strategy"
    directory.mkdir()
    _frame().write_parquet(directory / "predictions.parquet")
    assert not runs.is_cycle_run(directory)
    with pytest.raises(Refusal, match="not a Model Cycle record"):
        detect_schema(directory)


def test_labels_are_exactly_the_bars_the_run_scored(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(runs, "file_record", _stub_file_record)
    run = _write_run(tmp_path / "run", _frame(), PLAN)
    record = load_record(run)
    expected_label = np.array([1.0, 1.0, np.nan, np.nan, np.nan, 0.0, np.nan, np.nan])
    assert np.array_equal(record.label, expected_label, equal_nan=True)
    # Realized: inside fold 0 for rows 0-1, across a gap at row 4 (none), fold 1 row 5.
    realized = record.realized_return_basis_points
    assert np.isfinite(realized[[0, 1, 5]]).all()
    assert np.isnan(realized[[2, 3, 4, 6, 7]]).all()
    assert realized[0] == pytest.approx(np.log(100.5 / 100.0) * 10_000.0)
    # No entry threshold in the plan: the run traded every prediction, so the lens defaults to 0.5.
    assert record.default_threshold == 0.5
    assert record.cost["roundTripPoints"] == pytest.approx(1.39)


# ─── The daily XGBoost classifier on the lake's bar grid ────────────────────


def _fixture_lake(symbol: str, timeframe: str, first_second: int, last_second: int) -> dict:
    """The lake read replaced by the bars the fixture's lens was built from."""
    bars = pl.read_parquet(DAILY_FIXTURE / "lens" / "bars.parquet")
    out = {"timestamp": bars["timestamp_seconds"].to_numpy().astype(np.int64)}
    for name in ("open", "high", "low", "close", "volume"):
        out[name] = bars[name].to_numpy().astype(np.float64)
    return out


def test_daily_classifier_is_rebuilt_on_the_bar_grid(monkeypatch) -> None:
    monkeypatch.setattr(adapters, "_lake_series", _fixture_lake)
    record = load_record(DAILY_FIXTURE)
    diagnostics = json.loads((DAILY_FIXTURE / "diagnostics.json").read_text(encoding="utf-8"))
    predictions = pl.read_parquet(DAILY_FIXTURE / "oos_predictions.parquet")

    failed = [f"{c['name']}: {c['measured']}" for c in record.verification if not c["passed"]]
    assert failed == []
    assert record.source_schema == "probability_parquet"
    assert record.reference["tradeCount"] == len(diagnostics["pnl_curve"]["trade_pnl_dollars"])
    # Every prediction sits on its own bar; the bars between carry none.
    assert int(np.isfinite(record.probability_up).sum()) == predictions.height
    assert int(np.isfinite(record.label).sum()) == predictions.height
    assert record.row_count > predictions.height
    assert np.array_equal(
        record.timestamp_seconds[record.prediction_rows], predictions["ts"].to_numpy()
    )
    # The cost the evaluator charged, recovered from its own trades.
    assert "recovered from this model's" in record.cost["source"]
    replay = adapters.entry_rows(
        record.probability_up, record.default_threshold, record.horizon_bars
    )
    point_value = record.cost["pointValueUsd"]
    round_trip = record.cost["roundTripPoints"] * point_value
    net = [
        (record.close[i + record.horizon_bars] - record.close[i]) * direction * point_value
        - round_trip
        for i, direction in replay
    ]
    assert np.allclose(net, diagnostics["pnl_curve"]["trade_pnl_dollars"], atol=1e-6)


def test_daily_classifier_is_refused_when_the_lake_misses_a_bar(monkeypatch) -> None:
    dropped = int(pl.read_parquet(DAILY_FIXTURE / "oos_predictions.parquet")["ts"][10])

    def missing_one(*args) -> dict:
        lake = _fixture_lake(*args)
        keep = lake["timestamp"] != dropped
        return {name: values[keep] for name, values in lake.items()}

    monkeypatch.setattr(adapters, "_lake_series", missing_one)
    with pytest.raises(Refusal, match="only"):
        load_record(DAILY_FIXTURE)


# ─── The interval ───────────────────────────────────────────────────────────


def test_a_bar_without_a_prediction_gets_no_interval() -> None:
    rng = np.random.default_rng(7)
    n = 2_000
    probability = rng.uniform(0.2, 0.8, n)
    realized = rng.normal(0.0, 10.0, n)
    probability[1_500:1_520] = np.nan
    realized[1_500:1_520] = np.nan
    quantiles, _ = causal_conformal_quantiles(probability, realized, 5)
    assert np.isnan(quantiles[1_500:1_520]).all()
    assert np.isfinite(quantiles[1_600]).all()


# ─── A real run, when this checkout carries it ──────────────────────────────


@pytest.mark.skipif(
    not REAL_RUN.is_dir(),
    reason="data/models run not present in this checkout (data/ is gitignored)",
)
def test_real_run_that_trades_every_prediction() -> None:
    record = load_record(REAL_RUN)
    scoreboard = _scoreboard(REAL_RUN)
    failed = [f"{c['name']}: {c['measured']}" for c in record.verification if not c["passed"]]
    assert failed == []
    labelled, accuracy, brier, auc = _direction_scores(record)
    assert labelled == scoreboard["barsScored"]
    assert accuracy == pytest.approx(scoreboard["metrics"]["accuracy"], abs=1e-12)
    assert brier == pytest.approx(scoreboard["metrics"]["brier_score"], abs=1e-6)
    assert auc == pytest.approx(scoreboard["metrics"]["roc_auc"], abs=1e-6)
    assert record.default_threshold == 0.5
