# ML Studio Workshop — Backend Integration Plan

**Date:** 2026-05-09
**Scope:** Backend slice (TS/Express/NestJS) of W1, W2, W7, W8, W9
**Companion to:** `docs/plans/2026-05-09-ml-studio-workshop-redesign.md`
**Authored by:** backend-lead

---

## 1. Backend Deliverables Matrix

| Phase | File | Purpose | Reuses / Extends |
|---|---|---|---|
| W1 | `scripts/generate_model.py` | Python entry for Jinja2 rendering + optional `--register` runners.json patch | New; called by codeGenerator.ts |
| W1 | `src/server/lib/codeGenerator.ts` | TS wrapper: spawn `generate_model.py`, in-memory LRU cache keyed by sha256(inputs+templateVersion) | Pattern: existing spawn-Python at `src/server/lib/dataExport/` |
| W1 | `src/server/routes/codegen.ts` | `POST /api/training/generate-code`, `POST /api/training/save-generated`, `GET /api/training/templates` | New router; mount in `src/server/routes/index.ts` |
| W1 | `src/server/training/runners/parsers/generated.ts` | Parses generic `epoch_metric` events emitted by `_base.py.j2` runners | Existing `parsers/` registry — `getParser()` dispatch |
| W2 | `src/server/lib/catalogBridge.ts` (extend) | Add `pickTemplate(spec, template) → TemplateId \| null`; add `templateId` and `runnerSource: 'wired' \| 'generate' \| 'browse-only'` to `TrainableModel` | Extends existing `matchTemplate()` |
| W2 | `src/server/routes/modelCatalog.ts` (extend) | Add `GET /api/model-catalog/trainable` returning `getTrainableModels()` enriched | Same router |
| W2 | `src/server/lib/modelImport/parser.ts` (extend) | Add `extractClassImport()` code-fence harvester; populate `class_name`/`module_path` on `ParsedModelSpec` | Existing parser; new helper |
| W2 | `src/server/lib/modelImport/classMap.ts` | Hand-curated catalogId → `{module_path, class_name}` map for ~150 supervised/clustering/HMM specs | New |
| W7 | `migrations/0002_model_registry.sql` | Forward DDL for 3 tables + seed gates | New migration; follows `migrations/0001_*.sql` pattern |
| W7 | `migrations/0002_model_registry.down.sql` | Rollback DDL | New |
| W7 | `src/shared/schema.ts` (extend) | Drizzle schemas for `modelVersions`, `deployments`, `promotionGates` | Existing 37-table file |
| W7 | `src/server/routes/registry.ts` | `POST/GET/GET :id`, `POST :id/promote`, `POST :id/rollback` | New router |
| W7 | `src/server/routes/deployments.ts` | `GET/POST/POST :id/pause/POST :id/stop`, `GET /api/events/deployments` (SSE) | New router |
| W7 | `src/server/lib/promotionGates.ts` | Gate evaluation engine (TS-only, reads existing `backtest_runs` + `diagnostics.json`) | Reuses existing backtest tables |
| W7 | `src/server/main.ts` (1-line fix) | Compression filter must skip `/events/` paths (currently only `/stream/`) | Existing filter |
| W8 | `src/server/routes/agents.ts` | `POST /api/agents/dispatch`, `GET /api/agents/runs/:id`, `GET /api/events/agents/:id` (SSE) | New router |
| W8 | `src/server/lib/agentDispatcher.ts` | Spawns Claude Agent SDK; in-memory job queue + persistence | New |
| W8 | `migrations/0003_agent_runs.sql` | Persist agent run history | New |
| W9 | `src/server/deployments/mlbridgeClient.ts` | ZMQ REQ socket to MLBridge — guarded by `ENABLE_LIVE_DEPLOY=1` | Reuses `zeromq` dep |
| W9 | `src/server/deployments/lifecycle.ts` | Status transitions running ↔ paused ↔ stopped, predictions counter, paper PnL accrual | New |
| W9 | `src/server/deployments/predictionLog.ts` | Writes per-bar predictions to QuestDB `prediction_log` table | Reuses `src/server/lib/questdb/ilpClient.ts` |

