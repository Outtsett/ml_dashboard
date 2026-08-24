# ML Studio Workshop Redesign — Frontend Integration Plan

**Date:** 2026-05-09
**Scope:** React/Vite client-side phases W2 (FE), W4 (UX), W6, W7 (FE), W8 (UI)
**Companion to:** `docs/plans/2026-05-09-ml-studio-workshop-redesign.md`
**Authored by:** frontend-lead

This plan covers only the React side. Backend `/api/model-catalog/trainable`, `/api/training/generate-code`, `/api/training/save-generated`, `/api/eval/block-bootstrap`, `/api/model-versions/*`, `/api/deployments/*`, `/api/agents/dispatch`, `/api/events/deployments` SSE, and the `model_versions` / `deployments` / `promotion_gates` SQLite schema are dispatched separately to backend-lead.

---

## 1. Frontend deliverables matrix

| Phase | File (absolute) | Purpose | Reuses / extends |
|---|---|---|---|
| W2 | `src/client/src/hooks/useModelCatalog.ts` | Add `useTrainableCatalog()` hook + `TrainableModel` type | TanStack Query 5; KEYS pattern; mirrors `useCatalogList` |
| W2 | `src/client/src/components/training/ModelCatalogPicker.tsx` | Swap data source `/api/training/config + /api/model-catalog` → `/api/model-catalog/trainable`; replace 2-state Trainable/Browse-Only badge with 3-state WIRED / GENERATE-`<family>` / BROWSE-ONLY | Existing `ModelCard`, filters, ScrollArea; reuses `categoryColor()` |
| W2 | `src/client/src/pages/ml-studio/stages/train/CodePreviewPane.tsx` | Monaco editor for generated `main.py` / `labels.py` / `eval.py` / `manifest.json`; tab strip across files; dirty marker; Save / Regenerate buttons | New; lazy-loads `@monaco-editor/react`; reads `state.generatedPreview` |
| W2 | `src/client/src/pages/ml-studio/stages/TrainStage.tsx` | Rewrite: mount `<ModelCatalogPicker>` + `<ArchitectureComposer>` + `<WalkForwardPanel>` + `<CodePreviewPane>` + lazy `<Training/>` (live SSE only) + `<ExperimentLedger>` | Keeps `useTrainingControl()` / `useTrainingLive()` wiring; legacy `<Training>` page lazy-mounted with `embedded` prop |
| W4 | `src/client/src/pages/ml-studio/stages/train/ArchitectureComposer.tsx` | HP form for atomic models; recursive sub-pickers for composites; reads `state.compositionConfig` | New; relies on `useTrainableCatalog()`; reuses ModelCatalogPicker via new `filter` prop |
| W4 | `src/client/src/pages/ml-studio/stages/train/WalkForwardPanel.tsx` | Form (folds, fold_months, purge_bars, objective, n_trials, MedianPruner toggle); writes `state.walkForward` + `state.objectiveConfig` | New; lifts logic from legacy `<ConfigStrip>` |
| W4 | `src/client/src/pages/ml-studio/stages/train/ExperimentLedger.tsx` | Sortable Tanstack-Table of `state.experiments`; row click pre-fills composer; SSE bridge updates row status | New; live-updates via `useTrainingLive()` |
| W4 | `src/client/src/pages/ml-studio/stages/train/GeneratedFileSaver.tsx` | "Save & train" / "Save without training" / "Save & rename" controls | New |
| W4 | `src/client/src/pages/ml-studio/MLStudioContext.tsx` | Extend reducer (see §2) | Existing reducer/persistence; backwards-compat shim |
| W6 | `src/client/src/pages/ml-studio/stages/EvaluateStage.tsx` | Rewrite: replaces lazy `<Backtest/>` with multi-experiment surface | Backtest reachable via `/backtest`; orchestrator API `/api/backtests` is the same |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/ExperimentSelector.tsx` | Multi-select chip row from `state.experiments` (status=done) + ad-hoc registry checkpoints | Reads `state.experiments` + `useModelCheckpoints()` |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/BacktestRunner.tsx` | Per-experiment backtest dispatch (parallel mutations); writes `runIdByExperiment` | Reuses `backtestApi.run` |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/ComparisonMatrix.tsx` | Sortable `@tanstack/react-table` v8 — Sharpe / PF / WinRate / MaxDD / ECE / mean trade PnL / regime-conditional Sharpe | New dep `@tanstack/react-table@^8.21.0` |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/WalkForwardFoldOverlay.tsx` | Recharts `<LineChart>` overlaying per-fold equity curves + CI95 band | Recharts already vendored |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/RegimeBreakdown.tsx` | Grouped Recharts `<BarChart>` (regime on x-axis, experiments as series) | Joins backtest trades against `market_regimes` server-side |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/CalibrationPanel.tsx` | Reliability curves overlaid + per-experiment ECE callout | Recharts |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/BlockBootstrapCI.tsx` | In-browser bootstrap for ≤5k trades; server `POST /api/eval/block-bootstrap` for larger | Web Worker for in-browser path |
| W6 | `src/client/src/pages/ml-studio/stages/evaluate/BaselineComparison.tsx` | Buy-hold + naive momentum benchmarks | Reuses existing `BenchmarkTab` data API |
| W7 | `src/client/src/pages/ml-studio/stages/PromoteStage.tsx` | Rewrite: registry table + side-drawer lineage + gate panel + deployments block | Replaces `DashboardTab` import |
| W7 | `src/client/src/pages/ml-studio/stages/promote/RegistryTable.tsx` | Sortable Tanstack-Table; status badges; filters; row click opens drawer | TanStack Table; existing `Badge` |
| W7 | `src/client/src/pages/ml-studio/stages/promote/LineageCard.tsx` | Full provenance card per version | Reads `GET /api/model-versions/:id` |
| W7 | `src/client/src/pages/ml-studio/stages/promote/PromotionGatePanel.tsx` | Calls `/promote` with `dryRun: true`, renders gate-by-gate pass/fail; override-with-reason | New |
| W7 | `src/client/src/pages/ml-studio/stages/promote/DeploymentPanel.tsx` | Active-deployment list + start (paper/live) / pause / stop / rollback | Calls `/api/deployments/*` |
| W7 | `src/client/src/pages/ml-studio/stages/promote/DeploymentLiveMetrics.tsx` | EventSource subscription to `/api/events/deployments`; pred/min, paper PnL, drift PSI per deployment | New SSE hook `useDeploymentEvents()` modeled on `useTrainingLive()` |
| W8 | `src/client/src/components/agents/AgentReport.tsx` | Side-panel `<Sheet>` rendering structured agent response | shadcn `Sheet` already exists; render markdown via `react-markdown` (new dep) |
| W8 | `src/client/src/components/agents/GeneratedCodeDiffViewer.tsx` | Monaco `DiffEditor` showing arch-designer's proposed template edits vs current preview | Reuses already-loaded Monaco bundle from W2 |
| W8 | `src/client/src/hooks/useAgentDispatch.ts` | TanStack mutation wrapping `POST /api/agents/dispatch` | New |
| W8 | `src/client/src/pages/ml-studio/agents/AgentButton.tsx` | Stage-button dispatching the right agent given current pipeline context | New thin wrapper |

---

## 2. MLStudioContext extension diff

### 2.1 New state fields (additive)

```ts
export type ExperimentStatus = "proposed" | "queued" | "running" | "done" | "failed" | "cancelled";

export interface FoldMetric { fold: number; sharpe: number | null; profitFactor: number | null; ece: number | null; trainLoss: number | null; valLoss: number | null; trades: number | null; }

export interface ExperimentSummary { sharpe: number | null; profitFactor: number | null; winRate: number | null; maxDrawdown: number | null; ece: number | null; meanTradePnl: number | null; foldDispersion: number | null; isStarred: boolean; }

export interface ExperimentRecord {
  id: string;                            // ulid
  catalogId: string;
  modelId: string | null;                // generated model_id once saved
  runnerKey: string | null;
  hyperparameters: Record<string, number | string | boolean>;
  walkForward: WalkForwardConfig | null;
  objectiveConfig: ObjectiveConfig | null;
  labelStrategy: LabelStrategy;
  labelParams: Record<string, number | string | boolean>;
  featurePipelineId: string | null;
  featureCategories: string[];
  status: ExperimentStatus;
  foldMetrics: FoldMetric[];
  summary: ExperimentSummary | null;
  startedAt: string | null;
  completedAt: string | null;
  trainingSessionId: string | null;
  diagnosticsPath: string | null;
  errorMessage: string | null;
  source: "user" | "agent-proposed" | "ledger-fork" | "server";
}

export interface ObjectiveConfig {
  metric: "sharpe_after_costs" | "profit_factor" | "neg_log_loss" | "ece" | "win_rate";
  direction: "maximize" | "minimize";
  nTrials: number;
  pruner: "median" | "none";
}

export interface CompositionConfig {
  kind: "atomic" | "moe" | "stacking" | "voting" | "multimodal";
  params: Record<string, unknown>;
  subPicks: SubPick[];
}

export interface SubPick {
  slotId: string;                        // "expert_0", "modality_price.encoder"
  catalogId: string;
  modelId: string | null;
  hyperparameters: Record<string, number | string | boolean>;
  generatedHash: string | null;
}

export interface GeneratedFile { path: string; content: string; language: "python" | "json"; }

export interface GeneratedPreview {
  files: GeneratedFile[];
  templateId: string;
  templateVersion: string;
  hash: string;
  warnings: string[];
  generatedAt: string;
  dirty: boolean;
}

// extension to MLStudioPipeline
export interface MLStudioPipeline {
  // ... existing fields ...
  experiments: ExperimentRecord[];
  experimentsCursor: string | null;
  compositionConfig: CompositionConfig | null;
  generatedPreview: GeneratedPreview | null;
  selectedExperimentId: string | null;
  objectiveConfig: ObjectiveConfig | null;

  evalSelection: string[];
  runIdByExperiment: Record<string, number>;
  evalCollapsed: { matrix: boolean; folds: boolean; regime: boolean; calibration: boolean; bootstrap: boolean; baseline: boolean };

  registryFilters: { status: string[]; catalogId: string | null; symbol: string | null; timeframe: string | null };
  selectedVersionId: number | null;
  drawerMode: "lineage" | "promote" | null;

  agentPanel: { stage: StageId | null; agentId: string | null; open: boolean };
}
```

### 2.2 New action types

```ts
export type MLStudioAction =
  | /* existing */
  | { type: "addExperiment"; record: ExperimentRecord }
  | { type: "updateExperiment"; id: string; patch: Partial<ExperimentRecord> }
  | { type: "removeExperiment"; id: string }
  | { type: "starExperiment"; id: string; starred: boolean }
  | { type: "setSelectedExperiment"; id: string | null }
  | { type: "hydrateExperiments"; records: ExperimentRecord[] }
  | { type: "setComposition"; config: CompositionConfig | null }
  | { type: "setSubPick"; slotId: string; catalogId: string; hyperparameters: Record<string, number | string | boolean> }
  | { type: "setGeneratedPreview"; preview: GeneratedPreview | null }
  | { type: "patchGeneratedFile"; path: string; content: string }
  | { type: "setEvalSelection"; ids: string[] }
  | { type: "setBacktestRunId"; experimentId: string; runId: number }
  | { type: "toggleEvalSection"; section: keyof MLStudioPipeline["evalCollapsed"]; collapsed: boolean }
  | { type: "setRegistryFilters"; filters: Partial<MLStudioPipeline["registryFilters"]> }
  | { type: "setSelectedVersion"; versionId: number | null; mode?: "lineage" | "promote" }
  | { type: "openAgentPanel"; stage: StageId; agentId: string }
  | { type: "closeAgentPanel" }
  | { type: "setObjectiveConfig"; config: ObjectiveConfig | null };
