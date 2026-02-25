import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './database/database.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { LabelsModule } from './labels/labels.module';
import { XaiModule } from './xai/xai.module';
import { TrainingModule } from './training/training.module';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    IndicatorsModule,
    LabelsModule,
    XaiModule,
    TrainingModule,
  ],
})
export class AppModule {}