---

## 2. Generator → Orchestrator Handshake

```
Frontend → /generate-code → codeGenerator.ts → generate_model.py → fs/runners.json → registry.ts → orchestrator.ts → pythonRunner.ts

POST /generate-code (preview)
  → generatePreview(payload)
  → key = sha256(catId+hp+labels+wf+tplVer)
  → if cache.has(key): return cached; else spawn (--dry-run)
  → render Jinja2 → emit {files, templateId, warnings} JSON to stdout
  → cache.set(key, ...)
  → return to frontend

[user reviews/edits in Monaco]

POST /save-generated
  → saveAndRegister(payload)
  → spawn (--register)
  → write src/ml/<id>/{main,labels,eval,manifest}.py via tmp+rename
  → patch runners.json tmp+rename atomic
  → exit 0
  → reloadConfigs()  (registry cache)
  → refreshBridge()  (catalogBridge cache)
  → return {savedPaths, runnerKey} to frontend

POST /api/training/start { modelType: "generated_rf_v1+direction_classifier" }
  → registry.ensureLoaded() (mtime check, returns fresh runners)
  → orchestrator.getModelConfig() → finds new entry
  → orchestrator.spawn → pythonRunner.spawn (absolute path resolved via path.isAbsolute check)
```

**Caches that need invalidation on save:**

| Cache | Location | TTL today | Invalidation mechanism |
|---|---|---|---|
| `runnersConfig` (and `modelsConfig`, `legacyAliasMap`) | `registry.ts` module-level | dev: mtime check; prod: never | Dev auto-OK. **Prod requires explicit `reloadConfigs()`** call from `codeGenerator.saveAndRegister()`. |
| `BridgeCache` (`mergedModels`, `trainableKeys`) | `catalogBridge.ts` module-level | 5 min TTL | Call `refreshBridge()` from `saveAndRegister()` |
| Code-preview LRU | `codeGenerator.ts` (new) | 1 hr / 200 entries | No invalidation needed — keyed by content hash including templateVersion |
| Frontend `/api/training/config` cache | client React Query | per query default | Frontend `queryClient.invalidateQueries(['training-config'])` and `['model-catalog-trainable']` after save 200 OK |

**Decision:** `codeGenerator.saveAndRegister()` calls **both** `reloadConfigs()` (registry) and `refreshBridge()` (bridge) synchronously after spawn returns 0. Cost: ~10ms JSON re-parse per save. Acceptable.

---

## 3. `runners.json` Auto-Patching Strategy

**The file is hand-curated, multi-author (humans + generator), and read by both Node and Python.** Patching must preserve structure and survive concurrent writes.

**Recommendation — atomic JSON5-tolerant rewrite via Python (not Node):**

1. **Python owns the write.** `generate_model.py` reads → mutates → writes. Avoids second IPC hop.
2. **Read with `json.load()` strict** — fail-fast on existing corruption.
3. **Insertion order:** new entries appended to end of `runners` object (Python 3.7+ dict preserves insertion order).
4. **No re-sort.** Re-sorting creates giant diff and loses Tyler's curation order.
5. **Pretty-print with 2-space indent + sort_keys=False.**
6. **Atomic write:** `tempfile.NamedTemporaryFile(dir=same_dir, delete=False)` → `os.replace(tmp, target)`. Atomic on POSIX and NTFS.
7. **File lock during write:** `portalocker` exclusive lock; 5s timeout, abort with clear error.
8. **Conflict detection:** before writing, re-stat file and verify mtime hasn't changed since read. If it did, abort with `RunnersJsonConflictError` → HTTP 409.
9. **Schema validation before write:** Pydantic model mirroring `RunnerEntry` (`src/shared/trainingTypes.ts`).
10. **Git status:** stays uncommitted by default. `src/ml/generated/` `.gitignore`d; "Promote to repo" button later moves to `src/ml/<model_id>/` and stages diff.
11. **Backup sibling:** `runners.json.bak.<ISO>` before each patch; max 10 retained.
12. **Idempotency on re-save:** if `(catalog_id, hp_hash)` matches existing entry's `generated_from.sourceHash`, **overwrite** rather than append duplicate.