```

### 2.3 New reducer cases (key behaviors)

- `addExperiment`: prepend; cap to 50 most-recent (pop tail).
- `updateExperiment`: shallow-merge patch; auto-star if `summary.sharpe` is new max for `(catalogId, symbol, timeframe)` tuple.
- `hydrateExperiments`: merge server records by `id`, **prefer local copy if `local.status === "running"`** (race: 30s server hydrate could clobber live `foldMetrics`).
- `setComposition`: clears `generatedPreview` (composition change invalidates preview hash).
- `setSubPick`: updates `compositionConfig.subPicks[slotId]`; clears parent's `generatedPreview`.
- `patchGeneratedFile`: replaces matching file content + sets `dirty: true`; leaves `hash` unchanged.
- `setBacktestRunId`: writes per-experiment run_id into `runIdByExperiment`.
- `openAgentPanel` / `closeAgentPanel`: drives side-panel `Sheet`.
- `reset`: extended to clear all new fields except `experiments` (preserve user history) and `registryFilters` (preserve prefs).

### 2.4 New gates

```ts
case "evaluate":
  return p.experiments.some(e => e.status === "done") || p.completedModelId || p.promotedCheckpointId
    ? { ready: true, reason: null }
    : { ready: false, reason: "Train at least one experiment to completion first" };

