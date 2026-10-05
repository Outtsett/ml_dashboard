/**
 * Schema creation, retired.
 *
 * These functions created lake's `ohlcv`, `symbols` and `prediction_log`
 * tables. lake was emptied and dropped on 2026-09-10, and the lake's schema
 * is owned by datalake — an Iceberg table is created by
 * `scripts/migrate_to_iceberg.py`, never by a dashboard route.
 *
 * They still throw rather than no-op, because the callers used them to mean
 * "make sure the tables exist"; answering yes without checking anything would
 * let a broken deployment look initialised.
 *
 * The captured DDL for all 41 dropped objects lives at
 * `s3://meta/lake_schema/lake_schema_latest.sql` if it is ever needed.
 */

import { servingSnapshot } from "./connection";

function retired(): string {
  return (
    "lake was retired on 2026-09-10 and this server is read-only over the lake. " +
    "Schema for the lake is owned by datalake (scripts/migrate_to_iceberg.py). The " +
    "captured lake DDL is at s3://meta/lake_schema/lake_schema_latest.sql, " +
    `and the data it described is at s3://${servingSnapshot()}/.`
  );
}

export async function createOHLCVTable(): Promise<void> {
  throw new Error(`[lake] createOHLCVTable is not available. ${retired()}`);
}

export async function createPredictionLogTable(): Promise<void> {
  throw new Error(`[lake] createPredictionLogTable is not available. ${retired()}`);
}

export async function initLakeTables(): Promise<void> {
  throw new Error(`[lake] initLakeTables is not available. ${retired()}`);
}