**Why not YAML/TOML?** Project is JSON-native (Node + Python both speak it natively, no extra deps).

**Why not separate `generated_runners.json` merged at load?** Tyler explicitly wants generated entries to be "first-class WIRED models — same status, same registry" (plan §5).

---

## 4. SQLite Migration Plan (W7)

### Forward DDL — `migrations/0002_model_registry.sql`

```sql
CREATE TABLE IF NOT EXISTS model_versions (
  version_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id          TEXT NOT NULL,
  runner_key          TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('candidate','shadow','paper','live','retired')),
  data_hash           TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  timeframe           TEXT NOT NULL,
  date_range_start    TEXT NOT NULL,
  date_range_end      TEXT NOT NULL,
  feature_pipeline    TEXT NOT NULL,
  label_config        TEXT NOT NULL,            -- JSON
  hyperparameters     TEXT NOT NULL,            -- JSON
  walk_forward_config TEXT,                     -- JSON
  hpo_study_id        TEXT,
  model_artifact_path TEXT NOT NULL,
  diagnostics_path    TEXT NOT NULL,
  metrics_summary     TEXT NOT NULL,            -- JSON
  trained_at          TEXT NOT NULL,
  promoted_at         TEXT,
  retired_at          TEXT,
  parent_version_id   INTEGER REFERENCES model_versions(version_id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_model_versions_status ON model_versions(status);
CREATE INDEX idx_model_versions_catalog ON model_versions(catalog_id);
CREATE INDEX idx_model_versions_symbol_tf ON model_versions(symbol, timeframe);
CREATE INDEX idx_model_versions_data_hash ON model_versions(data_hash);              -- NEW: lineage queries
CREATE INDEX idx_model_versions_trained_at ON model_versions(trained_at DESC);       -- NEW: registry table sort
CREATE UNIQUE INDEX idx_model_versions_artifact ON model_versions(model_artifact_path);  -- NEW: prevents dup registration

CREATE TRIGGER trg_model_versions_updated
  AFTER UPDATE ON model_versions
  BEGIN
    UPDATE model_versions SET updated_at = CURRENT_TIMESTAMP WHERE version_id = NEW.version_id;
  END;

CREATE TABLE IF NOT EXISTS deployments (
  deployment_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id          INTEGER NOT NULL REFERENCES model_versions(version_id) ON DELETE RESTRICT,
  mode                TEXT NOT NULL CHECK (mode IN ('shadow','paper','live')),
  status              TEXT NOT NULL CHECK (status IN ('running','paused','stopped','failed')),
  symbol              TEXT NOT NULL,
  timeframe           TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  stopped_at          TEXT,
  predictions_emitted INTEGER NOT NULL DEFAULT 0,
  paper_pnl           REAL,
  last_prediction_at  TEXT,                     -- NEW: heartbeat
  last_error          TEXT,                     -- NEW: failure context
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_deployments_version ON deployments(version_id);
CREATE INDEX idx_deployments_status ON deployments(status);
CREATE INDEX idx_deployments_symbol_tf_mode ON deployments(symbol, timeframe, mode);
CREATE UNIQUE INDEX idx_deployments_one_live_per_sym_tf
  ON deployments(symbol, timeframe, mode)
  WHERE status = 'running' AND mode = 'live';   -- NEW: enforces "one live per (sym,tf)" invariant

CREATE TABLE IF NOT EXISTS promotion_gates (
  gate_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_status         TEXT NOT NULL,
  to_status           TEXT NOT NULL,
  metric              TEXT NOT NULL,
  comparator          TEXT NOT NULL CHECK (comparator IN ('>=','<=','>','<','==','!=')),
  threshold           REAL NOT NULL,
  enforced            INTEGER NOT NULL DEFAULT 1,
  description         TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_promotion_gates_transition ON promotion_gates(from_status, to_status);

INSERT INTO promotion_gates (from_status, to_status, metric, comparator, threshold, description) VALUES
  ('candidate','shadow','sharpe_after_costs','>=',0.20,'Cost-adjusted Sharpe minimum'),
  ('candidate','shadow','ece','<=',0.10,'Calibration error ceiling'),
  ('candidate','shadow','fold_dispersion','<=',0.30,'Walk-forward fold-Sharpe std cap'),
  ('shadow','paper','bootstrap_pvalue_vs_baseline','<=',0.05,'Block-bootstrap p-value vs buy-hold'),
  ('paper','live','paper_pnl_14d','>',0.0,'14-day paper PnL must be positive'),
  ('paper','live','prediction_drift','<=',0.20,'PSI drift between training and live distribution');
```

