import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthService } from './health.service';
import { QuestDBHealthIndicator } from './questdb.health';
import { SQLiteHealthIndicator } from './sqlite.health';

@Module({
  imports: [TerminusModule],
  providers: [
    HealthService,
    QuestDBHealthIndicator,
    SQLiteHealthIndicator,
  ],
  exports: [HealthService],
})
export class HealthModule {}
