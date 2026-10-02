import { Module } from '@nestjs/common';
import { TrainingService } from './training.service';
import { RegistryService } from './registry.service';

@Module({
  providers: [TrainingService, RegistryService],
  exports: [TrainingService, RegistryService],
})
export class TrainingModule {}
