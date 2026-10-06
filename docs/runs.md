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
- `epochs` (each fold's final fit only), `trials`, `folds`, `daily`, `calibration`, `confusion`:
  what the charts draw.
- `logs`: terminal lines after the caller's cursor.

It carries no bars. The chart of a run is on the Market page (`cycle/useRunOverlay.ts`).

### The five sections and the verdict

| Section | Question | Shows |
| --- | --- | --- |
| Verdict | What is wrong, and what to change | Every rule that fired, with its numbers and its fix |
| Learning | Learning or memorising? | Training and validation loss by step, per fold, against the coin-flip line |
| Prediction quality | Better than guessing the common direction? | Tiles, calibration curve, confusion table |
| Trading result | Money after costs? | Tiles, net profit by session day |
| Hyperparameter search | Did the search beat the defaults? | Objective per trial and best so far, per fold |
| Fold stability | Every window, or one? | Net profit, Sharpe, accuracy or ROC AUC per fold |

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
- A finished run's terminal is written once to `data/models/<id>/terminal.jsonl`, because the lake
  record does not carry the lines; a recorded run reads it back. Runs from before 2026-10-06 have
  no terminal.

## From Claude

`.claude/commands/run-model.md`: list models, `POST /api/runs`, open the returned `url` in the
dashboard's tab, poll `GET /api/runs/:id`, report the verdicts.
