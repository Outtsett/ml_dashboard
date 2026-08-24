# ML Studio — Workshop Redesign

**Date:** 2026-05-09
**Status:** Plan (not yet executed)
**Supersedes (in part):** `docs/plans/2026-05-08-ml-studio-end-to-end.md` (P5/P6 sections); P1+P2+P3+P4 of that plan remain as the foundation this builds on.

---

## 1. Context

The current ML Studio (`src/client/src/pages/ml-studio/`) is a 6-stage linear pipeline: **Data → Features → Labels → Train → Evaluate → Promote**. Stages 1–4 are functional through P4 (data/features/labels previews + Train via the legacy `<Training />` page). Stage 5 (Evaluate) lazy-renders the legacy Backtest page. Stage 6 (Promote) is a placeholder with disabled deploy buttons; the deployment table + paper/live wiring are explicit P5/P6 deferred work.

The model picker in Stage 4 today reads only the 4 wired entries in `src/config/runners.json`:
- `xgboost+direction_classifier`
- `transformer_2s+range_classifier`
- `transformer_tiny+direction_classifier`
- `primitives_cnn+multi_head`

Tyler's mental model is a workshop where you build a model from a parts shelf. The parts shelf is the existing **`E:\documents\algo_models\` catalog** — 14 top-level categories of `.md` spec files (XGBoost, LightGBM, CatBoost, Random Forest, KNN, SVM, CNN, Transformer, Autoencoder, GMM, HMM, DQN, PPO, etc.) — each with typed hyperparameters extractable from markdown. A sophisticated bridge already exists at `src/server/lib/catalogBridge.ts` that auto-converts any catalog spec to a draft `ModelRegistryEntry` with full hyperparameter conversion via 8 family templates.

**The trainability gap:** every catalog spec auto-generates a draft entry with `script: ""` → `trainable: false`. Today the picker shows them as "Browse Only".

**Goal:** every catalog entry selectable + trainable in the workshop, the existing 6-stage flow preserved, Stage 5 (Evaluate) and Stage 6 (Promote) redesigned to fit a workshop where models are built, compared, and shipped.

## 2. Workshop principles

1. **Keep the 6-stage stepper.** Linear gating works for new pipelines; users learn the flow once. Workshop = the experience inside each stage, not a replacement for the stepper.
2. **Catalog is the source of truth for available models.** Picking happens in the catalog, not in `runners.json`. Wired entries get a fast path; spec entries route through generic runners; hand-written entries override generic ones.
3. **Per-model code generation.** Picking a non-wired catalog entry triggers a code generator that renders a dedicated `src/ml/<catalog_id>/main.py` file from a family-specific Jinja2 template, baking in the chosen hyperparameters + walk-forward config + label strategy. Generated code surfaces in a Monaco editor where the user can review and edit before saving. Once saved, the entry registers in `runners.json` and becomes WIRED — future runs spawn that exact file. Each generated model is a real, version-controlled project artifact that can be customized per-model without affecting siblings.
4. **Multiple experiments live side-by-side.** A single (symbol, timeframe) MLStudioContext can hold N concurrent experiments; the registry retains every WF-validated checkpoint with full lineage. Comparison is first-class.
5. **Workshop AI agents are per-stage assistants.** Each stage gets a "Ask agent" affordance that dispatches to a specialist (feature-curator, arch-designer, hpo-strategist, eval-reviewer) using the existing `~/.claude/agents/` pattern. Agents augment, never replace, manual control.
6. **Build on what exists. Delete only when superseded.** `ModelCatalogPicker.tsx`, `catalogBridge.ts`, `models.json/algorithms.json/tasks.json/runners.json`, `useModelCheckpoints`, the SSE training protocol, the existing `<Training />` and `<Backtest />` pages — all stay. New code wires them differently.

## 3. Target architecture (one diagram)

