/**
 * Schema creation, retired.
 *
 * These functions created QuestDB's `ohlcv`, `symbols` and `prediction_log`
 * tables. QuestDB was emptied and dropped on 2026-09-10, and the lake's schema
 * is owned by datalake — an Iceberg table is created by
 * `scripts/migrate_to_iceberg.py`, never by a dashboard route.
 *
 * They still throw rather than no-op, because the callers used them to mean
 * "make sure the tables exist"; answering yes without checking anything would
 * let a broken deployment look initialised.
 *
 * The captured DDL for all 41 dropped objects lives at
 * `s3://meta/questdb_schema/questdb_schema_latest.sql` if it is ever needed.
 */

const RETIRED =
  "QuestDB was retired on 2026-09-10 and this server is read-only over the lake. " +
  "Schema for the lake is owned by datalake (scripts/migrate_to_iceberg.py). The " +
  "captured QuestDB DDL is at s3://meta/questdb_schema/questdb_schema_latest.sql, " +
  "and the data it described is at s3://derived/recipe=questdb_full_2026-09-09/.";

export async function createOHLCVTable(): Promise<void> {
  throw new Error(`[lake] createOHLCVTable is not available. ${RETIRED}`);
}

export async function createPredictionLogTable(): Promise<void> {
  throw new Error(`[lake] createPredictionLogTable is not available. ${RETIRED}`);
}

export async function initQuestDBTables(): Promise<void> {
  throw new Error(`[lake] initQuestDBTables is not available. ${RETIRED}`);
}
