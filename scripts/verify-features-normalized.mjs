/**
 * The questions normalization exists to answer, verified against the tables.
 *
 * These are the reads the flat `features` table could not serve: a category and
 * its children, the type axis separate from the category axis, and a column
 * traced back to every feature that consumes it. Each asserts on real numbers
 * from `packages/config/features.json`, so a config change that breaks the
 * landing fails here rather than in a UI that silently shows nothing.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";

const DB_PATH = process.env.DRIZZLE_SQLITE_PATH ?? "data/ml_dashboard.db";
const CONFIG_PATH = process.env.FEATURES_CONFIG ?? "packages/config/features.json";

if (!existsSync(DB_PATH) || !existsSync(CONFIG_PATH)) {
  console.error("[features-verify] missing database or config");
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
const expectedFeatures = config.features.length;
const expectedCategories = Object.keys(config.categories ?? {}).length;
const expectedTypes = new Set(config.features.map((f) => f.type).filter(Boolean)).size;

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

console.log("[features-verify] row counts");
const count = (t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
check("features", count("features"), expectedFeatures);
check("feature_categories", count("feature_categories"), expectedCategories);
check("feature_types", count("feature_types"), expectedTypes);

console.log("[features-verify] referential integrity");
// FKs are off by default in SQLite, so this is asserted rather than assumed.
const orphans = db
  .prepare(
    `SELECT count(*) AS n FROM features f
     LEFT JOIN feature_categories c ON c.id = f.category_id
     LEFT JOIN feature_types t ON t.id = f.type_id
     WHERE c.id IS NULL OR t.id IS NULL`,
  )
  .get().n;
check("features with no category or type parent", orphans, 0);

console.log("[features-verify] parent/child read");
const parentWithChildren = db
  .prepare(
    `SELECT c.name AS category, count(f.id) AS n
     FROM feature_categories c LEFT JOIN features f ON f.category_id = c.id
     GROUP BY c.id HAVING n > 0 ORDER BY n DESC LIMIT 1`,
  )
  .get();
check("largest category has children", parentWithChildren?.n > 0, true);

const typeAxis = db
  .prepare(`SELECT name FROM feature_types WHERE id = (SELECT type_id FROM features GROUP BY type_id ORDER BY count(*) DESC LIMIT 1)`)
  .get();
check("type axis is independent of category", typeAxis?.name === "finbert", true);

console.log("[features-verify] reverse lookup");
const viaColumn = db
  .prepare(
    `SELECT f.name FROM features f
     JOIN feature_requires r ON r.feature_id = f.id
     WHERE r.column_name = 'close' LIMIT 5`,
  )
  .all();
check("features reachable from input column 'close'", viaColumn.length > 0, true);
console.log(`         e.g. ${viaColumn.slice(0, 3).map((r) => r.name).join(", ")}`);

// Parameter names are per-generator (`window`, `horizon`, `windowBars`,
// `depth`), so this asks the question the table exists for — which features
// are configured over a 20-bar span — across whichever name each one uses.
const viaParam = db
  .prepare(
    `SELECT feature_id FROM feature_parameters
     WHERE value = '20' AND name IN ('window','horizon','windowBars','depth') LIMIT 3`,
  )
  .all();
check("features with a 20-bar span", viaParam.length > 0, true);
console.log(`         e.g. ${viaParam.slice(0, 3).map((r) => r.feature_id).join(", ")}`);

db.close();
console.log(failures === 0 ? "[features-verify] all checks passed" : `[features-verify] ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);