# Model Cycle: the run record, hyperparameters by modeling, the tick grid, session gaps, the archive

Written 2026-09-27 after the audit of 2026-09-26 (`docs/plans/2026-09-26-model-cycle-record.md`; the findings
are landed as `derived_model_cycle_audit_{findings,coverage,record}`; the notebook is
`notebooks/model_cycle_runs.py`, ML Dashboard group).

## Think of it as

The Model Cycle is a trading desk that hires one model at a time, trains it on a window of bars, then makes it
trade the next window one bar at a time while a clerk writes everything down. Until 2026-09-26 the clerk's notebook
was kept in the dashboard's memory (five runs, gone on restart) and three pages of it were copied to the lake at
the end; a crash mid-run threw the whole notebook away. Now the clerk copies every page to the lake at the end of
every fold, and any run can be reopened from those pages.

## The record (`s3://derived/model_cycle_runs/recipe=<run>/table=<name>/part-0.parquet`)

Written by `src/ml/cycle/store.py write_run()` at the end of every fold (status `running`) and at the end of the
run (status `complete`, `stopped` or `failed`; `engine.run()` writes it even when the run raised, then re-raises).
Each write replaces the previous parquet (the record is idempotent by run); the manifest line for a table is
appended once per run to `meta/ingest_manifests/model_cycle_runs.jsonl`, which is what defines the dashboard's
`derived_model_cycle_runs_<table>` views (refreshed when a run ends and on boot). The recipe spells the runner
key's `+` as `_`.

