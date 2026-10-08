"""Optuna tuning for the Model Cycle.

Runs INSIDE EVERY FOLD, on that fold's own TRAIN span (the training window up
to its last train row; the outer validation rows are left out), which precedes
the fold's test span, so tuning never sees a bar the test walk will be scored
on, and a regime change between folds is met with a search on that fold's own
bars rather than fold 0's choice reused everywhere. The outer validation rows
stay out of every trial because they then choose the fold model's best epoch
(and fit a stacked combiner or a from-price curve): a trial scored on them
would make that choice, and the validation numbers the record carries, in-sample.
``split_window`` already purges the label horizon between the train and
validation rows, so no inner label resolves inside the validation span.

Budget: ``tuning_budget_trials`` trials per fold, and/or
``tuning_budget_seconds`` of wall clock per fold (whichever comes first; a
trial already running finishes). ``pinned`` names are held out of the search
at the run's own value. A model with no searchable parameter is not tuned
(the engine says so and uses the reviewed defaults).

Inside that span: an expanding inner walk-forward with ``tuning_folds``
validation blocks. The span's rows are cut into ``tuning_folds + 1`` equal
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
from shared import protocol

from cycle.adapter import StopRequested
from cycle.features import history_valid
from cycle.metrics import classification_metrics, sharpe_ratio
from cycle.simulate import Simulator

if TYPE_CHECKING:
    from cycle.engine import CycleEngine, FoldSpec

DIRECTIONS = {"sharpe_ratio": "maximize", "log_loss": "minimize", "f1_score": "maximize"}
# with a time budget and no trial budget, the loop is bounded by this many trials
TRIALS_WHEN_ONLY_SECONDS = 10_000


def inner_blocks(window_start: int, window_end: int, block_count: int, purge: int) -> list[tuple[np.ndarray, np.ndarray]]:
    """[(inner training rows, scored rows)] for an expanding inner walk-forward."""
    edges = np.linspace(window_start, window_end, block_count + 2).astype(np.int64)
    blocks = []
    for b in range(1, block_count + 1):
        train_rows = np.arange(window_start, max(window_start, int(edges[b]) - purge), dtype=np.int64)
        scored_rows = np.arange(int(edges[b]), int(edges[b + 1]), dtype=np.int64)
        blocks.append((train_rows, scored_rows))
    return blocks


def simulate_block(engine: CycleEngine, rows: np.ndarray, probability: dict[int, float],
                   gate: dict[int, bool] | None = None) -> np.ndarray:
    """Per-bar net USD of the run's trading rules over contiguous ``rows``. ``gate`` (a model
    with its own trade gate) closes a row: its call stands aside (signal 0), as in the walk."""
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
        if signal is not None and gate is not None and not gate.get(i, True):
            signal = 0
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
    gate_of = getattr(adapter, "trade_gate", None)
    gate = None
    if callable(gate_of) and predictable.size:
        gate = {int(row): bool(opened) for row, opened in zip(predictable, np.asarray(gate_of(engine.features, predictable), dtype=bool))}
    if objective == "sharpe_ratio":
        # the trading rule reads P(up): a reversal model's P(turn) is converted exactly as the
        # walk converts it (`engine.probability_up`), and a bar with no call is not traded
        traded = {row: converted for row, converted in ((row, engine.probability_up(p, row)) for row, p in by_row.items())
                  if converted is not None}
        value = sharpe_ratio(simulate_block(engine, scored_rows, traded, gate), engine.periods_per_year)
        return 0.0 if value is None else float(value)
    # log loss and F1 score the model against the label it was fitted on (P(turn) against the
    # reversal label for a reversal model), so the raw probability is the right one here
    labelled = [row for row in by_row if math.isfinite(engine.labels[row])]
    if not labelled:
        raise ValueError("the scored block has no labelled, predictable bars")
    actual = np.array([int(engine.labels[row]) for row in labelled])
    p = np.array([by_row[row] for row in labelled])
    metrics = classification_metrics(actual, (p >= 0.5).astype(np.int64), p)
    value = metrics["log_loss"] if objective == "log_loss" else metrics["f1_score"]
    return 0.0 if value is None else float(value)


def run_tuning(engine: CycleEngine, spec: FoldSpec, *, trial_budget: int, seconds_budget: float = 0.0,
               pinned=()) -> tuple[dict, dict]:
    """Tune on ``spec``'s train span. Returns ``(parameters, summary)``:
    the model parameters the fold's models are fitted with (the best trial's
    suggestions over the run's base values; the base values when no trial
    completed) and the summary recorded for the fold."""
    import optuna

    s = engine.settings
    k = spec.fold_index
    fold_prefix = engine.fold_prefix(k)
    if engine.suggest_parameters is None:
        raise RuntimeError("tuning needs suggest_parameters from the model family")
    objective = s.tuning_objective
    if objective not in DIRECTIONS:
        raise ValueError(f"unknown tuning objective {objective!r}")
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction=DIRECTIONS[objective],
        sampler=optuna.samplers.TPESampler(seed=s.seed + k),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=3),
    )
    base = dict(engine.parameters)
    pinned = tuple(pinned or ())
    trial_count = int(trial_budget) if trial_budget > 0 else TRIALS_WHEN_ONLY_SECONDS
    deadline = engine.clock() + float(seconds_budget) if seconds_budget and seconds_budget > 0 else None
    block_count = max(1, int(s.tuning_folds))
    # the train span only: the outer validation rows choose the fold model's best epoch (see the docstring)
    tuning_end = int(spec.train_index[-1]) + 1 if spec.train_index.size else spec.window_end
    blocks = inner_blocks(spec.window_start, tuning_end, block_count, engine.horizon)
    ts = engine.data.timestamps
    budget_words = f"{trial_count} trials" if deadline is None else (
        f"up to {trial_count} trials or {float(seconds_budget):g} s" if trial_budget > 0 else f"{float(seconds_budget):g} s")
    engine.log(
        f"{fold_prefix}[tune] {budget_words}, objective {objective} ({DIRECTIONS[objective]}, median of {block_count} inner blocks) "
        f"on this fold's train span {engine_time(ts[spec.window_start])}..{engine_time(ts[tuning_end - 1])}"
        f" (its validation rows are left for choosing the fitted model's best epoch)"
        + (f"; pinned: {', '.join(pinned)}" if pinned else "")
    )
    engine.set_phase("tuning", fold_index=k, trial=0, trial_count=trial_count,
                     span_start=int(ts[spec.window_start]), span_end=int(ts[tuning_end - 1]))
    merged_by_trial: dict[int, dict] = {}
    trials_run = 0
    stopped_by_clock = False

    for number in range(trial_count):
        if deadline is not None and engine.clock() >= deadline:
            stopped_by_clock = True
            engine.log(f"{fold_prefix}[tune] time budget reached after {trials_run} trials")
            break
        trial = study.ask()
        protocol.set_active_trial(trial.number)
        parameters = _suggest(engine, trial, base, pinned)
        merged_by_trial[trial.number] = parameters
        prefix = f"{fold_prefix}[tune trial {trial.number + 1}/{trial_count}]"
        best_value, best_trial = _best(study)
        protocol.emit_cycle_trial(
            trial=trial.number, trial_count=trial_count, state="running", parameters=trial.params,
            objective_name=objective, best_value=best_value, best_trial=best_trial, fold_index=k,
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
                    engine.tuning_progress(k, overall)

                from cycle.engine import EngineReporter

                reporter = EngineReporter(
                    engine, fold_index=k, train_index=fit_index, validation_index=early_index,
                    trial=trial.number, trial_count=trial_count, log_prefix=prefix, progress=progress,
                )
                engine.emit_cursor(force=True, fold_index=k, span_start=int(ts[train_rows[0]]), span_end=int(ts[train_rows[-1]]),
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
                objective_name=objective, best_value=_best(study)[0], best_trial=_best(study)[1], fold_index=k,
            )
            raise
        except Exception as error:  # noqa: BLE001 - one bad trial must not end the run
            state = "failed"
            study.tell(trial, state=optuna.trial.TrialState.FAIL)
            engine.log(f"{prefix} failed: {error}", "warn")
        best_value, best_trial = _best(study)
        protocol.emit_cycle_trial(
            trial=trial.number, trial_count=trial_count, state=state, parameters=trial.params,
            objective_name=objective, objective_value=value, best_value=best_value, best_trial=best_trial, fold_index=k,
        )
        engine.trial_records.append({
            "fold_index": k,
            "trial": trial.number, "state": state, "objective_name": objective, "objective_value": value,
            "block_values": json.dumps(values), "parameters": json.dumps(trial.params, default=str),
            "best_value": best_value, "best_trial": best_trial,
        })
        trials_run += 1
        engine.log(
            f"{prefix} {state}" + (f" {objective}={value:.4f}" if value is not None else "")
            + (f" best={best_value:.4f} (trial {best_trial + 1})" if best_value is not None and best_trial is not None else "")
        )
        engine.tuning_progress(k, (number + 1) / trial_count)
    protocol.set_active_trial(None)
    engine.tuning_progress(k, 1.0)

    best_value, best_trial = _best(study)
    summary = {
        "foldIndex": k, "objective": objective, "trialCount": trials_run, "trialBudget": trial_count,
        "secondsBudget": float(seconds_budget or 0.0), "stoppedByClock": stopped_by_clock, "pinned": list(pinned),
        "innerBlockCount": block_count,
    }
    if best_trial is None:
        engine.log(f"{fold_prefix}[tune] no trial completed; this fold uses the run's own parameters", "warn")
        summary.update(bestTrial=None, bestValue=None, parameters=base, suggested={})
        return base, summary
    best = merged_by_trial[best_trial]
    summary.update(bestTrial=best_trial, bestValue=best_value, parameters=best, suggested=study.best_trial.params)
    engine.log(
        f"{fold_prefix}[tune] best trial {best_trial + 1} of {trials_run}: {objective}={best_value:.4f} on the inner "
        f"validation blocks (a search score, optimistic by construction); this fold uses {json.dumps(best, default=str)}"
    )
    return best, summary


def _suggest(engine: CycleEngine, trial, base: dict, pinned: tuple) -> dict:
    """Call the engine's suggest function. It takes (trial, base) or (trial, base, pinned);
    pins are refused, not dropped, when it cannot take them."""
    import inspect

    function = engine.suggest_parameters
    assert function is not None
    try:
        parameters = inspect.signature(function).parameters
        takes_pins = len(parameters) >= 3 or any(p.kind == p.VAR_POSITIONAL for p in parameters.values())
    except (TypeError, ValueError):
        takes_pins = True
    if takes_pins:
        return function(trial, base, pinned)
    if pinned:
        raise RuntimeError(f"pinned parameters {list(pinned)} were given, but this run's suggest function takes no pins")
    return function(trial, base)


def _best(study) -> tuple[float | None, int | None]:
    try:
        trial = study.best_trial
    except ValueError:
        return None, None
    return float(trial.value), int(trial.number)


def _split(rows: np.ndarray, validation_fraction: float, purge: int) -> tuple[np.ndarray, np.ndarray]:
    """One inner block's own chronological cut: the first part fits, the last
    ``validation_fraction`` early-stops.

    It is the same cut the fold itself uses, with no test block: an inner block lives
    entirely inside the fold's training window, and its trailing slice is the block the
    trial is scored on. So the test share is zero and the test block comes back empty;
    the ``purge`` rows between the two are the same rows the fold's own split charges.
    """
    from cycle.engine import split_window

    fit_rows, early_stop_rows, _test_rows, _discarded = split_window(rows, validation_fraction, 0.0, purge)
    return fit_rows, early_stop_rows


def engine_time(timestamp) -> str:
    from cycle.engine import format_time

    return format_time(timestamp)
