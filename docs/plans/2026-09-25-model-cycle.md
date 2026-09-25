# Model Cycle — pick a model, press Play, watch it train, tune, validate and trade bar by bar

Date: 2026-09-25. Branch: `feat/realtime-dashboard-redesign`.

## What the user gets

1. Open **Model Cycle** (`/cycle`, a side panel over the Market chart; the top-bar Play button goes there).
2. Pick a model family (logistic regression, random forest, XGBoost, LightGBM, multilayer perceptron,
   LSTM, temporal convolution network, transformer encoder), set its hyperparameters, the data
   window, walk-forward folds, labels, trading rules, optional Optuna tuning, and the replay speed.
3. Press **Play**. One Python process (`src/ml/cycle/main.py`) runs the whole cycle and streams it:
   - loads bars from the lake → builds causal features and labels → plans walk-forward folds;
   - optional Optuna tuning on the first fold's training window (inner walk-forward, median objective);
   - per fold: trains (epoch/batch or boosting-round stepping), validates, then **walks the test
     bars one at a time**: predicts P(up) for the bar, trades it with the MNQ cost model, updates
     running metrics;
   - lands every prediction, trade, fold and epoch record in `data/models/<model_id>/` and the lake.
4. The Market chart area swaps to the **cycle chart**, drawn from the exact bars the model reads:
   bars appear as the model reaches them, the training block being fitted is highlighted, the test
   cursor advances bar by bar, predictions paint a strip under the candles, P(up) and equity panes
   grow, trade entries/exits are marked. Follow mode keeps the model's bar in view.
5. The panel shows a verbose terminal (batch/epoch/bar/trade lines), live metric tiles with
   sparklines (Sharpe, Sortino, Calmar, drawdown, profit factor, win rate, expectancy, accuracy,
   precision, recall, F1, ROC AUC, log loss, Brier, baselines), the trade log with a profit
   histogram and its eight-number summary, the fold ledger, loss curves and tuning trials.
   Pause / resume / speed / stop act on the running Python process through its stdin.

## Honesty rules the implementation keeps

- The chart shows only bars the process has emitted, in the order it read them — never a
  pre-loaded window with a progress bar painted over it.
- Training on a block is shown as that block's time span. Tree models fit the whole window each
  round, so their cursor spans the whole window and says so (`unit: "boosting_round"`).
- Test predictions are computed one bar at a time from features that end at that bar. Labels,
  purge and embargo follow `walk-forward-validation`; features are trailing-window only.
- Costs come from `src/config/cost_model.json` (`total_per_side` per fill). Missing symbol → error.
- Undefined metrics are `null`, never 0. Profit factor with no losing trade is `null` with a note.
- Sharpe/Sortino are per-bar, marked-to-market, annualised with the **measured** bars per year of
  the loaded data (`barsPerYear` in the plan event).

## Process contract

### Command line (`src/ml/cycle/main.py`)

Always passed by `pythonRunner.ts`: `--symbol --timeframe --model-id --json`, optional
`--max-bars --date-start --date-end --feature-categories --include-indicators --indicator-groups
--all-features --label-set-parquet` (the last four are accepted and logged as ignored).
Passed from the runner entry's new `scriptArgs`: `--model-family <family>`.

Hyperparameters (runners.json key → flag, `bool` = presence flag):