### Rollback DDL
```sql
DROP TRIGGER IF EXISTS trg_model_versions_updated;
DROP INDEX IF EXISTS idx_deployments_one_live_per_sym_tf;
DROP TABLE IF EXISTS promotion_gates;
DROP TABLE IF EXISTS deployments;
DROP TABLE IF EXISTS model_versions;
```

### FK cascade choices
- `model_versions.parent_version_id ON DELETE SET NULL` — preserves children but breaks lineage link
- `deployments.version_id ON DELETE RESTRICT` — cannot delete model version with deployment record

### Drizzle compatibility

```ts
export const modelVersions = sqliteTable('model_versions', {
  versionId: integer('version_id').primaryKey({ autoIncrement: true }),
  catalogId: text('catalog_id').notNull(),
  runnerKey: text('runner_key').notNull(),
  status: text('status', { enum: ['candidate','shadow','paper','live','retired'] }).notNull(),
  // ...
  labelConfig: text('label_config', { mode: 'json' }).$type<LabelConfig>().notNull(),
  hyperparameters: text('hyperparameters', { mode: 'json' }).$type<Record<string, number|string|boolean>>().notNull(),
  metricsSummary: text('metrics_summary', { mode: 'json' }).$type<MetricsSummary>().notNull(),
  parentVersionId: integer('parent_version_id').references((): AnySQLiteColumn => modelVersions.versionId),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  statusIdx: index('idx_model_versions_status').on(t.status),
  catalogIdx: index('idx_model_versions_catalog').on(t.catalogId),
  symbolTfIdx: index('idx_model_versions_symbol_tf').on(t.symbol, t.timeframe),
}));
```

**Tyler-facing Drizzle note:** `mode: 'json'` tells Drizzle to `JSON.stringify` on write and `JSON.parse` on read for that column. The `$type<T>()` chain doesn't change runtime behavior — just narrows TS type. The `partial unique index WHERE status='running'` cannot be expressed in Drizzle today, so it lives in raw SQL migration only.

---

## 5. Promotion Gate Evaluation Engine

**Recommendation: TS-only evaluator** at `src/server/lib/promotionGates.ts`. Reasons: all input metrics already exist in SQLite or computable from simple aggregations; avoids second Python spawn during hot UI flow; block-bootstrap p-value gets its own Python helper called via `/api/eval/block-bootstrap` (W6).

### Metric → data source map

| Gate metric | Source | How computed |
|---|---|---|
| `sharpe_after_costs` | `backtest_runs.metrics_json` | Direct read |
| `ece` | `diagnostics.json` at `model_versions.diagnostics_path` | TS reads file, parses, extracts `ece` |
| `fold_dispersion` | `diagnostics.json` `per_fold_metrics[].sharpe`, std() | TS computes population std |
| `bootstrap_pvalue_vs_baseline` | `eval_runs.bootstrap_pvalue` (NEW column) | Computed by `POST /api/eval/block-bootstrap` (W6); cached |
| `paper_pnl_14d` | `deployments.paper_pnl` for `(version_id, mode='paper')` AND `started_at >= now() - 14d` | Direct SELECT |
| `prediction_drift` | New `deployment_drift` table (W9) OR computed on-demand from QuestDB `prediction_log` PSI | Punt to W9; for W7 ship engine and seed gate as `enforced=0` |

### Engine signature
```ts
type GateResult = {
  gate: PromotionGate;
  measuredValue: number | null;
  passed: boolean;
  reason?: string;  // when measuredValue is null
};

export async function evaluateGates(
  versionId: number,
  toStatus: ModelStatus,
): Promise<{ allowed: boolean; results: GateResult[] }> { ... }
```

