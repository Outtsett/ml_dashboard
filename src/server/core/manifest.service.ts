import { Injectable, Logger } from '@nestjs/common';
import { QuestDBService } from '../database/questdb.service';
import { getCacheStats } from '../cache';
import { listTrainedModels } from '../lib/modelResults';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

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
    motivewave_latency_ms?: number;
  };
  infrastructure: {
    questdb: { connected: boolean; row_count: number; tables: string[] };
    cache: any;
    storage: { models_path: string; size_mb: number; free_gb: number };
  };
  inventory: {
    total_models: number;
    latest_model?: any;
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
      const tables = await this.questdb.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'');
      const ohlcvCount = await this.questdb.query('SELECT count() as cnt FROM ohlcv');

      questdbStatus = {
        connected: true,
        row_count: Number(ohlcvCount[0]?.cnt || 0),
        tables: tables.map((t: any) => t.table_name)
      };
    } catch (e) {
      this.logger.warn('QuestDB offline during manifest generation');
    }

    // 3. Audit Model Inventory
    const modelsPath = path.join(process.cwd(), 'data', 'models');
    const models = listTrainedModels(modelsPath);
    const symbols = [...new Set(models.map(m => m.symbol))];

    // 4. Storage Audit
    let storageSize = 0;
    let freeSpaceGb = 0;
    try {
      if (fs.existsSync(modelsPath)) {
        storageSize = 1024; // MB placeholder
        const stats = fs.statfsSync(path.parse(modelsPath).root);
        freeSpaceGb = (stats.bsize * stats.bfree) / (1024 * 1024 * 1024);
      }
    } catch (e) {}

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
