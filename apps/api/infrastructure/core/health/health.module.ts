import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthService } from './health.service';
import { SQLiteHealthIndicator } from './sqlite.health';

@Module({
  imports: [TerminusModule],
  providers: [
    HealthService,
    SQLiteHealthIndicator,
  ],
  exports: [HealthService],
})
export class HealthModule {}

