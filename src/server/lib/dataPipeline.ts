import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { parquetStorage } from './parquetStorage';
import { pipelineMetrics } from './metrics';

export interface PipelineJob {
  id: string;
  type: 'ingest' | 'sync' | 'aggregate' | 'migrate';
  symbol: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  stages: PipelineStage[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface PipelineStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  rowsProcessed?: number;
  bytesProcessed?: number;
  error?: string;
}

export interface DataSource {
  type: 'postgres' | 'questdb' | 'duckdb' | 'file';
  path?: string;
  symbol?: string;
  available: boolean;
  rowCount?: number;
  lastUpdated?: Date;
}

export interface PipelineConfig {
  enableQuestDB: boolean;
  enableDuckDB: boolean;
  batchSize: number;
  maxConcurrentJobs: number;
  autoAggregateTimeframes: boolean;
}

const DEFAULT_CONFIG: PipelineConfig = {
  enableQuestDB: true,
  enableDuckDB: true,
  batchSize: 5000,
  maxConcurrentJobs: 3,
  autoAggregateTimeframes: true
};

class DataPipelineManager extends EventEmitter {
  private jobs: Map<string, PipelineJob> = new Map();
  private jobQueue: string[] = [];
  private activeJobs: number = 0;
  private config: PipelineConfig = DEFAULT_CONFIG;
  private syncScheduler: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  configure(config: Partial<PipelineConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): PipelineConfig {
    return { ...this.config };
  }

  createJob(type: PipelineJob['type'], symbol: string): PipelineJob {
    const id = `${type}-${symbol}-${Date.now()}`;
    const stages = this.getStagesForType(type);
    
    const job: PipelineJob = {
      id,
      type,
      symbol: symbol.toUpperCase(),
      status: 'queued',
      progress: 0,
      stages,
      createdAt: new Date()
    };
    
    this.jobs.set(id, job);
    this.jobQueue.push(id);
    this.emit('job:created', job);
    
    this.processQueue();
    
    return job;
  }

  private getStagesForType(type: PipelineJob['type']): PipelineStage[] {
    switch (type) {
      case 'ingest':
        return [
          { name: 'parse_file', status: 'pending' },
          { name: 'convert_parquet', status: 'pending' },
          { name: 'upload_cloud', status: 'pending' },
          { name: 'ingest_questdb', status: 'pending' },
          { name: 'create_aggregates', status: 'pending' },
          { name: 'update_metadata', status: 'pending' }
        ];
      case 'sync':
        return [
          { name: 'check_sources', status: 'pending' },
          { name: 'sync_cloud', status: 'pending' },
          { name: 'sync_questdb', status: 'pending' },
          { name: 'verify_consistency', status: 'pending' }
        ];
      case 'aggregate':
        return [
          { name: 'load_source', status: 'pending' },
          { name: 'aggregate_1m', status: 'pending' },
          { name: 'aggregate_5m', status: 'pending' },
          { name: 'aggregate_15m', status: 'pending' },
          { name: 'aggregate_1h', status: 'pending' },
          { name: 'aggregate_1d', status: 'pending' },
          { name: 'upload_aggregates', status: 'pending' }
        ];
      case 'migrate':
        return [
          { name: 'read_legacy', status: 'pending' },
          { name: 'transform_data', status: 'pending' },
          { name: 'write_questdb', status: 'pending' },
          { name: 'verify_migration', status: 'pending' }
        ];
      default:
        return [];
    }
  }

  private async processQueue() {
    if (this.activeJobs >= this.config.maxConcurrentJobs) return;
    if (this.jobQueue.length === 0) return;

    const jobId = this.jobQueue.shift();
    if (!jobId) return;

    const job = this.jobs.get(jobId);
    if (!job) return;

    this.activeJobs++;
    job.status = 'processing';
    job.startedAt = new Date();
    this.emit('job:started', job);

    try {
      await this.executeJob(job);
      job.status = 'completed';
      job.completedAt = new Date();
      job.progress = 100;
      this.emit('job:completed', job);
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = new Date();
      this.emit('job:failed', job, error);
    } finally {
      this.activeJobs--;
      this.processQueue();
    }
  }

  private async executeJob(job: PipelineJob): Promise<void> {
    const totalStages = job.stages.length;
    
    for (let i = 0; i < job.stages.length; i++) {
      const stage = job.stages[i]!;
      stage.status = 'running';
      stage.startedAt = new Date();
      this.emit('stage:started', job, stage);

      try {
        await this.executeStage(job, stage);
        stage.status = 'completed';
        stage.completedAt = new Date();
        job.progress = Math.round(((i + 1) / totalStages) * 100);
        this.emit('stage:completed', job, stage);
      } catch (error: any) {
        stage.status = 'failed';
        stage.error = error.message;
        stage.completedAt = new Date();
        
        if (this.isCriticalStage(stage.name)) {
          throw error;
        }
        
        console.warn(`[Pipeline] Non-critical stage ${stage.name} failed:`, error.message);
      }
    }
  }

