import { Injectable, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { DuckDBService } from '../../database/duckdb.service';

@Injectable()
export class DuckDBHealthIndicator extends HealthIndicator {
  constructor(@Inject(DuckDBService) private duckdb: DuckDBService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.duckdb.query('SELECT 1');
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError('DuckDB check failed', this.getStatus(key, false));
    }
  }
}
