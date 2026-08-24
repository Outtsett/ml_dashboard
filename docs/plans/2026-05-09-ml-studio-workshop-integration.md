# ML Studio Workshop — Master Integration Plan

**Date:** 2026-05-09
**Status:** Plan (not yet executed)
**Parent plan:** `docs/plans/2026-05-09-ml-studio-workshop-redesign.md`
**Sub-plans:**
- `docs/plans/2026-05-09-ml-studio-workshop-integration-ml.md` (ml-lead)
- `docs/plans/2026-05-09-ml-studio-workshop-integration-backend.md` (backend-lead)
- `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md` (frontend-lead)

This document synthesizes the three domain integration plans into a single execution sequence with explicit cross-domain contracts, dependencies, and verification gates.

---

## 1. Architecture seams (cross-domain contracts)

| Seam | Owner of contract | Consumer(s) | Format |
|---|---|---|---|
| `ParsedModelSpec` parser extension (`module_path`, `class_name`, `classOrigin`) | backend-lead | ml-lead's `sklearn.py.j2` / `tree.py.j2` / `gmm.py.j2` / `hmm.py.j2` templates | TS `interface ParsedModelSpec` in `src/server/lib/modelImport/types.ts` |
| `pickTemplate(spec, template) → TemplateId \| null` | backend-lead | frontend-lead's `useTrainableCatalog()` (renders badges) | TS function in `src/server/lib/catalogBridge.ts` |
| Generator API: `POST /api/training/generate-code`, `POST /api/training/save-generated`, `GET /api/training/templates` | backend-lead | frontend-lead's `<CodePreviewPane>`, `<GeneratedFileSaver>` | OpenAPI-style request/response contract documented in backend sub-plan §1 |
| Generated `main.py` calling convention: `train_one_fold(X_train, y_train, X_test, y_test, args, *, fold_idx=None)` and `predict(model, X) → np.ndarray` | ml-lead | Composite templates (W5) that import sub-models | Python module convention in `_base.py.j2` |
| Walk-forward fold protocol: per-fold `emit_metric(name=f"fold_{i}_{metric}", value, iteration=i)` + structured `emit_fold_complete(fold_idx, metrics)` | ml-lead | frontend-lead's `<ExperimentLedger>` SSE bridge | New helper added to `src/ml/shared/protocol.py` |
| SSE `/api/events/deployments` event types (deployment.started/prediction/pnl_update/paused/resumed/stopped/failed/heartbeat) | backend-lead | frontend-lead's `useDeploymentEvents()` | TS types in `src/shared/deploymentTypes.ts` (new) |
| Promotion gate metric source map (`sharpe_after_costs` from `backtest_runs.metrics_json`, etc.) | backend-lead | frontend-lead's `<PromotionGatePanel>` (renders dryRun results) | Documented in backend sub-plan §5 |
| `AgentReport` envelope (summary, body, findings[], proposedActions[], optional diff) | backend-lead | frontend-lead's `<AgentReport>`, `<GeneratedCodeDiffViewer>` | TS types in `src/shared/agentTypes.ts` (new) |

---

## 2. Phase dependency graph

