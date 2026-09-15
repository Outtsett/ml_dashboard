import { Injectable, Logger } from '@nestjs/common';
import { QuestDBService } from '../database/questdb.service';
import { getCacheStats } from '../cache';
import { listTrainedModels } from '../lib/modelResults';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Recursive on-disk size of a directory, in bytes.
 *
 * Replaces the previous hardcoded `storageSize = 1024` placeholder, which
 * reported a fabricated figure in the system manifest regardless of what was
 * actually on disk. Unreadable entries are skipped rather than aborting the
 * whole walk, so a single permission error can't zero out the total.
 */
function dirSizeBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch {
      // Skip entries that vanish or are unreadable mid-walk.
    }
  }
  return total;
}

export interface SystemManifest {
  timestamp: string;
  hardware: {
    cores: number;
    threads: number;
    total_ram_gb: number;
    free_ram_gb: number;
    load_avg: number[];
    gpu?: {
      utilization: number;
      memory_used_mb: number;
      memory_total_mb: number;
      temperature: number;
    };
  };
  infrastructure: {
    questdb: { connected: boolean; row_count: number; tables: string[] };
    cache: Record<string, unknown>;
    storage: { models_path: string; size_mb: number; free_gb: number };
  };
  inventory: {
    total_models: number;
    latest_model?: ReturnType<typeof listTrainedModels>[number];
    symbol_coverage: string[];
  };
}

@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  constructor(private readonly questdb: QuestDBService) {}

  async generateManifest(): Promise<SystemManifest> {
    const startTime = Date.now();

    // 1. Hardware Detection (Dynamic Saturation)
    const cpus = os.cpus();
    const threads = cpus.length;
    const hardware = {
      cores: threads / 2, 
      threads: threads,
      total_ram_gb: Math.round(os.totalmem() / (1024 ** 3)),
      free_ram_gb: Math.round(os.freemem() / (1024 ** 3)),
      load_avg: os.loadavg()
    };

    // 2. Audit Data Infrastructure
    let questdbStatus = { connected: false, row_count: 0, tables: [] as string[] };
    try {
      // DuckDB puts the serving views in `main`, not `public`, and requires an
      // argument to count().
      const tables = await this.questdb.query<{ table_name: string }>('SELECT table_name FROM information_schema.tables WHERE table_schema = \'main\'');
      const ohlcvCount = await this.questdb.query<{ cnt: number | bigint }>('SELECT count(*) as cnt FROM ohlcv');

      questdbStatus = {
        connected: true,
        row_count: Number(ohlcvCount[0]?.cnt || 0),
        tables: tables.map((t) => t.table_name)
      };
    } catch (e) {
      this.logger.warn(
        `QuestDB offline during manifest generation: ${(e as Error).message}`
      );
    }

    // 3. Audit Model Inventory
    const modelsPath = path.join(process.cwd(), 'data', 'models');
    const models = listTrainedModels(modelsPath);
    const symbols = [...new Set(models.map(m => m.symbol).filter((s): s is string => Boolean(s)))];

    // 4. Storage Audit
    let storageSize = 0;
    let freeSpaceGb = 0;
    try {
      if (fs.existsSync(modelsPath)) {
        // Real on-disk size of data/models, not a placeholder constant.
        storageSize = Math.round(dirSizeBytes(modelsPath) / (1024 * 1024));
        const stats = fs.statfsSync(path.parse(modelsPath).root);
        freeSpaceGb = (stats.bsize * stats.bfree) / (1024 * 1024 * 1024);
      }
    } catch (e) {
      this.logger.warn(`Storage audit failed: ${(e as Error).message}`);
    }

    const manifest: SystemManifest = {
      timestamp: new Date().toISOString(),
      hardware,
      infrastructure: {
        questdb: questdbStatus,
        cache: getCacheStats(),
        storage: {
          models_path: modelsPath,
          size_mb: storageSize,
          free_gb: Math.round(freeSpaceGb * 10) / 10
        }
      },
      inventory: {
        total_models: models.length,
        latest_model: models[0],
        symbol_coverage: symbols
      }
    };

    const duration = Date.now() - startTime;
    this.logger.log(`System Manifest generated in ${duration}ms [Threads: ${hardware.threads}]`);
    return manifest;
  }
}
