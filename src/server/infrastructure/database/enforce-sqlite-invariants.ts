/**
 * SQLite Invariant Enforcement — CHECK constraints + partial unique index
 * that Drizzle-kit cannot express.
 *
 * ROOT CAUSE (audit AUD-008): `npm run db:push` (drizzle-kit push) is the
 * ONLY wired DB-build script in this project (see migrations/README.md).
 * `push` introspects `src/shared/schema.ts` and emits its OWN CREATE TABLE
 * DDL from that introspection. Drizzle SQLite has no CHECK-constraint API
 * and no partial-index (`WHERE` clause on `CREATE INDEX`) API — see the
 * comments directly above `modelVersions` / `deployments` / `agentRuns` in
 * schema.ts. That means `db:push` can create the correct COLUMNS on
 * `model_versions`, `deployments`, `promotion_gates`, and `agent_runs`, but
 * can never create:
 *   - the CHECK constraints on their enum-shaped text columns (status,
 *     mode, comparator, agent_id), or
 *   - the partial UNIQUE index `idx_deployments_one_live_per_sym_tf` that
 *     enforces "at most one RUNNING LIVE deployment per (symbol,
 *     timeframe)".
 *
 * The authoritative source for both is the hand-written raw SQL in
 * `migrations/0002_model_registry.sql` and `migrations/0003_agent_runs.sql`
 * — this module reproduces that exact DDL text idempotently, either by
 * creating the table fresh (if `db:push` hasn't created it yet) or by
 * retrofitting an already-existing (CHECK-less) table using SQLite's
 * documented 12-step "Making Other Kinds Of Table Schema Changes"
 * procedure: https://www.sqlite.org/lang_altertable.html#otheralter
 *
 * WHY THIS RUNS ON EVERY CONNECTION OPEN, NOT JUST ONCE: `db:push` does not
 * track or preserve hand-added CHECK constraints. If schema.ts ever gains a
 * new column on one of these tables, a future `db:push` run may recreate
 * the table from its own (CHECK-less) DDL, silently dropping the
 * constraint again. Calling `enforceSqliteInvariants()` from `db.ts` on
 * every process boot (see call site) makes the guarantee self-healing
 * instead of a one-time fix that quietly rots.
 */
import type Database from "better-sqlite3";

interface RebuildableTable {
  /** Table name as it appears in sqlite_master. */
  name: string;
  /**
   * Exact `CREATE TABLE IF NOT EXISTS ...` DDL, including CHECK constraints,
   * verbatim from the authoritative migrations/000{2,3}_*.sql source.
   */
  createSql: string;
  /** Full column list, in DDL order, for explicit INSERT...SELECT during rebuild. */
  columns: string[];
  /** Secondary index / trigger DDL to (re)create after a fresh-create or rebuild. Each entry uses IF NOT EXISTS. */
  auxSql: string[];
  /** Seed-data INSERTs to run ONLY the first time the table is created (never re-run against an existing table). */
  seedSql?: string[];
}

