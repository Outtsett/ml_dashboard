# Model Cycle: audit, the complete run record, hyperparameters by modeling, tick-grid forecasts, the whole catalog

**Date:** 2026-09-26 (night). **Branch:** `feat/realtime-dashboard-redesign`.
**Ask (Tyler, from voice):** "audit the model cycle. Also I want everything that the model does: every single
individual run, metrics, predictions, everything. I also want the hyperparameters to not be so manually
configurable but we actually do the hyperparameters, actual modeling. Then when it comes to forecasting we got to
make sure that the model doesn't forecast anything else besides the actual ticker's tick size. I want you to
complete setting up all models into the [Cycle] based off the catalog."

## Goal

1. **Audit** the Model Cycle (`/cycle`) end to end and land the findings as a queryable record.
2. **Record everything**: every run, every bar the model read, every prediction, forecast, trade, fold, epoch,
   trial and metric lands in the lake under one dataset, survives a crash mid-run, and any past run can be reopened
   on the page and read in a notebook.
3. **Hyperparameters by modeling**: the default run tunes its hyperparameters with Optuna inside every walk-forward
   fold on that fold's own training window; the form asks for a budget, not forty numbers; every trial and the
   values used per fold are recorded and shown.
4. **Tick-grid forecasts**: a predicted price is always a multiple of the instrument's tick size, at the one place
   the forecast is computed, so the chart, the metrics and the record agree. Stop and take-profit levels too.
5. **Whole catalog**: every written catalog spec is either a runnable Cycle model (with parameters and a search
   space) or explicitly listed as unavailable with the reason; the cost model prices all eight futures roots.

## What research found (2026-09-26, four strands)

**Persistence.** The server keeps five runs in RAM (`src/server/training/cycle.ts`, `MAX_TRACKED_RUNS = 5`);
`recordTrainingEvent` drops every `cycle_*` event; SQLite gets the session row, fold metrics and epoch losses only.
The Python process already writes `data/models/<id>/{config,folds,scoreboard,diagnostics}.json` +
`{predictions,trades,epochs,trials,folds_table}.parquet` (`src/ml/cycle/store.py`) and lands THREE tables
(`predictions`, `trades`, `folds`) to `s3://derived/model_cycle_runs/recipe=<run>/table=…` at run end through a
datalake-interpreter subprocess (the dashboard venv lacked `upath`; `universal-pathlib` added 2026-09-26). 29 runs
are in the lake (76,346 prediction rows). Missing from the lake: the run itself (plan, parameters, tuning, final
scoreboard), the bars read, epochs, trials, the metric stream. Nothing lands until the end, and `run()` catches only
`StopRequested`, so any other exception writes no record at all (`engine.py:639-646`); a `tsx --watch` restart
tree-kills the child (`pythonRunner.ts:496-516`).

**Tuning.** `src/ml/cycle/tuning.py` is real Optuna 4.8 (TPE seeded, MedianPruner, ask/tell loop, cost-aware
`sharpe_ratio` objective through the real simulator, median over inner blocks, purged). It runs ONCE on fold 0's
window and reuses the result for every fold (`engine.py:687-691`); `tuning_trials` defaults to 0; the `cycle_plan`
parameters are emitted before tuning and never corrected; the server strips the `search` block before the client
sees it (`cycleRunners.ts:54`); the eight legacy families' ranges live only in Python (`models.py:257-316`). 65 of
152 registry parameters carry a `search` block. XGBoost fits in 0.2-1.4 s on the default 5m fold: 20 trials × 2
inner blocks is about a minute.

**Tick size.** `engine.py:999-1010` computes `predicted_close = close + output × scale` unrounded: 5,307 of 5,307
forecasts in run `…20260925T190715` are off the grid. Stop / take-profit levels are `entry ± ticks × tick_size` with
a 0.5-tick step, so a 2.5-tick stop fills at an unquotable price. Fills and roll steps are on the grid (every MNQ
close in three lake tables checked, 0 off-grid).

**Engine audit (other findings).** `position` on the wire and in parquet is the NEXT bar's target, not the position
held; a failed contract lookup continues on spliced prices with a warning; labels, price targets and holding
periods ignore session breaks (2.2% of 5m test labels span one, the largest test gap is 49 h); stacking's
out-of-fold predictions use an unpurged `KFold`; models with no search space would run N identical trials. Verified
correct: purge = h at every edge (asserted), measured feature causality, next-open fills, labels revealed only at
i+h, back-adjustment applied once before everything. The uncommitted "Inside the model" work: 474 tests pass, all 32
runnable registry models construct; `test_cycle_networks.py` exits 0xC0000409 at interpreter teardown (cuDNN DLL
detach, the crash `main.py` already works around).

**Catalog:** see `derived_model_cycle_audit_coverage` once landed (this plan is amended with it).

## Design

### Run record (`s3://derived/model_cycle_runs/recipe=<run_id>/table=<name>/part-0.parquet`)

| table | one row per | content |
|---|---|---|
| `runs` | run | symbol, timeframe, model key, catalog spec, implementation, device, bar_count, bars_per_year, label horizon / threshold, purge, embargo, tick_size, point_value_usd, round_trip_cost_usd, trading rules, tuning mode / budget / objective / inner blocks, started_at, finished_at, status (complete / stopped / failed), error, elapsed_seconds, price_adjustment_json, feature_names_json, parameters_json, plan_json, the 30 final scoreboard metrics as columns |
| `bars` | bar the model read (each exactly once) | timestamp, fold_index, role (context / processed), open, high, low, close, volume, roll_adjustment_points |
| `predictions` | processed test bar | today's columns; `position` split into `position_held` and `target_position`; `bar_net_profit_usd`, `exposed`; `predicted_close` on the tick grid with `predicted_move_points` consistent |
| `trades` | trade | today's |
| `folds` | fold | today's + `parameters_json`, `tuning_best_trial`, `tuning_best_value`, `tuning_trial_count`, `status` |
| `epochs` | training step summary | today's local table |
| `trials` | Optuna trial | today's + `fold_index` |
| `metrics` | emitted metric | metric_name, metric_value, iteration, total, fold_index, trial |