| group | key → flag | type | default |
|---|---|---|---|
| Walk-forward | `train_days` → `--train-days` | int | 60 |
| | `validation_fraction` → `--validation-fraction` | float | 0.2 |
| | `test_days` → `--test-days` | int | 10 |
| | `step_days` → `--step-days` | int (0 = test_days; must be ≥ test_days) | 0 |
| | `fold_limit` → `--fold-limit` | int (0 = all; else the most recent N) | 3 |
| | `expanding_window` → `--expanding-window` | bool | false |
| Labels | `label_horizon_bars` → `--label-horizon-bars` | int | 6 |
| | `label_threshold_ticks` → `--label-threshold-ticks` | float | 0 |
| | `embargo_bars` → `--embargo-bars` | int | 0 |
| Trading | `long_only` → `--long-only` | bool (every prediction is traded: long at P(up) ≥ 0.5, short below — flat below when on) | false |
| | `holding_bars` → `--holding-bars` | int (0 = label horizon; only acts when long only — with shorts the position follows every prediction) | 0 |
| | `stop_loss_ticks` → `--stop-loss-ticks` | float (0 = off) | 0 |
| | `take_profit_ticks` → `--take-profit-ticks` | float (0 = off) | 0 |
| | `contracts` → `--contracts` | int | 1 |
| Tuning | `tuning_trials` → `--tuning-trials` | int (0 = off) | 0 |
| | `tuning_objective` → `--tuning-objective` | options `sharpe_ratio`/`log_loss`/`f1_score` | sharpe_ratio |
| | `tuning_folds` → `--tuning-folds` | int | 2 |
| Replay | `bars_per_second` → `--bars-per-second` | float (0 = as fast as possible) | 40 |
| | `start_paused` → `--start-paused` | bool | false |
| | `quiet_bars` → `--quiet-bars` | bool (suppress per-bar log lines) | false |
| | `log_every_batches` → `--log-every-batches` | int | 10 |
| Runtime | `device` → `--device` | options `auto`/`cuda`/`cpu` | auto |
| | `seed` → `--seed` | int | 42 |

