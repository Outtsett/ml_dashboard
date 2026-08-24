import { Injectable, Inject } from '@nestjs/common';
import { HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { QuestDBHealthIndicator } from './questdb.health';
import { SQLiteHealthIndicator } from './sqlite.health';

@Injectable()
export class HealthService {
  constructor(
    @Inject(HealthCheckService) private health: HealthCheckService,
    @Inject(QuestDBHealthIndicator) private questdb: QuestDBHealthIndicator,
    @Inject(SQLiteHealthIndicator) private sqlite: SQLiteHealthIndicator,
  ) {}

  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.questdb.isHealthy('questdb'),
      () => this.sqlite.isHealthy('sqlite'),
    ]);
  }
}
