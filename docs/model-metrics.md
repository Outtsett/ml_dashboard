# Model metrics: how every catalog model is judged

Every model in the catalogs carries, inside itself, the metrics it is judged on, the type of each
metric, its role, and the reason it applies to that model. This page is the reference for where
that record lives, what it contains, and how to change it.

## The idea in one picture

Think of a model as a trader on two desks.

```
                 NATIVE desk                                AS-RUN desk (Model Cycle)
   "What does this algorithm produce,           "Its call on the close label_horizon_bars ahead
    and how is THAT judged?"                     is traded with costs. Which of the engine's
                                                 numbers test something this model produced?"

   a class probability  -> logarithmic loss     meaningful            -> role + why
   a margin             -> area under the ROC   measured, not          -> the reason the number
   generated samples    -> fidelity + diversity  meaningful               says nothing here
   a policy             -> return of its own    stand-in?             -> what really runs
                           action
```

The two desks are never blurred. A generative adversarial network is judged natively on whether
its samples look real; as run, the dashboard trains a classifier on its generated rows and trades
that, so the as-run numbers describe the generator plus that readout, and the record says so.

## Where the record lives (one source each)

| Thing | Source of its record |
|---|---|
| A runnable model (272) | `metrics` on its entry in `packages/config/cycle_models/*.json`: both layers |
| A specification that is a model's primary link | generated from that entry |
| A specification linked through `alsoCatalogSpecIds` | its own native block, plus the linked model's as-run block |
| A specification the Model Cycle does not run (19) | its own native block; as-run is null |

Every specification's `## Evaluation Metrics` section holds the record twice: as tables for a
reader, and as one fenced JSON block under `### Machine-Readable Record`, which is what
`apps/api/infrastructure/lib/modelImport/parser.ts` (`extractMetricsRecord`) reads.
`scripts/data/render_model_metrics.py` is the only writer of both, so they cannot disagree.

Every id in a record resolves in **`packages/config/metric_registry.json`**:

| Registry part | What it holds |
|---|---|
| `metricTypes` | the closed list of metric types, each with the question it answers |
| `metrics` | one entry per quantity: full-word id, type, definition, formula, units, direction, reference point, availability, and the engine's column name when the engine computes it |
| `objectives` | training objectives by id (name, formula, plain words), so a model names its objective instead of pasting a formula |
| `profiles` | evaluation profiles keyed by what a model produces, each with its metrics, roles and reasons |
| `asRunRules`, `assignmentRules` | the rules the records were written to |
| `engineGaps` | metrics that profiles need and the engine does not compute, with what each would take |

One definition per quantity: for a metric the engine computes, the registry's `definition`,
`formula` and `units` are the engine's own text (`packages/ml-engine/src/cycle/report.py`
`DEFINITIONS`), pinned by `packages/ml-engine/tests/test_metric_registry.py`. Five engine names
abbreviate (`log_loss`, `roc_auc`, `f1_score`, `f1_score_down`, `macro_f1_score`); the registry
gives them full-word ids and keeps the engine's name in `engineId`.

## The record

Shape and rules: `packages/shared/src/cycle/metrics.ts` (zod), mirrored in
`packages/ml-engine/src/cycle/catalog.py` (`_validate_metrics`).

```
metrics
  profileIdNative, profileIdAsRun, additionalProfileIds
  native
    produces            one sentence: what the model outputs natively
    targetVariable      full words: what that output is a statement about
    objectiveId         the literature objective, by registry id
    objectiveNote       what this model's version of it adds
    metrics[]           metricId, type, role, why, baseline, groupKind, availability
    notApplicable[]     name, metricId, why      (metrics people wrongly expect)
  asRun
    faithfulToSpecification   faithful | partial | stand_in | no_specification
    standInNote               what the runnable adapter does instead (null exactly when faithful)
    probabilitySource         how the probability of up is really formed, from the adapter code
    classWeighted, probabilityNote
    priceForecastSource       own_model | own_model_shared_encoder | second_model_same_family | readout | none
    objectiveId               what the runnable adapter minimises
    checkpointSelectedBy, tuned
    stepQuantity              what train_loss and validation_loss hold, and whether they are the same quantity
    meaningful[]              metricId, type, role, why
    measuredNotMeaningful[]   metricId, why
    caveats[]
```

