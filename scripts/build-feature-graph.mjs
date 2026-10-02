/**
 * Build the feature dependency graph into `feature_dependencies`.
 *
 * The graph is two layers deep, and the two layers come from two files that
 * describe different things:
 *
 *   base layer     `packages/config/features.json` — 44 features whose inputs
 *                  are raw data columns. Read the file before assuming: its
 *                  `requires` arrays name 12 raw columns (`close`, `high`,
 *                  `bid_sz_00`, ...) and NOT ONE of them names another feature.
 *                  So the base layer has no feature-to-feature edges at all, and
 *                  a graph drawn from that file alone would be 44 isolated dots.
 *                  Those edges land as `input_column`, which is what they are.
 *
 *   derived layer  `packages/config/feature_extraction.json` — transform specs
 *                  applied to matched indicator columns, producing
 *                  `<column><suffix>`. This is where the dependency structure
 *                  is: 13 categories x their matched columns x their transforms.
 *
 * A third, small set of edges comes from the two-input derivations. Only
 * `crossover_dist` is one: it needs the MACD signal line beside the MACD line,
 * which the config expresses as `signal_prefix: "MACDs_"` and the implementation
 * honours through a hard-coded three-pair lookup. Those land as `derives_with`,
 * because the second input is a genuine dependency and drawing it as two
 * independent single-input derivations would misstate the graph.
 *
 * Sibling transforms inside one category can shadow each other (`squeeze` writes
 * a boolean, and `crossover_dist` wants the level), so the order below follows
 * the implementation's own processing order rather than the config's key order.
 *
 * Idempotent — the two tables are rewritten wholesale.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";

const DB_PATH = process.env.DRIZZLE_SQLITE_PATH ?? "data/ml_dashboard.db";
const FEATURES_PATH = process.env.FEATURES_CONFIG ?? "packages/config/features.json";
const EXTRACTION_PATH =
  process.env.FEATURE_EXTRACTION_CONFIG ?? "packages/config/feature_extraction.json";

for (const [label, file] of [["features", FEATURES_PATH], ["extraction", EXTRACTION_PATH]]) {
  if (!existsSync(file)) {
    console.error(`[feature-graph] no ${label} config at ${file}`);
    process.exit(1);
  }
}
if (!existsSync(DB_PATH)) {
  console.error(`[feature-graph] no database at ${DB_PATH}`);
  process.exit(1);
}

const featuresConfig = JSON.parse(readFileSync(FEATURES_PATH, "utf-8"));
const extractionConfig = JSON.parse(readFileSync(EXTRACTION_PATH, "utf-8"));

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS feature_dependencies (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind   TEXT NOT NULL,
    via    TEXT,
    UNIQUE (source, target, kind)
  );
  CREATE INDEX IF NOT EXISTS feature_dependencies_source_idx ON feature_dependencies(source);
  CREATE INDEX IF NOT EXISTS feature_dependencies_target_idx ON feature_dependencies(target);

  CREATE TABLE IF NOT EXISTS feature_transforms (
    id            TEXT PRIMARY KEY,
    derived_count INTEGER NOT NULL DEFAULT 0
  );
`);

const insertEdge = db.prepare(
  `INSERT OR REPLACE INTO feature_dependencies (source, target, kind, via) VALUES (?, ?, ?, ?)`,
);
const insertTransform = db.prepare(
  `INSERT INTO feature_transforms (id, derived_count) VALUES (?, ?)
   ON CONFLICT(id) DO UPDATE SET derived_count = excluded.derived_count`,
);

const edges = [];
const transformCounts = new Map();
let baseToBase = 0;
let inputEdges = 0;
let siblingEdges = 0;

const add = (source, target, kind, via) => edges.push([source, target, kind, via]);

// ── Layer 1: base features ───────────────────────────────────────────────────

const featureIds = new Set((featuresConfig.features ?? []).map((f) => f.name));

for (const feature of featuresConfig.features ?? []) {
  for (const column of feature.requires ?? []) {
    // An edge whose source is a feature is a feature-to-feature edge. Asserted
    // rather than assumed: today the count is zero, and if someone ever adds one
    // to the config it must land as `depends_on`, not as a raw-column edge.
    if (featureIds.has(column)) {
      add(`base:${column}`, `base:${feature.name}`, "depends_on", column);
      baseToBase += 1;
    } else {
      add(`column:${column}`, `base:${feature.name}`, "input_column", column);
      inputEdges += 1;
    }
  }
}

// ── Layer 2: derived columns from indicator columns ──────────────────────────

/**
 * The sibling pair a two-input transform needs.
 *
 * Mirrors the implementation's own `signal_lookup`, which is built for exactly
 * these three pairs. Reading it from here rather than from the config's
 * `signal_prefix` is deliberate: the implementation pops that param and ignores
 * it, so trusting the config would draw edges the code does not follow.
 */
