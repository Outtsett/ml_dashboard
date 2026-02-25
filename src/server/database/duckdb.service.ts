import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initDuckDB, runQuery, closeDuckDB } from '../duckdb/analyticsCore';

@Injectable()
export class DuckDBService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DuckDB');

  constructor(@Inject(ConfigService) private config: ConfigService) {}

  async onModuleInit() {
    try {
      await initDuckDB();
      this.logger.log('Analytics engine initialized');
    } catch (err) {
      this.logger.warn(`Initialization failed: ${err}`);
    }
  }

  onModuleDestroy() {
    this.logger.log('Closing...');
    closeDuckDB();
    this.logger.log('Closed');
  }

  query<T = any>(sql: string, params?: any[]) {
    return runQuery<T>(sql, params);
  }
}
