# ML Studio — End-to-End Real-Data Architecture

Status: PROPOSED · 2026-05-08 · supersedes ad-hoc tab structure in `src/client/src/pages/MLStudio.tsx`

## 1. Context

The current ML Studio (`/ml-studio`) is a six-tab shell (Dashboard / Training / Backtest / Forecast / Trades / Curriculum) sitting on top of a 300-pixel "Neural Price Context" chart that **duplicates** the Market Data chart at `/`. The shell wraps real, working sibling pages but does not stitch them into a single end-to-end pipeline:

- `src/config/models.json` is empty (`"models": {}`) — the registry-driven training UI has zero registered models. The Training tab dropdown is therefore inert until somebody hand-edits the JSON.
- There is no UI affordance to preview data, configure labels, or pick a feature pipeline before training. Training takes only `(modelType, symbol, timeframe, hyperparameters)`.
- There is no model promotion flow. `DashboardTab` lists checkpoints but no "set active" / "deploy" / "paper-trade this checkpoint" action exists.
- There is no live-deploy path. The MotiveWave ILP plugin streams data **into** QuestDB but no checkpoint streams predictions **back out** to a broker or paper-trade simulator.
- The Trades tab inside ML Studio re-renders trade-history info that already exists in `UnifiedDashboardContext`, and the Forecast tab is a single-component visualisation, not a forecasting pipeline.

We will rebuild ML Studio as a strictly linear, real-data, end-to-end command surface. Charting responsibilities are owned by the Market Data tab (`/`) and reached via `dashboard.navigateToChart()` — never duplicated inside ML Studio.

## 2. Scope

In scope:
- Restructure `/ml-studio` into a Stage-driven workflow: **Data → Features → Labels → Train → Evaluate → Promote → Deploy**.
- Delete the Neural Price Context chart and the ML-Studio-internal Trades tab.
- Wire `src/config/models.json` to a working set of real models so the registry is non-empty out of the box.
- Add a deploy contract (paper + live) bridging completed checkpoints to either an internal paper-trade engine or the MotiveWave plugin via QuestDB `prediction_log`.
- Reuse `UnifiedDashboardContext` + `dashboard.navigateToChart()` for any chart need.

Out of scope (intentionally — separate plans):
- Curriculum learning (existing `Curriculum.tsx` page kept as standalone `/curriculum` route, removed from ML Studio shell).
- ForecastVisualizer (kept as standalone `/forecast` route).
- Cross-model comparison page (Tier-1 follow-up — depends on `metricRegistry.json` rollout).

## 3. Inventory of current state (ground truth)

### 3.1 Routes (`src/client/src/App.tsx`)

| Path | Page file | Purpose |
| --- | --- | --- |
| `/` | `pages/MarketData.tsx` | Canonical chart + indicators + replay + regime overlays + trade markers (the chart we keep) |
| `/ml-studio` | `pages/MLStudio.tsx` | Six-tab shell to be replaced by Stage workflow |
| `/ml-hub` | redirect → `/ml-studio` | Legacy redirect, kept |
| `/model-catalog` | `pages/ModelCatalog.tsx` | Browse pre-built models |
| `/portfolio`, `/watchlist`, `/news`, `/databases`, `/terminals`, `/hardware`, `/settings`, `/fourier`, `/architecture` | various | Unaffected |

There are NO top-level `/training`, `/backtest`, `/forecast`, `/curriculum`, `/chat` routes — those are tab bodies inside `MLStudio.tsx`.

### 3.2 ML Studio shell (`src/client/src/pages/MLStudio.tsx`)

| Region | Lines | Verdict |
| --- | --- | --- |
| Header (title, symbol selector, training badge) | 76–102 | Keep, simplify (drop "Universal Trading Agent" subtitle) |
| **"Neural Price Context" — `<IndicatorChartLayout>`** | **104–126** | **DELETE — duplicates the chart at `/`** |
| Tab list + "Institutional Chart" button | 128–159 | Replace with Stage stepper |
| `<DashboardTab>` (checkpoint list + aggregate stats) | 163–169 | Keep, fold into Promote stage as primary surface |
| `<Training />` (full training page) | 171–173 | Keep, fold into Train stage |
| `<Backtest />` (full backtest page) | 175–177 | Keep, fold into Evaluate stage |
| `<ForecastVisualizer />` | 179–181 | **MOVE OUT** to `/forecast` standalone route |
| `<TradesTab>` (re-implements trade history) | 183–185 | **DELETE** — duplicates Backtest TradesTab + Portfolio page |
| `<Curriculum />` | 187–189 | **MOVE OUT** to `/curriculum` standalone route |

