import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,  // fail fast instead of hanging forever
  idleTimeoutMillis: 30_000,
  max: 10,
});

// Prevent unhandled 'error' on idle clients from crashing the process
pool.on("error", (err) => {
  console.error("[pg] Idle client error:", err.message);
});

export const db = drizzle(pool, { schema });

/**
 * Test PostgreSQL connectivity with a timeout.
 * Returns true if the database is reachable, false otherwise.
 */
export async function testPostgresConnection(timeoutMs = 5000): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn('[pg] Connection test failed:', err.message);
    return false;
  }
}