case "promote":
  return p.lastBacktestRunId || Object.keys(p.runIdByExperiment).length > 0
    ? { ready: true, reason: null }
    : { ready: false, reason: "Run a backtest in Stage 5 first" };
```

### 2.5 Backwards-compat plan

Bump storage key to `mlstudio:pipeline:v2:${symbol}:${tf}` AND write one-shot migrator:

```ts
function migrateV1ToV2(parsed: any): MLStudioPipeline {
  return {
    ...DEFAULT_STATE,
    ...parsed,
    experiments: Array.isArray(parsed.experiments) ? parsed.experiments : [],
    experimentsCursor: null,
    compositionConfig: parsed.compositionConfig ?? null,
    generatedPreview: null,                          // never restore preview
    selectedExperimentId: null,
    objectiveConfig: null,
    evalSelection: Array.isArray(parsed.evalSelection) ? parsed.evalSelection : [],
    runIdByExperiment: typeof parsed.runIdByExperiment === "object" ? parsed.runIdByExperiment : {},
    evalCollapsed: { matrix: false, folds: false, regime: true, calibration: true, bootstrap: true, baseline: true },
    registryFilters: { status: ["candidate","shadow","paper","live"], catalogId: null, symbol: parsed.symbol, timeframe: parsed.timeframe },
    selectedVersionId: null,
    drawerMode: null,
    agentPanel: { stage: null, agentId: null, open: false },
  };
}
```

Quota math: 50 experiments × ~6 KB = ~300 KB; safe under 5 MB localStorage.

---

## 3. Monaco integration plan

### 3.1 Bundle size impact
`@monaco-editor/react@^4.6.0` + `monaco-editor@^0.52.x` ships ~2.0 MB minified (~600 KB gzip).

**Strategy:**
1. **Lazy-loaded only inside Stage 4 + W8 diff viewer.** `CodePreviewPane` uses `React.lazy(() => import("./CodePreviewPaneInner"))`.
2. **Single Monaco instance** reused between editor (W2) and `DiffEditor` (W8).
3. **Disable workers we don't need.** Skip TS workers — saves ~400 KB.
4. **Self-host, not CDN** — Tyler runs locally via Electron.

### 3.2 Vite config changes
Append to `manualChunks`:
```ts
"vendor-monaco": ["@monaco-editor/react", "monaco-editor"],
"vendor-table": ["@tanstack/react-table"],
"vendor-markdown": ["react-markdown", "remark-gfm"],
```

Add to `optimizeDeps`:
```ts
optimizeDeps: { exclude: ["@monaco-editor/react", "monaco-editor"] }
```

### 3.3 Theme integration
Define `ml-studio-dark` Monaco theme at first mount with project tokens (violet keywords, emerald strings, amber numbers, primary selection).

### 3.4 Wiring edits back
```tsx
<Editor
  value={file.content}
  language={file.language === "json" ? "json" : "python"}
  theme="ml-studio-dark"
  onChange={(value) => debouncedDispatch({ type: "patchGeneratedFile", path: file.path, content: value ?? "" })}
  options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true }}
