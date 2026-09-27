/**
 * Where a label set's ROWS live and how they get there: the lake, as parquet,
 * under the label contract, with a manifest line.
 *
 * Think of it as: the loading dock. A generator hands over its rows; this
 * module stages them locally, enriches them to the contract (resolution bar,
 * realised return, weights, `usable`), runs the validation gates, and only
 * then lands them at
 *
 *   s3://derived/labels/recipe=<recipe>/table=labels/part-0.parquet
 *
 * — the `lake.layout.derived_root(kind, recipe)` convention every other
 * derived dataset follows — with a line appended to
 * `s3://meta/ingest_manifests/labels.jsonl`. A set that fails a gate is written
 * beside the lake's glob (`derived/labels/_rejected/…`) so its rows can be
 * inspected, but it gets no manifest line and never enters `derived_labels`.
 *
 * The previous layout, `derived/recipe=dashboard_label_sets/table=<generator>/
 * label_set_id=<id>/labels.parquet`, is still readable through `readLabelSetRows`
 * for the sets landed under it.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  LABEL_CONTRACT_VERSION,
  LABEL_DATASET,
  LABEL_TABLE,
  type LabelEncoding,
  type LabelManifestLine,
  type LabelSourceFingerprint,
  type LabelValidationReport,
} from '@shared/labels/contract';
import { queryQuestDB, refreshDerivedViews } from '../../database/questdb';
import { appendJsonLine } from '../../lake/objects';
import { buildEnrichmentSql } from './labelEnrichment';
import { validateLabelRows } from './labelValidation';
import type { LabelSource } from './labelSource';
import { boundByWindow, sampledBarsCte, type LabelGeneratorConfig } from './sqlLabelGenerators/helpers';

const DERIVED_BUCKET = process.env.LAKE_DERIVED_BUCKET || 'derived';
const META_BUCKET = process.env.LAKE_META_BUCKET || 'meta';

export const LABEL_MANIFEST_PATH = `s3://${META_BUCKET}/ingest_manifests/${LABEL_DATASET}.jsonl`;
/** The retired layout's recipe segment, kept so old object paths still parse. */
export const LEGACY_LABEL_SET_RECIPE = 'dashboard_label_sets';

const SAFE_RECIPE = /^[A-Za-z0-9_]+$/;
/** Below this many rows the truncation gate has nothing to compare. */
const TRUNCATION_MINIMUM_ROWS = 200;
/** Share of the event span the truncated run keeps. */
const TRUNCATION_SHARE = 0.6;

export function labelSetObjectPath(recipe: string, rejected = false): string {
  if (!SAFE_RECIPE.test(recipe)) throw new Error(`Recipe '${recipe}' is not a safe object-path segment`);
  const middle = rejected ? `${LABEL_DATASET}/_rejected` : LABEL_DATASET;
  return `s3://${DERIVED_BUCKET}/${middle}/recipe=${recipe}/table=${LABEL_TABLE}/part-0.parquet`;
}