  private async executeStage(job: PipelineJob, stage: PipelineStage): Promise<void> {
    const startTime = Date.now();
    
    switch (stage.name) {
      case 'check_sources':
        const sources = await this.checkDataSources(job.symbol);
        stage.rowsProcessed = sources.filter(s => s.available).length;
        break;

      case 'verify_consistency':
        const consistency = await this.verifyDataConsistency(job.symbol);
        if (!consistency.consistent) {
          console.warn(`[Pipeline] Consistency issues for ${job.symbol}:`, consistency.issues);
        }
        break;

      case 'ingest_questdb':
        // OHLCV data is ingested directly to QuestDB at upload time
        stage.status = 'skipped';
        break;

      case 'create_aggregates':
        // Pre-aggregation removed (was DuckDB-based). QuestDB SAMPLE BY handles aggregation at query time.
        stage.status = 'skipped';
        break;

      case 'read_legacy':
        // Legacy OHLCV source removed — data lives in QuestDB
        stage.status = 'skipped';
        break;

      case 'write_questdb':
        if (this.config.enableQuestDB) {
          try {
            const { migrateSymbol } = await import('./questdbMigration');
            const result = await migrateSymbol(job.symbol);
            stage.rowsProcessed = result.migratedRows;
          } catch (e: any) {
            console.warn(`[Pipeline] QuestDB write skipped: ${e.message}`);
            stage.status = 'skipped';
          }
        } else {
          stage.status = 'skipped';
        }
        break;

      default:
        break;
    }

    pipelineMetrics.recordPipelineOperation(stage.name, Date.now() - startTime);
  }

  private isCriticalStage(stageName: string): boolean {
    const criticalStages = ['parse_file', 'convert_parquet'];
    return criticalStages.includes(stageName);
  }

  async checkDataSources(symbol: string): Promise<DataSource[]> {
    const safeSymbol = symbol.toUpperCase();
    const sources: DataSource[] = [];

    const localParquet = parquetStorage.getLocalPath(safeSymbol);
    sources.push({
      type: 'file',
      path: localParquet,
      symbol: safeSymbol,
      available: fs.existsSync(localParquet),
      lastUpdated: fs.existsSync(localParquet) ? fs.statSync(localParquet).mtime : undefined
    });

    sources.push({ type: 'questdb', symbol: safeSymbol, available: true });
    sources.push({ type: 'questdb', symbol: safeSymbol, available: this.config.enableQuestDB });
    sources.push({ type: 'duckdb', symbol: safeSymbol, available: this.config.enableDuckDB });

    return sources;
  }

  async verifyDataConsistency(symbol: string): Promise<{
    consistent: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    const sources = await this.checkDataSources(symbol);
    
    const availableSources = sources.filter(s => s.available);
    if (availableSources.length < 2) {
      issues.push('Insufficient data sources for consistency check');
    }

    return {
      consistent: issues.length === 0,
      issues
    };
  }

  startSyncScheduler(_intervalMs: number = 5 * 60 * 1000) {
    // Cloud sync removed — scheduler is a no-op
  }

  stopSyncScheduler() {
    if (this.syncScheduler) {
      clearInterval(this.syncScheduler);
      this.syncScheduler = null;
    }
  }

  getJob(jobId: string): PipelineJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): PipelineJob[] {
    return Array.from(this.jobs.values());
  }

  getActiveJobs(): PipelineJob[] {
    return this.getAllJobs().filter(j => j.status === 'processing');
  }

  getQueuedJobs(): PipelineJob[] {
    return this.getAllJobs().filter(j => j.status === 'queued');
  }

  getRecentJobs(limit: number = 20): PipelineJob[] {
    return this.getAllJobs()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  getStats(): {
    totalJobs: number;
    activeJobs: number;
    queuedJobs: number;
    completedJobs: number;
    failedJobs: number;
  } {
    const jobs = this.getAllJobs();
    return {
      totalJobs: jobs.length,
      activeJobs: jobs.filter(j => j.status === 'processing').length,
      queuedJobs: jobs.filter(j => j.status === 'queued').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed').length
    };
  }

  clearCompletedJobs() {
    const toDelete: string[] = [];
    for (const [id, job] of Array.from(this.jobs)) {
      if (job.status === 'completed' || job.status === 'failed') {
        toDelete.push(id);
      }
    }
    toDelete.forEach(id => this.jobs.delete(id));
  }
}

export const dataPipeline = new DataPipelineManager();