```
┌─ Stage 4: Train (workshop) ─────────────────────────────────────────────────┐
│                                                                              │
│  ┌─ ModelCatalogPicker (already exists) ────┐  ┌─ Composer (form, new) ────┐│
│  │ Search · Category filter · Trainable-only │  │ Atomic: hp form          ││
│  │                                           │  │ MoE: n_experts +         ││
│  │ ◉ XGBoost              [WIRED]            │  │   sub-pickers per slot   ││
│  │   LightGBM             [GENERATE-tree]    │  │ Multimodal: per-modality ││
│  │   Random Forest        [GENERATE-sklearn] │  │   encoder pickers +      ││
│  │   CNN                  [GENERATE-torch]   │  │   fusion strategy        ││
│  │   GMM                  [GENERATE-hmmlearn]│  │ Stacking/Voting:         ││
│  │   DQN                  [BROWSE-ONLY]      │  │   member sub-pickers     ││
│  │   ...                                     │  │ [Generate code →]        ││
│  └───────────────────────────────────────────┘  └──────────────────────────┘│
│                                                                              │
│  ┌─ Generated code preview (Monaco) — appears after [Generate code] ───────┐│
│  │ # src/ml/lightgbm_v1/main.py                                            ││
│  │ # Generated 2026-05-09 from machine-learning/.../lightgbm.md            ││
│  │ # Hyperparameters baked in; edit freely before [Save & train].          ││
│  │ import lightgbm as lgb                                                  ││
│  │ from src.ml.shared.data import load_ohlcv_arrays                        ││
│  │ from src.ml.shared.protocol import emit_metric, emit_done               ││
│  │ ...                                                                      ││
│  │ [✎ Edit]   [↺ Regenerate]   [💾 Save & train]   [Save without training] ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Walk-forward + objective panel (form, new) ────────────────────────────┐│
│  │ folds · fold_months · purge_bars · objective · n_trials                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Live training surface (existing <Training/>, mounted inline) ──────────┐│
│  │ Per-fold metrics, calibration curve, GPU headroom, ETA, early-stop       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Experiment ledger (new, lives in MLStudioContext) ─────────────────────┐│
│  │ exp_001  XGBoost  fold 3/5  (in-progress)                               ││
│  │ exp_002  CNN      done       Sharpe 0.42  PF 1.31  ECE 0.04             ││
│  │ exp_003  LightGBM done       Sharpe 0.51  PF 1.44  ECE 0.07  ★ best     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘

┌─ Stage 5: Evaluate (workshop redesign) ─────────────────────────────────────┐
│  Per-experiment OR per-checkpoint backtest. Runs the existing backtest      │
│  engine but renders a multi-experiment comparison surface:                  │
│                                                                              │
│  ┌─ Comparison matrix (new) ───────────────────────────────────────────────┐│
│  │ Metric        │ exp_001 │ exp_002 │ exp_003 │ baseline (buy&hold) │ Δ   ││
│  │ Sharpe        │   0.18  │   0.42  │   0.51  │     -0.05           │+0.56││
│  │ Profit factor │   0.98  │   1.31  │   1.44  │      0.94           │+0.50││
│  │ Max DD        │  -8.2%  │  -4.1%  │  -3.7%  │     -12.4%          │     ││
│  │ ECE           │   0.12  │   0.04  │   0.07  │      n/a            │     ││
│  │ ...                                                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Walk-forward fold breakdown ───────────────────────────────────────────┐│
│  │ Per-fold equity curves overlaid; fold dispersion (CI95) computed via     ││
│  │ block bootstrap. Identifies fragile experiments (high σ across folds).  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Regime breakdown ──────────────────────────────────────────────────────┐│
│  │ Per-experiment metrics conditioned on regime (low-vol, high-vol, trend, ││
│  │ chop). Surfaces models that win only in one regime.                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Agent: eval-reviewer ──────────────────────────────────────────────────┐│
│  │ One-click: "Audit experiments for leakage, overfit, regime coverage"    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘

┌─ Stage 6: Promote (workshop redesign) ──────────────────────────────────────┐
│                                                                              │
│  ┌─ Model Registry (new SQLite table `model_versions`) ────────────────────┐│
│  │ version_id │ catalog_id     │ status   │ data_hash │ Sharpe │ promoted  ││
│  │ v_001      │ xgboost        │ paper    │ ab12...   │  0.42  │ 2026-04-30││
│  │ v_002      │ lightgbm       │ shadow   │ cd34...   │  0.51  │ 2026-05-01││
│  │ v_003      │ cnn-transformer│ candidate│ ef56...   │  0.38  │ 2026-05-02││
│  │ v_004      │ xgboost        │ live     │ ab12...   │  0.45  │ 2026-04-15││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Promotion gate panel (per transition) ─────────────────────────────────┐│
│  │ candidate → shadow:  Sharpe ≥ 0.20 ✓  ECE ≤ 0.10 ✓  fold-σ ≤ 0.30 ✓     ││
│  │ shadow → paper:      block-bootstrap p < 0.05 vs baseline ✗ (p=0.13)    ││
│  │ paper → live:        14d paper PnL > 0 ✓  prediction drift < 0.20 ✓     ││
│  │ [Promote v_002 to paper]   [Override gate]   [Schedule re-eval]         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Lineage card (per version) ────────────────────────────────────────────┐│
│  │ Catalog spec: machine-learning/.../lightgbm.md                          ││
│  │ Data: MNQ 1m  2024-01-01 → 2025-12-31  (96.4M bars)  hash:cd34...       ││
│  │ Features: default-35 (price_action, volatility, volume, momentum)       ││
│  │ Labels: triple_barrier  pt=2.0  sl=1.0  max_hold=20                     ││
│  │ HPO: 50 trials  TPE  pruner=median                                      ││
│  │ Train: 2026-05-01 14:23 UTC  3m12s  GPU  trial #42 won                  ││
│  │ Eval: 5-fold WF  Sharpe 0.51 ± 0.18  PF 1.44  ECE 0.07                  ││
│  │ Calibration: isotonic post-hoc                                          ││
│  │ Code: src/ml/_generic/sklearn_runner.py @ git:7f4b...                   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─ Active deployments ────────────────────────────────────────────────────┐│
│  │ MNQ 1m   live    v_004  pred/min=14  paper-PnL=+$432 (since 2026-04-15) ││
│  │ MNQ 1d   paper   v_002  pred/day=1   paper-PnL=+$83 (since 2026-05-01)  ││
│  │ [Pause]  [Rollback to v_001]  [Stop]                                    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

## 4. Stage-by-stage redesign

### Stage 1 — Data (no change)
Already done in P4. Date pickers clamped to coverage, server-side preview at `GET /api/training/data-preview`. Workshop addition: bind the `agent: feature-curator` button to the stage so it can read the data preview and propose feature categories before stage 2.

### Stage 2 — Features (no change to core; add agent button)
Already done in P4. Workshop addition: `agent: feature-curator` button → calls a Claude agent with the data preview + the current feature pipeline + the redundant-pair findings, suggests adds/drops.

### Stage 3 — Labels (no change to core; add agent button)
Already done in P4. Workshop addition: `agent: hpo-strategist` button → looks at the labels' class balance + the data span + the chosen catalog model, recommends a search space tighter than `defaultSearchSpace` based on the spec's hyperparameter sensitivity hints.

### Stage 4 — Train (large redesign)

Replace the legacy `<Training />` import path with a new composition:

```tsx
// src/client/src/pages/ml-studio/stages/TrainStage.tsx (rewritten)
<TrainStageWorkshop>
  <ModelCatalogPicker />              {/* exists; just wire it */}
  <ArchitectureComposer />            {/* new — see below */}
  <WalkForwardObjectivePanel />       {/* new — extract from legacy Training */}
  <LiveTrainingSurface />             {/* lazy <Training /> kept for live SSE view */}
  <ExperimentLedger />                {/* new — see below */}
