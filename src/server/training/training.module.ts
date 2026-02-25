import { Module } from '@nestjs/common';
import { TrainingService } from './training.service';
import { RegistryService } from './registry.service';
import { DataExporterService } from './data-exporter.service';

@Module({
  providers: [TrainingService, RegistryService, DataExporterService],
  exports: [TrainingService, RegistryService, DataExporterService],
})
export class TrainingModule {}
