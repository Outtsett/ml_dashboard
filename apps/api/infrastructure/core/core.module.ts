import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { GlobalExceptionFilter } from './filters/http-exception.filter';
import { ManifestService } from './manifest.service';
import { SystemController } from './system.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [AppConfigModule, HealthModule, DatabaseModule],
  controllers: [SystemController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ManifestService,
  ],
  exports: [HealthModule, ManifestService],
})
export class CoreModule {}
