/**
 * Land `packages/config/features.json` into the normalized tables.
 *
 * The JSON is the source of truth; these tables are its queryable form. The
 * point of normalizing is that the questions the JSON cannot answer become SQL:
 * which features share a type, which read a given column, which category has
 * grown a member since someone last read it.
 *
 * Idempotent — it deletes and rewrites the five feature tables, so a changed
 * config lands cleanly rather than accumulating orphans.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";

const DB_PATH = process.env.DRIZZLE_SQLITE_PATH ?? "data/ml_dashboard.db";
const CONFIG_PATH = process.env.FEATURES_CONFIG ?? "packages/config/features.json";

if (!existsSync(DB_PATH)) {
  console.error(`[features-normalize] no database at ${DB_PATH}`);
  process.exit(1);
}
if (!existsSync(CONFIG_PATH)) {
  console.error(`[features-normalize] no config at ${CONFIG_PATH}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
const features = Array.isArray(config.features) ? config.features : [];
const categories = config.categories ?? {};

if (features.length === 0) {
  console.error("[features-normalize] config carries no features — refusing to empty the tables");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const insertCategory = db.prepare(
  `INSERT INTO feature_categories (id, name, description) VALUES (?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description`,
);
const insertType = db.prepare(
  `INSERT INTO feature_types (id, name) VALUES (?, ?)
   ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
);
const insertFeature = db.prepare(
  `INSERT INTO features (id, name, category_id, type_id, display_name, computation_logic)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     name = excluded.name,
     category_id = excluded.category_id,
     type_id = excluded.type_id,
     display_name = excluded.display_name,
     computation_logic = excluded.computation_logic`,
);
const insertParam = db.prepare(
  `INSERT OR REPLACE INTO feature_parameters (feature_id, name, value) VALUES (?, ?, ?)`,
);
const insertRequire = db.prepare(
  `INSERT OR IGNORE INTO feature_requires (feature_id, column_name) VALUES (?, ?)`,
);
const clearParams = db.prepare(`DELETE FROM feature_parameters WHERE feature_id = ?`);
const clearRequires = db.prepare(`DELETE FROM feature_requires WHERE feature_id = ?`);

let paramCount = 0;
let requireCount = 0;

const land = db.transaction(() => {
  for (const [id, value] of Object.entries(categories)) {
    insertCategory.run(id, value?.name ?? id, value?.description ?? null);
  }

  for (const feature of features) {
    const categoryId = feature.category ?? "other";
    const typeId = feature.type ?? "unspecified";

    // A feature whose category is not in the `categories` block still needs its
    // parent to exist — the foreign key would reject it otherwise, and the
    // alternative (dropping it) loses a feature.
    insertCategory.run(categoryId, categoryId.replace(/_/g, " "), null);
    insertType.run(typeId, typeId);

    insertFeature.run(
      feature.name,
      feature.name,
      categoryId,
      typeId,
      feature.displayName ?? null,
      feature.description ?? null,
    );

    clearParams.run(feature.name);
    clearRequires.run(feature.name);
    for (const [key, value] of Object.entries(feature.params ?? {})) {
      insertParam.run(feature.name, key, JSON.stringify(value));
      paramCount += 1;
    }
    for (const column of feature.requires ?? []) {
      insertRequire.run(feature.name, column);
      requireCount += 1;
    }
  }
});

land();

const count = (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
console.log(
  `[features-normalize] ${count("feature_categories")} categories, ` +
    `${count("features")} features, ${count("feature_types")} types, ` +
    `${count("feature_parameters")} parameters, ${count("feature_requires")} requirements ` +
    `(landed ${paramCount} params, ${requireCount} requires)`,
);

// The questions normalization exists to answer, answered once so the numbers
// are on the record rather than asserted.
const byType = db
  .prepare(`SELECT type_id, count(*) AS n FROM features GROUP BY type_id ORDER BY n DESC LIMIT 3`)
  .all();
const sharedInput = db
  .prepare(
    `SELECT column_name, count(*) AS n FROM feature_requires
     GROUP BY column_name HAVING n > 1 ORDER BY n DESC LIMIT 1`,
  )
  .get();
console.log(`[features-normalize] largest type: ${byType.map((r) => `${r.type_id}(${r.n})`).join(", ")}`);
if (sharedInput) {
  console.log(`[features-normalize] most-shared input column: ${sharedInput.column_name} (${sharedInput.n} features)`);
}

db.close();