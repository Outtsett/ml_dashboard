# Model Cycle: catalog models, "Inside the model", price on the labels

Status: in progress (2026-09-25/26). Approved plan: `~/.claude/plans/enumerated-sleeping-melody.md`.
Parent design: `docs/plans/2026-09-25-model-cycle.md`.

## What and why

1. **Catalog → Cycle.** The Model Cycle ran 8 hard-coded families. It now runs any model in
   its registry (`src/config/cycle_models/`), which maps the user's catalog specs
   (`/api/model-catalog`) to runnable implementations: 32 runnable models (the supervised
   specs plus the bar-sequence neural specs; Ordinal regression is greyed). The model
   browser groups them by catalog category and subcategory and greys the rest of the
   catalog with a reason.
2. **Inside the model.** For any bar, show how the fitted fold model turned that bar's inputs
   into its output: every tree's path and leaf, then the sum and link (trees); weights times
   inputs (linear); the neighbors that voted; the per-feature evidence (naive Bayes); the
   support vectors; the base models and meta-learner; layer activations and attention
   (neural). The user moves through it with hover, pin, step and play controls.
3. **Price on the labels.** Hovering a labelled bar shows the move in points, ticks and USD,
   the resolution close and time, and the price model's forecast and its error. When zoomed
   in, the chart prints the forecast price beside each ▲/▼ glyph.

## Contracts (written first; builders build against them, do not change them without saying so)

| Contract | File | Read by |
|---|---|---|
| Registry data | `src/config/cycle_models/_cycle.json` + `boosting.json`, `trees_and_ensembles.json`, `linear.json`, `other_supervised.json`, `neural.json` | everything |
| Registry, Python | `src/ml/cycle/catalog.py` (stdlib only: `load_registry`, `registry`, `entry`, `runnable_keys`, `defaults`, `parameter_types`, `coerce`, `resolve_parameters`, `estimator_arguments`, `suggest_parameters`, `uses_torch`, `has_price_model`, `flag`, `unavailable_reason`) | main.py, models.py, engine, explainer |
| Registry, TypeScript | `src/shared/cycle/models.ts` (zod per file + `crossCheckCycleRegistry`; `/api/training/cycle-models` response `cycleModelsResponseSchema`) | server, client |
| Plan fields | `src/shared/cycle/schema.ts`: `modelFamily` is any registry key; plan gains `catalogSpecId`, `implementation`, `explainKind`, `directionMode`, `hasPriceModel`; step unit `single_fit` | engine, server parser, client |
| Explanations | `src/shared/cycle/explain.ts` (manifest, structure, tree, bar; explainer JSON-lines protocol; links; parity gates G1–G4) | explainer, server pool, client |
| Inspection state | `src/client/src/cycle/store.ts`: `inspectTimestamp`, `inspectSource` (hover / cursor / pinned), `inspectRole`, `setInspect`, `pinInspect`, `setInspectRole` | chart, Inside tab |
| Fixtures | `tests/fixtures/cycle_runners_legacy.json` (the 8 old runner blocks + composed `/api/training/config` entries); `tests/fixtures/cycle_models_invalid/*.json` (mutations both loaders must reject) | tests |

Contract tests: `tests/test_cycle_catalog_contract.py`, `tests/shared/cycleModels.test.ts`.

### Registry entry fields

`catalogSpecId`, `alsoCatalogSpecIds` (duplicate catalog specs that run as this model),
`displayName`, fallback `category` / `subcategory`, `kind` (card badge), `summary`,
`implementationNote` (how the Cycle implements the spec when it differs from it), `runnable`,
`unavailableReason`, `implementation` (sklearn | xgboost | lightgbm | catboost | statsmodels |
torch), `adapter` (legacy | scikit_learn | catboost | statsmodels | neural), `legacyFamily`,
`direction` `{mode: classifier | from_price, estimator, fixed, probability}`, `price`
(`{estimator, fixed}`, or null = no price model and no forecast line), `preprocess`
(`["standard_scaler"]`: fitted on TRAINING rows only), `progress` (legacy | warm_start_trees |
warm_start_rounds | per_round | per_epoch | single_fit), `stepUnit`, `explainKind`,
`sequence`, `network`, `speed`, `estimatedTrainingTime`, `gpu`, `parameters`.