- **Role**: `primary` is the number that says whether the model did its job (one to three per
  layer); `secondary` supports or qualifies it; `diagnostic` explains why and is never a score.
- **Availability** (from the registry, never typed by hand): `computed` (in the run record),
  `computed_not_recorded` (the adapter has it, it reaches only the log), `derivable` (from the
  run-record tables, no code yet), `not_computed`.
- **Reference points** are the same model on the same series (the fold's training up share, the
  majority class, buy and hold, the no-change forecast) or a mathematical constant. No record
  states a target threshold, and no record compares one model with another.
- A number the checkpoint was selected on is never primary: it is optimistic where it was chosen.

## Where it is shown

| Surface | What it draws |
|---|---|
| `/model-catalog`, a model's **Metrics** panel | `SpecificationMetricsPanel`: native layer first |
| `/training` (the run page), under Configuration | `RunnableModelMetricsPanel`: as-run layer first |
| `/training`, the prediction and trading tiles | each tile is marked primary, secondary, diagnostic or not meaningful for the model that ran, with the reason on hover |

The panel (`apps/web/src/ml/metrics/ModelMetricsPanel.tsx`) switches layer, filters by role and by
type, and opens each metric to its definition, formula, units, reference point and the engine's
column name.

API (`apps/api/ml/modelMetrics.router.ts`):

```
GET /api/model-metrics/registry               the metric registry
GET /api/model-metrics/models/:key            a runnable model's record
GET /api/model-metrics/specifications/:id     a catalog specification's record
GET /api/model-metrics/coverage               counts by profile, fidelity, probability source,
                                              availability of the primary metric; cross-check problems
```

## Changing a record

1. Edit `metrics` on the model's entry in `packages/config/cycle_models/<file>.json`, or, for a
   specification with no runnable model, the JSON block in its `## Evaluation Metrics` section.
2. `python scripts/data/render_model_metrics.py` rewrites the sections of both specification
   trees (the catalog's root under `Trading/_architecture/educational/algo_models` and the reading
   copy at `E:/source/documents/algo_models`).
3. `python scripts/data/render_model_metrics.py --check` exits 1 when a section is stale.

A new registry model needs a `metrics` block: both loaders reject an entry without one.
A new metric is a new entry in `metric_registry.json`; if the engine computes it, add it to
`report.py` `DEFINITIONS` first and copy its text, or the parity test fails.

## Gates

| Check | Command |
|---|---|
| Registry parity with the engine, every model's record, every section current | `python -m pytest packages/ml-engine/tests/test_metric_registry.py` |
| Both registry loaders accept the registry and reject every invalid fixture | `python -m pytest packages/ml-engine/tests/test_cycle_catalog_contract.py`; `npx vitest run tests/shared/cycleModels.test.ts` |
| Every record resolves; a primary specification carries its model's record | `npx vitest run tests/shared/cycleMetrics.test.ts` |
| The panel's controls | `npx vitest run apps/web/tests/model-metrics-panel.test.tsx` |

## How the records were written (2026-10-07)

Stage 1 inventoried what the engine measures and what each of the 46 adapter groups really
optimises, wrote the registry and 40 evaluation profiles from the literature, and had three
adversarial reviewers attack the draft (machine-learning correctness, trading validity against the
code, coverage over the real corpus) before a revision. Stage 2 aligned the 300 specifications and
272 runnable models in 78 folder batches; each batch was written by one agent against a validator,
then an independent reviewer tried to prove its records wrong against the specification and the
adapter code, and blocker and major findings were repaired. The specifications' former sections
were stamped on 2026-10-06 from seven templates (a Gaussian likelihood objective on XGBoost, an
evidence lower bound on an adversarial autoencoder, invented thresholds such as "> 54.5%"); each
former row is recorded under the model's `notApplicable` with the reason it did not apply, or kept
as the registry metric it corresponds to.
