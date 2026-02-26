import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { db } from '../../database/db';
import { sql } from 'drizzle-orm';

@Injectable()
export class SQLiteHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      db.get(sql`SELECT 1`);
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError('SQLite check failed', this.getStatus(key, false));
    }
  }
}