### 3.3 Server contract (training + backtest)

| Endpoint | Purpose | Status |
| --- | --- | --- |
| `GET /api/training/config` | Reads `RegistryService.getClientConfig()` — model registry + feature pipelines | Healthy, but `models.json` is empty |
| `POST /api/training/start` | Spawns Python via `PythonRunner` from registry `script` | Works only if registry has a model |
| `GET /api/events/training` | SSE channel — emits `metric`, `progress`, `log`, `done` | Healthy, used by `useTrainingLive` |
| `GET /api/training/models` | Lists checkpoints from `data/models/` | Healthy, drives `DashboardTab` |
| `GET /api/training/models/:id/diagnostics` | Returns `SelfDescribingDiagnostics` JSON | Healthy |
| `POST /api/backtest/run` | Runs backtest via `backtestOrchestrator` | Healthy, supports `useLastTrained` flag |
| `POST /api/backtest/walk-forward` | Walk-forward analysis | Healthy |
| `POST /api/backtest/monte-carlo` | MC analysis on a completed run | Healthy |
| `POST /api/backtest/benchmark` | Buy-and-hold + SMA crossover comparison | Healthy |

Missing endpoints for end-to-end:
- `GET /api/training/data-preview` — bar count / span / coverage / null counts for a (symbol, timeframe, dateRange).
- `POST /api/training/labels/preview` — given label strategy + params, return label distribution + first 100 rows.
- `POST /api/training/features/preview` — given feature pipeline + params, return feature stats + correlation matrix.
- `POST /api/models/:id/promote` — set active checkpoint for (symbol, timeframe).
- `POST /api/models/:id/deploy` — start emitting predictions to `prediction_log` QuestDB table (paper) or to broker (live).
- `POST /api/models/:id/undeploy` — stop emitting.
- `GET /api/deployments` — list active deployments.

### 3.4 Self-describing diagnostics protocol (KEEP UNCHANGED)

`src/ml/shared/protocol.py` emits `SelfDescribingDiagnostics` (Pydantic schema in `src/ml/shared/diagnostics_schema.py`). Each metric carries `renderer` + `mission` + `group` so the UI auto-binds without per-model code. `Training.tsx` already routes via `MetricGrid` + `GroupTabs` + `LiveTrainingView`. Architecture preserves this primitive end-to-end.

### 3.5 Trade Lab / Market Data chart contract (REUSE, DO NOT DUPLICATE)

| Surface | Path | Reused via |
| --- | --- | --- |
| Main chart | `src/client/src/components/IndicatorChartLayout.tsx` | Only on `/` route |
| Trade markers | `UnifiedDashboardContext.addTradeMarkers(markers, source: 'backtest' \| 'live' \| 'paper')` | Already used by `Backtest` |
| Highlight range | `dashboard.setHighlightRange({start, end, label, color})` | Already used by `TradesTab` |
| Navigate-to-chart | `dashboard.navigateToChart()` | Already used by Backtest "Show on Chart" |
| Training fold boundaries | `useChartOverlayData(...)` returns `trainTestSplitTime` | Already wired in MarketData |

**Rule:** ML Studio NEVER renders a price chart. Any time a stage needs to show "what does this look like on the chart", it pushes overlays via `UnifiedDashboardContext` and emits `dashboard.navigateToChart()`.

## 4. Removal list

1. **`src/client/src/pages/MLStudio.tsx` lines 104–126** — the `<div>...Neural Price Context...</div>` containing `<IndicatorChartLayout>`. Also drop the `useChartOHLCV(selectedSymbol, 60)` call at line 64 — only used by this chart.
2. **`src/client/src/pages/ml-studio/TradesTab.tsx`** — entire file. Trade history lives in `Backtest` results + `Portfolio` page. Cross-cutting context is `UnifiedDashboardContext`.
3. **`src/client/src/pages/MLStudio.tsx` Forecast tab body (line 179–181)** — promote `<ForecastVisualizer />` to a top-level `/forecast` route.
4. **`src/client/src/pages/MLStudio.tsx` Curriculum tab body (line 187–189)** — promote `<Curriculum />` to a top-level `/curriculum` route.
5. **`useMLTrades`, `useTradeMetrics` calls inside `MLStudio.tsx`** — only fed the deleted Trades tab.

## 5. New ML Studio architecture

### 5.1 Route + page