</TrainStageWorkshop>
```

#### `ModelCatalogPicker` wiring
File: `src/client/src/components/training/ModelCatalogPicker.tsx`. Change the data source from `/api/training/config` (which returns only `runners.json`) to `/api/model-catalog/trainable` (NEW endpoint backed by `getTrainableModels()` in `catalogBridge.ts`). Show every catalog entry. Badges:
- **WIRED** = entry has `script` set + script exists on disk (`catalogBridge.hasTrainingScript()`)
- **GENERIC-tree / GENERIC-sklearn / GENERIC-torch / GENERIC-hmm** = will train via the generic runner for that family
- **BROWSE-ONLY** = no family template match (RL etc. until phase 4)

Selection writes the catalog ID into `MLStudioContext.modelType` (composite key OR raw catalog ID — orchestrator resolves both via `getModelTrainingConfig()`).

#### `ArchitectureComposer` (new)
For atomic models: a flat form rendered from the merged hyperparameter list (registry override > catalog spec defaults). Existing component pattern — Hyperparameter forms already render `models.json` entries.

For composite models declared via a new optional `composition` field on the catalog entry:
- **MoE**: `n_experts` (int), `gating_type` (`top_k|soft|hash`), `gating_temperature` (float), `expert_slots`: array of nested `ModelCatalogPicker` instances (each picks a wired/generic model from a constrained subset)
- **Multimodal**: `modalities`: array of {`name`: `price|volume|orderflow|macro|text`, `encoder`: nested picker, `weight`: float}, `fusion_strategy` (`concat|cross_attention|gated`)
- **Stacking/Voting**: `members`: array of nested pickers, `combiner` (`logistic_meta|voting|weighted_average`)

Composite specs live as new JSON entries in `src/config/composite_models.json` (added in phase 3); each declares the form schema + which generic runner backs it.

Composite training routes through `src/ml/_generic/composite_runner.py` which assembles `nn.Module`s from the project's existing block library at (NEW) `src/ml/blocks/`.

#### `WalkForwardObjectivePanel` (new)
Extract from the legacy `<Training />` ConfigStrip — same fields (folds, fold_months, purge_bars, objective, n_trials, MedianPruner toggle) but lifted into MLStudioContext. Defaults inherited from runner's `defaultSearchSpace` if HPO mode selected.

#### `LiveTrainingSurface` (kept)
Keep the existing `<Training />` lazy-mounted, but stripped of its internal ConfigStrip (the composer above replaces it). Reads via `useTrainingControl()` and `useTrainingLive()` — no prop threading.

#### `ExperimentLedger` (new)
A new field `experiments: ExperimentRecord[]` on MLStudioContext. Each record: `{ id, catalogId, hyperparams, walkForward, status, foldMetrics, summary, startedAt, completedAt }`. Dispatching a new training run pushes an in-progress record; the SSE `done` event closes it with the final summary. Renders as a sortable table at the bottom of the Train stage; clicking a row pre-fills the composer with that experiment's config (instant fork).

#### `agent: arch-designer` button
Dispatches to a Claude agent with the catalog ID, data preview, label distribution, and current hyperparameters. Agent proposes 2–3 architecture variations (e.g., "try adding a 4-layer encoder before the gating", "reduce d_model from 256 to 128 for the data size") and emits them as new ExperimentLedger entries marked `proposed`.

### Stage 5 — Evaluate (large redesign)

Replace lazy `<Backtest />` with a multi-experiment comparison surface that calls the existing backtest engine per experiment.

```tsx
// src/client/src/pages/ml-studio/stages/EvaluateStage.tsx (rewritten)
<EvaluateStage>
  <ExperimentSelector multiSelect />                      {/* pick 1-N from ledger */}
  <BacktestRunner />                                       {/* runs existing backtest per selection */}
  <ComparisonMatrix />                                     {/* metrics × experiments table */}
  <WalkForwardFoldOverlay />                               {/* equity curves per fold per exp */}
  <RegimeBreakdown />                                      {/* metrics conditioned on regime */}
  <CalibrationPanel />                                     {/* reliability curves overlaid */}
  <BlockBootstrapCI />                                     {/* CI95 of headline metrics */}
  <BaselineComparison />                                   {/* vs buy-hold + naive momentum */}
  <AgentButton agent="eval-reviewer" />                    {/* leakage/overfit audit */}
</EvaluateStage>
```

`BacktestRunner` calls existing `/api/backtests` per selected experiment (already used by the legacy Backtest page), stores `run_id` per experiment in MLStudioContext.

`ComparisonMatrix` reads `backtest_runs` + `backtest_trades` SQLite tables; metrics: Sharpe (after costs), profit factor, win rate, max drawdown, ECE, mean trade PnL, trade frequency, regime-conditional Sharpe.

`WalkForwardFoldOverlay` reads per-fold metrics from `diagnostics.json` per experiment; renders overlaid equity curves with CI95 band per experiment via Recharts.

`RegimeBreakdown` joins backtest trades against the existing `market_regimes` SQLite table (regime tag per timestamp), groups metrics by regime.

`BlockBootstrapCI` runs in-browser (small datasets) or via a new `POST /api/eval/block-bootstrap` route for large; uses the trade-PnL series, block size = √n.

`agent: eval-reviewer` calls a Claude agent with the comparison matrix, fold breakdowns, and lineage; reports leakage signals (e.g., feature using future info), overfit signals (huge train-OOS gap), regime overfit (only one regime profitable).

### Stage 6 — Promote (full redesign)

Replace the placeholder `DashboardTab` + disabled deploy buttons with the model registry described in section 3.

#### New SQLite schema (migration `migrations/0002_model_registry.sql`)

```sql
CREATE TABLE IF NOT EXISTS model_versions (
  version_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id          TEXT NOT NULL,                  -- catalog spec slug
  runner_key          TEXT NOT NULL,                  -- composite key actually used
  status              TEXT NOT NULL CHECK (status IN ('candidate','shadow','paper','live','retired')),
  data_hash           TEXT NOT NULL,                  -- sha256 of (symbol, tf, date_range, feature_pipeline, label_config)
  symbol              TEXT NOT NULL,
  timeframe           TEXT NOT NULL,
  date_range_start    TEXT NOT NULL,
  date_range_end      TEXT NOT NULL,
  feature_pipeline    TEXT NOT NULL,
  label_config        TEXT NOT NULL,                  -- JSON
  hyperparameters     TEXT NOT NULL,                  -- JSON
  walk_forward_config TEXT,                           -- JSON
  hpo_study_id        TEXT,
  model_artifact_path TEXT NOT NULL,                  -- relative to data/models/
  diagnostics_path    TEXT NOT NULL,
  metrics_summary     TEXT NOT NULL,                  -- JSON: {sharpe, pf, ece, fold_dispersion, ...}
  trained_at          TEXT NOT NULL,                  -- ISO UTC
  promoted_at         TEXT,
  retired_at          TEXT,
  parent_version_id   INTEGER REFERENCES model_versions(version_id),
  notes               TEXT
);
CREATE INDEX idx_model_versions_status ON model_versions(status);
CREATE INDEX idx_model_versions_catalog ON model_versions(catalog_id);
CREATE INDEX idx_model_versions_symbol_tf ON model_versions(symbol, timeframe);

CREATE TABLE IF NOT EXISTS deployments (
  deployment_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id          INTEGER NOT NULL REFERENCES model_versions(version_id),
  mode                TEXT NOT NULL CHECK (mode IN ('shadow','paper','live')),
  status              TEXT NOT NULL CHECK (status IN ('running','paused','stopped','failed')),
  symbol              TEXT NOT NULL,
  timeframe           TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  stopped_at          TEXT,
  predictions_emitted INTEGER NOT NULL DEFAULT 0,
  paper_pnl           REAL,
  notes               TEXT
);
CREATE INDEX idx_deployments_version ON deployments(version_id);
CREATE INDEX idx_deployments_status ON deployments(status);

