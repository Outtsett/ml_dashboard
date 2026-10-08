# The run page and the run API

One page (`/training`, labelled **AI Studio** in the navigation) launches a model and shows one
run: its verdicts, its charts in five fixed sections, and its terminal beside them. One small API
launches and reads runs, so a Claude session (or curl) does what the page's Run button does.

It replaced the four-tab Training page (Execution, Analytics with four sub-tabs, Trained Models,
Tri-Core HUD) on 2026-10-06. The engine underneath is unchanged: every run is a Model Cycle run
(`docs/model-cycle-record.md`).

## The API (`apps/api/training/runs.router.ts`)

| Call | What it does |
| --- | --- |
| `GET /api/runs/models` | Every launchable model: `key`, `runnerKey`, `displayName`, `kind`, `category`, `speed`, `estimatedTrainingTime`. |
| `GET /api/runs/preflight?model=&symbol=&timeframe=&dateStart=&dateEnd=` | Everything a launch needs, checked before Run: the model resolves, the root is priced in `cost_model.json`, the lake holds 1m bars for the root across the window (the engine resamples), the `.venv` Python answers with torch and its CUDA device (probed every 5 min), `data/models` has over 5 GB free, nothing is already running. `{ ready, checks[] }`; the launcher shows each line and disables Run while one fails. |
| `POST /api/runs` | Launch. Body `{ model, symbol?, timeframe?, dateStart?, dateEnd?, parameters? }`. Answers 202 `{ runId, modelType, url }`. |
| `GET /api/runs` | Live runs and the lake's recorded runs, newest first. The recorded list is cached 30 s. |
| `GET /api/runs/:id` | The run's view (below). `?logAt=<receivedAt>&logSeq=<seq>` returns only terminal lines after that one. |
| `POST /api/runs/:id/stop` | Graceful stop through the engine's control channel; a hard stop follows after 10 s if it is still running. |

`model` is a key, a runner key or a display name, matched without case or punctuation. An unknown
name, or one that matches several models, is a 400 that lists the keys: it is never guessed.

A launch from the API sets `bars_per_second` to 0 (the test bars are walked as fast as the model
answers) unless `parameters` says otherwise; the paced replay belongs to the Model Cycle page.

## The view (`packages/shared/src/runs/`)

`buildRunView(snapshot, report, logCursor)` turns a `CycleSnapshot` (the live accumulator's, or
the one rebuilt from the lake) and the run's report tables into a `RunView`:

- `setup`, `progress`, `status`: what is running and how far along it is.
- `tiles`: the headline numbers of the Prediction and Trading sections, each with the baseline it
  has to beat (accuracy against the majority-class share, log loss against a coin flip, net profit
  against buy and hold, closed trades against the minimum to judge).
- `verdicts`: the rules of `verdicts.ts`, worst first.
- `epochs` (each fold's final fit only: step, training and validation loss, validation accuracy and
  F1, learning rate, gradient norm, the kept step), `trials`, `folds`, `daily`, `calibration`,
  `confusion`: what the charts draw.
- `lossSurfaces`: one per final neural fit (below). Empty for a tree or linear model.
- `gateRoutings`: one per fold of a mixture of experts. `regimeForecasts`: one per fold of the regime Monte Carlo
  decision stack (below), its live stretches merged.
- `logs`: terminal lines after the caller's cursor.

It carries no bars. The chart of a run is on the Market page (`cycle/useRunOverlay.ts`); the
Terminal view of the run page draws the bars the run walked from `GET /api/runs/:id/bars`.

### The loss surface (`cycle_loss_surface`)

After each fold's final fit, a neural adapter (`packages/ml-engine/src/cycle/networks.py`)
evaluates the validation loss on a grid of weights around the kept ones, along two random
filter-normalised directions (Li et al. 2018, `core/shared/loss_surface.py`), and hands it to the
engine, which emits `cycle_loss_surface` (fold, model role, `alphas`, `betas`, `losses`,
`diagnostics`: sharpness, condition number, valley width, locally convex), keeps it in the live
snapshot and writes every surface so far to `data/models/<id>/loss_surfaces.json.zst`; a recorded run
reads that file back. The lake record does not carry it. The grid size is the cycle flag
`--loss-surface-resolution` (default 21, so 441 points × 4 validation batches, under a second for
a feedforward network; 0 turns it off); a tuning trial's fit never computes one. A tree model has
no weights to perturb and the page says so.

