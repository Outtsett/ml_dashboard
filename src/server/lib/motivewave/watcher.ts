/**
 * MotiveWave File Watcher Service
 *
 * Watches a configurable directory for MotiveWave CSV exports.
 * On file creation/modification:
 *   1. Debounce rapid writes (MotiveWave may flush incrementally)
 *   2. Read new data (incremental for appends, full for new files)
 *   3. Parse → ILP ingest to QuestDB → SSE notification to dashboard
 *
 * Targets <100ms from file write to dashboard update.
 */

import { watch, type FSWatcher } from "chokidar";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getEventBus } from "../../events";
import {
  parseMotiveWaveFilename,
  parseMotiveWaveCSV,
  type ParsedMotiveWaveFile,
} from "./parser";
import {
  getQuestDBSender,
  type OHLCVRow,
} from "../../database/questdb/connection";
import {
  detectInstrumentType,
  getBaseTableForType,
} from "../../database/questdb/marketData";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface MotiveWaveConfig {
  watchDir: string;
  enabled: boolean;
  debounceMs: number;
  patterns: string[];
}

const DEFAULT_CONFIG: MotiveWaveConfig = {
  watchDir: "",
  enabled: false,
  debounceMs: 200,
  patterns: ["*.csv", "*.txt"],
};

// ─── State ──────────────────────────────────────────────────────────────────

interface FileState {
  size: number;
  lastModified: number;
  rowCount: number;
}

interface ImportRecord {
  filename: string;
  symbol: string;
  timeframe: string;
  rowsImported: number;
  timestamp: number;
  durationMs: number;
  status: "success" | "error";
  error?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class MotiveWaveWatcher {
  private config: MotiveWaveConfig;
  private watcher: FSWatcher | null = null;
  private fileStates: Map<string, FileState> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private recentImports: ImportRecord[] = [];
  private isRunning = false;

  constructor(config?: Partial<MotiveWaveConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("[motivewave] Watcher already running");
      return;
    }
    if (!this.config.watchDir) {
      console.warn("[motivewave] No watch directory configured");
      return;
    }

    const dir = resolve(this.config.watchDir);
    console.log(`[motivewave] Starting file watcher on: ${dir}`);
    console.log(`[motivewave] Patterns: ${this.config.patterns.join(", ")}`);
    console.log(`[motivewave] Debounce: ${this.config.debounceMs}ms`);

    this.watcher = watch(dir, {
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: this.config.debounceMs,
        pollInterval: 50,
      },
      // Only watch CSV/TXT files
      ignored: (path: string) => {
        const ext = path.split(".").pop()?.toLowerCase();
        if (!ext) return false; // don't ignore directories
        return !["csv", "txt"].includes(ext);
      },
    });

    this.watcher.on("add", (filePath: string) => this.onFileChange(filePath, "add"));
    this.watcher.on("change", (filePath: string) => this.onFileChange(filePath, "change"));
    this.watcher.on("error", (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[motivewave] Watcher error:", msg);
    });
    this.watcher.on("ready", () => {
      console.log("[motivewave] Watcher ready and scanning for changes");
    });