**Override path:** `POST /:id/promote { override: true, reason: string }` — bypasses gates but requires non-empty reason, audit-logs to `model_versions.notes` with `[OVERRIDE 2026-05-09T... by user: ...]` prefix.

---

## 6. Catalog Bridge `pickTemplate` Extension

```ts
export type TemplateId =
  | 'sklearn' | 'tree' | 'gmm'
  | 'pytorch_mlp' | 'pytorch_cnn' | 'pytorch_autoencoder' | 'pytorch_vae'
  | 'transformer_seq' | 'hmm'
  | 'composite_moe' | 'composite_stacking' | 'composite_voting' | 'composite_multimodal'
  | 'rl_dqn' | 'rl_ppo' | 'rl_a2c';

export type RunnerSource = 'wired' | 'generate' | 'browse-only';

export function pickTemplate(spec: ParsedModelSpec, template: FamilyTemplate & { id: string }): TemplateId | null {
  const name = spec.name.toLowerCase();
  const sub = spec.subcategory?.toLowerCase() ?? '';

  switch (template.id) {
    case 'sklearn':
      if (/gaussian.?mixture|^gmm\b/.test(name) || spec.id.includes('gaussian-mixture')) return 'gmm';
      if (sub === 'clustering' || /kmeans|dbscan|spectral/.test(name)) return 'sklearn';
      return 'sklearn';

    case 'xgboost': case 'lightgbm': case 'catboost':
      return 'tree';

    case 'pytorch':
      if (/variational.*autoencoder|\bvae\b/.test(name)) return 'pytorch_vae';
      if (/autoencoder/.test(name)) return 'pytorch_autoencoder';
      if (/cnn|convolutional|conv1d|conv2d/.test(name)) return 'pytorch_cnn';
      if (/lstm|gru|rnn|recurrent/.test(name)) return 'pytorch_mlp';  // RNNs ride MLP loop; body inside is variation
      return 'pytorch_mlp';

    case 'transformer':
      return 'transformer_seq';

    case 'hmm':
      return 'hmm';

    case 'reinforcement':
      if (/\bdqn\b/.test(name)) return 'rl_dqn';
      if (/\bppo\b/.test(name)) return 'rl_ppo';
      if (/\ba2c\b/.test(name)) return 'rl_a2c';
      return null;  // BROWSE-ONLY until W9

    default:
      return null;
  }
}

export function classifyRunnerSource(entry: TrainableModel, templateId: TemplateId | null): RunnerSource {
  if (entry.script && fs.existsSync(path.resolve(process.cwd(), entry.script))) return 'wired';
  if (templateId !== null) return 'generate';
  return 'browse-only';
}
```

### Vitest tests — `tests/server/catalogBridge.test.ts`

```ts
describe('pickTemplate', () => {
  it('routes Gaussian Mixture to gmm template', () => {});
  it('routes K-Means to sklearn template (clustering subcategory)', () => {});
  it('routes Variational Autoencoder to pytorch_vae before plain autoencoder match', () => {});
  it('routes 1D CNN to pytorch_cnn', () => {});
  it('routes plain MLP to pytorch_mlp default fallback', () => {});
  it('routes XGBoost/LightGBM/CatBoost specs to tree template', () => {});
  it('returns null for DQN before W9 (BROWSE-ONLY)', () => {});
});

describe('classifyRunnerSource', () => {
  it('returns wired when script path exists on disk', () => {});  // mock fs
  it('returns generate when no script but templateId resolves', () => {});
  it('returns browse-only when no script and no template', () => {});
});
```

---

## 7. SSE Channel Design — `/api/events/deployments`

### Event types (single channel, multiplexed by `deployment_id`)

