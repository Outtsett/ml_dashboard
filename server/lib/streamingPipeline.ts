import * as fs from 'fs';
import * as path from 'path';
import { Transform, Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { parse } from 'csv-parse';
import { pipelineMetrics } from './metrics';

const pipelineAsync = promisify(pipeline);

export interface StreamingOptions {
  batchSize: number;
  highWaterMark: number;
  onProgress?: (processed: number, total?: number) => void;
  onBatch?: (batch: any[], batchNumber: number) => Promise<void>;
}

const DEFAULT_OPTIONS: StreamingOptions = {
  batchSize: 5000,
  highWaterMark: 64 * 1024
};

export class BatchTransform extends Transform {
  private batch: any[] = [];
  private batchNumber = 0;
  private totalProcessed = 0;
  private options: StreamingOptions;

  constructor(options: StreamingOptions) {
    super({ objectMode: true, highWaterMark: options.highWaterMark || 16 });
    this.options = options;
  }

  async _transform(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
    this.batch.push(chunk);
    this.totalProcessed++;

    if (this.batch.length >= this.options.batchSize) {
      try {
        await this.flushBatch();
        callback();
      } catch (error: any) {
        callback(error);
      }
    } else {
      callback();
    }
  }

  async _flush(callback: (error?: Error | null) => void) {
    if (this.batch.length > 0) {
      try {
        await this.flushBatch();
        callback();
      } catch (error: any) {
        callback(error);
      }
    } else {
      callback();
    }
  }

  private async flushBatch() {
    if (this.batch.length === 0) return;

    this.batchNumber++;
    const batchToProcess = [...this.batch];
    this.batch = [];

    if (this.options.onBatch) {
      await this.options.onBatch(batchToProcess, this.batchNumber);
    }

    if (this.options.onProgress) {
      this.options.onProgress(this.totalProcessed);
    }

    this.push({ batch: batchToProcess, batchNumber: this.batchNumber });
  }

  getTotalProcessed(): number {
    return this.totalProcessed;
  }
}

export async function streamCSVToDatabase(
  inputPath: string,
  symbol: string,
  processors: {
    postgres?: (batch: any[]) => Promise<void>;
    questdb?: (batch: any[]) => Promise<void>;
    duckdb?: (batch: any[]) => Promise<void>;
  },
  options: Partial<StreamingOptions> = {}
): Promise<{
  success: boolean;
  rowsProcessed: number;
  batchesProcessed: number;
  errors: string[];
  durationMs: number;
}> {
  const startTime = Date.now();
  const opts: StreamingOptions = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  let rowsProcessed = 0;
  let batchesProcessed = 0;

  try {
    const fileStream = fs.createReadStream(inputPath, { 
      highWaterMark: opts.highWaterMark 
    });

    const csvParser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: true
    });

    const rowTransformer = new Transform({
      objectMode: true,
      transform(row: any, encoding, callback) {
        try {
          const normalized = normalizeOhlcvRow(row, symbol);
          if (normalized) {
            callback(null, normalized);
          } else {
            callback();
          }
        } catch (error: any) {
          callback();
        }
      }
    });

    const batchProcessor = new BatchTransform({
      ...opts,
      onBatch: async (batch, batchNum) => {
        batchesProcessed = batchNum;
        rowsProcessed += batch.length;

        const processingPromises: Promise<void>[] = [];

        if (processors.postgres) {
          processingPromises.push(
            processors.postgres(batch).catch(e => {
              errors.push(`Postgres batch ${batchNum}: ${e.message}`);
            })
          );
        }

        if (processors.questdb) {
          processingPromises.push(
            processors.questdb(batch).catch(e => {
              errors.push(`QuestDB batch ${batchNum}: ${e.message}`);
            })
          );
        }

        if (processors.duckdb) {
          processingPromises.push(
            processors.duckdb(batch).catch(e => {
              errors.push(`DuckDB batch ${batchNum}: ${e.message}`);
            })
          );
        }

        await Promise.all(processingPromises);

        if (opts.onProgress) {
          opts.onProgress(rowsProcessed);
        }
      }
    });

    const sink = new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        callback();
      }
    });

    await pipelineAsync(
      fileStream,
      csvParser,
      rowTransformer,
      batchProcessor,
      sink
    );

    const durationMs = Date.now() - startTime;
    const success = errors.length === 0;
    pipelineMetrics.recordUpload(symbol, rowsProcessed, durationMs, success);

    return {
      success,
      rowsProcessed,
      batchesProcessed,
      errors,
      durationMs
    };
  } catch (error: any) {
    return {
      success: false,
      rowsProcessed,
      batchesProcessed,
      errors: [...errors, error.message],
      durationMs: Date.now() - startTime
    };
  }
}

