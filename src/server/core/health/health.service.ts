import { Injectable, Inject } from '@nestjs/common';
import { HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { QuestDBHealthIndicator } from './questdb.health';
import { DuckDBHealthIndicator } from './duckdb.health';
import { SQLiteHealthIndicator } from './sqlite.health';

@Injectable()
export class HealthService {
  constructor(
    @Inject(HealthCheckService) private health: HealthCheckService,
    @Inject(QuestDBHealthIndicator) private questdb: QuestDBHealthIndicator,
    @Inject(DuckDBHealthIndicator) private duckdb: DuckDBHealthIndicator,
    @Inject(SQLiteHealthIndicator) private sqlite: SQLiteHealthIndicator,
  ) {}

  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.questdb.isHealthy('questdb'),
      () => this.duckdb.isHealthy('duckdb'),
      () => this.sqlite.isHealthy('sqlite'),
    ]);
  }
}