```
W1 (parallel: backend infra + ml infra)
├── ml-lead: scripts/generate_model.py + base templates + shared/labels lift + shared/walk_forward
└── backend-lead: codeGenerator.ts + routes/codegen.ts + parsers/generated.ts
       ▼
W2 (sequential within phase: backend parser change BEFORE ml templates can render reliably)
├── backend-lead: ParsedModelSpec extension + classMap.ts + pickTemplate() + /api/model-catalog/trainable
├── ml-lead: sklearn.py.j2 + tree.py.j2 + gmm.py.j2 (depends on backend parser)
└── frontend-lead: useTrainableCatalog hook + ModelCatalogPicker swap + CodePreviewPane Monaco shell
       ▼
W3 (parallel: ml-only)
└── ml-lead: src/ml/blocks/ library + 5 pytorch templates (mlp/cnn/autoencoder/vae/transformer_seq)
       ▼
W4 (parallel: ml + frontend)
├── ml-lead: hmm.py.j2 + _eval_clustering.py.j2
└── frontend-lead: MLStudioContext extension + ArchitectureComposer + WalkForwardPanel + ExperimentLedger + GeneratedFileSaver
   └── frontend-lead (sub): live SSE bridge in <TrainStage> watching useTrainingLive()
       ▼
W5 (sequential: ml composites need W3 blocks library)
└── ml-lead: composite_{moe,stacking,voting,multimodal}.py.j2 + recursion logic in generate_model.py
       ▼
W6 (parallel: ml shared + frontend)
├── ml-lead: src/ml/shared/bootstrap.py
└── frontend-lead: EvaluateStage rewrite — ExperimentSelector + BacktestRunner + ComparisonMatrix + WalkForwardFoldOverlay + RegimeBreakdown + CalibrationPanel + BlockBootstrapCI + BaselineComparison
       ▼
W7 (sequential within phase: backend SQLite + routes BEFORE frontend can consume)
├── backend-lead: migration 0002 + Drizzle schemas + routes/registry.ts + routes/deployments.ts + promotionGates.ts + main.ts compression-filter fix
└── frontend-lead: PromoteStage rewrite — RegistryTable + LineageCard + PromotionGatePanel + DeploymentPanel + DeploymentLiveMetrics + useDeploymentEvents()
       ▼
W8 (sequential within phase: backend agent infra BEFORE frontend agent UI)
├── backend-lead: migration 0003 + agentRuns Drizzle + routes/agents.ts + agentDispatcher.ts
├── frontend-lead: useAgentDispatch + AgentReport Sheet + agentPanel reducer wiring + AgentButton placement
└── frontend-lead (sub): GeneratedCodeDiffViewer (Monaco DiffEditor — depends on W2 Monaco being lazy-loaded)
       ▼
W9 (parallel: ml RL templates + backend live deploy)
├── ml-lead: trading_env.py + rl_{dqn,ppo,a2c}.py.j2
└── backend-lead: mlbridgeClient.ts + lifecycle.ts + predictionLog.ts + pickTemplate RL routing flips on
   └── infra-questdb (cross-domain): prediction_log table DDL + ILP write path
```

**Critical path:** W1 → W2 → W4 → W6 → W7 → W8. W3 can start right after W1 (parallel with W2). W5 depends on W3. W9 can start any time after W2 lands the foundation.

**Minimum viable workshop:** **W1 + W2 only** — once both ship, every sklearn / xgboost / lightgbm / catboost / GMM catalog entry is selectable in the picker → renders Python in Monaco → user reviews/edits → saves → trains → produces standard `oos_predictions.parquet` + `diagnostics.json` consumable by the existing Backtest page (Stage 5 still uses the legacy `<Backtest />` until W6 lands).

---

## 3. Per-phase execution plan

Each phase carries its lead governance, key deliverables, cross-phase dependencies, and the verification gate that must pass before declaring the phase complete.

### W1 — Generator infrastructure (5 days)

**Leads + specialists:** ml-lead (ml-trainer, ml-data, ml-eval), backend-lead (be-api, be-events)

**Deliverables:**
- ml-lead — `scripts/generate_model.py`, `src/templates/architectures/_{base,walk_forward,eval_classification,eval_regression}.py.j2`, lift `xgb_classifier/labels.py` → `src/ml/shared/labels.py`, new `src/ml/shared/walk_forward.py` with `iter_folds()`, `pyproject.toml` += `jinja2>=3.1`
- backend-lead — `src/server/lib/codeGenerator.ts` (TS spawn wrapper + LRU cache), `src/server/routes/codegen.ts` (3 endpoints), `src/server/training/runners/parsers/generated.ts` (parses `epoch_metric` events from generated runners)