`/ml-studio` → `pages/MLStudio.tsx` becomes a **Stage-driven shell**. No tabs, no inner chart.

```
┌────────────────────────────────────────────────────────────────────┐
│  ML Studio                                       [MNQ ▾] [↗ Chart] │
│  Universal Trading Agent — Pipeline                                │
├────────────────────────────────────────────────────────────────────┤
│  ⓵ Data   ⓶ Features   ⓷ Labels   ⓸ Train   ⓹ Evaluate   ⓺ Promote │  ← StageStepper
│  ●        ●            ●          ●         ○            ○        │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│              [ Active Stage Body — single component ]              │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  Pipeline Status  ·  Active Deployment  ·  Last Run  ·  Checkpoints│  ← StatusFooter
└────────────────────────────────────────────────────────────────────┘
```

The stepper enforces a linear workflow but does not block — users can jump to any stage at any time (each stage validates its own prerequisites).

### 5.2 Stages

| # | Stage | Component path (new) | Server endpoints | Reuses |
| --- | --- | --- | --- | --- |
| 1 | **Data** | `pages/ml-studio/stages/DataStage.tsx` | `GET /api/training/data-preview` (new), `GET /api/instruments` | `useChartOHLCV` for span/count only — no chart render |
| 2 | **Features** | `pages/ml-studio/stages/FeaturesStage.tsx` | `GET /api/training/config`, `POST /api/training/features/preview` (new) | `RegistryService.listFeaturePipelines()` |
| 3 | **Labels** | `pages/ml-studio/stages/LabelsStage.tsx` | `POST /api/training/labels/preview` (new) | `src/ml/shared/labeling/{simple,structural,bull_bear}.py` |
| 4 | **Train** | `pages/ml-studio/stages/TrainStage.tsx` | `POST /api/training/start`, `GET /api/events/training`, `POST /api/training/stop/:id` | Existing `Training.tsx` body — **inline** as `<TrainStageBody />`, no router change |
| 5 | **Evaluate** | `pages/ml-studio/stages/EvaluateStage.tsx` | `POST /api/backtest/run`, `walk-forward`, `monte-carlo`, `benchmark` | Existing `Backtest` body — inline as `<EvaluateStageBody />` |
| 6 | **Promote** | `pages/ml-studio/stages/PromoteStage.tsx` | `GET /api/training/models`, `POST /api/models/:id/promote`, `POST /api/models/:id/deploy`, `POST /api/models/:id/undeploy`, `GET /api/deployments` | `DashboardTab.tsx` content folded in |

### 5.3 Stage prerequisites + state contract

Each stage reads/writes a shared `MLStudioContext` (new, scoped to `/ml-studio` only). State shape:

```ts
interface MLStudioPipeline {
  // Stage 1
  symbol: string;
  timeframe: '1m'|'5m'|'15m'|'30m'|'1h'|'4h'|'1d'|'1w';
  dateRange: { start: string; end: string } | null;
  dataPreview: { totalBars: number; firstTs: string; lastTs: string; nullCount: number } | null;

  // Stage 2
  featurePipelineId: string | null;          // from RegistryService.listFeaturePipelines()
  featureCategories: string[];
  featurePreview: { featureCount: number; corrSummary: { meanAbsCorr: number; maxAbsCorr: number } } | null;

  // Stage 3
  labelStrategy: 'triple_barrier' | 'next_close_direction' | 'range_bucket' | 'structural';
  labelParams: Record<string, number | string | boolean>;
  labelPreview: { distribution: Record<string, number>; classBalanceRatio: number } | null;

  // Stage 4
  modelType: string;                         // from RegistryService.listModels()
  hyperparameters: Record<string, number|string|boolean>;
  walkForward: { trainMonths: number; testMonths: number; stepMonths?: number } | null;
  activeTrainingId: string | null;           // session id when running
  completedModelId: string | null;           // for handoff to Stage 5

  // Stage 5
  backtestConfig: BacktestConfig;            // existing type
  lastBacktestRunId: number | null;

  // Stage 6
  promotedCheckpointId: number | null;
  activeDeployment: Deployment | null;       // see §5.5
}
```

Provider sits at the route boundary in `pages/MLStudio.tsx` (NOT global App.tsx — keeps MLStudio context isolated from MarketData). Persisted to `localStorage` keyed by `(symbol, timeframe)` so the user can leave and return mid-pipeline.

### 5.4 Stage gating