### The regime Monte Carlo decision stack (`regime_montecarlo_decision`, `cycle_regime_forecast`)

One Cycle model built from four: `packages/ml-engine/src/cycle/adapters_extra/regime_montecarlo_decision.py`,
registry `packages/config/cycle_models/regime_montecarlo_decision.json`, family `regime` on the run page.

- **Regime model** — a Gaussian hidden Markov model (`hmmlearn`, full covariance, `regime_count` states, searched
  2–5) over three causal inputs per bar: the one-bar log return, its realised volatility over the last
  `volatility_window_bars` finite returns, and a volume z-score over the same window, standardised on the training
  span. Fitted on the training span only; regime 1 is always the calmest. The walk reads the **forward filter**
  (never the smoother), one bar at a time, starting 1,000 bars before the training span.
- **Monte Carlo** — per regime, a Student-t of the one-bar log return by maximum likelihood (degrees of freedom
  held inside 2.05–200, location and scale refitted when held). At every bar, `simulation_count` (default 2,000)
  paths of the label horizon start from the filtered regime probabilities and re-draw the regime every bar from the
  transition matrix, with common random numbers. Out: P(up), the expected move in points, and the 10th / 50th /
  90th percentile move after every step. About 1 ms a bar at 2,000 paths × 6 bars (measured 2026-10-07).
- **Kronos** — the pretrained K-line model in `Kronos/` (weights `NeoQuasar/Kronos-mini|small|base` at pinned
  revisions from the Hugging Face cache, on the GPU, loaded once per process) reads the last `kronos_context_bars`
  candles and decodes the next horizon candles greedily. A git worktree reads its main checkout's `Kronos/`;
  `KRONOS_ROOT` overrides.