```
event: deployment.started     data: { deployment_id, version_id, mode, symbol, timeframe, started_at }
event: deployment.prediction  data: { deployment_id, ts, prediction, confidence, paper_pnl_delta?, paper_pnl_total? }
event: deployment.pnl_update  data: { deployment_id, paper_pnl_total, predictions_emitted, last_prediction_at }
event: deployment.paused      data: { deployment_id, paused_at }
event: deployment.resumed     data: { deployment_id, resumed_at }
event: deployment.stopped     data: { deployment_id, stopped_at, reason? }
event: deployment.failed      data: { deployment_id, failed_at, error: string }
event: heartbeat              data: { ts }                       (every 15s)
```

**Single channel** for all deployments. Frontend filters by `deployment_id`. Reasoning: low-volume (10+ active live deployments × 1-2 preds/tf/sym = ~10 events/sec max); per-deployment channels would explode connection count.

### Brotli buffering — KNOWN BUG

The plan claims "the 2026-05-04 fix already extended the compression filter to skip `/events/` paths". **This is false.** Reading `src/server/main.ts` lines 78-85, the filter only excludes `/stream/`:

```ts
filter: (req: Request) => {
  if (req.path.includes('/stream/')) return false;  // only this
  if (process.env.NODE_ENV === 'production' && req.path.startsWith('/assets/')) return false;
  return true;
},
```

`/api/events/deployments` and `/api/events/agents/*` will be gzip-buffered today, breaking SSE flush semantics. **W7 must extend the filter:**

```ts
if (req.path.includes('/stream/') || req.path.includes('/events/')) return false;
```

Add Vitest asserting `content-encoding` header is absent.

---

## 8. Agent Dispatch Route Design

### Route shape
```
POST /api/agents/dispatch          { agentId, contextBlob } → 202 { runId }
GET  /api/agents/runs/:runId       → { runId, agentId, status, output?, error? }
GET  /api/events/agents/:runId     SSE stream of agent.* events
```

### Job queue + persistence

```ts
const queue: Map<string, AgentJob> = new Map();
const MAX_CONCURRENT = 2;  // Claude SDK rate-limited
let runningCount = 0;
```

- `dispatch()` writes row to `agent_runs`, enqueues, returns `runId`.
- Scheduler tick: pop queued jobs while `runningCount < MAX_CONCURRENT`.
- Running job spawns Claude Agent SDK call; on completion writes `output` JSON column.
- On server crash: `agent_runs.status='running'` rows get marked `'failed', error='server restart'` on boot.

### `agent_runs` table — `migrations/0003_agent_runs.sql`
```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id              TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL CHECK (agent_id IN ('feature-curator','arch-designer','hpo-strategist','eval-reviewer')),
  status              TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  context_blob        TEXT NOT NULL,
  context_blob_hash   TEXT NOT NULL,
  requested_at        TEXT NOT NULL,
  started_at          TEXT,
  completed_at        TEXT,
  output              TEXT,
  error               TEXT,
  cancelled_reason    TEXT,
  duration_ms         INTEGER,
  token_usage         TEXT
);
CREATE INDEX idx_agent_runs_agent_status ON agent_runs(agent_id, status);
CREATE INDEX idx_agent_runs_requested_at ON agent_runs(requested_at DESC);
CREATE INDEX idx_agent_runs_context_hash ON agent_runs(context_blob_hash);
```

### Context blob assembly per agent (server-side)

| Agent | Frontend sends | Server adds |
|---|---|---|
| feature-curator | `{ symbol, timeframe, dataPreviewId, currentPipeline }` | data preview JSON, redundant-pair findings |
| arch-designer | `{ catalogId, symbol, tf, hyperparams }` | catalog spec full text, label distribution, n_samples |
| hpo-strategist | `{ catalogId, labelStrategy, n_train }` | catalog spec hyperparam sensitivity hints, current `defaultSearchSpace` |
| eval-reviewer | `{ experimentIds: number[] }` | comparison matrix (joined `backtest_runs` + `diagnostics.json`), regime breakdown |

### Streaming back to frontend
SSE `GET /api/events/agents/:runId`. Reconnect sends synthesized `agent.replay` event with everything emitted so far (read from per-run in-memory ring buffer).

---

## 9. Specialist Dispatch Plan

