/**
 * The study handlers' window onto the lake: the dashboard's in-process DuckDB
 * (snapshot views, `bars`, and every manifested derived dataset as
 * `derived_<dataset>[_<table>]`). View names are cached for a minute, so a
 * dataset landed while the server runs appears after
 * `POST /api/labels/catalog/refresh` and at most a minute of cache.
 */

import { queryQuestDB } from "../infrastructure/database/questdb/connection";
import { plainRow, text } from "./sql";
import type { StudyLake } from "./types";

const VIEW_CACHE_MS = 60_000;

let viewCache: { names: Set<string>; at: number } | null = null;

async function viewNames(): Promise<Set<string>> {
  if (viewCache && Date.now() - viewCache.at < VIEW_CACHE_MS) return viewCache.names;
  const rows = await queryQuestDB<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'",
  );
  viewCache = { names: new Set(rows.map((row) => String(row.table_name))), at: Date.now() };
  return viewCache.names;
}

export const lake: StudyLake = {
  async query<T>(sql: string, timeoutMs?: number): Promise<T[]> {
    const rows = await queryQuestDB<Record<string, unknown>>(sql, timeoutMs);
    return rows.map((row) => plainRow(row)) as T[];
  },
  async hasView(name: string): Promise<boolean> {
    return (await viewNames()).has(name);
  },
  async columns(name: string): Promise<string[]> {
    if (!(await viewNames()).has(name)) return [];
    const rows = await queryQuestDB<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = ${text(name)} ORDER BY ordinal_position`,
    );
    return rows.map((row) => String(row.column_name));
  },
};