- **FinBERT** — the nine `finbert_*` columns of the feature matrix, by name.
- **Decision model** — xgboost over [regime probabilities, simulation P(up), expected move and 10–90 spread over
  the move scale, Kronos' move over the move scale and its sign, the FinBERT columns]; the regime and simulation
  signals of the last `maximum_training_bars` training rows are out of fold (`stacking_fold_count` contiguous
  blocks, each purged by the label horizon on both sides); early stopping on validation. Its P(up) is the run's
  direction probability; its total-gain shares are the feature weights.
- **Trade gate** — open when |P(up) − 0.5| ≥ `decision_threshold`. The engine (`_walk_span`) and tuning
  (`tuning.simulate_block`) read `adapter.trade_gate`: every bar's direction is still scored, but a closed gate
  stands aside (signal 0: no entry; a held position runs to its holding period). Any adapter that defines
  `trade_gate` gets this; none other does.
- **Price model** — the simulation's expected move over the move scale (the forecast line on the chart).
- **Live** — during each fold's test walk the engine asks `adapter.regime_forecast(row)` for every scored bar and
  sends what accumulated with every bar frame as one `cycle_regime_forecast` stretch (regime probabilities, most
  likely regime, the fan, Kronos' predicted candles and move, decision P(up), gate state, plus the fold's regimes,
  transition matrix and feature weights). `apps/api/training/cycle.ts` merges the stretches per fold
  (`mergeRegimeForecast`, `packages/shared/src/cycle/schema.ts`); at fold end the engine writes every fold to
  `data/models/<id>/regime_forecasts.json` (plain JSON on this branch; the reader in `runs.router.ts` takes the
  `.zst` form first). `RunView.regimeForecasts` carries it.
- **Panel** — `apps/web/src/runs/analytics/RegimePanel.tsx`: stacked regime-probability bands (click a band's
  legend to hide it), decision P(up) against the gate's closed band, a scrubber with step buttons linked to the
  page's focus time, the fan with Kronos' candles over it at the chosen bar (one price scale, hollow orange =
  rising, filled blue = falling), the bar's readouts, the feature weights coloured by source, each regime's
  Student-t and the transition matrix. Every number's hover is its computation
  (`packages/shared/src/runs/regimeDefinitions.ts`, `howComputedRegime`).
- **Explainer** — Kronos reads open, high, low and volume and the regime model reads volume at predict time;
  `MarketView` carries `volume` in the engine's view only (like open / high / low), so the explainer's reload is
  refused with a sentence (`explainKind: "opaque"`). The run's own `regime_forecasts.json` is its record.

### Transparency

Every metric carries how the engine computes it: `packages/shared/src/runs/metricDefinitions.ts`
(30 definitions read from `cycle/metrics.py` and `simulate.py` and verified against them) is shown
on hover on every tile, readout and versions-table heading (`runs/howComputed.ts`). The purpose
line is complete sentences (`runPurpose`): the instrument and bar size, exactly what is predicted
over what horizon in bars and clock time, and how the settings were chosen. The verdict is the last
section of the page.

### The five sections and the verdict

| Section | Question | Shows |
| --- | --- | --- |
| Verdict | What is wrong, and what to change | Every rule that fired, with its numbers and its fix |
| Configuration | What the run was given, and what each fold used | Base hyperparameters, run settings, cost model, feature list; per-fold table with the search's changes in orange (`Configuration.tsx`, `RunView.configuration`) |
| Learning | Learning or memorising? | (family panels, `runs/analytics/`) **attention** for a transformer: the chosen test bar's attention per layer and head over the window it read, from the run's explain artifacts via `/api/training/cycle/:id/explain/bar` (`AttentionPanel.tsx`); **gate routing** for a mixture of experts: each expert's gate probability per test bar stacked to 1, usage per expert, decisiveness (entropy), from `cycle_gate_routing` per fold (`GateRoutingPanel.tsx`, engine `_record_gate_routing`, `data/models/<id>/gate_routings.json.zst`); plus | Loss by step against the coin-flip line; one small panel per logged quantity (training loss, validation loss, accuracy, F1, learning rate, gradient norm) with the kept step marked; the 3D loss surface per fold (`learning.tsx`) |
| Prediction quality | Better than guessing the common direction? | Tiles, calibration curve, confusion table |
| Trading result | Money after costs? | Tiles, net profit by session day |
| Hyperparameter search | Did the search beat the defaults? | Objective per trial and best so far, per fold; objective against each parameter the search varied, best trial ringed (`search.tsx`) |
| Fold stability | Every window, or one? | Net profit, Sharpe, accuracy or ROC AUC per fold; every scoreboard metric as its own small bar chart (`foldGrid.tsx`) |

The run list on the left folds away (the **Runs** button; remembered in `run-page-sidebar`).

### Verdict rules (`packages/shared/src/runs/verdicts.ts`)

Each rule reads measured numbers and returns a severity (`critical`, `warning`, `pass`), one
sentence, the evidence and the change to make. The thresholds are named constants in that file and
are rules of thumb: they flag a run for a closer look.

| Rule | Fires when |
| --- | --- |
| `run_failed` | status is `failed` |
| `overfitting` | a fold's validation loss ends more than 2% above its own minimum while training loss fell |
| `validation_never_beat_coin_flip` | a fold's best validation log loss is at or above ln 2 |
| `one_direction` | recall at or above 98% or at or below 2%, or balanced accuracy within 0.5 points of 50% with accuracy equal to the majority share |
| `no_accuracy_edge` | accuracy beats the majority share by 1 point or less |
| `no_ranking_skill` | ROC AUC below 0.52 |
| `probabilities_worse_than_coin_flip` | out-of-sample log loss at or above ln 2 |
| `price_forecast_loses_to_last_close` | price forecast skill at or below 0 against persistence |
| `too_few_trades` | fewer than 30 closed trades |
| `always_in_market` | exposure above 98% |
| `lost_money`, `lost_to_buy_and_hold` | net profit below 0, or at or below buy and hold |
| `too_good` | Sharpe ratio above 3 |
| `costs_eat_the_edge` | costs above half of gross profit |
| `search_found_nothing_profitable` | a fold's best trial has a Sharpe ratio at or below 0 |
| `unstable_across_folds`, `every_fold_lost` | some, or all, folds lost money |

Each has a passing counterpart where a pass says something (`accuracy_edge`, `ranking_skill`,
`learning_ok`, `beat_buy_and_hold`, `every_fold_profitable`, ...).

## Names, versions, purpose (`packages/shared/src/runs/naming.ts`)

- **Name:** `brisk-heron-41`, an adjective, a noun and a number derived from the run id's hash, so
  every run (live, recorded, old) has the same name every time it is read and nothing is stored.
- **Version:** the run's ordinal among runs of the same model on the same symbol and timeframe,
  oldest first (`XGBoost v11`). Computed from the list, so it shifts only if an older run is deleted.
- **Purpose:** one line from the run's own plan: model, what it predicts (direction classifier,
  plus a price model), symbol and timeframe, how far ahead it calls, how its settings were chosen.
  Runs recorded before the plan was landed have no purpose line.