A parameter carries `type` (authoritative), `default`, bounds, `label`, `group` ("Model"),
`description` (the help sentence), `argument` (the estimator keyword; absent = the adapter
reads it itself, e.g. epochs, patience, maximum_training_bars), `roles` (direction / price;
default both) and `search` (Optuna: float | int | categorical). One parameter name has one
type across all models. Its flag is `--` plus the name with hyphens.

`adapter: "legacy"` = the 8 families that predate the registry (xgboost, lightgbm,
random_forest, logistic_regression, multilayer_perceptron, lstm, temporal_convolution_network,
transformer_encoder). Their validation (`models.resolve_parameters`), Optuna search
(`models.suggest_parameters`) and adapters are unchanged; a legacy run's predictions must be
bitwise identical before and after this work (xgboost; the LSTM on CPU within 1e-6).
Baselines: `…/scratchpad/legacy_gate/data/models/legacy_{xgboost,lstm}_before/predictions.parquet`,
made with `harness.py` in the same folder
(`--symbol MNQ --timeframe 5m --json --date-start 2025-10-01 --date-end 2025-11-15 --train-days 20 --test-days 3 --fold-limit 1 --bars-per-second 0 --quiet-bars --device cpu --seed 42`, LSTM `--epochs 4`).

New entries are committed `runnable: false` with reason "Being built for the Cycle." The
package that builds a model flips it to `runnable: true` / `unavailableReason: null` as its
last step, once that model's tests pass.

### Direction from price (`direction.mode == "from_price"`)

Ridge, Lasso, ElasticNet, LARS, Bayesian ridge, linear and quantile regression have no
classifier. The fold fits the price model (the volatility-scaled h-bar move), then fits a
two-parameter logistic curve `P(up) = 1/(1+exp(-(slope·ŷ + intercept)))` on the VALIDATION
bars (predicted move against the up/down label). That model is both the fold's price model
and, through the curve, its direction model. The same happens inside tuning.

### Run artifacts for the explainer (written by the engine, read by the explainer and Node)

Under `data/models/<model_id>/`:

```
explain/manifest.json      {version, modelId, modelKey, displayName, explainKind, directionMode, hasPriceModel,
                            featureNames, featureDisplayNames, sequenceLength, labelHorizonBars, symbol, timeframe,
                            folds: [{foldIndex, testStart, testEnd}]}            written at plan time
explain/features.npy       float32 [bars, features]  the model inputs (engine.features: causal z-scores, NaN warm-up)
explain/raw_features.npy   float32 [bars, features]  the same columns before the z-score
explain/timestamps.npy     int64   [bars]
explain/close.npy          float64 [bars]            (roll-adjusted) closes
explain/move_scale.npy     float64 [bars]            points per target unit (the price model's scale)
explain/labels.npy         float32 [bars]            direction labels (1 up, 0 down, NaN unscored)
explain/price_target.npy   float32 [bars]            the price model's target
fold_<k>/index.npz         train, validation, test, price_train, price_validation (int64 rows)   written before fitting
fold_<k>/model.json + file direction model — saved right after ITS fit (not at fold end)
fold_<k>/price_model/…     price model — saved right after its fit
```

A fold whose model file exists is "ready"; planned but absent while the run is live is
"training"; absent after the run is "missing"; `hasPriceModel == false` is "none".
Runs without `explain/` show "made before Inside the model existed" instead of a view.

### Adapter introspection the explainer relies on

Each adapter keeps its fitted library object on a documented attribute. New adapters
must follow this:

- `sklearn_adapter.SklearnEstimatorAdapter`:
  - `.estimator` — the fitted sklearn object;
  - `.scaler` — a StandardScaler fitted on the training rows, or None;
  - `.logistic_curve` — `(slope, intercept)` or None;
  - `.training_rows` — the rows actually fitted, int64 (the SVM cap);
  - `.key`, `.task`, `.feature_count`, `.best_iteration` (rounds or epochs kept, or None).
- `catboost_adapter.CatBoostAdapter`: `.model`, `.best_iteration`.
- `statsmodels_adapter.ProbitAdapter`: `.result` (fitted; `params[0]` is the intercept),
  `.scaler`.
- `derived.DerivedDirectionAdapter` (engine package): `.price_adapter`, `.logistic_curve`.
- `networks.NeuralAdapter`:
  - `.network`;
  - `trace(features, index) -> {"layers": [...], "attention": [...], "logit": float}` — one row,
    CPU, eval mode, the exact tensor path `predict_*` uses.

Legacy adapters in `models.py` keep their current attributes: XGBoost `.booster`
(+ best iteration), LightGBM `.booster`, random forest `.model`, logistic
`mean` / `scale` / coefficients.

## Work packages (disjoint file ownership; never two agents in one file)

Another live session owns `catalogService.ts`, `vite.ts`, the lens routers,
`marimo/catalog.ts`, `processManager.ts` and `ml/architecture/blueprints/*`: do not edit
them. Do not touch unrelated dirty files in the tree. Never `rm`, never commit or push
(the architect does), never run a user training run through the dashboard.

**WP1 — Python registry wiring.**
- Files: `src/ml/cycle/adapter.py`, `main.py`, `models.py`.
- `adapter.py`:
  - `MODEL_FAMILIES`, `MODEL_LABELS`, `SEQUENCE_FAMILIES` and `NEURAL_FAMILIES` come from
    the registry: all keys, the display names, and `sequence` / `implementation == torch`.
    Keep the names so importers still work.
  - Add `NoPriceModel` (no library imports).
- `main.py`:
  - Decide the torch pre-import with `catalog.uses_torch(key)` or device ≠ cpu, reading
    the registry before numpy.
  - `--model-family` accepts registry keys; a non-runnable key fails with its reason.
  - Model flags come from `catalog.parameter_types()` with declared types: int, float;
    `str` for categorical; `argparse.BooleanOptionalAction` for bool.
  - Legacy keys resolve through `models.resolve_parameters`, everything else through
    `catalog.resolve_parameters`.
  - Remove the drift check against `FAMILY_DEFAULTS`, which is replaced by the registry.
  - Warn about flags that belong to other models.
- `models.py`:
  - `build_adapter(key, …)` dispatches by the registry's `adapter` through a lazy table of
    `"module:Class"` strings: scikit_learn → `cycle.sklearn_adapter:SklearnEstimatorAdapter`,
    catboost → `cycle.catboost_adapter:CatBoostAdapter`, statsmodels →
    `cycle.statsmodels_adapter:ProbitAdapter`, neural → `cycle.networks:NeuralAdapter`,
    legacy → today's path.
  - The constructor signature for non-legacy adapters is
    `(key, entry, parameters, device, seed, task)`.
  - `suggest_parameters` delegates to `catalog.suggest_parameters` for non-legacy keys.
  - `load_adapter` reads `model.json` `adapter` / `key` (old files: family → legacy).
  - `default_parameters` / `resolve_parameters` keep legacy behaviour.