function sqlString(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function localSource(filePath: string): string {
  return `read_parquet(${sqlString(filePath.replace(/\\/g, '/'))})`;
}

// ─── Cost model ─────────────────────────────────────────────────────────────

let costModel: Record<string, { total_round_trip_points?: number }> | null = null;

/** Canonical round-trip cost in points for a symbol, or null when it is unpriced. */
export function roundTripCostPointsFor(symbol: string): number | null {
  if (!costModel) {
    try {
      const file = path.resolve(process.cwd(), 'src', 'config', 'cost_model.json');
      costModel = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { total_round_trip_points?: number }>;
    } catch {
      costModel = {};
    }
  }
  const entry = costModel[symbol.toUpperCase()];
  const points = entry?.total_round_trip_points;
  return typeof points === 'number' && Number.isFinite(points) ? points : null;
}

// ─── Landing ────────────────────────────────────────────────────────────────

export interface LandLabelSetArgs {
  labelSetId: number;
  recipe: string;
  parametersHash: string;
  generatorType: string;
  labelEncoding: LabelEncoding;
  symbol: string;
  timeframeMinutes: number;
  params: Record<string, unknown>;
  window: { startMs?: number; endMs?: number };
  /** The generator's SQL (already wrapped and bounded), or null when the rows were computed in-process. */
  sql: string | null;
  /** In-process rows (TA-Lib). Must carry timestamp (epoch ms), symbol, close, label, resolution_bars. */
  rows?: Array<Record<string, unknown>>;
  source: LabelSource;
  config: LabelGeneratorConfig;
  /** Rows the truncation gate can be skipped for (a pattern describes the bar it fired on). */
  skipTruncationGate?: boolean;
}

export interface LandLabelSetResult {
  landed: boolean;
  parquetPath: string;
  rowCount: number;
  labelDistribution: Record<string, number>;
  dataStartTimestamp: number | null;
  dataEndTimestamp: number | null;
  maxHorizonBars: number;
  purgeBars: number;
  embargoBars: number;
  validation: LabelValidationReport;
  sourceFingerprint: LabelSourceFingerprint;
  stagedRowCount: number;
}

interface StagedSummary {
  rowCount: number;
  firstEventMs: number | null;
  lastEventMs: number | null;
  cutoffMs: number | null;
  columns: string[];
}

async function stageRows(args: LandLabelSetArgs, stagingFile: string): Promise<void> {
  if (args.sql) {
    // Straight from the generator's SQL: DuckDB runs it once and streams the
    // result to the file. The rows never pass through Node.
    await queryQuestDB(`COPY (${args.sql}) TO ${sqlString(stagingFile)} (FORMAT PARQUET)`, 600_000);
    return;
  }
  const rows = args.rows ?? [];
  const ndjson = `${stagingFile}.ndjson`;
  fs.writeFileSync(ndjson, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  try {
    const select = rows.length === 0
      ? `SELECT NULL::TIMESTAMP AS timestamp, ''::VARCHAR AS symbol, NULL::DOUBLE AS close, NULL::DOUBLE AS label, 0::BIGINT AS resolution_bars, ''::VARCHAR AS pattern WHERE false`
      : `SELECT
           to_timestamp(timestamp / 1000.0)::TIMESTAMP AS timestamp,
           symbol::VARCHAR AS symbol,
           close::DOUBLE AS close,
           label::DOUBLE AS label,
           COALESCE(resolution_bars, 0)::BIGINT AS resolution_bars,
           pattern::VARCHAR AS pattern
         FROM read_json_auto(${sqlString(ndjson.replace(/\\/g, '/'))}, format = 'newline_delimited')
         ORDER BY timestamp`;
    await queryQuestDB(`COPY (${select}) TO ${sqlString(stagingFile)} (FORMAT PARQUET)`, 300_000);
  } finally {
    fs.rmSync(ndjson, { force: true });
  }
}

async function summarizeStaged(stagingFile: string): Promise<StagedSummary> {
  const source = localSource(stagingFile);
  const columns = (await queryQuestDB<{ column_name: string }>(`SELECT column_name FROM (DESCRIBE SELECT * FROM ${source})`, 60_000))
    .map((row) => String(row.column_name));
  const [row] = await queryQuestDB<Record<string, unknown>>(
    `SELECT count(*) AS c, epoch_ms(min(timestamp)) AS first_ms, epoch_ms(max(timestamp)) AS last_ms,
            epoch_ms(quantile_cont(timestamp, ${TRUNCATION_SHARE})) AS cutoff_ms
     FROM ${source}`,
    60_000,
  );
  const n = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
  return {
    rowCount: Number(row?.c ?? 0),
    firstEventMs: n(row?.first_ms),
    lastEventMs: n(row?.last_ms),
    cutoffMs: n(row?.cutoff_ms),
    columns,
  };
}

/**
 * Stage, enrich, validate, land. Returns what happened; throws only on a
 * failure of the machinery itself, never on a failed gate.
 */
export async function landLabelSet(args: LandLabelSetArgs): Promise<LandLabelSetResult> {
  const tmpDir = os.tmpdir();
  const base = path.join(tmpDir, `label_set_${args.labelSetId}_${process.pid}`);
  const stagingFile = `${base}.parquet`;
  const truncatedFile = `${base}_truncated.parquet`;
  const enrichedFile = `${base}_enriched.parquet`;
  const cleanup = () => {
    for (const file of [stagingFile, truncatedFile, enrichedFile]) fs.rmSync(file, { force: true });
  };

  try {
    await stageRows(args, stagingFile);
    const staged = await summarizeStaged(stagingFile);

    // Bars in the set's own span, for coverage.
    let barCountInWindow: number | null = null;
    if (staged.firstEventMs !== null && staged.lastEventMs !== null) {
      const countSql = boundByWindow(
        `WITH ${sampledBarsCte(args.config)} SELECT count(*) AS c FROM sampled_ohlcv`,
        { startMs: staged.firstEventMs, endMs: staged.lastEventMs },
      );
      const [row] = await queryQuestDB<{ c: number | bigint }>(countSql, 300_000);
      barCountInWindow = Number(row?.c ?? 0);
    }

    // The truncated run for the lookahead gate: the same SQL, bounded to end at
    // the 60th percentile of the event timestamps.
    let truncatedSource: string | null = null;
    let truncationEnd: number | null = null;
    if (args.sql && !args.skipTruncationGate && staged.rowCount >= TRUNCATION_MINIMUM_ROWS && staged.cutoffMs !== null) {
      // Cut at the end of a whole UTC day. A futures root is stitched by each
      // day's total volume, so a window ending mid-day can pick a different
      // contract for that last, partial day than the full run did — a
      // difference in the SOURCE at the boundary, not a look past the horizon.
      const dayMs = 86_400_000;
      const cutoff = Math.floor(staged.cutoffMs / dayMs) * dayMs - 1;
      const truncatedSql = boundByWindow(args.sql, { endMs: cutoff });
      await queryQuestDB(`COPY (${truncatedSql}) TO ${sqlString(truncatedFile)} (FORMAT PARQUET)`, 600_000);
      truncatedSource = localSource(truncatedFile);
      truncationEnd = cutoff;
    }

    const enrichmentSql = buildEnrichmentSql({
      stagingSource: localSource(stagingFile),
      stagedColumns: staged.columns,
      config: args.config,
      roundTripCostPoints: roundTripCostPointsFor(args.symbol),
    });
    await queryQuestDB(`COPY (${enrichmentSql}) TO ${sqlString(enrichedFile)} (FORMAT PARQUET)`, 600_000);

    const [horizonRow] = await queryQuestDB<{ h: number | bigint | null }>(
      `SELECT max(resolution_bars) AS h FROM ${localSource(enrichedFile)}`, 60_000,
    );
    const maxHorizonBars = Number(horizonRow?.h ?? 0);
    const purgeBars = maxHorizonBars;
    const embargoBars = maxHorizonBars;

    const validation = await validateLabelRows({
      rowsSource: localSource(enrichedFile),
      truncatedSource,
      truncationEndMilliseconds: truncationEnd,
      barCountInWindow,
      purgeBars,
    });

    const parquetPath = labelSetObjectPath(args.recipe, !validation.passed);
    await queryQuestDB(
      `COPY (SELECT * FROM ${localSource(enrichedFile)} ORDER BY timestamp) TO ${sqlString(parquetPath)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
      600_000,
    );
    const [count] = await queryQuestDB<{ c: number | bigint }>(`SELECT count(*) AS c FROM read_parquet(${sqlString(parquetPath)}, hive_partitioning = false)`, 120_000);
    const rowCount = Number(count?.c ?? 0);

    const sourceFingerprint: LabelSourceFingerprint = {
      tableName: args.source.tableName,
      resolution: args.source.resolution,
      rowCount: args.source.rowCount,
      coverageStartTimestamp: args.source.coverageStart,
      coverageEndTimestamp: args.source.coverageEnd,
    };

    if (validation.passed) {
      let bytes = 0;
      try {
        const [sizeRow] = await queryQuestDB<{ size: number | bigint }>(
          `SELECT size FROM glob(${sqlString(parquetPath)})`, 60_000,
        );
        bytes = Number(sizeRow?.size ?? 0);
      } catch {
        bytes = 0;
      }
      const manifest: LabelManifestLine = {
        written_at: new Date().toISOString(),
        dataset: LABEL_DATASET,
        table: LABEL_TABLE,
        zone: 'derived',
        recipe: args.recipe,
        source: 'ml_dashboard labelSetStore',
        rows: rowCount,
        duplicates_removed: 0,
        file_count: 1,
        bytes,
        ts_min: staged.firstEventMs === null ? null : new Date(staged.firstEventMs).toISOString(),
        ts_max: staged.lastEventMs === null ? null : new Date(staged.lastEventMs).toISOString(),
        contract_version: LABEL_CONTRACT_VERSION,
        label_set_id: args.labelSetId,
        generator_type: args.generatorType,
        label_encoding: args.labelEncoding,
        symbol: args.symbol,
        timeframe_minutes: args.timeframeMinutes,
        parameters: args.params,
        parameters_hash: args.parametersHash,
        window_start_timestamp: args.window.startMs ?? null,
        window_end_timestamp: args.window.endMs ?? null,
        source_fingerprint: sourceFingerprint,
        label_distribution: validation.labelDistribution,
        max_horizon_bars: maxHorizonBars,
        purge_bars: purgeBars,
        embargo_bars: embargoBars,
        object_path: parquetPath,
        validation,
      };
      await appendJsonLine(LABEL_MANIFEST_PATH, manifest as unknown as Record<string, unknown>);
      await refreshDerivedViews();
    }

    return {
      landed: validation.passed,
      parquetPath,
      rowCount,
      labelDistribution: validation.labelDistribution,
      dataStartTimestamp: staged.firstEventMs,
      dataEndTimestamp: staged.lastEventMs,
      maxHorizonBars,
      purgeBars,
      embargoBars,
      validation,
      sourceFingerprint,
      stagedRowCount: staged.rowCount,
    };
  } finally {
    cleanup();
  }
}

// ─── Reading back ───────────────────────────────────────────────────────────

export interface ReadLabelSetOptions {
  startMs?: number;
  endMs?: number;
  limit?: number;
  /** Only rows the contract marks usable (default true; sets landed before the contract have every row usable). */
  usableOnly?: boolean;
}

/** Rows of a persisted set, timestamps as epoch milliseconds, ascending. */
export async function readLabelSetRows(
  parquetPath: string,
  options: ReadLabelSetOptions = {},
): Promise<Array<Record<string, unknown>>> {
  if (!parquetPath.startsWith('s3://') || parquetPath.includes("'")) {
    throw new Error(`Refusing to read label rows from '${parquetPath}': not a lake object path`);
  }
  // `hive_partitioning = false`: the object sits under `recipe=…/table=…`, and
  // DuckDB would otherwise hand those path segments back as columns.
  const columns = (await queryQuestDB<{ column_name: string }>(
    `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet(${sqlString(parquetPath)}, hive_partitioning = false))`, 60_000,
  )).map((row) => String(row.column_name));
  const where: string[] = [];
  if (Number.isFinite(options.startMs)) where.push(`timestamp >= to_timestamp(${options.startMs! / 1000})`);
  if (Number.isFinite(options.endMs)) where.push(`timestamp <= to_timestamp(${options.endMs! / 1000})`);
  if ((options.usableOnly ?? true) && columns.includes('usable')) where.push('usable');
  const limit = Math.max(1, Math.floor(options.limit ?? 5000));
  const timestampColumns = columns.filter((c) => c === 'timestamp' || c === 'resolution_timestamp');
  const replace = timestampColumns.map((c) => `epoch_ms(${c}) AS ${c}`).join(', ');
  const rows = await queryQuestDB<Record<string, unknown>>(
    `SELECT * REPLACE (${replace})
     FROM read_parquet(${sqlString(parquetPath)}, hive_partitioning = false)
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY timestamp
     LIMIT ${limit}`,
    60_000,
  );
  return rows.map((row) => ({
    ...row,
    timestamp: Number(row.timestamp),
    ...(row.resolution_timestamp !== undefined && row.resolution_timestamp !== null
      ? { resolution_timestamp: Number(row.resolution_timestamp) }
      : {}),
  }));
}