| From | To | Gate |
| --- | --- | --- |
| 1 → 2 | `dataPreview != null` | else show "Run preview first" hint |
| 2 → 3 | `featurePipelineId != null` | else disable |
| 3 → 4 | `labelPreview != null` | else disable |
| 4 → 5 | `completedModelId != null` OR existing checkpoint selected | else disable |
| 5 → 6 | `lastBacktestRunId != null` | else disable |

Disabled stages render a grey step but stay clickable for skip-ahead users (validation banners show inside the stage body when prereqs missing).

### 5.5 Promote + Deploy contract (NEW, this is the missing link)

```ts
type DeploymentMode = 'paper' | 'live';

interface Deployment {
  id: number;
  checkpointId: number;
  modelType: string;
  symbol: string;
  timeframe: string;
  mode: DeploymentMode;
  startedAt: string;            // ISO
  status: 'running' | 'paused' | 'failed';
  predictionsEmitted: number;   // counter from prediction_log
  paperPnl: number | null;      // null for live (broker reports)
}
```

**Paper deploy** path:
- Server spawns (or hot-loads) the Python inference module via `PythonRunner.startInference(checkpointPath, symbol, timeframe)`.
- Inference reads QuestDB `ohlcv_<tf>` mat view, computes features, scores latest bar each TF interval, emits row to `prediction_log` (existing QuestDB table per CLAUDE.md §3.5).
- A simple paper-trade simulator on the Node side reads `prediction_log` LATEST ON, applies confidence threshold + fixed position size + cost model, writes to `backtest_trades` with `source='paper'`.
- Trades surface on `/` chart via the existing `dashboard.addTradeMarkers(..., source: 'paper')` channel — no new chart code.