- The terminal shows the engine's landing lines condensed (`[save] landed metrics · 78 rows`);
  "Full lines" shows the object paths.

## The page (`apps/web/src/runs/`)

`RunPage.tsx` (layout, auto-open), `RunSidebar.tsx` (launch form, run list), `Verdicts.tsx`,
`Tiles.tsx`, `charts.tsx`, `RunTerminal.tsx`, `api.ts` (the polling hooks), `format.ts`.

- The list is polled every 3 s and the open run every 1 s while it runs, in a background tab too.
  A run that appears as `running` and was not in the previous list is opened: this is how a run
  launched by Claude shows itself.
- The terminal's filter chips are the engine's own log categories. Each poll sends the last line
  the page holds and receives only the lines after it.
- A finished run's terminal is written once to `data/models/<id>/terminal.jsonl.zst`, because the lake
  record does not carry the lines; a recorded run reads it back. Runs from before 2026-10-06 have
  no terminal.

## The Versions view (`apps/web/src/runs/compare/`)

Analytics lives inside AI Studio (since 2026-10-07 15:00; `/analytics` redirects to `/training`, the
nav item is gone): the run page's third view, **Versions**, compares the open run's line — runs of
the same model on the same symbol and timeframe, never different models against each other. Up to
six versions (chips; the choice is in the URL as `?versions=a,b`), read side by side — every headline metric as a table with
one row per run and the best of each column starred; critical and warning counts by when each run
ran; validation loss by step, running net profit by session day and calibration with every run on
one axis; and one card per run with the panels its family owns (`runs/analytics/families.ts`, the
loss surface for a neural fit) and a link into AI Studio. Comparisons are saved on disk through
`GET/POST /api/runs/comparisons` and `DELETE /api/runs/comparisons/:id`
(`data/analytics/comparisons.json`), so a clone sees them. `?tab=catalog` still opens the model
catalog the Catalog nav item points at.

## From Claude

`.claude/commands/run-model.md`: list models, `POST /api/runs`, open the returned `url` in the
dashboard's tab, poll `GET /api/runs/:id`, report the verdicts.

## Storage tiers and compression (2026-10-07)

Every run lives in three in-process tiers, nothing else: the **lake** (`s3://derived/model_cycle_runs/recipe=<run>/`, eight record tables plus seven report tables, zstd parquet, read by DuckDB as `derived_model_cycle_runs_<table>`), **SQLite** (`cycle_runs`, `cycle_run_configurations`, `cycle_run_settings`, `cycle_run_features`, `cycle_run_verdicts`, `saved_analytics`, `saved_analytics_runs`: the entities, 3NF) and **files** beside the artifacts (`data/models/<id>/`: weights, explain arrays, the terminal, loss surfaces, gate routings). DuckDB is the reader of the lake tier, never a store.