Written in-process with `lake.layout` (pyarrow, zstd 9); the subprocess fallback kept. Landed at the end of every
fold and at run end, and on failure (`run()` catches every exception, writes the record with `status = failed`,
re-raises). `part-0.parquet` is overwritten (idempotent by recipe and table); the manifest line is appended once per
table per run. The dashboard's `derived_model_cycle_runs_<table>` views pick each landing up on refresh.

Server: `GET /api/training/cycle` lists lake runs (`derived_model_cycle_runs_runs`) beside the live ones;
`GET /api/training/cycle/:modelId` rebuilds a snapshot from the landed tables when the run is no longer in memory,
so any past run reopens on the page. Notebook `notebooks/model_cycle_runs.py` (ml-dashboard group): run picker,
every table graphed, eight numbers per column, the audit tables.

### Hyperparameters by modeling

- `tuning_mode` (`tuned` default | `reviewed_defaults`), `tuning_budget_trials` (20; torch families 8),
  `tuning_budget_seconds` (0 = trials only; a wall-clock cut inside the ask/tell loop), `tuning_objective`
  (sharpe_ratio, cost-aware, unchanged), `tuning_folds` (inner blocks, 2). Declared in `_cycle.json`; `main.py`
  flags and `EngineSettings` follow.
- Nested: `run_tuning(engine, spec)` runs inside `_run_fold` on that fold's training window; trials carry
  `fold_index`; a `cycle_parameters` event (fold, parameters, source tuned / reviewed_defaults / pinned, best trial,
  best value, trial count) is emitted after each fold's choice and stored per fold; the fold record carries them.
- Every search space in JSON: the eight legacy families' ranges ported from `models.py` into their `search` blocks;
  `catalog.suggest_parameters` drives all models; a parity test pins the ported ranges to the old Python ones.
  Pins: `--pin name` (repeatable) keeps a typed value out of the sampler. A model with no search space refuses a
  tuned run with a reason and falls back to reviewed defaults.
- Client: the server ships `search`; the Model group shows each tunable parameter's range with a pin checkbox,
  editable only when pinned; the Tuning group is the budget; the Curves pane gets a fold selector and the caption
  "search score on the fold's inner validation blocks, optimistic by construction (N trials)"; each fold's row shows
  the parameters it used.

### Tick grid

`round_to_tick(price, tick_size)` in `src/ml/cycle/simulate.py` (round half away from zero on the tick index);
applied where the forecast is made: `predicted_close = round_to_tick(close + output × scale)`,
`predicted_move_points = predicted_close − close`, so `_resolve_forecast`, the `cycle_bars` event,
`predictions.parquet` and the chart share one number. Stop and take-profit levels are rounded to the grid in the
adverse direction (a stop never fills better than a quotable price). A test walks a fold and asserts every emitted
`predictedClose`, fill and level is on the grid.

### Labels across session gaps

A label, price target or forecast whose horizon crosses a gap longer than `gap_bars × median bar interval`
(default 3) is NaN: the model is not asked to predict across a weekend or an outage. The plan reports how many bars
that removed.

### Catalog coverage

Every written spec is classified: runnable (an entry with `direction` / `price` estimators, parameters, `search`),
or unavailable with a reason in `_cycle.json`. New entries are added per group file by a mechanical sweep under
one rule (exact library class, parameters from the estimator's signature with sane ranges, search blocks for the
ones that matter), gated by `crossCheckCycleRegistry`, the registry tests and a smoke fit of every runnable model on
real MNQ daily bars. `cost_model.json` gains ES, NQ, YM, RTY, MES, MYM, M2K from the published fee schedule.

## Parts and order

1. Commit the uncommitted "Inside the model" work as its own commit (historical record) with its red vitest fixed.
2. Engine: tick grid, crash-safe record, position held, contract-lookup failure, session-gap labels.
3. Per-fold tuning, budget controls, JSON search spaces, pins, `cycle_parameters` event, `search` to the client,
   form redesign.
4. Full record: store tables, in-process landing per fold, server fallback + lake run list, client run picker.
5. Cost model for eight roots; `simulate.py` accepts them.
6. Catalog sweep (Workflow: one agent per group file, one rule, test-gated), unavailable reasons for the rest.
7. Audit tables landed (`derived_model_cycle_audit_{findings,coverage}`) + notebook.
8. Adversarial review workflow over the whole diff (correctness, leakage, quant-finance, persistence lenses);
   fixes; docs; commit; push; GUI check.

## Done means

- `pytest tests/test_cycle_*.py` green; vitest for the cycle store, schemas, accumulator, runners green; `tsc`
  clean; `verify.mjs` clean on touched files.
- A run started from the dashboard lands all eight tables; killing the process mid-run leaves every finished fold
  in the lake; reopening the run id after a server restart rebuilds the page from the lake.
- Every `predictedClose` in `derived_model_cycle_runs_predictions` for new runs satisfies `close / tick` integral.
- Every written catalog spec is runnable or has a reason; every runnable model smoke-fits.
- The notebook opens from the dashboard and shows the audit and the runs.
