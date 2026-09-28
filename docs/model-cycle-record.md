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
key's `+` as `_`. An object store has no append and the dashboard's environment has no `s3fs`, so
`store._append_manifest_line` reads the manifest object, adds the line and writes the whole object back through
the same pyarrow filesystem the tables use; a line another writer overwrote is appended again (three attempts,
then an error), and a line already present is not written twice. A table whose manifest line did not land is
logged as a warning, not a debug line: without its line the table has no view.

`started_at_timestamp` is the wall clock when the engine was built (`engine.started_wall_clock`). Runs landed
before 2026-09-27 carry it as NULL; the archive reads their start from the UTC stamp in the run id
(`…_20260927T094307`) so the run picker still orders them newest first.

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

## In-depth metric tables (`src/ml/cycle/report.py`)

Seven more tables land beside the record under the same recipe, built by one pure module from the record
itself (`store.write_run` at every fold end; `scripts/land_model_cycle_metrics.py` back-fills older runs,
checks each fold's thirty scoreboard metrics against what it recorded and refuses to land a run that does not
reproduce them; all 30 runs in the lake were back-filled on 2026-09-27):

| table | one row per | what is in it |
|---|---|---|
| `model_metrics` | scope, fold, segment, metric | coverage (scored bars, gap bars, base rate), classification (the scoreboard's nine plus precision / recall / F1 of down, Matthews correlation, Cohen's kappa, average precision, the confusion counts), probability (Brier skill, mean P(up), sharpness), calibration (expected / maximum calibration error over ten equal-width bins, Murphy's reliability / resolution / uncertainty), baselines (majority class, always up, lift), price forecast (the scoreboard's five plus median error, bias, forecast-actual correlation); segments: `confidence` (how far P(up) sat from 0.5) |
| `trading_metrics` | scope, fold, segment, metric | returns (net, before costs, annualized, per session day), risk-adjusted (Sharpe, Sortino, Calmar, Sharpe standard error and the probabilistic Sharpe ratio of Bailey and Lopez de Prado, session-day Sharpe, tail ratio, common sense ratio, recovery factor), drawdown (maximum, longest in bars and days, recovery bars, average, ulcer index, count), trades (payoff ratio, streaks, average bars held for winners and losers, system quality number, ...), exposure (long / short / flat), costs (per trade, per contract per side, share of the pre-cost profit, break-even cost), buy and hold; segments: `side`, `exit_reason`, `entry_confidence` |
| `calibration_bins` | scope, fold, bin | ten equal-width P(up) bins (scikit-learn's edge rule): bars, mean P(up), share that went up, gap |
| `confusion_matrix` | scope, fold, actual, called | bar count and share |
| `distributions` | scope, fold, quantity, segment | the eight numbers (plus count) of trade net, bars held, bar net, session-day net, drawdown depth, P(up), forecast error |
| `drawdowns` | scope, fold, episode | peak, trough, recovery times, depth, bars to trough and to recovery, depth rank |
| `daily_results` | session day | bars, exposure, net, cumulative, intraday drawdown, trades closed, cost, accuracy |

Every metric row carries `metric_label`, `unit`, `better`, `definition`, `formula`, `sample_count` and `note`
(the reason a value is null, or its provenance), so the table reads without the code. The thirty names the
scoreboard already reports come from the same functions over the same rows; `tests/test_cycle_engine.py`
holds them equal to the engine's final and per-fold scoreboards on full, tuned and stopped runs, and
`tests/test_cycle_report.py` holds every other number to scikit-learn or a closed form. Session day: a CME
Globex session opens at 15:00 Pacific and belongs to the next calendar day; futures times are stored as Pacific
wall clock, so the session day is the date of the stored time plus nine hours.

A run recorded before 2026-09-27 has no per-bar net profit (it is the change in the recorded equity, which runs
continuously across folds) and no per-bar exposure: the exposure metrics are null with the reason (the older
`position` column cannot rebuild the engine's exposure; measured one bar in 783 off). Its bars per year are
recovered exactly from a fold's landed Sharpe ratio. Folds now also record `majority_class_up`.

Served by `GET /api/training/cycle/:modelId/metrics` (`src/server/training/cycleReport.ts`; contract
`src/shared/cycle/report.ts`) to the `/cycle` page's **Metrics** tab (`src/client/src/cycle/report/`): the model
and trading metrics with the run and every fold across, then — for a picked scope — calls and calibration,
accuracy by confidence, trades by side / exit reason / entry confidence, distributions with their shape, the
deepest drawdowns and every session day; hover any number for its definition, formula, sample and why it is
undefined. A live run's tables appear fold by fold. An adversarial review (2026-09-28: formulas recomputed
independently, the back-fill and lake checked, the API / tab / notebook checked) confirmed four findings, all
fixed: the back-fill took "cycle" as the symbol of runs named `cycle_*` (the symbol now comes only from the runs
table, a futures-root run id or the run's local config; `daily_results.session_day_rule` says how each day was
dated); P(up) = 0.45 and 0.55 fell in different confidence buckets (the distance to 0.5 is rounded before
bucketing); "Longest drawdown (days)" was the longest-in-bars episode's length (now the longest in days, equal
to the drawdowns table's longest `underwater_days` in all 66 scopes); and the back-fill checked the run's final
scoreboard only where the lake had a runs table (now also against the run's local `scoreboard.json`: 30 of 30
checked, 0 differences). The notebook `notebooks/model_cycle_runs.py` draws them
(the matrices, a chart of any metric across the scopes, the reliability diagram, the confusion heat-map, session
days, drawdown depths, the distributions' shapes, and every run compared). The manifest keeps one line per
(recipe, table): a re-landing replaces its line.

## Hyperparameters by modeling

`tuning_mode` defaults to `tuned`: inside EVERY fold, Optuna (TPE seeded by `seed + fold`, `MedianPruner`)
searches the model's `search` spaces on that fold's own TRAIN span — the outer validation rows are left out,
because they then choose the fitted model's best epoch (and fit a stacked combiner or a from-price curve), and a
trial scored on them would make that choice and the record's validation numbers in-sample (the adversarial
review of 2026-09-27 measured fold 0's last inner block covering all 287 validation rows before this) — an
expanding inner walk-forward of
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

The registry has 41 entries claiming 49 catalog specs; 40 are runnable (ordinal regression needs three classes).
The eight specs the audit found implementable were built as their own modules, one per spec, registered through
`cycle.networks.NETWORK_EXTENSION_MODULES` (`src/ml/cycle/networks_extra/<kind>.py`: mixture of experts,
recurrent-convolution hybrid, hypernetwork, neural Turing machine, dual-pathway network) and
`cycle.models.ADAPTER_CLASSES` (`src/ml/cycle/adapters_extra/<key>.py`: tree-boosted neural embedding,
attention-weighted forecast stack, Bayesian neural hybrid), each with a registry file
`src/config/cycle_models/<key>.json`, a test `tests/test_cycle_extra_<key>.py` and its simplifications written in
the entry's `implementationNote`. The stacked-ensemble spec is an alias of `stacked_generalization`. Every other
written spec (generative, self-supervised, semi-supervised, unsupervised, graph, image, agent and planner
architectures) carries its reason in `_cycle.json`. A model with no Inside view yet has `explainKind: "opaque"`
and the panel says so (the three adapters above); the five network kinds are `neural` and pass the explainer's
G1/G2/G4 gates like the built-in kinds.

A network kind's `attention` block is over the bars of the window: the Inside view labels every weight with a
bar. The neural Turing machine's read weights run over memory slots, so it carries no attention block; each read
head's per-bar addressing is its own `[time, slots]` layer. The dual pathway's two views are shorter than the
window (the last `fast_window_bars` bars; one bar in every `slow_stride`), and the Inside view draws a layer whose
time axis is not the window's length without bar labels.

The model picker (`GET /api/training/cycle-models`) orders categories that hold registry models by how many
runnable models they hold, so the order does not depend on which registry file a model lives in (one file per
new model sorts before `boosting.json`).

## Verification

`pytest tests/test_cycle_*.py` (the engine, tuning, record, explainer parity, adapters, networks; `tests/conftest.py`
exits the process cleanly after CUDA), `vitest` for the wire schema, parser, accumulator, runners, registry and the
client cycle panels; `tsc`; every `predictedClose` of a new run satisfies `close / tick_size` integral (asserted in
`tests/test_cycle_engine.py`).
