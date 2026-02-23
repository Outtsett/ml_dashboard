/**
 * Drop-in replacement for marketQuery from server/duckdb/market.ts.
 * Routes SQL queries to QuestDB instead of DuckDB.
 *
 * QuestDB SQL is PostgreSQL-compatible but has differences:
 * - SYMBOL type instead of VARCHAR for indexed strings
 * - SAMPLE BY instead of GROUP BY for time aggregation
 * - No parameterized queries for DDL via PG wire
 */
import { queryQuestDB } from '../questdb';

export async function questdbMarketQuery<T = any>(sql: string): Promise<T[]> {
  return queryQuestDB<T>(sql);
}