**Cross-domain contract:** Generator CLI flags + JSON output schema documented in ml sub-plan §2 + backend sub-plan §1. ml-lead authors generator; backend-lead consumes its stdout.

**Gate:** `python scripts/generate_model.py --catalog-id random-forest --dry-run ...` produces compilable Python (`python -m py_compile` clean); `POST /api/training/generate-code` returns same shape as JSON; `pytest tests/test_walk_forward.py -v` 6/6 pass.

### W2 — Foundation templates + catalog wiring + Monaco (5 days)

**Leads + specialists:** backend-lead (be-api, parser extension), ml-lead (ml-trainer, ml-features), frontend-lead (fe-state, fe-viz)

**Deliverables:**
- backend-lead — `ParsedModelSpec` extension (`module_path`, `class_name`, `classOrigin`), `extractClassImport()` code-fence harvester, hand-curated `src/server/lib/modelImport/classMap.ts` (~150 entries), `pickTemplate()` + `runnerSource` + `templateId` fields on `TrainableModel`, `GET /api/model-catalog/trainable` route
- ml-lead — `sklearn.py.j2`, `tree.py.j2`, `gmm.py.j2` templates; hoist `_load_features_with_cache` from `xgb_classifier/main.py` → `src/ml/shared/features.py::load_features_with_cache`
- frontend-lead — `useTrainableCatalog()` hook, `ModelCatalogPicker.tsx` data source swap + 3-state badges (WIRED / GENERATE-* / BROWSE-ONLY), `CodePreviewPane.tsx` Monaco shell (lazy-loaded), `package.json` += `@monaco-editor/react@^4.6.0` + `monaco-editor@^0.52.2`, `vite.config.ts` += `vendor-monaco` chunk

**Sequential dependency within phase:** backend parser MUST land before ml renders (templates need `class_name`/`module_path`). ml templates MUST land before frontend can demonstrate end-to-end flow.

**Gate:** Open `/ml-studio` Train stage → pick Random Forest → composer renders HP form → click Generate → Monaco shows generated Python → Save & train → file lands at `src/ml/random_forest_v1/main.py` → orchestrator spawns it → `oos_predictions.parquet` schema matches XGBoost reference. Same for LightGBM, GMM. CI test: every catalog entry with `templateId ∈ {sklearn, tree, gmm}` resolves a non-empty `class_name`.

### W3 — Deep-learning templates + blocks library (5 days)

**Leads + specialists:** ml-lead (ml-architect, ml-trainer)

**Deliverables:**
- ml-lead — `src/ml/blocks/{__init__,encoder,decoder,attention,head,gating,fusion}.py` (lifts from `E:\source\repos\trading_model\src\ml\cnn_transformer\model.py`), templates `pytorch_{mlp,cnn,autoencoder,vae}.py.j2` and `transformer_seq.py.j2`

