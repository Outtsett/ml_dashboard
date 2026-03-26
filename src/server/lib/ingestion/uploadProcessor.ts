/**
 * Upload Processing — OHLCV file ingestion pipeline.
 *
 * Handles CSV (.csv, .zst), Parquet, and DBN files.
 * Pipeline: decompress → parse → QuestDB batch insert (ILP).
 *
 * Extracted from routes/upload.ts for SRP: routes handle HTTP, this handles data.
 */

import { parse } from "csv-parse";
import { spawn } from "child_process";
import { decompress } from "fzstd";
import { Readable } from "stream";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "node:crypto";
import { storage } from "../../storage";
import { parseTimestamp } from "../../routes/helpers";
import { ohlcvCache } from "../../cache/ohlcv";
import { clearParquetCacheForSymbol } from "../../cache/parquet";
import { getEventBus } from "../../events";

const DATA_DIR = path.join(process.cwd(), "data");

/** Emit ingestion.completed event and clear parquet cache for the symbol. */
function onIngestionComplete(symbol: string, uploadId: number, rowCount: number): void {
  // Clear Python parquet cache for this symbol
  clearParquetCacheForSymbol(symbol);

  // Emit ingestion.completed so QueryCache and other subscribers invalidate
  const bus = getEventBus();
  bus.emit({
    type: 'ingestion.completed',
    data: {
      uploadId: String(uploadId),
      symbol,
      timeframe: '1m', // upload processor doesn't know timeframe; default to 1m
      rowCount,
    },
    metadata: {
      correlationId: randomUUID(),
      causationId: `upload-${uploadId}`,
      timestamp: Date.now(),
    },
  });
}

// ─── Primary Entry Point ────────────────────────────────────────────────────

/**
 * Process an uploaded OHLCV file (CSV, ZST, Parquet, or DBN).
 * Dispatches to the appropriate handler based on file extension.
 */
export async function processOhlcvFile(
  buffer: Buffer,
  symbol: string,
  uploadId: number,
  filename: string,
): Promise<void> {
  console.log(`Processing file: ${filename} for symbol: ${symbol}`);

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

    parser.on('readable', function () {
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
          import("../../database/questdb").then(({ insertOHLCVBatch }) =>
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
        const { insertOHLCVBatch } = await import("../../database/questdb");
        await insertOHLCVBatch(records.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })));
      }

      await storage.updateUploadStatus(uploadId, "completed", recordCount);
      ohlcvCache.invalidateSymbol(symbol);
      onIngestionComplete(symbol, uploadId, recordCount);
      console.log(`File processing complete. ${recordCount} records -> QuestDB ohlcv`);
      resolve();
    });
  });
}

// ─── Disk-Based Processing (large files) ────────────────────────────────────

/**
 * Process an OHLCV file directly from disk (avoids holding 500MB in memory).
 * Streams CSV rows and inserts into QuestDB via ILP batches.
 */
export async function processOhlcvFileFromDisk(
  filePath: string,
  symbol: string,
  uploadId: number,
  filename: string,
): Promise<void> {
  // Path traversal protection — ensure file is within DATA_DIR or OS temp dir
  const resolved = path.resolve(filePath);
  const os = await import('os');
  const allowedPrefixes = [path.resolve(DATA_DIR), path.resolve(os.tmpdir())];
  if (!allowedPrefixes.some(prefix => resolved.startsWith(prefix))) {
    throw new Error(`Path traversal blocked: ${filePath}`);
  }

  console.log(`Processing file from disk: ${filename} for symbol: ${symbol}`);

  const { insertOHLCVBatch } = await import("../../database/questdb");

  return new Promise((resolve, reject) => {
    let inputStream: Readable;

    if (filename.endsWith('.zst')) {
      console.log("Using streaming zstd decompression...");
      const zstd = spawn('zstd', ['-d', '-c', filePath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      zstd.stderr.on('data', (data: Buffer) => { console.log(`zstd: ${data}`); });
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

    parser.on('readable', function () {
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
          const promise = insertOHLCVBatch(batch.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })))
            .then(() => console.log(`Inserted batch -> QuestDB ohlcv, total: ${recordCount}`))
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
          await insertOHLCVBatch(records.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })));
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
        onIngestionComplete(symbol, uploadId, recordCount);
        console.log(`File processing complete. Total records: ${recordCount} -> QuestDB ohlcv`);
        resolve();
      } catch (err) {
        console.error("Final batch error:", err);
        storage.updateUploadStatus(uploadId, "failed");
        reject(err);
      }
    });
  });
}

// ─── Parquet / DBN File Processing ──────────────────────────────────────────

/**
 * Process a Parquet or DBN file via Python data_reader.py.
 */
async function processParquetFile(
  buffer: Buffer,
  symbol: string,
  uploadId: number,
  filename: string,
): Promise<void> {
  console.log(`Processing data file: ${filename} for symbol: ${symbol}`);

  const os = await import('os');
  const { execSync } = await import('child_process');

  const ext = path.extname(filename) || '.parquet';
  const tempPath = path.join(os.tmpdir(), `upload_${Date.now()}${ext}`);
  fs.writeFileSync(tempPath, buffer);

  try {
    const pythonScript = path.join(process.cwd(), 'scripts', 'data_reader.py');
    const result = execSync(`python3 "${pythonScript}" "${tempPath}"`, {
      maxBuffer: 500 * 1024 * 1024,
      encoding: 'utf-8',
    });

    const data = JSON.parse(result);

    if (data.error) {
      throw new Error(data.error);
    }

    const { timestamps, opens, highs, lows, closes, volumes, count } = data;
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

      const { insertOHLCVBatch } = await import("../../database/questdb");
      await insertOHLCVBatch(batch.map(r => ({ symbol: r.symbol, timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })));
      insertedCount += batch.length;
      if (insertedCount % 10000 === 0 || insertedCount === count) {
        console.log(`Inserted ${insertedCount}/${count} -> QuestDB ohlcv`);
      }
    }

    await storage.updateUploadStatus(uploadId, "completed", count);
    ohlcvCache.invalidateSymbol(symbol);
    onIngestionComplete(symbol, uploadId, count);
    console.log(`Processing complete. ${count} records -> QuestDB ohlcv`);
  } finally {
    try { fs.unlinkSync(tempPath); }
    catch (e) { console.error("Error cleaning up temp file:", e); }
  }
}
