# Data platform and lifecycles for AI Studio and Analytics

**Asked (Tyler, 2026-10-07 12:55):** Analytics must be able to produce any chart, metric or graph for the model that is running; a system that saves every variable; databases that capture all the data, with entity tables and normalisation (1NF–3NF); a store per job (Postgres for relational, TimescaleDB for time series, DuckDB in-process for analytics, SQLite or another in-process relational store, pgvector / DuckDB vectors, Redis); and the lifecycles planned out: save-configuration, analytics, model, memory management, model development — so that when he asks for a model to be made or changed it shows on the dashboard, with the configuration visible there.

**Done today:** the run page has a **Configuration** section (`runs/Configuration.tsx`, `RunView.configuration` from `configurationOf()`): the model's base hyperparameters, the run's settings (label, purge/embargo, trading rule, search budget, device, data window), the cost model, the feature list, and a per-fold table of what each fold fitted with, the search's changes in orange, the source of each choice in words. Every number is the engine's own plan and `cycle_parameters` events — nothing typed in twice.

## 1. Where every variable lives today, and the recommendation

| Store | Holds today | Verdict |
| --- | --- | --- |
| **Iceberg lake (`E:\lake`, read by DuckDB in-process)** | bars / ticks / quotes / book, every derived dataset, the Model Cycle record: eight tables per run (`runs`, `bars`, `predictions`, `trades`, `folds`, `epochs`, `trials`, `metrics`) + seven report tables | **The system of record. Keep.** It already captures every variable the engine logs; `derived_model_cycle_runs_<table>` is queryable by the dashboard's DuckDB and by any notebook. |
| **SQLite (`data/ml_dashboard.db`, 37 tables, Drizzle)** | sessions, model registry, versions, deployments, labels ledger, instruments | **The relational store. Keep.** In-process, no server, ACID, already 3NF for the entities it holds (`training_sessions`, `model_versions`, `deployments` with CHECK constraints). |
| **Files beside artifacts (`data/models/<run>/`)** | weights, explain arrays, `terminal.jsonl`, `loss_surfaces.json`, `diagnostics.json` | Keep for blobs; index them from SQLite (below). |
| Postgres + pgvector / TimescaleDB | `pg_schema.ts` / `pg_db.ts` exist, nothing runs on them | **Do not add now.** A server to start, health-check and back up, for data the lake and SQLite already hold; TimescaleDB would be a second copy of the bars. The standing rule is one source of truth and no database process. |
| Redis | nothing | **Do not add now.** The only cache need (the run list, the report tables) is in-process and already bounded. |
| Vectors | `shared/layout/EmbeddingScatter.tsx` and the removed LanceDB branch | **DuckDB** when a vector index is needed (`vss` extension, in-process) over embeddings landed in the lake — no new server. |

So the platform is **lake for every measured series, SQLite for every entity, files for blobs** — three tiers the dashboard already runs, each in-process. Postgres/Timescale/Redis are a product decision to revisit only when a second machine has to read the same state; nothing in the lifecycles below needs them.

## 2. Entity tables (3NF) — what is missing in SQLite

The run record is in the lake but the dashboard's *entities* around a run are not all in SQLite yet. Add, each keyed by its own id with foreign keys and no repeating groups:

- `runs` — `run_id` (PK), `model_key` (FK → model registry), `symbol`, `timeframe`, `started_at`, `finished_at`, `status`, `name` (the memorable name, stored once instead of re-derived), `version` (ordinal per model·symbol·timeframe, stored at start so it never shifts), `purpose`.
- `run_configurations` — `run_id` (FK), `scope` (`base` | `fold`), `fold_index` (null for base), `parameter_name`, `parameter_value` (text) , `value_type`, `source` (`manual` | `tuned` | `reviewed_defaults`). One row per parameter: 1NF, and a query can ask "every run where max_depth > 6".
- `run_settings` — the plan's settings as rows (`run_id`, `setting_name`, `setting_value`): label horizon, purge, embargo, trading rule, device, data window.
- `run_features` — `run_id`, `feature_name`, `position`.
- `run_verdicts` — `run_id`, `rule`, `severity`, `category`, `evidence`, `action` (so the Analytics tab can ask "how often does `one_direction` fire for transformers").
- `saved_analytics` — `analytics_id`, `name`, `kind` (`comparison` | `chart` | `query`), `definition` (JSON), `created_at`; `saved_analytics_runs` (`analytics_id`, `run_id`) replaces the flat `runIds` list in `data/analytics/comparisons.json`.

