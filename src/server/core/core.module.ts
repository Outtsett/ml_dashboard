import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { GlobalExceptionFilter } from './filters/http-exception.filter';

@Module({
  imports: [AppConfigModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [HealthModule],
})
export class CoreModule {}