/>
```
Debounce 250ms.

### 3.5 Dirty-state detection
`generatedPreview.dirty` flips to `true` first time `patchGeneratedFile` fires after `setGeneratedPreview`. Save button states: clean = "Save & train", dirty = same with yellow dot. Regenerate when dirty triggers `<AlertDialog>`: "You have unsaved edits. Regenerating will discard them."

### 3.6 Multi-file tab strip
Files: `main.py`, `labels.py`, `eval.py`, `manifest.json`. Horizontal `<Tabs>` with file icons + per-file dirty dot. Per-file dirty tracked in component-local `Set<string>`.

---

## 4. Composer recursion design

### 4.1 Constrained subset — `filter` prop on ModelCatalogPicker

```ts
export interface ModelCatalogPickerProps {
  // ... existing
  filter?: {
    runnerSource?: ("wired" | "generate")[];
    families?: string[];
    excludeKinds?: ("composite")[];
    categories?: string[];
  };
}
```

| Composite kind | Allowed sub-picks |
|---|---|
| MoE expert | `families: ["sklearn", "tree", "pytorch"]`, `excludeKinds: ["composite"]` |
| Stacking member | `families: ["sklearn", "tree", "pytorch", "transformer"]`, `excludeKinds: ["composite"]` |
| Voting member | same as stacking |
| Multimodal encoder | `families: ["pytorch", "transformer"]`, `excludeKinds: ["composite"]` |

Disallowing nested composites avoids infinite recursion.

### 4.2 Generation order — single-render composites

Per parent plan §5, the composite template renders into a SINGLE generated dir that imports its experts via `from src.ml.blocks.*`. Sub-picks are NOT separately generated — they are config inputs to the composite's template render.

In `POST /api/training/generate-code`, request payload includes the full `compositionConfig` tree; server walks the tree, picks `composite_<kind>.py.j2`, inlines each sub-pick's hyperparameters via `{% for slot in expert_slots %}` template loops.

If user later wants an expert as standalone, they fork via the experiment ledger.

### 4.3 Nested form tree management

`compositionConfig.subPicks` is **flat array** (slotId-keyed) for reducer simplicity. Slot IDs encode path:
- MoE: `expert_0`, `expert_1`, …
- Stacking: `member_0`, …
- Multimodal: `modality_price.encoder`, `modality_volume.encoder`, …

Hyperparameters per sub-pick live inside SubPick (not top-level `state.hyperparameters` — that stays for atomic models). On save, entire `compositionConfig` blob serializes into request body. `generatedPreview.hash` includes serialized `compositionConfig` so config change anywhere invalidates cache.

---

## 5. ExperimentLedger design

### 5.1 Lifecycle
- **Adding:** "Save & train" → dispatch `addExperiment` with `status: "queued"`, then `useTrainingControl().startTraining(...)`. SSE `training_started` → `updateExperiment({ status: "running", startedAt, trainingSessionId })`.
- **Agent proposes (W8):** `addExperiment` with `status: "proposed"`, `source: "agent-proposed"`. Idle until user trains via row button.
- **Live updates:** Bridge component in `<TrainStage>` subscribes to `useTrainingLive()`; matches active session to `trainingSessionId`; appends fold metrics via `updateExperiment`.
- **Closing:** SSE `done` event → `updateExperiment({ status: "done", completedAt, summary, diagnosticsPath })`. Auto-star if new max Sharpe for `(catalogId, symbol, timeframe)` tuple.

### 5.2 Pre-fill composer from row
Click row → dispatch in order: `setComposition(deepClone)` → `setHyperparameters(deepClone)` → `setWalkForward(deepClone)` → `setObjectiveConfig(deepClone)` → `setLabelStrategy(experiment.labelStrategy, experiment.labelParams)` → clear `generatedPreview`; `model_id` defaults to `<catalogId>_v<n+1>`.

### 5.3 LocalStorage 50-cap + server-side merge
Local cap 50; older completed experiments persist in `model_versions` table (W7 schema) keyed by `(runnerKey, dataHash, hyperparametersHash)`.

Bridge: on Stage 4 mount, `useQuery(['model-versions', { symbol, timeframe, source: 'experiment-ledger' }])` fetches most recent 200 server-side versions; map → ledger fields → dispatch `hydrateExperiments`. Reducer prefers local over server when IDs collide; **must always prefer local copy if `local.status === "running"`**.

Server-only rows carry `source: "server"` badge; can be re-trained but not in-place edited; user forks via row click.

### 5.4 Schema columns
```
[ID] [Model] [Status] [Fold] [Sharpe] [PF] [ECE] [Max DD] [Trades] [Duration] [★] [Actions]
```
Sorting via `@tanstack/react-table`. Actions: Fork / Promote / Delete. "Promote" jumps to Stage 6 with this experiment auto-selected.

---

## 6. Evaluate redesign visual hierarchy

```
┌─ Top bar ───────────────────────────────────────────────────────────────────┐
│ Stage 5 — Evaluate    [agent: eval-reviewer ▸]    [+ Add registry mdl]     │
├─ ExperimentSelector (sticky chip row) ─────────────────────────────────────┤
│ ☑ exp_001 RF        ☑ exp_002 LGBM       ☑ exp_003 CNN     [+ pick]       │
│ Baseline: ☑ Buy&Hold  ☑ Naive momentum                                     │
├─ ComparisonMatrix (FOCAL — always expanded) ───────────────────────────────┤
│ Sortable Tanstack-Table; column-sticky on first col (metric);              │
│ row-sticky on last (Δ vs baseline); color cells by threshold tiers.        │
├─ Tabs: visual breakdowns (one chart at a time) ────────────────────────────┤
│ [Folds] [Regime] [Calibration] [Bootstrap CI] [Baselines]                  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Anti-wall-of-charts:** ComparisonMatrix is always-visible focal point. All other panels gated behind `<Tabs>` — exactly one chart on screen at a time. Borrows from existing `<Backtest>` page tab pattern.

