/**
 * Parquet file ingestion into DuckDB market database.
 * Handles: schema detection, standardization, file-level dedup.
 */
import * as fs from 'fs';
import * as path from 'path';
import { marketQuery, initMarketDB } from '../../duckdb/market';
import { computeFileHash, checkFileStatus, recordIngestion } from './fileTracker';
import { detectMapping, buildInsertSQL } from './standardize';

export interface IngestResult {
  file: string;
  status: 'ingested' | 'skipped' | 'error';
  rowCount?: number;
  error?: string;
}

/**
 * Ingest a single Parquet file into the market DuckDB.
 */
export async function ingestParquetFile(
  filePath: string,
  options?: {
    symbolOverride?: string;
    priceScale?: number;
    tsTransformOverride?: string;
  }
): Promise<IngestResult> {
  const absPath = path.resolve(filePath);
  const safePath = absPath.replace(/\\/g, '/');

  // Step 1: Compute hash and check dedup
  const fileHash = await computeFileHash(absPath);
  const status = await checkFileStatus(absPath, fileHash);

  if (status.alreadyIngested) {
    return { file: absPath, status: 'skipped' };
  }

  if (status.hashChanged) {
    console.warn(`[ingest] File changed since last ingestion: ${absPath}`);
  }

  try {
    // Step 2: Read schema from Parquet file
    const schemaRows = await marketQuery<{ column_name: string }>(
      `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${safePath}'))`
    );
    const columns = schemaRows.map(r => r.column_name);

    // Step 3: Detect column mapping
    let mapping = detectMapping(columns);
    if (!mapping) {
      return { file: absPath, status: 'error', error: `Cannot map columns: ${columns.join(', ')}` };
    }

    // Apply overrides
    if (options?.tsTransformOverride) {
      mapping.tsTransform = options.tsTransformOverride;
    }

    // Step 4: Count rows before insert
    const countResult = await marketQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM read_parquet('${safePath}')`
    );
    const rowCount = Number(countResult[0].cnt);

    // Step 5: Insert standardized data
    const sql = buildInsertSQL(safePath, mapping, options?.symbolOverride, options?.priceScale);
    await marketQuery(sql);

    // Step 6: Get time range for the symbol we just inserted
    const symbolForQuery = options?.symbolOverride || 'UNKNOWN';
    const rangeResult = await marketQuery<{ ts_min: string; ts_max: string }>(
      `SELECT MIN(ts)::VARCHAR as ts_min, MAX(ts)::VARCHAR as ts_max
       FROM ohlcv WHERE symbol = '${symbolForQuery}'`
    );

    // Step 7: Record ingestion
    const fileSize = fs.statSync(absPath).size;
    await recordIngestion(
      absPath, fileHash, fileSize, rowCount,
      symbolForQuery,
      new Date(rangeResult[0].ts_min),
      new Date(rangeResult[0].ts_max)
    );

    return { file: absPath, status: 'ingested', rowCount };
  } catch (error: any) {
    return { file: absPath, status: 'error', error: error.message };
  }
}

/**
 * Ingest all Parquet files in a directory.
 */
export async function ingestDirectory(
  dirPath: string,
  options?: {
    symbolExtractor?: (filename: string) => string;
    priceScale?: number;
  }
): Promise<IngestResult[]> {
  await initMarketDB();

  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.parquet'))
    .map(f => path.join(dirPath, f));

  const results: IngestResult[] = [];
  for (const file of files) {
    const symbol = options?.symbolExtractor?.(path.basename(file)) || undefined;
    const result = await ingestParquetFile(file, {
      symbolOverride: symbol,
      priceScale: options?.priceScale,
    });
    results.push(result);
    console.log(`[ingest] ${path.basename(file)}: ${result.status}${result.rowCount ? ` (${result.rowCount} rows)` : ''}${result.error ? ` — ${result.error}` : ''}`);
  }

  return results;
}
