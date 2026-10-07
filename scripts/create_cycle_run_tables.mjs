/**
 * Create the Model Cycle run entity tables (2026-10-07) in the working SQLite
 * database without `drizzle-kit push`, which refuses while another in-flight
 * schema change (`feature_types.name`) would drop data. The DDL mirrors
 * `packages/shared/src/schema.ts` exactly; `db:push` is a no-op for these once run.
 *
 *   node scripts/create_cycle_run_tables.mjs [path/to/database.db]
 */
import Database from "better-sqlite3";
import path from "node:path";

const file = process.argv[2] ?? path.join(process.cwd(), "data", "ml_dashboard.db");
const db = new Database(file);
db.pragma("foreign_keys = ON");

const statements = [
  `CREATE TABLE IF NOT EXISTS cycle_runs (
    run_id TEXT PRIMARY KEY NOT NULL,
    model_key TEXT NOT NULL,
    model_type TEXT NOT NULL,
    model_label TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','complete','failed','stopped')),
    error TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    parent_run_id TEXT REFERENCES cycle_runs(run_id) ON DELETE SET NULL,
    data_start INTEGER NOT NULL,
    data_end INTEGER NOT NULL,
    bar_count INTEGER NOT NULL,
    fold_count INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS cycle_runs_model_idx ON cycle_runs (model_key, symbol, timeframe)`,
  `CREATE INDEX IF NOT EXISTS cycle_runs_started_idx ON cycle_runs (started_at)`,
  `CREATE TABLE IF NOT EXISTS cycle_run_configurations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES cycle_runs(run_id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('base','fold')),
    fold_index INTEGER,
    parameter_name TEXT NOT NULL,
    parameter_value TEXT,
    value_type TEXT NOT NULL CHECK (value_type IN ('number','string','boolean','null')),
    source TEXT NOT NULL CHECK (source IN ('manual','tuned','reviewed_defaults'))
  )`,
  `CREATE INDEX IF NOT EXISTS cycle_run_configurations_run_idx ON cycle_run_configurations (run_id, scope, fold_index)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cycle_run_configurations_one_value_idx ON cycle_run_configurations (run_id, scope, fold_index, parameter_name)`,
  `CREATE TABLE IF NOT EXISTS cycle_run_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES cycle_runs(run_id) ON DELETE CASCADE,
    setting_name TEXT NOT NULL,
    setting_value TEXT,
    value_type TEXT NOT NULL CHECK (value_type IN ('number','string','boolean','null'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cycle_run_settings_one_idx ON cycle_run_settings (run_id, setting_name)`,
  `CREATE TABLE IF NOT EXISTS cycle_run_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES cycle_runs(run_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    feature_name TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cycle_run_features_one_idx ON cycle_run_features (run_id, position)`,
  `CREATE TABLE IF NOT EXISTS cycle_run_verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES cycle_runs(run_id) ON DELETE CASCADE,
    rule TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical','warning','pass')),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    evidence TEXT NOT NULL,
    action TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS cycle_run_verdicts_run_idx ON cycle_run_verdicts (run_id)`,
  `CREATE INDEX IF NOT EXISTS cycle_run_verdicts_rule_idx ON cycle_run_verdicts (rule)`,
  `CREATE TABLE IF NOT EXISTS saved_analytics (
    analytics_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('comparison','chart','query')),
    definition TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS saved_analytics_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analytics_id TEXT NOT NULL REFERENCES saved_analytics(analytics_id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    position INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS saved_analytics_runs_one_idx ON saved_analytics_runs (analytics_id, run_id)`,
];

const apply = db.transaction(() => {
  for (const statement of statements) db.prepare(statement).run();
});
apply();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('cycle_runs','cycle_run_configurations','cycle_run_settings','cycle_run_features','cycle_run_verdicts','saved_analytics','saved_analytics_runs') ORDER BY name").all();
console.log(`${file}: ${tables.map((row) => row.name).join(", ")}`);
db.close();