CREATE TABLE IF NOT EXISTS promotion_gates (
  gate_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_status         TEXT NOT NULL,
  to_status           TEXT NOT NULL,
  metric              TEXT NOT NULL,
  comparator          TEXT NOT NULL CHECK (comparator IN ('>=','<=','>','<','==','!=')),
  threshold           REAL NOT NULL,
  enforced            INTEGER NOT NULL DEFAULT 1,     -- 0 = warn-only
  description         TEXT
);
-- seed with default gates
INSERT INTO promotion_gates (from_status, to_status, metric, comparator, threshold, description) VALUES
  ('candidate','shadow','sharpe_after_costs','>=',0.20,'Cost-adjusted Sharpe minimum'),
  ('candidate','shadow','ece','<=',0.10,'Calibration error ceiling'),
  ('candidate','shadow','fold_dispersion','<=',0.30,'Walk-forward fold-Sharpe std cap'),
  ('shadow','paper','bootstrap_pvalue_vs_baseline','<=',0.05,'Block-bootstrap p-value vs buy-hold'),
  ('paper','live','paper_pnl_14d','>',0.0,'14-day paper PnL must be positive'),
  ('paper','live','prediction_drift','<=',0.20,'PSI drift between training and live distribution');
```

#### New backend routes (`src/server/routes/registry.ts` + `src/server/routes/deployments.ts`)
- `POST /api/model-versions` — register a checkpoint as `candidate` (called by orchestrator on training completion)
- `GET /api/model-versions?status=&catalog_id=&symbol=&timeframe=` — filtered list
- `GET /api/model-versions/:id` — full lineage card
- `POST /api/model-versions/:id/promote` — body `{ to_status }`; evaluates `promotion_gates`, returns `{ allowed: bool, gate_results: [...] }`; if allowed, writes `promoted_at` + `status`
- `POST /api/model-versions/:id/rollback` — body `{ to_version_id }`; switches the active deployment back
- `GET /api/deployments?status=running` — current deployments
- `POST /api/deployments` — start a new deployment (paper or live); body `{ version_id, mode, symbol, timeframe }`
- `POST /api/deployments/:id/pause` / `/stop`
- `GET /api/events/deployments` — SSE channel for prediction emission + paper PnL updates

#### Frontend (rewrite `PromoteStage.tsx`)
- `<RegistryTable>` — sortable, filterable, status badges, lineage drill-down
- `<LineageCard versionId={...}/>` — full provenance per version (see section 3)
- `<PromotionGatePanel versionId={...} targetStatus={...}/>` — calls `/promote` with `dryRun: true`, shows gate-by-gate pass/fail with the actual measured value vs threshold, allows override with reason text
- `<DeploymentPanel>` — current deployments table + start/pause/stop/rollback controls
- `<DeploymentLiveMetrics>` — subscribes to `/api/events/deployments` SSE channel, shows pred/min, paper PnL, prediction drift PSI

#### Live deploy (P6 sub-stage, behind `ENABLE_LIVE_DEPLOY=1`)
Bridges to the MLBridge ZMQ scoring engine (per existing plan). When `mode='live'`, the orchestrator opens a ZMQ REQ socket to the MLBridge endpoint, pushes one message per bar with the model's prediction; MLBridge handles order placement on its side. Predictions also persist to QuestDB `prediction_log` for shadow comparison.

## 5. The trainability gap fix — per-model code generation

This is the foundation everything depends on. Without it, the catalog picker still shows BROWSE-ONLY for non-wired entries. The flow:

```
[Pick catalog entry]
  → [Form composer collects hyperparameters + WF + label config]
    → [POST /api/training/generate-code]
      → [Python generator script renders Jinja2 template → code string]
        → [Monaco shows generated Python; user edits if desired]
          → [Save & train]
            → [Code written to src/ml/<modelId>/main.py]
            → [Entry registered in runners.json (auto-merge)]
            → [Orchestrator spawns the new file via existing pythonRunner path]
            → [Future runs of this exact (catalog_id, hp_hash) skip generation — straight to train]
