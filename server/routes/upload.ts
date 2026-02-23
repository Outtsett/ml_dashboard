import { Router, Request, Response } from "express";
import { storage } from "../storage";
import multer from "multer";
import { decompress } from "fzstd";
import { parse } from "csv-parse";
import { Readable } from "stream";
import * as fs from "fs";
import * as path from "path";
import { convertCSVToParquet, convertZstCSVToParquet, getParquetStats, runQuery } from "../duckdb";
import { uploadRateLimiter } from "../lib/rateLimiter";
import { parseTimestamp } from "./helpers";
import { ohlcvCache } from "../lib/ohlcvCache";

const DATA_DIR = path.join(process.cwd(), "data");

export const UPLOAD_TEMP_DIR = path.join(process.cwd(), 'data', 'uploads-tmp');
fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_TEMP_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

const router = Router();

// Upload and ingest OHLCV data from .zst compressed CSV (rate limited)
router.post("/upload/ohlcv", uploadRateLimiter, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    const uploadRecord = await storage.createUpload({
      filename: req.file.originalname,
      symbol,
      status: "processing",
      recordCount: 0,
    });

    // Read from disk (multer diskStorage) then process - avoids holding 500MB in memory
    const filePath = req.file.path;
    fs.promises.readFile(filePath)
      .then(buffer => processOhlcvFile(buffer, symbol, uploadRecord.id, req.file!.originalname))
      .then(() => fs.promises.unlink(filePath).catch(() => {}))
      .catch(err => {
        console.error("Error processing file:", err);
        storage.updateUploadStatus(uploadRecord.id, "failed");
        fs.promises.unlink(filePath).catch(() => {});
      });

    res.json({
      message: "Upload started",
      uploadId: uploadRecord.id,
      status: "processing"
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to process upload" });
  }
});

// Get upload history
router.get("/uploads", async (req: Request, res: Response) => {
  try {
    const uploads = await storage.getUploads();
    res.json(uploads);
  } catch (error) {
    console.error("Error fetching uploads:", error);
    res.status(500).json({ error: "Failed to fetch uploads" });
  }
});

export default router;

// ============================================================
// Helper functions (used internally by upload routes)
// ============================================================