| Phase | Specialist | Scope |
|---|---|---|
| W1 | be-api | Codegen routes; Zod schemas; `codeGenerator.ts` TS wrapper with LRU + spawn |
| W1 | be-events | Generated event parser at `parsers/generated.ts`; verify generic `epoch_metric` events flow through SSE protocol |
| W2 | be-api | `/api/model-catalog/trainable` route; `pickTemplate`/`runnerSource` extension to `catalogBridge.ts`; Vitest coverage; parser extension for `class_name`/`module_path` |
| W7 | be-drizzle | Drizzle schema additions for `modelVersions`, `deployments`, `promotionGates`; FK cascade syntax in SQLite dialect |
| W7 | be-db | `migrations/0002_model_registry.sql` forward + down; partial unique index for one-live-per-symbol-tf; trigger for `updated_at` |
| W7 | be-api | Routes `registry.ts` + `deployments.ts`; promotion gate evaluation engine; Zod request validation |
| W7 | be-events | `/api/events/deployments` SSE channel; **fix compression filter** to exclude `/events/` paths |
| W8 | be-db | `migrations/0003_agent_runs.sql` |
| W8 | be-drizzle | `agentRuns` Drizzle schema |
| W8 | be-api | `/api/agents/dispatch`, `/api/agents/runs/:id` routes; `agentDispatcher.ts` job queue; Claude Agent SDK integration |
| W8 | be-events | `/api/events/agents/:runId` SSE; per-run ring buffer for reconnect replay |
| W9 | be-api | `mlbridgeClient.ts` ZMQ wrapper; deployment lifecycle handlers; `ENABLE_LIVE_DEPLOY` env gate |
| W9 | be-events | Per-bar prediction emission; paper PnL accrual events |
| W9 | infra-questdb | `prediction_log` table DDL + ILP write path (cross-domain dispatch) |

---

## 10. Backend-Side Risks Not in Section 12

| Risk | Severity | Mitigation |
|---|---|---|
| **Compression filter does NOT skip `/events/` despite plan claim** | High | 1-line fix in `main.ts` filter; Vitest assertion. Land in W7 with deployments route. |
| Generated `runners.json` entries never round-trip through git | Medium | Append-only insertion; never re-sort; preserve `metadata.notes`; backup sibling file (rotate top 10) |
| Two browser tabs concurrently click "Save & train" with same `(catalogId, hpHash)` | Medium | File lock via `portalocker`; second writer blocks 5s then errors. Frontend disables button while in flight. |
| Drizzle SQLite cannot express partial unique indexes | Low | Document in schema.ts; add runtime assertion in `POST /api/deployments` that re-queries before insert |
| `reloadConfigs()` in production blocks event loop briefly | Low | ~10-30ms per save. Acceptable. If profiling shows up, switch to async fs.readFile. |
| Agent SDK rate limits not surfaced to user | Medium | Catch SDK 429s, write to `agent_runs.error` with `{code:'rate_limit', retry_after}`, surface as toast |
| MLBridge ZMQ socket dies mid-deployment | High | Heartbeat thread every 5s; on 3 missed pongs, mark `failed` + emit `deployment.failed`; auto-attempt reconnect once |
| `prediction_log` QuestDB table may not exist on first live deploy | Medium | Idempotent `CREATE TABLE IF NOT EXISTS` on first deployment; or scripts/init-prediction-log.sql in W9 |
| `model_versions.diagnostics_path` can be relative or absolute | Low | Reuse `path.isAbsolute(...) ? p : path.join(cwd, p)` pattern from `pythonRunner.ts:32-34` |
| Stale `agent_runs.status='running'` after server crash | Medium | On boot, `UPDATE agent_runs SET status='failed', error='server restart' WHERE status IN ('queued','running')` |
| No webhook idempotency needed | N/A | Confirmed — all triggers are user-initiated UI clicks; no external untrusted senders |

---

**Authored:** 2026-05-09 by backend-lead. Validated against: `catalogBridge.ts`, `registry.ts`, `orchestrator.ts`, `pythonRunner.ts`, `routes/modelCatalog.ts`, `main.ts` compression filter, `runners.json` schema, `trainingTypes.ts`.
