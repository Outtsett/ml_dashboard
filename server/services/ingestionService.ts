/**
 * Direct-to-QuestDB ingestion service.
 *
 * Replaces the old DuckDB-based ingestion pipeline (server/lib/ingestion/).
 * Reads Parquet/CSV files using DuckDB as an ephemeral compute engine,
 * normalizes data in TypeScript memory, and writes to QuestDB via ILP.
 * Tracks ingested files in SQLite (via Drizzle ORM) for dedup.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Pure types and functions (unit-testable, no DB dependencies)
// ---------------------------------------------------------------------------

export interface SchemaDetection {
  provider: "databento" | "oanda" | "standard" | "unknown";
  tsColumn: string;
  symbolColumn: string | null;
  priceScale: number; // 1 for standard, 1e-9 for Databento
  tsTransform: "nanoseconds" | "milliseconds" | "timestamp" | "iso";
}

/**
 * Detect the data provider and column mapping from column names.
 */
export function detectSchema(columns: string[]): SchemaDetection {
  const lower = columns.map((c) => c.toLowerCase());

  // Databento: has ts_event + instrument_id
  if (lower.includes("ts_event") && lower.includes("instrument_id")) {
    return {
      provider: "databento",
      tsColumn: "ts_event",
      symbolColumn: "instrument_id",
      priceScale: 1e-9, // Databento prices are in fixed-point * 1e9
      tsTransform: "nanoseconds",
    };
  }

  // Standard OHLCV: has timestamp + symbol
  if (lower.includes("timestamp") && lower.includes("symbol")) {
    return {
      provider: "standard",
      tsColumn: "timestamp",
      symbolColumn: "symbol",
      priceScale: 1,
      tsTransform: "timestamp",
    };
  }

  // OANDA / generic: has ts or time
  const tsCol = lower.includes("ts")
    ? "ts"
    : lower.includes("time")
      ? "time"
      : lower.includes("date")
        ? "date"
        : null;
  if (tsCol) {
    return {
      provider: "oanda",
      tsColumn: tsCol,
      symbolColumn: lower.includes("symbol") ? "symbol" : null,
      priceScale: 1,
      tsTransform: "timestamp",
    };
  }

  return {
    provider: "unknown",
    tsColumn: "",
    symbolColumn: null,
    priceScale: 1,
    tsTransform: "timestamp",
  };
}

