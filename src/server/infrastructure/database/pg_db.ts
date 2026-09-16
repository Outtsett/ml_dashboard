import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as pgSchema from "../../../shared/pg_schema";
import { log } from "../lib/log";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.PG_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ml_dashboard";

// Create the connection pool
const pool = new pg.Pool({
  connectionString,
  max: 20, 
});

pool.on('error', (err) => {
  log(`Unexpected error on idle pg client: ${err.message}`, "database");
});

export const pgDb = drizzle(pool, { schema: pgSchema });

/**
 * Whether this pool can actually reach Postgres.
 *
 * This module used to log "Connected to Postgres database for telemetry" on the
 * line after `new pg.Pool(...)`. A Pool constructor opens nothing — it is lazy —
 * so that line printed on every boot whether or not Postgres existed, whether or
 * not the credentials worked, and whether or not the database had ever been
 * created. Measured 2026-09-15: the log said connected while `GET /api/experiments`
 * returned 500 `password authentication failed for user "postgres"`.
 *
 * Nothing awaits this at import time (a broken telemetry tier must not stop the
 * dashboard from booting); callers that need certainty await it, and the routes
 * that use pgDb surface the real error instead of a reassuring startup line.
 */
export async function checkPostgresHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return { ok: true, message: "reachable" };
    } finally {
      client.release();
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Say what is true at import time: the pool is configured, not connected.
log(`Postgres telemetry pool configured (lazy; call checkPostgresHealth to verify)`, "database");