**Lazy-render panels.** Each tab uses `React.lazy`. Tab content keyed by `tabId + experimentSelection.join(",")` so switching back doesn't re-fetch.

**Recharts perf:** N > 5 selected → switch from `<Line>` to `<Scatter dot={false}>` and downsample series via LTTB (~200-point target).

**ComparisonMatrix columns:**
- Metric (sticky-left): Sharpe (after costs), Profit factor, Win rate, Max drawdown, ECE, Mean trade PnL, Trade frequency, Sharpe (low-vol regime), Sharpe (high-vol regime), Sharpe (trend), Sharpe (chop)
- One column per selected experiment, color-coded by threshold tier (reuse `DashboardTab.tsx` rules: PF ≥2 emerald, ≥1.5 emerald-soft, ≥1 amber, <1 rose)
- Δ vs baseline (sticky-right)
- Best column highlighted with primary-color left border

---

## 7. Promote redesign visual hierarchy

```
┌─ Top bar ──────────────────────────────────────────────────────────────────┐
│ Stage 6 — Promote   [Refresh]   [Filters: status, catalog, sym/tf]        │
├─ RegistryTable (FOCAL) ────────────────────────────────────────────────────┤
│ version │ catalog │ status │ data_hash │ Sharpe │ promoted_at │ actions   │
│ v_004   │ xgb     │ live   │ ab12...   │  0.45  │ 2026-04-15  │ [...]    │
│ v_003   │ cnn-tx  │ candid │ ef56...   │  0.38  │ —           │ [...]    │
│ Click row → opens Sheet drawer on the right ───►                           │
├─ DeploymentPanel (separate section) ───────────────────────────────────────┤
│ MNQ 1m  live   v_004  pred/min=14  paper-PnL=+$432  [Pause][Stop][...]    │
│ MNQ 1d  paper  v_002  pred/day=1   paper-PnL=+$83   [Pause][Stop][...]    │
├─ DeploymentLiveMetrics (sparkline strip, SSE-bound) ───────────────────────┤
│ pred/min: ▁▂▄▆▇▆▄  paper PnL: ▁▂▃▄▅▆  drift PSI: ▆▅▅▅▄                    │
└────────────────────────────────────────────────────────────────────────────┘
   Right Sheet (drawer):
   ┌─ LineageCard ──────────────────────────────────────────────────────────┐
   │ Catalog spec, data, features, labels, HPO, train, eval, calibration,   │
   │ code path (clickable), parent_version_id chain                         │
   ├─ [Promote to next status ▾]                                            │
   ├─ PromotionGatePanel (when "Promote" clicked) ──────────────────────────┤
   │ candidate → shadow                                                     │
   │   Sharpe ≥ 0.20   : 0.42 ✓                                              │
   │   ECE ≤ 0.10      : 0.04 ✓                                              │
   │   fold-σ ≤ 0.30   : 0.18 ✓                                              │
   │ All gates pass.   [Promote to shadow]   [Override with reason ▸]      │
   └────────────────────────────────────────────────────────────────────────┘
```