const MODEL_VERSIONS: RebuildableTable = {
  name: "model_versions",
  createSql: `
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
      label_config        TEXT NOT NULL,
      hyperparameters     TEXT NOT NULL,
      walk_forward_config TEXT,
      hpo_study_id        TEXT,
      model_artifact_path TEXT NOT NULL,
      diagnostics_path    TEXT NOT NULL,
      metrics_summary     TEXT NOT NULL,
      trained_at          TEXT NOT NULL,
      promoted_at         TEXT,
      retired_at          TEXT,
      parent_version_id   INTEGER REFERENCES model_versions(version_id) ON DELETE SET NULL,
      notes               TEXT,
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  columns: [
    "version_id", "catalog_id", "runner_key", "status", "data_hash", "symbol",
    "timeframe", "date_range_start", "date_range_end", "feature_pipeline",
    "label_config", "hyperparameters", "walk_forward_config", "hpo_study_id",
    "model_artifact_path", "diagnostics_path", "metrics_summary", "trained_at",
    "promoted_at", "retired_at", "parent_version_id", "notes", "created_at", "updated_at",
  ],
  auxSql: [
    `CREATE INDEX IF NOT EXISTS idx_model_versions_status ON model_versions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_model_versions_catalog ON model_versions(catalog_id)`,
    `CREATE INDEX IF NOT EXISTS idx_model_versions_symbol_tf ON model_versions(symbol, timeframe)`,
    `CREATE INDEX IF NOT EXISTS idx_model_versions_data_hash ON model_versions(data_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_model_versions_trained_at ON model_versions(trained_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_artifact ON model_versions(model_artifact_path)`,
    `CREATE TRIGGER IF NOT EXISTS trg_model_versions_updated
       AFTER UPDATE ON model_versions
       BEGIN
         UPDATE model_versions SET updated_at = CURRENT_TIMESTAMP WHERE version_id = NEW.version_id;
       END`,
  ],
};

const DEPLOYMENTS: RebuildableTable = {
  name: "deployments",
  createSql: `
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
      last_prediction_at  TEXT,
      last_error          TEXT,
      notes               TEXT,
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  columns: [
    "deployment_id", "version_id", "mode", "status", "symbol", "timeframe",
    "started_at", "stopped_at", "predictions_emitted", "paper_pnl",
    "last_prediction_at", "last_error", "notes", "created_at",
  ],
  auxSql: [
    `CREATE INDEX IF NOT EXISTS idx_deployments_version ON deployments(version_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`,
    `CREATE INDEX IF NOT EXISTS idx_deployments_symbol_tf_mode ON deployments(symbol, timeframe, mode)`,
    // Partial unique index — enforced unconditionally at the end of
    // enforceSqliteInvariants() too, but listed here so a fresh-create or a
    // rebuild-triggered index cascade-drop always restores it in the same pass.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_one_live_per_sym_tf
       ON deployments(symbol, timeframe, mode)
       WHERE status = 'running' AND mode = 'live'`,
  ],
};

const PROMOTION_GATES: RebuildableTable = {
  name: "promotion_gates",
  createSql: `
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
    )`,
  columns: [
    "gate_id", "from_status", "to_status", "metric", "comparator",
    "threshold", "enforced", "description", "created_at",
  ],
  auxSql: [
    `CREATE INDEX IF NOT EXISTS idx_promotion_gates_transition ON promotion_gates(from_status, to_status)`,
  ],
  seedSql: [
    `INSERT INTO promotion_gates (from_status, to_status, metric, comparator, threshold, description) VALUES
       ('candidate','shadow','sharpe_after_costs','>=',0.20,'Cost-adjusted Sharpe minimum'),
       ('candidate','shadow','ece','<=',0.10,'Calibration error ceiling'),
       ('candidate','shadow','fold_dispersion','<=',0.30,'Walk-forward fold-Sharpe std cap'),
       ('shadow','paper','bootstrap_pvalue_vs_baseline','<=',0.05,'Block-bootstrap p-value vs buy-hold'),
       ('paper','live','paper_pnl_14d','>',0.0,'14-day paper PnL must be positive'),
       ('paper','live','prediction_drift','<=',0.20,'PSI drift between training and live distribution')`,
  ],
};

const AGENT_RUNS: RebuildableTable = {
  name: "agent_runs",
  createSql: `
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
    )`,
  columns: [
    "run_id", "agent_id", "status", "context_blob", "context_blob_hash",
    "requested_at", "started_at", "completed_at", "output", "error",
    "cancelled_reason", "duration_ms", "token_usage",
  ],
  auxSql: [
    `CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_status ON agent_runs(agent_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runs_requested_at ON agent_runs(requested_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runs_context_hash ON agent_runs(context_blob_hash)`,
  ],
};

/**
 * generated_labels — the label-set lifecycle stage (2026-09-26). `stage` is a
 * plain TEXT column to Drizzle; the CHECK below is what keeps a typo out of the
 * ladder. The `columns` list must be the full current list: the rebuild copies
 * exactly these and silently drops anything left out.
 */
const GENERATED_LABELS: RebuildableTable = {
  name: "generated_labels",
  createSql: `
    CREATE TABLE IF NOT EXISTS generated_labels (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id             INTEGER REFERENCES ml_models(id) ON DELETE SET NULL,
      name                 TEXT NOT NULL,
      generator_type       TEXT NOT NULL,
      category             TEXT NOT NULL,
      symbol               TEXT NOT NULL,
      config               TEXT NOT NULL,
      sample_count         INTEGER NOT NULL DEFAULT 0,
      positive_count       INTEGER,
      negative_count       INTEGER,
      neutral_count        INTEGER,
      label_distribution   TEXT,
      data_start_timestamp INTEGER,
      data_end_timestamp   INTEGER,
      parquet_path         TEXT,
      status               TEXT NOT NULL DEFAULT 'pending',
      error_message        TEXT,
      generation_time_ms   INTEGER,
      recipe               TEXT,
      parameters_hash      TEXT,
      timeframe_minutes    INTEGER NOT NULL DEFAULT 1,
      stage                TEXT NOT NULL DEFAULT 'specified'
                             CHECK (stage IN ('specified','generated','validated','landed','cataloged','consumed','stale','retired')),
      validation           TEXT,
      validated_at         INTEGER,
      source_fingerprint   TEXT,
      max_horizon_bars     INTEGER,
      purge_bars           INTEGER,
      embargo_bars         INTEGER,
      landed_at            INTEGER,
      retired_at           INTEGER,
      stale_detected_at    INTEGER,
      stale_reason         TEXT,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
  columns: [
    "id", "model_id", "name", "generator_type", "category", "symbol", "config", "sample_count",
    "positive_count", "negative_count", "neutral_count", "label_distribution",
    "data_start_timestamp", "data_end_timestamp", "parquet_path", "status", "error_message",
    "generation_time_ms", "recipe", "parameters_hash", "timeframe_minutes", "stage", "validation",
    "validated_at", "source_fingerprint", "max_horizon_bars", "purge_bars", "embargo_bars",
    "landed_at", "retired_at", "stale_detected_at", "stale_reason", "created_at", "updated_at",
  ],
  auxSql: [
    // A rebuild's DROP TABLE takes every index with it, so the ones schema.ts
    // declares are re-created here or they vanish the first time this runs.
    `CREATE INDEX IF NOT EXISTS generated_labels_model_id_idx ON generated_labels(model_id)`,
    `CREATE INDEX IF NOT EXISTS generated_labels_generator_type_idx ON generated_labels(generator_type)`,
    `CREATE INDEX IF NOT EXISTS generated_labels_symbol_idx ON generated_labels(symbol)`,
    `CREATE INDEX IF NOT EXISTS generated_labels_status_idx ON generated_labels(status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS generated_labels_recipe_idx ON generated_labels(recipe)`,
    `CREATE INDEX IF NOT EXISTS generated_labels_stage_idx ON generated_labels(stage)`,
  ],
};

const TABLES: RebuildableTable[] = [MODEL_VERSIONS, DEPLOYMENTS, PROMOTION_GATES, AGENT_RUNS, GENERATED_LABELS];

/** Reads the exact DDL SQLite stored for a table (undefined if the table doesn't exist). */
function getTableSql(sqlite: Database.Database, tableName: string): string | undefined {
  const row = sqlite
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { sql: string } | undefined;
  return row?.sql;
}

/** True if the stored CREATE TABLE text already contains a CHECK constraint. */
function hasCheckConstraint(createTableSql: string): boolean {
  return /\bCHECK\s*\(/i.test(createTableSql);
}

/**
 * Retrofits CHECK constraints onto an existing (CHECK-less) table using
 * SQLite's documented 12-step procedure. Preserves every row, in a single
 * atomic transaction. Caller must have already set `PRAGMA foreign_keys = OFF`.
 */
function rebuildTableWithChecks(sqlite: Database.Database, table: RebuildableTable): void {
  const tmpName = `${table.name}__rebuild_tmp`;
  const tmpCreateSql = table.createSql.replace(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table.name}\\b`),
    `CREATE TABLE ${tmpName}`
  );
  const columnList = table.columns.join(", ");

  const rebuild = sqlite.transaction(() => {
    sqlite.exec(tmpCreateSql);
    sqlite.exec(
      `INSERT INTO ${tmpName} (${columnList}) SELECT ${columnList} FROM ${table.name}`
    );
    sqlite.exec(`DROP TABLE ${table.name}`);
    sqlite.exec(`ALTER TABLE ${tmpName} RENAME TO ${table.name}`);
  });
  rebuild();
}

export interface InvariantEnforcementResult {
  table: string;
  action: "created" | "rebuilt" | "already-compliant" | "skipped-no-base-table";
}

/**
 * Idempotently ensures CHECK constraints on model_versions / deployments /
 * promotion_gates / agent_runs, and the partial unique index on
 * deployments, exist on the given SQLite connection. Safe to call on every
 * process boot. Returns a per-table action log for diagnostics/tests.
 */
export function enforceSqliteInvariants(sqlite: Database.Database): InvariantEnforcementResult[] {
  const results: InvariantEnforcementResult[] = [];
  const fkWasOn = (sqlite.pragma("foreign_keys", { simple: true }) as number) === 1;
  if (fkWasOn) sqlite.pragma("foreign_keys = OFF");

  try {
    for (const table of TABLES) {
      const existingSql = getTableSql(sqlite, table.name);

      if (!existingSql) {
        // Fresh create — createSql already embeds the CHECK constraints.
        sqlite.exec(table.createSql);
        for (const aux of table.auxSql) sqlite.exec(aux);
        results.push({ table: table.name, action: "created" });
      } else if (!hasCheckConstraint(existingSql)) {
        rebuildTableWithChecks(sqlite, table);
        for (const aux of table.auxSql) sqlite.exec(aux);
        results.push({ table: table.name, action: "rebuilt" });
      } else {
        // Already has the CHECK constraint — still defensively ensure aux
        // objects (indexes/trigger/partial index) exist, cheap no-op otherwise.
        for (const aux of table.auxSql) sqlite.exec(aux);
        results.push({ table: table.name, action: "already-compliant" });
      }

      // Seed on ROW COUNT, not on which branch ran above: in the realistic
      // boot sequence `db:push` always creates these tables (columns-only,
      // no CHECK) BEFORE this hook ever runs, so the "fresh create" branch
      // above never fires in practice — seeding must not be gated on it, or
      // promotion_gates' 6 default rows would never get inserted at all.
      if (table.seedSql && table.seedSql.length > 0) {
        const { count } = sqlite
          .prepare(`SELECT COUNT(*) as count FROM ${table.name}`)
          .get() as { count: number };
        if (count === 0) {
          for (const seed of table.seedSql) sqlite.exec(seed);
        }
      }
    }

    // Belt-and-suspenders: the partial unique index is also declared in
    // DEPLOYMENTS.auxSql above, but re-assert it unconditionally in case a
    // future table entry order change ever separates it from that list.
    sqlite.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_one_live_per_sym_tf
         ON deployments(symbol, timeframe, mode)
         WHERE status = 'running' AND mode = 'live'`
    );

    if (fkWasOn) {
      const violations = sqlite.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `enforceSqliteInvariants: foreign_key_check found ${violations.length} violation(s) after rebuild: ${JSON.stringify(violations)}`
        );
      }
    }
  } finally {
    if (fkWasOn) sqlite.pragma("foreign_keys = ON");
  }

  return results;
}