**Live deploy** path:
- Same inference loop emits to `prediction_log`, but a separate emitter pushes ZMQ/HTTP signals to the MotiveWave plugin (`E:\source\repos\MotiveWave\MLBridge\`).
- Requires explicit `confirm-live` modal with broker-config sanity check (max position, daily loss limit, kill switch).

Schema additions (SQLite, `src/shared/schema.ts`):

```ts
export const deployments = sqliteTable('deployments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  checkpointId: integer('checkpoint_id').notNull(),
  modelType: text('model_type').notNull(),
  symbol: text('symbol').notNull(),
  timeframe: text('timeframe').notNull(),
  mode: text('mode').notNull(),           // 'paper' | 'live'
  status: text('status').notNull(),       // 'running' | 'paused' | 'failed'
  startedAt: text('started_at').notNull(),
  stoppedAt: text('stopped_at'),
  configJson: text('config_json'),
});
```

Migration: `src/server/training/migrations.ts` adds `0007_deployments.sql`.

### 5.6 SSE channels (no protocol change)

Reuse existing channels:
- `/api/events/training` — already emits live training metrics. Stage 4 subscribes via `useTrainingLive()`.
- `/api/events/pipeline` — stages 1–3 emit `dataPreview`, `featurePreview`, `labelPreview` events to give the user an in-flight progress feel without changing the schema.
- New: `/api/events/deployments` (added to `VALID_CHANNELS` in `src/server/routes/events.ts`) — emits `prediction`, `paperTrade`, `deploymentStatus` events for Stage 6 live status footer.

### 5.7 `models.json` initial population (the empty-config fix)

Populate `src/config/models.json` from `model-templates.json` so the registry is non-empty out of the box. Initial set (matches what's actually trainable in this repo):

| modelType | runner | script | head | source |
| --- | --- | --- | --- | --- |
| `tensionflow` | python | `src/ml/tensionflow/__main__.py` | rule-based score | in-repo |
| `primitives` | python | `E:\source\repos\primitives_discovery\src\ml\primitives_discovery\train.py` | regression | sibling repo |
| `transformer_range` | python | `E:\source\repos\trading_model\scripts\train_range_hpo.py` | classification (range_class) | sibling repo |
| `transformer_direction_daily` | python | `E:\source\repos\trading_model\scripts\train_daily_direction_hpo.py` | binary classification | sibling repo |
| `hmm` | python | `src/ml/generic/hmm/train.py` (template) | regime detection | template-driven |

Each entry must include `outputs`, `cliFlags`, `defaultHyperparameters`, `outputDir`, `featurePipeline`. The `fill_model_specs.py` script already exists at `scripts/fill_model_specs.py` — extend it to write these five entries from `model-templates.json` plus repo-specific overrides.

## 6. File-level changes

### 6.1 Frontend (TypeScript)

**Create:**
- `src/client/src/pages/MLStudio.tsx` — full rewrite (replace existing).
- `src/client/src/pages/ml-studio/MLStudioContext.tsx` — provider + reducer.
- `src/client/src/pages/ml-studio/StageStepper.tsx` — top stepper component.
- `src/client/src/pages/ml-studio/StatusFooter.tsx` — bottom status strip.
- `src/client/src/pages/ml-studio/stages/DataStage.tsx`
- `src/client/src/pages/ml-studio/stages/FeaturesStage.tsx`
- `src/client/src/pages/ml-studio/stages/LabelsStage.tsx`
- `src/client/src/pages/ml-studio/stages/TrainStage.tsx` — wraps existing `Training.tsx` body.
- `src/client/src/pages/ml-studio/stages/EvaluateStage.tsx` — wraps existing `Backtest` body.
- `src/client/src/pages/ml-studio/stages/PromoteStage.tsx` — checkpoint table + Deploy modal + active-deployments panel.
- `src/client/src/pages/ml-studio/stages/DeployModal.tsx` — paper/live mode toggle + confirm-live guard.
- `src/client/src/pages/ml-studio/hooks/useDataPreview.ts`
- `src/client/src/pages/ml-studio/hooks/useFeaturePreview.ts`
- `src/client/src/pages/ml-studio/hooks/useLabelPreview.ts`
- `src/client/src/pages/ml-studio/hooks/useDeployments.ts`
- `src/client/src/pages/Forecast.tsx` — promotes `ForecastVisualizer` to top-level route.
- `src/client/src/pages/Curriculum.tsx` — already exists; just route it.

**Modify:**
- `src/client/src/App.tsx` — add `/forecast` and `/curriculum` AppRoutes.
- `src/client/src/lib/api_service.ts` — add `mlApi.dataPreview`, `mlApi.featurePreview`, `mlApi.labelPreview`, `modelsApi.promote`, `modelsApi.deploy`, `modelsApi.undeploy`, `deploymentsApi.list`.
- `src/client/src/lib/types.ts` — add `QUERY_KEYS.deployments`, `QUERY_KEYS.dataPreview(symbol, tf, range)`, etc.

**Delete:**
- `src/client/src/pages/ml-studio/TradesTab.tsx` (and remove its imports).
- The DataPreview/Trades-tab–specific `useMLTrades` + `useTradeMetrics` calls in `MLStudio.tsx` (already covered by the rewrite).

### 6.2 Backend (TypeScript)

**Create:**
- `src/server/routes/ml/preview.ts` — endpoints for data/features/labels preview.
- `src/server/routes/deployments.ts` — list + create + delete deployments.
- `src/server/lib/deployments/deploymentOrchestrator.ts` — start/stop inference processes, supervise, emit SSE.
- `src/server/lib/deployments/paperTradeRunner.ts` — reads `prediction_log` LATEST ON, simulates fills, writes paper trades.
- `src/server/lib/deployments/liveBridge.ts` — pushes signals to MotiveWave MLBridge over ZMQ.

**Modify:**
- `src/server/routes/events.ts` — add `'deployments'` to `VALID_CHANNELS`.
- `src/server/routes/training.ts` — add `POST /api/training/labels/preview`, `POST /api/training/features/preview`, `GET /api/training/data-preview` (or factor into `routes/ml/preview.ts`).
- `src/server/routes/models.ts` — add `POST /api/models/:id/promote`, `POST /api/models/:id/deploy`, `POST /api/models/:id/undeploy`.
- `src/server/training/migrations.ts` — add deployments table migration.
- `src/shared/schema.ts` — add `deployments` table.
- `src/config/models.json` — populate with the five real entries from §5.7 via extended `scripts/fill_model_specs.py`.

### 6.3 Python (inference runner)

**Create:**
- `src/ml/shared/inference.py` — generic checkpoint loader → feature pipeline → score → write to `prediction_log` loop.
- `scripts/run_inference.py` — CLI entry: `--checkpoint <path> --symbol MNQ --timeframe 1m --mode paper`.

## 7. Phased delivery

| Phase | Scope | Verification |
| --- | --- | --- |
| **P1 — Strip + restructure** | Delete Neural Price Context + ml-studio TradesTab + Forecast/Curriculum tabs. New shell with empty stage bodies. Forecast/Curriculum become standalone routes. | `/ml-studio` renders Stage stepper + empty bodies; chart only at `/`; `/forecast` and `/curriculum` work. |
| **P2 — Wire existing functionality into stages** | Inline existing `<Training />` into TrainStage and existing `<Backtest />` into EvaluateStage. Fold `<DashboardTab>` into PromoteStage as the checkpoint table. | Train + Backtest still work end-to-end as today, just inside the stepper. |
| **P3 — Populate models.json** | Write 5 real entries via extended `fill_model_specs.py`. | Training tab dropdown shows real models; smoke-train one model successfully. |
| **P4 — Data + Features + Labels stages** | Real preview endpoints + UIs. | A user can pick MNQ 1m, preview span (2,340,445 bars per CLAUDE.md), pick a feature pipeline, see correlation summary, pick a label strategy, see class balance. |
| **P5 — Promote + Paper Deploy** | New `deployments` table, paper inference loop, paper-trade runner, paper trades land on `/` chart via `addTradeMarkers(..., source: 'paper')`. | Promote a checkpoint, click "Deploy (paper)", see prediction count tick + paper trade markers appear on `/`. |
| **P6 — Live Deploy** | MLBridge ZMQ wiring + confirm-live guard + kill switch. | Behind feature flag `ENABLE_LIVE_DEPLOY=1`. Functional end-to-end loop with sandbox broker. |

P1–P3 unblock Tyler immediately (cleaner studio, real models register, no chart duplication). P4–P6 add the missing end-to-end capability.

## 8. Verification plan

After each phase, run from `e:\source\repos\ml_dashboard`:

```bash
# Type check
npx tsc --noEmit