    this.isRunning = true;
    this.emitStatusEvent("started");
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.watcher) return;

    console.log("[motivewave] Stopping file watcher");
    await this.watcher.close();
    this.watcher = null;
    this.isRunning = false;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.emitStatusEvent("stopped");
  }

  // ── Configuration ───────────────────────────────────────────────────────

  configure(update: Partial<MotiveWaveConfig>): void {
    const wasRunning = this.isRunning;
    const dirChanged = update.watchDir && update.watchDir !== this.config.watchDir;

    this.config = { ...this.config, ...update };

    // Restart watcher if directory changed while running
    if (wasRunning && dirChanged) {
      this.stop().then(() => {
        if (this.config.enabled) this.start();
      });
    }
  }

  getConfig(): MotiveWaveConfig {
    return { ...this.config };
  }

  getStatus(): {
    running: boolean;
    watchDir: string;
    trackedFiles: number;
    recentImports: ImportRecord[];
  } {
    return {
      running: this.isRunning,
      watchDir: this.config.watchDir,
      trackedFiles: this.fileStates.size,
      recentImports: this.recentImports.slice(-20),
    };
  }

  // ── File Change Handler ─────────────────────────────────────────────────

  private onFileChange(filePath: string, event: "add" | "change"): void {
    const filename = basename(filePath);

    // Skip non-MotiveWave files
    const meta = parseMotiveWaveFilename(filename);
    if (!meta) return;

    console.log(`[motivewave] ${event}: ${filename} (${meta.symbol} ${meta.timeframe} ${meta.session})`);

    // Debounce: MotiveWave may write in chunks
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      filePath,
      setTimeout(() => {
        this.debounceTimers.delete(filePath);
        this.processFile(filePath, meta).catch((err) => {
          console.error(`[motivewave] Error processing ${filename}:`, err.message);
        });
      }, 100), // Additional 100ms debounce beyond awaitWriteFinish
    );
  }

  // ── File Processing ─────────────────────────────────────────────────────

  async processFile(
    filePath: string,
    meta?: { symbol: string; timeframe: string; session: string },
  ): Promise<ParsedMotiveWaveFile | null> {
    const start = performance.now();
    const filename = basename(filePath);

    // Parse metadata from filename if not provided
    if (!meta) {
      meta = parseMotiveWaveFilename(filename) ?? undefined;
      if (!meta) {
        console.warn(`[motivewave] Unrecognized filename pattern: ${filename}`);
        return null;
      }
    }

    try {
      // Read file
      const content = await readFile(filePath, "utf-8");
      const fileStats = await stat(filePath);

      // Check if file has changed since last import
      const prevState = this.fileStates.get(filePath);
      if (prevState && prevState.size === fileStats.size && prevState.lastModified === fileStats.mtimeMs) {
        console.log(`[motivewave] ${filename}: no changes since last import, skipping`);
        return null;
      }

      // Parse CSV
      const { rows, format, errors } = parseMotiveWaveCSV(content, meta.symbol);
      if (rows.length === 0) {
        console.warn(`[motivewave] ${filename}: no valid rows parsed`);
        return null;
      }

      const instrumentType = detectInstrumentType(meta.symbol);
      const tableName = getBaseTableForType(instrumentType);

      console.log(
        `[motivewave] ${filename}: parsed ${rows.length} rows (${format} format, ` +
          `${errors} errors, table=${tableName})`,
      );

      // ILP ingest to QuestDB
      await this.ingestToQuestDB(rows, tableName);

      const durationMs = performance.now() - start;

      // Update file state
      this.fileStates.set(filePath, {
        size: fileStats.size,
        lastModified: fileStats.mtimeMs,
        rowCount: rows.length,
      });

      // Record import
      const record: ImportRecord = {
        filename,
        symbol: meta.symbol,
        timeframe: meta.timeframe,
        rowsImported: rows.length,
        timestamp: Date.now(),
        durationMs,
        status: "success",
      };
      this.recentImports.push(record);
      if (this.recentImports.length > 100) this.recentImports.shift();

      console.log(`[motivewave] ✓ ${filename}: ${rows.length} rows ingested in ${durationMs.toFixed(0)}ms`);

      // Emit SSE event for real-time dashboard update
      this.emitUpdateEvent(meta.symbol, meta.timeframe, rows.length, durationMs);

      return {
        symbol: meta.symbol,
        timeframe: meta.timeframe,
        session: meta.session,
        instrumentType,
        rows,
        format,
        filename,
      };
    } catch (err: any) {
      const durationMs = performance.now() - start;
      const record: ImportRecord = {
        filename,
        symbol: meta.symbol,
        timeframe: meta.timeframe,
        rowsImported: 0,
        timestamp: Date.now(),
        durationMs,
        status: "error",
        error: err.message,
      };
      this.recentImports.push(record);
      if (this.recentImports.length > 100) this.recentImports.shift();

      this.emitErrorEvent(meta.symbol, err.message);
      throw err;
    }
  }

  // ── QuestDB Ingestion ───────────────────────────────────────────────────

  private async ingestToQuestDB(rows: OHLCVRow[], tableName: string): Promise<void> {
    const sender = await getQuestDBSender();
    const BATCH_SIZE = 1000;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      for (const row of batch) {
        await sender
          .table(tableName)
          .symbol("symbol", row.symbol)
          .floatColumn("open", row.open)
          .floatColumn("high", row.high)
          .floatColumn("low", row.low)
          .floatColumn("close", row.close)
          .floatColumn("volume", row.volume)
          .at(row.timestamp.getTime(), "ms");
      }
      await sender.flush();
    }
  }

  // ── SSE Events ──────────────────────────────────────────────────────────

  private emitUpdateEvent(symbol: string, timeframe: string, rowCount: number, durationMs: number): void {
    const bus = getEventBus();
    bus.emit({
      type: "system.motivewave-update",
      data: {
        symbol,
        timeframe,
        rowCount,
        durationMs: Math.round(durationMs),
        source: "motivewave",
      },
      metadata: { correlationId: randomUUID(), causationId: "motivewave-watcher", timestamp: Date.now() },
    });
  }

  private emitStatusEvent(status: string): void {
    const bus = getEventBus();
    bus.emit({
      type: "system.motivewave-status",
      data: {
        status,
        watchDir: this.config.watchDir,
      },
      metadata: { correlationId: randomUUID(), causationId: "motivewave-watcher", timestamp: Date.now() },
    });
  }

  private emitErrorEvent(symbol: string, error: string): void {
    const bus = getEventBus();
    bus.emit({
      type: "system.motivewave-error",
      data: { symbol, error, source: "motivewave" },
      metadata: { correlationId: randomUUID(), causationId: "motivewave-watcher", timestamp: Date.now() },
    });
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: MotiveWaveWatcher | null = null;

export function getMotiveWaveWatcher(): MotiveWaveWatcher {
  if (!instance) {
    instance = new MotiveWaveWatcher();
  }
  return instance;
}

export function resetMotiveWaveWatcher(): void {
  if (instance) {
    instance.stop().catch(() => {});
  }
  instance = null;
}