Model group (only the selected family's keys are in its runner entry):

| family | keys (all `--kebab-case` flags) |
|---|---|
| `logistic_regression` | `regularization_strength` 1.0, `max_iterations` 300 |
| `random_forest` | `tree_count` 300, `max_depth` 8, `min_samples_leaf` 20, `max_features_fraction` 0.5 |
| `xgboost` | `boosting_rounds` 400, `max_depth` 6, `learning_rate` 0.05, `subsample` 0.8, `column_subsample` 0.8, `min_child_weight` 1.0, `l2_regularization` 1.0, `early_stopping_rounds` 50 |
| `lightgbm` | `boosting_rounds` 400, `leaf_count` 31, `learning_rate` 0.05, `subsample` 0.8, `column_subsample` 0.8, `min_child_samples` 20, `l2_regularization` 1.0, `early_stopping_rounds` 50 |
| `multilayer_perceptron` | `hidden_size` 128, `layer_count` 2, `dropout` 0.2, `learning_rate` 0.001, `weight_decay` 0.0001, `batch_size` 256, `epochs` 20, `patience` 5 |
| `lstm` | `sequence_length` 32, `hidden_size` 64, `layer_count` 1, `dropout` 0.2, `learning_rate` 0.001, `weight_decay` 0.0001, `batch_size` 256, `epochs` 20, `patience` 5 |
| `temporal_convolution_network` | `sequence_length` 32, `channel_count` 32, `kernel_size` 3, `layer_count` 3, `dropout` 0.2, `learning_rate` 0.001, `weight_decay` 0.0001, `batch_size` 256, `epochs` 20, `patience` 5 |
| `transformer_encoder` | `sequence_length` 32, `model_dimension` 32, `head_count` 4, `layer_count` 2, `dropout` 0.1, `learning_rate` 0.0005, `weight_decay` 0.0001, `batch_size` 256, `epochs` 20, `patience` 5 |

Runner keys: `<family>+walk_forward_cycle`, task `walk_forward_cycle` (classification head).

### Events on stdout

JSON lines via `src/ml/shared/protocol.py` (`emit_cycle_*`). Payload keys are camelCase, times are
**epoch seconds** (naive lake timestamps are UTC). The wire schema is
`src/shared/cycle/schema.ts` (zod) — the Python emitters, the server parser and the client store
all follow it. Cycle events carry the envelope (`seq`, `run_id`, …) but not the nested `data` copy.

| event | when |
|---|---|
| `cycle_plan` | once, after data load: window, folds, costs, trading rules, device, `barsPerYear` |
| `cycle_bars` | bars in strict timestamp order, each emitted exactly once. `role: "context"` before a fold's test span; `role: "processed"` for test bars, with P(up), direction, position, equity and resolved labels |
| `cycle_cursor` | where the model is: phase, fold, span, bar, epoch/batch, trial, fractions, pace, paused. ≤ 20 Hz, plus every phase change |
| `cycle_epoch` | one training step summary (epoch, boosting-round chunk, tree chunk, solver pass) |
| `cycle_trial` | Optuna trial start/finish/prune |
| `cycle_trade` | trade opened, trade closed |
| `cycle_scoreboard` | `running` (≤ 4 Hz during testing), `fold` (fold end), `final` |

Standard events also emitted: `log` (every terminal line), `progress`, `metric` + `fold_complete`
(SQLite ledger), one `overlay`/`prediction_markers` per fold (the regular Market chart), `done`, `error`.

### Control on stdin

One JSON object per line: `{"command":"pause"}`, `{"command":"resume"}`,
`{"command":"pace","barsPerSecond":N}` (0 = as fast as possible), `{"command":"stop"}` (graceful:
an open trade exits at the NEXT bar's open — the fill rule every exit uses — and that bar is
walked once as a processed bar with no prediction; then the final scoreboard, artifacts, `done`).
The engine polls the stdin pipe with `PeekNamedPipe` on Windows: a thread parked in a blocking
read froze the main thread until the first control line arrived. Server: `POST /api/training/control/:modelId`. The hard stop (`/training/stop`) stays as
the fallback and kills the process tree on Windows.

### Server additions

- `pythonRunner.ts`: stdout line buffer across chunks (a long JSON line split over two chunks was
  parsed as two log lines), stdout tail cap, `scriptArgs`, `sendControl()`, tree kill on Windows.
- Parser: zod schemas for the seven `cycle_*` events, `seq` kept.
- `src/server/training/cycle.ts`: per-run accumulator on the event bus →
  `GET /api/training/cycle` (recent runs) and `GET /api/training/cycle/:modelId` (snapshot the
  panel and chart rebuild from after a reload; the 1000-event SSE buffer cannot).
- SSE heartbeat comment every 15 s.

### Client

- `src/client/src/cycle/store.ts` — zustand store. Bars live in mutable columnar arrays with a
  version counter so the chart appends with `series.update()` instead of re-setting data.
  Events are applied once, by envelope `seq`.
- `connection.ts` (REST + EventSource), `CyclePage.tsx` (route `/cycle`), `ConfigForm.tsx`,
  `Controls.tsx`, `PhaseStrip.tsx`; panels `Terminal.tsx`, `Scoreboard.tsx`, `Trades.tsx`,
  `Folds.tsx`, `Curves.tsx`; chart `CycleChart.tsx` + `chartBands.ts`, swapped into the Market
  chart area while a run is shown.
- Okabe-Ito only: up/long/profit orange `#E69F00`, down/short/loss blue `#0072B2`, training span
  sky `#56B4E9`, validation yellow `#F0E442`, active block reddish-purple `#CC79A7`; every colour
  also carries a shape or a label.

## Model adapter contract (`src/ml/cycle/adapter.py`)

`build_adapter(family, parameters, device, seed) -> ModelAdapter` (in `models.py`). An adapter sees
the whole causal feature matrix `features (n_bars × n_features, float32)` and index arrays, so
sequence models can reach back `sequence_length` bars without the engine copying windows:

```python
adapter.fit(features, labels, train_index, validation_index, timestamps, reporter)
adapter.predict_probability(features, index) -> np.ndarray   # P(up) per index, float64 in [0, 1]
adapter.minimum_history() -> int                             # bars of history one prediction needs
adapter.save(directory) -> str                                # checkpoint path
```

`reporter` (engine-owned) receives `epoch_started`, `batch`, `epoch_finished`, and exposes
`checkpoint()` (blocks while paused, raises `StopRequested` on stop).

## Done means

- `pytest tests/test_cycle_*.py tests/test_walk_forward_days.py` green; vitest for the store,
  parser schemas, accumulator and control route green; `npm run check` clean on touched files.
- A real run from the browser: MNQ 5m, xgboost and LSTM, three folds, tuning on for one of them —
  the chart grows bar by bar with predictions and trades, the terminal streams, tiles move,
  pause/resume/speed/stop act, a page reload rebuilds from the snapshot, artifacts land.
