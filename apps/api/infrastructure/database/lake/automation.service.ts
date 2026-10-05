import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LakeService } from '../lake.service';
import { servingSnapshot } from './connection';

/**
 * Scheduled maintenance for the serving layer.
 *
 * The restart half of this service is gone. It used to kill a pid from
 * `.lake.pid` and spawn `io.lake.ServerMain`; lake was emptied and
 * retired on 2026-09-10, so there is no JVM to restart and nothing that would
 * answer on :9000 if there were. The replacement is an in-process DuckDB over
 * the lake — it has no process of its own, and re-reading the lake is a
 * `closeLake()` away rather than a service bounce.
 */
@Injectable()
export class LakeAutomationService implements OnModuleInit {
  private readonly logger = new Logger('LakeServingAutomation');

  constructor(private lake: LakeService) {}

  async onModuleInit() {
    // Schedule periodic tasks
    setInterval(() => this.runDailyMaintenance(), 24 * 60 * 60 * 1000);
    this.logger.log('Serving-layer automation initialized');
  }

  /**
   * Was: kill and re-spawn the lake JVM.
   *
   * Reports rather than throws because the caller is an HTTP route that renders
   * `message` — a 500 with a stack would tell the operator less than this does.
   */
  async restartLake(): Promise<{ success: boolean; message: string }> {
    const message =
      'There is no database process to restart. lake was retired on 2026-09-10 and ' +
      'this server now reads the lake through an in-process DuckDB. If the serving layer ' +
      'looks stale, restart this server. Restore path if lake is ever needed again: ' +
      's3://meta/lake_schema/lake_schema_latest.sql plus the parquet at ' +
      `s3://${servingSnapshot()}/.`;
    this.logger.warn(message);
    return { success: false, message };
  }

  /**
   * Runs daily maintenance tasks.
   * Previous no-ops (syncAllRollovers, refreshMaterializedViews) removed —
   * front-month detection is query-time, and the timeframe views are parquet
   * in the lake rather than anything this process refreshes.
   */
  async runDailyMaintenance(): Promise<void> {
    const healthy = await this.lake.checkHealth();
    this.logger.log(
      `Daily maintenance ran — no pending tasks (serving layer ${healthy ? 'reachable' : 'NOT reachable'})`,
    );
  }
}

