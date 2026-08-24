/** @deprecated Use SqliteService from NestJS DI container instead. Direct import retained for backward compatibility during migration. */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import path from "path";
import fs from "fs";
import { enforceSqliteInvariants } from "./enforce-sqlite-invariants";
import { log } from "../lib/log";

// Ensure data directory exists
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "ml_dashboard.db");
const sqlite = new Database(dbPath);

// Performance pragmas
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

// AUD-008 fix: drizzle-kit push cannot express CHECK constraints or partial
// unique indexes, so it can never create the ones designed into
// model_versions/deployments/promotion_gates/agent_runs (see
// migrations/0002_model_registry.sql, migrations/0003_agent_runs.sql, and
// enforce-sqlite-invariants.ts for the full mechanism). Runs idempotently
// on every process boot — cheap no-op once compliant.
try {
  const results = enforceSqliteInvariants(sqlite);
  const acted = results.filter((r) => r.action !== "already-compliant");
  if (acted.length > 0) {
    log(`SQLite invariants: ${acted.map((r) => `${r.table}=${r.action}`).join(", ")}`, "database");
  }
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`Failed to enforce SQLite CHECK-constraint/partial-index invariants: ${message}`);
}

export const db = drizzle(sqlite, { schema });

// Read-only connection for the database explorer query endpoint (security: prevents writes
// even if the SQL blocklist validator is bypassed via SQLite function tricks).
const sqliteReadOnly = new Database(dbPath, { readonly: true });
sqliteReadOnly.pragma("busy_timeout = 5000");
export const dbReadOnly = drizzle(sqliteReadOnly, { schema });
