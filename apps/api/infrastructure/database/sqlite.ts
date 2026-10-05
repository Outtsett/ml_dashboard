import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

const dbPath = process.env.SQLITE_DB_PATH || "data/ml_dashboard.db";

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
export type DrizzleDb = typeof db;

export { schema };