/**
 * MotiveWave File Watcher Service
 *
 * Watches a configurable directory for MotiveWave CSV exports.
 * On file creation/modification:
 *   1. Debounce rapid writes (MotiveWave may flush incrementally)
 *   2. Incremental ingest — skip previously-imported rows
 *   3. Parse → ILP ingest to QuestDB → SSE cache invalidation → dashboard update
 *
 * Config is persisted to SQLite (user_preferences, category='motivewave')
 * so watch directory and auto-start survive server restarts.
 *
 * File states are persisted to SQLite (mw_file_states) for incremental ingest.
 */

import { watch, type FSWatcher } from "chokidar";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../../database/db";
import { userPreferences, mwFileStates } from "@shared/schema";
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
  autoStart: boolean;
  patterns: string[];
}

const DEFAULT_CONFIG: MotiveWaveConfig = {
  watchDir: "",
  enabled: false,
  debounceMs: 200,
  autoStart: false,
  patterns: ["*.csv", "*.txt"],
};

/** Keys persisted to SQLite user_preferences (category = 'motivewave') */
const PERSIST_KEYS: (keyof MotiveWaveConfig)[] = [
  "watchDir",
  "enabled",
  "debounceMs",
  "autoStart",
];

// ─── State ──────────────────────────────────────────────────────────────────

interface FileState {
  size: number;
  lastModified: number;
  rowCount: number;
}

export interface ImportRecord {
  filename: string;
  symbol: string;
  timeframe: string;
  rowsImported: number;
  rowsSkipped: number;
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

  // ── Config Persistence ──────────────────────────────────────────────────

  /** Load configuration from SQLite user_preferences. */
  loadPersistedConfig(): void {
    try {
      const rows = db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.category, "motivewave"))
        .all();

      for (const row of rows) {
        if (PERSIST_KEYS.includes(row.key as keyof MotiveWaveConfig)) {
          try {
            (this.config as any)[row.key] = JSON.parse(row.value);
          } catch {
            (this.config as any)[row.key] = row.value;
          }
        }
      }