**Drawer rationale:** `Sheet` keeps RegistryTable as focal point. DeploymentPanel + DeploymentLiveMetrics live below the table because they're a separate concern (active production state, not promotion workflow).

**Filter UX:** sticky bar above table. Status (multi-select chips), Catalog ID (searchable combobox), Symbol+timeframe (paired combobox defaulting to current pipeline).

---

## 8. Agent UI integration

### 8.1 Side-panel state ownership
**Single global panel state** in MLStudioContext (`agentPanel`). Single `<AgentReport>` rendered at the `MLStudioRoute` boundary so it overlays any stage. Only one agent runs at a time per session.

`<AgentButton>` in each stage dispatches `openAgentPanel({ stage, agentId })` and triggers mutation. While in-flight: Sheet shows `Loader2` + agent name + context blob being sent (transparency).

### 8.2 Structured response rendering

```ts
interface AgentReport {
  agentId: "feature-curator" | "arch-designer" | "hpo-strategist" | "eval-reviewer";
  status: "ok" | "error";
  summary: string;
  body: string;                                // markdown
  findings: AgentFinding[];
  proposedActions: AgentProposedAction[];
  diff?: { files: GeneratedFile[]; rationale: string };  // arch-designer only
}

interface AgentFinding {
  severity: "info" | "warning" | "error";
  category: string;                            // "leakage" | "overfit" | "regime" | "calibration"
  message: string;
  evidence: { metric: string; value: number; threshold?: number; reference?: string };
}

interface AgentProposedAction {
  kind: "set-feature-pipeline" | "set-hyperparameter" | "add-experiment" | "set-search-space" | "apply-template-edit";
  label: string;
  payload: Record<string, unknown>;
}
```

