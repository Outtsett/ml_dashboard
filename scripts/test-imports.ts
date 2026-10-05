import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../packages/shared/src/schema";

import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import * as pgSchema from "../packages/shared/src/pg_schema";

const sqliteDbPath = "./data/ml_dashboard.db";
const pgConnectionString = "postgresql://postgres:postgres@127.0.0.1:5433/quant";

async function main() {
  console.log("pgSchema keys:", Object.keys(pgSchema).length);
  console.log("sqliteSchema keys:", Object.keys(sqliteSchema).length);
  process.exit(0);
}
main();
