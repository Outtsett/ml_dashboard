"""Optuna tuning for the Model Cycle.

Runs only on the FIRST kept fold's training window, which precedes every outer
test span, so tuning never sees a bar the test walk will be scored on.

Inside that window: an expanding inner walk-forward with ``tuning_folds``
validation blocks. The window's rows are cut into ``tuning_folds + 1`` equal
chunks; block b (1..B) trains on chunks 0..b-1 and is scored on chunk b, with
``label_horizon_bars`` rows purged between them. The model's own early-stopping
split is carved (and purged) from the end of the inner training rows, so the
scored block is never used for model selection.

Objective per block (``tuning_objective``):
    sharpe_ratio  maximise — the real simulator trades the block with the run's
                  trading rules and costs; an undefined Sharpe (no variation,
                  e.g. no trades) scores 0.0, "no edge"
    log_loss      minimise — on the block's labelled, predictable bars
    f1_score      maximise — likewise; an undefined F1 scores 0.0
The trial value is the MEDIAN over blocks. Each block is reported to the
MedianPruner (``n_startup_trials=3``), sampler TPE seeded with ``seed``.
"""

from __future__ import annotations

import json
import math
from typing import TYPE_CHECKING

import numpy as np

from cycle.adapter import StopRequested
from cycle.features import history_valid
from cycle.metrics import classification_metrics, sharpe_ratio
from cycle.simulate import Simulator
from shared import protocol

if TYPE_CHECKING:
    from cycle.engine import CycleEngine, FoldSpec

DIRECTIONS = {"sharpe_ratio": "maximize", "log_loss": "minimize", "f1_score": "maximize"}


def inner_blocks(window_start: int, window_end: int, block_count: int, purge: int) -> list[tuple[np.ndarray, np.ndarray]]:
    """[(inner training rows, scored rows)] for an expanding inner walk-forward."""
    edges = np.linspace(window_start, window_end, block_count + 2).astype(np.int64)
    blocks = []
    for b in range(1, block_count + 1):
        train_rows = np.arange(window_start, max(window_start, int(edges[b]) - purge), dtype=np.int64)
        scored_rows = np.arange(int(edges[b]), int(edges[b + 1]), dtype=np.int64)
        blocks.append((train_rows, scored_rows))
    return blocks


def simulate_block(engine: CycleEngine, rows: np.ndarray, probability: dict[int, float]) -> np.ndarray:
    """Per-bar net USD of the run's trading rules over contiguous ``rows``."""
    s = engine.settings
    d = engine.data
    simulator = Simulator(
        engine.cost, contracts=s.contracts, holding_bars=s.resolved_holding_bars,
        stop_loss_ticks=s.stop_loss_ticks, take_profit_ticks=s.take_profit_ticks, long_only=s.long_only,
    )
    nets = np.zeros(rows.size, dtype=np.float64)
    for j, i in enumerate(rows):
        i = int(i)
        p = probability.get(i)
        signal = None if p is None else (1 if p >= 0.5 else -1)
        last = j == rows.size - 1
        result = simulator.step(i, int(d.timestamps[i]), d.open[i], d.high[i], d.low[i], d.close[i], signal, p, decide=not last)
        nets[j] = result.net_usd
        if last:
            nets[j] += simulator.flatten(i, int(d.timestamps[i]), float(d.close[i]), "fold_end")
    return nets


def _block_objective(engine: CycleEngine, objective: str, adapter, scored_rows: np.ndarray) -> float:
    valid = history_valid(engine.features, int(adapter.minimum_history()))
    predictable = scored_rows[valid[scored_rows]]
    probabilities = (
        np.asarray(adapter.predict_probability(engine.features, predictable), dtype=np.float64)
        if predictable.size else np.empty(0)
    )
    by_row = {int(row): float(p) for row, p in zip(predictable, probabilities) if math.isfinite(p)}
    if objective == "sharpe_ratio":
        value = sharpe_ratio(simulate_block(engine, scored_rows, by_row), engine.periods_per_year)
        return 0.0 if value is None else float(value)
    labelled = [row for row in by_row if math.isfinite(engine.labels[row])]
    if not labelled:
        raise ValueError("the scored block has no labelled, predictable bars")
    actual = np.array([int(engine.labels[row]) for row in labelled])
    p = np.array([by_row[row] for row in labelled])
    metrics = classification_metrics(actual, (p >= 0.5).astype(np.int64), p)
    value = metrics["log_loss"] if objective == "log_loss" else metrics["f1_score"]
    return 0.0 if value is None else float(value)