`<AgentReport>` renders: severity-tinted summary banner → findings table (badges + sortable) → markdown body (collapsible) → proposed actions as buttons (clicking dispatches the right reducer action).

Markdown: `react-markdown@^9.0.1` + `remark-gfm@^4.0.0` (~80 KB combined, in `vendor-markdown` chunk).

### 8.3 Diff viewer — library choice

**Recommend: Monaco `DiffEditor`.** Reasons: zero new bundle weight if W2 ships first; inline + side-by-side modes built-in; same `ml-studio-dark` theme; syntax highlighting consistent with `<CodePreviewPane>`.

```tsx
<GeneratedCodeDiffViewer
  base={state.generatedPreview!.files}
  proposed={agentReport.diff!.files}
  onApplyAll={() => /* mutation: POST /save-generated with proposed.files */}
  onApplyFile={(path) => /* per-file accept */}
/>
```

Accepted edits flow back through same save endpoint as a normal save.

---

## 9. Specialist dispatch plan

| Phase | Specialist | Scope |
|---|---|---|
| W2 | fe-state | `useTrainableCatalog()` hook + new badge taxonomy in ModelCatalogPicker |
| W2 | fe-viz | Build `<CodePreviewPane>` Monaco shell — theme, tab strip, dirty markers, lazy-load wrapper |
| W4 | fe-state | MLStudioContext extension (new fields, actions, reducer, v1→v2 migration); `<ArchitectureComposer>` + `<ExperimentLedger>` minus live SSE |
| W4 | fe-streaming | SSE bridge in `<TrainStage>` watching `useTrainingLive()` and dispatching `updateExperiment` per `metrics`/`done` event |
| W6 | fe-viz | `<ComparisonMatrix>` (Tanstack-Table v8) + `<WalkForwardFoldOverlay>` (Recharts CI95 band) + `<RegimeBreakdown>` + `<CalibrationPanel>` + `<BlockBootstrapCI>` + `<BaselineComparison>` |
| W6 | fe-state | EvaluateStage state (`evalSelection`, `runIdByExperiment`, `evalCollapsed`); `<BacktestRunner>` parallel mutations |
| W7 | fe-state | `<RegistryTable>` (Tanstack-Table) + filter state + Sheet drawer state; LineageCard + PromotionGatePanel mutations |
| W7 | fe-streaming | `useDeploymentEvents()` SSE hook + `<DeploymentLiveMetrics>` sparkline strip |
| W8 | fe-state | `useAgentDispatch()` mutation + `<AgentReport>` Sheet + `agentPanel` reducer wiring; per-stage `<AgentButton>` placement |
| W8 | fe-viz | `<GeneratedCodeDiffViewer>` Monaco DiffEditor wrapper + accept-all / per-file-accept controls |

Total: 10 specialist dispatches across 5 phases.

---

## 10. Frontend-side risks not in plan §12

