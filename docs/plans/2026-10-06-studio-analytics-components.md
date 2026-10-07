# AI Studio analytics as reusable, per-family components; the Analytics tab rebuilt to complement it

**Asked (Tyler, 2026-10-06 21:23):** AI Studio analytics as plug-and-play components for any model kind — multimodal, mixture of experts, probabilistic / statistical, deep learning, transformers, gradient-boosted trees, clustering (force-directed graphs) — with saved analytics, and the Analytics tab overhauled to complement AI Studio.

**Done in this session (slice 0):** `apps/web/src/runs/analytics/families.ts` — the family registry (`analyticsFamilyOf(kind, modelKey)` → one of trees / neural / transformers / mixture / multimodal / probabilistic / clustering / agent / other; `FAMILY_PANELS` lists the panels each owns). `RunBody` reads the run's registry `kind` and draws only the panels its family owns (the loss surface for neural kinds, learning curves where a fit logs steps, search and readouts everywhere). The shared panels already exist as components: `LearningGrid`, `LossSurfacePanel` (`learning.tsx`), `TrialsChart`, `TrialParameterChart` (`charts.tsx`, `search.tsx`), `MetricReadouts` (`foldGrid.tsx`), `RunBarsChart`.

## What is missing, and where each panel's data comes from

| Panel | Family | Data source | Status |
| --- | --- | --- | --- |
| `attention` | transformers | `cycle/explain/neural.py` already writes per-layer, per-head attention for the explained bar (`cycle/inside/neural/`) | wire `InsidePanel`'s neural view to the run page: it is coupled to `useCycleStore` (`cycle/inside/InsidePanel.tsx`) and needs a props-only shell |
| `gate_routing` | mixture | not emitted: the MoE adapter (`networks_extra/mixture_of_experts.py`) has the gate weights per bar but nothing records them | add `gate_weights` to the explain artifact per bar; chart = stacked area of expert share over the test walk |
| `stream_contribution` | multimodal | `packages/ml-engine/src/multimodal/` has per-stream encoders; no per-bar attribution yet | gradient × input per stream at the explained bar; chart = waterfall per stream |
| `cluster_graph` | clustering | not emitted: clustering adapters assign a cluster per bar but the assignment is not in the record | add `assignments` (bar → cluster, centroid distances) to the explain artifact; chart = `shared/layout/ForceDirectedCluster.tsx` (exists, unused, needs Okabe-Ito colours) with bars as nodes, links by centroid proximity, a scrubber over the test walk |
| `calibration` | probabilistic | `report.py` calibration bins — already on the page under Prediction quality | move into the family panel set |
| saved analytics | all | `apps/web/src/analytics/runs/SavedRunsTab.tsx` saves comparisons in `localStorage` | land them as `data/analytics/saved/<id>.json` through a small router so a clone sees them |

## The Analytics tab (`/analytics`, `apps/web/src/analytics/`, 833-line page)

Today it is a four-layer (descriptive / diagnostic / predictive / prescriptive) view of one symbol with its own `GET /api/analytics`, plus a tricore HUD, a saved-runs tab and a model-archetype panel — much of it from the pre-run-page era, and the 2026-10-06 quality gate reports 40 unused imports and 93 red/green usages in it (the other session's in-flight files). The rebuild: the tab becomes the *across-runs* complement of the run page — the run page is one run, the Analytics tab is many: pick runs (by family, symbol, timeframe), the same family panels side by side, verdict counts over time, the metric readouts as a table with one row per run, and saved comparisons. Same components, same `RunView`, no second definition of any number.

## Order

1. Props-only `InsideView` shell → attention panel on the run page (transformers).
2. `assignments` explain artifact + force-directed cluster graph (clustering).
3. `gate_weights` + routing chart (mixture); stream attribution (multimodal).
4. Saved comparisons landed on disk; the Analytics tab rebuilt on `RunView` and the family panels.

Each step: a panel component under `apps/web/src/runs/analytics/`, a line in `FAMILY_PANELS`, its data from the engine's own artifacts, a test, and a run looked at in Chrome.