export interface NormalizedRow {
  ts: number; // epoch milliseconds
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Normalize a raw row from any provider into standard OHLCV format.
 */
export function normalizeRow(
  raw: Record<string, any>,
  schema: SchemaDetection,
  symbolOverride?: string,
): NormalizedRow {
  // Timestamp normalization
  let ts: number;
  const rawTs = raw[schema.tsColumn];
  if (schema.tsTransform === "nanoseconds") {
    ts = Number(BigInt(rawTs) / BigInt(1_000_000)); // ns -> ms
  } else if (schema.tsTransform === "milliseconds") {
    ts = Number(rawTs);
  } else if (typeof rawTs === "string") {
    ts = new Date(rawTs).getTime();
  } else {
    // Heuristic: if under 2e10 it is seconds, otherwise milliseconds
    ts = Number(rawTs) < 2e10 ? Number(rawTs) * 1000 : Number(rawTs);
  }

  // Symbol
  const symbol =
    symbolOverride ||
    String(raw[schema.symbolColumn || "symbol"] || "UNKNOWN");

  // Prices with scaling
  const scale = schema.priceScale;
  return {
    ts,
    symbol,
    open: Number(raw.open) * scale,
    high: Number(raw.high) * scale,
    low: Number(raw.low) * scale,
    close: Number(raw.close) * scale,
    volume: Number(raw.volume || 0),
  };
}

// ---------------------------------------------------------------------------
// DB-dependent functions (integration-tested only)
// ---------------------------------------------------------------------------

/**
 * Compute SHA256 hash of a file.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Check if a file has already been ingested (SQLite dedup).
 */
export async function checkFileIngested(
  filePath: string,
  currentHash: string,
): Promise<{ ingested: boolean; hashChanged: boolean }> {
  const { db: pgDb } = await import("../db");
  const { ingestedFiles } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const safePath = filePath.replace(/\\/g, "/");
  const rows = await pgDb
    .select()
    .from(ingestedFiles)
    .where(eq(ingestedFiles.filePath, safePath));

  if (rows.length === 0) return { ingested: false, hashChanged: false };
  if (rows[0].fileHash === currentHash)
    return { ingested: true, hashChanged: false };
  return { ingested: false, hashChanged: true };
}

/**
 * Record a successful ingestion in SQLite.
 */
export async function recordIngestion(
  filePath: string,
  fileHash: string,
  fileSize: number,
  rowCount: number,
  symbol: string,
  tsMin: Date,
  tsMax: Date,
): Promise<void> {
  const { db: pgDb } = await import("../db");
  const { ingestedFiles } = await import("@shared/schema");

  const safePath = filePath.replace(/\\/g, "/");
  await pgDb
    .insert(ingestedFiles)
    .values({ filePath: safePath, fileHash, fileSize, rowCount, symbol, tsMin, tsMax })
    .onConflictDoUpdate({
      target: ingestedFiles.filePath,
      set: { fileHash, fileSize, rowCount, symbol, tsMin, tsMax },
    });
}

export interface IngestResult {
  file: string;
  status: "ingested" | "skipped" | "error";
  rowCount?: number;
  error?: string;
}

/**
 * Ingest a Parquet file: read with DuckDB (ephemeral), normalize, write to QuestDB via ILP.
 * DuckDB is used as an ephemeral compute engine for reading Parquet -- no persistent storage.
 */
export async function ingestOHLCVFile(
  filePath: string,
  options?: {
    symbolOverride?: string;
    priceScale?: number;
    targetTable?: string; // default: 'ohlcv'
  },
): Promise<IngestResult> {
  const absPath = path.resolve(filePath);
  const safePath = absPath.replace(/\\/g, "/");
  const table = options?.targetTable || "ohlcv";

  // Step 1: Dedup check
  const fileHash = await computeFileHash(absPath);
  const dupCheck = await checkFileIngested(absPath, fileHash);
  if (dupCheck.ingested) return { file: absPath, status: "skipped" };

  try {
    // Step 2: Read Parquet with ephemeral DuckDB (analytics instance)
    const { runQuery } = await import("../duckdb");

    // Detect schema from column names
    const schemaRows = await runQuery<{ column_name: string }>(
      `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${safePath}'))`,
    );
    const columns = schemaRows.map((r: any) => r.column_name);
    const schema = detectSchema(columns);

    if (schema.provider === "unknown") {
      return {
        file: absPath,
        status: "error",
        error: `Cannot detect schema: ${columns.join(", ")}`,
      };
    }

    // Read all rows
    const rows = await runQuery(`SELECT * FROM read_parquet('${safePath}')`);

    // Step 3: Normalize and write to QuestDB via ILP
    const { getQuestDBSender } = await import("../questdb");
    const sender = await getQuestDBSender();
    let rowCount = 0;
    let tsMin = Infinity;
    let tsMax = -Infinity;

    const effectiveScale = options?.priceScale || schema.priceScale;
    const effectiveSchema = { ...schema, priceScale: effectiveScale };

    for (const raw of rows) {
      const normalized = normalizeRow(
        raw,
        effectiveSchema,
        options?.symbolOverride,
      );

      await sender
        .table(table)
        .symbol("symbol", normalized.symbol)
        .floatColumn("open", normalized.open)
        .floatColumn("high", normalized.high)
        .floatColumn("low", normalized.low)
        .floatColumn("close", normalized.close)
        .floatColumn("volume", normalized.volume)
        .at(normalized.ts, "ms");

      if (normalized.ts < tsMin) tsMin = normalized.ts;
      if (normalized.ts > tsMax) tsMax = normalized.ts;
      rowCount++;

      // Flush periodically to manage memory
      if (rowCount % 50000 === 0) {
        await sender.flush();
      }
    }

    await sender.flush();

    // Step 4: Record in SQLite
    const fileSize = fs.statSync(absPath).size;
    const symbol =
      options?.symbolOverride ||
      String(rows[0]?.[schema.symbolColumn || "symbol"] || "UNKNOWN");
    await recordIngestion(
      absPath,
      fileHash,
      fileSize,
      rowCount,
      symbol,
      new Date(tsMin),
      new Date(tsMax),
    );

    return { file: absPath, status: "ingested", rowCount };
  } catch (error: any) {
    return { file: absPath, status: "error", error: error.message };
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
    targetTable?: string;
  },
): Promise<IngestResult[]> {
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".parquet"))
    .map((f) => path.join(dirPath, f));

  const results: IngestResult[] = [];
  for (const file of files) {
    const symbol = options?.symbolExtractor?.(path.basename(file)) || undefined;
    const result = await ingestOHLCVFile(file, {
      symbolOverride: symbol,
      priceScale: options?.priceScale,
      targetTable: options?.targetTable,
    });
    results.push(result);
    console.log(
      `[ingest] ${path.basename(file)}: ${result.status}` +
        `${result.rowCount ? ` (${result.rowCount} rows)` : ""}` +
        `${result.error ? ` -- ${result.error}` : ""}`,
    );
  }

  return results;
}