Normalisation: every table has a single-column key, every non-key column depends on the whole key and nothing but the key (configuration values are rows, not a JSON blob; the feature list is rows; verdicts are rows). The lake keeps the wide, time-indexed tables (bars, predictions, epochs) — the warehouse shape, served by DuckDB — and SQLite keeps the entities.

## 3. Lifecycles

**Save-configuration.** On `cycle_plan` the server writes `runs`, `run_settings`, `run_features` and the `base` rows of `run_configurations`; on each `cycle_parameters` it writes that fold's rows. Every configuration is therefore in SQLite before the first fit, and the Configuration section reads from the same rows after a restart. A configuration can be re-launched (`POST /api/runs` with `{ "from": "<run_id>", "parameters": { ...overrides } }`) and the new run records its parent (`runs.parent_run_id`).

**Analytics.** A chart or metric on the Analytics tab is a *definition* (which runs, which panel, which parameters: fold, role, metric) saved in `saved_analytics`; its data is always recomputed from the lake record and `RunView`, never stored, so it cannot go stale. "Any chart for the running model": every panel component takes `RunView`, and the live view polls, so a saved chart over a running run updates on its own.

**Model.** The registry (`packages/config/cycle_models/<key>.json`) is the source of a model's existence; `model_versions` in SQLite is its lifecycle (spec → trainable → trained → lens-ready → deployed, `catalogLifecycle.ts`). A run's `model_key` and the registry file's hash are recorded on `runs`, so a run can be matched to the exact registry text it ran under.

**Memory management.** Live state is bounded: the accumulator keeps 5 runs (`MAX_TRACKED_RUNS`), 5,000 terminal lines, 1,000-event SSE ring; the client keeps 6,000 lines; the report cache 24 runs; feature parquet cache 2 GB LRU. The rule: anything a page needs after a restart must be in the lake, SQLite or the artifact directory — memory is a cache, never the record. The purge (`scripts/purge_cycle_runs.py`) is the only deletion path and removes all three tiers together.

**Model development.** When Tyler asks for a model to be made or changed: (1) the registry file is written or edited (`packages/config/cycle_models/<key>.json` — parameters, search space, explain kind), (2) the adapter module if the kind is new (`cycle/adapters_extra/`, `cycle/networks_extra/`), (3) its contract test (`test_cycle_catalog_contract.py`) is run, (4) the catalog page and the launcher list it on the next load (both read the registry), (5) a smoke launch through `POST /api/runs` proves it fits, and the run's Configuration section shows the parameters the registry declares. A model change is a new registry hash; runs record which hash they ran under, so old runs are never silently re-labelled.

## 4. Done the same day (2026-10-07)

1. **Entities** — `cycle_runs`, `cycle_run_configurations`, `cycle_run_settings`, `cycle_run_features`, `cycle_run_verdicts`, `saved_analytics`, `saved_analytics_runs` in `packages/shared/src/schema.ts`; created in the working database by `scripts/create_cycle_run_tables.mjs` (drizzle-kit push refuses while another in-flight schema change would drop a column). Writers in `apps/api/training/runRecords.ts`, called from the accumulator (`training/cycle.ts`) on `cycle_plan` (run row with its fixed name and version, settings, features, base parameters), `cycle_parameters` (per-fold rows) and the end (status, verdicts). Verified: a 2-fold XGBoost run wrote 1 run, 8 base + 8 + 8 fold parameter rows, 33 settings, 38 features, 8 verdicts.
2. **Relaunch** — `POST /api/runs { "from": "<run_id>", ...overrides }` starts from the recorded model, series, window, launch settings (fold limit, trials, label, trading rule, pinned names) and base hyperparameters; the child records `parent_run_id`, the view carries `lineage`, the header says "relaunched from <name>", and the Configuration section has a "Relaunch with these settings" button. Verified: the child inherited 2 folds and 2 trials, took the override, and became v3 of its line.
3. **Saved analytics** — `/api/runs/comparisons` reads and writes `saved_analytics` (kind `comparison`) through `apps/api/training/savedAnalytics.ts`; `data/analytics/comparisons.json` is gone.
4. `scripts/purge_cycle_runs.py --apply` now clears all three tiers (lake record, artifacts, SQLite rows).

**Still open:** the per-family panels in `docs/plans/2026-10-06-studio-analytics-components.md` (attention, cluster graph, gate routing, stream contribution) — each needs its engine artifact first.
