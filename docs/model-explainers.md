# Model explainers

Every written catalog specification has a plain-language explainer: how the model works step by
step, what to use it for, when to reach for another model, and one worked example from input to
output. The catalog shows it as the first tab of a model, "How it works".

## Where things are

| | |
|---|---|
| Content | `packages/config/model_explainers/<specificationId>.json`, one file per specification (300) |
| Schema | `packages/shared/src/modelExplainer.ts` (`modelExplainerSchema`) |
| Server | `apps/api/infrastructure/lib/modelImport/explainers.ts`, `GET /api/model-catalog/:id/explainer` |
| Page | `apps/web/src/ml/explainer/HowItWorksPanel.tsx`, hook `useModelExplainer` |
| Gate | `npx tsx scripts/validate_model_explainers.ts [id ...]`, `tests/shared/modelExplainers.test.ts` |

## The record

- `analogy`: "Think of it as ...", the model as something familiar.
- `steps` (4 to 8): the model's mechanism in order. Each step has a `description` and an
  `inExample` line saying what the step does to the worked example, so the page's stepper moves the
  example along with the step.
- `useFor` (3 to 5): a job and one concrete case of it.
- `avoidWhen` (1 to 3): when another kind of model is the better choice, and why.
- `example`: a `scenario`, the `input` fields, the `output` fields and a `reading` of the output.

## Rules the schema enforces

- Plain words: no formulas, LaTeX or mathematical symbols.
- No decimal numbers anywhere. A probability is a whole percentage ("58 percent"), a multiple is a
  percentage above or below ("80 percent above average"), a price is a whole number. Tyler reads
  percentages and whole numbers at a glance and decimals slowly (2026-10-08).
- `specificationId` equals the file name.

## What the example is

An illustration of the kind of input the model takes and the kind of output it returns. It is not
a measured run and the page says so beside it; a model's measured results are in its Runs tab. An
explainer never states an edge, a profit or an accuracy as a fact.

## Entries without an explainer

The catalog also lists 23 entries that are trained models or run records (ids starting `MNQ_`),
not specifications. They have no explainer; the panel says so and points to Blueprint and Runs.

## Adding or changing one

Write the JSON file, run the validator on its id, reload the page. The server finds the file by
directory listing and re-reads it when its modification time changes; no restart is needed.