      if (this.config.watchDir) {
        console.log(
          `[motivewave] Loaded config: watchDir=${this.config.watchDir}, ` +
            `autoStart=${this.config.autoStart}, debounce=${this.config.debounceMs}ms`,
        );
      }
    } catch (err: any) {
      console.warn(`[motivewave] Failed to load persisted config: ${err.message}`);
    }
  }

  /** Save current configuration to SQLite user_preferences. */
  saveConfig(): void {
    try {
      for (const key of PERSIST_KEYS) {
        const value = JSON.stringify(this.config[key]);
        db.insert(userPreferences)
          .values({ key: `mw_${key}`, value, category: "motivewave" })
          .onConflictDoUpdate({
            target: userPreferences.key,
            set: { value, updatedAt: sql`(unixepoch() * 1000)` },
          })
          .run();
      }
    } catch (err: any) {
      console.error(`[motivewave] Failed to save config: ${err.message}`);
    }
  }

  /** Load persisted file states from SQLite for incremental ingest. */
  private loadPersistedFileStates(): void {
    try {
      const rows = db.select().from(mwFileStates).all();
      for (const row of rows) {
        this.fileStates.set(row.filePath, {
          size: row.fileSize,
          lastModified: row.lastModified,
          rowCount: row.rowsImported,
        });
      }
      if (rows.length > 0) {
        console.log(`[motivewave] Loaded ${rows.length} persisted file states`);
      }
    } catch (err: any) {
      console.warn(`[motivewave] Failed to load file states: ${err.message}`);
    }
  }

  /** Persist a file state to SQLite. */
  private persistFileState(
    filePath: string,
    state: FileState,
    symbol?: string,
    timeframe?: string,
  ): void {
    try {
      db.insert(mwFileStates)
        .values({
          filePath,
          fileSize: state.size,
          lastModified: state.lastModified,
          rowsImported: state.rowCount,
          symbol: symbol ?? null,
          timeframe: timeframe ?? null,
        })
        .onConflictDoUpdate({
          target: mwFileStates.filePath,
          set: {
            fileSize: state.size,
            lastModified: state.lastModified,
            rowsImported: state.rowCount,
            symbol: symbol ?? null,
            timeframe: timeframe ?? null,
            updatedAt: sql`(unixepoch() * 1000)`,
          },
        })
        .run();
    } catch (err: any) {
      console.warn(`[motivewave] Failed to persist file state: ${err.message}`);
    }
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

    // Load persisted file states for incremental ingest
    this.loadPersistedFileStates();

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
      ignored: (path: string) => {
        const ext = path.split(".").pop()?.toLowerCase();
        if (!ext) return false;
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

    // Persist to SQLite
    this.saveConfig();

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
    config: MotiveWaveConfig;
    trackedFiles: number;
    recentImports: ImportRecord[];
  } {
    return {
      running: this.isRunning,
      config: { ...this.config },
      trackedFiles: this.fileStates.size,
      recentImports: this.recentImports.slice(-20),
    };
  }

  // ── File Change Handler ─────────────────────────────────────────────────

  private onFileChange(filePath: string, event: "add" | "change"): void {
    const filename = basename(filePath);

    const meta = parseMotiveWaveFilename(filename);
    if (!meta) return;

    console.log(`[motivewave] ${event}: ${filename} (${meta.symbol} ${meta.timeframe} ${meta.session})`);

    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      filePath,
      setTimeout(() => {
        this.debounceTimers.delete(filePath);
        this.processFile(filePath, meta).catch((err) => {
          console.error(`[motivewave] Error processing ${filename}:`, err.message);
        });
      }, 100),
    );
  }

  // ── File Processing ─────────────────────────────────────────────────────

  async processFile(
    filePath: string,
    meta?: { symbol: string; timeframe: string; session: string },
  ): Promise<ParsedMotiveWaveFile | null> {
    const start = performance.now();
    const filename = basename(filePath);

    if (!meta) {
      meta = parseMotiveWaveFilename(filename) ?? undefined;
      if (!meta) {
        console.warn(`[motivewave] Unrecognized filename pattern: ${filename}`);
        return null;
      }
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const fileStats = await stat(filePath);

      // Check if file has changed since last import
      const prevState = this.fileStates.get(filePath);
      if (
        prevState &&
        prevState.size === fileStats.size &&
        prevState.lastModified === fileStats.mtimeMs
      ) {
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

      // Incremental ingest: skip rows we've already imported
      let rowsToIngest = rows;
      let rowsSkipped = 0;
      if (
        prevState &&
        prevState.rowCount > 0 &&
        fileStats.size >= prevState.size &&
        rows.length > prevState.rowCount
      ) {
        // File grew — only ingest new rows (MotiveWave appends to end)
        rowsSkipped = prevState.rowCount;
        rowsToIngest = rows.slice(prevState.rowCount);
        console.log(
          `[motivewave] ${filename}: incremental ingest — skipping ${rowsSkipped} previously-imported rows, ` +
            `ingesting ${rowsToIngest.length} new rows`,
        );
      } else if (prevState && rows.length <= prevState.rowCount && fileStats.size === prevState.size) {
        // Same size, same or fewer rows — skip entirely
        console.log(`[motivewave] ${filename}: no new rows, skipping`);
        return null;
      } else {
        // Full re-import: file was recreated or shrank (dedup handles dupes)
        console.log(
          `[motivewave] ${filename}: full import — ${rows.length} rows (${format} format, ` +
            `${errors} errors, table=${tableName})`,
        );
      }

      if (rowsToIngest.length === 0) {
        return null;
      }

      // ILP ingest to QuestDB
      await this.ingestToQuestDB(rowsToIngest, tableName);

      const durationMs = performance.now() - start;

      // Update file state (in memory + SQLite)
      const newState: FileState = {
        size: fileStats.size,
        lastModified: fileStats.mtimeMs,
        rowCount: rows.length,
      };
      this.fileStates.set(filePath, newState);
      this.persistFileState(filePath, newState, meta.symbol, meta.timeframe);

      // Record import
      const record: ImportRecord = {
        filename,
        symbol: meta.symbol,
        timeframe: meta.timeframe,
        rowsImported: rowsToIngest.length,
        rowsSkipped,
        timestamp: Date.now(),
        durationMs,
        status: "success",
      };
      this.recentImports.push(record);
      if (this.recentImports.length > 100) this.recentImports.shift();

      console.log(
        `[motivewave] ✓ ${filename}: ${rowsToIngest.length} rows ingested` +
          `${rowsSkipped > 0 ? ` (${rowsSkipped} skipped)` : ""} in ${durationMs.toFixed(0)}ms`,
      );

      // Emit SSE events: data update + cache invalidation
      this.emitUpdateEvent(meta.symbol, meta.timeframe, rowsToIngest.length, durationMs);
      this.emitCacheInvalidation(meta.symbol);

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
        rowsSkipped: 0,
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

  /** Emit cache.invalidate so the client refreshes OHLCV data for this symbol. */
  private emitCacheInvalidation(symbol: string): void {
    const bus = getEventBus();
    // cache.invalidate isn't in the typed event union — cast entire payload
    (bus as any).emit({
      type: "cache.invalidate",
      data: { queryKey: ["/api/ohlcv", symbol] },
      metadata: { correlationId: randomUUID(), causationId: "motivewave-watcher", timestamp: Date.now() },
    });
    (bus as any).emit({
      type: "cache.invalidate",
      data: { queryKey: ["/api/databases/questdb/stats"] },
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
    instance.loadPersistedConfig();
  }
  return instance;
}

export function resetMotiveWaveWatcher(): void {
  if (instance) {
    instance.stop().catch(() => {});
  }
  instance = null;
}
