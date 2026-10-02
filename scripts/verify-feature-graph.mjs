/**
 * Read back the feature dependency graph and report what is in it.
 *
 * A build that succeeds is not a verification: this asserts the shape of the
 * graph the way the drawing code will consume it, so a wrong count or a
 * dangling edge is caught here rather than in the browser.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const DB_PATH = process.env.DRIZZLE_SQLITE_PATH ?? "data/ml_dashboard.db";
if (!existsSync(DB_PATH)) {
  console.error(`[verify-feature-graph] no database at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

const failures = [];
const check = (label, actual, expected) => {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${actual}`);
  if (!ok) failures.push(label);
};

console.log("[verify-feature-graph] edge kinds");
for (const row of q(
  `SELECT kind, count(*) AS n FROM feature_dependencies GROUP BY kind ORDER BY n DESC`,
)) {
  console.log(`  ${row.kind}: ${row.n}`);
}

console.log("\n[verify-feature-graph] node kinds");
for (const row of q(
  `SELECT kind, count(*) AS n FROM (
     SELECT CASE WHEN instr(source, ':') > 0 THEN substr(source, 1, instr(source, ':') - 1)
                 ELSE source END AS kind
     FROM feature_dependencies
     UNION ALL
     SELECT CASE WHEN instr(target, ':') > 0 THEN substr(target, 1, instr(target, ':') - 1)
                 ELSE target END
     FROM feature_dependencies
   ) GROUP BY kind ORDER BY n DESC`,
)) {
  console.log(`  ${row.kind}: ${row.n}`);
}

console.log("\n[verify-feature-graph] the two-input derivation");
const sibling = q(
  `SELECT source, target, kind, via FROM feature_dependencies
   WHERE target = 'derived:macd_macd_xdist' ORDER BY kind`,
);
for (const row of sibling) console.log(`  ${row.kind}: ${row.source} -> ${row.target} (${row.via})`);
check("macd_macd_xdist has one parent", sibling.filter((r) => r.kind === "derives").length, 1);
check(
  "macd_macd_xdist reads the MACD signal as a sibling",
  sibling.some((r) => r.kind === "derives_with" && r.source === "column:macd_macdsignal"),
  true,
);
// The pandas-ta `MACD_` prefix has no signal-line pair, so the implementation
// returns zeros. It is a different target from the macd_* column above, hence
// its own query rather than more rows on `macd_macd_xdist`.
const unpaired = q(
  `SELECT source, target, kind, via FROM feature_dependencies WHERE kind = 'derives_unpaired'`,
);
for (const row of unpaired) {
  console.log(`  ${row.kind}: ${row.source} -> ${row.target} (${row.via})`);
}
check(
  "the unpaired MACD_ prefix column is recorded, not silently dropped",
  unpaired.some((r) => r.source === "column:MACD_" && r.target === "derived:MACD__xdist"),
  true,
);

console.log("\n[verify-feature-graph] base layer");
check(
  "base features with an input column",
  one(`SELECT count(DISTINCT target) AS n FROM feature_dependencies WHERE kind = 'input_column'`).n,
  44,
);
check(
  "raw columns feeding the base layer",
  one(`SELECT count(DISTINCT source) AS n FROM feature_dependencies WHERE kind = 'input_column'`).n,
  12,
);
check(
  "feature-to-feature edges in features.json (expected: 0)",
  one(`SELECT count(*) AS n FROM feature_dependencies WHERE kind = 'depends_on'`).n,
  0,
);

console.log("\n[verify-feature-graph] derived layer");
const derivedCols = one(
  `SELECT count(DISTINCT target) AS n FROM feature_dependencies WHERE kind IN ('derives', 'derives_with', 'derives_unpaired')`,
).n;
check("derived columns", derivedCols, (n) => n > 300);
console.log(`  derived columns: ${derivedCols}`);
for (const row of q(
  `SELECT id, derived_count FROM feature_transforms ORDER BY derived_count DESC, id`,
)) {
  console.log(`  ${row.id}: ${row.derived_count}`);
}
check("all 8 transforms present", q(`SELECT id FROM feature_transforms`).length, 8);

console.log("\n[verify-feature-graph] every derived column has a parent");
const orphans = one(
  `SELECT count(*) AS n FROM (
     SELECT DISTINCT target FROM feature_dependencies WHERE target LIKE 'derived:%'
   ) d WHERE NOT EXISTS (
     SELECT 1 FROM feature_dependencies e
     WHERE e.target = d.target AND e.kind IN ('derives', 'derives_with', 'derives_unpaired')
   )`,
).n;
check("orphan derived columns", orphans, 0);

console.log("\n[verify-feature-graph] every derived column names its transform");
const missingVia = one(
  `SELECT count(*) AS n FROM feature_dependencies
   WHERE target LIKE 'derived:%' AND kind = 'computes' AND (via IS NULL OR via = '')`,
).n;
check("derived columns without a transform", missingVia, 0);

db.close();

if (failures.length) {
  console.error(`\n[verify-feature-graph] FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\n[verify-feature-graph] all checks passed");