# Frontend build
npm run build:client

# Server build
npm run build:server

# Unit tests
npm test
```

End-to-end smoke (after P5):

1. `npm run dev` launches Electron + Express + NestJS + SSE.
2. Navigate to `/ml-studio`. Stage stepper shows 6 steps, no chart panel above.
3. Stage 1 (Data): pick `MNQ` 1m, full range. Preview reports `totalBars: 2_340_445`.
4. Stage 2 (Features): pick a registered pipeline. Preview reports `featureCount` and `meanAbsCorr`.
5. Stage 3 (Labels): pick `next_close_direction` (or any registered strategy). Distribution renders.
6. Stage 4 (Train): launch a tiny `transformer_direction_daily` run. Live SSE metrics tick; `MetricGrid` renders self-describing diagnostics.
7. Stage 5 (Evaluate): run backtest of the just-trained checkpoint with `useLastTrained: true`. Click "Show on Chart" — markers appear on `/` chart.
8. Stage 6 (Promote): set checkpoint as active. Click "Deploy (paper)". `predictionsEmitted` counter ticks via `/api/events/deployments`. Switch to `/` — paper trade markers appear.

Test files added:
- `tests/test_inference_loop.py` — covers `src/ml/shared/inference.py` happy path + missing-checkpoint failure.
- `src/server/lib/deployments/__tests__/paperTradeRunner.test.ts` — covers cost model + threshold gating.
- `src/client/src/pages/ml-studio/__tests__/StageStepper.test.tsx` — covers gating logic.

## 9. Critical files (must read before implementing)

- `src/client/src/pages/MLStudio.tsx` — current shell to replace.
- `src/client/src/pages/Training.tsx` — body to inline into TrainStage (preserve `useTrainingControl` + `useTrainingLive` contract).
- `src/client/src/pages/backtest/index.tsx` — body to inline into EvaluateStage (preserve `BacktestPanel` export).
- `src/client/src/pages/ml-studio/DashboardTab.tsx` — checkpoint card UI to fold into PromoteStage.
- `src/client/src/contexts/UnifiedDashboardContext.tsx` — read `addTradeMarkers`, `setHighlightRange`, `navigateToChart` contracts before adding deployment markers.
- `src/server/routes/training.ts` — pattern for new preview endpoints.
- `src/server/training/registry.ts` — model registry loader (do not break the schema).
- `src/server/training/runners/pythonRunner.ts` — pattern for inference runner.
- `src/ml/shared/protocol.py`, `src/ml/shared/diagnostics_schema.py` — keep emit contract unchanged across stages.
- `src/config/model-templates.json` — source for populating `models.json`.

## 10. Open decisions (resolve before P5)

These are deliberately punted to implementation time, not design time:

- **Inference cadence**: poll on bar-close vs. tick stream (paper mode). Default to bar-close for paper, tick stream behind a flag for live.
- **Single-tenant vs. multi-deployment**: P5 supports one active deployment per `(symbol, timeframe)`. Multi-deployment per symbol (e.g. range head + direction head running in parallel) deferred.
- **Cost model selection**: paper mode uses `src/config/cost_model.json`. Live mode reads broker config commission/slippage. No new schema needed.