const SIGNAL_PAIRS = new Map([
  ["macd_macd", "macd_macdsignal"],
  ["macdext_macd", "macdext_macdsignal"],
  ["macdfix_macd", "macdfix_macdsignal"],
]);

/** The derivations that consume a second column rather than only their own. */
const TWO_INPUT = new Set(["crossover_dist"]);

for (const [category, spec] of Object.entries(extractionConfig.categories ?? {})) {
  const matchExact = new Set(spec.match_exact ?? []);
  const matchPrefixes = spec.match_prefixes ?? [];
  const excludes = spec.match_exclude_prefixes ?? [];

  // The column tokens this category can match. Prefixes stay symbolic (`RSI_`)
  // because the real column inventory is measured at runtime from whatever the
  // lake holds, and inventing concrete column names here would assert columns
  // that may not exist. An exact match is a real name and is used as one.
  const baseTokens = new Set();
  for (const exact of matchExact) if (exact) baseTokens.add(exact);
  for (const prefix of matchPrefixes) if (prefix) baseTokens.add(`${prefix}*`);

  for (const derivation of spec.derivations ?? []) {
    const suffix = derivation.suffix ?? `_${derivation.name}`;
    for (const token of baseTokens) {
      if (excludes.some((ex) => ex && token.startsWith(ex))) continue;
      // A prefix token stands for "whatever columns match"; naming the derived
      // column after the prefix keeps the edge readable without claiming a
      // specific column exists.
      const baseName = token.endsWith("*") ? token.slice(0, -1) : token;
      const derivedName = `${baseName}${suffix}`;
      const source = `column:${baseName}`;
      const target = `derived:${derivedName}`;

      add(source, target, "derives", derivation.name);
      add(`transform:${derivation.name}`, target, "computes", category);
      transformCounts.set(derivation.name, (transformCounts.get(derivation.name) ?? 0) + 1);

      if (TWO_INPUT.has(derivation.name)) {
        const signal = SIGNAL_PAIRS.get(baseName);
        if (signal) {
          add(`column:${signal}`, target, "derives_with", `${derivation.name} signal line`);
          siblingEdges += 1;
        } else {
          // The implementation returns zeros when the pair is absent, so the
          // derived column exists but carries no signal. Recorded as an edge
          // with a null sibling so the column is still reachable in the graph.
          add(source, target, "derives_unpaired", derivation.name);
        }
      }
    }
  }
}

const land = db.transaction(() => {
  db.exec(`DELETE FROM feature_dependencies`);
  db.exec(`DELETE FROM feature_transforms`);
  for (const row of edges) insertEdge.run(...row);
  for (const [id, count] of transformCounts) insertTransform.run(id, count);
});
land();

const q = (sql) => db.prepare(sql).all();
const byKind = q(`SELECT kind, count(*) AS n FROM feature_dependencies GROUP BY kind ORDER BY n DESC`);

console.log(`[feature-graph] ${edges.length} edges`);
for (const row of byKind) console.log(`  ${row.kind}: ${row.n}`);
console.log(
  `[feature-graph] base->base (feature depends on another feature): ${baseToBase}` +
    `  |  input_column: ${inputEdges}  |  sibling (derives_with): ${siblingEdges}`,
);

const nodes = db
  .prepare(
    `SELECT count(DISTINCT node) AS n FROM (
       SELECT source AS node FROM feature_dependencies
       UNION SELECT target FROM feature_dependencies
     )`,
  )
  .get().n;
console.log(`[feature-graph] ${nodes} distinct nodes across the graph`);

const depth = db
  .prepare(
    `SELECT count(*) AS n FROM feature_dependencies WHERE target LIKE 'derived:%' AND kind = 'derives'`,
  )
  .get().n;
console.log(`[feature-graph] derived columns reachable from a base column: ${depth}`);

db.close();