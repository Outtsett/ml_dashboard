/**
 * Standalone CLI entry point for the CHECK-constraint / partial-unique-index
 * enforcement mechanism (AUD-008 remediation). Normally this runs
 * automatically on every server boot via
 * `apps/api/infrastructure/database/db.ts`, but this script lets it be
 * invoked on demand — e.g. immediately after a manual `npx drizzle-kit push`
 * without waiting for the next server start, or against an arbitrary
 * scratch database file for verification.
 *
 * Usage:
 *   npx tsx scripts/enforce-sqlite-invariants.ts [path/to/database.db]
 *
 * Defaults to data/ml_dashboard.db (relative to cwd) when no path is given,
 * matching drizzle.config.ts's dbCredentials.url.
 */
import Database from "better-sqlite3";
import path from "path";
import { enforceSqliteInvariants } from "../apps/api/infrastructure/database/enforce-sqlite-invariants";

const dbPath = process.argv[2] ?? path.join(process.cwd(), "data", "ml_dashboard.db");

console.log(`Enforcing SQLite invariants against: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");

try {
  const results = enforceSqliteInvariants(sqlite);
  for (const r of results) {
    console.log(`  ${r.table.padEnd(20)} ${r.action}`);
  }
  const acted = results.filter((r) => r.action !== "already-compliant");
  console.log(
    acted.length > 0
      ? `Done — ${acted.length} table(s) changed.`
      : "Done — already fully compliant, no changes made."
  );
} finally {
  sqlite.close();
}