**Gate:** `pytest tests/test_ml_blocks.py -v` covering shape correctness + gradient flow; for catalog entries `autoencoder`, `convolutional-neural-network-cnn`, `transformer`: render → compile → smoke-train on MNQ 1m 20k bars succeeds; `grep "from src.ml.blocks" src/ml/transformer_smoke/main.py` returns ≥1 (verifies generated code uses the block library, doesn't duplicate tensor math inline).

### W4 — HMM template + Train workshop UX (5 days)

**Leads + specialists:** ml-lead (ml-architect, ml-eval), frontend-lead (fe-state, fe-streaming)

**Deliverables:**
- ml-lead — `hmm.py.j2`, `_eval_clustering.py.j2`, `pyproject.toml` += `hmmlearn>=0.3`
- frontend-lead — MLStudioContext extension (new fields + actions + reducer cases + v1→v2 localStorage migration), `ArchitectureComposer.tsx` (atomic-only; composites land with W5), `WalkForwardPanel.tsx`, `ExperimentLedger.tsx` (without live SSE), `GeneratedFileSaver.tsx`, TrainStage rewrite assembling all of these
- frontend-lead (sub) — fe-streaming wires `useTrainingLive()` → `updateExperiment` per-fold; ledger updates live during training

**Cross-domain contract:** `emit_fold_complete(fold_idx, metrics)` helper in `src/ml/shared/protocol.py` (added during W1) is consumed by frontend's SSE bridge here.

**Gate:** Pick GMM → trains; pick HMM → trains; ledger row appears for each training run with live fold updates; click ledger row → composer pre-fills with that experiment's config; localStorage v1 → v2 migration tested with seeded prior state.

### W5 — Composite templates (5 days)

**Leads + specialists:** ml-lead (ml-architect)

**Deliverables:**
- ml-lead — `composite_{moe,stacking,voting,multimodal}.py.j2`, `src/config/composite_catalog_extras.json` (4 composite "meta-entries" injected into the catalog so MoE/stacking/voting/multimodal show up as pickable in the catalog picker), recursion logic in `scripts/generate_model.py --composite` per ml sub-plan §4

**Cross-domain contract:** Composite picker recursion in frontend was already plumbed in W4 via `<ModelCatalogPicker filter={...}>` prop — composites become trainable here.

**Gate:** Pick MoE (4 experts: 2 RF + 2 LightGBM) → recursive generation creates 4 sub-model dirs + 1 composite dir → trains → produces composite predictions; same for Stacking; Voting; Multimodal. CI: recursion depth-3 test asserts `RecursionError` raised cleanly.

### W6 — Evaluate redesign (5 days)

**Leads + specialists:** ml-lead (ml-eval), frontend-lead (fe-viz, fe-state)

**Deliverables:**
- ml-lead — `src/ml/shared/bootstrap.py` (block bootstrap CI95, default 10k resamples, sqrt-n + Politis-Romano block-size methods)
- frontend-lead — EvaluateStage rewrite assembling: `ExperimentSelector`, `BacktestRunner`, `ComparisonMatrix` (Tanstack-Table v8), `WalkForwardFoldOverlay` (Recharts CI95 band), `RegimeBreakdown`, `CalibrationPanel`, `BlockBootstrapCI`, `BaselineComparison`. New deps: `@tanstack/react-table@^8.21.0` (`vendor-table` chunk).

**Cross-domain contract:** Frontend's `BlockBootstrapCI` calls bootstrap in-browser for ≤5k trades; for larger, calls `POST /api/eval/block-bootstrap` (new backend route — added implicitly here, owned by backend-lead) which spawns `src/ml/shared/bootstrap.py`.

**Gate:** Multi-select 3 experiments → ComparisonMatrix renders Sharpe / PF / WinRate / MaxDD / ECE / regime-conditional Sharpe with Δ vs baseline column; WalkForwardFoldOverlay renders 3 overlaid equity curves with CI95 bands; RegimeBreakdown shows per-regime grouped bars; CalibrationPanel shows overlaid reliability curves; BlockBootstrapCI returns CI95 for each experiment's mean trade PnL within 2% of scipy reference (iid sample test); BaselineComparison renders buy-hold + naive-momentum.

### W7 — Promote registry + deployments + gates (5 days)

**Leads + specialists:** backend-lead (be-db, be-drizzle, be-api, be-events), frontend-lead (fe-state, fe-streaming)

**Deliverables:**
- backend-lead — `migrations/0002_model_registry.sql` (3 tables + 6 seed gates) + rollback DDL, Drizzle schemas (`modelVersions`, `deployments`, `promotionGates`), `src/server/routes/{registry,deployments}.ts`, `src/server/lib/promotionGates.ts` evaluator, **fix `src/server/main.ts` compression filter** to also exclude `/events/` paths (1-line; prevents Brotli buffering of new SSE channel), `/api/events/deployments` SSE channel
- frontend-lead — PromoteStage rewrite assembling `RegistryTable` (Tanstack-Table) + filter bar + Sheet drawer with `LineageCard` + `PromotionGatePanel`, `DeploymentPanel` + `DeploymentLiveMetrics` (sparkline strip via `useDeploymentEvents()` SSE hook)

**Sequential dependency within phase:** backend SQLite + routes MUST land before frontend can consume.

**Gate:** Train model in W2 path → `POST /api/model-versions` registers it as `candidate` → row appears in RegistryTable → click row → drawer opens with LineageCard → click "Promote to shadow" → PromotionGatePanel shows gate-by-gate pass/fail with measured-vs-threshold; if all pass, status updates to `shadow`; rollback restores prior status. SSE channel verified non-buffered via `curl --compressed -H "Accept-Encoding: gzip, br"` showing immediate event flush. Vitest covers `pickTemplate` (8 cases), `classifyRunnerSource` (3 cases), `getTrainableModels` integration (2 cases).

### W8 — Workshop AI agents (5 days)

**Leads + specialists:** backend-lead (be-db, be-drizzle, be-api, be-events), frontend-lead (fe-state, fe-viz)

**Deliverables:**
- backend-lead — `migrations/0003_agent_runs.sql`, `agentRuns` Drizzle schema, `src/server/routes/agents.ts` (3 endpoints), `src/server/lib/agentDispatcher.ts` (in-memory job queue + crash recovery via `UPDATE status='failed' WHERE status IN ('queued','running')` on boot), Claude Agent SDK integration via the `agent-sdk-dev` plugin, `/api/events/agents/:runId` SSE with reconnect-replay ring buffer
- frontend-lead — `useAgentDispatch()` mutation, `<AgentReport>` Sheet (renders summary banner + findings table + markdown body via `react-markdown@^9.0.1` + `remark-gfm@^4.0.0` in `vendor-markdown` chunk + proposed-action buttons that dispatch reducer actions), `<GeneratedCodeDiffViewer>` (Monaco DiffEditor — reuses W2 Monaco bundle), `<AgentButton>` placement per stage
- ml-lead (cross-domain dispatch) — author the 4 agent definitions at `~/.claude/agents/{feature-curator,arch-designer,hpo-strategist,eval-reviewer}.md` with the context-blob input schema documented in backend sub-plan §8

**Gate:** Click "Ask agent" in Features stage → feature-curator returns structured report with severity-tinted findings + proposed actions; same for hpo-strategist (Labels), arch-designer (Train), eval-reviewer (Evaluate). arch-designer's "Propose template edits" mode emits a `diff` field → DiffEditor renders side-by-side → "Accept all" writes to disk via the existing `/save-generated` endpoint. Server-restart drill: kill server while agent is `running` → reboot → `agent_runs` row marked `failed` with `error='server restart'`.

### W9 — Live deploy + RL templates (5 days)

**Leads + specialists:** backend-lead (be-api, be-events), ml-lead (ml-architect), infra-questdb (cross-domain)

**Deliverables:**
- backend-lead — `src/server/deployments/mlbridgeClient.ts` (ZMQ REQ socket; heartbeat thread; auto-reconnect on first failure; mark `failed` on 3 missed pongs), `src/server/deployments/lifecycle.ts` (status transitions, predictions counter, paper PnL accrual), `src/server/deployments/predictionLog.ts` (writes per-bar predictions to QuestDB `prediction_log` via existing ILP client), `ENABLE_LIVE_DEPLOY=1` env gate
- ml-lead — `src/ml/blocks/trading_env.py` (`gymnasium.Env` wrapping MNQ OHLCV; action ∈ {flat, long, short}; reward = realized PnL - λ·|position| inventory penalty), templates `rl_{dqn,ppo,a2c}.py.j2`, `pyproject.toml` += `gymnasium>=1.0`, `stable-baselines3>=2.4`. `pickTemplate()` RL routing flips on (returns `rl_dqn`/`rl_ppo`/`rl_a2c` instead of `null`)
- infra-questdb (cross-domain dispatch) — `prediction_log` table DDL via `CREATE TABLE IF NOT EXISTS` on first deployment + ILP write path verification

**Gate:** Pick DQN → render → smoke-train (1k timesteps) → produces `episode_reward_mean` in `diagnostics.json`; same for PPO + A2C. Set `ENABLE_LIVE_DEPLOY=1`, MLBridge running → deploy live → predictions land in QuestDB `prediction_log`; pause / stop / rollback all work; force ZMQ socket close → heartbeat detects in 15s → deployment marked `failed` → `deployment.failed` SSE event fires.

---

## 4. Master verification (after all phases)

A single integration test that exercises the full workshop in one pass:

```bash
# 1. Type + build clean
npx tsc --noEmit
npm run build

# 2. Tests pass
npm test -- --run                  # frontend + server vitest
pytest -m "not slow" -n auto       # python (per CI ci.yml test-py job)

# 3. End-to-end smoke
# Open /ml-studio in browser; go through stages 1-6 picking LightGBM as the model
# Verify each stage gate evaluates correctly, training streams live to ledger,
# backtest renders comparison matrix, promotion gate panel evaluates 3 metrics,
# promote to shadow succeeds, deployment in shadow mode runs.

# 4. Composite smoke
# In Train stage: pick MoE composite, set 2 experts (RF + LightGBM), train,
# verify recursive sub-model generation, composite trains, ledger shows row.

# 5. Agent smoke
# Click each of 4 agent buttons; verify all 4 return structured reports.
# Click arch-designer's "Propose template edits"; verify diff renders;
# click "Accept all"; verify file rewritten and runners.json updated.

# 6. Lineage drill-down
# In Promote stage: select v_004; LineageCard shows full provenance back to
# catalog spec MD path, data hash, hyperparameters, training session ID,
# parent_version_id chain.
```

---

## 5. Tracking (todos)

Per-phase execution todos created in this session — one per phase (W1–W9), with explicit dependency chain matching §2. Each phase's todo description names: which leads govern, which specialists execute, which sub-plan governs, the cross-domain contract that must land first.

A phase todo is marked `completed` only when the phase's verification gate (§3) passes end-to-end on the project's actual MNQ 1m parquet data — no synthetic data per `~/.claude/rules/ml/no-synthetic-data.md`.

---

## 6. What I'm NOT planning here

- **Actual implementation work** — this is the sequencing + contracts plan only. Per-task implementation lives in the leads' specialists' execution sessions (each spawned with the dispatch protocol from `~/.claude/rules/workflow/todo-tracking.md`).
- **Feature flags / partial rollout strategy** — single-user single-machine project; ship straight, no flags except the `ENABLE_LIVE_DEPLOY=1` already in W9.
- **Backwards-compat for the legacy `<Training>` standalone route** — kept untouched; the embedded prop change in W4 is additive and defaults preserve current behavior.
- **CI changes beyond what already exists** — the `ci.yml` `test-py` job already runs Python tests under `tests/`; new `tests/test_walk_forward.py`, `tests/test_ml_blocks.py`, `tests/test_bootstrap.py` get picked up automatically. Vitest tests for backend bridge / frontend reducer added to existing test discovery.
- **Documentation beyond CLAUDE.md update** — execution sessions update CLAUDE.md per `~/.claude/rules/code-quality/documentation-always-current.md`; no separate ARCHITECTURE.md edits planned.

---

**Plan author:** synthesized 2026-05-09 from three lead integration sub-plans (ml-lead, backend-lead, frontend-lead). Cross-domain contracts identified, sequential dependencies enforced via the W1 → W2 critical path, every phase gated by an end-to-end verification on real MNQ 1m parquet data.