```

Generated entries become first-class WIRED models — same status as `xgb_classifier`, same registry, same orchestrator path. The only difference is provenance: a `generated_from: { catalogId, templateVersion, generatedAt, sourceHash }` block in the runner entry's metadata.

### Templates: `src/templates/architectures/`

```
src/templates/architectures/
├── _base.py.j2                  # Common header: imports, CLI argparse, protocol setup
├── _walk_forward.py.j2          # WF harness fragment included by all
├── _eval_classification.py.j2   # Metrics + checkpoint + oos_predictions writer (classification)
├── _eval_regression.py.j2       # Same for regression
├── _eval_clustering.py.j2       # Silhouette / Davies-Bouldin / regime tags
├── sklearn.py.j2                # ALL sklearn-API models — class import + fit/predict
├── tree.py.j2                   # XGBoost / LightGBM / CatBoost — early stopping + SHAP
├── pytorch_mlp.py.j2            # Generic MLP with configurable depth/width
├── pytorch_cnn.py.j2            # 1D CNN over rolling windows
├── pytorch_autoencoder.py.j2    # Encoder + decoder, reconstruction loss
├── pytorch_vae.py.j2            # Variational version
├── transformer_seq.py.j2        # Generic transformer encoder over OHLCV windows
├── hmm.py.j2                    # hmmlearn — Gaussian / GMM emissions
├── gmm.py.j2                    # sklearn.mixture.GaussianMixture (separate from sklearn template — different fit signature)
├── composite_moe.py.j2          # Mixture-of-experts assembly
├── composite_stacking.py.j2     # Stacking ensemble
├── composite_voting.py.j2       # Voting ensemble
└── composite_multimodal.py.j2   # Multi-stream encoder + fusion head
```

Each template receives a context dict:
```jinja2
{# Context vars passed to every template #}
{# - model_id: str — slug for the new src/ml/<model_id>/ dir #}
{# - catalog_id: str — original catalog spec slug #}
{# - catalog_spec: ParsedModelSpec — full parsed spec #}
{# - hyperparameters: dict — user-chosen values #}
{# - walk_forward: dict | None — fold config #}
{# - label_strategy: str — triple_barrier | next_close_direction | range_bucket | structural #}
{# - label_params: dict — strategy-specific knobs #}
{# - feature_pipeline: str — pipeline ID #}
{# - feature_categories: list[str] — selected categories #}
{# - generated_at: str — ISO UTC #}
{# - template_version: str — semver of template #}
```

Example — `sklearn.py.j2` (abbreviated):
```jinja2
{% extends "_base.py.j2" %}
{% block model_train %}
from {{ catalog_spec.module_path }} import {{ catalog_spec.class_name }}
from src.ml.shared.data import load_ohlcv_arrays
from src.ml.shared.features import compute_features
from src.ml.shared.labels import {{ label_strategy }}_labels
from src.ml.shared.protocol import emit_metric, emit_config, emit_done
{% include "_walk_forward.py.j2" %}

def train_one_fold(X_train, y_train, X_test, y_test, args):
    model = {{ catalog_spec.class_name }}(
        {%- for name, value in hyperparameters.items() %}
        {{ name }}={{ value | python_repr }},
        {%- endfor %}
    )
    model.fit(X_train, y_train)
    preds = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else model.predict(X_test)
    return model, preds

{% include "_eval_classification.py.j2" %}
{% endblock %}
```

The `python_repr` Jinja filter handles serializing values back to Python syntax (`True`, `0.05`, `"liblinear"`, `[1, 2, 3]`).

### Generator service

**Python entry point: `scripts/generate_model.py`**
```python
# Usage:
#   python scripts/generate_model.py \
#     --catalog-id random-forest \
#     --model-id rf_v1 \
#     --hyperparameters-json '{"n_estimators":500,"max_depth":8}' \
#     --walk-forward-json '{"trainMonths":12,"testMonths":3}' \
#     --label-strategy triple_barrier \
#     --label-params-json '{"pt":2.0,"sl":1.0,"max_hold":20}' \
#     --feature-pipeline default-35 \
#     --feature-categories-json '["price_action","volatility","volume","momentum"]' \
#     --template-dir src/templates/architectures \
#     --output-dir src/ml/rf_v1 \
#     [--dry-run]    # prints to stdout instead of writing
#     [--register]   # also writes runner entry into src/config/runners.json
```

Resolves the right template from the catalog spec's family + variant (e.g., `sklearn` for Random Forest, `pytorch_autoencoder` for Autoencoder). Renders via Jinja2. If `--dry-run`, prints to stdout. Otherwise creates `src/ml/<model_id>/{main.py,labels.py,eval.py}` and a `manifest.json` capturing the generation context. If `--register`, also patches `runners.json` with a new composite key `generated_<model_id>+<task>`.

**TypeScript wrapper: `src/server/lib/codeGenerator.ts`**
Spawns `scripts/generate_model.py --dry-run` for previews; spawns without `--dry-run --register` to commit. Caches generated previews keyed by `sha256(catalog_id + hp_json + label_config + wf_config + template_version)` so toggling between two configs doesn't re-spawn.

**New backend routes (`src/server/routes/codegen.ts`):**
- `POST /api/training/generate-code` — body `{ catalogId, modelId, hyperparameters, walkForward, labelStrategy, labelParams, featurePipeline, featureCategories }` → returns `{ files: { 'main.py': '...', 'labels.py': '...', 'eval.py': '...', 'manifest.json': '...' }, templateUsed: 'sklearn', warnings: [] }`. Pure preview — nothing written.
- `POST /api/training/save-generated` — body `{ modelId, files, registerInRunners: true }` → writes files to disk, optionally patches `runners.json`. Returns `{ savedPaths: [...], runnerKey: 'generated_rf_v1+direction_classifier' }`.
- `GET /api/training/templates` — returns the list of available templates with their applicable families + required spec fields, so the picker can flag entries that have no template (BROWSE-ONLY).

### Catalog bridge change

`src/server/lib/catalogBridge.ts` gains a `pickTemplate(spec, template)` function that maps a family template to one of the Jinja2 templates in `src/templates/architectures/`. The `runnerSource` field on `TrainableModel` becomes `'wired' | 'generate' | 'browse-only'`:
- `wired` = entry exists in `runners.json` with a real script on disk
- `generate` = a template exists for this family + variant
- `browse-only` = no template (RL until W4, exotic specs without family match)

```typescript
function pickTemplate(spec: ParsedModelSpec, template: FamilyTemplate): TemplateId | null {
  switch (template.id) {
    case 'sklearn':
      // Special-case clustering/decomposition that don't fit the supervised template
      if (spec.id.startsWith('gaussian-mixture')) return 'gmm';
      if (spec.subcategory === 'clustering') return 'sklearn';  // sklearn template handles fit/predict, eval template uses _eval_clustering
      return 'sklearn';
    case 'xgboost': case 'lightgbm': case 'catboost': return 'tree';
    case 'pytorch':
      if (/autoencoder/i.test(spec.name)) {
        return /variational/i.test(spec.name) ? 'pytorch_vae' : 'pytorch_autoencoder';
      }
      if (/cnn|convolutional/i.test(spec.name)) return 'pytorch_cnn';
      return 'pytorch_mlp';
    case 'transformer': return 'transformer_seq';
    case 'hmm': return 'hmm';
    case 'reinforcement': return null;  // BROWSE-ONLY until phase W9
    default: return null;
  }
}
```

The bridge attaches `templateId` to the `TrainableModel` so the frontend can show which template will be used before generation.

### Orchestrator path

`src/server/training/orchestrator.ts` is unchanged for WIRED entries (script exists → spawn it). For `generate` entries, the spawn is preceded by a check: does `src/ml/<model_id>/main.py` already exist for this `(catalog_id, hp_hash)`? If yes, spawn it. If no, it should not have been startable from the UI in the first place — the [Save & train] button explicitly walks the generate→save→spawn sequence.

### Generated file lifecycle

- Each generated model gets its own dir at `src/ml/<model_id>/` with `main.py`, `labels.py`, `eval.py`, `manifest.json`
- `model_id` defaults to `<catalog_id_slug>_v<n>` where `n` increments per regeneration of the same `catalog_id`
- User can rename `model_id` before save (composer field)
- After save, the entry is a normal git-tracked file — user can edit it freely; changes preserved across re-generations of OTHER models
- `manifest.json` records the generation context so a future "regenerate from manifest" action can reproduce the same starting point
- A `templateVersion` field allows future template upgrades; `migrate_generated.py` script can re-render with `--preserve-edits` (3-way merge against manifest) when templates evolve

## 6. Workshop AI agents

Four specialist agents bound to stages, dispatched via the `Agent` tool in the existing `~/.claude/agents/` system:

| Agent | Stage | Inputs | Output | Backed by |
|---|---|---|---|---|
| `feature-curator` | Features | data preview JSON, current pipeline, redundant pairs | suggested feature additions/drops with rationale | new `~/.claude/agents/feature-curator.md` |
| `arch-designer` | Train | catalog ID, data preview, label distribution, current hyperparameters | 2-3 architecture variations as `ExperimentLedger.proposed` entries | new `~/.claude/agents/arch-designer.md` |
| `hpo-strategist` | Train | catalog spec hyperparameters, label class balance, n_train | tighter `defaultSearchSpace` recommendation + rationale | new `~/.claude/agents/hpo-strategist.md` |
| `eval-reviewer` | Evaluate | comparison matrix, fold breakdowns, lineage | leakage/overfit/regime audit report with severity flags | new `~/.claude/agents/eval-reviewer.md` |

Each agent is a thin specialist — read-only access to the project, dispatched on demand via a button in the relevant stage. Auto-research agents (overnight runners) are out of scope for this plan; revisit in a follow-up after the four manual agents prove their worth.

Frontend: each "Ask agent" button calls a new `POST /api/agents/dispatch` route with `{ agent_id, context_blob }`, which spawns the agent via the Claude Agent SDK (already a project dependency per `agent-sdk-dev` plugin); response is rendered in a side-panel `<AgentReport>`.

## 7. Backtesting + walk-forward integration

Backtesting and walk-forward already exist in the project; the workshop redesign just exposes them more deliberately.

**Walk-forward** is wired through the runner CLI (`--walk-forward-json '{"trainMonths":12,"testMonths":3,"stepMonths":3}'`). Generic runners gain a shared walk-forward harness in `src/ml/_generic/_common.py`:
```python
def walk_forward_iterate(df, train_months, test_months, step_months, purge_bars):
    # yields (train_idx, test_idx) per fold
```
Per-fold metrics emitted via `protocol.emit_metric()` populate the existing live dashboard charts and the new ExperimentLedger.

**Backtesting** uses the existing `/api/backtests` engine with the model's `oos_predictions.parquet` as the signal source. The generic runners write `oos_predictions.parquet` in the standard schema (`timestamp, symbol, prediction, confidence`) so the backtest engine works for any model with no per-model code.

**Block bootstrap CI** — new shared helper at `src/ml/shared/bootstrap.py` (lift from any existing copy in trading_model). Used both by `BlockBootstrapCI` panel and by the `bootstrap_pvalue_vs_baseline` promotion gate.

## 8. Implementation phases (build order, sized for one-week-each chunks)

| Phase | Name | Critical files | Cost |
|---|---|---|---|
| **W1** | Code generator infrastructure + base templates (`_base`, `_walk_forward`, `_eval_classification`) + Python generator script + TS wrapper + 2 routes (`POST /generate-code`, `POST /save-generated`) | `scripts/generate_model.py`, `src/server/lib/codeGenerator.ts`, `src/server/routes/codegen.ts`, `src/templates/architectures/_*.py.j2`, lift labels to `src/ml/shared/labels.py` | 5 days |
| **W2** | First two family templates (sklearn + tree) + catalog bridge `pickTemplate()` + `/api/model-catalog/trainable` route + ModelCatalogPicker switches data source + Monaco preview pane in TrainStage | `src/templates/architectures/{sklearn,tree,gmm}.py.j2`, `src/server/lib/catalogBridge.ts` (add `pickTemplate`/`templateId`/`runnerSource`), `src/server/routes/modelCatalog.ts` (add `/trainable`), `src/client/src/components/training/ModelCatalogPicker.tsx` (swap data source + GENERATE-* badges), `src/client/src/pages/ml-studio/stages/train/CodePreviewPane.tsx` (Monaco) | 5 days |
| **W3** | Deep-learning templates (`pytorch_mlp`, `pytorch_cnn`, `pytorch_autoencoder`, `pytorch_vae`, `transformer_seq`) + the `src/ml/blocks/` library that generated code imports | `src/templates/architectures/pytorch_*.py.j2`, `src/templates/architectures/transformer_seq.py.j2`, `src/ml/blocks/{__init__,encoder,decoder,attention,head}.py` | 5 days |
| **W4** | HMM template (`hmm.py.j2` + `_eval_clustering.py.j2`) + Train stage workshop UX — composer + walk-forward panel + experiment ledger + Monaco editor + Save/Regenerate flow | `src/templates/architectures/{hmm,_eval_clustering}.py.j2`, `pages/ml-studio/stages/TrainStage.tsx` rewrite, `pages/ml-studio/stages/train/{ArchitectureComposer,WalkForwardPanel,ExperimentLedger,GeneratedFileSaver}.tsx`, MLStudioContext extension | 5 days |
| **W5** | Composite templates (MoE / stacking / voting / multimodal) + composer recursion (sub-pickers from catalog) | `src/templates/architectures/composite_{moe,stacking,voting,multimodal}.py.j2`, composer recursion logic, `src/config/composite_catalog_extras.json` (4 composite "meta-entries" injected into the catalog) | 5 days |
| **W6** | Evaluate stage redesign — comparison matrix + fold overlay + regime breakdown + bootstrap CI + baselines | `pages/ml-studio/stages/EvaluateStage.tsx` rewrite + sub-components, `src/ml/shared/bootstrap.py`, `POST /api/eval/block-bootstrap` | 5 days |
| **W7** | Promote stage redesign — model registry SQLite + lineage + gates | `migrations/0002_model_registry.sql`, `src/server/routes/{registry,deployments}.ts`, `pages/ml-studio/stages/PromoteStage.tsx` rewrite + sub-components | 5 days |
| **W8** | Workshop AI agents — 4 specialist agent definitions + dispatch route + side-panel UI. The `arch-designer` agent gains a "Propose template edits" mode that emits a diff against the currently-previewed generated code | `~/.claude/agents/{feature-curator,arch-designer,hpo-strategist,eval-reviewer}.md`, `src/server/routes/agents.ts`, shared `<AgentReport>` component, `<GeneratedCodeDiffViewer>` | 5 days |
| **W9** | Live deploy — MLBridge ZMQ wiring (behind `ENABLE_LIVE_DEPLOY=1`) + RL templates (`rl_dqn.py.j2`, `rl_ppo.py.j2`) so RL leaves BROWSE-ONLY | `src/server/deployments/mlbridge_client.ts`, deployment lifecycle in `src/server/routes/deployments.ts`, prediction_log writes, `src/templates/architectures/rl_{dqn,ppo,a2c}.py.j2` + gym env wrapper | 5 days |

**Total: ~9 weeks.** **Phases W1+W2 are the minimum viable workshop** — once they ship, every sklearn + tree catalog entry can be selected → previewed as generated Python → saved to disk → trained → backtested. W3+W4 unlocks the deep-learning long tail and the hmm/clustering templates. W6+W7 are the visible workshop UX polish. W8 brings agents that can also propose template-aware code edits. W9 closes RL coverage and the live deploy path.

## 9. Critical files

**To create (new):**
- `scripts/generate_model.py` — Python entry point, Jinja2 rendering, optional `runners.json` patching
- `src/templates/architectures/_base.py.j2`, `_walk_forward.py.j2`, `_eval_classification.py.j2`, `_eval_regression.py.j2`, `_eval_clustering.py.j2`
- `src/templates/architectures/{sklearn,tree,gmm,hmm}.py.j2`
- `src/templates/architectures/{pytorch_mlp,pytorch_cnn,pytorch_autoencoder,pytorch_vae,transformer_seq}.py.j2`
- `src/templates/architectures/composite_{moe,stacking,voting,multimodal}.py.j2`
- `src/templates/architectures/rl_{dqn,ppo,a2c}.py.j2` (W9)
- `src/ml/blocks/{__init__,encoder,decoder,attention,gating,fusion,head}.py` — block library that generated code imports
- `src/ml/shared/{labels,bootstrap}.py` (lift from existing locations)
- `src/config/composite_catalog_extras.json` — 4 composite "meta-entries" injected into the catalog so MoE/stacking/voting/multimodal show up as pickable
- `migrations/0002_model_registry.sql`
- `src/server/lib/codeGenerator.ts` — TS wrapper that spawns `scripts/generate_model.py`, caches previews
- `src/server/routes/{codegen,registry,deployments,agents}.ts`
- `src/server/deployments/mlbridge_client.ts`
- `src/client/src/pages/ml-studio/stages/train/{ArchitectureComposer,WalkForwardPanel,ExperimentLedger,CodePreviewPane,GeneratedFileSaver}.tsx`
- `src/client/src/pages/ml-studio/stages/evaluate/{ComparisonMatrix,WalkForwardFoldOverlay,RegimeBreakdown,CalibrationPanel,BlockBootstrapCI,BaselineComparison}.tsx`
- `src/client/src/pages/ml-studio/stages/promote/{RegistryTable,LineageCard,PromotionGatePanel,DeploymentPanel,DeploymentLiveMetrics}.tsx`
- `src/client/src/components/agents/{AgentReport,GeneratedCodeDiffViewer}.tsx`
- `~/.claude/agents/{feature-curator,arch-designer,hpo-strategist,eval-reviewer}.md`
- `scripts/migrate_generated.py` — re-renders generated files when template versions bump, with 3-way merge against the manifest to preserve user edits

**To rewrite:**
- `src/client/src/pages/ml-studio/stages/{TrainStage,EvaluateStage,PromoteStage}.tsx`
- `src/client/src/components/training/ModelCatalogPicker.tsx` (swap data source + add WIRED/GENERATE-*/BROWSE-ONLY badges)
- `src/server/lib/catalogBridge.ts` (add `pickTemplate`, `templateId`, `runnerSource` field; replace `pickGenericRunner` concept)
- `src/server/routes/modelCatalog.ts` (add `/trainable` endpoint that includes `templateId` in each entry)

**To extend (additive):**
- `src/client/src/pages/ml-studio/MLStudioContext.tsx` — add `experiments: ExperimentRecord[]`, `compositionConfig`, `generatedPreview: { files, templateId, hash } | null`, plus actions
- `src/shared/schema.ts` — add Drizzle types for `model_versions`, `deployments`, `promotion_gates`
- `src/config/runners.json` — auto-patched by `--register` flag of the generator (entries get `generated_from: { catalogId, templateId, templateVersion, generatedAt, sourceHash }` block)
- `pyproject.toml` — add `jinja2>=3.1` if not present

**To preserve untouched:**
- `src/server/training/registry.ts` (composite-key composition logic — stays)
- `src/config/{algorithms,tasks,models}.json` (stay; `runners.json` gets auto-extended only)
- `src/ml/xgb_classifier/` and all other wired model packages (stay; the `xgb_classifier/main.py` is also a useful **template seed** — its structure informs `tree.py.j2`)
- `src/server/training/orchestrator.ts` (no changes — generated entries become normal `runners.json` entries with real script paths once saved)
- The legacy `<Training />` page (kept as the inline live training surface)

## 10. Verification

After each phase:

1. **W1 (generator infra):**
   - `python scripts/generate_model.py --catalog-id random-forest --model-id rf_smoke --hyperparameters-json '{"n_estimators":100}' --label-strategy next_close_direction --label-params-json '{}' --feature-pipeline default-35 --feature-categories-json '["price_action","volatility"]' --template-dir src/templates/architectures --output-dir /tmp/rf_smoke --dry-run` → emits valid Python to stdout
   - `pyflakes` / `python -m py_compile` on the generated output → no syntax errors
   - `POST /api/training/generate-code` with same payload → returns same files as JSON

2. **W2 (minimum viable workshop):**
   - `npx tsc --noEmit` clean, `npm run build` clean
   - Open ML Studio Train stage; confirm picker shows Random Forest / Logistic Regression / SVM / KNN / etc. with `GENERATE-sklearn` badge
   - Pick Random Forest → composer shows hyperparam form → click `Generate code` → Monaco renders generated Python (~80 LOC), syntax-highlighted
   - Edit one hyperparameter inline in Monaco → click `Save & train` → file lands at `src/ml/random_forest_v1/main.py`, `runners.json` gets new entry, training spawns, checkpoint + diagnostics + oos_predictions land in `data/models/random_forest_v1/`
   - Pick LightGBM → `GENERATE-tree` flow → same end state
   - Re-pick Random Forest with same hyperparameters → preview cache hits, no regeneration spawn
   - Trigger Backtest from Stage 5 → completes against the newly-saved generated model

3. **W3 (deep learning templates):**
   - Pick Autoencoder → `GENERATE-pytorch` → preview shows pytorch_autoencoder template output → save → train → loss curves stream
   - Pick generic Transformer → `GENERATE-pytorch` (transformer_seq variant) → same flow, attention weights written
   - Generated files import from `src/ml/blocks/` (Encoder, etc.) — not duplicating tensor math inline

4. **W4 (HMM + Train workshop UX):**
   - Pick GMM → `GENERATE-sklearn` (gmm variant) → fits, writes regime tags via `_eval_clustering`
   - Pick HMM → `GENERATE-hmm` → fits, writes transition matrix
   - Train two experiments (Random Forest + LightGBM) → both appear in ExperimentLedger
   - Click a ledger row → composer pre-fills with that config; click `Regenerate` → new file at `random_forest_v2/`, original `v1` untouched
   - Run a 5-fold WF → per-fold metrics stream live, ledger row updates

5. **W5 (composites):**
   - Pick MoE composite → composer asks for `n_experts=2` + 2 sub-pickers → pick Random Forest + Transformer → preview shows assembled `composite_moe.py` → save → trains a real MoE routing inputs
   - Pick Stacking → 3 base sub-pickers + logistic meta → trains end-to-end

5. **W6 (Evaluate):**
   - Multi-select 3 experiments from ledger → ComparisonMatrix renders Sharpe / PF / ECE / DD per experiment
   - WalkForwardFoldOverlay shows 3 equity curves with CI95 bands
   - RegimeBreakdown shows per-regime Sharpe per experiment
   - Click `agent: eval-reviewer` → agent report renders with leakage/overfit findings

6. **W7 (Promote):**
   - Stage 5 "promote to candidate" button on best experiment → row appears in RegistryTable as `candidate`
   - Click "candidate → shadow" → PromotionGatePanel evaluates gates, shows pass/fail
   - All gates pass → status updates to `shadow`, lineage card preserved
   - Rollback: switch active deployment back to v_001, confirm `deployments` table updated

7. **W8 (agents):**
   - Each of 4 agent buttons returns a structured report rendered in side panel
   - Reports include actual numeric findings (not generic prose), citations to file paths

8. **W9 (live deploy):**
   - Set `ENABLE_LIVE_DEPLOY=1`, MLBridge running → "Deploy live" succeeds
   - Predictions emitted to QuestDB `prediction_log` at the cadence of incoming bars
   - Pause / stop / rollback all work without losing the deployment record

## 11. Out of scope

- Visual node-graph canvas (React Flow) — explicitly rejected by user; structured forms only
- Drag-and-drop architecture composition — same
- Generic per-family runners — explicitly rejected by user; per-model code generation is the chosen path
- Conversational LLM chat interface to the workshop — defer to a v2
- Autonomous overnight research agents — defer until manual agents prove their worth
- Reinforcement learning catalog entries (DQN, PPO, A2C, etc.) — `BROWSE-ONLY` until W9 ships RL templates + gym env wrappers
- Decommissioning the legacy `<Training />` and `<Backtest />` pages — kept as inline mounts; route-level deprecation later
- LLM-driven code generation (e.g., Claude generates per-model code from spec) — Jinja2 templates only; deterministic, auditable, testable. Agent-proposed template *edits* are W8 scope but the templates themselves are hand-authored.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Generated `src/ml/<model_id>/` directories proliferate (one per HP combo) and clutter the repo | `.gitignore` `src/ml/generated/` and route generated dirs there by default; user opts in to git-tracking via a "Promote to repo" button that moves the dir to `src/ml/<model_id>/`. Manifest preserved either way. |
| Template version drift breaks reproducibility — old generated files reference old template behaviors | Every generated `manifest.json` records `templateVersion`; `scripts/migrate_generated.py` re-renders with 3-way merge against manifest, preserving user edits. CI test: render every catalog entry against current templates, assert all generated files compile. |
| Hyperparameter name mismatches between catalog spec and target library API (e.g., spec says `learning_rate`, library wants `lr`) | Per-template alias map in the template itself (Jinja `{% set hp_aliases = {'learning_rate': 'lr'} %}`); generator validates extracted spec params against the template's expected param list and warns on mismatch in the preview pane |
| User edits a generated file, then re-generates and loses edits | Save flow detects existing file at target path, offers "merge edits" (3-way against manifest base) or "overwrite with backup" (`.bak.<ts>` sibling) |
| Catalog spec class_name / module_path not directly extractable from markdown | Parser extends to read a code-fence block tagged `python-import` from the spec template (e.g., `from sklearn.ensemble import RandomForestClassifier`); falls back to a slug→class mapping table in `src/server/lib/modelImport/classMap.ts` for specs that don't include it. CI assertion: every spec with template `sklearn`/`tree`/`pytorch` resolves a class. |
| Composite templates explode in complexity (MoE assembly, gating gradient, expert weight init) | One file per composition kind: `composite_moe.py.j2`, `composite_stacking.py.j2`, `composite_voting.py.j2`, `composite_multimodal.py.j2`. Each capped at ~250 LOC of template; deeper logic lives in `src/ml/blocks/`. |
| Promotion gates produce false-negatives that block legitimate models | `enforced` flag in `promotion_gates` allows warn-only mode; manual override with required reason text |
| Live deploy ZMQ wiring fragile (MLBridge availability, network) | Behind `ENABLE_LIVE_DEPLOY=1` flag; shadow mode (predictions to QuestDB only, no orders) is the default for first 14 days |
| ExperimentLedger localStorage quota exceeded with many WF folds | Cap at 50 most-recent experiments; older entries persist server-side via the registry |
| Generator spawn latency (Jinja import + render) makes preview feel sluggish | Long-lived Python helper kept warm via `child_process.spawn` reuse (similar to existing `tensionflow` runner pattern); cold-start budget < 500ms |

---

**Plan author:** synthesized 2026-05-09 from the existing ML Studio P1–P4 work, the catalog system at `src/server/lib/{modelImport,catalogBridge}.ts`, the wired-model registry at `src/config/{algorithms,tasks,runners,models}.json`, and Tyler's clarified intent that the workshop is a build-your-own-model assembly line where every catalog entry is selectable and trainable.

**Revision 2026-05-09 (later same day):** Tyler chose **per-model code generation** over generic per-family runners. Section 5 rewritten to describe the Jinja2-template + Python-generator + Monaco-preview architecture; generated files become real, version-controlled `src/ml/<model_id>/` packages that auto-register in `runners.json`. Sections 8 (phases), 9 (critical files), 10 (verification), 11 (out-of-scope), 12 (risks) updated accordingly. The catalog bridge and ModelCatalogPicker reuse remain unchanged — only the trainability backend flips from reflection to template rendering.