| table | one row per | what is in it |
|---|---|---|
| `runs` | the run | symbol, timeframe, model key, catalog spec, status, error, started/finished, bar counts, label horizon and gap rule, purge, embargo, fold plan settings, tick size and cost model, trading rules, tuning mode / budget / objective / pins, price adjustment, base parameters, the plan as JSON, the 30 final scoreboard metrics as columns |
| `bars` | every bar the model read, each exactly once | timestamp, fold, role (`context` / `processed`), roll-adjusted OHLCV, `roll_adjustment_points` |
| `predictions` | every processed test bar | P(up), predicted direction, `target_position` (wanted at the next open) and `position_held` (carried through the bar), `bar_net_profit_usd`, `exposed`, equity, actual direction, correct, `predicted_move_points` (on the tick grid), `predicted_move_raw_points` (the model's own number), `predicted_close`, `forecast_timestamp`, `forecast_error_points`, `crosses_gap` |
| `trades` | every trade | side, contracts, fills, bars held, P(up) at entry, gross, cost, net, exit reason |
| `folds` | every fold | spans, bar counts, timings, metrics, model paths, status, `parameters` (what the fold's models were fitted with), tuning objective / trial count / best trial / best value |
| `epochs` | every training step summary | fold, trial, model role, epoch, losses, accuracy, F1, learning rate, gradient norm, is_best |
| `trials` | every Optuna trial | fold, trial, state, objective, value, block values, parameters, best so far |
| `metrics` | every emitted `metric` event | name, value, iteration, total, fold, trial, seconds elapsed |

The same tables sit locally under `data/models/<run>/` beside `config.json`, `folds.json`, `scoreboard.json`,
`diagnostics.json`, the saved models and the `explain/` inputs.

**Reopening a run.** `GET /api/training/cycle` lists the live accumulator's runs and every archived run;
`GET /api/training/cycle/:modelId` returns the live snapshot or rebuilds one from the lake
(`src/server/training/cycleArchive.ts`). The `/cycle` page has a run picker; picking a finished run draws its
bars, trades, folds, curves, trials and parameters. Runs landed before 2026-09-27 have only predictions, trades
and folds: they reopen without a plan (no fold bands) and without the terminal.

## Hyperparameters by modeling

`tuning_mode` defaults to `tuned`: inside EVERY fold, Optuna (TPE seeded by `seed + fold`, `MedianPruner`)
searches the model's `search` spaces on that fold's own training window — an expanding inner walk-forward of
`tuning_folds` blocks, purged by the label horizon, scored by `tuning_objective` (default `sharpe_ratio`, run
through the real simulator with the run's costs; the trial value is the median over blocks) — and the fold's
models are fitted with the best trial's values over the run's base values. The budget is `tuning_budget_trials`
per fold (20) and/or `tuning_budget_seconds` (0 = trials only; the trial in progress finishes). `reviewed_defaults`
is the explicit opt-out. `tuning_pinned_parameters` (comma-separated) holds a dial at the value typed for the run.
A model with no searchable parameter is not searched, and says so.

Every search space lives in the registry JSON (`src/config/cycle_models/*.json`, a `search` block per parameter:
`{"kind": "int" | "float" | "categorical", "low", "high", "log"?, "choices"?}`); the eight legacy families' ranges
moved there from Python on 2026-09-26. Training length (epochs, boosting rounds, tree count, solver iterations,
patience, early-stopping rounds) and `sequence_length` are never searched. The server ships each parameter's
`search` block to the form: a tuned run's form shows the searched dials in the Tunables panel (range, pin, pinned
value) and only the unsearched ones as typed fields.

On the wire: `cycle_trial` carries `foldIndex`; a `cycle_parameters` event per fold announces the values used
(`source`: `tuned`, `manual` or `reviewed_defaults`, the best trial and its search score, the pins). The Curves
pane shows the selected fold's trials under the caption that a search score is optimistic by construction; the
Folds pane shows each fold's parameters chip.

## The tick grid

`round_to_tick(price, tick_size)` (`src/ml/cycle/simulate.py`; ties away from zero; rounded to the grid's own
decimals so a 0.1 grid prints `2000.1`) is applied where the forecast is made: `predicted_close` is the nearest tick
to `close + output × scale`, and `predicted_move_points = predicted_close − close`, so the chart, the metrics, the
record and the explainer carry one number; the model's own move is kept as `predicted_move_raw_points`, which the
explainer's parity gate (G1) reads. Stop and take-profit levels are rounded onto the grid in the adverse direction
(`level_on_tick`). Fills are lake prices, which sit on the grid; roll steps are tick multiples.

## Session gaps

`label_gap_multiple` (default 3, cycle-wide, Labels group): a bar whose label horizon crosses a gap longer than
that many typical bar intervals (the median spacing) — a session break, a weekend, an outage — gets no label, no
price target and no forecast (`horizon_crosses_gap` in `src/ml/cycle/labels.py`). The plan reports the count
(`gapCrossingBarCount`), `predictions.crosses_gap` marks the bars, and such a bar is not scored when its horizon
elapses. Trading continues through the gap: the rule is about what the model is asked to predict, not about
flattening.

## Costs

`src/config/cost_model.json` prices all eight lake roots (MNQ, MES, MYM, M2K, ES, NQ, YM, RTY); provenance in
`docs/contract-specifications.md` (exchange fees from the CME/CBOT pass-through pages, NFA $0.01 per side until
2027-07-01, the account's clearing / CQG / commission figures applied to every root as a stated assumption).

## Models from the catalog

The registry claims 34 catalog specs with 33 entries (32 runnable; ordinal regression needs three classes). The
eight specs the audit found implementable were built as their own modules, one per spec, registered through
`cycle.networks.NETWORK_EXTENSION_MODULES` (`src/ml/cycle/networks_extra/<kind>.py`: mixture of experts,
recurrent-convolution hybrid, hypernetwork, neural Turing machine, dual-pathway network) and
`cycle.models.ADAPTER_CLASSES` (`src/ml/cycle/adapters_extra/<key>.py`: tree-boosted neural embedding,
attention-weighted forecast stack, Bayesian neural hybrid), each with a registry file
`src/config/cycle_models/<key>.json`, a test `tests/test_cycle_extra_<key>.py` and its simplifications written in
the entry's `implementationNote`. The stacked-ensemble spec is an alias of `stacked_generalization`. Every other
written spec (generative, self-supervised, semi-supervised, unsupervised, graph, image, agent and planner
architectures) carries its reason in `_cycle.json`. A model with no Inside view yet has `explainKind: "opaque"`
and the panel says so.

## Verification

`pytest tests/test_cycle_*.py` (the engine, tuning, record, explainer parity, adapters, networks; `tests/conftest.py`
exits the process cleanly after CUDA), `vitest` for the wire schema, parser, accumulator, runners, registry and the
client cycle panels; `tsc`; every `predictedClose` of a new run satisfies `close / tick_size` integral (asserted in
`tests/test_cycle_engine.py`).