- Tests: `tests/test_cycle_main.py` (flags equal the registry's; the torch-first rule;
  a non-runnable key's error); extend `tests/test_cycle_models.py` (dispatch table,
  legacy parity: the 8 keys' defaults, validation and recorded Optuna calls unchanged).

**WP4 — engine artifacts and direction-from-price.**
- Files: `src/ml/cycle/engine.py`, `features.py`, `store.py`, new `src/ml/cycle/derived.py`,
  `src/config/features.json` (add `displayName` to every feature; additive only).
- Engine:
  - Write `explain/*` at plan time and `fold_<k>/index.npz` before fitting.
  - Save each model right after its own fit.
  - Plan fields: `catalogSpecId`, `implementation`, `explainKind`, `directionMode`,
    `hasPriceModel`.
  - With no price model: one info line per run, no per-fold warning, and no forecast
    columns.
  - `derived.py`: `fit_logistic_curve(score, label)` (2-parameter, NaN-safe, well
    defined when one class is missing), and `DerivedDirectionAdapter` wrapping a price
    adapter.
  - The engine's direction factory for a `from_price` key returns it, and the fold's price
    model is the one inside it (fitted once).
  - Tuning uses the same factory.
- `FeatureSet.raw` keeps the pre-z-score columns.
- Tests: extend `tests/test_cycle_engine.py`:
  - the artifacts exist and match `engine.features`;
  - models exist after a stop during the walk;
  - a from_price model on the synthetic market trades, and its curve is fitted on
    validation rows only;
  - legacy engine output is unchanged.

**WP6 — server registry.**
- Files: new `src/server/training/cycleRunners.ts`, `cycleModels.ts` and
  `cycleModels.router.ts`; `registry.ts`; `runners.json` (delete the 8 blocks);
  `runners/pythonRunner.ts` (`--no-<flag>` when a default-true bool is false);
  `src/server/infrastructure/lib/modelImport/catalogBridge.ts` (runner keys ending
  `+walk_forward_cycle` do not "cover" a spec); `src/client/src/training/ModelCatalogPicker.tsx`
  (hide Cycle runners).
- `cycleRunners.ts` is pure: registry → runner blocks and composed model entries. Every
  model entry becomes a `<key>+walk_forward_cycle` runner, merged into both `listModels()`
  and `listRunners()`. Each runner carries `catalogId` and `scriptArgs: ["--model-family", key]`.
  Registry-only parameter fields (`argument`, `roles`, `search`) are stripped; `description`
  is kept for new models only. The registry folder is reloaded on file changes.
- For the 8 legacy keys, the composed runner and model entries must deep-equal
  `tests/fixtures/cycle_runners_legacy.json`.
- `GET /api/training/cycle-models` (router mounted by the architect): the registry joined
  with the catalog (`getCatalogModels` read-only). Categories and subcategories come from
  the catalog, with each registry model placed under its spec. `alsoCatalogSpecIds` appear
  as cards pointing at the same key. Every other catalog spec in the listed categories is
  greyed with `catalog.unavailable_reason`'s TypeScript twin. It falls back to the registry's
  own grouping when the catalog is absent. The response is validated with
  `cycleModelsResponseSchema`.
- Tests: `tests/server/cycleRunners.test.ts`, `cycleModelsRoute.test.ts`, extend
  `cycleRegistry.test.ts`, `pythonRunner` bool test, catalog lifecycle join.

**WP7 — explainer process pool and routes.**
- Files: new `src/server/training/cycleExplainer.ts`, `cycleExplain.router.ts`,
  `tests/fixtures/fake_cycle_explainer.py`, `tests/server/cycleExplainer.test.ts`,
  `cycleExplainRoute.test.ts`.
- One warm process for the whole server:
  `<repo>/.venv/Scripts/python.exe src/ml/cycle/explain_main.py --serve` (the command is
  overridable for tests).
- Environment `CUDA_VISIBLE_DEVICES=""`, `OMP_NUM_THREADS=4`, `PYTHONUNBUFFERED=1`.
- Spawned lazily; it must print its ready line within 60 s. Requests time out after 30 s.
- A newer `explain` request for the same (run, fold, role) supersedes one still queued
  (resolved as superseded, never sent). An LRU keeps 256 replies, keyed by the model
  files' mtimes.
- Crash handling: a crash rejects pending requests and respawns on the next request.
  After 3 crashes in 60 s it returns 503 with the tail of stderr.
- The process exits after 10 minutes idle; `stopCycleExplainer()` stops it on shutdown;
  `releaseRun(dir)` releases a run's files.
- Routes:
  - The manifest is read from disk by Node: `explain/manifest.json` plus fold readiness.
  - structure, tree and bar go through the pool.
  - `modelId` is validated with the same pattern as `anatomy.router.ts`, and the directory
    must be a direct child of `data/models`.
  - The bar request without `fold` uses the manifest fold whose test span holds the
    timestamp.
  - Replies are validated with the `explain.ts` schemas.

**WP8 — model browser.**
- Files: new `src/client/src/cycle/ModelBrowser.tsx`; `ConfigForm.tsx`;
  `useCycleCatalog.ts`; `parameterHelp.ts`; tests `tests/client/cycle-config.test.tsx`,
  new `cycle-model-browser.test.tsx`.
- The browser reads `GET /api/training/cycle-models` and has:
  - search and category/subcategory accordions;
  - cards with the kind badge, summary, speed, "no price model" and "reads a window of
    bars" chips, and the implementation note;
  - greyed cards with their reasons;
  - a "spec" link to `/model-catalog?model=<specId>`.
- It remembers the last model (`cycle-last-family-v1`). Hyperparameters still come from
  the runner (`useTrainableCatalog`). Parameter help comes from the registry `description`
  first, then `parameterHelp.ts`.
- Kind badges use Okabe-Ito only.

**WP10 — hover price and on-chart price text.**
- Files: `src/client/src/cycle/chartModel.ts`, `CycleChart.tsx`, `chartBands.ts`, tests
  `tests/client/cycle-chart.test.ts`.
- `readoutAt(columns, index, sources, plan)` returns:
  - the label move: the close h bars later, the move in points, ticks and USD per
    contract, and the resolution time;
  - "resolves at …" when not yet known;
  - the price model's forecast close and its error;
  - the trade entered at bar i+1's open, if any (number, side, fill, net), kept apart
    from the label move;
  - "roll-adjusted price" when the bar is before the last roll.
- The "wrong" mark is neutral grey plus ✗.
- `chartBands.ts`:
  - forecast price text beside each glyph when the bar spacing is 14 px or more;
  - on hover, a segment from the close to the resolution close, plus the forecast
    point.
- The crosshair publishes `setInspect(timestamp, "hover")` at most every 100 ms; a click
  calls `pinInspect(timestamp)`, and clicking the pinned bar again unpins it.

**Workflow 2 (after WP1 and WP4):**
- **WP2 — tabular adapters.** Owns `sklearn_adapter.py`, `catboost_adapter.py`,
  `statsmodels_adapter.py`, `fitting.py`, `scripts/benchmark_cycle_models.py`,
  `pyproject.toml` / `uv.lock` (`uv add catboost statsmodels`), and the non-neural JSON
  files' `runnable` flips.
- **WP3 — torch networks.** Owns `networks.py`: Elman recurrent, gated recurrent unit,
  attention recurrent, a feedforward activation option, a `network` kind replacing family
  names, and `trace()`. Also owns `neural.json`'s flips.
- **WP5a — tree and linear explainers.**
- **WP5b — the other explainers plus the server loop:** neighbors, naive Bayes, SVM,
  calibration and stacking, plus `explain_main.py` and `explain/{artifacts,server,common}.py`.

**Workflow 3:**
- **WP5c — the neural explainer.**
- **WP9a/b/c — the Inside-the-model views** in `src/client/src/cycle/inside/**`, with the
  tree diagram restored from
  `git show bf2be98^:src/client/src/system/architecture-explorer/trees/{TreeDiagram.tsx,types.ts}`.

## Verification gates

- `.venv/Scripts/python.exe -m pytest tests/test_cycle_*.py -q`
- `npx vitest run tests/server/cycle* tests/client/cycle* tests/shared`
- `npm run check`
- The legacy gate: the before/after predictions described above.
- G1–G4 through `scripts/verify_cycle_explain.py` on synthetic runs and a live sweep of
  every runnable key (20 training days, 2 test days, 1 fold, maximum speed).
- A benchmark: each model fits in 60 s or less per fold at its defaults on MNQ 5-minute
  bars with 60 training days.
- A browser check in the existing :5000 tab.