Every file beside the artifacts is zstandard-compressed (`<name>.zst`, level 3): the engine through `packages/ml-engine/src/cycle/compressed.py` (`write_json` / `write_array` / `read_*`, `np.savez_compressed` for the fold indexes), the server through Node's built-in `zlib.zstdCompressSync` (`readArtifactText` / `writeArtifactText` in `apps/api/training/runs.router.ts`). Readers try the compressed name first and the plain name second, so runs recorded before 2026-10-07 still open. Measured: loss surfaces 112x, terminal lines 53x, int64 / float64 series 2-4x, float32 feature matrices 1.06x (kept for one convention; a 32 MB matrix reads in 41 ms). The lake record was already zstd parquet (the lake writer's codec and level); SQLite rows are kilobytes.

## The terminal as a time series (2026-10-07)

The Terminal view lays the engine's lines out as a table: one row per logged step, one column per quantity (`apps/web/src/runs/RunTerminal.tsx` over `packages/shared/src/runs/logRows.ts`). `parseLogLine` reads the engine's grammar (`[fold 1/3][tune trial 7/20] complete sharpe_ratio=1.25 best=1.25`) into the fold, the stage (Data, Device, Features, Plan, Search, Fit, Validate, Replay, Test, Trade, Record), the trial, the bar the line is about, what happened in plain words, and every number as a named value in full words (`val_loss` → "validation loss", `p_up` → "P(up)", `samples/s` → "samples per second"). A quantity is a column when at least 2% of the rows on screen (and 3 rows) carry it; a one-off number is written into its row's "What happened" cell. Search trials fold to one row each (settings, score, best so far, step count) until opened or "Every trial step" is on. "? What the stages mean" opens a legend with one sentence per stage. "Copy table" copies tab-separated columns. A finished run opens at its first row; a live run follows the newest. The raw line is the row's hover.

## Label kinds: direction and reversal (2026-10-07)

`label_kind` (run setting, `packages/config/cycle_models/_cycle.json`; the launcher's "What the model predicts") decides what the direction model is fitted on:

- **direction** (default): 1 when the close `label_horizon_bars` ahead is above this bar's close by more than `label_threshold_ticks`, 0 when it is below by more than that, unlabelled inside the threshold (`cycle/labels.py` `make_labels`). The model answers P(up).
- **reversal**: 1 when the move over the next `label_horizon_bars` goes against the move over the previous `label_horizon_bars` (a turn), 0 when it continues, unlabelled when either move is inside the threshold, before the first horizon of bars, or when the horizon crosses a session gap (`make_reversal_labels`). The model answers P(turn).

**One probability outside the model.** `CycleEngine.probability_up(value, row)` converts a reversal model's answer at the bar: P(up) = 1 − P(turn) after an up-move, P(up) = P(turn) after a down-move, and no call when the trailing move is inside the threshold (`trailing_direction`). Everything downstream reads that P(up): the walk's signal (long at 0.5 or above, short below), the search's Sharpe objective (`tuning._block_objective`), accuracy / log loss / Brier / ROC AUC / calibration, the bars' `probabilityUp`, and the RegimePanel's decision probability. The trade gate is unchanged because |P(turn) − 0.5| = |P(up) − 0.5|. The search's log-loss and F1 objectives score the model against the label it was fitted on (P(turn) against the reversal label). The "always the common direction" baseline is taken from the up/down labels of each fold's training bars (`direction_labels`) whichever label the model is fitted on. Tests: `tests/test_cycle_reversal_labels.py` (4), `tests/test_cycle_reversal_engine.py` (4).

## A run is a child of the dev server

A run launched through `POST /api/runs` is a child of the `tsx --watch` dev server, so a save to any file in the server's import graph (`apps/api/**`, `packages/shared/src/**`, `packages/config/**`) restarts the server and ends the run. The record keeps the folds that finished; a record still saying "running" with no live process is shown as **Stopped** with that reason (`cycleArchive.ts` `archivedStatusOf`). For a run that must finish, hold saves to those directories in every session until it completes.

On the first run listing after a boot the server reconciles the rows a restart left saying "running" (`@shared/runs/orphans` `classifyOrphanRuns`, applied by `runRecords.reconcileOrphanRuns`): a run with a lake record is marked stopped with the reason; a run that ended before its first fold has nothing to open, so its rows are removed and it holds no version number. It runs only when the lake's run list was really read.
