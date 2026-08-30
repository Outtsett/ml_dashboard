/**
 * DataManager — Professional data management service for training, backtesting, and temp files.
 *
 * Responsibilities:
 *   - Training data: Fetch from QuestDB, split by trainRatio, cache as versioned snapshots
 *   - Backtest data: Reuse cached training snapshots or fetch fresh windows
 *   - Temp files: Training checkpoints in data/runs/<jobId>/, auto-cleaned after 7 days
 *   - Model artifacts: Best checkpoints promoted to data/models/<model>/<version>/
 *
 * Storage Layout:
 *   data/
 *   ├── parquet/          Cached dataset snapshots
 *   ├── models/           Promoted model checkpoints
 *   ├── runs/             Per-job training artifacts (ephemeral)
 *   ├── .cache/           LRU computation caches
 *   └── uploads-tmp/      Temporary upload staging
 */
import fs from "fs";
import path from "path";
import { log } from "../infrastructure/lib/log";

const DATA_ROOT = path.resolve(process.cwd(), "data");
const DIRS = {
  parquet: path.join(DATA_ROOT, "parquet"),
  models: path.join(DATA_ROOT, "models"),
  runs: path.join(DATA_ROOT, "runs"),
  cache: path.join(DATA_ROOT, ".cache"),
  uploadsTmp: path.join(DATA_ROOT, "uploads-tmp"),
};

/** Max age for failed run artifacts before auto-cleanup (7 days) */
const STALE_RUN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface DiskUsageReport {
  category: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
}

interface DatasetSnapshot {
  id: string;
  symbol: string;
  timeframe: string;
  totalRows: number;
  trainRows: number;
  testRows: number;
  trainRatio: number;
  createdAt: string;
  sizeBytes: number;
}

export class DataManager {
  constructor() {
    this.ensureDirectories();
  }

  /** Create all required data directories if they don't exist */
  private ensureDirectories(): void {
    for (const [name, dirPath] of Object.entries(DIRS)) {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        log(`[DataManager] Created directory: ${name} -> ${dirPath}`, "data");
      }
    }
  }

  /** List all cached dataset snapshots */
  public listDatasets(): DatasetSnapshot[] {
    const snapshots: DatasetSnapshot[] = [];
    const parquetDir = DIRS.parquet;

    if (!fs.existsSync(parquetDir)) return snapshots;

    const files = fs.readdirSync(parquetDir).filter((f) => f.endsWith(".meta.json"));
    for (const metaFile of files) {
      try {
        const raw = fs.readFileSync(path.join(parquetDir, metaFile), "utf-8");
        const meta = JSON.parse(raw) as DatasetSnapshot;
        snapshots.push(meta);
      } catch (e) {
        log(`[DataManager] Failed to read snapshot meta: ${metaFile} — ${e}`, "data");
      }
    }

    return snapshots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Delete a cached dataset snapshot by ID */
  public deleteDataset(id: string): boolean {
    const metaPath = path.join(DIRS.parquet, `${id}.meta.json`);
    const dataPath = path.join(DIRS.parquet, `${id}.parquet`);

    let deleted = false;
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
      deleted = true;
    }
    if (fs.existsSync(dataPath)) {
      fs.unlinkSync(dataPath);
      deleted = true;
    }

    if (deleted) {
      log(`[DataManager] Deleted dataset snapshot: ${id}`, "data");
    }
    return deleted;
  }

  /** Calculate disk usage per data category */
  public getDiskUsage(): DiskUsageReport[] {
    const reports: DiskUsageReport[] = [];

    for (const [category, dirPath] of Object.entries(DIRS)) {
      if (!fs.existsSync(dirPath)) {
        reports.push({ category, path: dirPath, sizeBytes: 0, fileCount: 0 });
        continue;
      }

      const { size, count } = this.getDirStats(dirPath);
      reports.push({ category, path: dirPath, sizeBytes: size, fileCount: count });
    }

    return reports;
  }

  /** Create a run directory for a training job */
  public createRunDir(jobId: string): string {
    const runDir = path.join(DIRS.runs, jobId);
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }
    log(`[DataManager] Created run directory: ${runDir}`, "data");
    return runDir;
  }

  /** Promote a model checkpoint to the models directory */
  public promoteCheckpoint(modelName: string, version: string, checkpointPath: string): string {
    const destDir = path.join(DIRS.models, modelName, version);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const destPath = path.join(destDir, path.basename(checkpointPath));
    fs.copyFileSync(checkpointPath, destPath);
    log(`[DataManager] Promoted checkpoint: ${checkpointPath} -> ${destPath}`, "data");
    return destPath;
  }

  /** Clean up stale run directories older than 7 days for failed/completed jobs */
  public cleanupStaleRuns(): number {
    const runsDir = DIRS.runs;
    if (!fs.existsSync(runsDir)) return 0;

    const now = Date.now();
    let cleaned = 0;

    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const runPath = path.join(runsDir, entry.name);
      const stat = fs.statSync(runPath);
      const age = now - stat.mtimeMs;

      if (age > STALE_RUN_MAX_AGE_MS) {
        fs.rmSync(runPath, { recursive: true, force: true });
        log(`[DataManager] Cleaned stale run: ${entry.name} (age: ${Math.round(age / 86400000)}d)`, "data");
        cleaned++;
      }
    }

    return cleaned;
  }

  /** Recursively calculate directory size and file count */
  private getDirStats(dirPath: string): { size: number; count: number } {
    let size = 0;
    let count = 0;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const sub = this.getDirStats(fullPath);
          size += sub.size;
          count += sub.count;
        } else {
          const stat = fs.statSync(fullPath);
          size += stat.size;
          count++;
        }
      }
    } catch {
      // Permission errors or broken symlinks — skip
    }

    return { size, count };
  }
}

/** Singleton instance */
let instance: DataManager | null = null;

export function getDataManager(): DataManager {
  if (!instance) {
    instance = new DataManager();
  }
  return instance;
}
