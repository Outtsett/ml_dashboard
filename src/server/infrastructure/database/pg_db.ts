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
log(`Connected to Postgres database for telemetry`, "database");