def run_tuning(engine: CycleEngine, spec: FoldSpec) -> dict:
    """Tune on ``spec``'s training window; returns the model parameters to use
    for every outer fold (the best trial's suggestions over the user's)."""
    import optuna

    s = engine.settings
    if engine.suggest_parameters is None:
        raise RuntimeError("tuning needs suggest_parameters from the model family")
    objective = s.tuning_objective
    if objective not in DIRECTIONS:
        raise ValueError(f"unknown tuning objective {objective!r}")
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction=DIRECTIONS[objective],
        sampler=optuna.samplers.TPESampler(seed=s.seed),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=3),
    )
    base = dict(engine.parameters)
    trial_count = int(s.tuning_trials)
    block_count = max(1, int(s.tuning_folds))
    blocks = inner_blocks(spec.window_start, spec.window_end, block_count, engine.horizon)
    ts = engine.data.timestamps
    engine.log(
        f"[tune] {trial_count} trials, objective {objective} ({DIRECTIONS[objective]}, median of {block_count} inner blocks) "
        f"on the first fold's training window {engine_time(ts[spec.window_start])}..{engine_time(ts[spec.window_end - 1])}"
    )
    engine.set_phase("tuning", trial=0, trial_count=trial_count,
                     span_start=int(ts[spec.window_start]), span_end=int(ts[spec.window_end - 1]))
    merged_by_trial: dict[int, dict] = {}

    for number in range(trial_count):
        trial = study.ask()
        protocol.set_active_trial(trial.number)
        parameters = engine.suggest_parameters(trial, base)
        merged_by_trial[trial.number] = parameters
        prefix = f"[tune trial {trial.number + 1}/{trial_count}]"
        best_value, best_trial = _best(study)
        protocol.emit_cycle_trial(
            trial=trial.number, trial_count=trial_count, state="running", parameters=trial.params,
            objective_name=objective, best_value=best_value, best_trial=best_trial,
        )
        engine.log(f"{prefix} start {json.dumps(trial.params, default=str)}")
        values: list[float] = []
        state = "complete"
        value: float | None = None
        try:
            for b, (train_rows, scored_rows) in enumerate(blocks):
                engine.checkpoint()
                adapter = engine.adapter_factory(dict(parameters))
                valid = history_valid(engine.features, int(adapter.minimum_history()))
                fit_rows, early_stop_rows = _split(train_rows, s.validation_fraction, engine.horizon)
                fit_index = fit_rows[valid[fit_rows] & np.isfinite(engine.labels[fit_rows])]
                early_index = early_stop_rows[valid[early_stop_rows] & np.isfinite(engine.labels[early_stop_rows])]
                if fit_index.size < 20 or early_index.size < 5:
                    raise ValueError(f"inner block {b + 1} has too few labelled rows ({fit_index.size} to fit, {early_index.size} to early-stop)")

                def progress(fraction: float, number=number, b=b) -> None:
                    overall = (number + (b + fraction) / len(blocks)) / trial_count
                    engine.tuning_progress(overall)

                from cycle.engine import EngineReporter

                reporter = EngineReporter(
                    engine, fold_index=None, train_index=fit_index, validation_index=early_index,
                    trial=trial.number, trial_count=trial_count, log_prefix=prefix, progress=progress,
                )
                engine.emit_cursor(force=True, span_start=int(ts[train_rows[0]]), span_end=int(ts[train_rows[-1]]),
                                   trial=trial.number, trial_count=trial_count,
                                   phase_fraction=(number + b / len(blocks)) / trial_count)
                adapter.fit(engine.features, engine.labels, fit_index, early_index, ts, reporter)
                block_value = _block_objective(engine, objective, adapter, scored_rows)
                values.append(block_value)
                engine.log(
                    f"{prefix} block {b + 1}/{len(blocks)} scored {engine_time(ts[scored_rows[0]])}..{engine_time(ts[scored_rows[-1]])} "
                    f"{objective}={block_value:.4f}"
                )
                trial.report(block_value, b)
                if trial.should_prune():
                    raise optuna.TrialPruned()
            value = float(np.median(values))
            study.tell(trial, value)
        except optuna.TrialPruned:
            state = "pruned"
            study.tell(trial, state=optuna.trial.TrialState.PRUNED)
        except StopRequested:
            study.tell(trial, state=optuna.trial.TrialState.FAIL)
            protocol.emit_cycle_trial(
                trial=trial.number, trial_count=trial_count, state="failed", parameters=trial.params,
                objective_name=objective, best_value=_best(study)[0], best_trial=_best(study)[1],
            )
            raise
        except Exception as error:  # noqa: BLE001 - one bad trial must not end the run
            state = "failed"
            study.tell(trial, state=optuna.trial.TrialState.FAIL)
            engine.log(f"{prefix} failed: {error}", "warn")
        best_value, best_trial = _best(study)
        protocol.emit_cycle_trial(
            trial=trial.number, trial_count=trial_count, state=state, parameters=trial.params,
            objective_name=objective, objective_value=value, best_value=best_value, best_trial=best_trial,
        )
        engine.trial_records.append({
            "trial": trial.number, "state": state, "objective_name": objective, "objective_value": value,
            "block_values": json.dumps(values), "parameters": json.dumps(trial.params, default=str),
            "best_value": best_value, "best_trial": best_trial,
        })
        engine.log(
            f"{prefix} {state}" + (f" {objective}={value:.4f}" if value is not None else "")
            + (f" best={best_value:.4f} (trial {best_trial + 1})" if best_value is not None and best_trial is not None else "")
        )
        engine.tuning_progress((number + 1) / trial_count)
    protocol.set_active_trial(None)

    best_value, best_trial = _best(study)
    if best_trial is None:
        engine.log("[tune] no trial completed; keeping the parameters you chose", "warn")
        engine.tuning_summary = {"bestTrial": None, "bestValue": None, "parameters": base}
        return base
    best = merged_by_trial[best_trial]
    engine.tuning_summary = {"bestTrial": best_trial, "bestValue": best_value, "parameters": best,
                             "suggested": study.best_trial.params}
    engine.log(f"[tune] best trial {best_trial + 1}: {objective}={best_value:.4f}; every fold uses {json.dumps(best, default=str)}")
    return best


def _best(study) -> tuple[float | None, int | None]:
    try:
        trial = study.best_trial
    except ValueError:
        return None, None
    return float(trial.value), int(trial.number)


def _split(rows: np.ndarray, validation_fraction: float, purge: int) -> tuple[np.ndarray, np.ndarray]:
    from cycle.engine import split_window

    return split_window(rows, validation_fraction, purge)


def engine_time(timestamp) -> str:
    from cycle.engine import format_time

    return format_time(timestamp)
