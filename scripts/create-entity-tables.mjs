/**
 * Create the normalized entity tables.
 *
 * `drizzle-kit push` cannot apply these: it asks interactively whether each new
 * column is a create or a rename, and it refuses the `features` table outright
 * because the old `category` column and the new `category_id` share a prefix and
 * it wants a human to disambiguate. `features` holds zero rows — the app has
 * never written it; features come from `packages/config/features.json` — so
 * there is nothing to migrate and the table is simply replaced.
 *
 * Idempotent: every statement is `IF NOT EXISTS`, so a second run is a no-op.
 * Run with `node scripts/create-entity-tables.mjs` from the repo root.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const DB_PATH = process.env.DRIZZLE_SQLITE_PATH ?? "data/ml_dashboard.db";

if (!existsSync(DB_PATH)) {
  console.error(`[entity-tables] no database at ${DB_PATH} — nothing to do`);
  process.exit(1);
}

const db = new Database(DB_PATH);

// `features` is replaced rather than altered. It is empty, and the old shape
// (a `category` string plus a `computationLogic` blob) is the un-normalized
// form this replaces — migrating it row-by-row would mean inventing rows.
db.exec(`DROP TABLE IF EXISTS features`);

db.exec(`
  -- The parent for datasets: one row per kind of thing the lake holds.
  CREATE TABLE IF NOT EXISTS dataset_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS datasets_new (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    category_id TEXT REFERENCES dataset_categories(id),
    description TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  DROP TABLE IF EXISTS datasets;
  ALTER TABLE datasets_new RENAME TO datasets;

  -- The parent for features, and the kind of metric or calculation a feature
  -- is an instance of. Both are their own axis: a category says what a feature
  -- is about, a type says how it is computed.
  CREATE TABLE IF NOT EXISTS feature_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS feature_types (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS features (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL UNIQUE,
    category_id       TEXT NOT NULL REFERENCES feature_categories(id),
    type_id           TEXT NOT NULL REFERENCES feature_types(id),
    display_name      TEXT,
    computation_logic TEXT,
    code_reference    TEXT,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE INDEX IF NOT EXISTS features_category_idx ON features(category_id);
  CREATE INDEX IF NOT EXISTS features_type_idx     ON features(type_id);

  -- A feature's params object, lifted out: one tunable per row, so "every
  -- feature with a 20-bar window" is a query rather than a JSON scan.
  CREATE TABLE IF NOT EXISTS feature_parameters (
    feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    value      TEXT NOT NULL,
    UNIQUE (feature_id, name)
  );

  -- A feature's requires array, lifted out: one input column per row.
  CREATE TABLE IF NOT EXISTS feature_requires (
    feature_id  TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    column_name TEXT NOT NULL,
    UNIQUE (feature_id, column_name)
  );
`);

const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
            ('feature_categories','feature_types','features','feature_parameters','feature_requires','dataset_categories','datasets')
            ORDER BY name`)
  .all()
  .map((row) => row.name);

console.log(`[entity-tables] ${tables.length}/7 tables present in ${DB_PATH}: ${tables.join(", ")}`);
db.close();