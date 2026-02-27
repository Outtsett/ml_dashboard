/** @deprecated Use SqliteService from NestJS DI container instead. Direct import retained for backward compatibility during migration. */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import path from "path";
import fs from "fs";

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

export const db = drizzle(sqlite, { schema });

// Read-only connection for the database explorer query endpoint (security: prevents writes
// even if the SQL blocklist validator is bypassed via SQLite function tricks).
const sqliteReadOnly = new Database(dbPath, { readonly: true });
sqliteReadOnly.pragma("busy_timeout = 5000");
export const dbReadOnly = drizzle(sqliteReadOnly, { schema });