function normalizeOhlcvRow(row: any, symbol: string): any | null {
  const timestamp = parseTimestamp(row);
  if (!timestamp) return null;

  const open = parseFloat(row.open || row.Open || row.o);
  const high = parseFloat(row.high || row.High || row.h);
  const low = parseFloat(row.low || row.Low || row.l);
  const close = parseFloat(row.close || row.Close || row.c);
  const volume = parseFloat(row.volume || row.Volume || row.v || 0);

  if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
    return null;
  }

  return {
    symbol: symbol.toUpperCase(),
    timestamp,
    open,
    high,
    low,
    close,
    volume: isNaN(volume) ? 0 : volume
  };
}

function parseTimestamp(row: any): number | null {
  const ts = row.timestamp || row.Timestamp || row.time || row.Time || 
             row.datetime || row.Datetime || row.date || row.Date ||
             row.ts_event || row.ts_recv;
  
  if (!ts) return null;

  if (typeof ts === 'number') {
    if (ts > 1e15) return Math.floor(ts / 1e6);
    if (ts > 1e12) return Math.floor(ts);
    return ts * 1000;
  }

  const parsed = Date.parse(ts);
  return isNaN(parsed) ? null : parsed;
}

export async function streamParquetToQuestDB(
  parquetPath: string,
  symbol: string,
  questdbInserter: (batch: any[]) => Promise<void>,
  options: Partial<StreamingOptions> = {}
): Promise<{
  success: boolean;
  rowsProcessed: number;
  errors: string[];
}> {
  const opts: StreamingOptions = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  let rowsProcessed = 0;

  try {
    const { queryParquetWithPagination } = await import('../duckdb');
    
    let offset = 0;
    let hasMore = true;
    const pathOrSymbol = parquetPath || symbol;

    while (hasMore) {
      const batch = await queryParquetWithPagination(pathOrSymbol, offset, opts.batchSize);

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      try {
        await questdbInserter(batch.map((row: any) => ({
          symbol: symbol.toUpperCase(),
          timestamp: row.timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume || 0
        })));
        rowsProcessed += batch.length;
      } catch (e: any) {
        errors.push(`Batch at offset ${offset}: ${e.message}`);
      }

      offset += opts.batchSize;
      hasMore = batch.length === opts.batchSize;

      if (opts.onProgress) {
        opts.onProgress(rowsProcessed);
      }
    }

    return { success: errors.length === 0, rowsProcessed, errors };
  } catch (error: any) {
    return { success: false, rowsProcessed, errors: [error.message] };
  }
}

export class MultiDatabaseWriter {
  private writers: Map<string, (batch: any[]) => Promise<void>> = new Map();
  private stats: Map<string, { written: number; errors: number }> = new Map();

  addWriter(name: string, writer: (batch: any[]) => Promise<void>) {
    this.writers.set(name, writer);
    this.stats.set(name, { written: 0, errors: 0 });
  }

  async writeBatch(batch: any[]): Promise<void> {
    const promises = Array.from(this.writers.entries()).map(async ([name, writer]) => {
      try {
        await writer(batch);
        const stats = this.stats.get(name)!;
        stats.written += batch.length;
      } catch (error) {
        const stats = this.stats.get(name)!;
        stats.errors++;
        console.error(`[MultiWriter] ${name} error:`, error);
      }
    });

    await Promise.all(promises);
  }

  getStats(): Record<string, { written: number; errors: number }> {
    return Object.fromEntries(this.stats);
  }
}
