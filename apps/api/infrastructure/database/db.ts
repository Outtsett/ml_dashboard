/** @deprecated Use DbService from NestJS DI container instead. Direct import retained for backward compatibility during migration. */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/pg_schema";
import { log } from "../lib/log";

// Ensure PG connect string is configured
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/quant";

const pool = new Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });

// Read-only connection not needed as much for PG but we'll create one just in case
// using the same pool, or a separate pool with a different user role if configured.
const poolReadOnly = new Pool({
  connectionString,
});

export const dbReadOnly = drizzle(poolReadOnly, { schema });

/**
 * Close database pools. Called from the shutdown path in main.ts.
 */
export async function closeDatabases(): Promise<void> {
  for (const handle of [pool, poolReadOnly]) {
    try {
      await handle.end();
    } catch (err) {
      log(`PG close failed: ${(err as Error).message}`, "database");
    }
  }
}
