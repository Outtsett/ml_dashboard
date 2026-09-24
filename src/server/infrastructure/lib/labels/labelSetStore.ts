/**
 * Where a generated label set's ROWS live: the lake, as parquet, with a manifest.
 *
 * `generated_labels` in SQLite used to be the whole record — status, counts, a
 * class distribution — while the rows themselves were sliced to 100 for the
 * HTTP response and discarded. A label set that exists only as its summary
 * cannot be overlaid on a chart, joined in a notebook, or handed to a training
 * run, so "generate" produced nothing a later step could use.
 *
 * Rows now land at
 *
 *   s3://derived/recipe=dashboard_label_sets/table=<generator>/label_set_id=<id>/labels.parquet
 *
 * in the same `recipe=/table=` layout the rest of `derived` uses, written by the
 * serving DuckDB straight from the label SQL (no round trip through Node), with a
 * receipt at `s3://meta/ingest_manifests/dashboard_label_sets/<id>.json` so the
 * dataset is discoverable the way every other derived dataset is.
 *
 * The SQLite row keeps `parquetPath` pointing here; `readLabelSetRows` reads it
 * back through the same DuckDB, and Python reads it with `read_parquet` and the
 * same S3 secret.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { queryQuestDB } from '../../database/questdb';

export const LABEL_SET_RECIPE = 'dashboard_label_sets';
const DERIVED_BUCKET = process.env.LAKE_DERIVED_BUCKET || 'derived';
const META_BUCKET = process.env.LAKE_META_BUCKET || 'meta';

const SAFE_SEGMENT = /^[a-z0-9_]+$/i;

/** Object path for a label set's rows. Generator ids are `[a-z0-9_]`, checked here because they become a path. */
export function labelSetObjectPath(generatorType: string, labelSetId: number): string {
  if (!SAFE_SEGMENT.test(generatorType)) {
    throw new Error(`Generator id '${generatorType}' is not a safe object-path segment`);
  }
  return `s3://${DERIVED_BUCKET}/recipe=${LABEL_SET_RECIPE}/table=${generatorType}/label_set_id=${labelSetId}/labels.parquet`;
}

export function labelSetManifestPath(labelSetId: number): string {
  return `s3://${META_BUCKET}/ingest_manifests/${LABEL_SET_RECIPE}/${labelSetId}.json`;
}

function sqlString(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export interface PersistLabelSetArgs {
  labelSetId: number;
  generatorType: string;
  symbol: string;
  timeframeMinutes: number;
  params: Record<string, unknown>;
  window: { startMs?: number; endMs?: number };
  /** The label SQL, when the rows come from a generator. Copied server-side. */
  sql: string | null;
  /** The rows, when they were computed in-process (TA-Lib). Written via a temp file. */
  rows?: Array<Record<string, unknown>>;
  distribution: Record<string, number>;
  dataStartTimestamp: number | null;
  dataEndTimestamp: number | null;
}

/**
 * Write the rows and the manifest. Returns the object path and the row count
 * as read back from the object, not as counted in memory — the number that
 * matters is the one a later reader will get.
 */
export async function persistLabelSet(args: PersistLabelSetArgs): Promise<{ parquetPath: string; rowCount: number }> {
  const parquetPath = labelSetObjectPath(args.generatorType, args.labelSetId);

  if (args.sql) {
    // Straight from the generator's SQL: DuckDB runs it once and streams the
    // result to the object. The rows never pass through Node.
    await queryQuestDB(
      `COPY (${args.sql}) TO ${sqlString(parquetPath)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
      300_000,
    );
  } else {
    const rows = args.rows ?? [];
    // Computed rows go through a temp NDJSON file rather than a VALUES list:
    // a whole-history pattern set can be tens of thousands of rows, and a SQL
    // literal that size is slower to parse than the file is to write.
    const tmp = path.join(os.tmpdir(), `label_set_${args.labelSetId}_${process.pid}.ndjson`);
    fs.writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    try {
      const select = rows.length === 0
        ? `SELECT NULL::TIMESTAMP AS timestamp, ''::VARCHAR AS symbol, NULL::DOUBLE AS close, NULL::DOUBLE AS label, ''::VARCHAR AS pattern WHERE false`
        : `SELECT
             to_timestamp(timestamp / 1000.0)::TIMESTAMP AS timestamp,
             symbol::VARCHAR AS symbol,
             close::DOUBLE AS close,
             label::DOUBLE AS label,
             pattern::VARCHAR AS pattern
           FROM read_json_auto(${sqlString(tmp.replace(/\\/g, '/'))}, format = 'newline_delimited')
           ORDER BY timestamp`;
      await queryQuestDB(
        `COPY (${select}) TO ${sqlString(parquetPath)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
        300_000,
      );
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  const [count] = await queryQuestDB<{ c: number | bigint }>(
    `SELECT count(*) AS c FROM read_parquet(${sqlString(parquetPath)})`, 60_000,
  );
  const rowCount = Number(count?.c ?? 0);

  // The receipt. One JSON object per set, keyed by id, in the manifests prefix
  // the datalake tooling scans.
  const manifest = {
    recipe: LABEL_SET_RECIPE,
    label_set_id: args.labelSetId,
    generator_type: args.generatorType,
    symbol: args.symbol,
    timeframe_minutes: args.timeframeMinutes,
    parameters: args.params,
    window_start_timestamp: args.window.startMs ?? null,
    window_end_timestamp: args.window.endMs ?? null,
    data_start_timestamp: args.dataStartTimestamp,
    data_end_timestamp: args.dataEndTimestamp,
    row_count: rowCount,
    label_distribution: args.distribution,
    object_path: parquetPath,
    written_at: new Date().toISOString(),
    written_by: 'ml_dashboard labelGenerator',
  };
  await queryQuestDB(
    `COPY (SELECT ${sqlString(JSON.stringify(manifest))}::JSON AS manifest) TO ${sqlString(labelSetManifestPath(args.labelSetId))} (FORMAT JSON)`,
    60_000,
  );

  return { parquetPath, rowCount };
}

export interface ReadLabelSetOptions {
  startMs?: number;
  endMs?: number;
  limit?: number;
}

/** Rows of a persisted set, timestamps as epoch milliseconds, ascending. */
export async function readLabelSetRows(
  parquetPath: string,
  options: ReadLabelSetOptions = {},
): Promise<Array<Record<string, unknown>>> {
  if (!parquetPath.startsWith('s3://') || parquetPath.includes("'")) {
    throw new Error(`Refusing to read label rows from '${parquetPath}': not a lake object path`);
  }
  const where: string[] = [];
  if (Number.isFinite(options.startMs)) where.push(`timestamp >= to_timestamp(${options.startMs! / 1000})`);
  if (Number.isFinite(options.endMs)) where.push(`timestamp <= to_timestamp(${options.endMs! / 1000})`);
  const limit = Math.max(1, Math.floor(options.limit ?? 5000));
  const rows = await queryQuestDB<Record<string, unknown>>(
    // `recipe=`, `table=`, `label_set_id=` are path segments read_parquet
    // hands back as hive-partition columns; they are the object's address, not
    // its data, and `table` is a reserved word besides.
    `SELECT * EXCLUDE (recipe, "table", label_set_id) REPLACE (epoch_ms(timestamp) AS timestamp)
     FROM read_parquet(${sqlString(parquetPath)}, hive_partitioning = true)
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY timestamp
     LIMIT ${limit}`,
    60_000,
  );
  return rows.map(row => ({ ...row, timestamp: Number(row.timestamp) }));
}