| Risk | Mitigation |
|---|---|
| Monaco's `automaticLayout: true` triggers `ResizeObserver` per editor instance — may hit "ResizeObserver loop limit" warnings | Wrap mounts in `useDeferredValue`; throttle layout calls. Acceptable: console warnings only. |
| ExperimentLedger merge race — 30s server hydrate could clobber live `foldMetrics` mid-session | Reducer `hydrateExperiments` MUST prefer local copy if `local.status === "running"` |
| Tanstack-Table v8 ships ~70 KB — first use here | Add `vendor-table` chunk |
| Multiple parallel BacktestRunner mutations (W6) hammer orchestrator (5 × 30s = 150s blocking) | Per-experiment progress strip; gate "Run all" behind confirmation if N > 3 |
| `/api/events/deployments` SSE: two windows = duplicate events; EventSource leaks if not closed on unmount | `useDeploymentEvents()` returns cleanup that aborts EventSource; `useEffect` empty deps |
| Sheet drawer (LineageCard) + global agent Sheet panel collision on `side="right"` | Promote drawer uses `right`, AgentReport uses `left`. Coexist visually. |
| Monaco's `python` tokenizer is regex-based — no semantic linting | Live Python lint via backend `POST /api/training/lint-python` (spawns `ruff check --output-format=json`); surface inline via Monaco `setModelMarkers` |
| Recharts `<Area>` for CI95 band needs upper/lower data series — slow for >5 experiments | Memoize via `useMemo`; cap to 200 timepoints via LTTB downsample |
| `react-markdown` not in deps — adds ~80 KB | `vendor-markdown` chunk |
| `wouter` doesn't have nested routes — shareable URLs (`?stage=evaluate&experiments=001,002`) need URL-state syncing | Out of scope this plan; revisit after W6. localStorage is enough for single-user single-machine. |
| `@monaco-editor/react` peer deps — verify with React 19 | Pin `^4.6.0` + `monaco-editor@^0.52.2` |
| Backwards-compat: existing users may have `state.modelType` set to runner that no longer exists | New TrainStage on mount: if `state.modelType` non-empty and `useTrainableCatalog()` doesn't return it, dispatch `setModelType("")` + toast "Previously selected model removed; pick again." |
| `@tanstack/react-table@^8` React 19-compat only on v8.20+ | Pin `^8.21.0`. Verify build clean. |
| Existing standalone `/training` route's `<Training>` page imports `ConfigStrip` we are NOT removing — would duplicate new `<WalkForwardPanel>` and `<ModelCatalogPicker>` if mounted in TrainStage | Add `<Training embedded />` prop that hides internal ConfigStrip when truthy. Backwards-compatible — `/training` standalone keeps all sections. |

---

## 11. Phase-by-phase build order (frontend slice)

1. **W2 — Foundation.** ModelCatalogPicker swap + CodePreviewPane Monaco shell. Unblocks every later phase.
2. **W4 — UX shell.** MLStudioContext extension + ArchitectureComposer (atomic only) + WalkForwardPanel + ExperimentLedger (without live SSE). TrainStage gets new layout.
3. **W4 (live SSE bridge).** fe-streaming wires `useTrainingLive()` → `updateExperiment`.
4. **W6.** EvaluateStage rewrite. ComparisonMatrix first; then folds tab; then regime/calibration/bootstrap/baseline tabs.
5. **W7.** PromoteStage rewrite. RegistryTable + LineageCard + PromotionGatePanel + DeploymentPanel + DeploymentLiveMetrics. Backend `/api/model-versions` and `/api/events/deployments` must land first.
6. **W8.** Agent UI. AgentReport + AgentButton per stage. GeneratedCodeDiffViewer last (depends on agent's structured `diff` field).

Composer recursion (composites — W5 in parent plan) is backend-side; frontend-side composer just needs `filter` prop (W2) and `compositionConfig` reducer (W4) ready when W5 backend ships.

---

## 12. Verification

After each phase:
- `npx tsc --noEmit` clean
- `npm run build` clean (no chunk-size warnings beyond existing 1200 KB; new `vendor-monaco`, `vendor-table`, `vendor-markdown` chunks present)
- Visual smoke: open `/ml-studio`, navigate Stages 1→6, confirm gates evaluate correctly
- `npm test -- --run` passes; new components ship with vitest unit coverage for reducer cases (§2.3) and v1→v2 migration

After W2: pick Random Forest → composer shows HP form → Generate → Monaco renders ~80 LOC → edit one HP → Save & train → file at `src/ml/random_forest_v1/main.py` → training spawns → row appears in ledger.

After W6: multi-select 3 experiments → ComparisonMatrix renders metrics → click Folds tab → 3 overlaid equity curves with CI95 bands.

After W7: row in RegistryTable → click → drawer opens with LineageCard → Promote to shadow → all gates pass → status updates.

After W8: each of 4 agent buttons returns structured report; arch-designer's diff renders in DiffEditor; accept-all writes to disk.

---

**Authored:** 2026-05-09 by frontend-lead. Companion to `docs/plans/2026-05-09-ml-studio-workshop-redesign.md`.