async function processOhlcvFileFromDisk(
  filePath: string,
  symbol: string,
  uploadId: number,
  filename: string
): Promise<void> {
  console.log(`Processing file from disk: ${filename} for symbol: ${symbol}`);

  // Step 1: Convert to Parquet using DuckDB (very fast, columnar format for ML)
  if (filename.endsWith('.zst') || filename.endsWith('.csv')) {
    try {
      console.log("Converting CSV to Parquet using DuckDB...");
      const compression = filename.endsWith('.zst') ? 'zstd' : 'none';
      const parquetPath = await convertCSVToParquet(filePath, symbol, compression as 'zstd' | 'none');
      console.log(`Parquet file created at: ${parquetPath}`);

      // Get stats from parquet
      const stats = await getParquetStats(symbol);
      console.log(`Parquet stats: ${stats.count} records, ${(stats.fileSize / 1024 / 1024).toFixed(2)} MB`);

      // Step 2: Ingest into QuestDB if available (single-pass streaming approach)
      let questdbSuccess = false;
      let tempTable: string | null = null;
      try {
        const { insertOHLCVBatch, checkQuestDBHealth } = await import("../questdb");
        const isHealthy = await checkQuestDBHealth();
        if (isHealthy) {
          console.log("QuestDB is available, ingesting data with single-pass streaming...");

          // Create a temp ordered table once (single scan) then paginate from it
          const crypto = await import("crypto");
          tempTable = `temp_ingest_${crypto.randomUUID().replace(/-/g, '')}`;
          await runQuery(`CREATE OR REPLACE TEMPORARY TABLE "${tempTable}" AS
            SELECT ROW_NUMBER() OVER (ORDER BY timestamp, open, close) as rn, symbol, timestamp, open, high, low, close, volume
            FROM read_parquet('${parquetPath}')`);

          const countResult = await runQuery<{total: number}>(`SELECT MAX(rn) as total FROM "${tempTable}"`);

          if (countResult.length > 0 && countResult[0].total > 0) {
            const total = countResult[0].total;
            const CHUNK_SIZE = 50000;
            let totalIngested = 0;
            let chunkStart = 1;

            while (chunkStart <= total) {
              const chunkEnd = chunkStart + CHUNK_SIZE - 1;

              // Paginate from pre-computed temp table (fast indexed access)
              const chunkData = await runQuery<{symbol?: string; timestamp: number | string; open: number; high: number; low: number; close: number; volume?: number}>(
                `SELECT symbol, timestamp, open, high, low, close, volume FROM "${tempTable}" WHERE rn >= ${chunkStart} AND rn <= ${chunkEnd}`
              );

              if (chunkData.length > 0) {
                await insertOHLCVBatch(chunkData.map((row) => ({
                  symbol: row.symbol || symbol,
                  timestamp: new Date(typeof row.timestamp === 'number' ? row.timestamp : new Date(row.timestamp).getTime()),
                  open: row.open,
                  high: row.high,
                  low: row.low,
                  close: row.close,
                  volume: row.volume || 0
                })));
                totalIngested += chunkData.length;
              }

              chunkStart += CHUNK_SIZE;
              console.log(`Ingested ${totalIngested}/${total} rows into QuestDB`);
            }

            questdbSuccess = true;
            console.log(`QuestDB ingestion complete: ${totalIngested} rows`);
          }
        } else {
          console.log("QuestDB not available, skipping ingestion (data persisted in cloud storage)");
          questdbSuccess = true; // Not a failure if QuestDB unavailable, cloud has data
        }
      } catch (questErr) {
        console.error("QuestDB ingestion failed:", String(questErr).substring(0, 200));
      } finally {
        // Always clean up temp table
        if (tempTable) {
          try {
            await runQuery(`DROP TABLE IF EXISTS "${tempTable}"`);
          } catch (dropErr) {
            console.error("Failed to drop temp table:", dropErr);
          }
        }
      }

      // Step 4: Clean up original CSV file
      try {
        await fs.promises.unlink(filePath);
        console.log(`Deleted original file: ${filePath}`);
      } catch (cleanupErr) {
        console.error("Failed to delete original file:", cleanupErr);
      }

      // Determine final status based on pipeline success
      await storage.updateUploadStatus(uploadId, "completed", stats.count);
      ohlcvCache.invalidateSymbol(symbol); // clear stale cache for this symbol
      if (!questdbSuccess) {
        console.warn(`File processing complete: ${stats.count} records in Parquet. QuestDB ingestion skipped/failed.`);
      } else {
        console.log(`File processing complete: ${stats.count} records. Parquet: OK, QuestDB: OK`);
      }
      return;
    } catch (err) {
      console.error("DuckDB Parquet conversion failed, falling back to streaming:", err);
      // Fall through to streaming approach
    }
  }

  // Fallback: Streaming approach for non-zst files or if DuckDB fails
  const { spawn } = await import('child_process');
  const { getAssetType: getAssetTypeFallback } = await import("../storage");
  const { insertOHLCVBatch: insertBatchFallback } = await import("../questdb");
  const fallbackAssetType = getAssetTypeFallback(symbol);

  return new Promise((resolve, reject) => {
    let inputStream: Readable;

    if (filename.endsWith('.zst')) {
      console.log("Using streaming zstd decompression...");
      const zstd = spawn('zstd', ['-d', '-c', filePath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      zstd.stderr.on('data', (data) => {
        console.log(`zstd: ${data}`);
      });

      inputStream = zstd.stdout;
    } else {
      inputStream = fs.createReadStream(filePath);
    }

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    inputStream.pipe(parser);
    const records: Array<{ ts: Date; symbol: string; open: number; high: number; low: number; close: number; volume: number }> = [];
    let recordCount = 0;
    let batchPromises: Promise<any>[] = [];

    parser.on('readable', function() {
      let record;
      while ((record = parser.read()) !== null) {
        const timestamp = parseTimestamp(record);
        const open = parseFloat(record.open);
        const high = parseFloat(record.high);
        const low = parseFloat(record.low);
        const close = parseFloat(record.close);
        const volume = parseFloat(record.volume || record.vol || '0');

        if (isNaN(timestamp) || isNaN(open) || isNaN(close)) {
          return;
        }

        records.push({
          ts: new Date(timestamp),
          symbol,
          open,
          high: isNaN(high) ? open : high,
          low: isNaN(low) ? open : low,
          close,
          volume: isNaN(volume) ? 0 : volume,
        });
        recordCount++;

        if (records.length >= 1000) {
          const batch = records.splice(0, 1000);
          const promise = insertBatchFallback(batch.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })))
            .then(() => console.log(`[Fallback] Inserted batch -> QuestDB ohlcv, total: ${recordCount}`))
            .catch(err => console.error("Batch insert error:", err));
          batchPromises.push(promise);

          if (batchPromises.length >= 5) {
            parser.pause();
            Promise.all(batchPromises).then(() => {
              batchPromises = [];
              parser.resume();
            });
          }
        }
      }
    });

    parser.on('error', (err) => {
      console.error("CSV parse error:", err);
      storage.updateUploadStatus(uploadId, "failed");
      reject(err);
    });

    parser.on('end', async () => {
      try {
        await Promise.all(batchPromises);

        if (records.length > 0) {
          await insertBatchFallback(records.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })));
        }

        // Try to create Parquet from original file
        let parquetPath: string | null = null;
        try {
          console.log("[Fallback] Attempting to create Parquet and upload to cloud...");

          // For zst files, decompress first to a temp CSV
          let csvPathForConversion = filePath;
          let tempDecompressedPath: string | null = null;

          if (filename.endsWith('.zst')) {
            tempDecompressedPath = path.join(DATA_DIR, "ohlcv-processing", `decompressed_${symbol}_${Date.now()}.csv`);
            const { spawn } = await import('child_process');
            await new Promise<void>((res, rej) => {
              const zstd = spawn('zstd', ['-d', '-c', filePath], {
                stdio: ['ignore', 'pipe', 'pipe']
              });
              const writeStream = fs.createWriteStream(tempDecompressedPath!);
              zstd.stdout.pipe(writeStream);
              zstd.on('close', (code) => {
                if (code === 0) res();
                else rej(new Error(`zstd exited with code ${code}`));
              });
              zstd.on('error', rej);
            });
            csvPathForConversion = tempDecompressedPath;
          }

          // Convert to Parquet using DuckDB (from the full original/decompressed file)
          parquetPath = await convertCSVToParquet(csvPathForConversion, symbol, 'none');
          console.log(`[Fallback] Parquet created: ${parquetPath}`);

          // Clean up temp decompressed file if created
          if (tempDecompressedPath) {
            await fs.promises.unlink(tempDecompressedPath);
          }

        } catch (fallbackErr) {
          console.error("[Fallback] Could not create Parquet:", fallbackErr);
        }

        // Try to ingest to QuestDB if Parquet was created successfully (single-pass approach)
        if (parquetPath) {
          let fallbackTempTable: string | null = null;
          try {
            const { insertOHLCVBatch, checkQuestDBHealth } = await import("../questdb");
            const isHealthy = await checkQuestDBHealth();
            if (isHealthy) {
              console.log("[Fallback] Ingesting to QuestDB with temp table approach...");

              // Create temp table once for efficient pagination
              fallbackTempTable = `temp_fallback_${symbol.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
              await runQuery(`CREATE OR REPLACE TABLE ${fallbackTempTable} AS
                SELECT ROW_NUMBER() OVER (ORDER BY timestamp, open, close) as rn, symbol, timestamp, open, high, low, close, volume
                FROM read_parquet('${parquetPath}')`);

              const countResult = await runQuery<{total: number}>(`SELECT MAX(rn) as total FROM ${fallbackTempTable}`);
              if (countResult.length > 0 && countResult[0].total > 0) {
                const total = countResult[0].total;
                const CHUNK_SIZE = 50000;
                let totalIngested = 0;
                let chunkStart = 1;

                while (chunkStart <= total) {
                  const chunkEnd = chunkStart + CHUNK_SIZE - 1;
                  const chunkData = await runQuery<{symbol?: string; timestamp: number | string; open: number; high: number; low: number; close: number; volume?: number}>(
                    `SELECT symbol, timestamp, open, high, low, close, volume FROM ${fallbackTempTable} WHERE rn >= ${chunkStart} AND rn <= ${chunkEnd}`
                  );

                  if (chunkData.length > 0) {
                    await insertOHLCVBatch(chunkData.map((row) => ({
                      symbol: row.symbol || symbol,
                      timestamp: new Date(typeof row.timestamp === 'number' ? row.timestamp : new Date(row.timestamp).getTime()),
                      open: row.open,
                      high: row.high,
                      low: row.low,
                      close: row.close,
                      volume: row.volume || 0
                    })));
                    totalIngested += chunkData.length;
                  }
                  chunkStart += CHUNK_SIZE;
                }

                console.log(`[Fallback] QuestDB ingestion complete: ${totalIngested} rows`);
              }
            }
          } catch (questErr) {
            console.log("[Fallback] QuestDB ingestion skipped:", String(questErr).substring(0, 100));
          } finally {
            // Always clean up temp table
            if (fallbackTempTable) {
              try {
                await runQuery(`DROP TABLE IF EXISTS ${fallbackTempTable}`);
              } catch (dropErr) {
                console.error("[Fallback] Failed to drop temp table:", dropErr);
              }
            }
          }
        }

        // Clean up original file
        try {
          await fs.promises.unlink(filePath);
          console.log(`Deleted original file: ${filePath}`);
        } catch (cleanupErr) {
          console.error("Failed to delete original file:", cleanupErr);
        }

        await storage.updateUploadStatus(uploadId, "completed", recordCount);
        ohlcvCache.invalidateSymbol(symbol);
        console.log(`[Fallback] File processing complete. Total records: ${recordCount}.`);
        resolve();
      } catch (err) {
        console.error("Final batch error:", err);
        storage.updateUploadStatus(uploadId, "failed");
        reject(err);
      }
    });
  });
}

async function processOhlcvFile(
  buffer: Buffer,
  symbol: string,
  uploadId: number,
  filename: string
): Promise<void> {
  console.log(`Processing file: ${filename} for symbol: ${symbol}`);

  // Handle parquet and DBN files via Python
  if (filename.endsWith('.parquet') || filename.endsWith('.dbn')) {
    return processParquetFile(buffer, symbol, uploadId, filename);
  }

  let csvBuffer: Buffer;
  if (filename.endsWith('.zst')) {
    console.log("Decompressing .zst file...");
    csvBuffer = Buffer.from(decompress(buffer));
  } else {
    csvBuffer = buffer;
  }

  const { getAssetType } = await import("../storage");
  const assetType = getAssetType(symbol);
  const records: Array<{ ts: Date; symbol: string; open: number; high: number; low: number; close: number; volume: number }> = [];
  let recordCount = 0;

  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const stream = Readable.from(csvBuffer);
    stream.pipe(parser);

    parser.on('readable', function() {
      let record;
      while ((record = parser.read()) !== null) {
        const timestamp = parseTimestamp(record);
        const open = parseFloat(record.open);
        const high = parseFloat(record.high);
        const low = parseFloat(record.low);
        const close = parseFloat(record.close);
        const volume = parseFloat(record.volume || record.vol || '0');

        if (isNaN(timestamp) || isNaN(open) || isNaN(close)) {
          continue;
        }

        records.push({
          ts: new Date(timestamp),
          symbol,
          open,
          high: isNaN(high) ? open : high,
          low: isNaN(low) ? open : low,
          close,
          volume: isNaN(volume) ? 0 : volume,
        });
        recordCount++;

        if (records.length >= 1000) {
          const batch = records.splice(0, 1000);
          import("../questdb").then(({ insertOHLCVBatch }) =>
            insertOHLCVBatch(batch.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })))
          )
            .then(() => console.log(`Inserted batch to QuestDB ohlcv, total: ${recordCount}`))
            .catch(err => console.error("Batch insert error:", err));
        }
      }
    });

    parser.on('error', (err) => {
      console.error("CSV parse error:", err);
      storage.updateUploadStatus(uploadId, "failed");
      reject(err);
    });

    parser.on('end', async () => {
      if (records.length > 0) {
        const { insertOHLCVBatch } = await import("../questdb");
        await insertOHLCVBatch(records.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })));
      }

      await storage.updateUploadStatus(uploadId, "completed", recordCount);
      ohlcvCache.invalidateSymbol(symbol);
      console.log(`File processing complete. ${recordCount} records -> QuestDB ohlcv`);
      resolve();
    });
  });
}

async function processParquetFile(
  buffer: Buffer,
  symbol: string,
  uploadId: number,
  filename: string
): Promise<void> {
  console.log(`Processing data file: ${filename} for symbol: ${symbol}`);

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const { execSync } = await import('child_process');

  const ext = path.extname(filename) || '.parquet';
  const tempPath = path.join(os.tmpdir(), `upload_${Date.now()}${ext}`);
  fs.writeFileSync(tempPath, buffer);

  try {
    const pythonScript = path.join(process.cwd(), 'server', 'data_reader.py');
    const result = execSync(`python3 "${pythonScript}" "${tempPath}"`, {
      maxBuffer: 500 * 1024 * 1024,
      encoding: 'utf-8',
    });

    const data = JSON.parse(result);

    if (data.error) {
      throw new Error(data.error);
    }

    const { timestamps, opens, highs, lows, closes, volumes, count } = data;
    const { getAssetType } = await import("../storage");
    const assetType = getAssetType(symbol);
    const BATCH_SIZE = 1000;
    let insertedCount = 0;

    for (let start = 0; start < count; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, count);
      const batch: Array<{ ts: Date; symbol: string; open: number; high: number; low: number; close: number; volume: number }> = [];

      for (let i = start; i < end; i++) {
        batch.push({
          ts: new Date(timestamps[i]),
          symbol,
          open: opens[i],
          high: highs[i],
          low: lows[i],
          close: closes[i],
          volume: volumes[i] || 0,
        });
      }

      const { insertOHLCVBatch } = await import("../questdb");
      await insertOHLCVBatch(batch.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })));
      insertedCount += batch.length;
      if (insertedCount % 10000 === 0 || insertedCount === count) {
        console.log(`Inserted ${insertedCount}/${count} -> QuestDB ohlcv`);
      }
    }

    await storage.updateUploadStatus(uploadId, "completed", count);
    ohlcvCache.invalidateSymbol(symbol);
    console.log(`Processing complete. ${count} records -> QuestDB ohlcv`);

  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch (e) {
      console.error("Error cleaning up temp file:", e);
    }
  }
}
