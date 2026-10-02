import { Injectable, Inject } from '@nestjs/common';
import { HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { SQLiteHealthIndicator } from './sqlite.health';

@Injectable()
export class HealthService {
  constructor(
    @Inject(HealthCheckService) private health: HealthCheckService,
    @Inject(SQLiteHealthIndicator) private sqlite: SQLiteHealthIndicator,
  ) {}

  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.sqlite.isHealthy('sqlite'),
    ]);
  }
}

